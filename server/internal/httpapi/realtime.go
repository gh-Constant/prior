package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"
)

// realtimeChannel is the PostgreSQL LISTEN/NOTIFY channel used to fan out
// cross-device updates. Every mutating endpoint publishes best-effort; the
// subscriber below forwards events to the in-memory hub so all API replicas
// stay coherent.
const realtimeChannel = "prior_sync"

type realtimeNotification struct {
	UserID   string `json:"user_id"`
	Type     string `json:"type"`
	Revision int64  `json:"revision"`
}

// notifySync publishes a realtime event for userID. It never fails the
// request: delivery falls back to the next pull when NOTIFY is unavailable.
func (s *Server) notifySync(ctx context.Context, userID uuid.UUID, eventType string, revision int64) {
	if s.pool == nil {
		return
	}
	payload, err := json.Marshal(realtimeNotification{UserID: userID.String(), Type: eventType, Revision: revision})
	if err != nil {
		return
	}
	if _, err := s.pool.Exec(ctx, `SELECT pg_notify($1, $2)`, realtimeChannel, string(payload)); err != nil {
		slog.Warn("realtime notify failed", "user_id_hash", userIDHash(userID), "type", eventType, "error", err)
	}
	// Deliver locally even before the LISTEN loop echoes the notification back.
	s.hub.broadcast(userID, realtimeEvent{Type: eventType, Revision: revision})
}

// StartRealtimeSubscriber LISTENs on realtimeChannel and fans notifications
// out to the hub. Run it once per API replica; exit via ctx.
func (s *Server) StartRealtimeSubscriber(ctx context.Context) {
	if s.pool == nil {
		return
	}
	for {
		if err := s.listenOnce(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Warn("realtime subscriber reconnecting", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
	}
}

func (s *Server) listenOnce(ctx context.Context) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+realtimeChannel); err != nil {
		return err
	}
	for {
		notification, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var event realtimeNotification
		if err := json.Unmarshal([]byte(notification.Payload), &event); err != nil {
			continue
		}
		userID, err := uuid.Parse(event.UserID)
		if err != nil || event.Type == "" {
			continue
		}
		s.hub.broadcast(userID, realtimeEvent{Type: event.Type, Revision: event.Revision})
	}
}
