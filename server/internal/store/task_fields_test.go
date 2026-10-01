package store

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

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

// A repeat rule syncs like the other optional task fields: older clients that
// omit it keep the stored rule, an explicit null clears it, bad rules fail.
func TestRecurrenceKeptWhenOmittedPostgres(t *testing.T) {
	s, _ := newGameTestStore(t)
	ctx := context.Background()
	user := newGameTestUser(t, s, "repeat@game.test")
	due := user.day(0)
	task := user.task()
	task.DueDate = &due
	task.Recurrence = &tasks.TaskRecurrence{Interval: 2, Unit: "week", DaysOfWeek: []int{4, 1, 4}, Basis: "due"}
	task = user.push(task)
	current, err := s.CurrentTasks(ctx, user.id)
	if err != nil || len(current) != 1 || current[0].Recurrence == nil {
		t.Fatalf("current = %+v %v", current, err)
	}
	rule := current[0].Recurrence
	if rule.Interval != 2 || rule.Unit != "week" || len(rule.DaysOfWeek) != 2 || rule.DaysOfWeek[0] != 1 || rule.Basis != "" {
		t.Fatalf("rule is stored in its canonical form: %+v", rule)
	}

	// An older client sends the task without a "recurrence" key.
	encoded, _ := json.Marshal(task)
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	delete(fields, "recurrence")
	fields["title"] = json.RawMessage(`"Renamed by an old client"`)
	encoded, _ = json.Marshal(fields)
	var old tasks.Task
	if err := json.Unmarshal(encoded, &old); err != nil {
		t.Fatal(err)
	}
	if old.FieldPresent("recurrence") {
		t.Fatal("the decoded task must remember the field was omitted")
	}
	user.push(old)
	current, _ = s.CurrentTasks(ctx, user.id)
	if current[0].Title != "Renamed by an old client" || current[0].Recurrence == nil || current[0].Recurrence.Interval != 2 {
		t.Fatalf("an omitted recurrence must keep the stored rule: %+v", current[0])
	}
	pulled, err := s.Pull(ctx, user.id, 0)
	if err != nil {
		t.Fatal(err)
	}
	if last := pulled.Tasks[len(pulled.Tasks)-1]; last.Recurrence == nil || last.Recurrence.Unit != "week" {
		t.Fatalf("pull carries the kept rule: %+v", last)
	}

	// An invalid rule is refused.
	bad := task
	bad.Recurrence = &tasks.TaskRecurrence{Interval: 0, Unit: "day"}
	bad.UpdatedAt = time.Now().UTC()
	results, err := s.Push(ctx, user.id, []tasks.Mutation{{ID: uuid.NewString(), Kind: "upsert", Task: bad}})
	if err != nil || len(results) != 1 || results[0].OK {
		t.Fatalf("an invalid rule must be refused: %+v %v", results, err)
	}

	// An explicit null (the app completed the task and created the next one) clears it.
	task.Recurrence = nil
	user.push(task)
	current, _ = s.CurrentTasks(ctx, user.id)
	if current[0].Recurrence != nil {
		t.Fatalf("null must clear the rule: %+v", current[0].Recurrence)
	}
}
