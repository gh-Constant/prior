package store

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Planning Poker for shared projects (specs/SCRUM.md). A facilitator walks a
// list of tasks; owners and editors vote with cards, the votes stay hidden
// from everyone else until the facilitator reveals them, and the agreed
// story points are written to the task through Push. Every operation is one
// transaction that locks the session row, so concurrent votes and reveals
// serialize. A vote's value never leaves the database before the reveal
// except to the voter themself.

const (
	pokerStatusActive = "active"
	pokerStatusClosed = "closed"
	maxPokerItems     = 50
	// pokerIdleHours closes a session nobody touched for that long;
	// pokerRetentionDays deletes closed sessions after that long.
	pokerIdleHours     = 12
	pokerRetentionDays = 30
)

// PokerDecks lists the cards of each deck, in display order. It must match
// POKER_DECKS in app/src/lib/poker.ts. "?" and "coffee" are cards that carry
// no points.
var PokerDecks = map[string][]string{
	"fibonacci": {"0", "1", "2", "3", "5", "8", "13", "21", "?", "coffee"},
	"modified":  {"0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "100", "?", "coffee"},
	"tshirt":    {"XS", "S", "M", "L", "XL", "?", "coffee"},
}

var (
	ErrPokerForbidden = errors.New("only the poker facilitator can do that")
	ErrPokerConflict  = errors.New("poker session conflict")
	ErrPokerInvalid   = errors.New("invalid poker request")
)

// PokerError carries a user-facing message for one of the poker error kinds.
type PokerError struct {
	Kind    error
	Message string
}

func (e *PokerError) Error() string { return e.Message }
func (e *PokerError) Unwrap() error { return e.Kind }

func pokerConflict(message string) error {
	return &PokerError{Kind: ErrPokerConflict, Message: message}
}
func pokerInvalid(message string) error { return &PokerError{Kind: ErrPokerInvalid, Message: message} }

type PokerItem struct {
	TaskID      string   `json:"taskId"`
	Title       string   `json:"title"`
	StoryPoints *float64 `json:"storyPoints"`
	FinalPoints *float64 `json:"finalPoints"`
}

type PokerParticipant struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl"`
	Role        string `json:"role"`
	// Online and Presence are filled by the API from live realtime connections.
	Online     bool       `json:"online"`
	Presence   string     `json:"presence"`
	LastSeenAt *time.Time `json:"lastSeenAt,omitempty"`
	Voted      bool       `json:"voted"`
	// Vote is null until the votes are revealed.
	Vote *string `json:"vote"`
}

type PokerSession struct {
	ID            string             `json:"id"`
	ProjectID     string             `json:"projectId"`
	Status        string             `json:"status"`
	Deck          string             `json:"deck"`
	FacilitatorID *string            `json:"facilitatorId"`
	CanControl    bool               `json:"canControl"`
	CurrentIndex  int                `json:"currentIndex"`
	Round         int                `json:"round"`
	Revealed      bool               `json:"revealed"`
	Items         []PokerItem        `json:"items"`
	Participants  []PokerParticipant `json:"participants"`
	MyVote        *string            `json:"myVote"`
	CreatedAt     time.Time          `json:"createdAt"`
	UpdatedAt     time.Time          `json:"updatedAt"`
}

type pokerRow struct {
	id           uuid.UUID
	projectID    uuid.UUID
	facilitator  *uuid.UUID
	deck         string
	status       string
	currentIndex int
	round        int
	revealed     bool
	createdAt    time.Time
	updatedAt    time.Time
}

const pokerRowColumns = `id, project_id, facilitator_id, deck, status, current_index, round, revealed, created_at, updated_at`

func scanPokerRow(row pgx.Row) (pokerRow, error) {
	var r pokerRow
	err := row.Scan(&r.id, &r.projectID, &r.facilitator, &r.deck, &r.status, &r.currentIndex, &r.round, &r.revealed, &r.createdAt, &r.updatedAt)
	return r, err
}

// pokerRowTx reads a session of the project, optionally locking it.
func pokerRowTx(ctx context.Context, tx pgx.Tx, projectID, sessionID uuid.UUID, lock bool) (pokerRow, error) {
	query := `SELECT ` + pokerRowColumns + ` FROM poker_sessions WHERE id = $1 AND project_id = $2`
	if lock {
		query += ` FOR UPDATE`
	}
	row, err := scanPokerRow(tx.QueryRow(ctx, query, sessionID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return pokerRow{}, ErrNotFound
	}
	return row, err
}

// pokerItemsTx lists the session's tasks that are still live in the project,
// in order. Tasks that were deleted or moved away are skipped.
func pokerItemsTx(ctx context.Context, tx pgx.Tx, sessionID uuid.UUID) ([]PokerItem, error) {
	rows, err := tx.Query(ctx, `
		SELECT i.task_id::text, t.title, t.story_points, i.final_points
		FROM poker_items i
		JOIN poker_sessions s ON s.id = i.session_id
		JOIN tasks t ON t.id = i.task_id AND t.project_id = s.project_id AND t.deleted_at IS NULL
		WHERE i.session_id = $1
		ORDER BY i.position`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []PokerItem{}
	for rows.Next() {
		var item PokerItem
		if err := rows.Scan(&item.TaskID, &item.Title, &item.StoryPoints, &item.FinalPoints); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// clampPokerIndex keeps the stored index inside the live items.
func clampPokerIndex(index, length int) int {
	if index >= length {
		index = length - 1
	}
	if index < 0 {
		index = 0
	}
	return index
}

func isEditorRole(role string) bool { return role == "owner" || role == "editor" }

// pokerControllerTx reports whether the user may run the session: the
// project owner, the facilitator, or any editor once the facilitator is gone
// (deleted account, left the project or demoted to viewer).
func pokerControllerTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, role string, row pokerRow) (bool, error) {
	if !isEditorRole(role) {
		return false, nil
	}
	if role == "owner" || row.facilitator == nil || *row.facilitator == userID {
		return true, nil
	}
	facilitatorRole, err := projectRoleTx(ctx, tx, *row.facilitator, row.projectID)
	if errors.Is(err, ErrNotFound) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return !isEditorRole(facilitatorRole), nil
}

// loadPokerSessionTx builds the session as the viewer may see it: everyone's
// votes are hidden (only whether they voted) until the reveal.
func loadPokerSessionTx(ctx context.Context, tx pgx.Tx, viewerID uuid.UUID, role string, row pokerRow) (PokerSession, error) {
	items, err := pokerItemsTx(ctx, tx, row.id)
	if err != nil {
		return PokerSession{}, err
	}
	controller, err := pokerControllerTx(ctx, tx, viewerID, role, row)
	if err != nil {
		return PokerSession{}, err
	}
	session := PokerSession{
		ID: row.id.String(), ProjectID: row.projectID.String(), Status: row.status, Deck: row.deck,
		CanControl: controller, CurrentIndex: clampPokerIndex(row.currentIndex, len(items)),
		Round: row.round, Revealed: row.revealed, Items: items, Participants: []PokerParticipant{},
		CreatedAt: row.createdAt, UpdatedAt: row.updatedAt,
	}
	if row.facilitator != nil {
		id := row.facilitator.String()
		session.FacilitatorID = &id
	}

	votes := map[string]string{}
	if len(items) > 0 {
		rows, err := tx.Query(ctx, `
			SELECT user_id::text, value FROM poker_votes
			WHERE session_id = $1 AND task_id = $2 AND round = $3`, row.id, items[session.CurrentIndex].TaskID, row.round)
		if err != nil {
			return PokerSession{}, err
		}
		for rows.Next() {
			var userID, value string
			if err := rows.Scan(&userID, &value); err != nil {
				rows.Close()
				return PokerSession{}, err
			}
			votes[userID] = value
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return PokerSession{}, err
		}
	}

	people, err := tx.Query(ctx, `
		SELECT id, display_name, avatar_url, role FROM (
			SELECT u.id::text AS id, COALESCE(u.display_name, '') AS display_name, COALESCE(u.avatar_url, '') AS avatar_url,
				'owner' AS role, 0 AS ord, p.created_at AS joined
			FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = $1
			UNION ALL
			SELECT u.id::text, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''), pm.role, 1, pm.created_at
			FROM project_members pm
			JOIN projects p ON p.id = pm.project_id
			JOIN users u ON u.id = pm.user_id
			WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.user_id <> p.user_id
		) members ORDER BY ord, joined, id`, row.projectID)
	if err != nil {
		return PokerSession{}, err
	}
	defer people.Close()
	for people.Next() {
		var person PokerParticipant
		if err := people.Scan(&person.UserID, &person.DisplayName, &person.AvatarURL, &person.Role); err != nil {
			return PokerSession{}, err
		}
		if value, ok := votes[person.UserID]; ok {
			person.Voted = true
			if row.revealed {
				v := value
				person.Vote = &v
			}
			if person.UserID == viewerID.String() {
				mine := value
				session.MyVote = &mine
			}
		}
		session.Participants = append(session.Participants, person)
	}
	return session, people.Err()
}

// ActivePokerSession returns the project's running session, or nil.
func (s *Store) ActivePokerSession(ctx context.Context, userID, projectID uuid.UUID) (*PokerSession, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	role, err := projectRoleTx(ctx, tx, userID, projectID)
	if err != nil {
		return nil, err
	}
	row, err := scanPokerRow(tx.QueryRow(ctx, `
		SELECT `+pokerRowColumns+` FROM poker_sessions WHERE project_id = $1 AND status = 'active'`, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, tx.Commit(ctx)
	}
	if err != nil {
		return nil, err
	}
	session, err := loadPokerSessionTx(ctx, tx, userID, role, row)
	if err != nil {
		return nil, err
	}
	return &session, tx.Commit(ctx)
}

// GetPokerSession returns one session of the project (active or closed).
func (s *Store) GetPokerSession(ctx context.Context, userID, projectID, sessionID uuid.UUID) (PokerSession, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PokerSession{}, err
	}
	defer tx.Rollback(ctx)
	role, err := projectRoleTx(ctx, tx, userID, projectID)
	if err != nil {
		return PokerSession{}, err
	}
	row, err := pokerRowTx(ctx, tx, projectID, sessionID, false)
	if err != nil {
		return PokerSession{}, err
	}
	session, err := loadPokerSessionTx(ctx, tx, userID, role, row)
	if err != nil {
		return PokerSession{}, err
	}
	return session, tx.Commit(ctx)
}

// StartPokerSession opens a session over the given tasks (1 to 50, all live
// tasks of the project). The caller becomes the facilitator. A project has at
// most one active session.
func (s *Store) StartPokerSession(ctx context.Context, userID, projectID uuid.UUID, taskIDs []uuid.UUID, deck string) (PokerSession, []uuid.UUID, error) {
	if _, ok := PokerDecks[deck]; !ok {
		return PokerSession{}, nil, pokerInvalid("unknown deck")
	}
	unique := make([]uuid.UUID, 0, len(taskIDs))
	for _, id := range taskIDs {
		if !slices.Contains(unique, id) {
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 || len(unique) > maxPokerItems {
		return PokerSession{}, nil, pokerInvalid("choose between 1 and 50 tasks")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PokerSession{}, nil, err
	}
	defer tx.Rollback(ctx)
	role, err := projectRoleTx(ctx, tx, userID, projectID)
	if err != nil {
		return PokerSession{}, nil, err
	}
	if !isEditorRole(role) {
		return PokerSession{}, nil, ErrProjectReadOnly
	}
	var found int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE id = ANY($1) AND project_id = $2 AND deleted_at IS NULL`, unique, projectID).Scan(&found); err != nil {
		return PokerSession{}, nil, err
	}
	if found != len(unique) {
		return PokerSession{}, nil, pokerInvalid("some tasks are not in this project")
	}
	// An abandoned session must not block a new one until the cleanup runs.
	if _, err := tx.Exec(ctx, `
		UPDATE poker_sessions SET status = 'closed', closed_at = now(), updated_at = now()
		WHERE project_id = $1 AND status = 'active' AND updated_at < now() - make_interval(hours => $2)`, projectID, pokerIdleHours); err != nil {
		return PokerSession{}, nil, err
	}
	var active bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM poker_sessions WHERE project_id = $1 AND status = 'active')`, projectID).Scan(&active); err != nil {
		return PokerSession{}, nil, err
	}
	if active {
		return PokerSession{}, nil, pokerConflict("a planning poker session is already running in this project")
	}
	sessionID := uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO poker_sessions (id, project_id, facilitator_id, deck) VALUES ($1, $2, $3, $4)`, sessionID, projectID, userID, deck); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return PokerSession{}, nil, pokerConflict("a planning poker session is already running in this project")
		}
		return PokerSession{}, nil, err
	}
	for position, taskID := range unique {
		if _, err := tx.Exec(ctx, `INSERT INTO poker_items (session_id, task_id, position) VALUES ($1, $2, $3)`, sessionID, taskID, position); err != nil {
			return PokerSession{}, nil, err
		}
	}
	row, err := pokerRowTx(ctx, tx, projectID, sessionID, false)
	if err != nil {
		return PokerSession{}, nil, err
	}
	session, err := loadPokerSessionTx(ctx, tx, userID, role, row)
	if err != nil {
		return PokerSession{}, nil, err
	}
	audience, err := projectAudienceTx(ctx, tx, projectID)
	if err != nil {
		return PokerSession{}, nil, err
	}
	return session, audience, tx.Commit(ctx)
}

// pokerContext is what a mutation sees: the locked session, its live items
// and the caller's rights.
type pokerContext struct {
	role       string
	controller bool
	row        pokerRow
	items      []PokerItem
}

// current returns the task being estimated, if any.
func (c pokerContext) current() (PokerItem, bool) {
	if len(c.items) == 0 {
		return PokerItem{}, false
	}
	return c.items[clampPokerIndex(c.row.currentIndex, len(c.items))], true
}

func (c pokerContext) requireController() error {
	if !c.controller {
		return ErrPokerForbidden
	}
	return nil
}

func (c pokerContext) requireActive() error {
	if c.row.status != pokerStatusActive {
		return pokerConflict("this planning poker session is closed")
	}
	return nil
}

// requireCurrent checks the session runs and taskID is the task on the table.
func (c pokerContext) requireCurrent(taskID uuid.UUID) error {
	if err := c.requireActive(); err != nil {
		return err
	}
	current, ok := c.current()
	if !ok || current.TaskID != taskID.String() {
		return pokerConflict("that task is not the one being estimated")
	}
	return nil
}

// mutatePoker runs fn on the locked session and returns the updated session
// as the caller sees it, plus everyone to notify.
func (s *Store) mutatePoker(ctx context.Context, userID, projectID, sessionID uuid.UUID, fn func(tx pgx.Tx, c *pokerContext) error) (PokerSession, []uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PokerSession{}, nil, err
	}
	defer tx.Rollback(ctx)
	role, err := projectRoleTx(ctx, tx, userID, projectID)
	if err != nil {
		return PokerSession{}, nil, err
	}
	row, err := pokerRowTx(ctx, tx, projectID, sessionID, true)
	if err != nil {
		return PokerSession{}, nil, err
	}
	items, err := pokerItemsTx(ctx, tx, sessionID)
	if err != nil {
		return PokerSession{}, nil, err
	}
	controller, err := pokerControllerTx(ctx, tx, userID, role, row)
	if err != nil {
		return PokerSession{}, nil, err
	}
	c := &pokerContext{role: role, controller: controller, row: row, items: items}
	if err := fn(tx, c); err != nil {
		return PokerSession{}, nil, err
	}
	row, err = pokerRowTx(ctx, tx, projectID, sessionID, false)
	if err != nil {
		return PokerSession{}, nil, err
	}
	session, err := loadPokerSessionTx(ctx, tx, userID, role, row)
	if err != nil {
		return PokerSession{}, nil, err
	}
	audience, err := projectAudienceTx(ctx, tx, projectID)
	if err != nil {
		return PokerSession{}, nil, err
	}
	return session, audience, tx.Commit(ctx)
}

func touchPokerTx(ctx context.Context, tx pgx.Tx, sessionID uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE poker_sessions SET updated_at = now() WHERE id = $1`, sessionID)
	return err
}

// CastPokerVote records (or, with a nil value, withdraws) the caller's vote
// on the current task. Only owners and editors vote, and only before the
// reveal. The value must be a card of the session's deck.
func (s *Store) CastPokerVote(ctx context.Context, userID, projectID, sessionID, taskID uuid.UUID, value *string) (PokerSession, []uuid.UUID, error) {
	return s.mutatePoker(ctx, userID, projectID, sessionID, func(tx pgx.Tx, c *pokerContext) error {
		if !isEditorRole(c.role) {
			return ErrProjectReadOnly
		}
		if err := c.requireCurrent(taskID); err != nil {
			return err
		}
		if c.row.revealed {
			return pokerConflict("the votes are already revealed")
		}
		if value == nil {
			if _, err := tx.Exec(ctx, `
				DELETE FROM poker_votes WHERE session_id = $1 AND task_id = $2 AND round = $3 AND user_id = $4`,
				c.row.id, taskID, c.row.round, userID); err != nil {
				return err
			}
			return touchPokerTx(ctx, tx, c.row.id)
		}
		if !slices.Contains(PokerDecks[c.row.deck], *value) {
			return pokerInvalid("that card is not in this deck")
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO poker_votes (session_id, task_id, round, user_id, value) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (session_id, task_id, round, user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
			c.row.id, taskID, c.row.round, userID, *value); err != nil {
			return err
		}
		return touchPokerTx(ctx, tx, c.row.id)
	})
}

// RevealPoker shows everyone's votes on the current task.
func (s *Store) RevealPoker(ctx context.Context, userID, projectID, sessionID uuid.UUID) (PokerSession, []uuid.UUID, error) {
	return s.mutatePoker(ctx, userID, projectID, sessionID, func(tx pgx.Tx, c *pokerContext) error {
		if err := c.requireController(); err != nil {
			return err
		}
		if err := c.requireActive(); err != nil {
			return err
		}
		if _, ok := c.current(); !ok {
			return pokerConflict("there is no task to estimate")
		}
		_, err := tx.Exec(ctx, `UPDATE poker_sessions SET revealed = true, updated_at = now() WHERE id = $1`, c.row.id)
		return err
	})
}

// RevotePoker discards the current votes and starts another round.
func (s *Store) RevotePoker(ctx context.Context, userID, projectID, sessionID uuid.UUID) (PokerSession, []uuid.UUID, error) {
	return s.mutatePoker(ctx, userID, projectID, sessionID, func(tx pgx.Tx, c *pokerContext) error {
		if err := c.requireController(); err != nil {
			return err
		}
		if err := c.requireActive(); err != nil {
			return err
		}
		current, ok := c.current()
		if !ok {
			return pokerConflict("there is no task to estimate")
		}
		if _, err := tx.Exec(ctx, `DELETE FROM poker_votes WHERE session_id = $1 AND task_id = $2`, c.row.id, current.TaskID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE poker_sessions SET round = round + 1, revealed = false, updated_at = now() WHERE id = $1`, c.row.id)
		return err
	})
}

// moveToPokerItemTx puts another item on the table with a fresh first round.
func moveToPokerItemTx(ctx context.Context, tx pgx.Tx, c *pokerContext, index int) error {
	if _, err := tx.Exec(ctx, `DELETE FROM poker_votes WHERE session_id = $1 AND task_id = $2`, c.row.id, c.items[index].TaskID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE poker_sessions SET current_index = $2, round = 1, revealed = false, updated_at = now() WHERE id = $1`, c.row.id, index)
	return err
}

// SetPokerCurrent puts the item at index (into the live items) on the table.
func (s *Store) SetPokerCurrent(ctx context.Context, userID, projectID, sessionID uuid.UUID, index int) (PokerSession, []uuid.UUID, error) {
	return s.mutatePoker(ctx, userID, projectID, sessionID, func(tx pgx.Tx, c *pokerContext) error {
		if err := c.requireController(); err != nil {
			return err
		}
		if err := c.requireActive(); err != nil {
			return err
		}
		if index < 0 || index >= len(c.items) {
			return pokerInvalid("invalid task index")
		}
		if index == clampPokerIndex(c.row.currentIndex, len(c.items)) {
			return nil
		}
		return moveToPokerItemTx(ctx, tx, c, index)
	})
}

// CheckPokerEstimate verifies that the caller may record an estimate for
// taskId now: they run the session, it is active and taskId is on the table.
func (s *Store) CheckPokerEstimate(ctx context.Context, userID, projectID, sessionID, taskID uuid.UUID) error {
	_, _, err := s.mutatePoker(ctx, userID, projectID, sessionID, func(_ pgx.Tx, c *pokerContext) error {
		if err := c.requireController(); err != nil {
			return err
		}
		return c.requireCurrent(taskID)
	})
	return err
}

// RecordPokerEstimate stores the decision for the current task (points nil
// means "no estimate") and, when advance is set and another task follows,
// moves on to it with a fresh round. The task itself was already updated
// through Push. On the last task the votes stay on the table.
func (s *Store) RecordPokerEstimate(ctx context.Context, userID, projectID, sessionID, taskID uuid.UUID, points *float64, advance bool) (PokerSession, []uuid.UUID, error) {
	return s.mutatePoker(ctx, userID, projectID, sessionID, func(tx pgx.Tx, c *pokerContext) error {
		if err := c.requireController(); err != nil {
			return err
		}
		if err := c.requireCurrent(taskID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE poker_items SET final_points = $3, decided_by = $4, decided_at = now()
			WHERE session_id = $1 AND task_id = $2`, c.row.id, taskID, points, userID); err != nil {
			return err
		}
		index := clampPokerIndex(c.row.currentIndex, len(c.items))
		if advance && index+1 < len(c.items) {
			return moveToPokerItemTx(ctx, tx, c, index+1)
		}
		return touchPokerTx(ctx, tx, c.row.id)
	})
}

// ClosePokerSession ends the session. Closing a closed session is a no-op.
func (s *Store) ClosePokerSession(ctx context.Context, userID, projectID, sessionID uuid.UUID) (PokerSession, []uuid.UUID, error) {
	return s.mutatePoker(ctx, userID, projectID, sessionID, func(tx pgx.Tx, c *pokerContext) error {
		if err := c.requireController(); err != nil {
			return err
		}
		if c.row.status == pokerStatusClosed {
			return nil
		}
		_, err := tx.Exec(ctx, `UPDATE poker_sessions SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`, c.row.id)
		return err
	})
}

// ExpirePokerSessions closes sessions idle for 12 hours and deletes closed
// ones after 30 days. It returns how many sessions it closed and deleted.
func (s *Store) ExpirePokerSessions(ctx context.Context) (closed int, deleted int, err error) {
	result, err := s.pool.Exec(ctx, `
		UPDATE poker_sessions SET status = 'closed', closed_at = now(), updated_at = now()
		WHERE status = 'active' AND updated_at < now() - make_interval(hours => $1)`, pokerIdleHours)
	if err != nil {
		return 0, 0, err
	}
	closed = int(result.RowsAffected())
	result, err = s.pool.Exec(ctx, `
		DELETE FROM poker_sessions
		WHERE status = 'closed' AND closed_at < now() - make_interval(days => $1)`, pokerRetentionDays)
	if err != nil {
		return closed, 0, err
	}
	return closed, int(result.RowsAffected()), nil
}
