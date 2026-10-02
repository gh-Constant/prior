package httpapi

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/tasks"
)

const (
	assigneeA = "11111111-1111-4111-8111-111111111111"
	assigneeB = "22222222-2222-4222-8222-222222222222"
	assigneeC = "33333333-3333-4333-8333-333333333333"
)

func TestMCPAssignees(t *testing.T) {
	backend := &fakeMCPBackend{}
	handler := newTestMCP(backend)

	text, isError := callTool(t, handler, "create_task", `{"title":"Team work","assignee_ids":["`+assigneeA+`","`+assigneeB+`","`+assigneeA+`"]}`)
	if isError {
		t.Fatalf("create_task failed: %s", text)
	}
	created := backend.tasks[0]
	if !reflect.DeepEqual(created.AssigneeIDs, []string{assigneeA, assigneeB}) || created.AssigneeID == nil || *created.AssigneeID != assigneeA {
		t.Fatalf("assignees = %v / %v", created.AssigneeIDs, created.AssigneeID)
	}
	if listed, _ := callTool(t, handler, "list_tasks", `{}`); !strings.Contains(listed, `"assigneeIds"`) {
		t.Fatalf("list_tasks lacks assigneeIds: %s", listed)
	}

	// An omitted argument keeps the list.
	if text, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","title":"Renamed"}`); isError {
		t.Fatalf("update_task failed: %s", text)
	}
	if got := backend.tasks[0].AssigneeIDs; !reflect.DeepEqual(got, []string{assigneeA, assigneeB}) {
		t.Fatalf("an omitted assignee_ids must be kept, got %v", got)
	}

	// The single-assignee alias: the same first assignee keeps the others, a
	// different one replaces the list.
	if _, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","assignee_id":"`+assigneeA+`"}`); isError {
		t.Fatal("alias update failed")
	}
	if got := backend.tasks[0].AssigneeIDs; !reflect.DeepEqual(got, []string{assigneeA, assigneeB}) {
		t.Fatalf("re-sending the first assignee must keep the others, got %v", got)
	}
	if _, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","assignee_id":"`+assigneeC+`"}`); isError {
		t.Fatal("alias update failed")
	}
	if got := backend.tasks[0].AssigneeIDs; !reflect.DeepEqual(got, []string{assigneeC}) {
		t.Fatalf("a new alias value replaces the list, got %v", got)
	}
	// assignee_ids wins over the alias.
	if _, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","assignee_id":"`+assigneeC+`","assignee_ids":["`+assigneeB+`","`+assigneeA+`"]}`); isError {
		t.Fatal("update failed")
	}
	if got := backend.tasks[0].AssigneeIDs; !reflect.DeepEqual(got, []string{assigneeB, assigneeA}) || *backend.tasks[0].AssigneeID != assigneeB {
		t.Fatalf("assignee_ids must win, got %v", got)
	}
	for _, clear := range []string{`"assignee_ids":null`, `"assignee_ids":[]`, `"assignee_id":null`} {
		callTool(t, handler, "update_task", `{"id":"`+created.ID+`","assignee_ids":["`+assigneeA+`"]}`)
		if _, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`",`+clear+`}`); isError {
			t.Fatalf("%s failed", clear)
		}
		if len(backend.tasks[0].AssigneeIDs) != 0 || backend.tasks[0].AssigneeID != nil {
			t.Fatalf("%s must clear, got %v", clear, backend.tasks[0].AssigneeIDs)
		}
	}

	tooMany := make([]string, 0, tasks.MaxAssignees+1)
	for index := 0; index <= tasks.MaxAssignees; index++ {
		tooMany = append(tooMany, fmt.Sprintf(`"00000000-0000-4000-8000-0000000000%02d"`, index))
	}
	for _, bad := range []string{`"assignee_ids":"` + assigneeA + `"`, `"assignee_ids":["not-a-uuid"]`, `"assignee_ids":[` + strings.Join(tooMany, ",") + `]`} {
		if _, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`",`+bad+`}`); !isError {
			t.Errorf("%s must be refused", bad)
		}
	}
}

func TestTasksCSVHasAssignees(t *testing.T) {
	moment := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	var out bytes.Buffer
	err := writeTasksCSV(&out, []tasks.Task{
		{ID: "a", Title: "Two", Status: "next", Priority: 4, AssigneeIDs: []string{assigneeA, assigneeB}, CreatedAt: moment, UpdatedAt: moment},
		{ID: "b", Title: "None", Status: "next", Priority: 4, CreatedAt: moment, UpdatedAt: moment},
	})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := csv.NewReader(&out).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	column := -1
	for index, name := range rows[0] {
		if name == "assigneeIds" {
			column = index
		}
	}
	if column < 0 || rows[1][column] != assigneeA+";"+assigneeB || rows[2][column] != "" {
		t.Fatalf("assigneeIds column = %d in %v", column, rows)
	}
}
