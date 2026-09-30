package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/tasks"
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
