package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMCPRecurringTasks(t *testing.T) {
	backend := &fakeMCPBackend{}
	handler := newTestMCP(backend)
	// The fake clock is 2026-09-29 (a Tuesday).
	text, isError := callTool(t, handler, "create_task", `{"title":"Water plants","status":"waiting","recurrence":{"unit":"week","days_of_week":[1,4]}}`)
	if isError {
		t.Fatalf("create_task failed: %s", text)
	}
	created := backend.tasks[0]
	if created.Recurrence == nil || created.Recurrence.Interval != 1 || created.Recurrence.Unit != "week" || len(created.Recurrence.DaysOfWeek) != 2 {
		t.Fatalf("recurrence = %+v", created.Recurrence)
	}
	if created.DueDate == nil || *created.DueDate != "2026-09-29" {
		t.Fatalf("a repeating task without a due date starts today: %v", created.DueDate)
	}

	// Completing it creates the next occurrence and stops the series on the old task.
	text, isError = callTool(t, handler, "complete_task", `{"id":"`+created.ID+`"}`)
	if isError {
		t.Fatalf("complete_task failed: %s", text)
	}
	var result struct {
		Task           struct{ ID string }
		NextOccurrence struct {
			ID, Status string
			DueDate    string
			Completed  bool
			Recurrence *struct{ Interval int }
		} `json:"nextOccurrence"`
	}
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		t.Fatalf("result %q: %v", text, err)
	}
	if len(backend.tasks) != 2 {
		t.Fatalf("expected the completed task and its next occurrence, got %d tasks", len(backend.tasks))
	}
	done, next := backend.tasks[0], backend.tasks[1]
	if !done.Completed || done.Recurrence != nil {
		t.Fatalf("the completed task stops repeating: %+v", done)
	}
	// Tuesday 2026-09-29 -> Thursday 2026-10-01 (the next listed weekday).
	if next.ID == done.ID || next.Completed || next.Status != "next" || next.DueDate == nil || *next.DueDate != "2026-10-01" || next.Recurrence == nil {
		t.Fatalf("next occurrence = %+v", next)
	}
	if result.NextOccurrence.ID != next.ID {
		t.Fatalf("the result names the new occurrence: %s", text)
	}

	// Reopening or editing a completed task never spawns again.
	if _, isError = callTool(t, handler, "complete_task", `{"id":"`+done.ID+`","completed":false}`); isError {
		t.Fatal("reopen failed")
	}
	if len(backend.tasks) != 2 {
		t.Fatalf("reopening must not create a task, got %d", len(backend.tasks))
	}

	// An update that sets status done spawns too; clearing the rule does not.
	if _, isError = callTool(t, handler, "update_task", `{"id":"`+next.ID+`","status":"done"}`); isError {
		t.Fatal("update to done failed")
	}
	if len(backend.tasks) != 3 {
		t.Fatalf("status done must spawn the next occurrence, got %d", len(backend.tasks))
	}
	third := backend.tasks[2]
	if _, isError = callTool(t, handler, "update_task", `{"id":"`+third.ID+`","recurrence":null}`); isError {
		t.Fatal("clearing the rule failed")
	}
	if backend.tasks[2].Recurrence != nil {
		t.Fatal("null clears the rule")
	}
	if _, isError = callTool(t, handler, "complete_task", `{"id":"`+third.ID+`"}`); isError || len(backend.tasks) != 3 {
		t.Fatalf("a task without a rule does not spawn: %d tasks", len(backend.tasks))
	}

	// Past the end date the series stops: no next occurrence.
	text, isError = callTool(t, handler, "create_task", `{"title":"Short series","due_date":"2026-09-29","recurrence":{"interval":1,"unit":"day","until":"2026-09-29"}}`)
	if isError {
		t.Fatalf("create_task failed: %s", text)
	}
	last := backend.tasks[3]
	text, isError = callTool(t, handler, "complete_task", `{"id":"`+last.ID+`"}`)
	if isError || len(backend.tasks) != 4 || !strings.Contains(text, `"nextOccurrence": null`) {
		t.Fatalf("the last occurrence ends the series: %s (%d tasks)", text, len(backend.tasks))
	}

	for _, bad := range []string{
		`{"unit":"hour"}`,
		`{"interval":0,"unit":"day"}`,
		`{"interval":1,"unit":"week","days_of_week":[9]}`,
		`{"interval":1,"unit":"day","until":"soon"}`,
		`{"interval":1,"unit":"day","bogus":true}`,
		`"every day"`,
	} {
		if _, isError := callTool(t, handler, "create_task", `{"title":"Bad","recurrence":`+bad+`}`); !isError {
			t.Errorf("recurrence %s must be refused", bad)
		}
	}
}
