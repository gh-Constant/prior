package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
)

// Prior exposes a remote MCP server (Streamable HTTP transport, stateless,
// JSON responses only) at POST /mcp so Claude Code and other MCP clients can
// read and edit a user's tasks and habits:
//
//	claude mcp add --transport http prior https://api.prior.constantsuchet.fr/mcp \
//	  --header "Authorization: Bearer <token from POST /v1/mcp/tokens>"
//
// Writes go through the same Push path as the apps, so validation, revisions,
// collaboration rules and realtime fan-out stay identical.

const (
	mcpLatestProtocol = "2025-06-18"
	mcpTokenTTL       = 365 * 24 * time.Hour
	mcpListLimit      = 200
)

var mcpSupportedProtocols = map[string]bool{"2024-11-05": true, "2025-03-26": true, "2025-06-18": true, "2025-11-25": true}

// mcpBackend is the data surface the MCP tools need. The Server implements it
// over the store; tests use an in-memory fake.
type mcpBackend interface {
	currentTasks(ctx context.Context, userID uuid.UUID) ([]tasks.Task, error)
	currentHabits(ctx context.Context, userID uuid.UUID) ([]tasks.Habit, error)
	currentProjects(ctx context.Context, userID uuid.UUID) ([]store.MCPProject, error)
	applyMutation(ctx context.Context, userID uuid.UUID, mutation tasks.Mutation) (tasks.Task, tasks.Habit, error)
}

type mcpHandler struct {
	authenticate func(r *http.Request) (uuid.UUID, error)
	backend      mcpBackend
	now          func() time.Time
}

type storeMCPBackend struct{ server *Server }

func (b storeMCPBackend) currentTasks(ctx context.Context, userID uuid.UUID) ([]tasks.Task, error) {
	return b.server.store.CurrentTasks(ctx, userID)
}

func (b storeMCPBackend) currentHabits(ctx context.Context, userID uuid.UUID) ([]tasks.Habit, error) {
	return b.server.store.CurrentHabits(ctx, userID)
}

func (b storeMCPBackend) currentProjects(ctx context.Context, userID uuid.UUID) ([]store.MCPProject, error) {
	return b.server.store.CurrentProjects(ctx, userID)
}

func (b storeMCPBackend) applyMutation(ctx context.Context, userID uuid.UUID, mutation tasks.Mutation) (tasks.Task, tasks.Habit, error) {
	results, err := b.server.store.Push(ctx, userID, []tasks.Mutation{mutation})
	if err != nil {
		return tasks.Task{}, tasks.Habit{}, err
	}
	if len(results) != 1 {
		return tasks.Task{}, tasks.Habit{}, errors.New("mutation was not applied")
	}
	if !results[0].OK {
		return tasks.Task{}, tasks.Habit{}, errors.New(results[0].Error.Message)
	}
	applied := store.PushApplied(results)
	b.server.highestBroadcast(userID, applied)
	latest := highestRevision(applied)
	b.server.notifySync(ctx, userID, "sync", latest)
	b.server.notifySync(ctx, userID, "tasks_required", latest)
	b.server.notifyProjectPeers(ctx, userID)
	return results[0].Task, results[0].Habit, nil
}

func (s *Server) mcpHandler() *mcpHandler {
	return &mcpHandler{
		authenticate: func(r *http.Request) (uuid.UUID, error) {
			token := bearer(r)
			if token == "" {
				return uuid.Nil, errors.New("authentication required")
			}
			user, err := s.store.UserForMCPToken(r.Context(), token)
			if err != nil {
				return uuid.Nil, errors.New("invalid or expired token")
			}
			return user.ID, nil
		},
		backend: storeMCPBackend{server: s},
		now:     time.Now,
	}
}

func (s *Server) mcp(w http.ResponseWriter, r *http.Request) {
	s.mcpHandler().ServeHTTP(w, r)
}

// POST /v1/mcp/tokens mints a long-lived token scoped to /mcp. It is stored as
// a session (platform "mcp"), so it shows up in, and is revoked from, the
// existing sessions list.
func (s *Server) createMCPToken(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	_ = decodeJSON(r, &body)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "Claude Code"
	}
	if len(name) > 80 {
		name = name[:80]
	}
	token, err := mcpRandomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to create token"))
		return
	}
	if err := s.store.CreateSession(r.Context(), user.ID, token, name, store.MCPTokenPlatform, mcpTokenTTL); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to create token"))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"token":     token,
		"name":      name,
		"expiresAt": time.Now().UTC().Add(mcpTokenTTL),
	})
}

func mcpRandomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (h *mcpHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" && !allowedOrigin(origin) {
		// DNS-rebinding guard required by the MCP transport spec.
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin not allowed"})
		return
	}
	if r.Method != http.MethodPost {
		// Stateless server: no SSE stream and no sessions to delete.
		w.Header().Set("Allow", "POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	userID, err := h.authenticate(r)
	if err != nil {
		w.Header().Set("WWW-Authenticate", `Bearer realm="prior"`)
		writeUnauthorized(w, err)
		return
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeRPCError(w, nil, -32700, "unable to read request")
		return
	}
	var request mcpRequest
	if err := json.Unmarshal(raw, &request); err != nil || request.JSONRPC != "2.0" || request.Method == "" {
		writeRPCError(w, nil, -32600, "invalid JSON-RPC request")
		return
	}
	if len(request.ID) == 0 || string(request.ID) == "null" {
		// Notifications and client responses need no reply.
		w.WriteHeader(http.StatusAccepted)
		return
	}
	result, rpcErr := h.dispatch(r.Context(), userID, request)
	if rpcErr != nil {
		writeRPCError(w, request.ID, rpcErr.Code, rpcErr.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
}

func writeRPCError(w http.ResponseWriter, id json.RawMessage, code int, message string) {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": id, "error": mcpError{Code: code, Message: message}})
}

func (h *mcpHandler) dispatch(ctx context.Context, userID uuid.UUID, request mcpRequest) (any, *mcpError) {
	switch request.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(request.Params, &params)
		version := mcpLatestProtocol
		if mcpSupportedProtocols[params.ProtocolVersion] {
			version = params.ProtocolVersion
		}
		return map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "prior", "title": "Prior", "version": "1.0.0"},
			"instructions":    mcpInstructions,
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": mcpTools}, nil
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(request.Params, &params); err != nil {
			return nil, &mcpError{Code: -32602, Message: "invalid tool call"}
		}
		if len(params.Arguments) == 0 || string(params.Arguments) == "null" {
			params.Arguments = json.RawMessage("{}")
		}
		value, err := h.callTool(ctx, userID, params.Name, params.Arguments)
		if errors.Is(err, errUnknownTool) {
			return nil, &mcpError{Code: -32602, Message: "unknown tool: " + params.Name}
		}
		if err != nil {
			// Tool failures are results the model can read and recover from.
			return map[string]any{"isError": true, "content": []map[string]string{{"type": "text", "text": err.Error()}}}, nil
		}
		text, _ := json.MarshalIndent(value, "", "  ")
		return map[string]any{"content": []map[string]string{{"type": "text", "text": string(text)}}}, nil
	default:
		return nil, &mcpError{Code: -32601, Message: "method not found: " + request.Method}
	}
}

const mcpInstructions = "Prior is the user's task and habit manager. Use list_tasks before editing so you have task IDs. " +
	"Dates are ISO YYYY-MM-DD and times are HH:MM (24h). Priority follows Todoist: 1 is highest, 4 is none. " +
	"Status is one of inbox, backlog, next, in_progress, waiting, done. Tasks of Scrum and Scrumban projects are sized with story_points (a multiple of 0.5, null when not estimated) instead of priority. Changes sync to the user's apps immediately."

var errUnknownTool = errors.New("unknown tool")

func schema(properties map[string]any, required ...string) map[string]any {
	result := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		result["required"] = required
	}
	return result
}

var (
	propString = func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	propNullable = func(description string) map[string]any {
		return map[string]any{"type": []string{"string", "null"}, "description": description + " Pass null to clear."}
	}
	propBool = func(description string) map[string]any {
		return map[string]any{"type": "boolean", "description": description}
	}
	propPriority = map[string]any{"type": "integer", "minimum": 1, "maximum": 4, "description": "1 = highest (P1), 4 = none (default)."}
	propStatus   = map[string]any{"type": "string", "enum": []string{"inbox", "backlog", "next", "in_progress", "waiting", "done"}}
)

// propStoryPoints describes the story_points argument: the size of the work in
// agile projects, shown in place of the priority in Scrum and Scrumban ones.
func propStoryPoints(nullable bool) map[string]any {
	kind := any("number")
	description := "Story points: the size of the work (not time), a multiple of 0.5 from 0 to 999 (usual cards: 0.5, 1, 2, 3, 5, 8, 13, 21)."
	if nullable {
		kind = []string{"number", "null"}
		description += " Pass null to clear the estimate."
	}
	return map[string]any{"type": kind, "minimum": 0, "maximum": tasks.MaxStoryPoints, "multipleOf": 0.5, "description": description}
}

func taskFieldProperties(nullable bool) map[string]any {
	optional := propString
	if nullable {
		optional = propNullable
	}
	return map[string]any{
		"title":          propString("Task title (1-400 characters)."),
		"description":    propString("Longer notes, plain text or Markdown."),
		"due_date":       optional("Deadline, YYYY-MM-DD."),
		"due_time":       optional("Deadline time, HH:MM."),
		"scheduled_date": optional("Day the user plans to work on it, YYYY-MM-DD."),
		"scheduled_time": optional("Planned start time, HH:MM."),
		"priority":       propPriority,
		"important":      propBool("Eisenhower importance."),
		"urgent":         propBool("Eisenhower urgency."),
		"status":         propStatus,
		"project_id":     optional("Project ID from list_projects."),
		"area_id":        optional("Area ID from list_projects."),
		"reminder_at":    optional("When to remind the user, an RFC 3339 date-time with offset (e.g. 2026-10-01T09:00:00+02:00)."),
		"story_points":   propStoryPoints(nullable),
		"assignee_ids": map[string]any{
			"type": []string{"array", "null"}, "maxItems": tasks.MaxAssignees, "items": map[string]any{"type": "string"},
			"description": "User ids of the people assigned to the task, in order (the first is the main assignee). Every id must be a member of the task's project; private tasks can only be assigned to their owner. Replaces the whole list; pass [] or null to unassign everyone.",
		},
		"assignee_id": propNullable("Alias of assignee_ids with one person (kept for compatibility); ignored when assignee_ids is given. Re-sending the current first assignee keeps the others. Pass null to unassign everyone."),
		"recurrence": map[string]any{
			"type":        []string{"object", "null"},
			"description": "Repeat rule. Completing the task then creates the next occurrence (the completed one stops repeating). Without a due date the first one is today. Pass null to stop repeating.",
			"properties": map[string]any{
				"interval":     map[string]any{"type": "integer", "minimum": 1, "maximum": tasks.MaxRecurrenceInterval, "description": "Repeat every N units, default 1."},
				"unit":         map[string]any{"type": "string", "enum": []string{"day", "week", "month", "year"}},
				"days_of_week": map[string]any{"type": "array", "items": map[string]any{"type": "integer", "minimum": 0, "maximum": 6}, "description": "0 = Sunday. Weekly rules only; default is the due date's weekday."},
				"basis":        map[string]any{"type": "string", "enum": []string{"due", "completion"}, "description": "due (default): count from the due date; completion: count from the day it is completed."},
				"until":        propNullable("Last occurrence, YYYY-MM-DD."),
			},
			"required": []string{"unit"},
		},
		"checklist": map[string]any{
			"type":        "array",
			"maxItems":    tasks.MaxChecklistItems,
			"description": "Ordered subtasks. Replaces the whole checklist; keep existing ids to keep items. Checking items never earns XP.",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id":    propString("Existing item id (omit for a new item)."),
					"title": propString("Item text (1-400 characters)."),
					"done":  propBool("Checked."),
				},
				"required": []string{"title"},
			},
		},
	}
}

var mcpTools = func() []map[string]any {
	updateProps := taskFieldProperties(true)
	updateProps["id"] = propString("Task ID.")
	updateProps["completed"] = propBool("Mark done (true) or reopen (false).")
	return []map[string]any{
		{
			"name":        "list_tasks",
			"description": "List the user's tasks (own and shared projects). Open tasks by default, sorted by due date then priority. Each task carries storyPoints (null when not estimated) and assigneeIds (user ids, the first is the main assignee).",
			"inputSchema": schema(map[string]any{
				"filter":     map[string]any{"type": "string", "enum": []string{"open", "completed", "all"}, "description": "Default open."},
				"query":      propString("Case-insensitive text to match in title or description."),
				"project_id": propString("Only tasks in this project."),
				"due_before": propString("Only tasks due on or before this date, YYYY-MM-DD."),
				"limit":      map[string]any{"type": "integer", "minimum": 1, "maximum": mcpListLimit},
			}),
			"annotations": map[string]any{"readOnlyHint": true},
		},
		{
			"name":        "get_task",
			"description": "Get one task with all its fields.",
			"inputSchema": schema(map[string]any{"id": propString("Task ID.")}, "id"),
			"annotations": map[string]any{"readOnlyHint": true},
		},
		{
			"name":        "create_task",
			"description": "Create a task. Only title is required.",
			"inputSchema": schema(taskFieldProperties(false), "title"),
		},
		{
			"name":        "update_task",
			"description": "Change fields of an existing task. Omitted fields are kept.",
			"inputSchema": schema(updateProps, "id"),
			"annotations": map[string]any{"idempotentHint": true},
		},
		{
			"name":        "complete_task",
			"description": "Mark a task as done, or reopen it with completed=false.",
			"inputSchema": schema(map[string]any{"id": propString("Task ID."), "completed": propBool("Default true.")}, "id"),
			"annotations": map[string]any{"idempotentHint": true},
		},
		{
			"name":        "delete_task",
			"description": "Delete a task.",
			"inputSchema": schema(map[string]any{"id": propString("Task ID.")}, "id"),
			"annotations": map[string]any{"destructiveHint": true},
		},
		{
			"name":        "list_habits",
			"description": "List the user's habits with their schedule and recent completions.",
			"inputSchema": schema(map[string]any{}),
			"annotations": map[string]any{"readOnlyHint": true},
		},
		{
			"name":        "create_habit",
			"description": "Create a recurring habit, e.g. every 1 day, or every week on given weekdays.",
			"inputSchema": schema(map[string]any{
				"title":        propString("Habit title."),
				"interval":     map[string]any{"type": "integer", "minimum": 1, "maximum": 365, "description": "Default 1."},
				"unit":         map[string]any{"type": "string", "enum": []string{"day", "week", "month", "year"}, "description": "Default day."},
				"days_of_week": map[string]any{"type": "array", "items": map[string]any{"type": "integer", "minimum": 0, "maximum": 6}, "description": "0 = Sunday. Weekly habits only."},
				"time_of_day":  propString("HH:MM."),
				"start_date":   propString("YYYY-MM-DD, default today."),
				"important":    propBool("Eisenhower importance."),
				"urgent":       propBool("Eisenhower urgency."),
			}, "title"),
		},
		{
			"name":        "complete_habit",
			"description": "Check off a habit for a day, or uncheck it with completed=false.",
			"inputSchema": schema(map[string]any{
				"id":        propString("Habit ID."),
				"date":      propString("YYYY-MM-DD, default today (UTC)."),
				"completed": propBool("Default true."),
			}, "id"),
			"annotations": map[string]any{"idempotentHint": true},
		},
		{
			"name":        "list_projects",
			"description": "List areas and projects with their IDs, to file tasks or filter list_tasks.",
			"inputSchema": schema(map[string]any{}),
			"annotations": map[string]any{"readOnlyHint": true},
		},
	}
}()

func decodeArgs(raw json.RawMessage, value any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("invalid arguments: %w", err)
	}
	return nil
}

func (h *mcpHandler) callTool(ctx context.Context, userID uuid.UUID, name string, args json.RawMessage) (any, error) {
	switch name {
	case "list_tasks":
		return h.listTasks(ctx, userID, args)
	case "get_task":
		var input struct {
			ID string `json:"id"`
		}
		if err := decodeArgs(args, &input); err != nil {
			return nil, err
		}
		return h.findTask(ctx, userID, input.ID)
	case "create_task":
		return h.createTask(ctx, userID, args)
	case "update_task":
		return h.updateTask(ctx, userID, args)
	case "complete_task":
		var input struct {
			ID        string `json:"id"`
			Completed *bool  `json:"completed"`
		}
		if err := decodeArgs(args, &input); err != nil {
			return nil, err
		}
		completed := input.Completed == nil || *input.Completed
		task, err := h.findTask(ctx, userID, input.ID)
		if err != nil {
			return nil, err
		}
		before := task
		setTaskCompleted(&task, completed)
		return h.saveTaskCompletion(ctx, userID, before, task)
	case "delete_task":
		var input struct {
			ID string `json:"id"`
		}
		if err := decodeArgs(args, &input); err != nil {
			return nil, err
		}
		task, err := h.findTask(ctx, userID, input.ID)
		if err != nil {
			return nil, err
		}
		deletedAt := h.now().UTC()
		task.DeletedAt = &deletedAt
		if _, err := h.saveTask(ctx, userID, task, "delete"); err != nil {
			return nil, err
		}
		return map[string]any{"deleted": true, "id": task.ID}, nil
	case "list_habits":
		if err := decodeArgs(args, &struct{}{}); err != nil {
			return nil, err
		}
		return h.backend.currentHabits(ctx, userID)
	case "create_habit":
		return h.createHabit(ctx, userID, args)
	case "complete_habit":
		return h.completeHabit(ctx, userID, args)
	case "list_projects":
		if err := decodeArgs(args, &struct{}{}); err != nil {
			return nil, err
		}
		return h.backend.currentProjects(ctx, userID)
	default:
		return nil, errUnknownTool
	}
}

func (h *mcpHandler) listTasks(ctx context.Context, userID uuid.UUID, args json.RawMessage) (any, error) {
	var input struct {
		Filter    string `json:"filter"`
		Query     string `json:"query"`
		ProjectID string `json:"project_id"`
		DueBefore string `json:"due_before"`
		Limit     int    `json:"limit"`
	}
	if err := decodeArgs(args, &input); err != nil {
		return nil, err
	}
	all, err := h.backend.currentTasks(ctx, userID)
	if err != nil {
		return nil, err
	}
	query := strings.ToLower(strings.TrimSpace(input.Query))
	matched := make([]tasks.Task, 0, len(all))
	for _, task := range all {
		switch input.Filter {
		case "", "open":
			if task.Completed {
				continue
			}
		case "completed":
			if !task.Completed {
				continue
			}
		case "all":
		default:
			return nil, errors.New("filter must be open, completed or all")
		}
		if query != "" && !strings.Contains(strings.ToLower(task.Title+"\n"+task.Description), query) {
			continue
		}
		if input.ProjectID != "" && (task.ProjectID == nil || *task.ProjectID != input.ProjectID) {
			continue
		}
		if input.DueBefore != "" && (task.DueDate == nil || *task.DueDate > input.DueBefore) {
			continue
		}
		matched = append(matched, task)
	}
	sort.SliceStable(matched, func(i, j int) bool {
		left, right := matched[i], matched[j]
		if (left.DueDate == nil) != (right.DueDate == nil) {
			return left.DueDate != nil
		}
		if left.DueDate != nil && *left.DueDate != *right.DueDate {
			return *left.DueDate < *right.DueDate
		}
		return left.Priority < right.Priority
	})
	limit := input.Limit
	if limit <= 0 || limit > mcpListLimit {
		limit = mcpListLimit
	}
	total := len(matched)
	if total > limit {
		matched = matched[:limit]
	}
	return map[string]any{"tasks": matched, "total": total}, nil
}

func (h *mcpHandler) findTask(ctx context.Context, userID uuid.UUID, id string) (tasks.Task, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return tasks.Task{}, errors.New("id is required")
	}
	all, err := h.backend.currentTasks(ctx, userID)
	if err != nil {
		return tasks.Task{}, err
	}
	for _, task := range all {
		if strings.EqualFold(task.ID, id) {
			return task, nil
		}
	}
	return tasks.Task{}, fmt.Errorf("task %s not found", id)
}

func setTaskCompleted(task *tasks.Task, completed bool) {
	task.Completed = completed
	if completed {
		task.Status = "done"
	} else if task.Status == "done" {
		task.Status = "next"
	}
}

func (h *mcpHandler) saveTask(ctx context.Context, userID uuid.UUID, task tasks.Task, kind string) (tasks.Task, error) {
	now := h.now().UTC()
	if task.CreatedAt.IsZero() {
		task.CreatedAt = now
	}
	task.UpdatedAt = now
	saved, _, err := h.backend.applyMutation(ctx, userID, tasks.Mutation{
		ID: uuid.NewString(), Kind: kind, Entity: "task", Task: task, CreatedAt: now.Format(time.RFC3339Nano),
	})
	return saved, err
}

var mcpFieldLayouts = map[string]string{
	"due_date": "2006-01-02", "scheduled_date": "2006-01-02",
	"due_time": "15:04", "scheduled_time": "15:04",
}

var mcpLayoutNames = map[string]string{"2006-01-02": "YYYY-MM-DD", "15:04": "HH:MM"}

// applyTaskFields copies the provided JSON fields onto task. A JSON null
// clears an optional field; an absent key leaves it unchanged.
func applyTaskFields(task *tasks.Task, fields map[string]json.RawMessage) error {
	optional := map[string]**string{
		"due_date": &task.DueDate, "due_time": &task.DueTime,
		"scheduled_date": &task.ScheduledDate, "scheduled_time": &task.ScheduledTime,
		"project_id": &task.ProjectID, "area_id": &task.AreaID,
	}
	for key, raw := range fields {
		var err error
		switch key {
		case "id":
		case "title":
			err = json.Unmarshal(raw, &task.Title)
			task.Title = strings.TrimSpace(task.Title)
		case "description":
			err = json.Unmarshal(raw, &task.Description)
		case "priority":
			err = json.Unmarshal(raw, &task.Priority)
		case "important":
			err = json.Unmarshal(raw, &task.Important)
		case "urgent":
			err = json.Unmarshal(raw, &task.Urgent)
		case "status":
			err = json.Unmarshal(raw, &task.Status)
			if err == nil {
				task.Completed = task.Status == "done"
			}
		case "completed":
			var completed bool
			if err = json.Unmarshal(raw, &completed); err == nil {
				setTaskCompleted(task, completed)
			}
		case "reminder_at":
			var value *string
			if err = json.Unmarshal(raw, &value); err == nil {
				if value == nil || strings.TrimSpace(*value) == "" {
					task.ReminderAt = nil
				} else if _, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(*value)); parseErr != nil {
					return errors.New("reminder_at must be an RFC 3339 date-time such as 2026-10-01T09:00:00+02:00")
				} else {
					trimmed := strings.TrimSpace(*value)
					task.ReminderAt = &trimmed
				}
			}
		case "story_points":
			var value *float64
			if err = json.Unmarshal(raw, &value); err == nil {
				points, normalizeErr := tasks.NormalizeStoryPoints(value)
				if normalizeErr != nil {
					return fmt.Errorf("story_points must be null or a multiple of 0.5 from 0 to %d", tasks.MaxStoryPoints)
				}
				task.StoryPoints = points
			}
		case "assignee_ids":
			var ids []string
			if err = json.Unmarshal(raw, &ids); err == nil {
				normalized, normalizeErr := tasks.NormalizeAssigneeIDs(ids)
				if normalizeErr != nil {
					return normalizeErr
				}
				task.AssigneeIDs = normalized
				task.AssigneeID = tasks.FirstAssignee(normalized)
			}
		case "assignee_id":
			// Applied after the loop, so that assignee_ids wins when both are given.
		case "recurrence":
			rule, parseErr := parseMCPRecurrence(raw)
			if parseErr != nil {
				return parseErr
			}
			task.Recurrence = rule
		case "checklist":
			var items []struct {
				ID    string `json:"id"`
				Title string `json:"title"`
				Done  bool   `json:"done"`
			}
			if err = json.Unmarshal(raw, &items); err == nil {
				if len(items) > tasks.MaxChecklistItems {
					return fmt.Errorf("a checklist holds at most %d items", tasks.MaxChecklistItems)
				}
				checklist := make([]tasks.ChecklistItem, 0, len(items))
				for index, item := range items {
					id := strings.TrimSpace(item.ID)
					if id == "" {
						id = uuid.NewString()
					}
					checklist = append(checklist, tasks.ChecklistItem{ID: id, Title: strings.TrimSpace(item.Title), Done: item.Done, Position: index})
				}
				task.Checklist = checklist
			}
		default:
			target, ok := optional[key]
			if !ok {
				return fmt.Errorf("unknown field %q", key)
			}
			var value *string
			if err = json.Unmarshal(raw, &value); err == nil {
				if value != nil && strings.TrimSpace(*value) == "" {
					value = nil
				}
				if value != nil {
					*value = strings.TrimSpace(*value)
					if layout, ok := mcpFieldLayouts[key]; ok {
						if _, parseErr := time.Parse(layout, *value); parseErr != nil {
							return fmt.Errorf("%s must use the format %s", key, mcpLayoutNames[layout])
						}
					}
				}
				*target = value
			}
		}
		if err != nil {
			return fmt.Errorf("invalid %s", key)
		}
	}
	if raw, ok := fields["assignee_id"]; ok {
		if _, both := fields["assignee_ids"]; !both {
			var id *string
			if err := json.Unmarshal(raw, &id); err != nil {
				return errors.New("invalid assignee_id")
			}
			legacy := tasks.Task{AssigneeID: id}
			resolved, err := legacy.ResolveAssignees(task.AssigneeIDs)
			if err != nil {
				return err
			}
			task.AssigneeIDs = resolved
			task.AssigneeID = tasks.FirstAssignee(resolved)
		}
	}
	return nil
}

func (h *mcpHandler) createTask(ctx context.Context, userID uuid.UUID, args json.RawMessage) (any, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(args, &fields); err != nil {
		return nil, errors.New("invalid arguments")
	}
	if _, ok := fields["id"]; ok {
		return nil, errors.New("create_task does not take an id")
	}
	task := tasks.Task{ID: uuid.NewString(), Priority: 4, Status: "inbox"}
	if err := applyTaskFields(&task, fields); err != nil {
		return nil, err
	}
	if task.Title == "" {
		return nil, errors.New("title is required")
	}
	h.defaultRecurringDueDate(&task)
	return h.saveTask(ctx, userID, task, "upsert")
}

func (h *mcpHandler) updateTask(ctx context.Context, userID uuid.UUID, args json.RawMessage) (any, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(args, &fields); err != nil {
		return nil, errors.New("invalid arguments")
	}
	var id string
	if err := json.Unmarshal(fields["id"], &id); err != nil {
		return nil, errors.New("id is required")
	}
	task, err := h.findTask(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	before := task
	if err := applyTaskFields(&task, fields); err != nil {
		return nil, err
	}
	h.defaultRecurringDueDate(&task)
	return h.saveTaskCompletion(ctx, userID, before, task)
}

// defaultRecurringDueDate gives a repeating task without a due date today as
// its first occurrence, like the apps do.
func (h *mcpHandler) defaultRecurringDueDate(task *tasks.Task) {
	if task.Recurrence != nil && task.DueDate == nil {
		today := h.now().UTC().Format("2006-01-02")
		task.DueDate = &today
	}
}

// saveTaskCompletion saves the task. When this update completes a repeating
// task it also creates the next occurrence, as the apps do: the completed task
// stops repeating, and the result is {task, nextOccurrence} (null when the
// series reached its end date). "Today" is the UTC date; the server does not
// know the user's time zone.
func (h *mcpHandler) saveTaskCompletion(ctx context.Context, userID uuid.UUID, before, task tasks.Task) (any, error) {
	if before.Completed || !task.Completed || task.Recurrence == nil {
		return h.saveTask(ctx, userID, task, "upsert")
	}
	now := h.now().UTC()
	next := tasks.NextOccurrence(task, now, before.Status, uuid.NewString, now)
	task.Recurrence = nil
	saved, err := h.saveTask(ctx, userID, task, "upsert")
	if err != nil {
		return nil, err
	}
	result := map[string]any{"task": saved, "nextOccurrence": nil}
	if next != nil {
		savedNext, err := h.saveTask(ctx, userID, *next, "upsert")
		if err != nil {
			return nil, err
		}
		result["nextOccurrence"] = savedNext
	}
	return result, nil
}

// parseMCPRecurrence reads the recurrence argument (null clears it).
func parseMCPRecurrence(raw json.RawMessage) (*tasks.TaskRecurrence, error) {
	if strings.TrimSpace(string(raw)) == "null" {
		return nil, nil
	}
	var input struct {
		Interval      *int    `json:"interval"`
		Unit          string  `json:"unit"`
		DaysOfWeek    []int   `json:"days_of_week"`
		DaysOfWeekAlt []int   `json:"daysOfWeek"`
		Basis         string  `json:"basis"`
		Until         *string `json:"until"`
	}
	if err := decodeArgs(raw, &input); err != nil {
		return nil, errors.New("invalid recurrence: expected {interval, unit, days_of_week, basis, until} or null")
	}
	rule := &tasks.TaskRecurrence{Interval: 1, Unit: input.Unit, DaysOfWeek: input.DaysOfWeek, Basis: input.Basis, Until: input.Until}
	if input.Interval != nil {
		rule.Interval = *input.Interval
	}
	if len(rule.DaysOfWeek) == 0 {
		rule.DaysOfWeek = input.DaysOfWeekAlt
	}
	normalized, err := tasks.NormalizeRecurrence(rule)
	if err != nil {
		return nil, err
	}
	return normalized, nil
}

func (h *mcpHandler) saveHabit(ctx context.Context, userID uuid.UUID, habit tasks.Habit) (tasks.Habit, error) {
	now := h.now().UTC()
	if habit.CreatedAt.IsZero() {
		habit.CreatedAt = now
	}
	habit.UpdatedAt = now
	_, saved, err := h.backend.applyMutation(ctx, userID, tasks.Mutation{
		ID: uuid.NewString(), Kind: "upsert", Entity: "habit", Habit: habit, CreatedAt: now.Format(time.RFC3339Nano),
	})
	return saved, err
}

func (h *mcpHandler) createHabit(ctx context.Context, userID uuid.UUID, args json.RawMessage) (any, error) {
	var input struct {
		Title      string  `json:"title"`
		Interval   int     `json:"interval"`
		Unit       string  `json:"unit"`
		DaysOfWeek []int   `json:"days_of_week"`
		TimeOfDay  *string `json:"time_of_day"`
		StartDate  string  `json:"start_date"`
		Important  bool    `json:"important"`
		Urgent     bool    `json:"urgent"`
	}
	if err := decodeArgs(args, &input); err != nil {
		return nil, err
	}
	habit := tasks.Habit{
		ID: uuid.NewString(), Title: strings.TrimSpace(input.Title), Interval: input.Interval, Unit: input.Unit,
		DaysOfWeek: input.DaysOfWeek, TimeOfDay: input.TimeOfDay, StartDate: input.StartDate,
		Important: input.Important, Urgent: input.Urgent, CompletedDates: []string{},
	}
	if habit.Title == "" {
		return nil, errors.New("title is required")
	}
	if habit.Interval == 0 {
		habit.Interval = 1
	}
	if habit.Unit == "" {
		habit.Unit = "day"
	}
	if habit.DaysOfWeek == nil {
		habit.DaysOfWeek = []int{}
	}
	if habit.StartDate == "" {
		habit.StartDate = h.now().UTC().Format("2006-01-02")
	}
	return h.saveHabit(ctx, userID, habit)
}

func (h *mcpHandler) completeHabit(ctx context.Context, userID uuid.UUID, args json.RawMessage) (any, error) {
	var input struct {
		ID        string `json:"id"`
		Date      string `json:"date"`
		Completed *bool  `json:"completed"`
	}
	if err := decodeArgs(args, &input); err != nil {
		return nil, err
	}
	date := strings.TrimSpace(input.Date)
	if date == "" {
		date = h.now().UTC().Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return nil, errors.New("date must be YYYY-MM-DD")
	}
	habits, err := h.backend.currentHabits(ctx, userID)
	if err != nil {
		return nil, err
	}
	for _, habit := range habits {
		if !strings.EqualFold(habit.ID, strings.TrimSpace(input.ID)) {
			continue
		}
		dates := make([]string, 0, len(habit.CompletedDates)+1)
		for _, existing := range habit.CompletedDates {
			if existing != date {
				dates = append(dates, existing)
			}
		}
		if input.Completed == nil || *input.Completed {
			dates = append(dates, date)
		}
		sort.Strings(dates)
		habit.CompletedDates = dates
		return h.saveHabit(ctx, userID, habit)
	}
	return nil, fmt.Errorf("habit %s not found", input.ID)
}
