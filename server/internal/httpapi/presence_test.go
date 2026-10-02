package httpapi

import (
	"testing"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

func TestAggregatePresencePicksBestConnection(t *testing.T) {
	cases := []struct {
		name   string
		active []bool
		want   string
	}{
		{"no connection", nil, presenceOffline},
		{"one active", []bool{true}, presenceOnline},
		{"one idle", []bool{false}, presenceAway},
		{"idle phone, active laptop", []bool{false, true}, presenceOnline},
		{"all idle", []bool{false, false}, presenceAway},
	}
	for _, tc := range cases {
		if got := aggregatePresence(tc.active); got != tc.want {
			t.Errorf("%s: got %s want %s", tc.name, got, tc.want)
		}
	}
}

func TestParsePresenceMessage(t *testing.T) {
	if active, ok := parsePresenceMessage([]byte(`{"type":"presence","state":"idle"}`)); !ok || active {
		t.Fatal("idle must parse as inactive")
	}
	if active, ok := parsePresenceMessage([]byte(`{"type":"presence","state":"active"}`)); !ok || !active {
		t.Fatal("active must parse as active")
	}
	for _, raw := range []string{`{"type":"ping"}`, `{"type":"presence","state":"busy"}`, `nope`} {
		if _, ok := parsePresenceMessage([]byte(raw)); ok {
			t.Fatalf("%s must be ignored", raw)
		}
	}
}

func TestHubPresenceAcrossConnections(t *testing.T) {
	h := newHub()
	user := uuid.New()
	if state, _ := h.presence(user); state != presenceOffline {
		t.Fatalf("unknown user = %s", state)
	}
	laptop, phone := &websocket.Conn{}, &websocket.Conn{}
	if !h.add(user, laptop) {
		t.Fatal("first connection must be reported")
	}
	h.add(user, phone)
	if state, _ := h.presence(user); state != presenceOnline {
		t.Fatalf("new connections count as active, got %s", state)
	}
	h.setActive(user, laptop, false)
	if state, _ := h.presence(user); state != presenceOnline {
		t.Fatalf("one active connection keeps the user online, got %s", state)
	}
	h.setActive(user, phone, false)
	if state, _ := h.presence(user); state != presenceAway {
		t.Fatalf("all idle = away, got %s", state)
	}
	h.setActive(user, phone, true)
	if state, _ := h.presence(user); state != presenceOnline {
		t.Fatalf("activity brings the user back, got %s", state)
	}
	// A report for a connection the hub does not know must not leak state.
	h.setActive(user, &websocket.Conn{}, false)
	if len(h.idle) != 1 {
		t.Fatalf("idle = %d", len(h.idle))
	}
	h.setActive(user, phone, false)
	h.forget(user, phone)
	if state, _ := h.presence(user); state != presenceAway {
		t.Fatalf("only the idle laptop is left, got %s", state)
	}
	h.forget(user, laptop)
	state, seen := h.presence(user)
	if state != presenceOffline || seen.IsZero() {
		t.Fatalf("offline user keeps a last-seen time, got %s %v", state, seen)
	}
	if len(h.idle) != 0 {
		t.Fatalf("closed connections must not linger in idle: %d", len(h.idle))
	}
}

func TestTakeChangeAnnouncesOnlyRealTransitions(t *testing.T) {
	h := newHub()
	user := uuid.New()
	conn := &websocket.Conn{}
	if h.takeChange(user) {
		t.Fatal("offline to offline is not a change")
	}
	h.add(user, conn)
	if !h.takeChange(user) {
		t.Fatal("offline to online must be announced")
	}
	if h.takeChange(user) {
		t.Fatal("a repeat must not be announced again")
	}
	// A reload drops and reopens the socket inside the debounce window.
	h.forget(user, conn)
	h.add(user, conn)
	if h.takeChange(user) {
		t.Fatal("a quick reconnect must not flicker")
	}
	h.setActive(user, conn, false)
	if !h.takeChange(user) {
		t.Fatal("online to away must be announced")
	}
	h.forget(user, conn)
	if !h.takeChange(user) {
		t.Fatal("away to offline must be announced")
	}
}
