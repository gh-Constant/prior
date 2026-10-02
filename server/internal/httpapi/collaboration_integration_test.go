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

func TestProjectSharingPostgres(t *testing.T) {
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
	schema := "share_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	alice := newUser("alice@example.com")
	bob := newUser("bob@example.com")

	projectID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	snapshot := `{"areas":[],"folders":[],"notes":[],"projects":[{"id":"` + projectID + `","areaId":null,"name":"Launch","description":"","icon":"folder","status":"active","createdAt":"` + now + `","updatedAt":"` + now + `","deletedAt":null}]}`
	if code, body := call("POST", "/v1/workspace/sync", alice, snapshot); code != 200 {
		t.Fatalf("workspace sync = %d %v", code, body)
	}
	share := "/v1/collaboration/projects/" + projectID + "/members"
	projectCount := func(token string) int {
		code, body := call("GET", "/v1/collaboration/projects", token, "")
		if code != 200 {
			t.Fatalf("projects = %d %v", code, body)
		}
		return len(body["projects"].([]any))
	}
	incoming := func(token string) []any {
		code, body := call("GET", "/v1/collaboration/invites", token, "")
		if code != 200 {
			t.Fatalf("invites = %d %v", code, body)
		}
		return body["invites"].([]any)
	}

	// Existing accounts get an invite to accept, not a silent membership.
	// The response carries the link to copy and says whether an email left.
	code, shared := call("POST", share, alice, `{"email":"Bob@example.com","role":"editor","language":"fr"}`)
	if code != 200 || shared["invite"] == nil || shared["emailSent"] != true || !strings.Contains(shared["inviteLink"].(string), "/invite/") {
		t.Fatalf("share = %d %v", code, shared)
	}
	if projectCount(bob) != 0 {
		t.Fatal("bob must not join before accepting")
	}
	invites := incoming(bob)
	if len(invites) != 1 {
		t.Fatalf("bob invites = %v", invites)
	}
	invite := invites[0].(map[string]any)
	if invite["projectName"] != "Launch" || invite["inviterName"] != "alice" {
		t.Fatalf("invite = %v", invite)
	}
	if len(incoming(alice)) != 0 {
		t.Fatal("alice must not see bob's invite")
	}
	if code, _ := call("POST", "/v1/collaboration/invites/"+invite["id"].(string)+"/accept", alice, ""); code != 404 {
		t.Fatalf("only the invitee may accept, got %d", code)
	}
	if code, body := call("POST", "/v1/collaboration/invites/"+invite["id"].(string)+"/accept", bob, ""); code != 200 || body["projectId"] != projectID {
		t.Fatalf("accept = %d %v", code, body)
	}
	if projectCount(bob) != 1 || len(incoming(bob)) != 0 {
		t.Fatal("bob should now be a member with no pending invite")
	}

	// Re-sharing with a member only changes the role.
	if code, body := call("POST", share, alice, `{"email":"bob@example.com","role":"viewer"}`); code != 200 || body["member"] == nil {
		t.Fatalf("role change = %d %v", code, body)
	}
	bobID := mustUserID(t, srv, bob).String()
	memberPath := share + "/" + bobID
	// A viewer cannot edit the project; an editor can rename it and change
	// its type, and the owner's workspace picks the change up.
	if code, _ := call("PATCH", "/v1/collaboration/projects/"+projectID, bob, `{"name":"Nope"}`); code != 403 {
		t.Fatalf("viewer patch = %d", code)
	}
	if code, _ := call("PATCH", memberPath, alice, `{"role":"editor"}`); code != 204 {
		t.Fatalf("promote bob = %d", code)
	}
	if code, body := call("PATCH", "/v1/collaboration/projects/"+projectID, bob, `{"name":"Launch v2","projectType":"software"}`); code != 200 {
		t.Fatalf("editor patch = %d %v", code, body)
	}
	projectFor := func(token string) map[string]any {
		_, body := call("GET", "/v1/collaboration/projects", token, "")
		for _, raw := range body["projects"].([]any) {
			entry := raw.(map[string]any)
			project := entry["project"].(map[string]any)
			if project["id"] == projectID {
				return entry
			}
		}
		t.Fatalf("project %s missing", projectID)
		return nil
	}
	if project := projectFor(alice)["project"].(map[string]any); project["name"] != "Launch v2" || project["projectType"] != "software" {
		t.Fatalf("owner project after editor patch = %v", project)
	}
	if code, _ := call("PATCH", "/v1/collaboration/projects/"+projectID, bob, `{"projectType":"kanban"}`); code != 400 {
		t.Fatalf("invalid type = %d", code)
	}
	// A member can leave; a removed member cannot be brought back by a role change.
	if code, _ := call("DELETE", share+"/"+mustUserID(t, srv, alice).String(), bob, ""); code != 403 {
		t.Fatalf("member removing the owner = %d", code)
	}
	if code, _ := call("DELETE", memberPath, bob, ""); code != 204 {
		t.Fatalf("leave = %d", code)
	}
	if projectCount(bob) != 0 {
		t.Fatal("bob left the project")
	}
	if code, _ := call("PATCH", memberPath, alice, `{"role":"editor"}`); code != 404 {
		t.Fatalf("role change of a removed member = %d", code)
	}

	// Resending rotates the link: the old token stops working.
	code, again := call("POST", share, alice, `{"email":"dave@example.com","role":"editor"}`)
	if code != 200 {
		t.Fatalf("invite dave = %d %v", code, again)
	}
	daveInvite := again["invite"].(map[string]any)
	oldLink := again["inviteLink"].(string)
	code, resent := call("POST", "/v1/collaboration/projects/"+projectID+"/invites/"+daveInvite["id"].(string)+"/resend", alice, `{"email":false}`)
	if code != 200 || resent["inviteLink"] == oldLink || resent["emailSent"] != false {
		t.Fatalf("resend = %d %v", code, resent)
	}
	if code, _ := call("POST", "/v1/collaboration/projects/"+projectID+"/invites/"+daveInvite["id"].(string)+"/resend", bob, ""); code != 404 {
		t.Fatalf("only the owner resends, got %d", code)
	}
	dave := newUser("dave@example.com")
	oldToken := oldLink[strings.LastIndex(oldLink, "/")+1:]
	if code, _ := call("POST", "/v1/collaboration/invites/accept", dave, `{"token":"`+oldToken+`"}`); code != 404 {
		t.Fatalf("rotated link must stop working, got %d", code)
	}
	newLink := resent["inviteLink"].(string)
	if code, body := call("POST", "/v1/collaboration/invites/accept", dave, `{"token":"`+newLink[strings.LastIndex(newLink, "/")+1:]+`"}`); code != 200 || body["projectId"] != projectID {
		t.Fatalf("accept rotated link = %d %v", code, body)
	}
	if role := projectFor(dave)["role"]; role != "editor" {
		t.Fatalf("dave role = %v", role)
	}

	// Declining leaves the project untouched.
	carol := newUser("carol@example.com")
	otherID := uuid.NewString()
	other := strings.ReplaceAll(snapshot, projectID, otherID)
	if code, body := call("POST", "/v1/workspace/sync", alice, other); code != 200 {
		t.Fatalf("second project = %d %v", code, body)
	}
	if code, body := call("POST", "/v1/collaboration/projects/"+otherID+"/members", alice, `{"email":"carol@example.com","role":"editor"}`); code != 200 {
		t.Fatalf("share carol = %d %v", code, body)
	}
	carolInvite := incoming(carol)[0].(map[string]any)
	if code, _ := call("POST", "/v1/collaboration/invites/"+carolInvite["id"].(string)+"/decline", carol, ""); code != 200 {
		t.Fatalf("decline = %d", code)
	}
	if projectCount(carol) != 0 || len(incoming(carol)) != 0 {
		t.Fatal("declined invite must disappear without membership")
	}

	peers, err := srv.store.ProjectPeerIDs(ctx, mustUserID(t, srv, alice))
	if err != nil || len(peers) != 1 { // dave; bob left
		t.Fatalf("alice peers = %v %v", peers, err)
	}
	// Presence goes to co-members only: carol declined, so she is no peer.
	carolID := mustUserID(t, srv, carol)
	for _, peer := range peers {
		if peer == carolID {
			t.Fatal("a non-member must never be in the presence audience")
		}
	}
}

// The project type survives workspace sync, and a client that does not send
// it (an older version) keeps it instead of resetting it to standard.
func TestProjectTypeSyncPostgres(t *testing.T) {
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
	schema := "type_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	user, err := srv.store.CreatePasswordUser(ctx, "erin@example.com", "x", "erin")
	if err != nil {
		t.Fatal(err)
	}
	token := uuid.NewString()
	if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
		t.Fatal(err)
	}
	sync := func(project string) map[string]any {
		request := httptest.NewRequest("POST", "/v1/workspace/sync", strings.NewReader(`{"areas":[],"folders":[],"notes":[],"projects":[`+project+`]}`))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatalf("sync = %d %s", response.Code, response.Body.String())
		}
		var decoded map[string]any
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
		return decoded["projects"].([]any)[0].(map[string]any)
	}
	id := uuid.NewString()
	first := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)
	if project := sync(`{"id":"` + id + `","areaId":null,"name":"App","description":"","icon":"code","status":"active","projectType":"software","createdAt":"` + first + `","updatedAt":"` + first + `","deletedAt":null}`); project["projectType"] != "software" {
		t.Fatalf("software project = %v", project)
	}
	later := time.Now().UTC().Format(time.RFC3339Nano)
	if project := sync(`{"id":"` + id + `","areaId":null,"name":"App 2","description":"","icon":"code","status":"active","createdAt":"` + first + `","updatedAt":"` + later + `","deletedAt":null}`); project["projectType"] != "software" || project["name"] != "App 2" {
		t.Fatalf("older client reset the type: %v", project)
	}

	// The methodology (kanban / scrum / scrumban) syncs the same way: an
	// older client that omits it keeps it, an explicit null clears it, and
	// an unknown value is refused.
	scrumAt := time.Now().UTC().Add(time.Second).Format(time.RFC3339Nano)
	if project := sync(`{"id":"` + id + `","areaId":null,"name":"App 2","description":"","icon":"code","status":"active","projectType":"software","methodology":"scrum","createdAt":"` + first + `","updatedAt":"` + scrumAt + `","deletedAt":null}`); project["methodology"] != "scrum" {
		t.Fatalf("scrum project = %v", project)
	}
	oldAt := time.Now().UTC().Add(2 * time.Second).Format(time.RFC3339Nano)
	if project := sync(`{"id":"` + id + `","areaId":null,"name":"App 3","description":"","icon":"code","status":"active","createdAt":"` + first + `","updatedAt":"` + oldAt + `","deletedAt":null}`); project["methodology"] != "scrum" || project["projectType"] != "software" || project["name"] != "App 3" {
		t.Fatalf("older client reset the methodology: %v", project)
	}
	clearAt := time.Now().UTC().Add(3 * time.Second).Format(time.RFC3339Nano)
	if project := sync(`{"id":"` + id + `","areaId":null,"name":"App 4","description":"","icon":"code","status":"active","methodology":null,"createdAt":"` + first + `","updatedAt":"` + clearAt + `","deletedAt":null}`); project["methodology"] != nil || project["name"] != "App 4" {
		t.Fatalf("explicit null must clear the methodology: %v", project)
	}
	badAt := time.Now().UTC().Add(4 * time.Second).Format(time.RFC3339Nano)
	request := httptest.NewRequest("POST", "/v1/workspace/sync", strings.NewReader(`{"areas":[],"folders":[],"notes":[],"projects":[{"id":"`+id+`","areaId":null,"name":"App 5","description":"","icon":"code","status":"active","methodology":"waterfall","createdAt":"`+first+`","updatedAt":"`+badAt+`","deletedAt":null}]}`))
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code == 200 {
		t.Fatalf("an unknown methodology must be refused: %s", response.Body.String())
	}
}

// Resending an unchanged snapshot must not move the workspace revision: a
// new revision notifies every realtime client, which syncs and resends its
// snapshot, so web clients looped (and re-rendered) several times a second.
func TestWorkspaceResyncKeepsRevisionPostgres(t *testing.T) {
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
	schema := "resync_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	user, err := srv.store.CreatePasswordUser(ctx, "resync@example.com", "x", "resync")
	if err != nil {
		t.Fatal(err)
	}
	token := uuid.NewString()
	if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
		t.Fatal(err)
	}
	sync := func(snapshot string) float64 {
		request := httptest.NewRequest("POST", "/v1/workspace/sync", strings.NewReader(snapshot))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatalf("sync = %d %s", response.Code, response.Body.String())
		}
		var decoded struct {
			WorkspaceRevision float64 `json:"workspaceRevision"`
		}
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
		return decoded.WorkspaceRevision
	}
	at := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)
	stamps := `"createdAt":"` + at + `","updatedAt":"` + at + `","deletedAt":null`
	areaID, projectID, folderID, noteID, milestoneID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	snapshot := func(noteBody, noteUpdatedAt string) string {
		return `{"areas":[{"id":"` + areaID + `","name":"Work","color":"red","icon":null,` + stamps + `}],` +
			`"projects":[{"id":"` + projectID + `","areaId":"` + areaID + `","name":"App","description":"","icon":"code","status":"active","projectType":"software","milestones":[{"id":"` + milestoneID + `","name":"Beta"}],` + stamps + `}],` +
			`"folders":[{"id":"` + folderID + `","name":"Docs","parentId":null,"color":null,"workspaceKind":"project","workspaceId":"` + projectID + `","icon":null,` + stamps + `}],` +
			`"notes":[{"id":"` + noteID + `","title":"Spec","body":"` + noteBody + `","folderId":"` + folderID + `","projectId":"` + projectID + `","favorite":false,"createdAt":"` + at + `","updatedAt":"` + noteUpdatedAt + `","deletedAt":null}]}`
	}
	first := sync(snapshot("v1", at))
	if first <= 0 {
		t.Fatalf("first revision = %v", first)
	}
	unchanged := snapshot("v1", at)
	for attempt := 0; attempt < 3; attempt++ {
		if got := sync(unchanged); got != first {
			t.Fatalf("resending an unchanged snapshot moved the revision: %v -> %v", first, got)
		}
	}
	edited := time.Now().UTC().Format(time.RFC3339Nano)
	if got := sync(snapshot("v2", edited)); got <= first {
		t.Fatalf("an edited note must move the revision: %v -> %v", first, got)
	}
}

func mustUserID(t *testing.T, srv *Server, token string) uuid.UUID {
	t.Helper()
	user, err := srv.store.UserForToken(context.Background(), token)
	if err != nil {
		t.Fatal(err)
	}
	return user.ID
}
