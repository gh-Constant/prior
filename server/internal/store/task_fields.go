package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// normalizeReminder accepts any RFC 3339 instant and stores it in UTC.
func normalizeReminder(value **string) error {
	if *value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(**value)
	if trimmed == "" {
		*value = nil
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return errors.New("invalid task reminder: use an RFC 3339 date-time")
	}
	normalized := parsed.UTC().Format(time.RFC3339)
	*value = &normalized
	return nil
}

// NormalizeChecklist validates a checklist and renumbers positions 0..n-1
// in the order the positions (then the array) give.
func NormalizeChecklist(items []tasks.ChecklistItem) ([]tasks.ChecklistItem, error) {
	if len(items) == 0 {
		return nil, nil
	}
	if len(items) > tasks.MaxChecklistItems {
		return nil, fmt.Errorf("a checklist holds at most %d items", tasks.MaxChecklistItems)
	}
	sorted := make([]tasks.ChecklistItem, len(items))
	copy(sorted, items)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Position < sorted[j].Position })
	seen := make(map[string]bool, len(sorted))
	for index := range sorted {
		item := &sorted[index]
		item.ID = strings.TrimSpace(item.ID)
		item.Title = strings.TrimSpace(item.Title)
		if item.ID == "" || len(item.ID) > 64 {
			return nil, errors.New("invalid checklist item id")
		}
		if seen[item.ID] {
			return nil, errors.New("duplicate checklist item id")
		}
		seen[item.ID] = true
		if item.Title == "" || len([]rune(item.Title)) > 400 {
			return nil, errors.New("checklist items need a title of 1-400 characters")
		}
		item.Position = index
	}
	return sorted, nil
}

func checklistJSON(items []tasks.ChecklistItem) ([]byte, error) {
	if items == nil {
		items = []tasks.ChecklistItem{}
	}
	return json.Marshal(items)
}

// decodeTaskJSON fills the JSON columns of a task row.
func decodeTaskJSON(task *tasks.Task, peopleJSON, checklist []byte) error {
	if len(peopleJSON) > 0 && string(peopleJSON) != "null" {
		if err := json.Unmarshal(peopleJSON, &task.PeopleIDs); err != nil {
			return err
		}
	}
	if len(checklist) > 0 && string(checklist) != "null" && string(checklist) != "[]" {
		if err := json.Unmarshal(checklist, &task.Checklist); err != nil {
			return err
		}
	}
	return nil
}

func relationsJSON(items []tasks.TaskRelation) ([]byte, error) {
	if items == nil {
		items = []tasks.TaskRelation{}
	}
	return json.Marshal(items)
}

// recurrenceJSON encodes a repeat rule for its JSONB column (NULL when none).
func recurrenceJSON(rule *tasks.TaskRecurrence) ([]byte, error) {
	if rule == nil {
		return nil, nil
	}
	return json.Marshal(rule)
}

func decodeRecurrence(task *tasks.Task, raw []byte) error {
	task.Recurrence = nil
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var rule tasks.TaskRecurrence
	if err := json.Unmarshal(raw, &rule); err != nil {
		return err
	}
	task.Recurrence = &rule
	return nil
}

func decodeRelations(task *tasks.Task, raw []byte) error {
	task.Relations = []tasks.TaskRelation{}
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return json.Unmarshal(raw, &task.Relations)
}

// resolveIssueFieldsTx keeps the stored assignee, parent, milestone and
// relations, recurrence and story points when an older client omits them, then validates the result:
// the assignee must be able to see the task, a parent must be another task
// of the same project (without cycles), relations must be well formed.
func resolveIssueFieldsTx(ctx context.Context, tx pgx.Tx, taskID, ownerID uuid.UUID, task *tasks.Task) error {
	var storedAssignee, storedParent, storedMilestone *string
	var storedRelations, storedRecurrence []byte
	var storedStoryPoints *float64
	err := tx.QueryRow(ctx, `SELECT assignee_id::text, parent_id::text, milestone_id, relations, recurrence, story_points FROM tasks WHERE id = $1`, taskID).Scan(&storedAssignee, &storedParent, &storedMilestone, &storedRelations, &storedRecurrence, &storedStoryPoints)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if !task.FieldPresent("assigneeId") {
		task.AssigneeID = storedAssignee
	}
	if !task.FieldPresent("parentId") {
		task.ParentID = storedParent
	}
	if !task.FieldPresent("milestoneId") {
		task.MilestoneID = storedMilestone
	}
	if !task.FieldPresent("relations") {
		stored := tasks.Task{}
		if err := decodeRelations(&stored, storedRelations); err != nil {
			return err
		}
		task.Relations = stored.Relations
	}
	if !task.FieldPresent("recurrence") {
		stored := tasks.Task{}
		if err := decodeRecurrence(&stored, storedRecurrence); err != nil {
			return err
		}
		task.Recurrence = stored.Recurrence
	}
	if !task.FieldPresent("storyPoints") {
		task.StoryPoints = storedStoryPoints
	}
	var projectID *uuid.UUID
	if task.ProjectID != nil && *task.ProjectID != "" {
		parsed, err := uuid.Parse(*task.ProjectID)
		if err != nil {
			return errors.New("task contains an invalid project")
		}
		projectID = &parsed
	}
	if task.AssigneeID != nil && *task.AssigneeID == "" {
		task.AssigneeID = nil
	}
	if task.AssigneeID != nil {
		assignee, err := uuid.Parse(*task.AssigneeID)
		if err != nil {
			return errors.New("task contains an invalid assignee")
		}
		normalized := assignee.String()
		task.AssigneeID = &normalized
		if projectID != nil {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)`, *projectID).Scan(&exists); err != nil {
				return err
			}
			if exists {
				if _, err := projectRoleTx(ctx, tx, assignee, *projectID); err != nil {
					return errors.New("task assignee is not a member of the project")
				}
			} else if assignee != ownerID {
				// A personal project not synced yet: only its owner.
				return errors.New("task assignee is not a member of the project")
			}
		} else if assignee != ownerID {
			return errors.New("private tasks can only be assigned to their owner")
		}
	}
	if task.ParentID != nil && *task.ParentID == "" {
		task.ParentID = nil
	}
	if task.ParentID != nil {
		parent, err := uuid.Parse(*task.ParentID)
		if err != nil || parent == taskID {
			return errors.New("task contains an invalid parent")
		}
		normalized := parent.String()
		task.ParentID = &normalized
		// Walk up: the parent must not descend from this task. A parent the
		// server has not seen yet (same batch, later) is accepted as is.
		current := parent
		for depth := 0; depth < 20; depth++ {
			var next *uuid.UUID
			var parentProject *string
			err := tx.QueryRow(ctx, `SELECT parent_id, project_id::text FROM tasks WHERE id = $1`, current).Scan(&next, &parentProject)
			if errors.Is(err, pgx.ErrNoRows) {
				break
			}
			if err != nil {
				return err
			}
			if depth == 0 {
				same := (parentProject == nil && projectID == nil) || (parentProject != nil && projectID != nil && *parentProject == projectID.String())
				if !same {
					return errors.New("invalid task parent: it belongs to another project")
				}
			}
			if next == nil {
				break
			}
			if *next == taskID {
				return errors.New("invalid task parent: it would create a cycle")
			}
			current = *next
		}
	}
	if task.MilestoneID != nil {
		milestone := strings.TrimSpace(*task.MilestoneID)
		if milestone == "" {
			task.MilestoneID = nil
		} else if len(milestone) > 128 || projectID == nil {
			return errors.New("task contains an invalid milestone")
		} else {
			task.MilestoneID = &milestone
		}
	}
	if len(task.Relations) > tasks.MaxTaskRelations {
		return fmt.Errorf("a task holds at most %d relations", tasks.MaxTaskRelations)
	}
	seen := make(map[string]struct{}, len(task.Relations))
	relations := make([]tasks.TaskRelation, 0, len(task.Relations))
	for _, relation := range task.Relations {
		if relation.Type != tasks.RelationBlockedBy && relation.Type != tasks.RelationRelated {
			return errors.New("task contains an invalid relation type")
		}
		related, err := uuid.Parse(relation.TaskID)
		if err != nil || related == taskID {
			return errors.New("task contains an invalid related task")
		}
		key := relation.Type + ":" + related.String()
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		relations = append(relations, tasks.TaskRelation{Type: relation.Type, TaskID: related.String()})
	}
	task.Relations = relations
	return nil
}
