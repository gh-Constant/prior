package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gh-Constant/prior/server/internal/workspace"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ProjectPlanningPatch is the collaboration PATCH contract. Raw JSON values
// distinguish omitted fields (preserve the current value) from explicit null
// fields (clear the current value).
type ProjectPlanningPatch struct {
	Health     json.RawMessage `json:"health"`
	StartDate  json.RawMessage `json:"startDate"`
	TargetDate json.RawMessage `json:"targetDate"`
	Cycles     json.RawMessage `json:"cycles"`
}

type projectMetadata struct {
	Health     *string                  `json:"health,omitempty"`
	StartDate  *string                  `json:"startDate,omitempty"`
	TargetDate *string                  `json:"targetDate,omitempty"`
	Cycles     []workspace.ProjectCycle `json:"cycles,omitempty"`
}

func metadataForProject(project workspace.Project) ([]byte, error) {
	if err := project.ValidatePlanning(); err != nil {
		return nil, err
	}
	metadata, err := json.Marshal(projectMetadata{
		Health: project.Health, StartDate: project.StartDate, TargetDate: project.TargetDate, Cycles: project.Cycles,
	})
	if err != nil {
		return nil, err
	}
	return metadata, nil
}

func applyProjectMetadata(project *workspace.Project, raw []byte) error {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil
	}
	var metadata projectMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return fmt.Errorf("invalid project metadata: %w", err)
	}
	project.Health = metadata.Health
	project.StartDate = metadata.StartDate
	project.TargetDate = metadata.TargetDate
	project.Cycles = metadata.Cycles
	if err := project.ValidatePlanning(); err != nil {
		return err
	}
	return nil
}

func applyProjectPlanningPatch(project *workspace.Project, patch ProjectPlanningPatch) error {
	if len(patch.Health) > 0 {
		value, err := nullableString(patch.Health, "project health")
		if err != nil {
			return err
		}
		project.Health = value
	}
	if len(patch.StartDate) > 0 {
		value, err := nullableString(patch.StartDate, "project start date")
		if err != nil {
			return err
		}
		project.StartDate = value
	}
	if len(patch.TargetDate) > 0 {
		value, err := nullableString(patch.TargetDate, "project target date")
		if err != nil {
			return err
		}
		project.TargetDate = value
	}
	if len(patch.Cycles) > 0 {
		if bytes.Equal(bytes.TrimSpace(patch.Cycles), []byte("null")) {
			project.Cycles = nil
		} else if err := json.Unmarshal(patch.Cycles, &project.Cycles); err != nil {
			return errors.New("invalid project cycles")
		}
	}
	return project.ValidatePlanning()
}

func nullableString(raw json.RawMessage, field string) (*string, error) {
	trimmed := bytes.TrimSpace(raw)
	if bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	var value string
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return nil, fmt.Errorf("invalid %s", field)
	}
	return &value, nil
}

func validateProjectCycleIssues(ctx context.Context, tx pgx.Tx, projectID uuid.UUID, cycles []workspace.ProjectCycle) error {
	uniqueIssueIDs := make(map[uuid.UUID]struct{})
	for _, cycle := range cycles {
		for _, rawID := range cycle.IssueIDs {
			issueID, err := uuid.Parse(rawID)
			if err != nil {
				return errors.New("invalid project cycle issue id")
			}
			uniqueIssueIDs[issueID] = struct{}{}
		}
	}
	if len(uniqueIssueIDs) == 0 {
		return nil
	}
	issueIDs := make([]uuid.UUID, 0, len(uniqueIssueIDs))
	for issueID := range uniqueIssueIDs {
		issueIDs = append(issueIDs, issueID)
	}
	var matching int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE project_id = $1 AND id = ANY($2)`, projectID, issueIDs).Scan(&matching); err != nil {
		return err
	}
	if matching != len(issueIDs) {
		return errors.New("invalid project cycle issue: task does not belong to project")
	}
	return nil
}

func projectOwnerAndMetadata(ctx context.Context, tx pgx.Tx, projectID uuid.UUID) (uuid.UUID, []byte, bool, error) {
	var owner uuid.UUID
	var metadata []byte
	err := tx.QueryRow(ctx, `SELECT user_id, metadata FROM projects WHERE id = $1`, projectID).Scan(&owner, &metadata)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil, false, nil
	}
	if err != nil {
		return uuid.Nil, nil, false, err
	}
	return owner, metadata, true, nil
}

func (s *Store) UpdateCollaborativeProjectPlanning(ctx context.Context, userID, projectID uuid.UUID, patch ProjectPlanningPatch) (CollaborationProject, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CollaborationProject{}, err
	}
	defer tx.Rollback(ctx)

	if err := projectEditorTx(ctx, tx, userID, projectID); err != nil {
		return CollaborationProject{}, err
	}

	var project workspace.Project
	var metadata []byte
	err = tx.QueryRow(ctx, `
		SELECT id::text, area_id::text, name, description, icon, status, metadata, created_at, updated_at, deleted_at
		FROM projects
		WHERE id = $1 AND deleted_at IS NULL`, projectID).Scan(
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
	if err := applyProjectPlanningPatch(&project, patch); err != nil {
		return CollaborationProject{}, err
	}
	if err := validateProjectCycleIssues(ctx, tx, projectID, project.Cycles); err != nil {
		return CollaborationProject{}, err
	}

	newMetadata, err := metadataForProject(project)
	if err != nil {
		return CollaborationProject{}, err
	}

	now := time.Now().UTC()
	revision, err := nextWorkspaceRevision(ctx, tx)
	if err != nil {
		return CollaborationProject{}, err
	}

	_, err = tx.Exec(ctx, `
		UPDATE projects
		SET metadata = $1, updated_at = $2, revision = $3
		WHERE id = $4`, newMetadata, now, revision, projectID)
	if err != nil {
		return CollaborationProject{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return CollaborationProject{}, err
	}

	return s.GetCollaborativeProject(ctx, userID, projectID)
}
