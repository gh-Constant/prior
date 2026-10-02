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

	"github.com/coder/websocket"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// socketFeed reads a realtime socket in the background so tests can wait for
// an event, or prove none arrives, without a read timeout closing the socket.
type socketFeed struct {
	conn   *websocket.Conn
	events chan string
}

func openFeed(t *testing.T, base, token string) *socketFeed {
	t.Helper()
	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(base, "http")+"/v1/realtime", &websocket.DialOptions{
		HTTPHeader:   http.Header{"Authorization": []string{"Bearer " + token}},
		Subprotocols: []string{realtimeProtocol},
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	feed := &socketFeed{conn: conn, events: make(chan string, 64)}
	go func() {
		for {
			_, payload, err := conn.Read(context.Background())
			if err != nil {
				close(feed.events)
				return
			}
			var event struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(payload, &event) == nil {
				feed.events <- event.Type
			}
		}
	}()
	t.Cleanup(func() { conn.CloseNow() })
	return feed
}

func (f *socketFeed) expect(t *testing.T, want string) {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case event, ok := <-f.events:
			if !ok {
				t.Fatalf("socket closed while waiting for %s", want)
			}
			if event == want {
				return
			}
		case <-deadline:
			t.Fatalf("no %s event within 3s", want)
		}
	}
}

func (f *socketFeed) expectSilence(t *testing.T, who string) {
	t.Helper()
	select {
	case event := <-f.events:
		t.Fatalf("%s must not hear about presence, got %q", who, event)
	case <-time.After(400 * time.Millisecond):
	}
}

// Real sockets: co-members hear about a connect, an idle report and a
// disconnect (debounced), the member list carries the state, and someone who
// shares no project with the user hears nothing.
func TestPresenceRealtimePostgres(t *testing.T) {
	url := os.Getenv("PRIOR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set PRIOR_TEST_DATABASE_URL for PostgreSQL integration")
	}
	previous := presenceDebounce
	presenceDebounce = 40 * time.Millisecond
	defer func() { presenceDebounce = previous }()
	ctx := context.Background()
	adminPool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer adminPool.Close()
	schema := "presence_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	httpServer := httptest.NewServer(handler)
	defer httpServer.Close()

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
	alice, bob, carol := newUser("alice@example.com"), newUser("bob@example.com"), newUser("carol@example.com")
	projectID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	snapshot := `{"areas":[],"folders":[],"notes":[],"projects":[{"id":"` + projectID + `","areaId":null,"name":"Launch","description":"","icon":"folder","status":"active","createdAt":"` + now + `","updatedAt":"` + now + `","deletedAt":null}]}`
	if code, body := call("POST", "/v1/workspace/sync", alice, snapshot); code != 200 {
		t.Fatalf("workspace sync = %d %v", code, body)
	}
	if code, body := call("POST", "/v1/collaboration/projects/"+projectID+"/members", alice, `{"email":"bob@example.com","role":"editor"}`); code != 200 {
		t.Fatalf("share = %d %v", code, body)
	}
	_, invites := call("GET", "/v1/collaboration/invites", bob, "")
	inviteID := invites["invites"].([]any)[0].(map[string]any)["id"].(string)
	if code, body := call("POST", "/v1/collaboration/invites/"+inviteID+"/accept", bob, ""); code != 200 {
		t.Fatalf("accept = %d %v", code, body)
	}
	aliceID := mustUserID(t, srv, alice).String()

	// What bob's member list says about alice.
	aliceAs := func() (string, bool) {
		_, body := call("GET", "/v1/collaboration/projects", bob, "")
		for _, raw := range body["projects"].([]any) {
			for _, rawMember := range raw.(map[string]any)["members"].([]any) {
				member := rawMember.(map[string]any)
				if member["userId"] == aliceID {
					_, seen := member["lastSeenAt"]
					return member["presence"].(string), seen
				}
			}
		}
		t.Fatal("alice is not in bob's member list")
		return "", false
	}
	if state, _ := aliceAs(); state != presenceOffline {
		t.Fatalf("alice before connecting = %s", state)
	}

	bobFeed := openFeed(t, httpServer.URL, bob)
	carolFeed := openFeed(t, httpServer.URL, carol)
	bobFeed.expectSilence(t, "bob before alice shows up") // bob's own connect goes to alice, who is offline

	aliceFeed := openFeed(t, httpServer.URL, alice)
	bobFeed.expect(t, "presence_required")
	if state, _ := aliceAs(); state != presenceOnline {
		t.Fatalf("alice connected = %s", state)
	}

	// The client reports an idle app: orange.
	if err := aliceFeed.conn.Write(ctx, websocket.MessageText, []byte(`{"type":"presence","state":"idle"}`)); err != nil {
		t.Fatal(err)
	}
	bobFeed.expect(t, "presence_required")
	if state, _ := aliceAs(); state != presenceAway {
		t.Fatalf("alice idle = %s", state)
	}

	// A second, active device makes her green again.
	phone := openFeed(t, httpServer.URL, alice)
	bobFeed.expect(t, "presence_required")
	if state, _ := aliceAs(); state != presenceOnline {
		t.Fatalf("alice with an active phone = %s", state)
	}
	phone.conn.CloseNow()
	bobFeed.expect(t, "presence_required")
	if state, _ := aliceAs(); state != presenceAway {
		t.Fatalf("alice back to the idle laptop = %s", state)
	}

	aliceFeed.conn.CloseNow()
	bobFeed.expect(t, "presence_required")
	if state, seen := aliceAs(); state != presenceOffline || !seen {
		t.Fatalf("alice disconnected = %s lastSeenAt=%v", state, seen)
	}

	// Carol shares no project with anyone: she never hears about presence.
	carolFeed.expectSilence(t, "a non-member")
}
