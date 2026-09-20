package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// CalendarAccount is a connected read-only calendar provider. The refresh
// token is sealed by the HTTP layer and is only opened server-side to mint a
// short-lived Google access token.
type CalendarAccount struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	Provider     string
	Email        string
	RefreshToken string
	Scopes       string
	ConnectedAt  time.Time
	UpdatedAt    time.Time
}

func (s *Store) SaveCalendarAccount(ctx context.Context, userID uuid.UUID, provider, email, sealedRefreshToken, scopes string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO calendar_accounts (user_id, provider, email, refresh_token, scopes, connected_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, now(), now())
		ON CONFLICT (user_id, provider, email) DO UPDATE SET
			refresh_token = EXCLUDED.refresh_token,
			scopes = EXCLUDED.scopes,
			updated_at = now()`,
		userID, provider, email, sealedRefreshToken, scopes)
	return err
}

func (s *Store) ListCalendarAccounts(ctx context.Context, userID uuid.UUID) ([]CalendarAccount, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, provider, email, refresh_token, scopes, connected_at, updated_at
		FROM calendar_accounts WHERE user_id = $1 ORDER BY connected_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := []CalendarAccount{}
	for rows.Next() {
		var account CalendarAccount
		if err := rows.Scan(&account.ID, &account.UserID, &account.Provider, &account.Email, &account.RefreshToken, &account.Scopes, &account.ConnectedAt, &account.UpdatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (s *Store) NewestCalendarAccount(ctx context.Context, userID uuid.UUID, provider string) (CalendarAccount, error) {
	var account CalendarAccount
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, provider, email, refresh_token, scopes, connected_at, updated_at
		FROM calendar_accounts WHERE user_id = $1 AND provider = $2
		ORDER BY connected_at DESC LIMIT 1`, userID, provider).
		Scan(&account.ID, &account.UserID, &account.Provider, &account.Email, &account.RefreshToken, &account.Scopes, &account.ConnectedAt, &account.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return CalendarAccount{}, ErrNotFound
	}
	return account, err
}

func (s *Store) GetCalendarAccount(ctx context.Context, userID, id uuid.UUID) (CalendarAccount, error) {
	var account CalendarAccount
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, provider, email, refresh_token, scopes, connected_at, updated_at
		FROM calendar_accounts WHERE user_id = $1 AND id = $2`, userID, id).
		Scan(&account.ID, &account.UserID, &account.Provider, &account.Email, &account.RefreshToken, &account.Scopes, &account.ConnectedAt, &account.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return CalendarAccount{}, ErrNotFound
	}
	return account, err
}

func (s *Store) DeleteCalendarAccount(ctx context.Context, userID, id uuid.UUID) error {
	result, err := s.pool.Exec(ctx, `DELETE FROM calendar_accounts WHERE user_id = $1 AND id = $2`, userID, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
