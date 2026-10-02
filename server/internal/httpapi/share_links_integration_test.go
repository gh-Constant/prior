package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/billing"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestProjectShareLinksPostgres(t *testing.T) {
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
	schema := "links_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	ids := map[string]uuid.UUID{}
	newUser := func(email string) string {
		user, err := srv.store.CreatePasswordUser(ctx, email, "x", strings.Split(email, "@")[0])
		if err != nil {
			t.Fatal(err)
		}
		ids[email] = user.ID
		token := uuid.NewString()
		if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
			t.Fatal(err)
		}
		return token
	}
	call := func(method, path, token, body string) (int, map[string]any) {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		var decoded map[string]any
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
		return response.Code, decoded
	}
	alice := newUser("alice@example.com")
	bob := newUser("bob@example.com")
	carol := newUser("carol@example.com")
	dave := newUser("dave@example.com")
	erin := newUser("erin@example.com")
	// A paid-sized plan: the member limit has its own test below.
	team := billing.PlanTeam
	if err := srv.store.SetAdminPlan(ctx, ids["alice@example.com"], &team, "test"); err != nil {
		t.Fatal(err)
	}

	projectID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	snapshot := `{"areas":[],"folders":[],"notes":[],"projects":[{"id":"` + projectID + `","areaId":null,"name":"Launch","description":"","icon":"folder","status":"active","createdAt":"` + now + `","updatedAt":"` + now + `","deletedAt":null}]}`
	if code, body := call("POST", "/v1/workspace/sync", alice, snapshot); code != 200 {
		t.Fatalf("workspace sync = %d %v", code, body)
	}
	links := "/v1/collaboration/projects/" + projectID + "/share-links"
	role := func(token string) string {
		code, body := call("GET", "/v1/collaboration/projects/"+projectID+"/members", token, "")
		if code != 200 {
			return ""
		}
		return body["role"].(string)
	}
	tokenOf := func(body map[string]any) string {
		link, _ := body["inviteLink"].(string)
		return link[strings.LastIndex(link, "/")+1:]
	}

	// Only the owner manages links; a non-member cannot even see the project.
	if code, _ := call("POST", links, bob, `{"role":"editor"}`); code != http.StatusNotFound {
		t.Fatalf("stranger creating a link = %d", code)
	}
	if code, _ := call("GET", links, bob, ""); code != http.StatusNotFound {
		t.Fatalf("stranger listing links = %d", code)
	}
	if code, _ := call("POST", links, "", `{"role":"editor"}`); code != http.StatusUnauthorized {
		t.Fatalf("anonymous creating a link = %d", code)
	}
	if code, body := call("POST", links, alice, `{"role":"owner"}`); code != http.StatusBadRequest {
		t.Fatalf("owner role must be refused: %d %v", code, body)
	}

	code, created := call("POST", links, alice, `{"role":"viewer"}`)
	if code != 200 || !strings.Contains(created["inviteLink"].(string), "/invite/") {
		t.Fatalf("create viewer link = %d %v", code, created)
	}
	viewerToken := tokenOf(created)
	viewerLinkID := created["link"].(map[string]any)["id"].(string)
	code, created = call("POST", links, alice, `{"role":"editor","expiresInDays":7}`)
	if code != 200 || created["link"].(map[string]any)["expiresAt"] == nil {
		t.Fatalf("create editor link = %d %v", code, created)
	}
	editorToken := tokenOf(created)

	// The listing never contains tokens.
	code, listed := call("GET", links, alice, "")
	if code != 200 || len(listed["links"].([]any)) != 2 || strings.Contains(listed["links"].([]any)[0].(map[string]any)["role"].(string), "owner") {
		t.Fatalf("list = %d %v", code, listed)
	}
	for _, entry := range listed["links"].([]any) {
		if _, leaked := entry.(map[string]any)["token"]; leaked {
			t.Fatal("tokens must not be listed")
		}
	}

	// Public preview: project, owner, role and member count; nothing personal.
	code, preview := call("GET", "/v1/collaboration/invites/preview?token="+viewerToken, "", "")
	if code != 200 || preview["kind"] != "link" || preview["projectName"] != "Launch" || preview["inviterName"] != "alice" ||
		preview["role"] != "viewer" || preview["status"] != "pending" || preview["memberCount"] != float64(1) || preview["alreadyMember"] != false || preview["projectId"] != nil {
		t.Fatalf("preview = %d %v", code, preview)
	}
	if code, _ := call("GET", "/v1/collaboration/invites/preview?token="+strings.Repeat("0", 64), "", ""); code != http.StatusNotFound {
		t.Fatalf("unknown token preview = %d", code)
	}

	// Joining needs an account, and the link is not used up by the preview.
	if code, _ := call("POST", "/v1/collaboration/invites/accept", "", `{"token":"`+viewerToken+`"}`); code != http.StatusUnauthorized {
		t.Fatalf("anonymous join = %d", code)
	}
	if role(bob) != "" {
		t.Fatal("bob must not see the project before joining")
	}
	code, joined := call("POST", "/v1/collaboration/invites/accept", bob, `{"token":"`+viewerToken+`"}`)
	if code != 200 || joined["projectId"] != projectID || joined["role"] != "viewer" || joined["result"] != "joined" {
		t.Fatalf("bob joins = %d %v", code, joined)
	}
	if role(bob) != "viewer" {
		t.Fatalf("bob role = %q", role(bob))
	}
	// A viewer cannot edit tasks or manage links.
	if code, _ := call("POST", links, bob, `{"role":"editor"}`); code != http.StatusForbidden {
		t.Fatalf("viewer creating a link = %d", code)
	}
	if code, _ := call("GET", links, bob, ""); code != http.StatusForbidden {
		t.Fatalf("viewer listing links = %d", code)
	}
	// The same link, used again by a member, changes nothing and does not count.
	code, again := call("POST", "/v1/collaboration/invites/accept", bob, `{"token":"`+viewerToken+`"}`)
	if code != 200 || again["result"] != "already_member" || again["role"] != "viewer" {
		t.Fatalf("bob joins twice = %d %v", code, again)
	}
	// Preview for a signed-in member says so and reveals the project.
	code, preview = call("GET", "/v1/collaboration/invites/preview?token="+viewerToken, bob, "")
	if code != 200 || preview["alreadyMember"] != true || preview["currentRole"] != "viewer" || preview["projectId"] != projectID || preview["memberCount"] != float64(2) {
		t.Fatalf("member preview = %d %v", code, preview)
	}

	// Editor link: carol joins as editor; a viewer opening it is upgraded.
	code, joined = call("POST", "/v1/collaboration/invites/accept", carol, `{"token":"`+editorToken+`"}`)
	if code != 200 || joined["role"] != "editor" || joined["result"] != "joined" || role(carol) != "editor" {
		t.Fatalf("carol joins = %d %v", code, joined)
	}
	code, joined = call("POST", "/v1/collaboration/invites/accept", bob, `{"token":"`+editorToken+`"}`)
	if code != 200 || joined["result"] != "upgraded" || role(bob) != "editor" {
		t.Fatalf("bob upgrades = %d %v", code, joined)
	}
	// Never a downgrade: an editor opening the viewer link stays an editor,
	// and so does the owner.
	code, joined = call("POST", "/v1/collaboration/invites/accept", carol, `{"token":"`+viewerToken+`"}`)
	if code != 200 || joined["result"] != "already_member" || joined["role"] != "editor" || role(carol) != "editor" {
		t.Fatalf("carol on the viewer link = %d %v", code, joined)
	}
	code, joined = call("POST", "/v1/collaboration/invites/accept", alice, `{"token":"`+viewerToken+`"}`)
	if code != 200 || joined["result"] != "already_member" || joined["role"] != "owner" || role(alice) != "owner" {
		t.Fatalf("owner on her own link = %d %v", code, joined)
	}

	// Two people joined (bob once, carol once); upgrades do not count.
	_, listed = call("GET", links, alice, "")
	uses := map[string]float64{}
	for _, entry := range listed["links"].([]any) {
		link := entry.(map[string]any)
		uses[link["role"].(string)] = link["useCount"].(float64)
	}
	if uses["viewer"] != 1 || uses["editor"] != 1 {
		t.Fatalf("use counts = %v", uses)
	}

	// Members who left can come back with the link; the owner removing
	// someone is not permanent while the link is active.
	if code, _ := call("DELETE", "/v1/collaboration/projects/"+projectID+"/members/"+ids["bob@example.com"].String(), alice, ""); code != http.StatusNoContent {
		t.Fatalf("remove bob = %d", code)
	}
	if role(bob) != "" {
		t.Fatal("bob must be out")
	}

	// Rotating a role revokes its previous link.
	code, rotated := call("POST", links, alice, `{"role":"viewer"}`)
	if code != 200 || tokenOf(rotated) == viewerToken {
		t.Fatalf("rotate = %d %v", code, rotated)
	}
	newViewerToken := tokenOf(rotated)
	code, body := call("POST", "/v1/collaboration/invites/accept", dave, `{"token":"`+viewerToken+`"}`)
	if code != http.StatusGone || body["code"] != "LINK_REVOKED" {
		t.Fatalf("old link = %d %v", code, body)
	}
	code, preview = call("GET", "/v1/collaboration/invites/preview?token="+viewerToken, "", "")
	if code != 200 || preview["status"] != "revoked" {
		t.Fatalf("revoked preview = %d %v", code, preview)
	}
	if role(dave) != "" {
		t.Fatal("a revoked link must not add anyone")
	}
	_, listed = call("GET", links, alice, "")
	if len(listed["links"].([]any)) != 2 {
		t.Fatalf("one active link per role: %v", listed)
	}
	if code, _ := call("POST", "/v1/collaboration/invites/accept", dave, `{"token":"`+newViewerToken+`"}`); code != 200 || role(dave) != "viewer" {
		t.Fatalf("dave on the new link = %d", code)
	}

	// Disabling: only the owner, and existing members stay.
	_, listed = call("GET", links, alice, "")
	var editorLinkID string
	for _, entry := range listed["links"].([]any) {
		if link := entry.(map[string]any); link["role"] == "editor" {
			editorLinkID = link["id"].(string)
		}
	}
	if code, _ := call("DELETE", links+"/"+editorLinkID, carol, ""); code != http.StatusForbidden {
		t.Fatalf("editor revoking a link = %d", code)
	}
	if code, _ := call("DELETE", links+"/"+viewerLinkID, alice, ""); code != http.StatusNotFound {
		t.Fatalf("revoking an already rotated link = %d", code)
	}
	if code, _ := call("DELETE", links+"/"+editorLinkID, alice, ""); code != http.StatusNoContent {
		t.Fatalf("revoke editor link = %d", code)
	}
	code, body = call("POST", "/v1/collaboration/invites/accept", erin, `{"token":"`+editorToken+`"}`)
	if code != http.StatusGone || body["code"] != "LINK_REVOKED" || role(erin) != "" {
		t.Fatalf("disabled link = %d %v", code, body)
	}
	if role(carol) != "editor" {
		t.Fatal("disabling a link must not remove members")
	}

	// Expired links: the status is reported and joining is refused.
	code, expiring := call("POST", links, alice, `{"role":"editor","expiresInDays":1}`)
	if code != 200 {
		t.Fatalf("expiring link = %d %v", code, expiring)
	}
	expiringToken := tokenOf(expiring)
	if _, err := pool.Exec(ctx, `UPDATE project_share_links SET expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL AND role = 'editor'`); err != nil {
		t.Fatal(err)
	}
	code, body = call("POST", "/v1/collaboration/invites/accept", erin, `{"token":"`+expiringToken+`"}`)
	if code != http.StatusGone || body["code"] != "LINK_EXPIRED" || role(erin) != "" {
		t.Fatalf("expired link = %d %v", code, body)
	}
	if code, preview = call("GET", "/v1/collaboration/invites/preview?token="+expiringToken, "", ""); code != 200 || preview["status"] != "expired" {
		t.Fatalf("expired preview = %d %v", code, preview)
	}
	// Garbage tokens.
	if code, body = call("POST", "/v1/collaboration/invites/accept", erin, `{"token":"`+strings.Repeat("a", 64)+`"}`); code != http.StatusNotFound || body["code"] != "INVITE_NOT_FOUND" {
		t.Fatalf("unknown token = %d %v", code, body)
	}
	if code, _ = call("POST", "/v1/collaboration/invites/accept", erin, `{"token":"nope"}`); code != http.StatusBadRequest {
		t.Fatalf("malformed token = %d", code)
	}

	// A usage cap closes the link for new people only.
	code, capped := call("POST", links, alice, `{"role":"viewer","maxUses":1}`)
	if code != 200 {
		t.Fatalf("capped link = %d %v", code, capped)
	}
	cappedToken := tokenOf(capped)
	if code, _ = call("POST", "/v1/collaboration/invites/accept", erin, `{"token":"`+cappedToken+`"}`); code != 200 || role(erin) != "viewer" {
		t.Fatalf("erin on the capped link = %d", code)
	}
	frank := newUser("frank@example.com")
	if code, body = call("POST", "/v1/collaboration/invites/accept", frank, `{"token":"`+cappedToken+`"}`); code != http.StatusGone || body["code"] != "LINK_EXHAUSTED" {
		t.Fatalf("exhausted link = %d %v", code, body)
	}
	if code, _ = call("POST", "/v1/collaboration/invites/accept", erin, `{"token":"`+cappedToken+`"}`); code != 200 {
		t.Fatalf("a member of an exhausted link still passes = %d", code)
	}

	// Deleted projects lose their links.
	if _, err := pool.Exec(ctx, `UPDATE projects SET deleted_at = now() WHERE id = $1`, projectID); err != nil {
		t.Fatal(err)
	}
	if code, _ = call("GET", "/v1/collaboration/invites/preview?token="+cappedToken, "", ""); code != http.StatusNotFound {
		t.Fatalf("deleted project preview = %d", code)
	}
}

func TestShareLinkRespectsOwnerPlanPostgres(t *testing.T) {
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
	schema := "linkplan_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	var aliceID uuid.UUID
	newUser := func(email string) string {
		user, err := srv.store.CreatePasswordUser(ctx, email, "x", strings.Split(email, "@")[0])
		if err != nil {
			t.Fatal(err)
		}
		if email == "alice@example.com" {
			aliceID = user.ID
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
	alice, bob, carol := newUser("alice@example.com"), newUser("bob@example.com"), newUser("carol@example.com")
	projectID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES ($1, $2, 'Launch', now(), now())`, projectID, aliceID); err != nil {
		t.Fatal(err)
	}
	// Free plan: two people per project, the link does not reserve a seat.
	code, created := call("POST", "/v1/collaboration/projects/"+projectID.String()+"/share-links", alice, `{"role":"editor"}`)
	if code != 200 {
		t.Fatalf("create = %d %v", code, created)
	}
	link := created["inviteLink"].(string)
	token := link[strings.LastIndex(link, "/")+1:]
	if code, body := call("POST", "/v1/collaboration/invites/accept", bob, `{"token":"`+token+`"}`); code != 200 {
		t.Fatalf("bob = %d %v", code, body)
	}
	code, body := call("POST", "/v1/collaboration/invites/accept", carol, `{"token":"`+token+`"}`)
	if code != http.StatusPaymentRequired || body["code"] != "PLAN_LIMIT" || body["limit"] != "members" {
		t.Fatalf("third person on free = %d %v", code, body)
	}
	if code, _ := call("GET", "/v1/collaboration/projects", carol, ""); code != 200 {
		t.Fatal("carol can still list her projects")
	}
	// Upgrading the owner's plan lets the same link work again.
	team := billing.PlanTeam
	if err := srv.store.SetAdminPlan(ctx, aliceID, &team, "test"); err != nil {
		t.Fatal(err)
	}
	if code, body := call("POST", "/v1/collaboration/invites/accept", carol, `{"token":"`+token+`"}`); code != 200 {
		t.Fatalf("carol after upgrade = %d %v", code, body)
	}
}
