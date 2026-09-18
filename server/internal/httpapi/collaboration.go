package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

func collaborationStatus(err error) int {
	if errors.Is(err, store.ErrNotFound) {
		return http.StatusNotFound
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "owner") || strings.Contains(message, "read-only") || strings.Contains(message, "belongs to another") || strings.Contains(message, "does not match") {
		return http.StatusForbidden
	}
	if strings.Contains(message, "invalid") || strings.Contains(message, "required") {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func (s *Server) collaborationProjects(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projects, err := s.store.ListCollaborativeProjects(r.Context(), user.ID)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}

func (s *Server) collaborationProjectMembers(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project id"))
		return
	}
	members, invites, role, err := s.store.ProjectMembersForUser(r.Context(), user.ID, projectID)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": members, "pendingInvites": invites, "role": role})
}

func (s *Server) shareProject(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project id"))
		return
	}
	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decodeJSON(r, &body); err != nil || strings.TrimSpace(body.Email) == "" {
		writeError(w, http.StatusBadRequest, errors.New("invite email is required"))
		return
	}
	member, invite, err := s.store.ShareProject(r.Context(), user.ID, projectID, body.Email, body.Role)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	if invite != nil {
		writeJSON(w, http.StatusOK, map[string]any{"invite": invite})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"member": member})
}

func (s *Server) updateProjectMember(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project id"))
		return
	}
	memberID, err := uuid.Parse(r.PathValue("userID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid user id"))
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid member request"))
		return
	}
	if err := s.store.UpdateProjectMember(r.Context(), user.ID, projectID, memberID, body.Role); err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removeProjectMember(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project id"))
		return
	}
	memberID, err := uuid.Parse(r.PathValue("userID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid user id"))
		return
	}
	if err := s.store.RemoveProjectMember(r.Context(), user.ID, projectID, memberID); err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) revokeProjectInvite(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project id"))
		return
	}
	inviteID, err := uuid.Parse(r.PathValue("inviteID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid invite id"))
		return
	}
	if err := s.store.RevokeProjectInvite(r.Context(), user.ID, projectID, inviteID); err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) acceptProjectInvite(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &body); err != nil || strings.TrimSpace(body.Token) == "" {
		writeError(w, http.StatusBadRequest, errors.New("invite token is required"))
		return
	}
	projectID, err := s.store.AcceptProjectInvite(r.Context(), user.ID, body.Token)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"projectId": projectID.String()})
}
