package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
)

type fakeMCPBackend struct {
	tasks     []tasks.Task
	habits    []tasks.Habit
	mutations []tasks.Mutation
}

func (f *fakeMCPBackend) currentTasks(context.Context, uuid.UUID) ([]tasks.Task, error) {
	return append([]tasks.Task(nil), f.tasks...), nil
}

func (f *fakeMCPBackend) currentHabits(context.Context, uuid.UUID) ([]tasks.Habit, error) {
	return append([]tasks.Habit(nil), f.habits...), nil
}

func (f *fakeMCPBackend) currentProjects(context.Context, uuid.UUID) ([]store.MCPProject, error) {
	return []store.MCPProject{{ID: "p1", Name: "Launch", Kind: "project"}}, nil
}

func (f *fakeMCPBackend) applyMutation(_ context.Context, _ uuid.UUID, mutation tasks.Mutation) (tasks.Task, tasks.Habit, error) {
	f.mutations = append(f.mutations, mutation)
	if mutation.Entity == "habit" {
		return tasks.Task{}, mutation.Habit, nil
	}
	for index, task := range f.tasks {
		if task.ID == mutation.Task.ID {
			f.tasks[index] = mutation.Task
			return mutation.Task, tasks.Habit{}, nil
		}
	}
	f.tasks = append(f.tasks, mutation.Task)
	return mutation.Task, tasks.Habit{}, nil
}

func strPtr(value string) *string { return &value }

func newTestMCP(backend *fakeMCPBackend) *mcpHandler {
	return &mcpHandler{
		authenticate: func(r *http.Request) (uuid.UUID, error) {
			if bearer(r) != "good" {
				return uuid.Nil, errors.New("invalid or expired token")
			}
			return uuid.New(), nil
		},
		backend: backend,
		now:     func() time.Time { return time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC) },
	}
}

func rpc(t *testing.T, handler http.Handler, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer good")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var decoded map[string]any
	if response.Code == http.StatusOK {
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("invalid JSON response: %v", err)
		}
	}
	return response, decoded
}

func callTool(t *testing.T, handler http.Handler, name string, args string) (string, bool) {
	t.Helper()
	_, decoded := rpc(t, handler, `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"`+name+`","arguments":`+args+`}}`)
	result, ok := decoded["result"].(map[string]any)
	if !ok {
		t.Fatalf("tools/call %s returned no result: %v", name, decoded)
	}
	content := result["content"].([]any)[0].(map[string]any)
	isError, _ := result["isError"].(bool)
	return content["text"].(string), isError
}

func TestMCPRequiresBearerToken(t *testing.T) {
	handler := newTestMCP(&fakeMCPBackend{})
	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.HasPrefix(response.Header().Get("WWW-Authenticate"), "Bearer") {
		t.Fatalf("status %d, headers %v", response.Code, response.Header())
	}
}

func TestMCPRejectsForeignOrigin(t *testing.T) {
	handler := newTestMCP(&fakeMCPBackend{})
	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer good")
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status %d", response.Code)
	}
}

func TestMCPHandshake(t *testing.T) {
	handler := newTestMCP(&fakeMCPBackend{})
	_, decoded := rpc(t, handler, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"claude-code","version":"2"}}}`)
	result := decoded["result"].(map[string]any)
	if result["protocolVersion"] != "2025-03-26" || result["serverInfo"].(map[string]any)["name"] != "prior" {
		t.Fatalf("unexpected initialize result: %v", result)
	}
	response, _ := rpc(t, handler, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if response.Code != http.StatusAccepted {
		t.Fatalf("notification status %d", response.Code)
	}
	_, decoded = rpc(t, handler, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	names := map[string]bool{}
	for _, tool := range decoded["result"].(map[string]any)["tools"].([]any) {
		names[tool.(map[string]any)["name"].(string)] = true
	}
	for _, want := range []string{"list_tasks", "get_task", "create_task", "update_task", "complete_task", "delete_task", "list_habits", "create_habit", "complete_habit", "list_projects"} {
		if !names[want] {
			t.Errorf("tools/list is missing %s", want)
		}
	}
	_, decoded = rpc(t, handler, `{"jsonrpc":"2.0","id":3,"method":"resources/list"}`)
	if decoded["error"].(map[string]any)["code"].(float64) != -32601 {
		t.Fatalf("unknown method should be -32601: %v", decoded)
	}
}

func TestMCPTaskLifecycle(t *testing.T) {
	backend := &fakeMCPBackend{tasks: []tasks.Task{
		{ID: "a", Title: "Later", Priority: 4, DueDate: strPtr("2026-10-10")},
		{ID: "b", Title: "Soon", Priority: 1, DueDate: strPtr("2026-09-30")},
		{ID: "c", Title: "Done already", Completed: true, Status: "done"},
	}}
	handler := newTestMCP(backend)

	text, isError := callTool(t, handler, "list_tasks", `{}`)
	if isError || strings.Contains(text, "Done already") || strings.Index(text, "Soon") > strings.Index(text, "Later") {
		t.Fatalf("list_tasks should return open tasks by due date: %s", text)
	}

	text, isError = callTool(t, handler, "create_task", `{"title":"  Write spec ","due_date":"2026-10-01","priority":2}`)
	if isError {
		t.Fatalf("create_task failed: %s", text)
	}
	created := backend.mutations[len(backend.mutations)-1]
	if created.Kind != "upsert" || created.Task.Title != "Write spec" || created.Task.Priority != 2 || *created.Task.DueDate != "2026-10-01" || created.Task.Status != "inbox" {
		t.Fatalf("unexpected create mutation: %+v", created)
	}
	if _, err := uuid.Parse(created.Task.ID); err != nil || created.Task.UpdatedAt.IsZero() {
		t.Fatalf("created task needs a UUID and timestamps: %+v", created.Task)
	}

	text, isError = callTool(t, handler, "update_task", `{"id":"a","title":"Later, renamed","due_date":null,"important":true}`)
	if isError {
		t.Fatalf("update_task failed: %s", text)
	}
	updated := backend.mutations[len(backend.mutations)-1].Task
	if updated.Title != "Later, renamed" || updated.DueDate != nil || !updated.Important || updated.Priority != 4 {
		t.Fatalf("update_task should patch only given fields: %+v", updated)
	}

	if _, isError = callTool(t, handler, "complete_task", `{"id":"b"}`); isError {
		t.Fatal("complete_task failed")
	}
	completed := backend.mutations[len(backend.mutations)-1].Task
	if !completed.Completed || completed.Status != "done" {
		t.Fatalf("complete_task should mark done: %+v", completed)
	}

	if _, isError = callTool(t, handler, "delete_task", `{"id":"b"}`); isError {
		t.Fatal("delete_task failed")
	}
	deleted := backend.mutations[len(backend.mutations)-1]
	if deleted.Kind != "delete" || deleted.Task.DeletedAt == nil {
		t.Fatalf("delete_task should send a delete mutation: %+v", deleted)
	}

	if text, isError = callTool(t, handler, "update_task", `{"id":"missing","title":"x"}`); !isError || !strings.Contains(text, "not found") {
		t.Fatalf("unknown task should be a tool error: %s", text)
	}
	if text, isError = callTool(t, handler, "update_task", `{"id":"a","colour":"red"}`); !isError {
		t.Fatalf("unknown fields should be rejected: %s", text)
	}
}

func TestMCPHabits(t *testing.T) {
	backend := &fakeMCPBackend{habits: []tasks.Habit{{ID: "h1", Title: "Run", Interval: 1, Unit: "day", StartDate: "2026-09-01", CompletedDates: []string{"2026-09-28"}}}}
	handler := newTestMCP(backend)

	if text, isError := callTool(t, handler, "create_habit", `{"title":"Read","unit":"week","days_of_week":[1,3]}`); isError {
		t.Fatalf("create_habit failed: %s", text)
	}
	habit := backend.mutations[0].Habit
	if habit.Interval != 1 || habit.StartDate != "2026-09-29" || len(habit.DaysOfWeek) != 2 || backend.mutations[0].Entity != "habit" {
		t.Fatalf("unexpected habit: %+v", habit)
	}

	if text, isError := callTool(t, handler, "complete_habit", `{"id":"h1"}`); isError {
		t.Fatalf("complete_habit failed: %s", text)
	}
	dates := backend.mutations[1].Habit.CompletedDates
	if strings.Join(dates, ",") != "2026-09-28,2026-09-29" {
		t.Fatalf("complete_habit should add today: %v", dates)
	}
}

func TestCreateMCPTokenRequiresSession(t *testing.T) {
	server := &Server{}
	response := httptest.NewRecorder()
	server.createMCPToken(response, httptest.NewRequest(http.MethodPost, "/v1/mcp/tokens", strings.NewReader(`{}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("minting a token must require a session, got %d", response.Code)
	}
}

func TestMCPExplainsInvalidDates(t *testing.T) {
	backend := &fakeMCPBackend{tasks: []tasks.Task{{ID: "a", Title: "A", Priority: 4}}}
	text, isError := callTool(t, newTestMCP(backend), "update_task", `{"id":"a","due_date":"tomorrow"}`)
	if !isError || !strings.Contains(text, "YYYY-MM-DD") || len(backend.mutations) != 0 {
		t.Fatalf("invalid dates should be explained before any write: %s", text)
	}
}
