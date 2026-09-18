package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/workspace"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ProjectMember struct {
	UserID      string    `json:"userId"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	AvatarURL   string    `json:"avatarUrl,omitempty"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type ProjectInvite struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	ExpiresAt   time.Time `json:"expiresAt"`
	InviteToken string    `json:"inviteToken,omitempty"`
	ProjectID   string    `json:"projectId"`
}

type CollaborationProject struct {
	Project        workspace.Project `json:"project"`
	Role           string            `json:"role"`
	Members        []ProjectMember   `json:"members"`
	PendingInvites []ProjectInvite   `json:"pendingInvites,omitempty"`
}

func normalizeCollaborationRole(role string) (string, error) {
	role = strings.ToLower(strings.TrimSpace(role))
	if role != "editor" && role != "viewer" {
		return "", errors.New("invalid project member role")
	}
	return role, nil
}

func projectRoleTx(ctx context.Context, tx pgx.Tx, userID, projectID uuid.UUID) (string, error) {
	var owner uuid.UUID
	var memberRole *string
	err := tx.QueryRow(ctx, `
		SELECT p.user_id, pm.role
		FROM projects p
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
		WHERE p.id = $2 AND (p.user_id = $1 OR pm.user_id IS NOT NULL)`, userID, projectID).Scan(&owner, &memberRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if owner == userID {
		return "owner", nil
	}
	if memberRole == nil {
		return "", ErrNotFound
	}
	return *memberRole, nil
}

func projectEditorTx(ctx context.Context, tx pgx.Tx, userID, projectID uuid.UUID) error {
	role, err := projectRoleTx(ctx, tx, userID, projectID)
	if err != nil {
		return err
	}
	if role != "owner" && role != "editor" {
		return errors.New("project is read-only for this user")
	}
	return nil
}

func authorizeTaskMutationTx(ctx context.Context, tx pgx.Tx, actorID, taskID uuid.UUID, projectID *string) (uuid.UUID, error) {
	var ownerID uuid.UUID
	var storedProjectID *string
	err := tx.QueryRow(ctx, `SELECT user_id, project_id::text FROM tasks WHERE id = $1`, taskID).Scan(&ownerID, &storedProjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		ownerID = actorID
		storedProjectID = projectID
	} else if err != nil {
		return uuid.Nil, err
	}
	if ownerID != actorID {
		if storedProjectID == nil || *storedProjectID == "" {
			return uuid.Nil, errors.New("task belongs to another user")
		}
		projectUUID, parseErr := uuid.Parse(*storedProjectID)
		if parseErr != nil {
			return uuid.Nil, errors.New("task belongs to another user")
		}
		if err := projectEditorTx(ctx, tx, actorID, projectUUID); err != nil {
			return uuid.Nil, errors.New("task belongs to another user")
		}
	}
	if projectID != nil && *projectID != "" {
		projectUUID, parseErr := uuid.Parse(*projectID)
		if parseErr != nil {
			return uuid.Nil, errors.New("task contains an invalid project")
		}
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)`, projectUUID).Scan(&exists); err != nil {
			return uuid.Nil, err
		}
		if exists {
			if err := projectEditorTx(ctx, tx, actorID, projectUUID); err != nil {
				return uuid.Nil, err
			}
		}
	}
	return ownerID, nil
}

func (s *Store) ListCollaborativeProjects(ctx context.Context, userID uuid.UUID) ([]CollaborationProject, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id::text, p.area_id::text, p.name, p.description, p.icon, p.status,
			p.created_at, p.updated_at, p.deleted_at
		FROM projects p
		WHERE p.deleted_at IS NULL AND (p.user_id = $1 OR EXISTS (
			SELECT 1 FROM project_members pm
			WHERE pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
		))
		ORDER BY p.updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := make([]CollaborationProject, 0)
	for rows.Next() {
		var project workspace.Project
		if err := rows.Scan(&project.ID, &project.AreaID, &project.Name, &project.Description, &project.Icon, &project.Status, &project.CreatedAt, &project.UpdatedAt, &project.DeletedAt); err != nil {
			return nil, err
		}
		projectID, err := uuid.Parse(project.ID)
		if err != nil {
			return nil, err
		}
		members, err := s.listProjectMembers(ctx, projectID)
		if err != nil {
			return nil, err
		}
		role, err := s.projectRoleFromPool(ctx, userID, projectID)
		if err != nil {
			return nil, err
		}
		pending := []ProjectInvite{}
		if role == "owner" {
			pending, err = s.listPendingProjectInvites(ctx, projectID)
			if err != nil {
				return nil, err
			}
		}
		projects = append(projects, CollaborationProject{Project: project, Role: role, Members: members, PendingInvites: pending})
	}
	return projects, rows.Err()
}

func (s *Store) listProjectMembers(ctx context.Context, projectID uuid.UUID) ([]ProjectMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id::text, u.email, u.display_name, u.avatar_url, 'owner', 'active', p.created_at
		FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = $1
		UNION ALL
		SELECT u.id::text, u.email, u.display_name, u.avatar_url, pm.role, pm.status, pm.created_at
		FROM project_members pm JOIN users u ON u.id = pm.user_id
		JOIN projects p ON p.id = pm.project_id
		WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.user_id <> p.user_id
		ORDER BY 5, 3, 2`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members := make([]ProjectMember, 0)
	for rows.Next() {
		var member ProjectMember
		if err := rows.Scan(&member.UserID, &member.Email, &member.DisplayName, &member.AvatarURL, &member.Role, &member.Status, &member.CreatedAt); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Store) listPendingProjectInvites(ctx context.Context, projectID uuid.UUID) ([]ProjectInvite, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, invitee_email, role, expires_at
		FROM project_invites
		WHERE project_id = $1 AND accepted_at IS NULL AND expires_at > now()
		ORDER BY created_at DESC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	invites := make([]ProjectInvite, 0)
	for rows.Next() {
		var invite ProjectInvite
		if err := rows.Scan(&invite.ID, &invite.Email, &invite.Role, &invite.ExpiresAt); err != nil {
			return nil, err
		}
		invite.ProjectID = projectID.String()
		invites = append(invites, invite)
	}
	return invites, rows.Err()
}

func (s *Store) ProjectMembersForUser(ctx context.Context, userID, projectID uuid.UUID) ([]ProjectMember, []ProjectInvite, string, error) {
	role, err := s.projectRoleFromPool(ctx, userID, projectID)
	if err != nil {
		return nil, nil, "", err
	}
	members, err := s.listProjectMembers(ctx, projectID)
	if err != nil {
		return nil, nil, "", err
	}
	invites := []ProjectInvite{}
	if role == "owner" {
		invites, err = s.listPendingProjectInvites(ctx, projectID)
		if err != nil {
			return nil, nil, "", err
		}
	}
	return members, invites, role, nil
}

func (s *Store) projectRoleFromPool(ctx context.Context, userID, projectID uuid.UUID) (string, error) {
	var owner uuid.UUID
	var memberRole *string
	err := s.pool.QueryRow(ctx, `
		SELECT p.user_id, pm.role
		FROM projects p
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
		WHERE p.id = $2 AND (p.user_id = $1 OR pm.user_id IS NOT NULL)`, userID, projectID).Scan(&owner, &memberRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if owner == userID {
		return "owner", nil
	}
	if memberRole == nil {
		return "", ErrNotFound
	}
	return *memberRole, nil
}

func (s *Store) ShareProject(ctx context.Context, ownerID, projectID uuid.UUID, email, role string) (ProjectMember, *ProjectInvite, error) {
	role, err := normalizeCollaborationRole(role)
	if err != nil {
		return ProjectMember{}, nil, err
	}
	email = normalizeEmailValue(email)
	if email == "" || len(email) > 320 {
		return ProjectMember{}, nil, errors.New("invalid invite email")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProjectMember{}, nil, err
	}
	defer tx.Rollback(ctx)
	var projectOwner uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT user_id FROM projects WHERE id = $1`, projectID).Scan(&projectOwner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProjectMember{}, nil, ErrNotFound
		}
		return ProjectMember{}, nil, err
	}
	if projectOwner != ownerID {
		return ProjectMember{}, nil, errors.New("only the project owner can invite members")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active') ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = now()`, projectID, ownerID); err != nil {
		return ProjectMember{}, nil, err
	}
	var member ProjectMember
	findErr := tx.QueryRow(ctx, `SELECT id::text, email, display_name, avatar_url FROM users WHERE lower(email) = $1`, email).Scan(&member.UserID, &member.Email, &member.DisplayName, &member.AvatarURL)
	if findErr == nil {
		if member.UserID == ownerID.String() {
			return ProjectMember{}, nil, errors.New("the project owner is already a member")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1, $2, $3, 'active') ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now()`, projectID, member.UserID, role); err != nil {
			return ProjectMember{}, nil, err
		}
		member.Role, member.Status = role, "active"
		if err := tx.Commit(ctx); err != nil {
			return ProjectMember{}, nil, err
		}
		return member, nil, nil
	}
	if !errors.Is(findErr, pgx.ErrNoRows) {
		return ProjectMember{}, nil, findErr
	}
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		return ProjectMember{}, nil, err
	}
	token := hex.EncodeToString(rawToken)
	hash := sha256.Sum256(rawToken)
	expires := time.Now().UTC().Add(7 * 24 * time.Hour)
	if _, err := tx.Exec(ctx, `UPDATE project_invites SET accepted_at = now() WHERE project_id = $1 AND invitee_email = $2 AND accepted_at IS NULL`, projectID, email); err != nil {
		return ProjectMember{}, nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO project_invites (project_id, inviter_user_id, invitee_email, role, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`, projectID, ownerID, email, role, hash[:], expires); err != nil {
		return ProjectMember{}, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ProjectMember{}, nil, err
	}
	return ProjectMember{}, &ProjectInvite{Email: email, Role: role, ExpiresAt: expires, InviteToken: token, ProjectID: projectID.String()}, nil
}

func (s *Store) UpdateProjectMember(ctx context.Context, ownerID, projectID, memberID uuid.UUID, role string) error {
	role, err := normalizeCollaborationRole(role)
	if err != nil {
		return err
	}
	if ownerID == memberID {
		return errors.New("the project owner role cannot be changed")
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE project_members pm SET role = $1, status = 'active', updated_at = now()
		FROM projects p WHERE pm.project_id = p.id AND pm.project_id = $2 AND pm.user_id = $3 AND p.user_id = $4`, role, projectID, memberID, ownerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RemoveProjectMember(ctx context.Context, ownerID, projectID, memberID uuid.UUID) error {
	if ownerID == memberID {
		return errors.New("the project owner cannot be removed")
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE project_members pm SET status = 'revoked', updated_at = now()
		FROM projects p WHERE pm.project_id = p.id AND pm.project_id = $1 AND pm.user_id = $2 AND p.user_id = $3`, projectID, memberID, ownerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RevokeProjectInvite(ctx context.Context, ownerID, projectID, inviteID uuid.UUID) error {
	result, err := s.pool.Exec(ctx, `
		UPDATE project_invites i SET accepted_at = now()
		FROM projects p WHERE i.id = $1 AND i.project_id = $2 AND p.id = i.project_id AND p.user_id = $3 AND i.accepted_at IS NULL`, inviteID, projectID, ownerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AcceptProjectInvite(ctx context.Context, userID uuid.UUID, token string) (uuid.UUID, error) {
	rawToken, err := hex.DecodeString(strings.TrimSpace(token))
	if err != nil || len(rawToken) != 32 {
		return uuid.Nil, errors.New("invalid invite token")
	}
	hash := sha256.Sum256(rawToken)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	var inviteID, projectID uuid.UUID
	var email, role string
	if err := tx.QueryRow(ctx, `SELECT id, project_id, invitee_email, role FROM project_invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() FOR UPDATE`, hash[:]).Scan(&inviteID, &projectID, &email, &role); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, err
	}
	var accountEmail string
	if err := tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&accountEmail); err != nil {
		return uuid.Nil, err
	}
	if normalizeEmailValue(accountEmail) != normalizeEmailValue(email) {
		return uuid.Nil, errors.New("invite email does not match the signed-in account")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1, $2, $3, 'active') ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now()`, projectID, userID, role); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE project_invites SET accepted_at = now() WHERE id = $1`, inviteID); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return projectID, nil
}

func replaceTaskPeopleTx(ctx context.Context, tx pgx.Tx, taskID, actorID uuid.UUID, projectID *string, peopleIDs []string) error {
	if len(peopleIDs) == 0 {
		peopleIDs = []string{actorID.String()}
	}
	seen := make(map[uuid.UUID]struct{}, len(peopleIDs))
	for _, rawID := range peopleIDs {
		personID, err := uuid.Parse(rawID)
		if err != nil {
			return errors.New("task contains an invalid person")
		}
		if _, exists := seen[personID]; exists {
			continue
		}
		seen[personID] = struct{}{}
		if projectID != nil && *projectID != "" {
			projectUUID, err := uuid.Parse(*projectID)
			if err != nil {
				return errors.New("task contains an invalid project")
			}
			if _, err := projectRoleTx(ctx, tx, personID, projectUUID); err != nil {
				return errors.New("task person is not a member of the project")
			}
		} else if personID != actorID {
			return errors.New("private tasks can only include their owner")
		}
		role := "participant"
		if personID == actorID {
			role = "owner"
		}
		if _, err := tx.Exec(ctx, `INSERT INTO task_people (task_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (task_id, user_id) DO UPDATE SET role = EXCLUDED.role`, taskID, personID, role); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `DELETE FROM task_people WHERE task_id = $1 AND user_id <> ALL($2::uuid[])`, taskID, uuidStrings(seen))
	return err
}

func uuidStrings(values map[uuid.UUID]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value.String())
	}
	return result
}
