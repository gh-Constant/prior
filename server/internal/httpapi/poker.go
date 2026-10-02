package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Planning Poker in shared projects (specs/SCRUM.md). Every write tells the
// project's members through /v1/realtime as "poker_required"; clients
// re-fetch the session, which hides other people's votes until the reveal.

func pokerStatus(err error) int {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, store.ErrPokerForbidden), errors.Is(err, store.ErrProjectReadOnly):
		return http.StatusForbidden
	case errors.Is(err, store.ErrPokerConflict):
		return http.StatusConflict
	case errors.Is(err, store.ErrPokerInvalid):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func writePokerError(w http.ResponseWriter, err error) {
	status := pokerStatus(err)
	if status == http.StatusInternalServerError {
		err = errors.New("unable to update planning poker")
	}
	writeError(w, status, err)
}

// pokerScope authenticates, rate-limits and parses the project id (and the
// session id when withSession is set).
func (s *Server) pokerScope(w http.ResponseWriter, r *http.Request, withSession bool) (store.User, uuid.UUID, uuid.UUID, bool) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return store.User{}, uuid.Nil, uuid.Nil, false
	}
	if !s.allowEndpoint(w, r, s.settingsLimiter, "poker") {
		return store.User{}, uuid.Nil, uuid.Nil, false
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid project id"))
		return store.User{}, uuid.Nil, uuid.Nil, false
	}
	sessionID := uuid.Nil
	if withSession {
		sessionID, err = uuid.Parse(r.PathValue("sessionID"))
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid session id"))
			return store.User{}, uuid.Nil, uuid.Nil, false
		}
	}
	return user, projectID, sessionID, true
}

// annotatePokerPresence marks the participants with a live realtime
// connection on this API instance.
func (s *Server) annotatePokerPresence(session *store.PokerSession) {
	for index := range session.Participants {
		if id, err := uuid.Parse(session.Participants[index].UserID); err == nil {
			session.Participants[index].Presence, session.Participants[index].LastSeenAt = s.presenceOf(id)
			session.Participants[index].Online = session.Participants[index].Presence != presenceOffline
		}
	}
}

func (s *Server) broadcastPoker(r *http.Request, audience []uuid.UUID) {
	for _, member := range audience {
		s.notifySync(r.Context(), member, "poker_required", 0)
	}
}

// finishPoker answers a successful write: it notifies the project and
// returns the session as the caller sees it.
func (s *Server) finishPoker(w http.ResponseWriter, r *http.Request, status int, session store.PokerSession, audience []uuid.UUID) {
	s.broadcastPoker(r, audience)
	s.annotatePokerPresence(&session)
	writeJSON(w, status, session)
}

func (s *Server) activePokerSession(w http.ResponseWriter, r *http.Request) {
	user, projectID, _, ok := s.pokerScope(w, r, false)
	if !ok {
		return
	}
	session, err := s.store.ActivePokerSession(r.Context(), user.ID, projectID)
	if err != nil {
		writePokerError(w, err)
		return
	}
	if session != nil {
		s.annotatePokerPresence(session)
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session})
}

func (s *Server) startPokerSession(w http.ResponseWriter, r *http.Request) {
	user, projectID, _, ok := s.pokerScope(w, r, false)
	if !ok {
		return
	}
	var body struct {
		TaskIDs []string `json:"taskIds"`
		Deck    string   `json:"deck"`
	}
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid planning poker request"))
		return
	}
	if len(body.TaskIDs) == 0 || len(body.TaskIDs) > 50 {
		writeError(w, http.StatusBadRequest, errors.New("choose between 1 and 50 tasks"))
		return
	}
	taskIDs := make([]uuid.UUID, 0, len(body.TaskIDs))
	for _, value := range body.TaskIDs {
		id, err := uuid.Parse(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid task id"))
			return
		}
		taskIDs = append(taskIDs, id)
	}
	session, audience, err := s.store.StartPokerSession(r.Context(), user.ID, projectID, taskIDs, body.Deck)
	if err != nil {
		writePokerError(w, err)
		return
	}
	s.finishPoker(w, r, http.StatusCreated, session, audience)
}

func (s *Server) getPokerSession(w http.ResponseWriter, r *http.Request) {
	user, projectID, sessionID, ok := s.pokerScope(w, r, true)
	if !ok {
		return
	}
	session, err := s.store.GetPokerSession(r.Context(), user.ID, projectID, sessionID)
	if err != nil {
		writePokerError(w, err)
		return
	}
	s.annotatePokerPresence(&session)
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) votePoker(w http.ResponseWriter, r *http.Request) {
	user, projectID, sessionID, ok := s.pokerScope(w, r, true)
	if !ok {
		return
	}
	var body struct {
		TaskID string  `json:"taskId"`
		Value  *string `json:"value"`
	}
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid vote"))
		return
	}
	taskID, err := uuid.Parse(body.TaskID)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid task id"))
		return
	}
	session, audience, err := s.store.CastPokerVote(r.Context(), user.ID, projectID, sessionID, taskID, body.Value)
	if err != nil {
		writePokerError(w, err)
		return
	}
	s.finishPoker(w, r, http.StatusOK, session, audience)
}

// pokerAction serves the body-less controller actions.
func (s *Server) pokerAction(action func(*store.Store, *http.Request, store.User, uuid.UUID, uuid.UUID) (store.PokerSession, []uuid.UUID, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, projectID, sessionID, ok := s.pokerScope(w, r, true)
		if !ok {
			return
		}
		session, audience, err := action(s.store, r, user, projectID, sessionID)
		if err != nil {
			writePokerError(w, err)
			return
		}
		s.finishPoker(w, r, http.StatusOK, session, audience)
	}
}

func (s *Server) revealPoker() http.HandlerFunc {
	return s.pokerAction(func(st *store.Store, r *http.Request, user store.User, projectID, sessionID uuid.UUID) (store.PokerSession, []uuid.UUID, error) {
		return st.RevealPoker(r.Context(), user.ID, projectID, sessionID)
	})
}

func (s *Server) revotePoker() http.HandlerFunc {
	return s.pokerAction(func(st *store.Store, r *http.Request, user store.User, projectID, sessionID uuid.UUID) (store.PokerSession, []uuid.UUID, error) {
		return st.RevotePoker(r.Context(), user.ID, projectID, sessionID)
	})
}

func (s *Server) closePoker() http.HandlerFunc {
	return s.pokerAction(func(st *store.Store, r *http.Request, user store.User, projectID, sessionID uuid.UUID) (store.PokerSession, []uuid.UUID, error) {
		return st.ClosePokerSession(r.Context(), user.ID, projectID, sessionID)
	})
}

func (s *Server) setPokerCurrent(w http.ResponseWriter, r *http.Request) {
	user, projectID, sessionID, ok := s.pokerScope(w, r, true)
	if !ok {
		return
	}
	var body struct {
		Index *int `json:"index"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.Index == nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid task index"))
		return
	}
	session, audience, err := s.store.SetPokerCurrent(r.Context(), user.ID, projectID, sessionID, *body.Index)
	if err != nil {
		writePokerError(w, err)
		return
	}
	s.finishPoker(w, r, http.StatusOK, session, audience)
}

// estimatePoker writes the agreed story points on the task through Push (so
// the change syncs and lands in the task change log, and the usual editor
// check applies), then records the decision and moves the session on.
func (s *Server) estimatePoker(w http.ResponseWriter, r *http.Request) {
	user, projectID, sessionID, ok := s.pokerScope(w, r, true)
	if !ok {
		return
	}
	var body struct {
		TaskID      string   `json:"taskId"`
		StoryPoints *float64 `json:"storyPoints"`
		Advance     bool     `json:"advance"`
	}
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid estimate"))
		return
	}
	taskID, err := uuid.Parse(body.TaskID)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid task id"))
		return
	}
	points, err := tasks.NormalizeStoryPoints(body.StoryPoints)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx := r.Context()
	if err := s.store.CheckPokerEstimate(ctx, user.ID, projectID, sessionID, taskID); err != nil {
		writePokerError(w, err)
		return
	}
	task, err := s.store.CurrentTask(ctx, user.ID, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, store.ErrNotFound)
		return
	}
	if err != nil {
		writePokerError(w, err)
		return
	}
	if task.ProjectID == nil || *task.ProjectID != projectID.String() {
		writeError(w, http.StatusConflict, errors.New("that task is not in this project"))
		return
	}
	now := time.Now().UTC()
	task.StoryPoints = points
	task.UpdatedAt = now
	results, err := s.store.Push(ctx, user.ID, []tasks.Mutation{{
		ID: uuid.NewString(), Kind: "upsert", Entity: "task", Task: task, CreatedAt: now.Format(time.RFC3339Nano),
	}})
	if err != nil || len(results) != 1 {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save the estimate"))
		return
	}
	if !results[0].OK {
		status := http.StatusBadRequest
		switch results[0].Error.Code {
		case "FORBIDDEN":
			status = http.StatusForbidden
		case "NOT_FOUND":
			status = http.StatusNotFound
		case "CONFLICT":
			status = http.StatusConflict
		}
		writeError(w, status, errors.New(results[0].Error.Message))
		return
	}
	applied := store.PushApplied(results)
	s.highestBroadcast(user.ID, applied)
	latest := highestRevision(applied)
	s.notifySync(ctx, user.ID, "sync", latest)
	s.notifySync(ctx, user.ID, "tasks_required", latest)
	s.notifyProjectMembersRevision(ctx, user.ID, "tasks_required", latest, projectID)

	session, audience, err := s.store.RecordPokerEstimate(ctx, user.ID, projectID, sessionID, taskID, points, body.Advance)
	if err != nil {
		// The task is already estimated and synced; tell the table anyway.
		s.broadcastPoker(r, []uuid.UUID{user.ID})
		writePokerError(w, err)
		return
	}
	s.broadcastPoker(r, audience)
	s.annotatePokerPresence(&session)
	writeJSON(w, http.StatusOK, map[string]any{"session": session, "task": results[0].Task})
}
