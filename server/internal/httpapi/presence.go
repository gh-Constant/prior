package httpapi

import (
	"context"
	"encoding/json"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// Presence states shown as a green / orange / grey dot (specs/AGILE_COLLABORATION.md,
// "Presence"). A user is online when at least one connection is active, away
// when every connection is idle or hidden, offline without a connection.
const (
	presenceOnline  = "online"
	presenceAway    = "away"
	presenceOffline = "offline"
)

// presenceDebounce coalesces connect/disconnect/idle flapping (a page reload,
// a tab switch) into one realtime event for co-members.
var presenceDebounce = 2 * time.Second

// aggregatePresence picks the best state across a user's connections, given
// whether each one is active.
func aggregatePresence(active []bool) string {
	if len(active) == 0 {
		return presenceOffline
	}
	for _, isActive := range active {
		if isActive {
			return presenceOnline
		}
	}
	return presenceAway
}

// presenceMessage is what a client sends over its realtime socket.
type presenceMessage struct {
	Type  string `json:"type"`
	State string `json:"state"`
}

// parsePresenceMessage reports the activity a client frame declares. ok is
// false for pings and anything else.
func parsePresenceMessage(payload []byte) (active bool, ok bool) {
	var message presenceMessage
	if err := json.Unmarshal(payload, &message); err != nil || message.Type != "presence" {
		return false, false
	}
	switch message.State {
	case "active":
		return true, true
	case "idle":
		return false, true
	}
	return false, false
}

// presence returns the user's aggregated state and, when offline, when their
// last connection closed (zero when unknown, e.g. after an API restart).
func (h *hub) presence(userID uuid.UUID) (string, time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.presenceLocked(userID)
}

func (h *hub) presenceLocked(userID uuid.UUID) (string, time.Time) {
	connections := h.clients[userID]
	active := make([]bool, len(connections))
	for index, connection := range connections {
		_, idle := h.idle[connection]
		active[index] = !idle
	}
	state := aggregatePresence(active)
	if state == presenceOffline {
		return state, h.lastSeen[userID]
	}
	return state, time.Time{}
}

// setActive records whether a connection's client is active.
func (h *hub) setActive(userID uuid.UUID, connection *websocket.Conn, active bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, candidate := range h.clients[userID] {
		if candidate != connection {
			continue
		}
		if active {
			delete(h.idle, connection)
		} else {
			h.idle[connection] = struct{}{}
		}
		return
	}
}

// takeChange reports whether the user's presence differs from what their
// co-members were last told, and records the current state as announced.
func (h *hub) takeChange(userID uuid.UUID) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	state, _ := h.presenceLocked(userID)
	previous, known := h.announced[userID]
	if !known {
		previous = presenceOffline
	}
	if state == presenceOffline {
		delete(h.announced, userID)
	} else {
		h.announced[userID] = state
	}
	return previous != state
}

// schedulePresence tells the user's co-members (and nobody else) that their
// presence changed, after a short debounce.
func (s *Server) schedulePresence(userID uuid.UUID) {
	s.presenceMu.Lock()
	defer s.presenceMu.Unlock()
	if s.presenceTimers == nil {
		s.presenceTimers = make(map[uuid.UUID]*time.Timer)
	}
	if timer, ok := s.presenceTimers[userID]; ok {
		timer.Stop()
	}
	s.presenceTimers[userID] = time.AfterFunc(presenceDebounce, func() {
		s.presenceMu.Lock()
		delete(s.presenceTimers, userID)
		s.presenceMu.Unlock()
		if s.hub.takeChange(userID) {
			s.notifyProjectPeersEvent(context.Background(), userID, "presence_required")
		}
	})
}

// presenceOf returns a user's state and last-seen pointer for API payloads.
func (s *Server) presenceOf(userID uuid.UUID) (string, *time.Time) {
	state, seen := s.hub.presence(userID)
	if seen.IsZero() {
		return state, nil
	}
	return state, &seen
}
