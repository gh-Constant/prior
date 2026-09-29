package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// RecordHostedAIUsage adds one Prior AI request and its tokens to the user's
// counters for the given UTC day and purpose.
func (s *Store) RecordHostedAIUsage(ctx context.Context, userID uuid.UUID, day time.Time, purpose string, tokens int64) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO hosted_ai_usage (user_id, day, purpose, requests, tokens)
		VALUES ($1, $2, $3, 1, $4)
		ON CONFLICT (user_id, day, purpose) DO UPDATE
		SET requests = hosted_ai_usage.requests + 1, tokens = hosted_ai_usage.tokens + EXCLUDED.tokens`,
		userID, day.UTC().Format("2006-01-02"), purpose, tokens)
	return err
}

// HostedAITokensSince returns the tokens a user spent on one purpose since the
// given UTC day (inclusive).
func (s *Store) HostedAITokensSince(ctx context.Context, userID uuid.UUID, since time.Time, purpose string) (int64, error) {
	var tokens int64
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(tokens), 0) FROM hosted_ai_usage
		WHERE user_id = $1 AND day >= $2 AND purpose = $3`,
		userID, since.UTC().Format("2006-01-02"), purpose).Scan(&tokens)
	return tokens, err
}
