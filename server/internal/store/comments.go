package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Task comments in shared projects (specs/COMMENTS.md). Every read checks
// project membership; writes need the editor role; authors edit and delete
// their own comments and the project owner can delete any comment.

const maxCommentChars = 4000

var (
	ErrCommentForbidden = errors.New("you cannot change this comment")
	ErrProjectReadOnly  = errors.New("project is read-only for this user")
)

type CommentAuthor struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
}

type TaskComment struct {
	ID        string         `json:"id"`
	TaskID    string         `json:"taskId"`
	ProjectID string         `json:"projectId"`
	Author    *CommentAuthor `json:"author"`
	Body      string         `json:"body"`
	Mentions  []string       `json:"mentions"`
	CreatedAt time.Time      `json:"createdAt"`
	EditedAt  *time.Time     `json:"editedAt,omitempty"`
}

// MentionNotification is an unread (or recent) @mention of the user.
type MentionNotification struct {
	CommentID   string     `json:"commentId"`
	TaskID      string     `json:"taskId"`
	TaskTitle   string     `json:"taskTitle"`
	ProjectID   string     `json:"projectId"`
	ProjectName string     `json:"projectName"`
	AuthorName  string     `json:"authorName"`
	Excerpt     string     `json:"excerpt"`
	CreatedAt   time.Time  `json:"createdAt"`
	ReadAt      *time.Time `json:"readAt,omitempty"`
}

// CommentChange tells the API whom to notify after a write.
type CommentChange struct {
	Comment    TaskComment
	Audience   []uuid.UUID
	NewMention []uuid.UUID
}

func normalizeCommentBody(body string) (string, error) {
	body = strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
	if body == "" {
		return "", errors.New("a comment cannot be empty")
	}
	if utf8.RuneCountInString(body) > maxCommentChars {
		return "", errors.New("a comment holds at most 4000 characters")
	}
	return body, nil
}

// commentScopeTx checks that the task belongs to the project and returns the
// caller's role there.
func commentScopeTx(ctx context.Context, tx pgx.Tx, userID, projectID, taskID uuid.UUID) (string, error) {
	role, err := projectRoleTx(ctx, tx, userID, projectID)
	if err != nil {
		return "", err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL)`, taskID, projectID).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", ErrNotFound
	}
	return role, nil
}

// projectAudienceTx lists the owner and active members of a project.
func projectAudienceTx(ctx context.Context, tx pgx.Tx, projectID uuid.UUID) ([]uuid.UUID, error) {
	return collectUUIDs(ctx, tx, `
		SELECT user_id FROM projects WHERE id = $1
		UNION SELECT user_id FROM project_members WHERE project_id = $1 AND status = 'active'`, projectID)
}

// validMentionsTx keeps mentioned ids that are project members, not the
// author, without duplicates.
func validMentionsTx(ctx context.Context, tx pgx.Tx, projectID, authorID uuid.UUID, raw []string) ([]string, error) {
	audience, err := projectAudienceTx(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}
	members := make(map[uuid.UUID]bool, len(audience))
	for _, id := range audience {
		members[id] = true
	}
	seen := map[uuid.UUID]bool{}
	result := []string{}
	for _, value := range raw {
		id, err := uuid.Parse(strings.TrimSpace(value))
		if err != nil || id == authorID || !members[id] || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id.String())
		if len(result) >= 50 {
			break
		}
	}
	return result, nil
}

const commentColumns = `c.id::text, c.task_id::text, c.project_id::text, c.author_id::text, COALESCE(u.display_name, ''), COALESCE(u.avatar_url, ''),
	c.body, c.mentions, c.created_at, c.edited_at`

func scanComment(row pgx.Row) (TaskComment, error) {
	var comment TaskComment
	var authorID *string
	var name, avatar string
	var mentions []byte
	if err := row.Scan(&comment.ID, &comment.TaskID, &comment.ProjectID, &authorID, &name, &avatar, &comment.Body, &mentions, &comment.CreatedAt, &comment.EditedAt); err != nil {
		return TaskComment{}, err
	}
	if authorID != nil {
		comment.Author = &CommentAuthor{ID: *authorID, DisplayName: name, AvatarURL: avatar}
	}
	comment.Mentions = []string{}
	if len(mentions) > 0 {
		if err := json.Unmarshal(mentions, &comment.Mentions); err != nil {
			return TaskComment{}, err
		}
	}
	return comment, nil
}

func (s *Store) ListTaskComments(ctx context.Context, userID, projectID, taskID uuid.UUID) ([]TaskComment, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := commentScopeTx(ctx, tx, userID, projectID, taskID); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `
		SELECT `+commentColumns+`
		FROM task_comments c LEFT JOIN users u ON u.id = c.author_id
		WHERE c.task_id = $1 AND c.project_id = $2 AND c.deleted_at IS NULL
		ORDER BY c.created_at, c.id
		LIMIT 500`, taskID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	comments := []TaskComment{}
	for rows.Next() {
		comment, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Reading the thread marks the reader's mentions in it as read.
	if _, err := tx.Exec(ctx, `
		UPDATE comment_mentions m SET read_at = now()
		FROM task_comments c
		WHERE m.comment_id = c.id AND m.user_id = $1 AND c.task_id = $2 AND m.read_at IS NULL`, userID, taskID); err != nil {
		return nil, err
	}
	return comments, tx.Commit(ctx)
}

func loadCommentTx(ctx context.Context, tx pgx.Tx, commentID uuid.UUID) (TaskComment, error) {
	comment, err := scanComment(tx.QueryRow(ctx, `
		SELECT `+commentColumns+`
		FROM task_comments c LEFT JOIN users u ON u.id = c.author_id
		WHERE c.id = $1 AND c.deleted_at IS NULL`, commentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return TaskComment{}, ErrNotFound
	}
	return comment, err
}

func insertMentionsTx(ctx context.Context, tx pgx.Tx, commentID uuid.UUID, ids []string) ([]uuid.UUID, error) {
	added := []uuid.UUID{}
	for _, value := range ids {
		id, err := uuid.Parse(value)
		if err != nil {
			continue
		}
		result, err := tx.Exec(ctx, `INSERT INTO comment_mentions (user_id, comment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, commentID)
		if err != nil {
			return nil, err
		}
		if result.RowsAffected() == 1 {
			added = append(added, id)
		}
	}
	return added, nil
}

// CreateTaskComment adds a comment. The id may come from the client so a
// retried post never duplicates the comment.
func (s *Store) CreateTaskComment(ctx context.Context, userID, projectID, taskID uuid.UUID, commentID uuid.UUID, body string, mentions []string) (CommentChange, error) {
	body, err := normalizeCommentBody(body)
	if err != nil {
		return CommentChange{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CommentChange{}, err
	}
	defer tx.Rollback(ctx)
	role, err := commentScopeTx(ctx, tx, userID, projectID, taskID)
	if err != nil {
		return CommentChange{}, err
	}
	if role != "owner" && role != "editor" {
		return CommentChange{}, ErrProjectReadOnly
	}
	valid, err := validMentionsTx(ctx, tx, projectID, userID, mentions)
	if err != nil {
		return CommentChange{}, err
	}
	mentionsJSON, _ := json.Marshal(valid)
	if commentID == uuid.Nil {
		commentID = uuid.New()
	}
	var existingAuthor *uuid.UUID
	err = tx.QueryRow(ctx, `SELECT author_id FROM task_comments WHERE id = $1`, commentID).Scan(&existingAuthor)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if _, err := tx.Exec(ctx, `
			INSERT INTO task_comments (id, task_id, project_id, author_id, body, mentions)
			VALUES ($1, $2, $3, $4, $5, $6)`, commentID, taskID, projectID, userID, body, mentionsJSON); err != nil {
			return CommentChange{}, err
		}
	case err != nil:
		return CommentChange{}, err
	case existingAuthor == nil || *existingAuthor != userID:
		return CommentChange{}, ErrCommentForbidden
	}
	added, err := insertMentionsTx(ctx, tx, commentID, valid)
	if err != nil {
		return CommentChange{}, err
	}
	comment, err := loadCommentTx(ctx, tx, commentID)
	if err != nil {
		return CommentChange{}, err
	}
	audience, err := projectAudienceTx(ctx, tx, projectID)
	if err != nil {
		return CommentChange{}, err
	}
	return CommentChange{Comment: comment, Audience: audience, NewMention: added}, tx.Commit(ctx)
}

// UpdateTaskComment lets an author change their comment.
func (s *Store) UpdateTaskComment(ctx context.Context, userID, projectID, taskID, commentID uuid.UUID, body string, mentions []string) (CommentChange, error) {
	body, err := normalizeCommentBody(body)
	if err != nil {
		return CommentChange{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CommentChange{}, err
	}
	defer tx.Rollback(ctx)
	role, err := commentScopeTx(ctx, tx, userID, projectID, taskID)
	if err != nil {
		return CommentChange{}, err
	}
	if role != "owner" && role != "editor" {
		return CommentChange{}, ErrProjectReadOnly
	}
	var authorID *uuid.UUID
	err = tx.QueryRow(ctx, `SELECT author_id FROM task_comments WHERE id = $1 AND task_id = $2 AND deleted_at IS NULL FOR UPDATE`, commentID, taskID).Scan(&authorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CommentChange{}, ErrNotFound
	}
	if err != nil {
		return CommentChange{}, err
	}
	if authorID == nil || *authorID != userID {
		return CommentChange{}, ErrCommentForbidden
	}
	valid, err := validMentionsTx(ctx, tx, projectID, userID, mentions)
	if err != nil {
		return CommentChange{}, err
	}
	mentionsJSON, _ := json.Marshal(valid)
	if _, err := tx.Exec(ctx, `
		UPDATE task_comments SET body = $2, mentions = $3,
			edited_at = CASE WHEN body <> $2 THEN now() ELSE edited_at END
		WHERE id = $1`, commentID, body, mentionsJSON); err != nil {
		return CommentChange{}, err
	}
	// People no longer mentioned lose the notification; new ones get one.
	if _, err := tx.Exec(ctx, `DELETE FROM comment_mentions WHERE comment_id = $1 AND NOT (user_id::text = ANY($2))`, commentID, valid); err != nil {
		return CommentChange{}, err
	}
	added, err := insertMentionsTx(ctx, tx, commentID, valid)
	if err != nil {
		return CommentChange{}, err
	}
	comment, err := loadCommentTx(ctx, tx, commentID)
	if err != nil {
		return CommentChange{}, err
	}
	audience, err := projectAudienceTx(ctx, tx, projectID)
	if err != nil {
		return CommentChange{}, err
	}
	return CommentChange{Comment: comment, Audience: audience, NewMention: added}, tx.Commit(ctx)
}

// DeleteTaskComment removes a comment (the author, or the project owner).
func (s *Store) DeleteTaskComment(ctx context.Context, userID, projectID, taskID, commentID uuid.UUID) ([]uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	role, err := commentScopeTx(ctx, tx, userID, projectID, taskID)
	if err != nil {
		return nil, err
	}
	var authorID *uuid.UUID
	err = tx.QueryRow(ctx, `SELECT author_id FROM task_comments WHERE id = $1 AND task_id = $2 AND deleted_at IS NULL FOR UPDATE`, commentID, taskID).Scan(&authorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	isAuthor := authorID != nil && *authorID == userID && (role == "owner" || role == "editor")
	if !isAuthor && role != "owner" {
		return nil, ErrCommentForbidden
	}
	if _, err := tx.Exec(ctx, `UPDATE task_comments SET deleted_at = now(), body = '-', mentions = '[]'::jsonb WHERE id = $1`, commentID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM comment_mentions WHERE comment_id = $1`, commentID); err != nil {
		return nil, err
	}
	audience, err := projectAudienceTx(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}
	return audience, tx.Commit(ctx)
}

// ListMentions returns the user's mention notifications in projects they
// still belong to, newest first, and how many are unread.
func (s *Store) ListMentions(ctx context.Context, userID uuid.UUID, limit int) ([]MentionNotification, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT c.id::text, c.task_id::text, t.title, c.project_id::text, p.name, COALESCE(u.display_name, ''), c.body, m.created_at, m.read_at
		FROM comment_mentions m
		JOIN task_comments c ON c.id = m.comment_id AND c.deleted_at IS NULL
		JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL
		JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
		LEFT JOIN users u ON u.id = c.author_id
		WHERE m.user_id = $1 AND (p.user_id = $1 OR EXISTS (
			SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
		))
		ORDER BY m.created_at DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	result := []MentionNotification{}
	unread := 0
	for rows.Next() {
		var item MentionNotification
		if err := rows.Scan(&item.CommentID, &item.TaskID, &item.TaskTitle, &item.ProjectID, &item.ProjectName, &item.AuthorName, &item.Excerpt, &item.CreatedAt, &item.ReadAt); err != nil {
			return nil, 0, err
		}
		if runes := []rune(item.Excerpt); len(runes) > 160 {
			item.Excerpt = string(runes[:160]) + "…"
		}
		if item.ReadAt == nil {
			unread++
		}
		result = append(result, item)
	}
	return result, unread, rows.Err()
}

// MarkMentionsRead marks some (or, with no ids, all) mentions as read.
func (s *Store) MarkMentionsRead(ctx context.Context, userID uuid.UUID, commentIDs []uuid.UUID) error {
	if len(commentIDs) == 0 {
		_, err := s.pool.Exec(ctx, `UPDATE comment_mentions SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, userID)
		return err
	}
	_, err := s.pool.Exec(ctx, `UPDATE comment_mentions SET read_at = now() WHERE user_id = $1 AND comment_id = ANY($2) AND read_at IS NULL`, userID, commentIDs)
	return err
}
