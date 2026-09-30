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

// Assignee, parent and relations on shared tasks: validated against the
// project, kept when an older client omits them, and counted in activity.
func TestIssueFieldsPostgres(t *testing.T) {
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
	schema := "issue_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	_, carolID := newUser("carol@example.com")

	projectID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	snapshot := `{"areas":[],"folders":[],"notes":[],"projects":[{"id":"` + projectID + `","areaId":null,"name":"Launch","description":"","icon":"folder","status":"active","projectType":"software","milestones":[{"id":"m1","name":"Beta"}],"createdAt":"` + now + `","updatedAt":"` + now + `","deletedAt":null}]}`
	if code, body := call("POST", "/v1/workspace/sync", alice, snapshot); code != 200 {
		t.Fatalf("workspace sync = %d %v", code, body)
	}
	_, shared := call("POST", "/v1/collaboration/projects/"+projectID+"/members", alice, `{"email":"bob@example.com","role":"editor"}`)
	link := shared["inviteLink"].(string)
	if code, _ := call("POST", "/v1/collaboration/invites/accept", bob, `{"token":"`+link[strings.LastIndex(link, "/")+1:]+`"}`); code != 200 {
		t.Fatalf("bob accept = %d", code)
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
	parentID, childID := uuid.NewString(), uuid.NewString()
	if result := push(alice, task(parentID, `,"assigneeId":"`+bobID+`","milestoneId":"m1"`)); result["ok"] != true {
		t.Fatalf("assign a member = %v", result)
	}
	if result := push(alice, task(childID, `,"assigneeId":"`+carolID+`"`)); result["ok"] == true {
		t.Fatalf("carol is not a member and cannot be assigned: %v", result)
	}
	if result := push(bob, task(childID, `,"parentId":"`+parentID+`","relations":[{"type":"blocked_by","taskId":"`+parentID+`"}]`)); result["ok"] != true {
		t.Fatalf("sub-issue = %v", result)
	}
	if result := push(alice, task(parentID, `,"assigneeId":"`+bobID+`","parentId":"`+childID+`"`)); result["ok"] == true {
		t.Fatalf("a parent cycle must be rejected: %v", result)
	}
	// An older client (no issue fields) completes the parent: fields stay.
	oldClient := strings.Replace(task(parentID, ""), `"completed":false`, `"completed":true`, 1)
	oldClient = strings.Replace(oldClient, `"status":"next"`, `"status":"done"`, 1)
	if result := push(bob, oldClient); result["ok"] != true {
		t.Fatalf("old client push = %v", result)
	}
	var assignee, milestone *string
	if err := pool.QueryRow(ctx, `SELECT assignee_id::text, milestone_id FROM tasks WHERE id = $1`, parentID).Scan(&assignee, &milestone); err != nil {
		t.Fatal(err)
	}
	if assignee == nil || *assignee != bobID || milestone == nil || *milestone != "m1" {
		t.Fatalf("older client erased issue fields: %v %v", assignee, milestone)
	}
	code, pulled := call("GET", "/v1/sync/pull?since=0", alice, "")
	if code != 200 {
		t.Fatalf("pull = %d", code)
	}
	found := false
	for _, raw := range pulled["tasks"].([]any) {
		item := raw.(map[string]any)
		if item["id"] == childID && item["parentId"] == parentID {
			relations := item["relations"].([]any)
			found = len(relations) == 1 && relations[0].(map[string]any)["type"] == "blocked_by"
		}
	}
	if !found {
		t.Fatalf("pull lacks the sub-issue fields: %v", pulled["tasks"])
	}

	code, activity := call("GET", "/v1/collaboration/projects/"+projectID+"/activity?tz=Europe/Paris", alice, "")
	if code != 200 {
		t.Fatalf("activity = %d %v", code, activity)
	}
	completedByBob, created := 0, 0
	for _, raw := range activity["entries"].([]any) {
		entry := raw.(map[string]any)
		created += int(entry["created"].(float64))
		if entry["userId"] == bobID {
			completedByBob += int(entry["completed"].(float64))
		}
	}
	if completedByBob != 1 || created != 2 {
		t.Fatalf("activity entries = %v", activity["entries"])
	}
	outsider, _ := newUser("dave@example.com")
	if code, _ := call("GET", "/v1/collaboration/projects/"+projectID+"/activity", outsider, ""); code != 404 {
		t.Fatalf("outsider activity = %d", code)
	}
	_ = aliceID
}
