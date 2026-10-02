package httpapi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A shared project's type and methodology live on the server. The owner's
// change reaches the member who joined through a share link, a stale resend
// of the owner's copy (same updatedAt) cannot downgrade it, a newer edit still
// wins, a row written before the type was synced is filled in, and a member's
// partial PATCH keeps what it does not send.
func TestSharedProjectKindIsServerAuthoritativePostgres(t *testing.T) {
	url := os.Getenv("PRIOR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set PRIOR_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx := context.Background()
	adminPool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer adminPool.Close()
	schema := "kind_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := adminPool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer adminPool.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	poolConfig, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	srv := New(config.Config{}, pool)
	handler := srv.Handler()
	newUser := func(email string) string {
		user, err := srv.store.CreatePasswordUser(ctx, email, "x", strings.Split(email, "@")[0])
		if err != nil {
			t.Fatal(err)
		}
		token := uuid.NewString()
		if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
			t.Fatal(err)
		}
		return token
	}
	call := func(method, path, token, body string) (int, map[string]any) {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		var decoded map[string]any
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
		return response.Code, decoded
	}
	owner := newUser("owner@example.com")
	member := newUser("member@example.com")
	id := uuid.NewString()
	project := func(updatedAt time.Time, kind string) string {
		return `{"areas":[],"folders":[],"notes":[],"projects":[{"id":"` + id + `","areaId":null,"name":"Team","description":"","icon":"folder","status":"active",` + kind + `"createdAt":"` + updatedAt.Format(time.RFC3339Nano) + `","updatedAt":"` + updatedAt.Format(time.RFC3339Nano) + `","deletedAt":null}]}`
	}
	seen := func(token string) (any, any) {
		code, body := call("GET", "/v1/collaboration/projects", token, "")
		if code != 200 {
			t.Fatalf("projects = %d %v", code, body)
		}
		for _, item := range body["projects"].([]any) {
			entry := item.(map[string]any)["project"].(map[string]any)
			if entry["id"] == id {
				return entry["projectType"], entry["methodology"]
			}
		}
		t.Fatalf("project %s not listed: %v", id, body)
		return nil, nil
	}
	sync := func(body string) {
		if code, response := call("POST", "/v1/workspace/sync", owner, body); code != 200 {
			t.Fatalf("workspace sync = %d %v", code, response)
		}
	}
	metadata := func() string {
		var raw string
		if err := pool.QueryRow(ctx, `SELECT metadata::text FROM projects WHERE id = $1`, id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}

	// The owner creates a Standard project and shares a link; the member joins.
	created := time.Now().UTC().Add(-time.Hour).Truncate(time.Millisecond)
	sync(project(created, `"projectType":"standard",`))
	code, link := call("POST", "/v1/collaboration/projects/"+id+"/share-links", owner, `{"role":"editor"}`)
	if code != 200 {
		t.Fatalf("share link = %d %v", code, link)
	}
	inviteLink := link["inviteLink"].(string)
	token := inviteLink[strings.LastIndex(inviteLink, "/")+1:]
	if code, body := call("POST", "/v1/collaboration/invites/accept", member, `{"token":"`+token+`"}`); code != 200 || body["result"] != "joined" {
		t.Fatalf("join = %d %v", code, body)
	}
	if kind, _ := seen(member); kind != "standard" {
		t.Fatalf("member sees %v before the switch", kind)
	}

	// The owner switches to Scrum through the shared project PATCH.
	if code, body := call("PATCH", "/v1/collaboration/projects/"+id, owner, `{"projectType":"software","methodology":"scrum"}`); code != 200 {
		t.Fatalf("owner patch = %d %v", code, body)
	}
	if kind, method := seen(member); kind != "software" || method != "scrum" {
		t.Fatalf("member sees %v/%v after the switch, metadata %s", kind, method, metadata())
	}

	// A device that still holds the old copy resends it with the updatedAt
	// it had: it must not downgrade the project for the member.
	var stored time.Time
	if err := pool.QueryRow(ctx, `SELECT updated_at FROM projects WHERE id = $1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	sync(project(stored, `"projectType":"standard",`))
	sync(project(created, `"projectType":"standard",`))
	if kind, method := seen(member); kind != "software" || method != "scrum" {
		t.Fatalf("a stale resend downgraded the project to %v/%v", kind, method)
	}

	// A member's PATCH that only renames keeps the type and methodology.
	if code, body := call("PATCH", "/v1/collaboration/projects/"+id, member, `{"name":"Team 2"}`); code != 200 {
		t.Fatalf("member patch = %d %v", code, body)
	}
	if kind, method := seen(owner); kind != "software" || method != "scrum" {
		t.Fatalf("a rename changed the kind to %v/%v", kind, method)
	}

	// A newer edit from the owner still applies (here: back to Kanban).
	sync(project(time.Now().UTC(), `"projectType":"software","methodology":"kanban",`))
	if kind, method := seen(member); kind != "software" || method != "kanban" {
		t.Fatalf("the owner's newer edit was lost: %v/%v", kind, method)
	}

	// A shared row saved before the type was synced is filled in by the
	// owner's resend, never left as "standard" for the members.
	if _, err := pool.Exec(ctx, `UPDATE projects SET metadata = '{}'::jsonb WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT updated_at FROM projects WHERE id = $1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	sync(project(stored, `"projectType":"software","methodology":"scrum",`))
	if kind, method := seen(member); kind != "software" || method != "scrum" {
		t.Fatalf("the missing type was not filled in: %v/%v (%s)", kind, method, metadata())
	}
}
