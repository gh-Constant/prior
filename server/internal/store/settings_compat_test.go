package store

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOlderSettingsClientPreservesRecommendationKeyPostgres(t *testing.T) {
	url := os.Getenv("PRIOR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set PRIOR_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "settings_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	s := New(pool)
	user, err := s.CreatePasswordUser(ctx, "settings@sync.test", "hash", "Settings")
	if err != nil {
		t.Fatal(err)
	}
	recommendationKey := "sealed-key"
	if _, err = s.SaveUserSettings(ctx, user.ID, "main", &recommendationKey, "", false); err != nil {
		t.Fatal(err)
	}
	olderClient, err := s.SaveUserSettings(ctx, user.ID, "main-updated", nil, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if olderClient.RecommendationOpenRouterAPIKey != recommendationKey {
		t.Fatalf("older client erased recommendation key")
	}
	empty := ""
	cleared, err := s.SaveUserSettings(ctx, user.ID, "main-updated", &empty, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if cleared.RecommendationOpenRouterAPIKey != "" {
		t.Fatalf("explicit clear did not remove recommendation key")
	}
}
