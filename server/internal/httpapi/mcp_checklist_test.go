package httpapi

import (
	"strings"
	"testing"

	"github.com/gh-Constant/prior/server/internal/tasks"
)

func TestMCPTaskChecklistAndReminder(t *testing.T) {
	backend := &fakeMCPBackend{}
	handler := newTestMCP(backend)
	text, isError := callTool(t, handler, "create_task", `{"title":"Pack","reminder_at":"2026-10-01T09:00:00+02:00","checklist":[{"title":"Passport"},{"title":"Charger","done":true}]}`)
	if isError {
		t.Fatalf("create_task failed: %s", text)
	}
	created := backend.tasks[0]
	if created.ReminderAt == nil || *created.ReminderAt != "2026-10-01T09:00:00+02:00" {
		t.Fatalf("reminder = %v", created.ReminderAt)
	}
	if len(created.Checklist) != 2 || created.Checklist[0].ID == "" || created.Checklist[1].Position != 1 || !created.Checklist[1].Done {
		t.Fatalf("checklist = %+v", created.Checklist)
	}
	keep := created.Checklist[0].ID
	text, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","reminder_at":null,"checklist":[{"id":"`+keep+`","title":"Passport","done":true}]}`)
	if isError {
		t.Fatalf("update_task failed: %s", text)
	}
	updated := backend.tasks[0]
	if updated.ReminderAt != nil || len(updated.Checklist) != 1 || updated.Checklist[0].ID != keep || !updated.Checklist[0].Done {
		t.Fatalf("updated = %+v", updated)
	}
	if text, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","reminder_at":"tomorrow"}`); !isError || !strings.Contains(text, "RFC 3339") {
		t.Fatalf("bad reminder = %s %v", text, isError)
	}
	many := make([]string, tasks.MaxChecklistItems+1)
	for index := range many {
		many[index] = `{"title":"x"}`
	}
	if _, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","checklist":[`+strings.Join(many, ",")+`]}`); !isError {
		t.Fatal("more than 100 items must be refused")
	}
}
