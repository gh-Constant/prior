package httpapi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/billing"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Several assignees per task: every id is validated against the project, the
// legacy assigneeId follows the first one, older clients that only know
// assigneeId never wipe the other assignees, and a deleted account leaves the
// lists.
func TestSeveralAssigneesPostgres(t *testing.T) {
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
	schema := "assignees_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	newUser := func(email string) (string, string) {
		user, err := srv.store.CreatePasswordUser(ctx, email, "x", strings.Split(email, "@")[0])
		if err != nil {
			t.Fatal(err)
		}
		token := uuid.NewString()
		if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
			t.Fatal(err)
		}
		return token, user.ID.String()
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
	alice, aliceID := newUser("alice@example.com")
	bob, bobID := newUser("bob@example.com")
	carol, carolID := newUser("carol@example.com")
	_, daveID := newUser("dave@example.com")

	team := billing.PlanTeam
	if err := srv.store.SetAdminPlan(ctx, uuid.MustParse(aliceID), &team, "test"); err != nil {
		t.Fatal(err)
	}

	projectID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	snapshot := `{"areas":[],"folders":[],"notes":[],"projects":[{"id":"` + projectID + `","areaId":null,"name":"Launch","description":"","icon":"folder","status":"active","projectType":"software","createdAt":"` + now + `","updatedAt":"` + now + `","deletedAt":null}]}`
	if code, body := call("POST", "/v1/workspace/sync", alice, snapshot); code != 200 {
		t.Fatalf("workspace sync = %d %v", code, body)
	}
	for email, token := range map[string]string{"bob@example.com": bob, "carol@example.com": carol} {
		_, shared := call("POST", "/v1/collaboration/projects/"+projectID+"/members", alice, `{"email":"`+email+`","role":"editor"}`)
		link := shared["inviteLink"].(string)
		if code, _ := call("POST", "/v1/collaboration/invites/accept", token, `{"token":"`+link[strings.LastIndex(link, "/")+1:]+`"}`); code != 200 {
			t.Fatalf("%s accept = %d", email, code)
		}
	}

	push := func(token, task string) map[string]any {
		code, body := call("POST", "/v1/sync/push", token, `{"mutations":[{"id":"`+uuid.NewString()+`","kind":"upsert","entity":"task","task":`+task+`,"createdAt":"`+now+`"}]}`)
		if code != 200 {
			t.Fatalf("push = %d %v", code, body)
		}
		return body["results"].([]any)[0].(map[string]any)
	}
	task := func(id, extra string) string {
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		return `{"id":"` + id + `","title":"Ship","description":"","priority":4,"projectId":"` + projectID + `","status":"next","assigneeName":"","completed":false,"important":false,"urgent":false,"createdAt":"` + now + `","updatedAt":"` + stamp + `","deletedAt":null` + extra + `}`
	}
	stored := func(id string) (*string, []string) {
		var legacy *string
		var raw []byte
		if err := pool.QueryRow(ctx, `SELECT assignee_id::text, assignee_ids FROM tasks WHERE id = $1`, id).Scan(&legacy, &raw); err != nil {
			t.Fatal(err)
		}
		var ids []string
		if err := json.Unmarshal(raw, &ids); err != nil {
			t.Fatal(err)
		}
		return legacy, ids
	}
	expect := func(id string, want ...string) {
		t.Helper()
		legacy, ids := stored(id)
		if !reflect.DeepEqual(ids, append([]string{}, want...)) {
			t.Fatalf("assignee_ids = %v, want %v", ids, want)
		}
		if len(want) == 0 && legacy != nil || len(want) > 0 && (legacy == nil || *legacy != want[0]) {
			t.Fatalf("assignee_id = %v, want first of %v", legacy, want)
		}
	}

	taskID := uuid.NewString()
	// Every id must be a member: dave is not, so the whole task is refused.
	if result := push(alice, task(taskID, `,"assigneeIds":["`+bobID+`","`+daveID+`"]`)); result["ok"] == true {
		t.Fatalf("a non-member among the assignees must be refused: %v", result)
	}
	if result := push(alice, task(taskID, `,"assigneeIds":["`+bobID+`","`+carolID+`","`+aliceID+`","`+bobID+`"]`)); result["ok"] != true {
		t.Fatalf("assign three members = %v", result)
	}
	expect(taskID, bobID, carolID, aliceID)

	// An older client omits both fields: the list stays.
	if result := push(bob, task(taskID, "")); result["ok"] != true {
		t.Fatalf("old client push = %v", result)
	}
	expect(taskID, bobID, carolID, aliceID)
	// An older client re-sends the same first assignee: nothing is wiped.
	if result := push(bob, task(taskID, `,"assigneeId":"`+bobID+`"`)); result["ok"] != true {
		t.Fatalf("old client push = %v", result)
	}
	expect(taskID, bobID, carolID, aliceID)
	// An older client picks someone else: the list becomes that one person.
	if result := push(bob, task(taskID, `,"assigneeId":"`+carolID+`"`)); result["ok"] != true {
		t.Fatalf("old client push = %v", result)
	}
	expect(taskID, carolID)
	// ...and one that unassigns clears everybody.
	push(alice, task(taskID, `,"assigneeIds":["`+bobID+`","`+carolID+`"]`))
	if result := push(bob, task(taskID, `,"assigneeId":null`)); result["ok"] != true {
		t.Fatalf("old client push = %v", result)
	}
	expect(taskID)
	// A new client clears with [] or null.
	push(alice, task(taskID, `,"assigneeIds":["`+bobID+`"]`))
	push(alice, task(taskID, `,"assigneeIds":[]`))
	expect(taskID)
	push(alice, task(taskID, `,"assigneeIds":["`+bobID+`"]`))
	push(alice, task(taskID, `,"assigneeIds":null`))
	expect(taskID)
	// More than ten assignees are refused.
	many := make([]string, 0, 11)
	for index := 0; index < 11; index++ {
		many = append(many, `"`+uuid.NewString()+`"`)
	}
	if result := push(alice, task(taskID, `,"assigneeIds":[`+strings.Join(many, ",")+`]`)); result["ok"] == true {
		t.Fatalf("eleven assignees must be refused: %v", result)
	}

	// Pull (change log) carries the list, and so does a private task for its owner only.
	push(alice, task(taskID, `,"assigneeIds":["`+carolID+`","`+bobID+`"]`))
	code, pulled := call("GET", "/v1/sync/pull?since=0", bob, "")
	if code != 200 {
		t.Fatalf("pull = %d", code)
	}
	var latest map[string]any
	for _, raw := range pulled["tasks"].([]any) {
		if item := raw.(map[string]any); item["id"] == taskID {
			latest = item
		}
	}
	if latest == nil || !reflect.DeepEqual(latest["assigneeIds"], []any{carolID, bobID}) || latest["assigneeId"] != carolID {
		t.Fatalf("pulled task = %v", latest)
	}
	privateID := uuid.NewString()
	privateTask := strings.Replace(task(privateID, `,"assigneeIds":["`+aliceID+`","`+bobID+`"]`), `"projectId":"`+projectID+`"`, `"projectId":null`, 1)
	if result := push(alice, privateTask); result["ok"] == true {
		t.Fatalf("a private task can only be assigned to its owner: %v", result)
	}

	// The migration backfill turns the legacy column into a list (idempotent).
	legacyID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO tasks (id, user_id, title, project_id, assignee_id, assignee_ids, created_at, updated_at, revision) VALUES ($1, $2, 'old', $3, $4, '[]'::jsonb, now(), now(), 0)`, legacyID, aliceID, projectID, bobID); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../database/migrations/037_task_assignees.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	expect(legacyID, bobID)

	// A deleted account leaves the lists; the legacy column follows the new first assignee.
	bobUUID := uuid.MustParse(bobID)
	if _, err := srv.store.DeleteAccount(ctx, bobUUID); err != nil {
		t.Fatal(err)
	}
	expect(taskID, carolID)
	expect(legacyID)
}
