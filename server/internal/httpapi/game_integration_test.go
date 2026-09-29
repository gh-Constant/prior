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

func TestGameEndpointsPostgres(t *testing.T) {
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
	schema := "game_http_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	newUser := func(email string) (uuid.UUID, string) {
		user, err := srv.store.CreatePasswordUser(ctx, email, "x", strings.Split(email, "@")[0])
		if err != nil {
			t.Fatal(err)
		}
		token := uuid.NewString()
		if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
			t.Fatal(err)
		}
		return user.ID, token
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
	aliceID, alice := newUser("alice@example.com")
	_, bob := newUser("bob@example.com")

	if code, _ := call("GET", "/v1/game", "", ""); code != 401 {
		t.Fatalf("game state needs a session, got %d", code)
	}
	code, state := call("GET", "/v1/game", alice, "")
	profile, _ := state["profile"].(map[string]any)
	if code != 200 || profile["enabled"] != false || profile["onboardingVersion"] != float64(0) || profile["currentOnboarding"] != float64(1) {
		t.Fatalf("fresh game state = %d %v", code, profile)
	}

	// Onboarding: choose the gamified experience.
	code, profile = call("PATCH", "/v1/game/settings", alice, `{"onboardingVersion":1,"enabled":true,"visibility":"public","effects":"subtle","timeZone":"Europe/Paris"}`)
	if code != 200 || profile["enabled"] != true || profile["effects"] != "subtle" || profile["pet"] == nil {
		t.Fatalf("settings = %d %v", code, profile)
	}
	if code, _ := call("PATCH", "/v1/game/settings", alice, `{"visibility":"everyone"}`); code != 400 {
		t.Fatalf("invalid visibility = %d", code)
	}
	if code, _ := call("PATCH", "/v1/game/settings", alice, `{"xp":999999}`); code != 400 {
		t.Fatalf("XP cannot be set by the client, got %d", code)
	}

	// Handles.
	if code, body := call("GET", "/v1/game/handle?handle=night_owl", alice, ""); code != 200 || body["available"] != true {
		t.Fatalf("handle check = %d %v", code, body)
	}
	if code, body := call("PUT", "/v1/game/handle", alice, `{"handle":"@Night_Owl"}`); code != 200 || body["handle"] != "night_owl" {
		t.Fatalf("set handle = %d %v", code, body)
	}
	if code, _ := call("PUT", "/v1/game/handle", bob, `{"handle":"night_owl"}`); code != 409 {
		t.Fatalf("taken handle = %d", code)
	}
	if code, body := call("PUT", "/v1/game/handle", bob, `{"handle":"prior_staff"}`); code != 400 || body["reason"] != "reserved" {
		t.Fatalf("reserved handle = %d %v", code, body)
	}

	// Equip what you own, only.
	if code, _ := call("PUT", "/v1/game/equip", alice, `{"slot":"nameEffect","itemId":"diamond"}`); code != 403 {
		t.Fatalf("locked name effect = %d", code)
	}
	if code, body := call("PUT", "/v1/game/equip", alice, `{"slot":"border","itemId":"border-common-ring"}`); code != 200 {
		t.Fatalf("equip starter border = %d %v", code, body)
	}
	if code, body := call("PUT", "/v1/game/pet", alice, `{"name":"Mochi"}`); code != 200 || body["name"] != "Mochi" {
		t.Fatalf("pet name = %d %v", code, body)
	}

	// Boards and leagues answer even when empty.
	if code, body := call("GET", "/v1/game/leaderboards/level", alice, ""); code != 200 || body["me"] == nil {
		t.Fatalf("level board = %d %v", code, body)
	}
	if code, _ := call("GET", "/v1/game/leaderboards/money", alice, ""); code != 400 {
		t.Fatalf("unknown board = %d", code)
	}
	if code, body := call("GET", "/v1/game/league", alice, ""); code != 200 || body["tier"] != "pebble" || body["joined"] != false {
		t.Fatalf("league = %d %v", code, body)
	}
	if code, _ := call("POST", "/v1/game/chests/"+uuid.NewString()+"/open", alice, ""); code != 404 {
		t.Fatalf("someone else's chest = %d", code)
	}
	if code, _ := call("POST", "/v1/game/kudos", alice, `{"taskId":"`+uuid.NewString()+`"}`); code != 403 {
		t.Fatalf("kudos for an unknown task = %d", code)
	}

	// Invite preview is public but reveals nothing for a bad token.
	projectID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES ($1, $2, 'Launch', now(), now())`, projectID, aliceID); err != nil {
		t.Fatal(err)
	}
	_, invite, err := srv.store.ShareProject(ctx, aliceID, projectID, "carol@example.com", "viewer")
	if err != nil || invite == nil {
		t.Fatalf("share: %v", err)
	}
	if code, body := call("GET", "/v1/collaboration/invites/preview?token="+invite.InviteToken, "", ""); code != 200 || body["projectName"] != "Launch" || body["status"] != "pending" || body["inviterName"] != "alice" {
		t.Fatalf("invite preview = %d %v", code, body)
	}
	if code, _ := call("GET", "/v1/collaboration/invites/preview?token=nope", "", ""); code != 404 {
		t.Fatalf("bad invite token = %d", code)
	}
	if code, body := call("GET", "/v1/game/projects/"+projectID.String()+"/leaderboard", bob, ""); code != 404 {
		t.Fatalf("outsider project board = %d %v", code, body)
	}
	if code, _ := call("PUT", "/v1/game/projects/"+projectID.String()+"/leaderboard", alice, `{"mode":"competitive"}`); code != 204 {
		t.Fatalf("owner sets mode = %d", code)
	}
	if code, body := call("GET", "/v1/game/projects/"+projectID.String()+"/leaderboard", alice, ""); code != 200 || body["mode"] != "competitive" || body["isOwner"] != true {
		t.Fatalf("project board = %d %v", code, body)
	}
}
