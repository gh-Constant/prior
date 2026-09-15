package store

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")
var ErrEmailTaken = errors.New("email already registered")

type User struct {
	ID            uuid.UUID `json:"id"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"emailVerified"`
	DisplayName   string    `json:"displayName"`
	AvatarURL     string    `json:"avatarUrl,omitempty"`
}

type AppliedMutation struct {
	MutationID string
	Task       tasks.Task
	Revision   int64
}

type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) UpsertUser(ctx context.Context, googleSub, email string, verified bool, displayName, avatarURL string) (User, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)

	var user User
	var id uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE google_sub = $1`, googleSub).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&id)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			INSERT INTO users (google_sub, email, email_verified, display_name, avatar_url, last_login_at)
			VALUES ($1, $2, $3, $4, $5, now())
			RETURNING id, email, email_verified, display_name, avatar_url`, googleSub, email, verified, displayName, avatarURL).
			Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
	} else if err == nil {
		err = tx.QueryRow(ctx, `
			UPDATE users SET google_sub = $1, email = $2, email_verified = $3, display_name = $4, avatar_url = $5,
			updated_at = now(), last_login_at = now()
			WHERE id = $6
			RETURNING id, email, email_verified, display_name, avatar_url`, googleSub, email, verified, displayName, avatarURL, id).
			Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
	}
	if err != nil {
		return User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Store) CreatePasswordUser(ctx context.Context, email, passwordHash, displayName string) (User, error) {
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
	var user User
	var passwordHash *string
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, email_verified, display_name, avatar_url, password_hash
		FROM users WHERE email = $1`, email).
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

func (s *Store) TouchLogin(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, userID)
	return err
}

func (s *Store) CreateSession(ctx context.Context, userID uuid.UUID, token, device, platform string, ttl time.Duration) error {
	hash := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, device_name, platform, expires_at) VALUES ($1, $2, $3, $4, $5)`, userID, hash[:], device, platform, time.Now().UTC().Add(ttl))
	return err
}

func (s *Store) UserForToken(ctx context.Context, token string) (User, error) {
	hash := sha256.Sum256([]byte(token))
	var user User
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.email_verified, u.display_name, u.avatar_url
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, hash[:]).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err == nil {
		_, _ = s.pool.Exec(ctx, `UPDATE sessions SET last_used_at = now() WHERE token_hash = $1`, hash[:])
	}
	return user, err
}

func (s *Store) RevokeSession(ctx context.Context, token string) error {
	hash := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, hash[:])
	return err
}

func (s *Store) Push(ctx context.Context, userID uuid.UUID, mutations []tasks.Mutation) ([]AppliedMutation, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	results := make([]AppliedMutation, 0, len(mutations))
	for _, mutation := range mutations {
		if mutation.Kind != "upsert" && mutation.Kind != "delete" {
			return nil, fmt.Errorf("unknown mutation kind")
		}
		mutationID, parseErr := uuid.Parse(mutation.ID)
		if parseErr != nil {
			return nil, fmt.Errorf("mutation id: %w", parseErr)
		}
		var priorJSON []byte
		var priorRevision int64
		err := tx.QueryRow(ctx, `SELECT task_json, revision FROM applied_mutations WHERE user_id = $1 AND mutation_id = $2`, userID, mutationID).Scan(&priorJSON, &priorRevision)
		if err == nil {
			var prior tasks.Task
			if err := json.Unmarshal(priorJSON, &prior); err != nil {
				return nil, err
			}
			results = append(results, AppliedMutation{MutationID: mutation.ID, Task: prior, Revision: priorRevision})
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		taskID, parseErr := uuid.Parse(mutation.Task.ID)
		if parseErr != nil {
			return nil, fmt.Errorf("task id: %w", parseErr)
		}
		var owner uuid.UUID
		ownerErr := tx.QueryRow(ctx, `SELECT user_id FROM tasks WHERE id = $1`, taskID).Scan(&owner)
		if ownerErr == nil && owner != userID {
			return nil, errors.New("task belongs to another user")
		}
		if ownerErr != nil && !errors.Is(ownerErr, pgx.ErrNoRows) {
			return nil, ownerErr
		}
		if len(mutation.Task.Title) == 0 || len(mutation.Task.Title) > 400 {
			return nil, fmt.Errorf("task title must be between 1 and 400 characters")
		}
		var revision int64
		if err := tx.QueryRow(ctx, `SELECT nextval('server_revision_seq')`).Scan(&revision); err != nil {
			return nil, err
		}
		createdAt := mutation.Task.CreatedAt.UTC()
		updatedAt := mutation.Task.UpdatedAt.UTC()
		if createdAt.IsZero() {
			createdAt = time.Now().UTC()
		}
		if updatedAt.IsZero() {
			updatedAt = time.Now().UTC()
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO tasks (id, user_id, title, completed, important, urgent, created_at, updated_at, deleted_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, completed = EXCLUDED.completed, important = EXCLUDED.important,
			 urgent = EXCLUDED.urgent, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision
			WHERE tasks.user_id = EXCLUDED.user_id`, taskID, userID, mutation.Task.Title, mutation.Task.Completed, mutation.Task.Important, mutation.Task.Urgent, createdAt, updatedAt, mutation.Task.DeletedAt, revision)
		if err != nil {
			return nil, err
		}
		mutation.Task.ServerRevision = revision
		payload, err := json.Marshal(mutation.Task)
		if err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO task_changes (revision, task_id, user_id, title, completed, important, urgent, created_at, updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, revision, taskID, userID, mutation.Task.Title, mutation.Task.Completed, mutation.Task.Important, mutation.Task.Urgent, createdAt, updatedAt, mutation.Task.DeletedAt)
		if err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO applied_mutations (user_id, mutation_id, task_id, revision, task_json) VALUES ($1, $2, $3, $4, $5)`, userID, mutationID, taskID, revision, payload)
		if err != nil {
			return nil, err
		}
		results = append(results, AppliedMutation{MutationID: mutation.ID, Task: mutation.Task, Revision: revision})
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return results, nil
}

func (s *Store) Pull(ctx context.Context, userID uuid.UUID, since int64) ([]tasks.Task, int64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT ON (task_id) task_id, title, completed, important, urgent, created_at, updated_at, deleted_at, revision
		FROM task_changes WHERE user_id = $1 AND revision > $2 ORDER BY task_id, revision DESC`, userID, since)
	if err != nil {
		return nil, since, err
	}
	defer rows.Close()
	result := make([]tasks.Task, 0)
	var latest int64 = since
	for rows.Next() {
		var task tasks.Task
		if err := rows.Scan(&task.ID, &task.Title, &task.Completed, &task.Important, &task.Urgent, &task.CreatedAt, &task.UpdatedAt, &task.DeletedAt, &task.ServerRevision); err != nil {
			return nil, since, err
		}
		if task.ServerRevision > latest {
			latest = task.ServerRevision
		}
		result = append(result, task)
	}
	if err := rows.Err(); err != nil {
		return nil, since, err
	}
	return result, latest, nil
}
