package httpapi

import (
	"errors"
	"net/http"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

// Task comments in shared projects (specs/COMMENTS.md). Live updates go over
// /v1/realtime as "comments_required" (every project member) and
// "mentions_required" (people newly mentioned); clients re-fetch.

func commentStatus(err error) int {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, store.ErrCommentForbidden), errors.Is(err, store.ErrProjectReadOnly):
		return http.StatusForbidden
	default:
		return collaborationStatus(err)
	}
}

func (s *Server) commentScope(w http.ResponseWriter, r *http.Request) (store.User, uuid.UUID, uuid.UUID, bool) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return store.User{}, uuid.Nil, uuid.Nil, false
	}
	if !s.allowEndpoint(w, r, s.settingsLimiter, "comments") {
		return store.User{}, uuid.Nil, uuid.Nil, false
	}
	projectID, projectErr := uuid.Parse(r.PathValue("projectID"))
	taskID, taskErr := uuid.Parse(r.PathValue("taskID"))
	if projectErr != nil || taskErr != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project or task id"))
		return store.User{}, uuid.Nil, uuid.Nil, false
	}
	return user, projectID, taskID, true
}

func (s *Server) broadcastComments(r *http.Request, audience []uuid.UUID, mentioned []uuid.UUID) {
	for _, member := range audience {
		s.notifySync(r.Context(), member, "comments_required", 0)
	}
	for _, member := range mentioned {
		s.notifySync(r.Context(), member, "mentions_required", 0)
	}
}

func (s *Server) listTaskComments(w http.ResponseWriter, r *http.Request) {
	user, projectID, taskID, ok := s.commentScope(w, r)
	if !ok {
		return
	}
	comments, err := s.store.ListTaskComments(r.Context(), user.ID, projectID, taskID)
	if err != nil {
		writeError(w, commentStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"comments": comments})
}

type commentBody struct {
	ID       string   `json:"id"`
	Body     string   `json:"body"`
	Mentions []string `json:"mentions"`
}

func (s *Server) createTaskComment(w http.ResponseWriter, r *http.Request) {
	user, projectID, taskID, ok := s.commentScope(w, r)
	if !ok {
		return
	}
	var body commentBody
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid comment"))
		return
	}
	commentID := uuid.Nil
	if body.ID != "" {
		parsed, err := uuid.Parse(body.ID)
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid comment id"))
			return
		}
		commentID = parsed
	}
	change, err := s.store.CreateTaskComment(r.Context(), user.ID, projectID, taskID, commentID, body.Body, body.Mentions)
	if err != nil {
		status := commentStatus(err)
		if status == http.StatusInternalServerError && !errors.Is(err, store.ErrNotFound) {
			status = http.StatusBadRequest
		}
		writeError(w, status, err)
		return
	}
	s.broadcastComments(r, change.Audience, change.NewMention)
	writeJSON(w, http.StatusCreated, change.Comment)
}

func (s *Server) updateTaskComment(w http.ResponseWriter, r *http.Request) {
	user, projectID, taskID, ok := s.commentScope(w, r)
	if !ok {
		return
	}
	commentID, err := uuid.Parse(r.PathValue("commentID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid comment id"))
		return
	}
	var body commentBody
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid comment"))
		return
	}
	change, err := s.store.UpdateTaskComment(r.Context(), user.ID, projectID, taskID, commentID, body.Body, body.Mentions)
	if err != nil {
		status := commentStatus(err)
		if status == http.StatusInternalServerError {
			status = http.StatusBadRequest
		}
		writeError(w, status, err)
		return
	}
	s.broadcastComments(r, change.Audience, change.NewMention)
	writeJSON(w, http.StatusOK, change.Comment)
}

func (s *Server) deleteTaskComment(w http.ResponseWriter, r *http.Request) {
	user, projectID, taskID, ok := s.commentScope(w, r)
	if !ok {
		return
	}
	commentID, err := uuid.Parse(r.PathValue("commentID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid comment id"))
		return
	}
	audience, err := s.store.DeleteTaskComment(r.Context(), user.ID, projectID, taskID, commentID)
	if err != nil {
		writeError(w, commentStatus(err), err)
		return
	}
	s.broadcastComments(r, audience, nil)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listMentions(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.settingsLimiter, "mentions") {
		return
	}
	mentions, unread, err := s.store.ListMentions(r.Context(), user.ID, 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load mentions"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mentions": mentions, "unread": unread})
}

func (s *Server) readMentions(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.settingsLimiter, "mentions") {
		return
	}
	var body struct {
		CommentIDs []string `json:"commentIds"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || len(body.CommentIDs) > 200 {
		writeError(w, http.StatusBadRequest, errors.New("invalid request"))
		return
	}
	ids := make([]uuid.UUID, 0, len(body.CommentIDs))
	for _, value := range body.CommentIDs {
		id, err := uuid.Parse(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid comment id"))
			return
		}
		ids = append(ids, id)
	}
	if err := s.store.MarkMentionsRead(r.Context(), user.ID, ids); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to update mentions"))
		return
	}
	s.notifySync(r.Context(), user.ID, "mentions_required", 0)
	w.WriteHeader(http.StatusNoContent)
}
