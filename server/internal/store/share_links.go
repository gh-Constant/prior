package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Share links (specs/AGILE_COLLABORATION.md): a reusable link, not tied to an
// email, that lets anyone with an account join a project as editor or viewer
// once they confirm. Only a hash of the token is stored.

var (
	// ErrShareLinkRevoked: the owner disabled or rotated the link.
	ErrShareLinkRevoked = errors.New("share link revoked")
	// ErrShareLinkExpired: the link passed its expiry date.
	ErrShareLinkExpired = errors.New("share link expired")
	// ErrShareLinkExhausted: the link reached its maximum number of uses.
	ErrShareLinkExhausted = errors.New("share link has no uses left")
)

// MaxShareLinkTTL caps the optional expiry an owner can set.
const MaxShareLinkTTL = 365 * 24 * time.Hour

type ShareLink struct {
	ID        string     `json:"id"`
	ProjectID string     `json:"projectId"`
	Role      string     `json:"role"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	UseCount  int        `json:"useCount"`
	MaxUses   *int       `json:"maxUses,omitempty"`
	// Token is only set by CreateShareLink, once: it is never stored.
	Token string `json:"-"`
}

// ShareLinkJoin is the outcome of opening a share link while signed in.
type ShareLinkJoin struct {
	ProjectID uuid.UUID
	// Role is the member's role after joining (never lower than before).
	Role string
	// Result is "joined" (new member), "upgraded" (viewer became editor) or
	// "already_member" (nothing changed).
	Result string
}

func hashLinkToken(token string) ([]byte, bool) {
	rawToken, err := hex.DecodeString(strings.TrimSpace(token))
	if err != nil || len(rawToken) != 32 {
		return nil, false
	}
	hash := sha256.Sum256(rawToken)
	return hash[:], true
}

func roleRank(role string) int {
	switch role {
	case "owner":
		return 3
	case "editor":
		return 2
	case "viewer":
		return 1
	}
	return 0
}

// ownerOnlyProject returns nil when the user owns the project, ErrNotFound
// when they cannot see it, and an "owner" error for other members.
func (s *Store) ownerOnlyProject(ctx context.Context, userID, projectID uuid.UUID, action string) error {
	role, err := s.projectRoleFromPool(ctx, userID, projectID)
	if err != nil {
		return err
	}
	if role != "owner" {
		return errors.New("only the project owner can " + action)
	}
	return nil
}

// ListShareLinks returns the project's links that were not revoked (expired
// ones included, so the owner sees why a link stopped working).
func (s *Store) ListShareLinks(ctx context.Context, ownerID, projectID uuid.UUID) ([]ShareLink, error) {
	if err := s.ownerOnlyProject(ctx, ownerID, projectID, "manage share links"); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, role, created_at, expires_at, use_count, max_uses
		FROM project_share_links
		WHERE project_id = $1 AND revoked_at IS NULL
		ORDER BY CASE role WHEN 'editor' THEN 0 ELSE 1 END`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	links := make([]ShareLink, 0)
	for rows.Next() {
		link := ShareLink{ProjectID: projectID.String()}
		if err := rows.Scan(&link.ID, &link.Role, &link.CreatedAt, &link.ExpiresAt, &link.UseCount, &link.MaxUses); err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

// CreateShareLink makes a link for the role and revokes the previous active
// link of that role, so there is always at most one per role. The token is
// returned once. Only the project owner can do it.
func (s *Store) CreateShareLink(ctx context.Context, ownerID, projectID uuid.UUID, role string, ttl time.Duration, maxUses int) (ShareLink, error) {
	role, err := normalizeCollaborationRole(role)
	if err != nil {
		return ShareLink{}, err
	}
	if ttl < 0 || ttl > MaxShareLinkTTL || maxUses < 0 || maxUses > 100000 {
		return ShareLink{}, errors.New("invalid share link limits")
	}
	token, hash, err := newInviteToken()
	if err != nil {
		return ShareLink{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ShareLink{}, err
	}
	defer tx.Rollback(ctx)
	var projectOwner uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT user_id FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, projectID).Scan(&projectOwner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ShareLink{}, ErrNotFound
		}
		return ShareLink{}, err
	}
	if projectOwner != ownerID {
		if _, err := projectRoleTx(ctx, tx, ownerID, projectID); err != nil {
			return ShareLink{}, err
		}
		return ShareLink{}, errors.New("only the project owner can manage share links")
	}
	if _, err := tx.Exec(ctx, `UPDATE project_share_links SET revoked_at = now() WHERE project_id = $1 AND role = $2 AND revoked_at IS NULL`, projectID, role); err != nil {
		return ShareLink{}, err
	}
	var expiresAt *time.Time
	if ttl > 0 {
		at := time.Now().UTC().Add(ttl)
		expiresAt = &at
	}
	var uses *int
	if maxUses > 0 {
		uses = &maxUses
	}
	link := ShareLink{ProjectID: projectID.String(), Role: role, ExpiresAt: expiresAt, MaxUses: uses, Token: token}
	if err := tx.QueryRow(ctx, `
		INSERT INTO project_share_links (project_id, created_by, role, token_hash, expires_at, max_uses)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text, created_at`,
		projectID, ownerID, role, hash, expiresAt, uses).Scan(&link.ID, &link.CreatedAt); err != nil {
		return ShareLink{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ShareLink{}, err
	}
	return link, nil
}

// RevokeShareLink disables a link for good. Members who already joined stay.
func (s *Store) RevokeShareLink(ctx context.Context, ownerID, projectID, linkID uuid.UUID) error {
	if err := s.ownerOnlyProject(ctx, ownerID, projectID, "manage share links"); err != nil {
		return err
	}
	result, err := s.pool.Exec(ctx, `UPDATE project_share_links SET revoked_at = now() WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL`, linkID, projectID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

// JoinShareLink adds the user to the link's project with the link's role.
// An existing member keeps the higher of the two roles (a viewer opening an
// editor link becomes an editor; nobody is ever downgraded) and does not use
// up the link. beforeJoin runs inside the transaction for new members only,
// so the caller can enforce plan limits on the project owner.
func (s *Store) JoinShareLink(ctx context.Context, userID uuid.UUID, token string, beforeJoin func(ownerID, projectID uuid.UUID) error) (ShareLinkJoin, error) {
	hash, ok := hashLinkToken(token)
	if !ok {
		return ShareLinkJoin{}, ErrNotFound
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ShareLinkJoin{}, err
	}
	defer tx.Rollback(ctx)
	var linkID, projectID, ownerID uuid.UUID
	var role string
	var revokedAt, expiresAt *time.Time
	var useCount int
	var maxUses *int
	err = tx.QueryRow(ctx, `
		SELECT l.id, l.project_id, l.role, l.revoked_at, l.expires_at, l.use_count, l.max_uses, p.user_id
		FROM project_share_links l JOIN projects p ON p.id = l.project_id AND p.deleted_at IS NULL
		WHERE l.token_hash = $1 FOR UPDATE OF l`, hash).Scan(&linkID, &projectID, &role, &revokedAt, &expiresAt, &useCount, &maxUses, &ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ShareLinkJoin{}, ErrNotFound
	}
	if err != nil {
		return ShareLinkJoin{}, err
	}
	current := ""
	if ownerID == userID {
		current = "owner"
	} else {
		var memberRole string
		err := tx.QueryRow(ctx, `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 AND status = 'active'`, projectID, userID).Scan(&memberRole)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return ShareLinkJoin{}, err
		}
		current = memberRole
	}
	// Someone who already has at least this role needs nothing from the link,
	// even if it has since been disabled.
	if roleRank(current) >= roleRank(role) {
		return ShareLinkJoin{ProjectID: projectID, Role: current, Result: "already_member"}, nil
	}
	switch {
	case revokedAt != nil:
		return ShareLinkJoin{}, ErrShareLinkRevoked
	case expiresAt != nil && !expiresAt.After(time.Now()):
		return ShareLinkJoin{}, ErrShareLinkExpired
	case current == "" && maxUses != nil && useCount >= *maxUses:
		return ShareLinkJoin{}, ErrShareLinkExhausted
	}
	result := "upgraded"
	if current == "" {
		result = "joined"
		if beforeJoin != nil {
			if err := beforeJoin(ownerID, projectID); err != nil {
				return ShareLinkJoin{}, err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE project_share_links SET use_count = use_count + 1 WHERE id = $1`, linkID); err != nil {
			return ShareLinkJoin{}, err
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1, $2, $3, 'active')
		ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now()`, projectID, userID, role); err != nil {
		return ShareLinkJoin{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ShareLinkJoin{}, err
	}
	return ShareLinkJoin{ProjectID: projectID, Role: role, Result: result}, nil
}

// InvitePreview describes a pending invite or share link to someone who may
// not have an account yet. The token is the capability: nothing personal
// beyond the inviter's display name is returned.
type InvitePreview struct {
	// Kind is "invite" (one email) or "link" (a reusable share link).
	Kind        string `json:"kind"`
	ProjectName string `json:"projectName"`
	ProjectIcon string `json:"projectIcon"`
	InviterName string `json:"inviterName"`
	AvatarURL   string `json:"inviterAvatarUrl"`
	MemberCount int    `json:"memberCount"`
	Role        string `json:"role"`
	// Status is pending, accepted (an email invite already used), expired or
	// revoked (a share link the owner disabled).
	Status string `json:"status"`
	// AlreadyMember and CurrentRole are only filled for a signed-in viewer;
	// ProjectID is only revealed to people who already belong to it.
	AlreadyMember bool   `json:"alreadyMember"`
	CurrentRole   string `json:"currentRole,omitempty"`
	ProjectID     string `json:"projectId,omitempty"`
}

func (s *Store) InvitePreview(ctx context.Context, token string) (InvitePreview, error) {
	return s.InvitePreviewFor(ctx, token, uuid.Nil)
}

// InvitePreviewFor is InvitePreview for a viewer who may be signed in
// (uuid.Nil when not): it also says whether they already belong.
func (s *Store) InvitePreviewFor(ctx context.Context, token string, viewerID uuid.UUID) (InvitePreview, error) {
	hash, ok := hashLinkToken(token)
	if !ok {
		return InvitePreview{}, ErrNotFound
	}
	preview := InvitePreview{Kind: "invite"}
	var projectID uuid.UUID
	var icon *string
	var expiresAt time.Time
	var acceptedAt *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT p.id, p.name, p.icon, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), u.avatar_url, i.role, i.expires_at, i.accepted_at,
			1 + (SELECT count(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.status = 'active' AND pm.user_id <> p.user_id)
		FROM project_invites i
		JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
		JOIN users u ON u.id = i.inviter_user_id
		WHERE i.token_hash = $1`, hash).Scan(&projectID, &preview.ProjectName, &icon, &preview.InviterName, &preview.AvatarURL, &preview.Role, &expiresAt, &acceptedAt, &preview.MemberCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.shareLinkPreview(ctx, hash, viewerID)
	}
	if err != nil {
		return InvitePreview{}, err
	}
	if icon != nil {
		preview.ProjectIcon = *icon
	}
	switch {
	case acceptedAt != nil:
		preview.Status = "accepted"
	case time.Now().After(expiresAt):
		preview.Status = "expired"
	default:
		preview.Status = "pending"
	}
	return s.annotatePreviewViewer(ctx, preview, projectID, viewerID)
}

func (s *Store) shareLinkPreview(ctx context.Context, hash []byte, viewerID uuid.UUID) (InvitePreview, error) {
	preview := InvitePreview{Kind: "link"}
	var projectID uuid.UUID
	var icon *string
	var revokedAt, expiresAt *time.Time
	var useCount int
	var maxUses *int
	err := s.pool.QueryRow(ctx, `
		SELECT p.id, p.name, p.icon, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), u.avatar_url, l.role,
			l.revoked_at, l.expires_at, l.use_count, l.max_uses,
			1 + (SELECT count(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.status = 'active' AND pm.user_id <> p.user_id)
		FROM project_share_links l
		JOIN projects p ON p.id = l.project_id AND p.deleted_at IS NULL
		JOIN users u ON u.id = l.created_by
		WHERE l.token_hash = $1`, hash).Scan(&projectID, &preview.ProjectName, &icon, &preview.InviterName, &preview.AvatarURL, &preview.Role,
		&revokedAt, &expiresAt, &useCount, &maxUses, &preview.MemberCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return InvitePreview{}, ErrNotFound
	}
	if err != nil {
		return InvitePreview{}, err
	}
	if icon != nil {
		preview.ProjectIcon = *icon
	}
	switch {
	case revokedAt != nil:
		preview.Status = "revoked"
	case expiresAt != nil && !expiresAt.After(time.Now()), maxUses != nil && useCount >= *maxUses:
		preview.Status = "expired"
	default:
		preview.Status = "pending"
	}
	return s.annotatePreviewViewer(ctx, preview, projectID, viewerID)
}

func (s *Store) annotatePreviewViewer(ctx context.Context, preview InvitePreview, projectID, viewerID uuid.UUID) (InvitePreview, error) {
	if viewerID == uuid.Nil {
		return preview, nil
	}
	role, err := s.projectRoleFromPool(ctx, viewerID, projectID)
	if errors.Is(err, ErrNotFound) {
		return preview, nil
	}
	if err != nil {
		return InvitePreview{}, err
	}
	preview.AlreadyMember = true
	preview.CurrentRole = role
	preview.ProjectID = projectID.String()
	return preview, nil
}
