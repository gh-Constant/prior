package httpapi

import (
	"context"
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

func (s *Server) updateCollaborativeProject(w http.ResponseWriter, r *http.Request) {
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
	var patch store.ProjectPlanningPatch
	if err := decodeJSON(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project planning update"))
		return
	}
	project, err := s.store.UpdateCollaborativeProjectPlanning(r.Context(), user.ID, projectID, patch)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	s.notifyProjectPeers(r.Context(), user.ID)
	writeJSON(w, http.StatusOK, project)
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
	limit, message, err := s.checkShareLimit(r.Context(), user, projectID, body.Email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to check your plan"))
		return
	}
	if limit != "" {
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"code": "PLAN_LIMIT", "limit": limit, "error": message})
		return
	}
	member, invite, err := s.store.ShareProject(r.Context(), user.ID, projectID, body.Email, body.Role)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	if invite != nil {
		if inviteeID, parseErr := uuid.Parse(invite.InviteeUserID); parseErr == nil {
			s.notifySync(r.Context(), inviteeID, "invites_required", 0)
		}
		writeJSON(w, http.StatusOK, map[string]any{"invite": invite})
		return
	}
	s.notifyProjectPeers(r.Context(), user.ID)
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
	s.notifySync(r.Context(), memberID, "collaboration_required", 0)
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
	s.notifySync(r.Context(), memberID, "collaboration_required", 0)
	s.notifyProjectPeers(r.Context(), user.ID)
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

func (s *Server) incomingInvites(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	invites, err := s.store.ListIncomingInvites(r.Context(), user.ID)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": invites})
}

func (s *Server) respondToInvite(accept bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.requireUser(r)
		if err != nil {
			writeUnauthorized(w, err)
			return
		}
		inviteID, err := uuid.Parse(r.PathValue("inviteID"))
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid invite id"))
			return
		}
		projectID, inviterID, err := s.store.RespondToInvite(r.Context(), user.ID, inviteID, accept)
		if err != nil {
			writeError(w, collaborationStatus(err), err)
			return
		}
		s.notifySync(r.Context(), user.ID, "invites_required", 0)
		s.notifySync(r.Context(), inviterID, "collaboration_required", 0)
		if accept {
			s.notifyProjectPeers(r.Context(), user.ID)
		}
		writeJSON(w, http.StatusOK, map[string]string{"projectId": projectID.String()})
	}
}

// notifyProjectPeers tells everyone sharing a project with userID to sync,
// so shared projects stay live across accounts. Best-effort.
func (s *Server) notifyProjectPeers(ctx context.Context, userID uuid.UUID) {
	if s.pool == nil {
		return
	}
	peers, err := s.store.ProjectPeerIDs(ctx, userID)
	if err != nil {
		return
	}
	for _, peer := range peers {
		s.notifySync(ctx, peer, "collaboration_required", 0)
	}
}
