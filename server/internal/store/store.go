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
	ID              uuid.UUID       `json:"id"`
	Role            string          `json:"role"`
	Content         string          `json:"content"`
	ProposedTasks   json.RawMessage `json:"proposedTasks,omitempty"`
	ProposedHabits  json.RawMessage `json:"proposedHabits,omitempty"`
	ProposedNotes   json.RawMessage `json:"proposedNotes,omitempty"`
	ProposedFolders json.RawMessage `json:"proposedFolders,omitempty"`
	ActualModel     string          `json:"actualModel,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
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

// isoDateLayout is the YYYY-MM-DD layout used for habit and task dates.
const isoDateLayout = "2006-01-02"

// SaveAgentChatMessageParams groups SaveAgentChatMessage arguments so the
// method stays within the parameter-count limit.
type SaveAgentChatMessageParams struct {
	UserID          uuid.UUID
	ChatID          uuid.UUID
	MessageID       uuid.UUID
	Role            string
	Content         string
	ProposedTasks   json.RawMessage
	ProposedHabits  json.RawMessage
	ProposedNotes   json.RawMessage
	ProposedFolders json.RawMessage
	ActualModel     string
}

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

func (s *Store) UpdateUserProfile(ctx context.Context, userID uuid.UUID, displayName string) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `
		UPDATE users SET display_name = $1, updated_at = now()
		WHERE id = $2
		RETURNING id, email, email_verified, display_name, avatar_url`, displayName, userID).
		Scan(&user.ID, &user.Email, &user.EmailVerified, &user.DisplayName, &user.AvatarURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
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
		SELECT id, role, content, proposed_tasks, proposed_habits, proposed_notes, proposed_folders, actual_model, created_at
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
		if err := rows.Scan(&message.ID, &message.Role, &message.Content, &message.ProposedTasks, &message.ProposedHabits, &message.ProposedNotes, &message.ProposedFolders, &actualModel, &message.CreatedAt); err != nil {
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
	proposedTasks, proposedHabits, proposedNotes, proposedFolders, err := normalizeProposedPayloads(params.ProposedTasks, params.ProposedHabits, params.ProposedNotes, params.ProposedFolders)
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
	message, err := upsertChatMessage(ctx, tx, params, content, proposedTasks, proposedHabits, proposedNotes, proposedFolders)
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

func normalizeProposedPayloads(proposedTasks, proposedHabits, proposedNotes, proposedFolders json.RawMessage) (json.RawMessage, json.RawMessage, json.RawMessage, json.RawMessage, error) {
	if len(proposedTasks) == 0 || string(proposedTasks) == "null" {
		proposedTasks = json.RawMessage("[]")
	}
	var proposedList []json.RawMessage
	if err := json.Unmarshal(proposedTasks, &proposedList); err != nil {
		return nil, nil, nil, nil, errors.New("proposed tasks must be a JSON array")
	}
	if len(proposedTasks) > 1<<20 || len(proposedHabits) > 1<<20 || len(proposedNotes) > 1<<20 || len(proposedFolders) > 1<<20 {
		return nil, nil, nil, nil, errors.New("proposed items payload is too large")
	}
	if len(proposedHabits) == 0 || string(proposedHabits) == "null" {
		proposedHabits = json.RawMessage("[]")
	}
	var proposedHabitList []json.RawMessage
	if err := json.Unmarshal(proposedHabits, &proposedHabitList); err != nil {
		return nil, nil, nil, nil, errors.New("proposed habits must be a JSON array")
	}
	if len(proposedNotes) == 0 || string(proposedNotes) == "null" {
		proposedNotes = json.RawMessage("[]")
	}
	var proposedNoteList []json.RawMessage
	if err := json.Unmarshal(proposedNotes, &proposedNoteList); err != nil {
		return nil, nil, nil, nil, errors.New("proposed notes must be a JSON array")
	}
	if len(proposedFolders) == 0 || string(proposedFolders) == "null" {
		proposedFolders = json.RawMessage("[]")
	}
	var proposedFolderList []json.RawMessage
	if err := json.Unmarshal(proposedFolders, &proposedFolderList); err != nil {
		return nil, nil, nil, nil, errors.New("proposed folders must be a JSON array")
	}
	return proposedTasks, proposedHabits, proposedNotes, proposedFolders, nil
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
	var existingChatID uuid.UUID
	existingErr := tx.QueryRow(ctx, `SELECT chat_id FROM agent_chat_messages WHERE id = $1`, messageID).Scan(&existingChatID)
	if existingErr == nil && existingChatID != chatID {
		return errors.New("message belongs to another chat")
	}
	if existingErr != nil && !errors.Is(existingErr, pgx.ErrNoRows) {
		return existingErr
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

func upsertChatMessage(ctx context.Context, tx pgx.Tx, params SaveAgentChatMessageParams, content string, proposedTasks, proposedHabits, proposedNotes, proposedFolders json.RawMessage) (AgentChatMessage, error) {
	var message AgentChatMessage
	var returnedModel *string
	err := tx.QueryRow(ctx, `
		INSERT INTO agent_chat_messages (id, chat_id, role, content, proposed_tasks, proposed_habits, proposed_notes, proposed_folders, actual_model)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, content = EXCLUDED.content,
		proposed_tasks = EXCLUDED.proposed_tasks, proposed_habits = EXCLUDED.proposed_habits, proposed_notes = EXCLUDED.proposed_notes, proposed_folders = EXCLUDED.proposed_folders, actual_model = EXCLUDED.actual_model
		RETURNING id, role, content, proposed_tasks, proposed_habits, proposed_notes, proposed_folders, actual_model, created_at`,
		params.MessageID, params.ChatID, params.Role, content, proposedTasks, proposedHabits, proposedNotes, proposedFolders, chatModelValue(params.ActualModel)).
		Scan(&message.ID, &message.Role, &message.Content, &message.ProposedTasks, &message.ProposedHabits, &message.ProposedNotes, &message.ProposedFolders, &returnedModel, &message.CreatedAt)
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

func (s *Store) Push(ctx context.Context, userID uuid.UUID, mutations []tasks.Mutation) ([]AppliedMutation, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	results := make([]AppliedMutation, 0, len(mutations))
	for _, mutation := range mutations {
		applied, err := pushOneMutation(ctx, tx, userID, mutation)
		if err != nil {
			return nil, err
		}
		results = append(results, applied)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return results, nil
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

func validateHabitDates(startDate string, completedDates []string) error {
	if _, err := time.Parse(isoDateLayout, startDate); err != nil {
		return errors.New("invalid habit start date")
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
	return validateHabitDates(habit.StartDate, habit.CompletedDates)
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
	return persistHabitMutation(ctx, tx, userID, mutation, habitID, mutationID)
}

func insertHabitRow(mc mutationContext, habit tasks.Habit, habitID uuid.UUID, completedJSON []byte, createdAt, updatedAt time.Time) error {
	_, err := mc.tx.Exec(mc.ctx, `INSERT INTO habits (id, user_id, title, important, urgent, interval, unit, start_date, completed_dates, created_at, updated_at, deleted_at, revision) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, important = EXCLUDED.important, urgent = EXCLUDED.urgent, interval = EXCLUDED.interval, unit = EXCLUDED.unit, start_date = EXCLUDED.start_date, completed_dates = EXCLUDED.completed_dates, updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision WHERE habits.user_id = EXCLUDED.user_id`, habitID, mc.userID, habit.Title, habit.Important, habit.Urgent, habit.Interval, habit.Unit, habit.StartDate, completedJSON, createdAt, updatedAt, habit.DeletedAt, mc.revision)
	return err
}

func insertHabitChangeRow(mc mutationContext, habit tasks.Habit, habitID uuid.UUID, completedJSON []byte, createdAt, updatedAt time.Time) error {
	_, err := mc.tx.Exec(mc.ctx, `INSERT INTO habit_changes (revision, habit_id, user_id, title, important, urgent, interval, unit, start_date, completed_dates, created_at, updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, mc.revision, habitID, mc.userID, habit.Title, habit.Important, habit.Urgent, habit.Interval, habit.Unit, habit.StartDate, completedJSON, createdAt, updatedAt, habit.DeletedAt)
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
	if err := ensureTaskOwned(ctx, tx, taskID, userID); err != nil {
		return AppliedMutation{}, err
	}
	if err := validateTask(&mutation.Task); err != nil {
		return AppliedMutation{}, err
	}
	return persistTaskMutation(ctx, tx, userID, mutation, taskID, mutationID)
}

func insertTaskRow(mc mutationContext, task tasks.Task, taskID uuid.UUID, createdAt, updatedAt time.Time) error {
	_, err := mc.tx.Exec(mc.ctx, `
			INSERT INTO tasks (id, user_id, title, description, due_date, priority, area_id, project_id, status, scheduled_date, assignee_name, follow_up_date, completed, important, urgent, created_at, updated_at, deleted_at, revision)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
			ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, due_date = EXCLUDED.due_date,
			 priority = EXCLUDED.priority, area_id = EXCLUDED.area_id, project_id = EXCLUDED.project_id, status = EXCLUDED.status,
			 scheduled_date = EXCLUDED.scheduled_date, assignee_name = EXCLUDED.assignee_name, follow_up_date = EXCLUDED.follow_up_date,
			 completed = EXCLUDED.completed, important = EXCLUDED.important, urgent = EXCLUDED.urgent,
			 updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision
			WHERE tasks.user_id = EXCLUDED.user_id`, taskID, mc.userID, task.Title, task.Description, task.DueDate, task.Priority, task.AreaID, task.ProjectID, task.Status, task.ScheduledDate, task.AssigneeName, task.FollowUpDate, task.Completed, task.Important, task.Urgent, createdAt, updatedAt, task.DeletedAt, mc.revision)
	return err
}

func insertTaskChangeRow(mc mutationContext, task tasks.Task, taskID uuid.UUID, createdAt, updatedAt time.Time) error {
	_, err := mc.tx.Exec(mc.ctx, `INSERT INTO task_changes (revision, task_id, user_id, title, description, due_date, priority, area_id, project_id, status, scheduled_date, assignee_name, follow_up_date, completed, important, urgent, created_at, updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`, mc.revision, taskID, mc.userID, task.Title, task.Description, task.DueDate, task.Priority, task.AreaID, task.ProjectID, task.Status, task.ScheduledDate, task.AssigneeName, task.FollowUpDate, task.Completed, task.Important, task.Urgent, createdAt, updatedAt, task.DeletedAt)
	return err
}

func persistTaskMutation(ctx context.Context, tx pgx.Tx, userID uuid.UUID, mutation tasks.Mutation, taskID, mutationID uuid.UUID) (AppliedMutation, error) {
	revision, err := nextRevision(ctx, tx)
	if err != nil {
		return AppliedMutation{}, err
	}
	createdAt, updatedAt := coalesceTimestamps(mutation.Task.CreatedAt.UTC(), mutation.Task.UpdatedAt.UTC())
	mc := mutationContext{ctx: ctx, tx: tx, userID: userID, revision: revision}
	if err := insertTaskRow(mc, mutation.Task, taskID, createdAt, updatedAt); err != nil {
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
func (s *Store) Pull(ctx context.Context, userID uuid.UUID, since int64) ([]tasks.Task, []tasks.Habit, int64, error) {
	result, tasksLatest, err := pullTasks(ctx, s.pool, userID, since)
	if err != nil {
		return nil, nil, since, err
	}
	habits, habitsLatest, err := pullHabits(ctx, s.pool, userID, since)
	if err != nil {
		return nil, nil, since, err
	}
	latest := since
	if tasksLatest > latest {
		latest = tasksLatest
	}
	if habitsLatest > latest {
		latest = habitsLatest
	}
	return result, habits, latest, nil
}

func pullTasks(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, since int64) ([]tasks.Task, int64, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text, title, description, due_date, priority, area_id::text, project_id::text, status, scheduled_date, assignee_name, follow_up_date, completed, important, urgent, created_at, updated_at, deleted_at, revision
		FROM tasks WHERE user_id = $1 AND revision > $2 ORDER BY revision ASC, id`, userID, since)
	if err != nil {
		return nil, since, err
	}
	defer rows.Close()
	result := make([]tasks.Task, 0)
	var latest int64 = since
	for rows.Next() {
		var task tasks.Task
		if err := rows.Scan(&task.ID, &task.Title, &task.Description, &task.DueDate, &task.Priority, &task.AreaID, &task.ProjectID, &task.Status, &task.ScheduledDate, &task.AssigneeName, &task.FollowUpDate, &task.Completed, &task.Important, &task.Urgent, &task.CreatedAt, &task.UpdatedAt, &task.DeletedAt, &task.ServerRevision); err != nil {
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

func pullHabits(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, since int64) ([]tasks.Habit, int64, error) {
	habitRows, err := pool.Query(ctx, `
		SELECT id::text, title, important, urgent, interval, unit, start_date, completed_dates, created_at, updated_at, deleted_at, revision
		FROM habits WHERE user_id = $1 AND revision > $2 ORDER BY revision ASC, id`, userID, since)
	if err != nil {
		return nil, since, err
	}
	defer habitRows.Close()
	habits := make([]tasks.Habit, 0)
	var latest int64 = since
	for habitRows.Next() {
		habit, err := scanHabitRow(habitRows)
		if err != nil {
			return nil, since, err
		}
		if habit.ServerRevision > latest {
			latest = habit.ServerRevision
		}
		habits = append(habits, habit)
	}
	if err := habitRows.Err(); err != nil {
		return nil, since, err
	}
	return habits, latest, nil
}

func scanHabitRow(habitRows pgx.Rows) (tasks.Habit, error) {
	var habit tasks.Habit
	var completedJSON []byte
	if err := habitRows.Scan(&habit.ID, &habit.Title, &habit.Important, &habit.Urgent, &habit.Interval, &habit.Unit, &habit.StartDate, &completedJSON, &habit.CreatedAt, &habit.UpdatedAt, &habit.DeletedAt, &habit.ServerRevision); err != nil {
		return tasks.Habit{}, err
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
