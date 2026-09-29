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
	if code, body := call("POST", share, alice, `{"email":"Bob@example.com","role":"editor"}`); code != 200 || body["invite"] == nil {
		t.Fatalf("share = %d %v", code, body)
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
	if err != nil || len(peers) != 1 {
		t.Fatalf("alice peers = %v %v", peers, err)
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
