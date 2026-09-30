package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/google/uuid"
)

func TestTaskCommentsPostgres(t *testing.T) {
	srv, pool, _ := newIntegrationServer(t, config.Config{})
	call := callerFor(srv)
	ctx := context.Background()
	register := func(email string) (string, uuid.UUID) {
		code, body := call("POST", "/v1/auth/register", "", `{"email":"`+email+`","password":"correct horse","displayName":"`+strings.Split(email, "@")[0]+`"}`)
		if code != 201 {
			t.Fatalf("register %s = %d %v", email, code, body)
		}
		token := body["token"].(string)
		return token, mustUserID(t, srv, token)
	}
	alice, aliceID := register("alice@example.com")
	bob, bobID := register("bob@example.com")
	carol, carolID := register("carol@example.com")
	dave, daveID := register("dave@example.com")

	projectID := uuid.New()
	now := time.Now().UTC()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES ($1, $2, 'Launch', $3, $3)`, projectID, aliceID, now)
	exec(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`, projectID, aliceID, bobID, carolID)
	taskID := uuid.NewString()
	stamp := now.Format(time.RFC3339Nano)
	push := `{"mutations":[{"id":"` + uuid.NewString() + `","kind":"upsert","entity":"task","createdAt":"` + stamp + `","task":{"id":"` + taskID + `","title":"Ship it","description":"","priority":4,"status":"next","projectId":"` + projectID.String() + `","important":false,"urgent":false,"completed":false,"createdAt":"` + stamp + `","updatedAt":"` + stamp + `","deletedAt":null}}]}`
	if code, body := call("POST", "/v1/sync/push", alice, push); code != 200 {
		t.Fatalf("push = %d %v", code, body)
	}
	path := "/v1/collaboration/projects/" + projectID.String() + "/tasks/" + taskID + "/comments"

	if code, _ := call("GET", path, dave, ""); code != 404 {
		t.Fatalf("outsider read = %d", code)
	}
	if code, _ := call("GET", "/v1/collaboration/projects/"+projectID.String()+"/tasks/"+uuid.NewString()+"/comments", alice, ""); code != 404 {
		t.Fatalf("task outside the project = %d", code)
	}
	if code, body := call("GET", path, carol, ""); code != 200 || len(body["comments"].([]any)) != 0 {
		t.Fatalf("viewer read = %d %v", code, body)
	}
	if code, _ := call("POST", path, carol, `{"body":"hi"}`); code != 403 {
		t.Fatalf("viewer post = %d", code)
	}
	if code, _ := call("POST", path, bob, `{"body":"   "}`); code != 400 {
		t.Fatalf("empty comment = %d", code)
	}
	commentID := uuid.NewString()
	mentions := `["` + aliceID.String() + `","` + daveID.String() + `","` + bobID.String() + `","not-a-uuid"]`
	code, created := call("POST", path, bob, `{"id":"`+commentID+`","body":"@alice please review https://example.com","mentions":`+mentions+`}`)
	if code != 201 || created["id"] != commentID {
		t.Fatalf("post = %d %v", code, created)
	}
	if got := created["mentions"].([]any); len(got) != 1 || got[0] != aliceID.String() {
		t.Fatalf("mentions must be project members other than the author: %v", got)
	}
	if author := created["author"].(map[string]any); author["displayName"] != "bob" {
		t.Fatalf("author = %v", author)
	}
	// A retried post with the same id does not duplicate.
	if code, _ := call("POST", path, bob, `{"id":"`+commentID+`","body":"@alice please review https://example.com","mentions":`+mentions+`}`); code != 201 {
		t.Fatalf("retry = %d", code)
	}
	if code, _ := call("POST", path, alice, `{"id":"`+commentID+`","body":"hijack"}`); code != 403 {
		t.Fatalf("reusing someone else's id = %d", code)
	}
	code, list := call("GET", "/v1/collaboration/mentions", alice, "")
	if code != 200 || list["unread"] != float64(1) || len(list["mentions"].([]any)) != 1 {
		t.Fatalf("alice mentions = %d %v", code, list)
	}
	mention := list["mentions"].([]any)[0].(map[string]any)
	if mention["taskTitle"] != "Ship it" || mention["projectName"] != "Launch" || mention["authorName"] != "bob" {
		t.Fatalf("mention = %v", mention)
	}
	if _, list := call("GET", "/v1/collaboration/mentions", dave, ""); list["unread"] != float64(0) {
		t.Fatalf("outsiders are never mentioned: %v", list)
	}
	if code, _ := call("POST", "/v1/collaboration/mentions/read", alice, `{"commentIds":["`+commentID+`"]}`); code != 204 {
		t.Fatalf("read = %d", code)
	}
	if _, list := call("GET", "/v1/collaboration/mentions", alice, ""); list["unread"] != float64(0) {
		t.Fatalf("after read = %v", list)
	}

	commentPath := path + "/" + commentID
	if code, _ := call("PATCH", commentPath, alice, `{"body":"edited by owner"}`); code != 403 {
		t.Fatalf("only the author edits: %d", code)
	}
	code, edited := call("PATCH", commentPath, bob, `{"body":"@alice @carol please review","mentions":["`+aliceID.String()+`","`+carolID.String()+`"]}`)
	if code != 200 || edited["editedAt"] == nil || len(edited["mentions"].([]any)) != 2 {
		t.Fatalf("edit = %d %v", code, edited)
	}
	if _, list := call("GET", "/v1/collaboration/mentions", carol, ""); list["unread"] != float64(1) {
		t.Fatalf("newly mentioned carol = %v", list)
	}
	// Reading the thread marks carol's mention read.
	call("GET", path, carol, "")
	if _, list := call("GET", "/v1/collaboration/mentions", carol, ""); list["unread"] != float64(0) {
		t.Fatalf("reading the thread = %v", list)
	}
	if code, _ := call("DELETE", commentPath, carol, ""); code != 403 {
		t.Fatalf("viewer delete = %d", code)
	}
	code, second := call("POST", path, alice, `{"body":"owner note"}`)
	if code != 201 {
		t.Fatalf("owner post = %d %v", code, second)
	}
	if code, _ := call("DELETE", path+"/"+second["id"].(string), bob, ""); code != 403 {
		t.Fatalf("editor deleting the owner's comment = %d", code)
	}
	if code, _ := call("DELETE", commentPath, alice, ""); code != 204 {
		t.Fatalf("owner deletes any comment = %d", code)
	}
	_, remaining := call("GET", path, bob, "")
	if items := remaining["comments"].([]any); len(items) != 1 || items[0].(map[string]any)["body"] != "owner note" {
		t.Fatalf("remaining = %v", remaining)
	}

	// Deleting an account keeps its comments as "Deleted user".
	code, third := call("POST", path, bob, `{"body":"last words"}`)
	if code != 201 {
		t.Fatalf("bob post = %d", code)
	}
	export, err := srv.store.ExportAccount(ctx, bobID)
	if err != nil {
		t.Fatal(err)
	}
	if len(export.Comments) != 1 || export.Comments[0].Body != "last words" {
		t.Fatalf("exported comments = %+v", export.Comments)
	}
	if code, body := call("DELETE", "/v1/me", bob, `{"email":"bob@example.com","password":"correct horse"}`); code != 204 {
		t.Fatalf("delete bob = %d %v", code, body)
	}
	_, after := call("GET", path, alice, "")
	found := false
	for _, item := range after["comments"].([]any) {
		comment := item.(map[string]any)
		if comment["id"] == third["id"] {
			found = true
			if comment["author"] != nil || comment["body"] != "last words" {
				t.Fatalf("anonymized comment = %v", comment)
			}
		}
	}
	if !found {
		t.Fatal("the deleted user's comment must stay in the thread")
	}
}
