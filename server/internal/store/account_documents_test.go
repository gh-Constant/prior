package store

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDocumentValidation(t *testing.T) {
	for _, patch := range []string{`[]`, `42`, `"string"`, `{`, ""} {
		if ValidateDocumentMutations([]DocumentMutation{{ID: uuid.NewString(), Key: "calendar/event/test", Patch: json.RawMessage(patch)}}) == nil {
			t.Fatalf("accepted %q", patch)
		}
	}
	for _, key := range []string{"private/keys", "", strings.Repeat("a", 2049)} {
		if ValidateDocumentMutations([]DocumentMutation{{ID: uuid.NewString(), Key: key, Patch: json.RawMessage(`{}`)}}) == nil {
			t.Fatalf("accepted key %q", key)
		}
	}
}

// Explicit opt-in database: every test runs in a fresh schema and removes only
// that schema. It never resets an existing application's tables.
func TestAccountSyncPostgres(t *testing.T) {
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
	schema := "sync_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for range 2 {
		if err = database.Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	s := New(pool)
	a, err := s.CreatePasswordUser(ctx, "a@sync.test", "hash", "A")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.CreatePasswordUser(ctx, "b@sync.test", "hash", "B")
	if err != nil {
		t.Fatal(err)
	}
	mutation := func(key, patch string) DocumentMutation {
		return DocumentMutation{ID: uuid.NewString(), Key: key, Patch: json.RawMessage(patch)}
	}
	sync := func(user uuid.UUID, mutations ...DocumentMutation) DocumentSyncResult {
		t.Helper()
		r, e := s.SyncAccountDocuments(ctx, user, mutations)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	initial := mutation("calendar/event/a/e", `{"title":"Course","color":"blue"}`)
	if !sync(a.ID, initial).Changed {
		t.Fatal("initial mutation did not change data")
	}
	if sync(a.ID, initial).Changed {
		t.Fatal("retry must be idempotent")
	}
	sync(a.ID, mutation(initial.Key, `{"title":"Math"}`))
	r := sync(a.ID, mutation(initial.Key, `{"color":"green","locked":true}`))
	var value map[string]any
	if err = json.Unmarshal(r.Records[0].Value, &value); err != nil {
		t.Fatal(err)
	}
	if value["title"] != "Math" || value["color"] != "green" || value["locked"] != true {
		t.Fatalf("lost independent edit: %v", value)
	}
	if len(sync(b.ID).Records) != 0 {
		t.Fatal("cross-account data leak")
	}
	seed := mutation(initial.Key, `{"title":"old offline copy"}`)
	seed.Seed = true
	if sync(a.ID, seed).Changed {
		t.Fatal("migration overwrote existing data")
	}
	sync(a.ID, mutation(initial.Key, `null`))
	if sync(a.ID, mutation(initial.Key, `{"title":"stale"}`)).Changed {
		t.Fatal("offline edit resurrected deletion")
	}
	seed.ID = uuid.NewString()
	if sync(a.ID, seed).Changed {
		t.Fatal("migration resurrected deletion")
	}
	if string(sync(a.ID).Records[0].Value) != "null" {
		t.Fatal("missing tombstone")
	}
	attachment := uuid.New()
	if err = s.SaveNoteAttachment(ctx, a.ID, attachment, "course.txt", "text/plain", []byte("notes")); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveNoteAttachment(ctx, a.ID, attachment, "wrong.txt", "text/plain", []byte("retry")); err != nil {
		t.Fatal(err)
	}
	name, _, content, err := s.LoadNoteAttachment(ctx, a.ID, attachment)
	if err != nil || name != "course.txt" || string(content) != "notes" {
		t.Fatalf("attachment roundtrip: %s %s %v", name, content, err)
	}
	if _, _, _, err = s.LoadNoteAttachment(ctx, b.ID, attachment); err == nil {
		t.Fatal("cross-account attachment leak")
	}
	files, err := s.ListNoteAttachments(ctx, a.ID)
	if err != nil || len(files) != 1 || files[0].Size != 5 {
		t.Fatalf("metadata: %v %v", files, err)
	}
	chatID := uuid.New()
	first, err := s.CreateAgentChat(ctx, a.ID, "Draft", chatID)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.CreateAgentChat(ctx, a.ID, "Draft", chatID)
	if err != nil || first.ID != retry.ID {
		t.Fatalf("chat retry: %v", err)
	}
	if _, err = s.CreateAgentChat(ctx, b.ID, "Foreign", chatID); err == nil {
		t.Fatal("cross-account chat reuse")
	}
}
