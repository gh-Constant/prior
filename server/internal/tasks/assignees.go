package tasks

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// MaxAssignees caps the people assigned to one task. The same bound lives in
// app/src/lib/assignment.ts: keep the two in sync.
const MaxAssignees = 10

// NormalizeAssigneeIDs trims, lower-cases and de-duplicates (first occurrence
// wins) a list of user ids. It returns an empty non-nil list for no one.
func NormalizeAssigneeIDs(ids []string) ([]string, error) {
	result := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, raw := range ids {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		parsed, err := uuid.Parse(trimmed)
		if err != nil {
			return nil, errors.New("task contains an invalid assignee")
		}
		id := parsed.String()
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	if len(result) > MaxAssignees {
		return nil, fmt.Errorf("a task holds at most %d assignees", MaxAssignees)
	}
	return result, nil
}

// FirstAssignee is the legacy single assignee: the first of the list.
func FirstAssignee(ids []string) *string {
	if len(ids) == 0 {
		return nil
	}
	first := ids[0]
	return &first
}

// SyncStoredAssignees makes a row read from the database consistent. The list
// is the source of truth; a legacy assignee_id that disagrees with its first
// element was written by an older server instance, and wins.
func (task *Task) SyncStoredAssignees() {
	if task.AssigneeIDs == nil {
		task.AssigneeIDs = []string{}
	}
	if task.AssigneeID != nil && *task.AssigneeID != "" {
		if len(task.AssigneeIDs) == 0 || task.AssigneeIDs[0] != *task.AssigneeID {
			task.AssigneeIDs = []string{*task.AssigneeID}
		}
		return
	}
	task.AssigneeID = FirstAssignee(task.AssigneeIDs)
}

// ResolveAssignees applies the compatibility rules to a mutation. stored is
// the list already saved for the task (nil when the task is new).
//
//   - assigneeIds sent: it wins (null or [] clears).
//   - only assigneeId sent (an older client): the list becomes [assigneeId]
//     unless that is already the stored first assignee, so an old client that
//     re-sends the first assignee does not wipe the others. A null assigneeId
//     clears the list.
//   - neither sent: the stored list is kept.
func (task *Task) ResolveAssignees(stored []string) ([]string, error) {
	switch {
	case task.AssigneeIDs != nil:
		return NormalizeAssigneeIDs(task.AssigneeIDs)
	case task.FieldPresent("assigneeId"):
		legacy := ""
		if task.AssigneeID != nil {
			legacy = strings.TrimSpace(*task.AssigneeID)
		}
		if legacy == "" {
			return []string{}, nil
		}
		normalized, err := NormalizeAssigneeIDs([]string{legacy})
		if err != nil {
			return nil, err
		}
		if len(stored) > 0 && stored[0] == normalized[0] {
			return append([]string{}, stored...), nil
		}
		return normalized, nil
	default:
		return append([]string{}, stored...), nil
	}
}
