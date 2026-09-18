package store

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/gh-Constant/prior/server/internal/workspace"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")
var ErrEmailTaken = errors.New("email already registered")
var ErrConflict = errors.New("revision conflict")
var ErrClockSkew = errors.New("client clock skew too large")

// PullPageSize bounds a single Pull response. Clients re-pull while HasMore.
const PullPageSize = 200

// ClockSkewTolerance rejects client timestamps more than 5 minutes in the
// future so a skewed clock cannot permanently win last-write-wins merges.
const ClockSkewTolerance = 5 * time.Minute

// Advisory locks: 907381 is the migration lock (see database package).
// 907382 serializes Push revision allocation so commit order matches
// nextval order and a later revision can never become visible before an
// earlier one (sequence-gap loss).
const pushRevisionLockKey = 907382

// PullResult is the paginated Pull envelope. Tasks/Habits come from the
// task_changes/habit_changes changelog (tasks/habits tables are the
// materialized view). Profile and WorkspaceRevision share the unified
// revision plane.
type PullResult struct {
	Tasks             []tasks.Task
	Habits            []tasks.Habit
	NextSince         int64
	HasMore           bool
	WorkspaceRevision int64
	Profile           ProfileSync
}

// ProfileSync carries the unified-revision profile watermark.
type ProfileSync struct {
	DisplayName     string
	ProfileRevision int64
	UpdatedAt       time.Time
}

// PushItemError is a sanitized per-mutation failure. Raw driver strings
// (pq:/pgconn) are never exposed; callers only see stable codes.
type PushItemError struct {
	Code    string
	Message string
}

// PushItemResult is one per-mutation outcome. OK items carry the applied
// entity and its server revision; failed items carry Error.
type PushItemResult struct {
	MutationID string
	OK         bool
	Revision   int64
	Entity     string
	Task       tasks.Task
	Habit      tasks.Habit
	Error      *PushItemError
}

// ToApplied converts successful items to the legacy AppliedMutation shape.
func (r PushItemResult) ToApplied() (AppliedMutation, bool) {
	if !r.OK {
		return AppliedMutation{}, false
	}
	return AppliedMutation{MutationID: r.MutationID, Entity: r.Entity, Task: r.Task, Habit: r.Habit, Revision: r.Revision}, true
}

type User struct {
	ID            uuid.UUID `json:"id"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"emailVerified"`
	DisplayName   string    `json:"displayName"`
	AvatarURL     string    `json:"avatarUrl,omitempty"`
}

type AgentChat struct {
	ID           uuid.UUID          `json:"id"`
	Title        string             `json:"title"`
	CreatedAt    time.Time          `json:"createdAt"`
	UpdatedAt    time.Time          `json:"updatedAt"`
	MessageCount int                `json:"messageCount"`
	Messages     []AgentChatMessage `json:"messages,omitempty"`
}

type AgentChatMessage struct {
	ID               uuid.UUID       `json:"id"`
	Role             string          `json:"role"`
	Content          string          `json:"content"`
	ProposedTasks    json.RawMessage `json:"proposedTasks,omitempty"`
	ProposedHabits   json.RawMessage `json:"proposedHabits,omitempty"`
	ProposedNotes    json.RawMessage `json:"proposedNotes,omitempty"`
	ProposedFolders  json.RawMessage `json:"proposedFolders,omitempty"`
	ProposedAreas    json.RawMessage `json:"proposedAreas,omitempty"`
	ProposedProjects json.RawMessage `json:"proposedProjects,omitempty"`
	ActualModel      string          `json:"actualModel,omitempty"`
	CreatedAt        time.Time       `json:"createdAt"`
}

// Session describes one login session for the sessions management endpoints.
// Token hashes are never exposed.
type Session struct {
	ID         uuid.UUID `json:"id"`
	DeviceName string    `json:"deviceName"`
	Platform   string    `json:"platform"`
	CreatedAt  time.Time `json:"createdAt"`
	LastUsedAt time.Time `json:"lastUsedAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	Current    bool      `json:"current"`
}

type AppliedMutation struct {
	MutationID string
	Entity     string
	Task       tasks.Task
	Habit      tasks.Habit
	Revision   int64
}

// computePullPage derives the next cursor and hasMore flag from an ordered
// revision list. revisions must be ascending. limit is the page size (200).
// Rollback holes are permanent and safe to skip; in-flight gaps are prevented
// by serializing Push revision allocation (pg_advisory_xact_lock), so commit
// order matches allocation order and advancing to the last returned revision
// cannot miss a future commit with a smaller revision.
func computePullPage(revisions []int64, since int64, limit int) (int64, bool) {
	if limit <= 0 {
		limit = PullPageSize
	}
	if len(revisions) == 0 {
		return since, false
	}
	if len(revisions) > limit {
		return revisions[limit-1], true
	}
	return revisions[len(revisions)-1], false
}

// normalizeEmailValue lowercases and trims an email for case-insensitive
// identity. All user lookups use lower(email) so Google and password logins
// link to the same row regardless of case.
func normalizeEmailValue(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// checkClockSkew rejects client timestamps more than ClockSkewTolerance in the
// future. Revision wins merges; a skewed updatedAt must not permanently win.
func checkClockSkew(incoming time.Time, now time.Time) error {
	if incoming.IsZero() {
		return nil
	}
	if incoming.After(now.Add(ClockSkewTolerance)) {
		return ErrClockSkew
	}
	return nil
}

// classifyPushError maps internal errors to stable, sanitized codes. Raw
// driver strings (pq:, pgconn, SQL) are never returned to clients.
func classifyPushError(err error) (string, string) {
	if err == nil {
		return "OK", ""
	}
	if errors.Is(err, ErrClockSkew) {
		return "CLOCK_SKEW", "client clock is too far in the future"
	}
	if errors.Is(err, ErrConflict) {
		return "CONFLICT", "revision conflict; pull and retry"
	}
	if errors.Is(err, ErrNotFound) {
		return "NOT_FOUND", "referenced item was not found"
	}
	if errors.Is(err, ErrEmailTaken) {
		return "CONFLICT", "email is already registered"
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return "CONFLICT", "item already exists"
		case "23503":
			return "INVALID_REFERENCE", "referenced item does not exist"
		case "23514", "23502", "22001":
			return "INVALID_VALUE", "invalid field value"
		default:
			return "INTERNAL", "unable to apply mutation"
		}
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "belongs to another user") || strings.Contains(msg, "belongs to another chat"):
		return "FORBIDDEN", "item belongs to another user"
	case strings.Contains(msg, "clock skew"):
		return "CLOCK_SKEW", "client clock is too far in the future"
	case strings.Contains(msg, "revision conflict"):
		return "CONFLICT", "revision conflict; pull and retry"
	case strings.Contains(msg, "unknown mutation kind") || strings.Contains(msg, "unknown mutation entity"):
		return "INVALID_MUTATION", "unknown mutation kind or entity"
	case strings.Contains(msg, "mutation id") || strings.Contains(msg, "invalid") && strings.Contains(msg, "id"):
		if strings.Contains(msg, "title") {
			return "INVALID_TITLE", "title must be between 1 and 400 characters"
		}
		return "INVALID_ID", "invalid id"
	case strings.Contains(msg, "title"):
		return "INVALID_TITLE", "title must be between 1 and 400 characters"
	case strings.Contains(msg, "description"):
		return "INVALID_DESCRIPTION", "description is too long"
	case strings.Contains(msg, "due date") || strings.Contains(msg, "scheduled date") || strings.Contains(msg, "follow-up") || strings.Contains(msg, "start date") || strings.Contains(msg, "end date") || strings.Contains(msg, "completion date") || strings.Contains(msg, "weekday") || strings.Contains(msg, "schedule"):
		return "INVALID_DATE", "invalid date or schedule"
	case strings.Contains(msg, "priority"):
		return "INVALID_PRIORITY", "priority must be between 1 and 4"
	case strings.Contains(msg, "status"):
		return "INVALID_STATUS", "invalid status"
	case strings.Contains(msg, "too large") || strings.Contains(msg, "too long") || strings.Contains(msg, "too many"):
		return "INVALID_VALUE", "field value is too large"
	case strings.Contains(msg, "missing updatedat") || strings.Contains(msg, "updatedat"):
		return "INVALID_TIMESTAMP", "item is missing updatedAt"
	default:
		return "INVALID_VALUE", "invalid mutation"
	}
}

// pushErrorCode unwraps classifyPushError for HTTP mapping.
func pushErrorCode(err error) string {
	code, _ := classifyPushError(err)
	return code
}

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) SyncWorkspace(ctx context.Context, userID uuid.UUID, incoming workspace.Snapshot) (workspace.Snapshot, error) {
	merged, _, err := s.SyncWorkspaceWithRevision(ctx, userID, incoming)
	return merged, err
}

// SyncWorkspaceWithRevision is SyncWorkspace plus the unified workspaceRevision
// watermark (max revision across the four workspace tables).
func (s *Store) SyncWorkspaceWithRevision(ctx context.Context, userID uuid.UUID, incoming workspace.Snapshot) (workspace.Snapshot, int64, error) {
	if err := incoming.Validate(); err != nil {
		return workspace.Snapshot{}, 0, err
	}
	if err := checkWorkspaceClock(incoming, time.Now().UTC()); err != nil {
		return workspace.Snapshot{}, 0, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return workspace.Snapshot{}, 0, err
	}
	defer tx.Rollback(ctx)
	if err := syncAreas(ctx, tx, userID, incoming.Areas); err != nil {
		return workspace.Snapshot{}, 0, err
	}
	if err := syncProjects(ctx, tx, userID, incoming.Projects); err != nil {
		return workspace.Snapshot{}, 0, err
	}
	if err := syncFolders(ctx, tx, userID, incoming.Folders); err != nil {
		return workspace.Snapshot{}, 0, err
	}
	if err := syncNotes(ctx, tx, userID, incoming.Notes); err != nil {
		return workspace.Snapshot{}, 0, err
	}
	merged, err := loadWorkspace(ctx, tx, userID)
	if err != nil {
		return workspace.Snapshot{}, 0, err
	}
	workspaceRevision, err := workspaceRevisionTx(ctx, tx, userID)
	if err != nil {
		return workspace.Snapshot{}, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return workspace.Snapshot{}, 0, err
	}
	return merged, workspaceRevision, nil
}

// WorkspaceRevision returns the max workspace revision for Pull's envelope.
// Missing revision columns (pre-012 databases) yield 0.
func (s *Store) WorkspaceRevision(ctx context.Context, userID uuid.UUID) (int64, error) {
	var revision *int64
	err := s.pool.QueryRow(ctx, `
		SELECT MAX(revision) FROM (
			SELECT MAX(revision) AS revision FROM areas WHERE user_id = $1
			UNION ALL SELECT MAX(revision) FROM projects WHERE user_id = $1
			UNION ALL SELECT MAX(revision) FROM note_folders WHERE user_id = $1
			UNION ALL SELECT MAX(revision) FROM notes WHERE user_id = $1
		) s`, userID).Scan(&revision)
	if err != nil {
		// Pre-migration databases lack the revision column.
		return 0, nil
	}
	if revision == nil {
		return 0, nil
	}
	return *revision, nil
}

func workspaceRevisionTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (int64, error) {
	var revision *int64
	err := tx.QueryRow(ctx, `
		SELECT MAX(revision) FROM (
			SELECT MAX(revision) AS revision FROM areas WHERE user_id = $1
			UNION ALL SELECT MAX(revision) FROM projects WHERE user_id = $1
			UNION ALL SELECT MAX(revision) FROM note_folders WHERE user_id = $1
			UNION ALL SELECT MAX(revision) FROM notes WHERE user_id = $1
		) s`, userID).Scan(&revision)
	if err != nil {
		return 0, nil
	}
	if revision == nil {
		return 0, nil
	}
	return *revision, nil
}

func workspaceUpdatedAt(ctx context.Context, tx pgx.Tx, table string, userID uuid.UUID) (map[string]time.Time, error) {
	rows, err := tx.Query(ctx, fmt.Sprintf("SELECT id::text, updated_at FROM %s WHERE user_id = $1", table), userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]time.Time)
	for rows.Next() {
		var id string
		var updatedAt time.Time
		if err := rows.Scan(&id, &updatedAt); err != nil {
			return nil, err
		}
		result[id] = updatedAt
	}
	return result, rows.Err()
}

func applyIfNewer(incoming time.Time, current map[string]time.Time, id string) bool {
	updatedAt, exists := current[id]
	return !exists || !incoming.Before(updatedAt)
}

func nextWorkspaceRevision(ctx context.Context, tx pgx.Tx) (int64, error) {
	var revision int64
	if err := tx.QueryRow(ctx, `SELECT nextval('workspace_revision_seq')`).Scan(&revision); err == nil {
		return revision, nil
	}
	// Fallback for databases predating 012_workspace_revision.sql.
	if err := tx.QueryRow(ctx, `SELECT nextval('server_revision_seq')`).Scan(&revision); err != nil {
		return 0, err
	}
	return revision, nil
}

func checkWorkspaceClock(incoming workspace.Snapshot, now time.Time) error {
	for _, area := range incoming.Areas {
		if err := checkClockSkew(area.UpdatedAt, now); err != nil {
			return fmt.Errorf("areas: %w", err)
		}
	}
	for _, project := range incoming.Projects {
		if err := checkClockSkew(project.UpdatedAt, now); err != nil {
			return fmt.Errorf("projects: %w", err)
		}
	}
	for _, folder := range incoming.Folders {
		if err := checkClockSkew(folder.UpdatedAt, now); err != nil {
			return fmt.Errorf("folders: %w", err)
		}
	}
	for _, note := range incoming.Notes {
		if err := checkClockSkew(note.UpdatedAt, now); err != nil {
			return fmt.Errorf("notes: %w", err)
		}
	}
	return nil
}

func syncAreas(ctx context.Context, tx pgx.Tx, userID uuid.UUID, incoming []workspace.Area) error {
	current, err := workspaceUpdatedAt(ctx, tx, "areas", userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, area := range incoming {
		if err := checkClockSkew(area.UpdatedAt, now); err != nil {
			return err
		}
		if !applyIfNewer(area.UpdatedAt, current, area.ID) {
			continue
		}
		createdAt := area.CreatedAt
		if createdAt.IsZero() {
			createdAt = area.UpdatedAt
		}
		revision, err := nextWorkspaceRevision(ctx, tx)
		if err != nil {
			return err
		}
		result, err := tx.Exec(ctx, `
			INSERT INTO areas (id, user_id, name, color, icon, created_at, updated_at, deleted_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (user_id, id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, icon = EXCLUDED.icon,
			updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision
			WHERE areas.updated_at IS NULL OR EXCLUDED.updated_at >= areas.updated_at`,
			area.ID, userID, area.Name, area.Color, area.Icon, createdAt, area.UpdatedAt, area.DeletedAt, revision)
		if err != nil {
			return err
		}
		// 0 rows means a concurrent newer write won (updatedAt merge); stale
		// losers are skipped, not conflicts.
		if result.RowsAffected() > 1 {
			return ErrConflict
		}
	}
	return nil
}

func syncProjects(ctx context.Context, tx pgx.Tx, userID uuid.UUID, incoming []workspace.Project) error {
	current, err := workspaceUpdatedAt(ctx, tx, "projects", userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, project := range incoming {
		if err := checkClockSkew(project.UpdatedAt, now); err != nil {
			return err
		}
		if !applyIfNewer(project.UpdatedAt, current, project.ID) {
			continue
		}
		createdAt := project.CreatedAt
		if createdAt.IsZero() {
			createdAt = project.UpdatedAt
		}
		revision, err := nextWorkspaceRevision(ctx, tx)
		if err != nil {
			return err
		}
		result, err := tx.Exec(ctx, `
			INSERT INTO projects (id, user_id, area_id, name, description, icon, status, created_at, updated_at, deleted_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (user_id, id) DO UPDATE SET area_id = EXCLUDED.area_id, name = EXCLUDED.name,
			description = EXCLUDED.description, icon = EXCLUDED.icon, status = EXCLUDED.status,
			updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision
			WHERE projects.updated_at IS NULL OR EXCLUDED.updated_at >= projects.updated_at`,
			project.ID, userID, project.AreaID, project.Name, project.Description, project.Icon, project.Status, createdAt, project.UpdatedAt, project.DeletedAt, revision)
		if err != nil {
			return err
		}
		if result.RowsAffected() > 1 {
			return ErrConflict
		}
	}
	return nil
}

func syncFolders(ctx context.Context, tx pgx.Tx, userID uuid.UUID, incoming []workspace.NoteFolder) error {
	current, err := workspaceUpdatedAt(ctx, tx, "note_folders", userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, folder := range incoming {
		if err := checkClockSkew(folder.UpdatedAt, now); err != nil {
			return err
		}
		if !applyIfNewer(folder.UpdatedAt, current, folder.ID) {
			continue
		}
		createdAt := folder.CreatedAt
		if createdAt.IsZero() {
			createdAt = folder.UpdatedAt
		}
		revision, err := nextWorkspaceRevision(ctx, tx)
		if err != nil {
			return err
		}
		result, err := tx.Exec(ctx, `
			INSERT INTO note_folders (id, user_id, name, parent_id, color, workspace_kind, workspace_id, icon, created_at, updated_at, deleted_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (user_id, id) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id,
			color = EXCLUDED.color, workspace_kind = EXCLUDED.workspace_kind, workspace_id = EXCLUDED.workspace_id,
			icon = EXCLUDED.icon, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision
			WHERE note_folders.updated_at IS NULL OR EXCLUDED.updated_at >= note_folders.updated_at`,
			folder.ID, userID, folder.Name, folder.ParentID, folder.Color, folder.WorkspaceKind, folder.WorkspaceID, folder.Icon, createdAt, folder.UpdatedAt, folder.DeletedAt, revision)
		if err != nil {
			return err
		}
		if result.RowsAffected() > 1 {
			return ErrConflict
		}
	}
	return nil
}

func syncNotes(ctx context.Context, tx pgx.Tx, userID uuid.UUID, incoming []workspace.Note) error {
	current, err := workspaceUpdatedAt(ctx, tx, "notes", userID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, note := range incoming {
		if err := checkClockSkew(note.UpdatedAt, now); err != nil {
			return err
		}
		if !applyIfNewer(note.UpdatedAt, current, note.ID) {
			continue
		}
		createdAt := note.CreatedAt
		if createdAt.IsZero() {
			createdAt = note.UpdatedAt
		}
		revision, err := nextWorkspaceRevision(ctx, tx)
		if err != nil {
			return err
		}
		result, err := tx.Exec(ctx, `
			INSERT INTO notes (id, user_id, title, body, folder_id, project_id, favorite, created_at, updated_at, deleted_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (user_id, id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, folder_id = EXCLUDED.folder_id,
			project_id = EXCLUDED.project_id, favorite = EXCLUDED.favorite, updated_at = EXCLUDED.updated_at,
			deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision
			WHERE notes.updated_at IS NULL OR EXCLUDED.updated_at >= notes.updated_at`,
			note.ID, userID, note.Title, note.Body, note.FolderID, note.ProjectID, note.Favorite, createdAt, note.UpdatedAt, note.DeletedAt, revision)
		if err != nil {
			return err
		}
		if result.RowsAffected() > 1 {
			return ErrConflict
		}
	}
	return nil
}

func loadWorkspace(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (workspace.Snapshot, error) {
	result := workspace.EmptySnapshot()
	areaRows, err := tx.Query(ctx, `SELECT id::text, name, color, icon, created_at, updated_at, deleted_at FROM areas WHERE user_id = $1 ORDER BY id`, userID)
	if err != nil {
		return workspace.Snapshot{}, err
	}
	for areaRows.Next() {
		var area workspace.Area
		if err := areaRows.Scan(&area.ID, &area.Name, &area.Color, &area.Icon, &area.CreatedAt, &area.UpdatedAt, &area.DeletedAt); err != nil {
			areaRows.Close()
			return workspace.Snapshot{}, err
		}
		result.Areas = append(result.Areas, area)
	}
	if err := areaRows.Err(); err != nil {
		areaRows.Close()
		return workspace.Snapshot{}, err
	}
	areaRows.Close()

	projectRows, err := tx.Query(ctx, `SELECT id::text, area_id::text, name, description, icon, status, created_at, updated_at, deleted_at FROM projects WHERE user_id = $1 ORDER BY id`, userID)
	if err != nil {
		return workspace.Snapshot{}, err
	}
	for projectRows.Next() {
		var project workspace.Project
		if err := projectRows.Scan(&project.ID, &project.AreaID, &project.Name, &project.Description, &project.Icon, &project.Status, &project.CreatedAt, &project.UpdatedAt, &project.DeletedAt); err != nil {
			projectRows.Close()
			return workspace.Snapshot{}, err
		}
		result.Projects = append(result.Projects, project)
	}
	if err := projectRows.Err(); err != nil {
		projectRows.Close()
		return workspace.Snapshot{}, err
	}
	projectRows.Close()

	folderRows, err := tx.Query(ctx, `SELECT id::text, name, parent_id::text, color, workspace_kind, workspace_id::text, icon, created_at, updated_at, deleted_at FROM note_folders WHERE user_id = $1 ORDER BY id`, userID)
	if err != nil {
		return workspace.Snapshot{}, err
	}
	for folderRows.Next() {
		var folder workspace.NoteFolder
		if err := folderRows.Scan(&folder.ID, &folder.Name, &folder.ParentID, &folder.Color, &folder.WorkspaceKind, &folder.WorkspaceID, &folder.Icon, &folder.CreatedAt, &folder.UpdatedAt, &folder.DeletedAt); err != nil {
			folderRows.Close()
			return workspace.Snapshot{}, err
		}
		result.Folders = append(result.Folders, folder)
	}
	if err := folderRows.Err(); err != nil {
		folderRows.Close()
		return workspace.Snapshot{}, err
	}
	folderRows.Close()

	noteRows, err := tx.Query(ctx, `SELECT id::text, title, body, folder_id::text, project_id::text, favorite, created_at, updated_at, deleted_at FROM notes WHERE user_id = $1 ORDER BY id`, userID)
	if err != nil {
		return workspace.Snapshot{}, err
	}
	for noteRows.Next() {
		var note workspace.Note
		if err := noteRows.Scan(&note.ID, &note.Title, &note.Body, &note.FolderID, &note.ProjectID, &note.Favorite, &note.CreatedAt, &note.UpdatedAt, &note.DeletedAt); err != nil {
			noteRows.Close()
			return workspace.Snapshot{}, err
		}
		result.Notes = append(result.Notes, note)
	}
	if err := noteRows.Err(); err != nil {
		noteRows.Close()
		return workspace.Snapshot{}, err
	}
	noteRows.Close()
	return result, nil
}

// isoDateLayout is the YYYY-MM-DD layout used for habit and task dates.
const isoDateLayout = "2006-01-02"

// SaveAgentChatMessageParams groups SaveAgentChatMessage arguments so the
// method stays within the parameter-count limit.
type SaveAgentChatMessageParams struct {
	UserID           uuid.UUID
	ChatID           uuid.UUID
	MessageID        uuid.UUID
	Role             string
	Content          string
	ProposedTasks    json.RawMessage
	ProposedHabits   json.RawMessage
	ProposedNotes    json.RawMessage
	ProposedFolders  json.RawMessage
	ProposedAreas    json.RawMessage
	ProposedProjects json.RawMessage
	ActualModel      string
}

func (s *Store) UpsertUser(ctx context.Context, googleSub, email string, verified bool, displayName, avatarURL string) (User, error) {
	email = normalizeEmailValue(email)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)

	var user User
	var id uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE google_sub = $1`, googleSub).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Case-insensitive email link: Google and password logins with
		// different cases resolve to the same row.
		err = tx.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = lower($1)`, email).Scan(&id)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		err = upsertInsertUser(ctx, tx, &user, googleSub, email, verified, displayName, avatarURL)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				// Lost a race with a concurrent insert: fall through to
				// the update path below.
				err = tx.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = lower($1)`, email).Scan(&id)
				if err != nil {
					return User{}, err
				}
			} else {
				return User{}, err
			}
		} else {
			if err := tx.Commit(ctx); err != nil {
				return User{}, err
			}
			return user, nil
		}
	}
	if err != nil {
		return User{}, err
	}
	// Preserve a user-chosen display name: if display_name_updated_at is set
	// (via PATCH /v1/me), an OAuth login with a stale Google name must not
	// overwrite it.
	var existingName string
	var nameUpdatedAt *time.Time
	_ = tx.QueryRow(ctx, `SELECT display_name, display_name_updated_at FROM users WHERE id = $1`, id).Scan(&existingName, &nameUpdatedAt)
	effectiveName := strings.TrimSpace(displayName)
	if nameUpdatedAt != nil && strings.TrimSpace(existingName) != "" {
		effectiveName = existingName
	}
	if effectiveName == "" {
		effectiveName = existingName
		if effectiveName == "" {
			effectiveName = strings.Split(email, "@")[0]
		}
	}
	err = tx.QueryRow(ctx, `
		UPDATE users SET google_sub = $1, email = $2, email_verified = $3, display_name = $4, avatar_url = $5,
		updated_at = now(), last_login_at = now(),
		profile_revision = nextval('server_revision_seq')
		WHERE id = $6
		RETURNING id, email, email_verified, display_name, avatar_url`, googleSub, email, verified, effectiveName, avatarURL, id).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
	if err != nil {
		var pgErr *pgconn.PgError
		// Pre-013 databases lack profile_revision: retry without it.
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			err = tx.QueryRow(ctx, `
				UPDATE users SET google_sub = $1, email = $2, email_verified = $3, display_name = $4, avatar_url = $5,
				updated_at = now(), last_login_at = now()
				WHERE id = $6
				RETURNING id, email, email_verified, display_name, avatar_url`, googleSub, email, verified, effectiveName, avatarURL, id).
				Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
		}
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return User{}, ErrEmailTaken
		}
		return User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	return user, nil
}

func upsertInsertUser(ctx context.Context, tx pgx.Tx, user *User, googleSub, email string, verified bool, displayName, avatarURL string) error {
	if strings.TrimSpace(displayName) == "" {
		displayName = strings.Split(email, "@")[0]
	}
	err := tx.QueryRow(ctx, `
		INSERT INTO users (google_sub, email, email_verified, display_name, avatar_url, last_login_at, profile_revision)
		VALUES ($1, $2, $3, $4, $5, now(), nextval('server_revision_seq'))
		RETURNING id, email, email_verified, display_name, avatar_url`, googleSub, email, verified, displayName, avatarURL).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			return tx.QueryRow(ctx, `
				INSERT INTO users (google_sub, email, email_verified, display_name, avatar_url, last_login_at)
				VALUES ($1, $2, $3, $4, $5, now())
				RETURNING id, email, email_verified, display_name, avatar_url`, googleSub, email, verified, displayName, avatarURL).
				Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
		}
		return err
	}
	return nil
}

func (s *Store) CreatePasswordUser(ctx context.Context, email, passwordHash, displayName string) (User, error) {
	email = normalizeEmailValue(email)
	var user User
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, email_verified, display_name, last_login_at)
		VALUES ($1, $2, FALSE, $3, now())
		RETURNING id, email, email_verified, display_name, avatar_url`, email, passwordHash, displayName).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return User{}, ErrEmailTaken
		}
		return User{}, err
	}
	return user, nil
}

func (s *Store) UserWithPasswordHash(ctx context.Context, email string) (User, string, error) {
	email = normalizeEmailValue(email)
	var user User
	var passwordHash *string
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, email_verified, display_name, avatar_url, password_hash
		FROM users WHERE lower(email) = lower($1)`, email).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL, &passwordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	if err != nil {
		return User{}, "", err
	}
	if passwordHash == nil {
		return user, "", nil
	}
	return user, *passwordHash, nil
}

// PasswordHashByID returns the stored bcrypt hash for password set/change
// flows. Empty string means the account is OAuth-only.
func (s *Store) PasswordHashByID(ctx context.Context, userID uuid.UUID) (string, error) {
	var hash *string
	err := s.pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil || hash == nil {
		return "", err
	}
	return *hash, nil
}

// UpdatePasswordHash rotates the bcrypt hash.
func (s *Store) UpdatePasswordHash(ctx context.Context, userID uuid.UUID, hash string) error {
	result, err := s.pool.Exec(ctx, `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, hash, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) TouchLogin(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, userID)
	return err
}

func (s *Store) UpdateUserProfile(ctx context.Context, userID uuid.UUID, displayName string) (User, error) {
	user, _, err := s.UpdateUserProfileWithRevision(ctx, userID, displayName)
	return user, err
}

// UpdateUserProfileWithRevision bumps the unified profile_revision plane and
// stamps display_name_updated_at so future OAuth logins preserve the
// user-chosen name.
func (s *Store) UpdateUserProfileWithRevision(ctx context.Context, userID uuid.UUID, displayName string) (User, int64, error) {
	var user User
	var revision int64
	err := s.pool.QueryRow(ctx, `
		UPDATE users SET display_name = $1, updated_at = now(), display_name_updated_at = now(),
		profile_revision = nextval('server_revision_seq')
		WHERE id = $2
		RETURNING id, email, email_verified, display_name, avatar_url, profile_revision`, displayName, userID).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL, &revision)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			// Pre-013 database: fall back to the legacy columns.
			err = s.pool.QueryRow(ctx, `
				UPDATE users SET display_name = $1, updated_at = now()
				WHERE id = $2
				RETURNING id, email, email_verified, display_name, avatar_url`, displayName, userID).
				Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, 0, ErrNotFound
	}
	if err != nil {
		return User{}, 0, err
	}
	return user, revision, nil
}

// ProfileForPull returns the profile watermark for the Pull envelope.
func (s *Store) ProfileForPull(ctx context.Context, userID uuid.UUID) (ProfileSync, error) {
	var profile ProfileSync
	err := s.pool.QueryRow(ctx, `SELECT display_name, profile_revision, updated_at FROM users WHERE id = $1`, userID).
		Scan(&profile.DisplayName, &profile.ProfileRevision, &profile.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			var fallback struct {
				DisplayName string
				UpdatedAt   time.Time
			}
			if err2 := s.pool.QueryRow(ctx, `SELECT display_name, updated_at FROM users WHERE id = $1`, userID).Scan(&fallback.DisplayName, &fallback.UpdatedAt); err2 != nil {
				if errors.Is(err2, pgx.ErrNoRows) {
					return ProfileSync{}, ErrNotFound
				}
				return ProfileSync{}, err2
			}
			return ProfileSync{DisplayName: fallback.DisplayName, UpdatedAt: fallback.UpdatedAt}, nil
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfileSync{}, ErrNotFound
		}
		return ProfileSync{}, err
	}
	return profile, nil
}

func (s *Store) CreateSession(ctx context.Context, userID uuid.UUID, token, device, platform string, ttl time.Duration) error {
	hash := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, device_name, platform, expires_at) VALUES ($1, $2, $3, $4, $5)`, userID, hash[:], device, platform, time.Now().UTC().Add(ttl))
	return err
}

func (s *Store) UserForToken(ctx context.Context, token string) (User, error) {
	user, _, err := s.userForTokenHash(ctx, tokenHash(token), true)
	return user, err
}

// SessionUserForToken resolves the token without touching last_used_at, for
// background checks (realtime expiry loop) that must not generate writes.
func (s *Store) SessionUserForToken(ctx context.Context, token string) (User, time.Time, error) {
	return s.userForTokenHash(ctx, tokenHash(token), false)
}

func tokenHash(token string) [32]byte { return sha256.Sum256([]byte(token)) }

func (s *Store) userForTokenHash(ctx context.Context, hash [32]byte, touch bool) (User, time.Time, error) {
	var user User
	var expiresAt time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.email_verified, u.display_name, u.avatar_url, s.expires_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, hash[:]).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, time.Time{}, ErrNotFound
	}
	if err != nil {
		return User{}, time.Time{}, err
	}
	if touch {
		// Sliding last_used_at without a write on every request: touch
		// probabilistically (~1%) in a background context so reads stay cheap.
		if rand.Intn(100) == 0 {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, _ = s.pool.Exec(ctx, `UPDATE sessions SET last_used_at = now() WHERE token_hash = $1`, hash[:])
			}()
		}
	}
	return user, expiresAt, nil
}

func (s *Store) RevokeSession(ctx context.Context, token string) error {
	hash := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, hash[:])
	return err
}

func (s *Store) ListSessions(ctx context.Context, userID uuid.UUID, currentToken string) ([]Session, error) {
	current := tokenHash(currentToken)
	rows, err := s.pool.Query(ctx, `
		SELECT id, device_name, platform, created_at, last_used_at, expires_at, (token_hash = $2)
		FROM sessions
		WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
		ORDER BY last_used_at DESC`, userID, current[:])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := make([]Session, 0)
	for rows.Next() {
		var session Session
		if err := rows.Scan(&session.ID, &session.DeviceName, &session.Platform, &session.CreatedAt, &session.LastUsedAt, &session.ExpiresAt, &session.Current); err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func (s *Store) RevokeSessionByID(ctx context.Context, userID, sessionID uuid.UUID) error {
	result, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, sessionID, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RevokeAllSessions(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	return err
}

func (s *Store) ListAgentChats(ctx context.Context, userID uuid.UUID) ([]AgentChat, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(m.id)::int
		FROM agent_chats c
		LEFT JOIN agent_chat_messages m ON m.chat_id = c.id
		WHERE c.user_id = $1
		GROUP BY c.id
		ORDER BY c.updated_at DESC
		LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chats := make([]AgentChat, 0)
	for rows.Next() {
		var chat AgentChat
		if err := rows.Scan(&chat.ID, &chat.Title, &chat.CreatedAt, &chat.UpdatedAt, &chat.MessageCount); err != nil {
			return nil, err
		}
		chats = append(chats, chat)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return chats, nil
}

func (s *Store) CreateAgentChat(ctx context.Context, userID uuid.UUID, title string) (AgentChat, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "New chat"
	}
	if len(title) > 160 {
		title = title[:160]
	}

	var chat AgentChat
	err := s.pool.QueryRow(ctx, `
		INSERT INTO agent_chats (user_id, title)
		VALUES ($1, $2)
		RETURNING id, title, created_at, updated_at`, userID, title).
		Scan(&chat.ID, &chat.Title, &chat.CreatedAt, &chat.UpdatedAt)
	return chat, err
}

func (s *Store) GetAgentChat(ctx context.Context, userID, chatID uuid.UUID) (AgentChat, error) {
	var chat AgentChat
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(m.id)::int
		FROM agent_chats c
		LEFT JOIN agent_chat_messages m ON m.chat_id = c.id
		WHERE c.id = $1 AND c.user_id = $2
		GROUP BY c.id`, chatID, userID).
		Scan(&chat.ID, &chat.Title, &chat.CreatedAt, &chat.UpdatedAt, &chat.MessageCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return AgentChat{}, ErrNotFound
	}
	if err != nil {
		return AgentChat{}, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, role, content, proposed_tasks, proposed_habits, proposed_notes, proposed_folders,
			COALESCE(proposed_areas, '[]'::jsonb), COALESCE(proposed_projects, '[]'::jsonb),
			actual_model, created_at
		FROM agent_chat_messages
		WHERE chat_id = $1
		ORDER BY created_at ASC, id ASC`, chatID)
	if err != nil {
		return AgentChat{}, err
	}
	defer rows.Close()
	chat.Messages = make([]AgentChatMessage, 0, chat.MessageCount)
	for rows.Next() {
		var message AgentChatMessage
		var actualModel *string
		if err := rows.Scan(&message.ID, &message.Role, &message.Content, &message.ProposedTasks, &message.ProposedHabits, &message.ProposedNotes, &message.ProposedFolders, &message.ProposedAreas, &message.ProposedProjects, &actualModel, &message.CreatedAt); err != nil {
			return AgentChat{}, err
		}
		if actualModel != nil {
			message.ActualModel = *actualModel
		}
		chat.Messages = append(chat.Messages, message)
	}
	if err := rows.Err(); err != nil {
		return AgentChat{}, err
	}
	return chat, nil
}

func (s *Store) SaveAgentChatMessage(ctx context.Context, params SaveAgentChatMessageParams) (AgentChatMessage, error) {
	content, err := validateChatMessage(params.Role, params.Content)
	if err != nil {
		return AgentChatMessage{}, err
	}
	proposedTasks, proposedHabits, proposedNotes, proposedFolders, proposedAreas, proposedProjects, err := normalizeProposedPayloads(params.ProposedTasks, params.ProposedHabits, params.ProposedNotes, params.ProposedFolders, params.ProposedAreas, params.ProposedProjects)
	if err != nil {
		return AgentChatMessage{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AgentChatMessage{}, err
	}
	defer tx.Rollback(ctx)

	if err := verifyChatOwner(ctx, tx, params.ChatID, params.UserID); err != nil {
		return AgentChatMessage{}, err
	}
	if err := verifyMessageChat(ctx, tx, params.MessageID, params.ChatID); err != nil {
		return AgentChatMessage{}, err
	}
	message, err := upsertChatMessage(ctx, tx, params, content, proposedTasks, proposedHabits, proposedNotes, proposedFolders, proposedAreas, proposedProjects)
	if err != nil {
		return AgentChatMessage{}, err
	}
	if err := touchChatAfterMessage(ctx, tx, params.ChatID, params.UserID, params.Role, content); err != nil {
		return AgentChatMessage{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AgentChatMessage{}, err
	}
	return message, nil
}

func validateChatMessage(role, content string) (string, error) {
	trimmed := strings.TrimSpace(content)
	if role != "user" && role != "assistant" {
		return "", errors.New("invalid chat message role")
	}
	if trimmed == "" || len(trimmed) > 20000 {
		return "", errors.New("chat message content must be between 1 and 20000 characters")
	}
	return trimmed, nil
}

func normalizeProposedPayloads(proposedTasks, proposedHabits, proposedNotes, proposedFolders, proposedAreas, proposedProjects json.RawMessage) (json.RawMessage, json.RawMessage, json.RawMessage, json.RawMessage, json.RawMessage, json.RawMessage, error) {
	if len(proposedTasks) == 0 || string(proposedTasks) == "null" {
		proposedTasks = json.RawMessage("[]")
	}
	var proposedList []json.RawMessage
	if err := json.Unmarshal(proposedTasks, &proposedList); err != nil {
		return nil, nil, nil, nil, nil, nil, errors.New("proposed tasks must be a JSON array")
	}
	if len(proposedTasks) > 1<<20 || len(proposedHabits) > 1<<20 || len(proposedNotes) > 1<<20 || len(proposedFolders) > 1<<20 || len(proposedAreas) > 1<<20 || len(proposedProjects) > 1<<20 {
		return nil, nil, nil, nil, nil, nil, errors.New("proposed items payload is too large")
	}
	if len(proposedHabits) == 0 || string(proposedHabits) == "null" {
		proposedHabits = json.RawMessage("[]")
	}
	var proposedHabitList []json.RawMessage
	if err := json.Unmarshal(proposedHabits, &proposedHabitList); err != nil {
		return nil, nil, nil, nil, nil, nil, errors.New("proposed habits must be a JSON array")
	}
	if len(proposedNotes) == 0 || string(proposedNotes) == "null" {
		proposedNotes = json.RawMessage("[]")
	}
	var proposedNoteList []json.RawMessage
	if err := json.Unmarshal(proposedNotes, &proposedNoteList); err != nil {
		return nil, nil, nil, nil, nil, nil, errors.New("proposed notes must be a JSON array")
	}
	if len(proposedFolders) == 0 || string(proposedFolders) == "null" {
		proposedFolders = json.RawMessage("[]")
	}
	var proposedFolderList []json.RawMessage
	if err := json.Unmarshal(proposedFolders, &proposedFolderList); err != nil {
		return nil, nil, nil, nil, nil, nil, errors.New("proposed folders must be a JSON array")
	}
	if len(proposedAreas) == 0 || string(proposedAreas) == "null" {
		proposedAreas = json.RawMessage("[]")
	}
	var proposedAreaList []json.RawMessage
	if err := json.Unmarshal(proposedAreas, &proposedAreaList); err != nil {
		return nil, nil, nil, nil, nil, nil, errors.New("proposed areas must be a JSON array")
	}
	if len(proposedProjects) == 0 || string(proposedProjects) == "null" {
		proposedProjects = json.RawMessage("[]")
	}
	var proposedProjectList []json.RawMessage
	if err := json.Unmarshal(proposedProjects, &proposedProjectList); err != nil {
		return nil, nil, nil, nil, nil, nil, errors.New("proposed projects must be a JSON array")
	}
	return proposedTasks, proposedHabits, proposedNotes, proposedFolders, proposedAreas, proposedProjects, nil
}

func verifyChatOwner(ctx context.Context, tx pgx.Tx, chatID, userID uuid.UUID) error {
	var owner uuid.UUID
	err := tx.QueryRow(ctx, `SELECT user_id FROM agent_chats WHERE id = $1`, chatID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if owner != userID {
		return errors.New("chat belongs to another user")
	}
	return nil
}

func verifyMessageChat(ctx context.Context, tx pgx.Tx, messageID, chatID uuid.UUID) error {
	// Scope by owning user via JOIN so a message ID from another user's chat
	// can never be attached to this chat (IDOR).
	var ownerID uuid.UUID
	err := tx.QueryRow(ctx, `SELECT user_id FROM agent_chats WHERE id = $1`, chatID).Scan(&ownerID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// Chat does not exist yet; verifyChatOwner will report ErrNotFound.
		return nil
	}
	var existingChatID uuid.UUID
	joinErr := tx.QueryRow(ctx, `
		SELECT m.chat_id FROM agent_chat_messages m
		JOIN agent_chats c ON c.id = m.chat_id
		WHERE m.id = $1 AND c.user_id = $2`, messageID, ownerID).Scan(&existingChatID)
	if joinErr == nil && existingChatID != chatID {
		return errors.New("message belongs to another chat")
	}
	if joinErr != nil && !errors.Is(joinErr, pgx.ErrNoRows) {
		return joinErr
	}
	return nil
}

func chatModelValue(actualModel string) any {
	trimmed := strings.TrimSpace(actualModel)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func upsertChatMessage(ctx context.Context, tx pgx.Tx, params SaveAgentChatMessageParams, content string, proposedTasks, proposedHabits, proposedNotes, proposedFolders, proposedAreas, proposedProjects json.RawMessage) (AgentChatMessage, error) {
	var message AgentChatMessage
	var returnedModel *string
	err := tx.QueryRow(ctx, `
		INSERT INTO agent_chat_messages (id, chat_id, role, content, proposed_tasks, proposed_habits, proposed_notes, proposed_folders, proposed_areas, proposed_projects, actual_model)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, content = EXCLUDED.content,
		proposed_tasks = EXCLUDED.proposed_tasks, proposed_habits = EXCLUDED.proposed_habits, proposed_notes = EXCLUDED.proposed_notes, proposed_folders = EXCLUDED.proposed_folders,
		proposed_areas = EXCLUDED.proposed_areas, proposed_projects = EXCLUDED.proposed_projects, actual_model = EXCLUDED.actual_model
		RETURNING id, role, content, proposed_tasks, proposed_habits, proposed_notes, proposed_folders, proposed_areas, proposed_projects, actual_model, created_at`,
		params.MessageID, params.ChatID, params.Role, content, proposedTasks, proposedHabits, proposedNotes, proposedFolders, proposedAreas, proposedProjects, chatModelValue(params.ActualModel)).
		Scan(&message.ID, &message.Role, &message.Content, &message.ProposedTasks, &message.ProposedHabits, &message.ProposedNotes, &message.ProposedFolders, &message.ProposedAreas, &message.ProposedProjects, &returnedModel, &message.CreatedAt)
	if err != nil {
		return AgentChatMessage{}, err
	}
	if returnedModel != nil {
		message.ActualModel = *returnedModel
	}
	return message, nil
}

func touchChatAfterMessage(ctx context.Context, tx pgx.Tx, chatID, userID uuid.UUID, role, content string) error {
	if role == "user" {
		_, err := tx.Exec(ctx, `
			UPDATE agent_chats
			SET title = CASE WHEN title = 'New chat' THEN LEFT($3, 80) ELSE title END, updated_at = now()
			WHERE id = $1 AND user_id = $2`, chatID, userID, content)
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE agent_chats SET updated_at = now() WHERE id = $1 AND user_id = $2`, chatID, userID)
	return err
}

func (s *Store) Push(ctx context.Context, userID uuid.UUID, mutations []tasks.Mutation) ([]PushItemResult, error) {
	if len(mutations) > 100 {
		return nil, errors.New("invalid mutation batch")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Serialize revision allocation so commit order matches nextval order.
	// Without this, tx B (revision 11) can commit before tx A (revision 10);
	// a client pulling since=9 would see 11, advance to 11, and forever miss
	// 10 when A commits. Rollback holes remain but are permanent and safe to
	// skip.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, int64(pushRevisionLockKey)); err != nil {
		return nil, err
	}
	results := make([]PushItemResult, 0, len(mutations))
	for index, mutation := range mutations {
		savepoint := fmt.Sprintf("sp_%d", index)
		if _, err := tx.Exec(ctx, `SAVEPOINT `+savepoint); err != nil {
			return nil, err
		}
		applied, err := pushOneMutation(ctx, tx, userID, mutation)
		if err != nil {
			_, _ = tx.Exec(ctx, `ROLLBACK TO SAVEPOINT `+savepoint)
			_, _ = tx.Exec(ctx, `RELEASE SAVEPOINT `+savepoint)
			code, message := classifyPushError(err)
			results = append(results, PushItemResult{
				MutationID: mutation.ID,
				OK:         false,
				Error:      &PushItemError{Code: code, Message: message},
			})
			continue
		}
		if _, err := tx.Exec(ctx, `RELEASE SAVEPOINT `+savepoint); err != nil {
			return nil, err
		}
		results = append(results, PushItemResult{
			MutationID: applied.MutationID,
			OK:         true,
			Revision:   applied.Revision,
			Entity:     applied.Entity,
			Task:       applied.Task,
			Habit:      applied.Habit,
		})
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return results, nil
}

// PushApplied is the legacy all-or-nothing view used by older callers: it
// returns only successful items. Prefer Push with per-item results.
func PushApplied(results []PushItemResult) []AppliedMutation {
	applied := make([]AppliedMutation, 0, len(results))
	for _, item := range results {
		if one, ok := item.ToApplied(); ok {
			applied = append(applied, one)
		}
	}
	return applied
}

func pushOneMutation(ctx context.Context, tx pgx.Tx, userID uuid.UUID, mutation tasks.Mutation) (AppliedMutation, error) {
	if mutation.Kind != "upsert" && mutation.Kind != "delete" {
		return AppliedMutation{}, fmt.Errorf("unknown mutation kind")
	}
	mutationID, err := uuid.Parse(mutation.ID)
	if err != nil {
		return AppliedMutation{}, fmt.Errorf("mutation id: %w", err)
	}
	if prior, found, err := lookupPriorMutation(ctx, tx, userID, mutation.ID, mutationID); err != nil {
		return AppliedMutation{}, err
	} else if found {
		return prior, nil
	}
	entity, err := resolveMutationEntity(mutation.Entity)
	if err != nil {
		return AppliedMutation{}, err
	}
	if entity == "habit" {
		return applyHabitMutation(ctx, tx, userID, mutation, mutationID)
	}
	return applyTaskMutation(ctx, tx, userID, mutation, mutationID)
}

func lookupPriorMutation(ctx context.Context, tx pgx.Tx, userID uuid.UUID, mutationIDStr string, mutationID uuid.UUID) (AppliedMutation, bool, error) {
	var priorJSON []byte
	var priorEntity string
	var priorRevision int64
	err := tx.QueryRow(ctx, `SELECT entity, task_json, revision FROM applied_mutations WHERE user_id = $1 AND mutation_id = $2`, userID, mutationID).Scan(&priorEntity, &priorJSON, &priorRevision)
	if err == nil {
		prior, convErr := priorToAppliedMutation(mutationIDStr, priorEntity, priorJSON, priorRevision)
		if convErr != nil {
			return AppliedMutation{}, false, convErr
		}
		return prior, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return AppliedMutation{}, false, err
	}
	return AppliedMutation{}, false, nil
}

func priorToAppliedMutation(mutationID, priorEntity string, priorJSON []byte, priorRevision int64) (AppliedMutation, error) {
	if priorEntity == "habit" {
		var prior tasks.Habit
		if err := json.Unmarshal(priorJSON, &prior); err != nil {
			return AppliedMutation{}, err
		}
		return AppliedMutation{MutationID: mutationID, Entity: "habit", Habit: prior, Revision: priorRevision}, nil
	}
	var prior tasks.Task
	if err := json.Unmarshal(priorJSON, &prior); err != nil {
		return AppliedMutation{}, err
	}
	return AppliedMutation{MutationID: mutationID, Entity: "task", Task: prior, Revision: priorRevision}, nil
}

func resolveMutationEntity(entity string) (string, error) {
	if entity == "" {
		entity = "task"
	}
	if entity != "task" && entity != "habit" {
		return "", errors.New("unknown mutation entity")
	}
	return entity, nil
}

func nextRevision(ctx context.Context, tx pgx.Tx) (int64, error) {
	var revision int64
	if err := tx.QueryRow(ctx, `SELECT nextval('server_revision_seq')`).Scan(&revision); err != nil {
		return 0, err
	}
	return revision, nil
}

func coalesceTimestamps(createdAt, updatedAt time.Time) (time.Time, time.Time) {
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	return createdAt, updatedAt
}

// mutationContext bundles the ambient write state shared by every row helper
// for one applied mutation.
type mutationContext struct {
	ctx      context.Context
	tx       pgx.Tx
	userID   uuid.UUID
	ownerID  uuid.UUID
	revision int64
}

func recordAppliedMutation(mc mutationContext, entityID, mutationID uuid.UUID, entity string, payload []byte) error {
	_, err := mc.tx.Exec(mc.ctx, `INSERT INTO applied_mutations (user_id, mutation_id, task_id, entity, revision, task_json) VALUES ($1, $2, $3, $4, $5, $6)`, mc.userID, mutationID, entityID, entity, mc.revision, payload)
	return err
}

func ensureHabitOwned(ctx context.Context, tx pgx.Tx, habitID, userID uuid.UUID) error {
	var owner uuid.UUID
	ownerErr := tx.QueryRow(ctx, `SELECT user_id FROM habits WHERE id = $1`, habitID).Scan(&owner)
	if ownerErr == nil && owner != userID {
		return errors.New("habit belongs to another user")
	}
	if ownerErr != nil && !errors.Is(ownerErr, pgx.ErrNoRows) {
		return ownerErr
	}
	return nil
}

func ensureTaskOwned(ctx context.Context, tx pgx.Tx, taskID, userID uuid.UUID) error {
	var owner uuid.UUID
	ownerErr := tx.QueryRow(ctx, `SELECT user_id FROM tasks WHERE id = $1`, taskID).Scan(&owner)
	if ownerErr == nil && owner != userID {
		return errors.New("task belongs to another user")
	}
	if ownerErr != nil && !errors.Is(ownerErr, pgx.ErrNoRows) {
		return ownerErr
	}
	return nil
}

func validateHabitSchedule(interval int, unit string) error {
	if interval < 1 || interval > 365 || (unit != "day" && unit != "week" && unit != "month" && unit != "year") {
		return errors.New("invalid habit schedule")
	}
	return nil
}

func validateHabitDates(startDate string, endDate *string, daysOfWeek []int, completedDates []string) error {
	start, err := time.Parse(isoDateLayout, startDate)
	if err != nil {
		return errors.New("invalid habit start date")
	}
	if endDate != nil {
		end, parseErr := time.Parse(isoDateLayout, strings.TrimSpace(*endDate))
		if parseErr != nil {
			return errors.New("invalid habit end date")
		}
		if end.Before(start) {
			return errors.New("habit end date must be on or after the start date")
		}
	}
	if len(daysOfWeek) > 7 {
		return errors.New("invalid habit weekdays")
	}
	seenDays := make(map[int]struct{}, len(daysOfWeek))
	for _, day := range daysOfWeek {
		if day < 0 || day > 6 {
			return errors.New("invalid habit weekday")
		}
		if _, exists := seenDays[day]; exists {
			return errors.New("habit weekdays must be unique")
		}
		seenDays[day] = struct{}{}
	}
	if len(completedDates) > 10000 {
		return errors.New("habit completion history is too large")
	}
	for _, completedDate := range completedDates {
		if _, err := time.Parse(isoDateLayout, completedDate); err != nil {
			return errors.New("invalid habit completion date")
		}
	}
	return nil
}

func validateHabit(habit tasks.Habit) error {
	if len(habit.Title) == 0 || len(habit.Title) > 400 {
		return fmt.Errorf("habit title must be between 1 and 400 characters")
	}
	if err := validateHabitSchedule(habit.Interval, habit.Unit); err != nil {
		return err
	}
	if len(habit.DaysOfWeek) > 0 && habit.Unit != "week" {
		return errors.New("habit weekdays require a weekly schedule")
	}
	return validateHabitDates(habit.StartDate, habit.EndDate, habit.DaysOfWeek, habit.CompletedDates)
}

func applyHabitMutation(ctx context.Context, tx pgx.Tx, userID uuid.UUID, mutation tasks.Mutation, mutationID uuid.UUID) (AppliedMutation, error) {
	habitID, err := uuid.Parse(mutation.Habit.ID)
	if err != nil {
		return AppliedMutation{}, fmt.Errorf("habit id: %w", err)
	}
	if err := ensureHabitOwned(ctx, tx, habitID, userID); err != nil {
		return AppliedMutation{}, err
	}
	if err := validateHabit(mutation.Habit); err != nil {
		return AppliedMutation{}, err
	}
	if err := checkClockSkew(mutation.Habit.UpdatedAt.UTC(), time.Now().UTC()); err != nil {
		return AppliedMutation{}, err
	}
	return persistHabitMutation(ctx, tx, userID, mutation, habitID, mutationID)
}

func insertHabitRow(mc mutationContext, habit tasks.Habit, habitID uuid.UUID, completedJSON []byte, createdAt, updatedAt time.Time) error {
	daysJSON, err := json.Marshal(habit.DaysOfWeek)
	if err != nil {
		return err
	}
	result, err := mc.tx.Exec(mc.ctx, `INSERT INTO habits (id, user_id, title, important, urgent, interval, unit, start_date, end_date, days_of_week, completed_dates, created_at, updated_at, deleted_at, revision) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT (user_id, id) DO UPDATE SET title = EXCLUDED.title, important = EXCLUDED.important, urgent = EXCLUDED.urgent, interval = EXCLUDED.interval, unit = EXCLUDED.unit, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, days_of_week = EXCLUDED.days_of_week, completed_dates = EXCLUDED.completed_dates, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision`, habitID, mc.userID, habit.Title, habit.Important, habit.Urgent, habit.Interval, habit.Unit, habit.StartDate, habit.EndDate, daysJSON, completedJSON, createdAt, updatedAt, habit.DeletedAt, mc.revision)
	if err != nil {
		return err
	}
	// Composite (user_id,id) upserts always affect exactly one row. Anything
	// else is a lost race: surface 409 so the client pulls and retries.
	if result.RowsAffected() != 1 {
		return ErrConflict
	}
	return nil
}

func insertHabitChangeRow(mc mutationContext, habit tasks.Habit, habitID uuid.UUID, completedJSON []byte, createdAt, updatedAt time.Time) error {
	daysJSON, err := json.Marshal(habit.DaysOfWeek)
	if err != nil {
		return err
	}
	_, err = mc.tx.Exec(mc.ctx, `INSERT INTO habit_changes (revision, habit_id, user_id, title, important, urgent, interval, unit, start_date, end_date, days_of_week, completed_dates, created_at, updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, mc.revision, habitID, mc.userID, habit.Title, habit.Important, habit.Urgent, habit.Interval, habit.Unit, habit.StartDate, habit.EndDate, daysJSON, completedJSON, createdAt, updatedAt, habit.DeletedAt)
	return err
}

func persistHabitMutation(ctx context.Context, tx pgx.Tx, userID uuid.UUID, mutation tasks.Mutation, habitID, mutationID uuid.UUID) (AppliedMutation, error) {
	revision, err := nextRevision(ctx, tx)
	if err != nil {
		return AppliedMutation{}, err
	}
	createdAt, updatedAt := coalesceTimestamps(mutation.Habit.CreatedAt.UTC(), mutation.Habit.UpdatedAt.UTC())
	if mutation.Habit.CompletedDates == nil {
		mutation.Habit.CompletedDates = []string{}
	}
	completedJSON, err := json.Marshal(mutation.Habit.CompletedDates)
	if err != nil {
		return AppliedMutation{}, err
	}
	mc := mutationContext{ctx: ctx, tx: tx, userID: userID, revision: revision}
	if err := insertHabitRow(mc, mutation.Habit, habitID, completedJSON, createdAt, updatedAt); err != nil {
		return AppliedMutation{}, err
	}
	if err := insertHabitChangeRow(mc, mutation.Habit, habitID, completedJSON, createdAt, updatedAt); err != nil {
		return AppliedMutation{}, err
	}
	mutation.Habit.ServerRevision = revision
	payload, err := json.Marshal(mutation.Habit)
	if err != nil {
		return AppliedMutation{}, err
	}
	if err := recordAppliedMutation(mc, habitID, mutationID, "habit", payload); err != nil {
		return AppliedMutation{}, err
	}
	return AppliedMutation{MutationID: mutation.ID, Entity: "habit", Habit: mutation.Habit, Revision: revision}, nil
}

func normalizeTaskDueDate(task *tasks.Task) error {
	if task.DueDate == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*task.DueDate)
	if trimmed == "" {
		task.DueDate = nil
		return nil
	}
	if _, err := time.Parse(isoDateLayout, trimmed); err != nil {
		return errors.New("invalid task due date")
	}
	task.DueDate = &trimmed
	return nil
}

func normalizeOptionalTaskDate(value **string, field string) error {
	if *value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(**value)
	if trimmed == "" {
		*value = nil
		return nil
	}
	if _, err := time.Parse(isoDateLayout, trimmed); err != nil {
		return fmt.Errorf("invalid task %s", field)
	}
	*value = &trimmed
	return nil
}

func validateTask(task *tasks.Task) error {
	if len(task.Title) == 0 || len(task.Title) > 400 {
		return fmt.Errorf("task title must be between 1 and 400 characters")
	}
	if len(task.Description) > 10000 {
		return fmt.Errorf("task description is too long")
	}
	if err := normalizeTaskDueDate(task); err != nil {
		return err
	}
	if err := normalizeOptionalTaskDate(&task.ScheduledDate, "scheduled date"); err != nil {
		return err
	}
	if err := normalizeOptionalTaskDate(&task.FollowUpDate, "follow-up date"); err != nil {
		return err
	}
	if task.Status == "" {
		task.Status = "inbox"
	}
	if task.Status != "inbox" && task.Status != "next" && task.Status != "in_progress" && task.Status != "waiting" && task.Status != "done" {
		return errors.New("invalid task status")
	}
	if task.Completed {
		task.Status = "done"
	}
	if task.Priority == 0 {
		task.Priority = 4
	}
	if task.Priority < 1 || task.Priority > 4 {
		return errors.New("invalid task priority")
	}
	return nil
}

func applyTaskMutation(ctx context.Context, tx pgx.Tx, userID uuid.UUID, mutation tasks.Mutation, mutationID uuid.UUID) (AppliedMutation, error) {
	taskID, err := uuid.Parse(mutation.Task.ID)
	if err != nil {
		return AppliedMutation{}, fmt.Errorf("task id: %w", err)
	}
	ownerID, err := authorizeTaskMutationTx(ctx, tx, userID, taskID, mutation.Task.ProjectID)
	if err != nil {
		return AppliedMutation{}, err
	}
	if err := validateTask(&mutation.Task); err != nil {
		return AppliedMutation{}, err
	}
	if len(mutation.Task.PeopleIDs) == 0 {
		mutation.Task.PeopleIDs = []string{userID.String()}
	}
	if err := checkClockSkew(mutation.Task.UpdatedAt.UTC(), time.Now().UTC()); err != nil {
		return AppliedMutation{}, err
	}
	return persistTaskMutation(ctx, tx, userID, ownerID, mutation, taskID, mutationID)
}

func insertTaskRow(mc mutationContext, task tasks.Task, taskID uuid.UUID, createdAt, updatedAt time.Time) error {
	peopleJSON, err := json.Marshal(task.PeopleIDs)
	if err != nil {
		return err
	}
	result, err := mc.tx.Exec(mc.ctx, `
			INSERT INTO tasks (id, user_id, title, description, due_date, priority, area_id, project_id, status, scheduled_date, assignee_name, follow_up_date, people_ids, completed, important, urgent, created_at, updated_at, deleted_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
			ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, due_date = EXCLUDED.due_date,
			 priority = EXCLUDED.priority, area_id = EXCLUDED.area_id, project_id = EXCLUDED.project_id, status = EXCLUDED.status,
			 scheduled_date = EXCLUDED.scheduled_date, assignee_name = EXCLUDED.assignee_name, follow_up_date = EXCLUDED.follow_up_date, people_ids = EXCLUDED.people_ids,
			 completed = EXCLUDED.completed, important = EXCLUDED.important, urgent = EXCLUDED.urgent,
			 updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision`, taskID, mc.ownerID, task.Title, task.Description, task.DueDate, task.Priority, task.AreaID, task.ProjectID, task.Status, task.ScheduledDate, task.AssigneeName, task.FollowUpDate, peopleJSON, task.Completed, task.Important, task.Urgent, createdAt, updatedAt, task.DeletedAt, mc.revision)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrConflict
	}
	return nil
}

func insertTaskChangeRow(mc mutationContext, task tasks.Task, taskID uuid.UUID, createdAt, updatedAt time.Time) error {
	peopleJSON, err := json.Marshal(task.PeopleIDs)
	if err != nil {
		return err
	}
	_, err = mc.tx.Exec(mc.ctx, `INSERT INTO task_changes (revision, task_id, user_id, title, description, due_date, priority, area_id, project_id, status, scheduled_date, assignee_name, follow_up_date, people_ids, completed, important, urgent, created_at, updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`, mc.revision, taskID, mc.userID, task.Title, task.Description, task.DueDate, task.Priority, task.AreaID, task.ProjectID, task.Status, task.ScheduledDate, task.AssigneeName, task.FollowUpDate, peopleJSON, task.Completed, task.Important, task.Urgent, createdAt, updatedAt, task.DeletedAt)
	return err
}

func persistTaskMutation(ctx context.Context, tx pgx.Tx, userID, ownerID uuid.UUID, mutation tasks.Mutation, taskID, mutationID uuid.UUID) (AppliedMutation, error) {
	revision, err := nextRevision(ctx, tx)
	if err != nil {
		return AppliedMutation{}, err
	}
	createdAt, updatedAt := coalesceTimestamps(mutation.Task.CreatedAt.UTC(), mutation.Task.UpdatedAt.UTC())
	mc := mutationContext{ctx: ctx, tx: tx, userID: userID, ownerID: ownerID, revision: revision}
	if err := insertTaskRow(mc, mutation.Task, taskID, createdAt, updatedAt); err != nil {
		return AppliedMutation{}, err
	}
	if err := replaceTaskPeopleTx(ctx, tx, taskID, userID, mutation.Task.ProjectID, mutation.Task.PeopleIDs); err != nil {
		return AppliedMutation{}, err
	}
	mutation.Task.ServerRevision = revision
	payload, err := json.Marshal(mutation.Task)
	if err != nil {
		return AppliedMutation{}, err
	}
	if err := insertTaskChangeRow(mc, mutation.Task, taskID, createdAt, updatedAt); err != nil {
		return AppliedMutation{}, err
	}
	if err := recordAppliedMutation(mc, taskID, mutationID, "task", payload); err != nil {
		return AppliedMutation{}, err
	}
	return AppliedMutation{MutationID: mutation.ID, Entity: "task", Task: mutation.Task, Revision: revision}, nil
}
func (s *Store) Pull(ctx context.Context, userID uuid.UUID, since int64) (PullResult, error) {
	if since < 0 {
		since = 0
	}
	// Ordered changelog cursor: UNION ALL across both changelogs so tasks and
	// habits share the single server_revision_seq timeline. LIMIT 201 detects
	// hasMore without a second COUNT query. Clients re-pull while hasMore.
	type orderedChange struct {
		revision int64
		kind     string
	}
	rows, err := s.pool.Query(ctx, `
		SELECT revision, kind FROM (
			SELECT c.revision, 'task'::text AS kind FROM task_changes c
			WHERE c.revision > $2 AND (c.user_id = $1 OR EXISTS (
				SELECT 1 FROM project_members pm
				WHERE pm.project_id = c.project_id AND pm.user_id = $1 AND pm.status = 'active'
			))
			UNION ALL
			SELECT revision, 'habit'::text AS kind FROM habit_changes WHERE user_id = $1 AND revision > $2
		) s ORDER BY revision ASC LIMIT 201`, userID, since)
	if err != nil {
		return PullResult{Tasks: []tasks.Task{}, Habits: []tasks.Habit{}, NextSince: since}, err
	}
	ordered := make([]orderedChange, 0, PullPageSize+1)
	for rows.Next() {
		var change orderedChange
		if err := rows.Scan(&change.revision, &change.kind); err != nil {
			rows.Close()
			return PullResult{Tasks: []tasks.Task{}, Habits: []tasks.Habit{}, NextSince: since}, err
		}
		ordered = append(ordered, change)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return PullResult{Tasks: []tasks.Task{}, Habits: []tasks.Habit{}, NextSince: since}, err
	}
	revisions := make([]int64, 0, len(ordered))
	for _, change := range ordered {
		revisions = append(revisions, change.revision)
	}
	nextSince, hasMore := computePullPage(revisions, since, PullPageSize)
	page := ordered
	if hasMore {
		page = ordered[:PullPageSize]
	}
	pageRevisions := make([]int64, 0, len(page))
	taskRevisions := make([]int64, 0)
	habitRevisions := make([]int64, 0)
	for _, change := range page {
		pageRevisions = append(pageRevisions, change.revision)
		if change.kind == "habit" {
			habitRevisions = append(habitRevisions, change.revision)
		} else {
			taskRevisions = append(taskRevisions, change.revision)
		}
	}
	_ = pageRevisions
	foundTasks, err := pullChangelogTasks(ctx, s.pool, userID, taskRevisions)
	if err != nil {
		return PullResult{Tasks: []tasks.Task{}, Habits: []tasks.Habit{}, NextSince: since}, err
	}
	foundHabits, err := pullChangelogHabits(ctx, s.pool, userID, habitRevisions)
	if err != nil {
		return PullResult{Tasks: []tasks.Task{}, Habits: []tasks.Habit{}, NextSince: since}, err
	}
	// Preserve global revision order across kinds.
	taskByRevision := make(map[int64]tasks.Task, len(foundTasks))
	for _, task := range foundTasks {
		taskByRevision[task.ServerRevision] = task
	}
	habitByRevision := make(map[int64]tasks.Habit, len(foundHabits))
	for _, habit := range foundHabits {
		habitByRevision[habit.ServerRevision] = habit
	}
	orderedTasks := make([]tasks.Task, 0, len(foundTasks))
	orderedHabits := make([]tasks.Habit, 0, len(foundHabits))
	for _, change := range page {
		if change.kind == "habit" {
			if habit, ok := habitByRevision[change.revision]; ok {
				orderedHabits = append(orderedHabits, habit)
			}
		} else {
			if task, ok := taskByRevision[change.revision]; ok {
				orderedTasks = append(orderedTasks, task)
			}
		}
	}
	workspaceRevision, _ := s.WorkspaceRevision(ctx, userID)
	profile, _ := s.ProfileForPull(ctx, userID)
	return PullResult{
		Tasks:             orderedTasks,
		Habits:            orderedHabits,
		NextSince:         nextSince,
		HasMore:           hasMore,
		WorkspaceRevision: workspaceRevision,
		Profile:           profile,
	}, nil
}

// PullLegacy adapts PullResult to the pre-pagination shape for older callers.
func (r PullResult) PullLegacy() ([]tasks.Task, []tasks.Habit, int64) {
	return r.Tasks, r.Habits, r.NextSince
}

func pullChangelogTasks(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, revisions []int64) ([]tasks.Task, error) {
	result := make([]tasks.Task, 0)
	if len(revisions) == 0 {
		return result, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT task_id::text, title, description, due_date, priority, area_id::text, project_id::text, status, scheduled_date, assignee_name, follow_up_date, people_ids, completed, important, urgent, created_at, updated_at, deleted_at, revision
		FROM task_changes c WHERE revision = ANY($2) AND (c.user_id = $1 OR EXISTS (
			SELECT 1 FROM project_members pm
			WHERE pm.project_id = c.project_id AND pm.user_id = $1 AND pm.status = 'active'
		)) ORDER BY revision ASC`, userID, revisions)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var task tasks.Task
		var peopleJSON []byte
		if err := rows.Scan(&task.ID, &task.Title, &task.Description, &task.DueDate, &task.Priority, &task.AreaID, &task.ProjectID, &task.Status, &task.ScheduledDate, &task.AssigneeName, &task.FollowUpDate, &peopleJSON, &task.Completed, &task.Important, &task.Urgent, &task.CreatedAt, &task.UpdatedAt, &task.DeletedAt, &task.ServerRevision); err != nil {
			return nil, err
		}
		if len(peopleJSON) > 0 && string(peopleJSON) != "null" {
			if err := json.Unmarshal(peopleJSON, &task.PeopleIDs); err != nil {
				return nil, err
			}
		}
		result = append(result, task)
	}
	return result, rows.Err()
}

func pullChangelogHabits(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, revisions []int64) ([]tasks.Habit, error) {
	habits := make([]tasks.Habit, 0)
	if len(revisions) == 0 {
		return habits, nil
	}
	habitRows, err := pool.Query(ctx, `
		SELECT habit_id::text, title, important, urgent, interval, unit, start_date, end_date, days_of_week, completed_dates, created_at, updated_at, deleted_at, revision
		FROM habit_changes WHERE user_id = $1 AND revision = ANY($2) ORDER BY revision ASC`, userID, revisions)
	if err != nil {
		return nil, err
	}
	defer habitRows.Close()
	for habitRows.Next() {
		habit, err := scanHabitRow(habitRows)
		if err != nil {
			return nil, err
		}
		habits = append(habits, habit)
	}
	return habits, habitRows.Err()
}

func scanHabitRow(habitRows pgx.Rows) (tasks.Habit, error) {
	var habit tasks.Habit
	var daysJSON []byte
	var completedJSON []byte
	if err := habitRows.Scan(&habit.ID, &habit.Title, &habit.Important, &habit.Urgent, &habit.Interval, &habit.Unit, &habit.StartDate, &habit.EndDate, &daysJSON, &completedJSON, &habit.CreatedAt, &habit.UpdatedAt, &habit.DeletedAt, &habit.ServerRevision); err != nil {
		return tasks.Habit{}, err
	}
	if err := json.Unmarshal(daysJSON, &habit.DaysOfWeek); err != nil {
		return tasks.Habit{}, err
	}
	if habit.DaysOfWeek == nil {
		habit.DaysOfWeek = []int{}
	}
	if err := json.Unmarshal(completedJSON, &habit.CompletedDates); err != nil {
		return tasks.Habit{}, err
	}
	if habit.CompletedDates == nil {
		habit.CompletedDates = []string{}
	}
	return habit, nil
}

// UserSettings holds per-user assistant settings. API keys are the stored
// (possibly sealed) values; sealing is handled by the HTTP layer.
type UserSettings struct {
	OpenRouterAPIKey string
	OpenAIAPIKey     string
	WebSearch        bool
	UpdatedAt        time.Time
}

func (s *Store) GetUserSettings(ctx context.Context, userID uuid.UUID) (UserSettings, error) {
	var settings UserSettings
	err := s.pool.QueryRow(ctx, `
		SELECT openrouter_api_key, openai_api_key, web_search, updated_at
		FROM user_settings
		WHERE user_id = $1`, userID).
		Scan(&settings.OpenRouterAPIKey, &settings.OpenAIAPIKey, &settings.WebSearch, &settings.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserSettings{}, ErrNotFound
	}
	return settings, err
}

func (s *Store) SaveUserSettings(ctx context.Context, userID uuid.UUID, openRouterAPIKey, openAIAPIKey string, webSearch bool) (UserSettings, error) {
	var settings UserSettings
	err := s.pool.QueryRow(ctx, `
		INSERT INTO user_settings (user_id, openrouter_api_key, openai_api_key, web_search, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (user_id) DO UPDATE SET
			openrouter_api_key = EXCLUDED.openrouter_api_key,
			openai_api_key = EXCLUDED.openai_api_key,
			web_search = EXCLUDED.web_search,
			updated_at = now()
		RETURNING openrouter_api_key, openai_api_key, web_search, updated_at`, userID, openRouterAPIKey, openAIAPIKey, webSearch).
		Scan(&settings.OpenRouterAPIKey, &settings.OpenAIAPIKey, &settings.WebSearch, &settings.UpdatedAt)
	return settings, err
}

// CleanupRetention deletes expired retention-window rows. It is called nightly
// from CleanupLoop:
//   - applied_mutations older than 90 days (idempotency window)
//   - sessions expired more than 30 days ago (or revoked long ago)
//
// Tombstone compaction (deleting old deleted_at rows from tasks/habits) is
// intentionally gated: we log the minimum active cursor but do NOT delete
// tombstones yet, because a client that has been offline longer than the
// compaction window would miss deletes. Deletion stays disabled until cursor
// tracking proves it safe.
func (s *Store) CleanupRetention(ctx context.Context, mutationsDays, sessionsDays int) error {
	if mutationsDays <= 0 {
		mutationsDays = 90
	}
	if sessionsDays <= 0 {
		sessionsDays = 30
	}
	if result, err := s.pool.Exec(ctx, `DELETE FROM applied_mutations WHERE created_at < now() - ($1::int * interval '1 day')`, mutationsDays); err != nil {
		return err
	} else {
		slog.Info("retention cleanup applied_mutations", "deleted", result.RowsAffected(), "older_than_days", mutationsDays)
	}
	if result, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now() - ($1::int * interval '1 day')`, sessionsDays); err != nil {
		return err
	} else {
		slog.Info("retention cleanup sessions", "deleted", result.RowsAffected(), "expired_days_ago", sessionsDays)
	}
	// Tombstone compaction gate: observe only.
	var minTaskRevision *int64
	_ = s.pool.QueryRow(ctx, `SELECT MIN(revision) FROM tasks WHERE deleted_at IS NOT NULL`).Scan(&minTaskRevision)
	var minHabitRevision *int64
	_ = s.pool.QueryRow(ctx, `SELECT MIN(revision) FROM habits WHERE deleted_at IS NOT NULL`).Scan(&minHabitRevision)
	slog.Info("tombstone compaction gated (no delete)", "min_deleted_task_revision", minTaskRevision, "min_deleted_habit_revision", minHabitRevision)
	return nil
}
