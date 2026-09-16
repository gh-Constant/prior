package store

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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

type AgentChat struct {
	ID           uuid.UUID          `json:"id"`
	Title        string             `json:"title"`
	CreatedAt    time.Time          `json:"createdAt"`
	UpdatedAt    time.Time          `json:"updatedAt"`
	MessageCount int                `json:"messageCount"`
	Messages     []AgentChatMessage `json:"messages,omitempty"`
}

type AgentChatMessage struct {
	ID            uuid.UUID       `json:"id"`
	Role          string          `json:"role"`
	Content       string          `json:"content"`
	ProposedTasks json.RawMessage `json:"proposedTasks,omitempty"`
	ActualModel   string          `json:"actualModel,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type AppliedMutation struct {
	MutationID string
	Entity     string
	Task       tasks.Task
	Habit      tasks.Habit
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
		SELECT id, role, content, proposed_tasks, actual_model, created_at
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
		if err := rows.Scan(&message.ID, &message.Role, &message.Content, &message.ProposedTasks, &actualModel, &message.CreatedAt); err != nil {
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

func (s *Store) SaveAgentChatMessage(ctx context.Context, userID, chatID, messageID uuid.UUID, role, content string, proposedTasks json.RawMessage, actualModel string) (AgentChatMessage, error) {
	content = strings.TrimSpace(content)
	if role != "user" && role != "assistant" {
		return AgentChatMessage{}, errors.New("invalid chat message role")
	}
	if content == "" || len(content) > 20000 {
		return AgentChatMessage{}, errors.New("chat message content must be between 1 and 20000 characters")
	}
	if len(proposedTasks) == 0 || string(proposedTasks) == "null" {
		proposedTasks = json.RawMessage("[]")
	}
	var proposedList []json.RawMessage
	if err := json.Unmarshal(proposedTasks, &proposedList); err != nil {
		return AgentChatMessage{}, errors.New("proposed tasks must be a JSON array")
	}
	if len(proposedTasks) > 1<<20 {
		return AgentChatMessage{}, errors.New("proposed tasks payload is too large")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AgentChatMessage{}, err
	}
	defer tx.Rollback(ctx)

	var owner uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT user_id FROM agent_chats WHERE id = $1`, chatID).Scan(&owner); errors.Is(err, pgx.ErrNoRows) {
		return AgentChatMessage{}, ErrNotFound
	} else if err != nil {
		return AgentChatMessage{}, err
	} else if owner != userID {
		return AgentChatMessage{}, errors.New("chat belongs to another user")
	}

	var existingChatID uuid.UUID
	existingErr := tx.QueryRow(ctx, `SELECT chat_id FROM agent_chat_messages WHERE id = $1`, messageID).Scan(&existingChatID)
	if existingErr == nil && existingChatID != chatID {
		return AgentChatMessage{}, errors.New("message belongs to another chat")
	}
	if existingErr != nil && !errors.Is(existingErr, pgx.ErrNoRows) {
		return AgentChatMessage{}, existingErr
	}

	var actualModelValue any
	if strings.TrimSpace(actualModel) != "" {
		actualModelValue = strings.TrimSpace(actualModel)
	}
	var message AgentChatMessage
	var returnedModel *string
	err = tx.QueryRow(ctx, `
		INSERT INTO agent_chat_messages (id, chat_id, role, content, proposed_tasks, actual_model)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, content = EXCLUDED.content,
		proposed_tasks = EXCLUDED.proposed_tasks, actual_model = EXCLUDED.actual_model
		RETURNING id, role, content, proposed_tasks, actual_model, created_at`,
		messageID, chatID, role, content, proposedTasks, actualModelValue).
		Scan(&message.ID, &message.Role, &message.Content, &message.ProposedTasks, &returnedModel, &message.CreatedAt)
	if err != nil {
		return AgentChatMessage{}, err
	}
	if returnedModel != nil {
		message.ActualModel = *returnedModel
	}

	if role == "user" {
		_, err = tx.Exec(ctx, `
			UPDATE agent_chats
			SET title = CASE WHEN title = 'New chat' THEN LEFT($3, 80) ELSE title END, updated_at = now()
			WHERE id = $1 AND user_id = $2`, chatID, userID, content)
	} else {
		_, err = tx.Exec(ctx, `UPDATE agent_chats SET updated_at = now() WHERE id = $1 AND user_id = $2`, chatID, userID)
	}
	if err != nil {
		return AgentChatMessage{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AgentChatMessage{}, err
	}
	return message, nil
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
		var priorEntity string
		var priorRevision int64
		err := tx.QueryRow(ctx, `SELECT entity, task_json, revision FROM applied_mutations WHERE user_id = $1 AND mutation_id = $2`, userID, mutationID).Scan(&priorEntity, &priorJSON, &priorRevision)
		if err == nil {
			if priorEntity == "habit" {
				var prior tasks.Habit
				if err := json.Unmarshal(priorJSON, &prior); err != nil {
					return nil, err
				}
				results = append(results, AppliedMutation{MutationID: mutation.ID, Entity: "habit", Habit: prior, Revision: priorRevision})
			} else {
				var prior tasks.Task
				if err := json.Unmarshal(priorJSON, &prior); err != nil {
					return nil, err
				}
				results = append(results, AppliedMutation{MutationID: mutation.ID, Entity: "task", Task: prior, Revision: priorRevision})
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		entity := mutation.Entity
		if entity == "" {
			entity = "task"
		}
		if entity != "task" && entity != "habit" {
			return nil, errors.New("unknown mutation entity")
		}
		if entity == "habit" {
			habitID, parseErr := uuid.Parse(mutation.Habit.ID)
			if parseErr != nil {
				return nil, fmt.Errorf("habit id: %w", parseErr)
			}
			var owner uuid.UUID
			ownerErr := tx.QueryRow(ctx, `SELECT user_id FROM habits WHERE id = $1`, habitID).Scan(&owner)
			if ownerErr == nil && owner != userID {
				return nil, errors.New("habit belongs to another user")
			}
			if ownerErr != nil && !errors.Is(ownerErr, pgx.ErrNoRows) {
				return nil, ownerErr
			}
			if len(mutation.Habit.Title) == 0 || len(mutation.Habit.Title) > 400 {
				return nil, fmt.Errorf("habit title must be between 1 and 400 characters")
			}
			if mutation.Habit.Interval < 1 || mutation.Habit.Interval > 365 || (mutation.Habit.Unit != "day" && mutation.Habit.Unit != "week" && mutation.Habit.Unit != "month" && mutation.Habit.Unit != "year") {
				return nil, errors.New("invalid habit schedule")
			}
			if _, err := time.Parse("2006-01-02", mutation.Habit.StartDate); err != nil {
				return nil, errors.New("invalid habit start date")
			}
			if len(mutation.Habit.CompletedDates) > 10000 {
				return nil, errors.New("habit completion history is too large")
			}
			for _, completedDate := range mutation.Habit.CompletedDates {
				if _, err := time.Parse("2006-01-02", completedDate); err != nil {
					return nil, errors.New("invalid habit completion date")
				}
			}
			var revision int64
			if err := tx.QueryRow(ctx, `SELECT nextval('server_revision_seq')`).Scan(&revision); err != nil {
				return nil, err
			}
			createdAt := mutation.Habit.CreatedAt.UTC()
			updatedAt := mutation.Habit.UpdatedAt.UTC()
			if createdAt.IsZero() {
				createdAt = time.Now().UTC()
			}
			if updatedAt.IsZero() {
				updatedAt = time.Now().UTC()
			}
			completedJSON, err := json.Marshal(mutation.Habit.CompletedDates)
			if err != nil {
				return nil, err
			}
			_, err = tx.Exec(ctx, `INSERT INTO habits (id, user_id, title, important, urgent, interval, unit, start_date, completed_dates, created_at, updated_at, deleted_at, revision) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, important = EXCLUDED.important, urgent = EXCLUDED.urgent, interval = EXCLUDED.interval, unit = EXCLUDED.unit, start_date = EXCLUDED.start_date, completed_dates = EXCLUDED.completed_dates, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision WHERE habits.user_id = EXCLUDED.user_id`, habitID, userID, mutation.Habit.Title, mutation.Habit.Important, mutation.Habit.Urgent, mutation.Habit.Interval, mutation.Habit.Unit, mutation.Habit.StartDate, completedJSON, createdAt, updatedAt, mutation.Habit.DeletedAt, revision)
			if err != nil {
				return nil, err
			}
			mutation.Habit.ServerRevision = revision
			payload, err := json.Marshal(mutation.Habit)
			if err != nil {
				return nil, err
			}
			_, err = tx.Exec(ctx, `INSERT INTO habit_changes (revision, habit_id, user_id, title, important, urgent, interval, unit, start_date, completed_dates, created_at, updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, revision, habitID, userID, mutation.Habit.Title, mutation.Habit.Important, mutation.Habit.Urgent, mutation.Habit.Interval, mutation.Habit.Unit, mutation.Habit.StartDate, completedJSON, createdAt, updatedAt, mutation.Habit.DeletedAt)
			if err != nil {
				return nil, err
			}
			_, err = tx.Exec(ctx, `INSERT INTO applied_mutations (user_id, mutation_id, task_id, entity, revision, task_json) VALUES ($1, $2, $3, $4, $5, $6)`, userID, mutationID, habitID, "habit", revision, payload)
			if err != nil {
				return nil, err
			}
			results = append(results, AppliedMutation{MutationID: mutation.ID, Entity: "habit", Habit: mutation.Habit, Revision: revision})
			continue
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
		_, err = tx.Exec(ctx, `INSERT INTO applied_mutations (user_id, mutation_id, task_id, entity, revision, task_json) VALUES ($1, $2, $3, $4, $5, $6)`, userID, mutationID, taskID, "task", revision, payload)
		if err != nil {
			return nil, err
		}
		results = append(results, AppliedMutation{MutationID: mutation.ID, Entity: "task", Task: mutation.Task, Revision: revision})
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return results, nil
}

func (s *Store) Pull(ctx context.Context, userID uuid.UUID, since int64) ([]tasks.Task, []tasks.Habit, int64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT ON (task_id) task_id, title, completed, important, urgent, created_at, updated_at, deleted_at, revision
		FROM task_changes WHERE user_id = $1 AND revision > $2 ORDER BY task_id, revision DESC`, userID, since)
	if err != nil {
		return nil, nil, since, err
	}
	result := make([]tasks.Task, 0)
	var latest int64 = since
	for rows.Next() {
		var task tasks.Task
		if err := rows.Scan(&task.ID, &task.Title, &task.Completed, &task.Important, &task.Urgent, &task.CreatedAt, &task.UpdatedAt, &task.DeletedAt, &task.ServerRevision); err != nil {
			rows.Close()
			return nil, nil, since, err
		}
		if task.ServerRevision > latest {
			latest = task.ServerRevision
		}
		result = append(result, task)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, nil, since, err
	}
	rows.Close()
	habitRows, err := s.pool.Query(ctx, `
		SELECT DISTINCT ON (habit_id) habit_id, title, important, urgent, interval, unit, start_date::text, completed_dates, created_at, updated_at, deleted_at, revision
		FROM habit_changes WHERE user_id = $1 AND revision > $2 ORDER BY habit_id, revision DESC`, userID, since)
	if err != nil {
		return nil, nil, since, err
	}
	habits := make([]tasks.Habit, 0)
	for habitRows.Next() {
		var habit tasks.Habit
		var completedJSON []byte
		if err := habitRows.Scan(&habit.ID, &habit.Title, &habit.Important, &habit.Urgent, &habit.Interval, &habit.Unit, &habit.StartDate, &completedJSON, &habit.CreatedAt, &habit.UpdatedAt, &habit.DeletedAt, &habit.ServerRevision); err != nil {
			habitRows.Close()
			return nil, nil, since, err
		}
		if err := json.Unmarshal(completedJSON, &habit.CompletedDates); err != nil {
			habitRows.Close()
			return nil, nil, since, err
		}
		if habit.ServerRevision > latest {
			latest = habit.ServerRevision
		}
		habits = append(habits, habit)
	}
	if err := habitRows.Err(); err != nil {
		habitRows.Close()
		return nil, nil, since, err
	}
	habitRows.Close()
	return result, habits, latest, nil
}
