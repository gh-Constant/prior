package store

import (
	"context"
	"strings"
	"testing"

	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
)

func TestNormalizeChecklist(t *testing.T) {
	items, err := NormalizeChecklist([]tasks.ChecklistItem{{ID: "b", Title: " second ", Position: 5}, {ID: "a", Title: "first", Position: 1}})
	if err != nil || items[0].ID != "a" || items[0].Position != 0 || items[1].Title != "second" || items[1].Position != 1 {
		t.Fatalf("items = %+v %v", items, err)
	}
	if _, err := NormalizeChecklist([]tasks.ChecklistItem{{ID: "a", Title: "x"}, {ID: "a", Title: "y"}}); err == nil {
		t.Fatal("duplicate ids must be refused")
	}
	if _, err := NormalizeChecklist([]tasks.ChecklistItem{{ID: "a", Title: "  "}}); err == nil {
		t.Fatal("empty titles must be refused")
	}
	tooMany := make([]tasks.ChecklistItem, tasks.MaxChecklistItems+1)
	for index := range tooMany {
		tooMany[index] = tasks.ChecklistItem{ID: uuid.NewString(), Title: "x"}
	}
	if _, err := NormalizeChecklist(tooMany); err == nil || !strings.Contains(err.Error(), "100") {
		t.Fatalf("cap = %v", err)
	}
	reminder := "2026-10-01T09:00:00+02:00"
	value := &reminder
	if err := normalizeReminder(&value); err != nil || *value != "2026-10-01T07:00:00Z" {
		t.Fatalf("reminder = %v %v", *value, err)
	}
	bad := "tomorrow"
	value = &bad
	if err := normalizeReminder(&value); err == nil {
		t.Fatal("bad reminder must be refused")
	}
}

func TestChecklistAndReminderSyncWithoutXPPostgres(t *testing.T) {
	s, _ := newGameTestStore(t)
	ctx := context.Background()
	user := newGameTestUser(t, s, "check@game.test")
	task := user.task()
	reminder := "2026-10-01T09:00:00+02:00"
	task.ReminderAt = &reminder
	task.Checklist = []tasks.ChecklistItem{{ID: "i1", Title: "Draft", Position: 0}, {ID: "i2", Title: "Send", Position: 1}}
	task = user.push(task)
	before := user.state().Profile.XP
	task.Checklist[0].Done = true
	task.Checklist[1].Done = true
	user.push(task)
	if xp := user.state().Profile.XP; xp != before {
		t.Fatalf("checking items must not earn XP: %d -> %d", before, xp)
	}
	pulled, err := s.Pull(ctx, user.id, 0)
	if err != nil {
		t.Fatal(err)
	}
	last := pulled.Tasks[len(pulled.Tasks)-1]
	if last.ReminderAt == nil || *last.ReminderAt != "2026-10-01T07:00:00Z" || len(last.Checklist) != 2 || !last.Checklist[1].Done {
		t.Fatalf("pulled = %+v", last)
	}
	current, err := s.CurrentTasks(ctx, user.id)
	if err != nil || len(current) != 1 || len(current[0].Checklist) != 2 {
		t.Fatalf("current = %+v %v", current, err)
	}
	// Old clients omit both fields: the task normalizes to none.
	task.Checklist = nil
	task.ReminderAt = nil
	user.push(task)
	current, _ = s.CurrentTasks(ctx, user.id)
	if current[0].ReminderAt != nil || len(current[0].Checklist) != 0 {
		t.Fatalf("cleared = %+v", current[0])
	}
}
