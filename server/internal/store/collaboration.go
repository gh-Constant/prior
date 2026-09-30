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
	// Online is filled by the API from live realtime connections.
	Online bool `json:"online"`
}

type ProjectInvite struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	ExpiresAt   time.Time `json:"expiresAt"`
	InviteToken string    `json:"inviteToken,omitempty"`
	ProjectID   string    `json:"projectId"`
	// InviteeUserID is set when the email already has an account, so the
	// API can notify that person in real time.
	InviteeUserID string `json:"-"`
	// ProjectName and InviterName fill the invitation email.
	ProjectName string `json:"-"`
	InviterName string `json:"-"`
}

// IncomingInvite is a pending invite addressed to the signed-in account.
type IncomingInvite struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId"`
	ProjectName string    `json:"projectName"`
	InviterName string    `json:"inviterName"`
	InviterID   string    `json:"inviterId"`
	Role        string    `json:"role"`
	ExpiresAt   time.Time `json:"expiresAt"`
	CreatedAt   time.Time `json:"createdAt"`
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
		SELECT p.id::text, p.area_id::text, p.name, p.description, p.icon, p.status, p.metadata,
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
		var metadata []byte
		if err := rows.Scan(&project.ID, &project.AreaID, &project.Name, &project.Description, &project.Icon, &project.Status, &metadata, &project.CreatedAt, &project.UpdatedAt, &project.DeletedAt); err != nil {
			return nil, err
		}
		if err := applyProjectMetadata(&project, metadata); err != nil {
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

func (s *Store) GetCollaborativeProject(ctx context.Context, userID, projectID uuid.UUID) (CollaborationProject, error) {
	var project workspace.Project
	var metadata []byte
	err := s.pool.QueryRow(ctx, `
		SELECT p.id::text, p.area_id::text, p.name, p.description, p.icon, p.status, p.metadata,
			p.created_at, p.updated_at, p.deleted_at
		FROM projects p
		WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.user_id = $2 OR EXISTS (
			SELECT 1 FROM project_members pm
			WHERE pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
		))`, projectID, userID).Scan(
		&project.ID, &project.AreaID, &project.Name, &project.Description, &project.Icon, &project.Status, &metadata,
		&project.CreatedAt, &project.UpdatedAt, &project.DeletedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return CollaborationProject{}, ErrNotFound
	}
	if err != nil {
		return CollaborationProject{}, err
	}
	if err := applyProjectMetadata(&project, metadata); err != nil {
		return CollaborationProject{}, err
	}
	role, err := s.projectRoleFromPool(ctx, userID, projectID)
	if err != nil {
		return CollaborationProject{}, err
	}
	members, err := s.listProjectMembers(ctx, projectID)
	if err != nil {
		return CollaborationProject{}, err
	}
	pending := []ProjectInvite{}
	if role == "owner" {
		pending, err = s.listPendingProjectInvites(ctx, projectID)
		if err != nil {
			return CollaborationProject{}, err
		}
	}
	return CollaborationProject{Project: project, Role: role, Members: members, PendingInvites: pending}, nil
}

func (s *Store) listProjectMembers(ctx context.Context, projectID uuid.UUID) ([]ProjectMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, email, display_name, avatar_url, role, status, created_at FROM (
			SELECT u.id::text AS id, u.email, u.display_name, u.avatar_url, 'owner' AS role, 'active' AS status, p.created_at
			FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = $1
			UNION ALL
			SELECT u.id::text, u.email, u.display_name, u.avatar_url, pm.role, pm.status, pm.created_at
			FROM project_members pm JOIN users u ON u.id = pm.user_id
			JOIN projects p ON p.id = pm.project_id
			WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.user_id <> p.user_id
		) members
		ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, lower(display_name), email`, projectID)
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
	var projectName, inviterName string
	if err := tx.QueryRow(ctx, `
		SELECT p.user_id, p.name, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1))
		FROM projects p JOIN users u ON u.id = p.user_id
		WHERE p.id = $1 AND p.deleted_at IS NULL`, projectID).Scan(&projectOwner, &projectName, &inviterName); err != nil {
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
	// Existing members only change role. Everyone else, including people who
	// already have an account, gets a pending invite they accept in the app.
	var member ProjectMember
	var memberStatus *string
	findErr := tx.QueryRow(ctx, `
		SELECT u.id::text, u.email, u.display_name, u.avatar_url, pm.status
		FROM users u LEFT JOIN project_members pm ON pm.project_id = $2 AND pm.user_id = u.id
		WHERE lower(u.email) = $1`, email, projectID).Scan(&member.UserID, &member.Email, &member.DisplayName, &member.AvatarURL, &memberStatus)
	if findErr != nil && !errors.Is(findErr, pgx.ErrNoRows) {
		return ProjectMember{}, nil, findErr
	}
	if findErr == nil && member.UserID == ownerID.String() {
		return ProjectMember{}, nil, errors.New("the project owner is already a member")
	}
	if findErr == nil && memberStatus != nil && *memberStatus == "active" {
		if _, err := tx.Exec(ctx, `UPDATE project_members SET role = $3, updated_at = now() WHERE project_id = $1 AND user_id = $2`, projectID, member.UserID, role); err != nil {
			return ProjectMember{}, nil, err
		}
		member.Role, member.Status = role, "active"
		if err := tx.Commit(ctx); err != nil {
			return ProjectMember{}, nil, err
		}
		return member, nil, nil
	}
	token, hash, err := newInviteToken()
	if err != nil {
		return ProjectMember{}, nil, err
	}
	expires := time.Now().UTC().Add(inviteTTL)
	if _, err := tx.Exec(ctx, `UPDATE project_invites SET accepted_at = now() WHERE project_id = $1 AND invitee_email = $2 AND accepted_at IS NULL`, projectID, email); err != nil {
		return ProjectMember{}, nil, err
	}
	var inviteID string
	if err := tx.QueryRow(ctx, `INSERT INTO project_invites (project_id, inviter_user_id, invitee_email, role, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`, projectID, ownerID, email, role, hash, expires).Scan(&inviteID); err != nil {
		return ProjectMember{}, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ProjectMember{}, nil, err
	}
	return ProjectMember{}, &ProjectInvite{ID: inviteID, Email: email, Role: role, ExpiresAt: expires, InviteToken: token, ProjectID: projectID.String(), InviteeUserID: member.UserID, ProjectName: projectName, InviterName: inviterName}, nil
}

// inviteTTL is how long an invitation (and its link) stays valid.
const inviteTTL = 7 * 24 * time.Hour

// newInviteToken returns a random invite token and the hash stored for it.
func newInviteToken() (string, []byte, error) {
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		return "", nil, err
	}
	hash := sha256.Sum256(rawToken)
	return hex.EncodeToString(rawToken), hash[:], nil
}

// RotateProjectInvite gives a pending invite a fresh link and expiry, for
// "resend" and "copy link": only a hash is stored, so the previous link
// stops working. Only the project owner can do it.
func (s *Store) RotateProjectInvite(ctx context.Context, ownerID, projectID, inviteID uuid.UUID) (ProjectInvite, error) {
	token, hash, err := newInviteToken()
	if err != nil {
		return ProjectInvite{}, err
	}
	expires := time.Now().UTC().Add(inviteTTL)
	invite := ProjectInvite{ID: inviteID.String(), ProjectID: projectID.String(), InviteToken: token, ExpiresAt: expires}
	var inviteeID *string
	err = s.pool.QueryRow(ctx, `
		UPDATE project_invites i SET token_hash = $4, expires_at = $5, created_at = now()
		FROM projects p JOIN users u ON u.id = p.user_id
		WHERE i.id = $1 AND i.project_id = $2 AND p.id = i.project_id AND p.user_id = $3 AND p.deleted_at IS NULL AND i.accepted_at IS NULL
		RETURNING i.invitee_email, i.role, p.name, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)),
			(SELECT invitee.id::text FROM users invitee WHERE lower(invitee.email) = i.invitee_email)`,
		inviteID, projectID, ownerID, hash, expires).Scan(&invite.Email, &invite.Role, &invite.ProjectName, &invite.InviterName, &inviteeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProjectInvite{}, ErrNotFound
	}
	if err != nil {
		return ProjectInvite{}, err
	}
	if inviteeID != nil {
		invite.InviteeUserID = *inviteeID
	}
	return invite, nil
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
		UPDATE project_members pm SET role = $1, updated_at = now()
		FROM projects p WHERE pm.project_id = p.id AND pm.project_id = $2 AND pm.user_id = $3 AND p.user_id = $4 AND pm.status = 'active'`, role, projectID, memberID, ownerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

// RemoveProjectMember revokes a membership. The owner can remove anyone but
// themselves; any other member can remove only themselves (leave).
func (s *Store) RemoveProjectMember(ctx context.Context, actorID, projectID, memberID uuid.UUID) error {
	var ownerID uuid.UUID
	if err := s.pool.QueryRow(ctx, `SELECT user_id FROM projects WHERE id = $1`, projectID).Scan(&ownerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if memberID == ownerID {
		return errors.New("the project owner cannot be removed")
	}
	if actorID != ownerID && actorID != memberID {
		if _, err := s.projectRoleFromPool(ctx, actorID, projectID); err != nil {
			return err
		}
		return errors.New("only the project owner can remove members")
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE project_members SET status = 'revoked', updated_at = now()
		WHERE project_id = $1 AND user_id = $2 AND status = 'active'`, projectID, memberID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

// RevokeProjectInvite cancels a pending invite and returns the invitee's
// account id (uuid.Nil without an account) so their devices can update.
func (s *Store) RevokeProjectInvite(ctx context.Context, ownerID, projectID, inviteID uuid.UUID) (uuid.UUID, error) {
	var inviteeID *uuid.UUID
	err := s.pool.QueryRow(ctx, `
		UPDATE project_invites i SET accepted_at = now()
		FROM projects p WHERE i.id = $1 AND i.project_id = $2 AND p.id = i.project_id AND p.user_id = $3 AND i.accepted_at IS NULL
		RETURNING (SELECT invitee.id FROM users invitee WHERE lower(invitee.email) = i.invitee_email)`, inviteID, projectID, ownerID).Scan(&inviteeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if inviteeID == nil {
		return uuid.Nil, nil
	}
	return *inviteeID, nil
}

// ProjectMemberIDs lists the owner and active members of the given projects,
// so a change can be pushed to exactly the people who can see it.
func (s *Store) ProjectMemberIDs(ctx context.Context, projectIDs []uuid.UUID) ([]uuid.UUID, error) {
	if len(projectIDs) == 0 {
		return []uuid.UUID{}, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT user_id FROM projects WHERE id = ANY($1) AND deleted_at IS NULL
		UNION
		SELECT pm.user_id FROM project_members pm JOIN projects p ON p.id = pm.project_id
		WHERE pm.project_id = ANY($1) AND pm.status = 'active' AND p.deleted_at IS NULL`, projectIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		members = append(members, id)
	}
	return members, rows.Err()
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
	if err := joinProjectTx(ctx, tx, userID, inviteID, projectID, email, role); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return projectID, nil
}

func joinProjectTx(ctx context.Context, tx pgx.Tx, userID, inviteID, projectID uuid.UUID, email, role string) error {
	var accountEmail string
	if err := tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&accountEmail); err != nil {
		return err
	}
	if normalizeEmailValue(accountEmail) != normalizeEmailValue(email) {
		return errors.New("invite email does not match the signed-in account")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1, $2, $3, 'active') ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now()`, projectID, userID, role); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE project_invites SET accepted_at = now() WHERE id = $1`, inviteID)
	return err
}

// ListIncomingInvites returns the pending invites addressed to the user's
// email, newest first.
func (s *Store) ListIncomingInvites(ctx context.Context, userID uuid.UUID) ([]IncomingInvite, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT i.id::text, p.id::text, p.name, COALESCE(NULLIF(inviter.display_name, ''), inviter.email), inviter.id::text, i.role, i.expires_at, i.created_at
		FROM users me
		JOIN project_invites i ON i.invitee_email = lower(me.email) AND i.accepted_at IS NULL AND i.expires_at > now()
		JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
		JOIN users inviter ON inviter.id = i.inviter_user_id
		WHERE me.id = $1 AND NOT EXISTS (
			SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = me.id AND pm.status = 'active'
		)
		ORDER BY i.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	invites := make([]IncomingInvite, 0)
	for rows.Next() {
		var invite IncomingInvite
		if err := rows.Scan(&invite.ID, &invite.ProjectID, &invite.ProjectName, &invite.InviterName, &invite.InviterID, &invite.Role, &invite.ExpiresAt, &invite.CreatedAt); err != nil {
			return nil, err
		}
		invites = append(invites, invite)
	}
	return invites, rows.Err()
}

// RespondToInvite accepts or declines a pending invite addressed to the
// user. It returns the project and the person who sent the invite.
func (s *Store) RespondToInvite(ctx context.Context, userID, inviteID uuid.UUID, accept bool) (uuid.UUID, uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	var projectID, inviterID uuid.UUID
	var email, role string
	err = tx.QueryRow(ctx, `
		SELECT i.project_id, i.inviter_user_id, i.invitee_email, i.role
		FROM project_invites i JOIN users me ON me.id = $2 AND i.invitee_email = lower(me.email)
		WHERE i.id = $1 AND i.accepted_at IS NULL AND i.expires_at > now() FOR UPDATE OF i`, inviteID, userID).Scan(&projectID, &inviterID, &email, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	if accept {
		err = joinProjectTx(ctx, tx, userID, inviteID, projectID, email, role)
	} else {
		_, err = tx.Exec(ctx, `UPDATE project_invites SET accepted_at = now() WHERE id = $1`, inviteID)
	}
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return projectID, inviterID, nil
}

// ProjectPeerIDs lists everyone who shares an active project with the user,
// so shared edits can be pushed to them in real time.
func (s *Store) ProjectPeerIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		WITH mine AS (
			SELECT id FROM projects WHERE user_id = $1 AND deleted_at IS NULL
			UNION SELECT project_id FROM project_members WHERE user_id = $1 AND status = 'active'
		)
		SELECT DISTINCT person FROM (
			SELECT p.user_id AS person FROM projects p JOIN mine ON mine.id = p.id
			UNION SELECT pm.user_id FROM project_members pm JOIN mine ON mine.id = pm.project_id WHERE pm.status = 'active'
		) people WHERE person <> $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	peers := make([]uuid.UUID, 0)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		peers = append(peers, id)
	}
	return peers, rows.Err()
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
