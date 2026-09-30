package store

import (
	"context"
	"encoding/json"
	"regexp"
	"time"

	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/gh-Constant/prior/server/internal/workspace"
	"github.com/google/uuid"
)

// ExportProfile is the account itself, without any credential.
type ExportProfile struct {
	ID               uuid.UUID  `json:"id"`
	Email            string     `json:"email"`
	DisplayName      string     `json:"displayName"`
	AvatarURL        string     `json:"avatarUrl,omitempty"`
	Locale           string     `json:"locale"`
	EmailVerifiedAt  *time.Time `json:"emailVerifiedAt,omitempty"`
	TwoFactorEnabled bool       `json:"twoFactorEnabled"`
	GoogleLinked     bool       `json:"googleLinked"`
	CreatedAt        time.Time  `json:"createdAt"`
	LastLoginAt      time.Time  `json:"lastLoginAt"`
}

// ExportSharedProject is a project the user owns or belongs to. Other
// members appear by display name and role only (no email, no avatar URL).
type ExportSharedProject struct {
	Project workspace.Project     `json:"project"`
	Role    string                `json:"role"`
	Members []ExportProjectMember `json:"members"`
}

type ExportProjectMember struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	You         bool   `json:"you,omitempty"`
}

type ExportAttachment struct {
	NoteAttachmentMeta
	Content []byte `json:"-"`
}

// AccountExport is everything GET /v1/me/export writes to the archive.
type AccountExport struct {
	Profile          ExportProfile         `json:"profile"`
	Tasks            []tasks.Task          `json:"tasks"`
	Habits           []tasks.Habit         `json:"habits"`
	Workspace        workspace.Snapshot    `json:"workspace"`
	SharedProjects   []ExportSharedProject `json:"sharedProjects"`
	Settings         map[string]any        `json:"settings"`
	AccountDocuments map[string]any        `json:"accountDocuments"`
	Chats            []AgentChat           `json:"chats"`
	Game             *GameState            `json:"game,omitempty"`
	Attachments      []ExportAttachment    `json:"attachments"`
}

// secretField matches document fields that could hold credentials; they
// are dropped from the export whatever their value.
var secretField = regexp.MustCompile(`(?i)(api[_-]?key|token|secret|password|credential|refresh)`)

// ScrubSecrets removes credential-like fields from a decoded JSON value.
func ScrubSecrets(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		clean := make(map[string]any, len(typed))
		for key, item := range typed {
			if secretField.MatchString(key) {
				continue
			}
			clean[key] = ScrubSecrets(item)
		}
		return clean
	case []any:
		clean := make([]any, len(typed))
		for index, item := range typed {
			clean[index] = ScrubSecrets(item)
		}
		return clean
	default:
		return value
	}
}

// ExportAccount gathers the account's data for a GDPR export. Password
// hashes, sessions, API keys, OAuth tokens and 2FA secrets are never read.
func (s *Store) ExportAccount(ctx context.Context, userID uuid.UUID) (AccountExport, error) {
	var result AccountExport
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, display_name, avatar_url, locale, email_verified_at, totp_enabled_at IS NOT NULL,
			google_sub IS NOT NULL, created_at, last_login_at
		FROM users WHERE id = $1`, userID).Scan(
		&result.Profile.ID, &result.Profile.Email, &result.Profile.DisplayName, &result.Profile.AvatarURL, &result.Profile.Locale,
		&result.Profile.EmailVerifiedAt, &result.Profile.TwoFactorEnabled, &result.Profile.GoogleLinked, &result.Profile.CreatedAt, &result.Profile.LastLoginAt)
	if err != nil {
		return result, err
	}
	if result.Tasks, err = s.CurrentTasks(ctx, userID); err != nil {
		return result, err
	}
	if result.Habits, err = s.CurrentHabits(ctx, userID); err != nil {
		return result, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	result.Workspace, err = loadWorkspace(ctx, tx, userID)
	_ = tx.Rollback(ctx)
	if err != nil {
		return result, err
	}

	projects, err := s.ListCollaborativeProjects(ctx, userID)
	if err != nil {
		return result, err
	}
	result.SharedProjects = make([]ExportSharedProject, 0, len(projects))
	for _, project := range projects {
		entry := ExportSharedProject{Project: project.Project, Role: project.Role, Members: []ExportProjectMember{}}
		for _, member := range project.Members {
			entry.Members = append(entry.Members, ExportProjectMember{
				UserID: member.UserID, DisplayName: member.DisplayName, Role: member.Role, You: member.UserID == userID.String(),
			})
		}
		result.SharedProjects = append(result.SharedProjects, entry)
	}

	settings, err := s.GetUserSettings(ctx, userID)
	if err != nil && err != ErrNotFound {
		return result, err
	}
	result.Settings = map[string]any{
		"webSearch":                      settings.WebSearch,
		"hasOpenRouterKey":               settings.OpenRouterAPIKey != "",
		"hasRecommendationOpenRouterKey": settings.RecommendationOpenRouterAPIKey != "",
		"hasOpenAIKey":                   settings.OpenAIAPIKey != "",
	}

	result.AccountDocuments = map[string]any{}
	rows, err := s.pool.Query(ctx, `SELECT key, value FROM account_documents WHERE user_id = $1 AND value IS NOT NULL ORDER BY key`, userID)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			rows.Close()
			return result, err
		}
		var value any
		if json.Unmarshal(raw, &value) == nil {
			result.AccountDocuments[key] = ScrubSecrets(value)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return result, err
	}

	summaries, err := s.ListAgentChats(ctx, userID)
	if err != nil {
		return result, err
	}
	result.Chats = make([]AgentChat, 0, len(summaries))
	for _, summary := range summaries {
		chat, err := s.GetAgentChat(ctx, userID, summary.ID)
		if err != nil {
			return result, err
		}
		result.Chats = append(result.Chats, chat)
	}

	var hasGame bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM game_profiles WHERE user_id = $1)`, userID).Scan(&hasGame); err != nil {
		return result, err
	}
	if hasGame {
		game, err := s.GameState(ctx, userID)
		if err != nil {
			return result, err
		}
		result.Game = &game
	}

	attachmentRows, err := s.pool.Query(ctx, `SELECT id::text, name, content_type, octet_length(content), content FROM note_attachments WHERE user_id = $1 ORDER BY id`, userID)
	if err != nil {
		return result, err
	}
	defer attachmentRows.Close()
	result.Attachments = []ExportAttachment{}
	for attachmentRows.Next() {
		var item ExportAttachment
		if err := attachmentRows.Scan(&item.ID, &item.Name, &item.Type, &item.Size, &item.Content); err != nil {
			return result, err
		}
		result.Attachments = append(result.Attachments, item)
	}
	return result, attachmentRows.Err()
}
