package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

// Share links (specs/AGILE_COLLABORATION.md, "Share links"): a reusable
// editor or viewer link the project owner creates and anyone with an account
// can use to join after confirming. The link has the same /invite/<token>
// shape as an email invitation, so the client captures both the same way.

// planLimitError carries the 402 PLAN_LIMIT answer out of the join
// transaction.
type planLimitError struct{ limit, message string }

func (e *planLimitError) Error() string { return e.message }

// shareLinkResponse is a link plus, when it was just created, the URL to
// copy. Tokens are only stored hashed, so the URL cannot be shown again.
func (s *Server) shareLinkResponse(link store.ShareLink) map[string]any {
	response := map[string]any{"link": link}
	if link.Token != "" {
		response["inviteLink"] = s.inviteLink(link.Token)
	}
	return response
}

func (s *Server) listShareLinks(w http.ResponseWriter, r *http.Request) {
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
	links, err := s.store.ListShareLinks(r.Context(), user.ID, projectID)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"links": links})
}

// createShareLink makes (or rotates) the link of a role.
func (s *Server) createShareLink(w http.ResponseWriter, r *http.Request) {
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
		Role          string `json:"role"`
		ExpiresInDays int    `json:"expiresInDays"`
		MaxUses       int    `json:"maxUses"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid share link request"))
		return
	}
	if body.ExpiresInDays < 0 || body.ExpiresInDays > 365 || body.MaxUses < 0 {
		writeError(w, http.StatusBadRequest, errors.New("invalid share link limits"))
		return
	}
	if !s.inviteLimiter.allow("invite:" + user.ID.String()) {
		writeRateLimited(w)
		return
	}
	link, err := s.store.CreateShareLink(r.Context(), user.ID, projectID, body.Role, time.Duration(body.ExpiresInDays)*24*time.Hour, body.MaxUses)
	if err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	// The owner's other devices refresh their share dialog.
	s.notifySync(r.Context(), user.ID, "collaboration_required", 0)
	writeJSON(w, http.StatusOK, s.shareLinkResponse(link))
}

func (s *Server) revokeShareLink(w http.ResponseWriter, r *http.Request) {
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
	linkID, err := uuid.Parse(r.PathValue("linkID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid link id"))
		return
	}
	if err := s.store.RevokeShareLink(r.Context(), user.ID, projectID, linkID); err != nil {
		writeError(w, collaborationStatus(err), err)
		return
	}
	s.notifySync(r.Context(), user.ID, "collaboration_required", 0)
	w.WriteHeader(http.StatusNoContent)
}

// enforceShareLimit applies the owner's plan when a share link adds a
// person, the way checkShareLimit does for emailed invitations.
func (s *Server) enforceShareLimit(ctx context.Context, ownerID, projectID uuid.UUID) error {
	owner, err := s.store.UserByID(ctx, ownerID)
	if err != nil {
		return err
	}
	_, people, otherShared, err := s.store.ProjectShareSize(ctx, projectID)
	if err != nil {
		return err
	}
	ent, _, err := s.entitlements(ctx, owner)
	if err != nil {
		return err
	}
	if people == 1 && !ent.AllowsSharedProjects(otherShared+1) {
		return &planLimitError{"projects", fmt.Sprintf("this project's owner plan shares up to %d projects", ent.MaxSharedProjects)}
	}
	if !ent.AllowsMembers(people + 1) {
		return &planLimitError{"members", fmt.Sprintf("this project's owner plan allows %d people per shared project", ent.MaxMembersPerProject)}
	}
	return nil
}

// writeInviteError answers a failed invite or share-link request with a
// stable code the client turns into a friendly message.
func writeInviteError(w http.ResponseWriter, err error) {
	var limit *planLimitError
	switch {
	case errors.As(err, &limit):
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"code": "PLAN_LIMIT", "limit": limit.limit, "error": limit.message})
	case errors.Is(err, store.ErrShareLinkRevoked):
		writeJSON(w, http.StatusGone, map[string]string{"code": "LINK_REVOKED", "error": "this invitation link was disabled"})
	case errors.Is(err, store.ErrShareLinkExpired):
		writeJSON(w, http.StatusGone, map[string]string{"code": "LINK_EXPIRED", "error": "this invitation link has expired"})
	case errors.Is(err, store.ErrShareLinkExhausted):
		writeJSON(w, http.StatusGone, map[string]string{"code": "LINK_EXHAUSTED", "error": "this invitation link has no uses left"})
	case errors.Is(err, store.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"code": "INVITE_NOT_FOUND", "error": "this invitation is no longer valid"})
	default:
		status := collaborationStatus(err)
		if status == http.StatusInternalServerError {
			writeError(w, status, errors.New("unable to join the project"))
			return
		}
		writeError(w, status, err)
	}
}

// acceptProjectInvite joins a project with an invitation token: either an
// email invitation (the account must match its email) or a share link.
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
	if !s.inviteLimiter.allow("join:" + user.ID.String()) {
		writeRateLimited(w)
		return
	}
	projectID, err := s.store.AcceptProjectInvite(r.Context(), user.ID, body.Token)
	if err == nil {
		s.notifySync(r.Context(), user.ID, "invites_required", 0)
		s.notifyProjectMembers(r.Context(), uuid.Nil, "collaboration_required", projectID)
		writeJSON(w, http.StatusOK, map[string]string{"projectId": projectID.String(), "result": "joined"})
		return
	}
	if !errors.Is(err, store.ErrNotFound) {
		writeInviteError(w, err)
		return
	}
	joined, err := s.store.JoinShareLink(r.Context(), user.ID, body.Token, func(ownerID, projectID uuid.UUID) error {
		return s.enforceShareLimit(r.Context(), ownerID, projectID)
	})
	if err != nil {
		writeInviteError(w, err)
		return
	}
	if joined.Result != "already_member" {
		s.notifySync(r.Context(), user.ID, "invites_required", 0)
		// The owner (use count, member list) and every member refresh.
		s.notifyProjectMembers(r.Context(), uuid.Nil, "collaboration_required", joined.ProjectID)
	}
	writeJSON(w, http.StatusOK, map[string]string{"projectId": joined.ProjectID.String(), "result": joined.Result, "role": joined.Role})
}

// invitePreview is public: the invite landing shows it before sign-in. The
// token is the capability, and a wrong token reveals nothing. A signed-in
// caller also learns whether they already belong to the project.
func (s *Server) invitePreview(w http.ResponseWriter, r *http.Request) {
	viewer := uuid.Nil
	if bearer(r) != "" {
		if user, err := s.requireUser(r); err == nil {
			viewer = user.ID
		}
	}
	preview, err := s.store.InvitePreviewFor(r.Context(), r.URL.Query().Get("token"), viewer)
	if err != nil {
		writeGameError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, preview)
}
