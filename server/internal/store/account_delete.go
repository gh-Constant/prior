package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// DeletedAccount reports what DeleteAccount did so the API can finish the
// work that happens outside PostgreSQL (revoking Google grants, realtime
// notifications). SealedGoogleTokens are still sealed.
type DeletedAccount struct {
	SealedGoogleTokens []string
	// Projects handed to another member, by new owner.
	TransferredProjects map[uuid.UUID][]uuid.UUID
	DeletedProjects     []uuid.UUID
	// Everyone who shared a project with the account: their project data
	// changed (ownership, members, anonymized content).
	AffectedUsers []uuid.UUID
}

// DeleteAccount removes an account in one transaction (specs/ACCOUNT.md):
//
//  1. Every project the user owns goes to the oldest remaining editor, or
//     else the oldest member of any role; a project with no other member is
//     deleted.
//  2. The user's tasks in projects that survive stay with the project: they
//     move to its (new) owner, together with their change log, so the team's
//     board keeps its history.
//  3. The user id is removed from task people lists, and pending invites to
//     the user's email are dropped.
//  4. Deleting the users row cascades to everything else the account owns:
//     tasks, habits, notes and attachments, agent chats, settings, account
//     documents, sessions and MCP keys, mail and calendar accounts, the
//     subscription row, memberships and invites sent, and the game data
//     (profile, XP, inventory, chests, leagues, kudos, leaderboard opt-ins).
//     Payments keep their accounting row with the user set to NULL.
//
// The caller cancels Stripe first and revokes the Google grants afterwards.
func (s *Store) DeleteAccount(ctx context.Context, userID uuid.UUID) (DeletedAccount, error) {
	result := DeletedAccount{TransferredProjects: map[uuid.UUID][]uuid.UUID{}}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	// Serialize with sync pushes so no task mutation lands between the
	// ownership transfer and the delete.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, int64(pushRevisionLockKey)); err != nil {
		return result, err
	}
	var email string
	if err := tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&email); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return result, ErrNotFound
		}
		return result, err
	}

	affected, err := collectUUIDs(ctx, tx, `
		SELECT DISTINCT other.user_id FROM project_members other
		WHERE other.user_id <> $1 AND other.status = 'active' AND other.project_id IN (
			SELECT id FROM projects WHERE user_id = $1
			UNION SELECT project_id FROM project_members WHERE user_id = $1 AND status = 'active'
		)
		UNION SELECT p.user_id FROM projects p JOIN project_members pm ON pm.project_id = p.id
		WHERE pm.user_id = $1 AND pm.status = 'active' AND p.user_id <> $1`, userID)
	if err != nil {
		return result, err
	}
	result.AffectedUsers = affected

	owned, err := collectUUIDs(ctx, tx, `SELECT id FROM projects WHERE user_id = $1`, userID)
	if err != nil {
		return result, err
	}
	for _, projectID := range owned {
		var successor uuid.UUID
		err := tx.QueryRow(ctx, `
			SELECT user_id FROM project_members
			WHERE project_id = $1 AND user_id <> $2 AND status = 'active'
			ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 0 ELSE 1 END, created_at, user_id
			LIMIT 1`, projectID, userID).Scan(&successor)
		if errors.Is(err, pgx.ErrNoRows) {
			if _, err := tx.Exec(ctx, `DELETE FROM projects WHERE id = $1`, projectID); err != nil {
				return result, err
			}
			result.DeletedProjects = append(result.DeletedProjects, projectID)
			continue
		}
		if err != nil {
			return result, err
		}
		// The area belongs to the previous owner's private workspace.
		if _, err := tx.Exec(ctx, `
			UPDATE projects SET user_id = $2, area_id = NULL, updated_at = now(),
				revision = nextval('workspace_revision_seq')
			WHERE id = $1`, projectID, successor); err != nil {
			return result, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE project_members SET role = 'owner', status = 'active', updated_at = now()
			WHERE project_id = $1 AND user_id = $2`, projectID, successor); err != nil {
			return result, err
		}
		if _, err := tx.Exec(ctx, `UPDATE project_invites SET inviter_user_id = $2 WHERE project_id = $1 AND inviter_user_id = $3`, projectID, successor, userID); err != nil {
			return result, err
		}
		result.TransferredProjects[successor] = append(result.TransferredProjects[successor], projectID)
	}

	// Tasks in projects that other people keep go to the project owner.
	if _, err := tx.Exec(ctx, `
		UPDATE tasks t SET user_id = p.user_id
		FROM projects p
		WHERE t.project_id = p.id AND t.user_id = $1 AND p.user_id <> $1`, userID); err != nil {
		return result, err
	}
	// Change-log rows the user wrote on tasks that survive (theirs, now
	// re-owned, or a teammate's they edited) are attributed to the owner.
	if _, err := tx.Exec(ctx, `
		UPDATE task_changes c SET user_id = t.user_id
		FROM tasks t
		WHERE c.task_id = t.id AND c.user_id = $1 AND t.user_id <> $1`, userID); err != nil {
		return result, err
	}
	if _, err := tx.Exec(ctx, `UPDATE tasks SET people_ids = people_ids - $1::text WHERE people_ids ? $1::text`, userID.String()); err != nil {
		return result, err
	}
	if _, err := tx.Exec(ctx, `UPDATE task_changes SET people_ids = people_ids - $1::text WHERE people_ids ? $1::text`, userID.String()); err != nil {
		return result, err
	}
	if err := anonymizeCommentsTx(ctx, tx, userID); err != nil {
		return result, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM project_invites WHERE lower(invitee_email) = lower($1)`, email); err != nil {
		return result, err
	}

	rows, err := tx.Query(ctx, `
		SELECT refresh_token FROM mail_accounts WHERE user_id = $1 AND refresh_token <> ''
		UNION ALL SELECT refresh_token FROM calendar_accounts WHERE user_id = $1 AND refresh_token <> ''`, userID)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var sealed string
		if err := rows.Scan(&sealed); err != nil {
			rows.Close()
			return result, err
		}
		result.SealedGoogleTokens = append(result.SealedGoogleTokens, sealed)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return result, err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}

// anonymizeCommentsTx is a hook for task comments (batch 3); until the
// table exists it does nothing.
func anonymizeCommentsTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT to_regclass('task_comments') IS NOT NULL`).Scan(&exists); err != nil || !exists {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE task_comments SET author_id = NULL WHERE author_id = $1`, userID)
	return err
}

func collectUUIDs(ctx context.Context, tx pgx.Tx, query string, args ...any) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
