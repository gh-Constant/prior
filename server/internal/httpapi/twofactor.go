package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/gh-Constant/prior/server/internal/totp"
	"github.com/google/uuid"
)

// Two-factor authentication (TOTP, RFC 6238). See specs/AUTH.md.

const (
	recoveryCodeCount = 10
	// A challenge allows this many codes before the user must sign in again.
	challengeAttempts = 5
	// Consecutive wrong codes before verification locks for a while.
	twoFactorMaxFailures = 10
	twoFactorLockout     = 15 * time.Minute
)

var errTOTPKeyMissing = errors.New("two-factor authentication is not available on this server")

func (s *Server) totpKeyReady() bool {
	_, err := settingsSealingKey(s.cfg.TOTPEncryptionKey)
	return err == nil
}

func (s *Server) sealTOTP(secret string) (string, error) {
	if !s.totpKeyReady() {
		return "", errTOTPKeyMissing
	}
	return sealSettingsValue(s.cfg.TOTPEncryptionKey, secret)
}

func (s *Server) openTOTP(sealed string) (string, error) {
	if !s.totpKeyReady() {
		return "", errTOTPKeyMissing
	}
	if !strings.HasPrefix(sealed, settingsSealPrefix) {
		return "", errors.New("two-factor secret is not sealed")
	}
	return openSettingsValue(s.cfg.TOTPEncryptionKey, sealed)
}

// normalizeRecoveryCode ignores case, spaces and dashes.
func normalizeRecoveryCode(code string) string {
	return strings.ToLower(strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(code)))
}

func recoveryCodeHash(code string) []byte {
	sum := sha256.Sum256([]byte(normalizeRecoveryCode(code)))
	return sum[:]
}

func newRecoveryCodes() ([]string, [][]byte, error) {
	codes := make([]string, 0, recoveryCodeCount)
	hashes := make([][]byte, 0, recoveryCodeCount)
	encoder := base32.StdEncoding.WithPadding(base32.NoPadding)
	for len(codes) < recoveryCodeCount {
		raw, err := randomBytes(7)
		if err != nil {
			return nil, nil, err
		}
		value := strings.ToLower(encoder.EncodeToString(raw))[:10]
		code := value[:5] + "-" + value[5:]
		codes = append(codes, code)
		hashes = append(hashes, recoveryCodeHash(code))
	}
	return codes, hashes, nil
}

func randomBytes(size int) ([]byte, error) {
	raw := make([]byte, size)
	_, err := rand.Read(raw)
	return raw, err
}

// checkSecondFactor verifies a TOTP code or a recovery code, with replay
// protection and lockout. It writes the error response when it fails.
func (s *Server) checkSecondFactor(w http.ResponseWriter, r *http.Request, userID uuid.UUID, code, recoveryCode string) bool {
	state, err := s.store.TOTPState(r.Context(), userID)
	if err != nil || !state.Enabled {
		writeCode(w, http.StatusBadRequest, "TWO_FACTOR_DISABLED", "two-factor authentication is not on")
		return false
	}
	now := s.now()
	if state.LockedUntil != nil && state.LockedUntil.After(now) {
		retry := int(state.LockedUntil.Sub(now).Seconds()) + 1
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		writeCode(w, http.StatusTooManyRequests, "TWO_FACTOR_LOCKED", "too many wrong codes, try again later")
		return false
	}
	ok := false
	if strings.TrimSpace(recoveryCode) != "" {
		ok, err = s.store.UseRecoveryCode(r.Context(), userID, recoveryCodeHash(recoveryCode))
	} else if strings.TrimSpace(code) != "" {
		secret, openErr := s.openTOTP(state.SealedSecret)
		if openErr != nil {
			writeError(w, http.StatusServiceUnavailable, errTOTPKeyMissing)
			return false
		}
		if step, matched := totp.Verify(secret, code, now, state.LastStep); matched {
			ok, err = s.store.AcceptTOTPStep(r.Context(), userID, step)
		}
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to check the code"))
		return false
	}
	if !ok {
		locked, _ := s.store.RecordTOTPFailure(r.Context(), userID, twoFactorMaxFailures, twoFactorLockout)
		if locked != nil && locked.After(now) {
			w.Header().Set("Retry-After", strconv.Itoa(int(twoFactorLockout.Seconds())))
			writeCode(w, http.StatusTooManyRequests, "TWO_FACTOR_LOCKED", "too many wrong codes, try again later")
			return false
		}
		writeCode(w, http.StatusBadRequest, "INVALID_CODE", "this code is not valid")
		return false
	}
	return true
}

func (s *Server) twoFactorStatus(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	state, err := s.store.TOTPState(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to read two-factor status"))
		return
	}
	left := 0
	if state.Enabled {
		left, _ = s.store.RecoveryCodesLeft(r.Context(), user.ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": state.Enabled, "available": s.totpKeyReady(), "recoveryCodesLeft": left})
}

func (s *Server) twoFactorSetup(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.accountLimiter, "account") {
		return
	}
	if !s.totpKeyReady() {
		writeCode(w, http.StatusServiceUnavailable, "TWO_FACTOR_UNAVAILABLE", errTOTPKeyMissing.Error())
		return
	}
	state, err := s.store.TOTPState(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to start two-factor setup"))
		return
	}
	if state.Enabled {
		writeCode(w, http.StatusConflict, "TWO_FACTOR_ENABLED", "two-factor authentication is already on")
		return
	}
	secret, err := totp.NewSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to start two-factor setup"))
		return
	}
	sealed, err := s.sealTOTP(secret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to start two-factor setup"))
		return
	}
	if err := s.store.SetPendingTOTP(r.Context(), user.ID, sealed); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to start two-factor setup"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"secret": secret, "otpauthUrl": totp.URI("Prior", user.Email, secret)})
}

func (s *Server) twoFactorEnable(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.accountLimiter, "account") {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.Code == "" {
		writeError(w, http.StatusBadRequest, errors.New("code is required"))
		return
	}
	if !s.totpKeyReady() {
		writeCode(w, http.StatusServiceUnavailable, "TWO_FACTOR_UNAVAILABLE", errTOTPKeyMissing.Error())
		return
	}
	state, err := s.store.TOTPState(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to enable two-factor authentication"))
		return
	}
	if state.Enabled {
		writeCode(w, http.StatusConflict, "TWO_FACTOR_ENABLED", "two-factor authentication is already on")
		return
	}
	if state.PendingSecret == "" {
		writeCode(w, http.StatusBadRequest, "TWO_FACTOR_NOT_STARTED", "start the setup again")
		return
	}
	secret, err := s.openTOTP(state.PendingSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to enable two-factor authentication"))
		return
	}
	step, ok := totp.Verify(secret, body.Code, s.now(), 0)
	if !ok {
		writeCode(w, http.StatusBadRequest, "INVALID_CODE", "this code is not valid")
		return
	}
	codes, hashes, err := newRecoveryCodes()
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to enable two-factor authentication"))
		return
	}
	if err := s.store.EnableTOTP(r.Context(), user.ID, state.PendingSecret, step, hashes); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeCode(w, http.StatusConflict, "TWO_FACTOR_NOT_STARTED", "start the setup again")
			return
		}
		writeError(w, http.StatusInternalServerError, errors.New("unable to enable two-factor authentication"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes})
}

func (s *Server) twoFactorDisable(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.accountLimiter, "account") {
		return
	}
	var body struct {
		Password     string `json:"password"`
		Code         string `json:"code"`
		RecoveryCode string `json:"recoveryCode"`
	}
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid request"))
		return
	}
	state, err := s.store.TOTPState(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to disable two-factor authentication"))
		return
	}
	if !state.Enabled {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !s.reauthenticate(w, r, user, body.Password, body.Code, body.RecoveryCode) {
		return
	}
	if err := s.store.DisableTOTP(r.Context(), user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to disable two-factor authentication"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// twoFactorRecoveryCodes replaces the recovery codes (a current TOTP code is
// required, so a stolen session alone cannot mint new ones).
func (s *Server) twoFactorRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.accountLimiter, "account") {
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.Code == "" {
		writeError(w, http.StatusBadRequest, errors.New("code is required"))
		return
	}
	if !s.checkSecondFactor(w, r, user.ID, body.Code, "") {
		return
	}
	codes, hashes, err := newRecoveryCodes()
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to create recovery codes"))
		return
	}
	if err := s.store.ReplaceRecoveryCodes(r.Context(), user.ID, hashes); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to create recovery codes"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes})
}

// twoFactorVerify turns a sign-in challenge plus a code into a session.
func (s *Server) twoFactorVerify(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		Challenge    string `json:"challenge"`
		Code         string `json:"code"`
		RecoveryCode string `json:"recoveryCode"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.Challenge == "" || (body.Code == "" && body.RecoveryCode == "") {
		writeError(w, http.StatusBadRequest, errors.New("challenge and code are required"))
		return
	}
	challenge, err := s.store.ChargeChallenge(r.Context(), body.Challenge, challengeAttempts)
	if errors.Is(err, store.ErrTokenInvalid) {
		writeCode(w, http.StatusBadRequest, "CHALLENGE_EXPIRED", "sign in again")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to sign in"))
		return
	}
	if !s.checkSecondFactor(w, r, challenge.UserID, body.Code, body.RecoveryCode) {
		return
	}
	if done, err := s.store.CompleteChallenge(r.Context(), challenge.ID); err != nil || !done {
		writeCode(w, http.StatusBadRequest, "CHALLENGE_EXPIRED", "sign in again")
		return
	}
	user, err := s.store.UserByID(r.Context(), challenge.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to sign in"))
		return
	}
	token, err := s.auth.CreateSession(r.Context(), user, challenge.Device, challenge.Platform)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to sign in"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": s.meView(r.Context(), user)})
}
