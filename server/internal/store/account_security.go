package store

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Emailed token purposes (auth_tokens.purpose).
const (
	TokenPasswordReset = "password_reset"
	TokenEmailVerify   = "email_verify"
)

// ErrTokenInvalid covers unknown, used, expired and stale emailed tokens.
var ErrTokenInvalid = errors.New("this link is invalid or has expired")

// AccountStatus is what the client needs to render account and security
// settings. It never contains a secret.
type AccountStatus struct {
	HasPassword      bool       `json:"hasPassword"`
	GoogleLinked     bool       `json:"googleLinked"`
	EmailVerifiedAt  *time.Time `json:"emailVerifiedAt,omitempty"`
	TwoFactorEnabled bool       `json:"twoFactorEnabled"`
	Locale           string     `json:"locale"`
	CreatedAt        time.Time  `json:"createdAt"`
}

func (s *Store) AccountStatus(ctx context.Context, userID uuid.UUID) (AccountStatus, error) {
	var status AccountStatus
	err := s.pool.QueryRow(ctx, `
		SELECT password_hash IS NOT NULL AND password_hash <> '', google_sub IS NOT NULL,
			email_verified_at, totp_enabled_at IS NOT NULL, locale, created_at
		FROM users WHERE id = $1`, userID).
		Scan(&status.HasPassword, &status.GoogleLinked, &status.EmailVerifiedAt, &status.TwoFactorEnabled, &status.Locale, &status.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return AccountStatus{}, ErrNotFound
	}
	return status, err
}

// SetUserLocale records the language used for account emails.
func (s *Store) SetUserLocale(ctx context.Context, userID uuid.UUID, locale string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET locale = $2 WHERE id = $1 AND locale <> $2`, userID, locale)
	return err
}

// UserByEmail looks an account up for the forgot-password flow.
func (s *Store) UserByEmail(ctx context.Context, email string) (User, string, error) {
	var user User
	var locale string
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, email_verified, display_name, avatar_url, locale
		FROM users WHERE lower(email) = lower($1)`, normalizeEmailValue(email)).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL, &locale)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	return user, locale, err
}

// AuthTokenActivity reports how many tokens of a purpose were issued for the
// account since a time, and when the latest one was issued, so the API can
// throttle emails per account.
func (s *Store) AuthTokenActivity(ctx context.Context, userID uuid.UUID, purpose string, since time.Time) (int, *time.Time, error) {
	var count int
	var latest *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT count(*), max(created_at) FROM auth_tokens
		WHERE user_id = $1 AND purpose = $2 AND created_at >= $3`, userID, purpose, since).Scan(&count, &latest)
	return count, latest, err
}

// CreateAuthToken stores the hash of a new emailed token. Earlier unused
// tokens of the same purpose stop working: only the latest email counts.
func (s *Store) CreateAuthToken(ctx context.Context, userID uuid.UUID, purpose, email, token string, ttl time.Duration) error {
	hash := sha256.Sum256([]byte(token))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, userID, purpose); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO auth_tokens (user_id, purpose, token_hash, email, expires_at)
		VALUES ($1, $2, $3, $4, $5)`, userID, purpose, hash[:], normalizeEmailValue(email), time.Now().UTC().Add(ttl)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func consumeAuthTokenTx(ctx context.Context, tx pgx.Tx, purpose, token string) (uuid.UUID, string, error) {
	token = strings.TrimSpace(token)
	if token == "" || len(token) > 200 {
		return uuid.Nil, "", ErrTokenInvalid
	}
	hash := sha256.Sum256([]byte(token))
	var userID uuid.UUID
	var email string
	err := tx.QueryRow(ctx, `
		UPDATE auth_tokens SET used_at = now()
		WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
		RETURNING user_id, email`, hash[:], purpose).Scan(&userID, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, "", ErrTokenInvalid
	}
	return userID, email, err
}

// ResetPassword redeems a reset token: it sets the new hash, revokes every
// session (MCP keys included) and pending sign-in challenge. Receiving the
// link proves the address, so it also verifies the email.
func (s *Store) ResetPassword(ctx context.Context, token, passwordHash string) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	userID, email, err := consumeAuthTokenTx(ctx, tx, TokenPasswordReset, token)
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE users SET password_hash = $2, updated_at = now(),
			email_verified = email_verified OR lower(email) = lower($3),
			email_verified_at = CASE WHEN lower(email) = lower($3) THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END
		WHERE id = $1`, userID, passwordHash, email); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM auth_challenges WHERE user_id = $1`, userID); err != nil {
		return uuid.Nil, err
	}
	return userID, tx.Commit(ctx)
}

// VerifyEmail redeems a verification token. The link only verifies the
// address it was sent to.
func (s *Store) VerifyEmail(ctx context.Context, token string) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	userID, email, err := consumeAuthTokenTx(ctx, tx, TokenEmailVerify, token)
	if err != nil {
		return uuid.Nil, err
	}
	result, err := tx.Exec(ctx, `
		UPDATE users SET email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, now()),
			updated_at = now(), profile_revision = nextval('server_revision_seq')
		WHERE id = $1 AND lower(email) = lower($2)`, userID, email)
	if err != nil {
		return uuid.Nil, err
	}
	if result.RowsAffected() != 1 {
		return uuid.Nil, ErrTokenInvalid
	}
	return userID, tx.Commit(ctx)
}

// SessionCreatedAt returns when the session behind token signed in.
func (s *Store) SessionCreatedAt(ctx context.Context, token string) (time.Time, error) {
	hash := tokenHash(token)
	var created time.Time
	err := s.pool.QueryRow(ctx, `SELECT created_at FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL`, hash[:]).Scan(&created)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, ErrNotFound
	}
	return created, err
}

// ── Two-factor authentication ──

// TOTPState is the stored 2FA state. Secrets stay sealed here; the API
// opens them with TOTP_ENCRYPTION_KEY.
type TOTPState struct {
	SealedSecret  string
	PendingSecret string
	Enabled       bool
	LastStep      int64
	Failures      int
	LockedUntil   *time.Time
}

func (s *Store) TOTPState(ctx context.Context, userID uuid.UUID) (TOTPState, error) {
	var state TOTPState
	var secret, pending *string
	err := s.pool.QueryRow(ctx, `
		SELECT totp_secret, totp_pending_secret, totp_enabled_at IS NOT NULL, totp_last_step, totp_failed_attempts, totp_locked_until
		FROM users WHERE id = $1`, userID).Scan(&secret, &pending, &state.Enabled, &state.LastStep, &state.Failures, &state.LockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return TOTPState{}, ErrNotFound
	}
	if secret != nil {
		state.SealedSecret = *secret
	}
	if pending != nil {
		state.PendingSecret = *pending
	}
	return state, err
}

// SetPendingTOTP stores a secret that is not active until confirmed.
func (s *Store) SetPendingTOTP(ctx context.Context, userID uuid.UUID, sealed string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET totp_pending_secret = $2 WHERE id = $1`, userID, sealed)
	return err
}

// EnableTOTP activates the pending secret (it must still be the one the
// code was checked against) and replaces the recovery codes.
func (s *Store) EnableTOTP(ctx context.Context, userID uuid.UUID, sealed string, step int64, recoveryHashes [][]byte) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `
		UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = now(),
			totp_last_step = $3, totp_failed_attempts = 0, totp_locked_until = NULL, updated_at = now()
		WHERE id = $1 AND totp_pending_secret = $2 AND totp_enabled_at IS NULL`, userID, sealed, step)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrConflict
	}
	if err := replaceRecoveryCodesTx(ctx, tx, userID, recoveryHashes); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func replaceRecoveryCodesTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, hashes [][]byte) error {
	if _, err := tx.Exec(ctx, `DELETE FROM totp_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return err
	}
	for _, hash := range hashes {
		if _, err := tx.Exec(ctx, `INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, userID, hash); err != nil {
			return err
		}
	}
	return nil
}

// ReplaceRecoveryCodes swaps the recovery codes of an account with 2FA on.
func (s *Store) ReplaceRecoveryCodes(ctx context.Context, userID uuid.UUID, hashes [][]byte) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := replaceRecoveryCodesTx(ctx, tx, userID, hashes); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DisableTOTP turns 2FA off and forgets the secret and recovery codes.
func (s *Store) DisableTOTP(ctx context.Context, userID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL,
			totp_last_step = 0, totp_failed_attempts = 0, totp_locked_until = NULL, updated_at = now()
		WHERE id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM totp_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM auth_challenges WHERE user_id = $1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AcceptTOTPStep records a verified step. The conditional update makes a
// code single-use even when two requests race with the same code.
func (s *Store) AcceptTOTPStep(ctx context.Context, userID uuid.UUID, step int64) (bool, error) {
	result, err := s.pool.Exec(ctx, `
		UPDATE users SET totp_last_step = $2, totp_failed_attempts = 0, totp_locked_until = NULL
		WHERE id = $1 AND totp_last_step < $2`, userID, step)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() == 1, nil
}

// UseRecoveryCode consumes one unused recovery code.
func (s *Store) UseRecoveryCode(ctx context.Context, userID uuid.UUID, hash []byte) (bool, error) {
	result, err := s.pool.Exec(ctx, `
		UPDATE totp_recovery_codes SET used_at = now()
		WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`, userID, hash)
	if err != nil {
		return false, err
	}
	if result.RowsAffected() == 1 {
		_, err = s.pool.Exec(ctx, `UPDATE users SET totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = $1`, userID)
	}
	return result.RowsAffected() == 1, err
}

// RecoveryCodesLeft counts unused recovery codes.
func (s *Store) RecoveryCodesLeft(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM totp_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, userID).Scan(&count)
	return count, err
}

// RecordTOTPFailure counts a wrong code and locks 2FA verification for
// lockFor after maxFailures consecutive failures. It returns the lock end.
func (s *Store) RecordTOTPFailure(ctx context.Context, userID uuid.UUID, maxFailures int, lockFor time.Duration) (*time.Time, error) {
	var locked *time.Time
	err := s.pool.QueryRow(ctx, `
		UPDATE users SET
			totp_failed_attempts = CASE WHEN totp_failed_attempts + 1 >= $2 THEN 0 ELSE totp_failed_attempts + 1 END,
			totp_locked_until = CASE WHEN totp_failed_attempts + 1 >= $2 THEN now() + make_interval(secs => $3) ELSE totp_locked_until END
		WHERE id = $1
		RETURNING totp_locked_until`, userID, maxFailures, lockFor.Seconds()).Scan(&locked)
	return locked, err
}

// ── Sign-in challenges ──

// CreateAuthChallenge stores the hash of a short-lived 2FA sign-in challenge.
func (s *Store) CreateAuthChallenge(ctx context.Context, userID uuid.UUID, token, device, platform string, ttl time.Duration) (time.Time, error) {
	hash := tokenHash(token)
	expires := time.Now().UTC().Add(ttl)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, token_hash, device_name, platform, expires_at)
		VALUES ($1, $2, $3, $4, $5)`, userID, hash[:], device, platform, expires)
	return expires, err
}

// Challenge is a live sign-in challenge.
type Challenge struct {
	ID       uuid.UUID
	UserID   uuid.UUID
	Device   string
	Platform string
}

// ChargeChallenge counts one verification attempt against a live challenge.
// A challenge allows maxAttempts attempts before it stops working.
func (s *Store) ChargeChallenge(ctx context.Context, token string, maxAttempts int) (Challenge, error) {
	hash := tokenHash(strings.TrimSpace(token))
	var challenge Challenge
	err := s.pool.QueryRow(ctx, `
		UPDATE auth_challenges SET attempts = attempts + 1
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2
		RETURNING id, user_id, device_name, platform`, hash[:], maxAttempts).
		Scan(&challenge.ID, &challenge.UserID, &challenge.Device, &challenge.Platform)
	if errors.Is(err, pgx.ErrNoRows) {
		return Challenge{}, ErrTokenInvalid
	}
	return challenge, err
}

// CompleteChallenge marks a challenge used; false when it was already used.
func (s *Store) CompleteChallenge(ctx context.Context, id uuid.UUID) (bool, error) {
	result, err := s.pool.Exec(ctx, `UPDATE auth_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL`, id)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() == 1, nil
}

// UserByID loads the public user record.
func (s *Store) UserByID(ctx context.Context, userID uuid.UUID) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `SELECT id, email, email_verified, display_name, avatar_url FROM users WHERE id = $1`, userID).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

// CleanupAuthArtifacts drops expired emailed tokens and challenges.
func (s *Store) CleanupAuthArtifacts(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day'`); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM auth_challenges WHERE expires_at < now() - interval '1 hour'`)
	return err
}
