package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/mailer"
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

// annotatePresence marks the members that have a live realtime connection
// on this API instance.
func (s *Server) annotatePresence(members []store.ProjectMember) {
	for index := range members {
		if id, err := uuid.Parse(members[index].UserID); err == nil {
			members[index].Online = s.hub.isOnline(id)
		}
	}
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
	for index := range projects {
		s.annotatePresence(projects[index].Members)
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
	s.annotatePresence(project.Members)
	// Collaboration syncs also run the owner's workspace sync, which is
	// where the owner's devices read their own project.
	s.notifyProjectMembers(r.Context(), uuid.Nil, "collaboration_required", projectID)
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
	s.annotatePresence(members)
	writeJSON(w, http.StatusOK, map[string]any{"members": members, "pendingInvites": invites, "role": role})
}

// projectActivity serves the activity grid of a project (?tz=Europe/Paris).
func (s *Server) projectActivity(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.settingsLimiter, "activity") {
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project id"))
		return
	}
	loc := time.UTC
	if name := r.URL.Query().Get("tz"); name != "" && len(name) <= 64 {
		if parsed, err := time.LoadLocation(name); err == nil {
			loc = parsed
		}
	}
	entries, err := s.store.ProjectActivity(r.Context(), user.ID, projectID, loc)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "days": store.ProjectActivityDays, "timeZone": loc.String()})
}

// inviteLink is the web page that accepts an invitation. It works for
// people without an account: they sign up with the invited email first.
func (s *Server) inviteLink(token string) string {
	return strings.TrimRight(s.webAppURL(), "/") + "/invite/" + url.PathEscape(token)
}

// sendInviteEmail emails an invitation. Delivery is best-effort: the invite
// exists either way, and the owner can still copy its link.
func (s *Server) sendInviteEmail(ctx context.Context, invite store.ProjectInvite, language string) bool {
	link := s.inviteLink(invite.InviteToken)
	message, err := mailer.RenderWith(mailer.KindProjectInvite, language, invite.Email, link, map[string]string{
		"inviter": invite.InviterName, "project": invite.ProjectName,
	})
	if err != nil {
		slog.Warn("invite email render failed", "error", err)
		return false
	}
	sendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := s.mail.Send(sendCtx, message); err != nil {
		slog.Warn("invite email failed", "error", err)
		return false
	}
	return true
}

// inviteResponse is what the share dialog needs to confirm an invitation:
// the invite, its link (shown once, to copy) and whether an email left.
func (s *Server) inviteResponse(invite store.ProjectInvite, emailSent bool) map[string]any {
	return map[string]any{"invite": invite, "inviteLink": s.inviteLink(invite.InviteToken), "emailSent": emailSent}
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
		Email    string `json:"email"`
		Role     string `json:"role"`
		Language string `json:"language"`
	}
	if err := decodeJSON(r, &body); err != nil || strings.TrimSpace(body.Email) == "" {
		writeError(w, http.StatusBadRequest, errors.New("invite email is required"))
		return
	}
	if !s.inviteLimiter.allow("invite:" + user.ID.String()) {
		writeRateLimited(w)
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
		// The owner's other devices show the new pending invite.
		s.notifySync(r.Context(), user.ID, "collaboration_required", 0)
		emailSent := s.sendInviteEmail(r.Context(), *invite, mailer.NormalizeLanguage(body.Language))
		writeJSON(w, http.StatusOK, s.inviteResponse(*invite, emailSent))
		return
	}
	s.notifyProjectMembers(r.Context(), uuid.Nil, "collaboration_required", projectID)
	writeJSON(w, http.StatusOK, map[string]any{"member": member})
}

// resendProjectInvite gives a pending invite a fresh link and, unless the
// body says {"email": false}, emails it again.
func (s *Server) resendProjectInvite(w http.ResponseWriter, r *http.Request) {
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
	var body struct {
		Email    *bool  `json:"email"`
		Language string `json:"language"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid invite request"))
			return
		}
	}
	sendEmail := body.Email == nil || *body.Email
	if sendEmail && !s.inviteLimiter.allow("invite:"+user.ID.String()) {
		writeRateLimited(w)
		return
	}
	invite, err := s.store.RotateProjectInvite(r.Context(), user.ID, projectID, inviteID)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	emailSent := false
	if sendEmail {
		emailSent = s.sendInviteEmail(r.Context(), invite, mailer.NormalizeLanguage(body.Language))
		if inviteeID, parseErr := uuid.Parse(invite.InviteeUserID); parseErr == nil {
			s.notifySync(r.Context(), inviteeID, "invites_required", 0)
		}
	}
	writeJSON(w, http.StatusOK, s.inviteResponse(invite, emailSent))
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
	// Everyone in the project sees the new role; the owner's other devices too.
	s.notifyProjectMembers(r.Context(), uuid.Nil, "collaboration_required", projectID)
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
	s.notifyProjectMembers(r.Context(), uuid.Nil, "collaboration_required", projectID)
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
	inviteeID, err := s.store.RevokeProjectInvite(r.Context(), user.ID, projectID, inviteID)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	if inviteeID != uuid.Nil {
		s.notifySync(r.Context(), inviteeID, "invites_required", 0)
	}
	s.notifySync(r.Context(), user.ID, "collaboration_required", 0)
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
	s.notifySync(r.Context(), user.ID, "invites_required", 0)
	s.notifyProjectMembers(r.Context(), uuid.Nil, "collaboration_required", projectID)
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
			s.notifyProjectMembers(r.Context(), inviterID, "collaboration_required", projectID)
		}
		writeJSON(w, http.StatusOK, map[string]string{"projectId": projectID.String()})
	}
}

// notifyProjectMembers sends eventType to the owner and active members of
// the projects, except skip (uuid.Nil skips nobody). Best-effort.
func (s *Server) notifyProjectMembers(ctx context.Context, skip uuid.UUID, eventType string, projectIDs ...uuid.UUID) {
	s.notifyProjectMembersRevision(ctx, skip, eventType, 0, projectIDs...)
}

func (s *Server) notifyProjectMembersRevision(ctx context.Context, skip uuid.UUID, eventType string, revision int64, projectIDs ...uuid.UUID) {
	if s.pool == nil || len(projectIDs) == 0 {
		return
	}
	members, err := s.store.ProjectMemberIDs(ctx, projectIDs)
	if err != nil {
		return
	}
	for _, member := range members {
		if member != skip {
			s.notifySync(ctx, member, eventType, revision)
		}
	}
}

// notifyProjectPeers tells everyone sharing a project with userID to sync,
// so shared projects stay live across accounts. Best-effort.
func (s *Server) notifyProjectPeers(ctx context.Context, userID uuid.UUID) {
	s.notifyProjectPeersEvent(ctx, userID, "collaboration_required")
}

func (s *Server) notifyProjectPeersEvent(ctx context.Context, userID uuid.UUID, eventType string) {
	if s.pool == nil {
		return
	}
	peers, err := s.store.ProjectPeerIDs(ctx, userID)
	if err != nil {
		return
	}
	for _, peer := range peers {
		s.notifySync(ctx, peer, eventType, 0)
	}
}
