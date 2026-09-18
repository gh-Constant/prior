package httpapi

import (
	"errors"
	"net/http"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

// GET /v1/sessions lists the caller's active sessions. The current session is
// flagged so the UI can avoid revoking itself by accident.
func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	sessions, err := s.store.ListSessions(r.Context(), user.ID, bearer(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to list sessions"))
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

// DELETE /v1/sessions/{id} revokes one session owned by the caller.
func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	sessionID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid session id"))
		return
	}
	if err := s.store.RevokeSessionByID(r.Context(), user.ID, sessionID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, errors.New("unable to revoke session"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /v1/sessions revokes every session for the caller, including the
// current one ("sign out everywhere"). The realtime expiry loop closes live
// sockets with code 4401 once their token no longer resolves.
func (s *Server) revokeAllSessions(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if err := s.store.RevokeAllSessions(r.Context(), user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to revoke sessions"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
