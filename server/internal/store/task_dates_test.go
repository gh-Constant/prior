package store

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL DATE columns must be returned as ISO strings for the task API.
func TestPullTaskWithScheduledDatesPostgres(t *testing.T) {
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
	schema := "dates_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	user, err := s.CreatePasswordUser(ctx, "dates@sync.test", "hash", "Dates")
	if err != nil {
		t.Fatal(err)
	}
	strptr := func(value string) *string { return &value }
	task := tasks.Task{
		ID: uuid.NewString(), Title: "dated task", Priority: 4, Status: "next",
		ScheduledDate: strptr("2026-09-20"), FollowUpDate: strptr("2026-09-27"),
	}
	results, err := s.Push(ctx, user.ID, []tasks.Mutation{{ID: uuid.NewString(), Kind: "upsert", Task: task}})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || !results[0].OK {
		t.Fatalf("task push failed: %+v", results)
	}
	pulled, err := s.Pull(ctx, user.ID, 0)
	if err != nil {
		t.Fatalf("pull with DATE columns set failed: %v", err)
	}
	if len(pulled.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(pulled.Tasks))
	}
	got := pulled.Tasks[0]
	if got.ScheduledDate == nil || *got.ScheduledDate != "2026-09-20" {
		t.Fatalf("scheduledDate = %v, want 2026-09-20", got.ScheduledDate)
	}
	if got.FollowUpDate == nil || *got.FollowUpDate != "2026-09-27" {
		t.Fatalf("followUpDate = %v, want 2026-09-27", got.FollowUpDate)
	}
}
