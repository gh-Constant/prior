package httpapi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Recurrence syncs like the other task fields: validated, returned by pull,
// kept when an older client omits it, cleared by an explicit null.
func TestTaskRecurrencePostgres(t *testing.T) {
	url := os.Getenv("PRIOR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set PRIOR_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx := context.Background()
	adminPool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer adminPool.Close()
	schema := "recur_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := adminPool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer adminPool.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	poolConfig, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	srv := New(config.Config{}, pool)
	handler := srv.Handler()
	user, err := srv.store.CreatePasswordUser(ctx, "recur@example.com", "x", "recur")
	if err != nil {
		t.Fatal(err)
	}
	token := uuid.NewString()
	if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string) (int, map[string]any) {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		var decoded map[string]any
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
		return response.Code, decoded
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	taskID := uuid.NewString()
	push := func(extra string, completed bool) map[string]any {
		status := "next"
		if completed {
			status = "done"
		}
		stamp := time.Now().UTC().Format(time.RFC3339Nano)
		task := `{"id":"` + taskID + `","title":"Water plants","description":"","priority":4,"status":"` + status + `","dueDate":"2026-10-01","assigneeName":"","completed":` + map[bool]string{true: "true", false: "false"}[completed] + `,"important":false,"urgent":false,"createdAt":"` + now + `","updatedAt":"` + stamp + `","deletedAt":null` + extra + `}`
		code, body := call("POST", "/v1/sync/push", `{"mutations":[{"id":"`+uuid.NewString()+`","kind":"upsert","entity":"task","task":`+task+`,"createdAt":"`+now+`"}]}`)
		if code != 200 {
			t.Fatalf("push = %d %v", code, body)
		}
		return body["results"].([]any)[0].(map[string]any)
	}
	stored := func() string {
		var raw *string
		if err := pool.QueryRow(ctx, `SELECT recurrence::text FROM tasks WHERE id = $1`, taskID).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		if raw == nil {
			return "NULL"
		}
		return *raw
	}

	if result := push(`,"recurrence":{"interval":2,"unit":"week","daysOfWeek":[4,1,4],"basis":"completion","until":"2026-12-31"}`, false); result["ok"] != true {
		t.Fatalf("push with a rule = %v", result)
	}
	var rule map[string]any
	if err := json.Unmarshal([]byte(stored()), &rule); err != nil {
		t.Fatalf("stored rule %q: %v", stored(), err)
	}
	days := rule["daysOfWeek"].([]any)
	if rule["interval"] != float64(2) || rule["basis"] != "completion" || len(days) != 2 || days[0] != float64(1) {
		t.Fatalf("stored rule is the canonical form: %v", rule)
	}

	for _, bad := range []string{
		`,"recurrence":{"interval":0,"unit":"day"}`,
		`,"recurrence":{"interval":1,"unit":"hour"}`,
		`,"recurrence":{"interval":1,"unit":"week","daysOfWeek":[8]}`,
	} {
		if result := push(bad, false); result["ok"] == true {
			t.Fatalf("%s must be refused: %v", bad, result)
		}
	}

	// An older client (no recurrence key) edits the task: the rule stays.
	if result := push("", false); result["ok"] != true {
		t.Fatalf("old client push = %v", result)
	}
	if !strings.Contains(stored(), `"interval": 2`) {
		t.Fatalf("an omitted recurrence must keep the stored rule, got %s", stored())
	}

	code, pulled := call("GET", "/v1/sync/pull?since=0", "")
	if code != 200 {
		t.Fatalf("pull = %d", code)
	}
	found := false
	for _, raw := range pulled["tasks"].([]any) {
		item := raw.(map[string]any)
		if item["id"] == taskID {
			if recurrence, ok := item["recurrence"].(map[string]any); ok && recurrence["interval"] == float64(2) && recurrence["unit"] == "week" {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("pull lacks the recurrence: %v", pulled["tasks"])
	}

	// An explicit null (the app completed the task and spawned the next one) clears it.
	if result := push(`,"recurrence":null`, true); result["ok"] != true {
		t.Fatalf("clearing push = %v", result)
	}
	if got := stored(); got != "NULL" {
		t.Fatalf("null must clear the rule, got %s", got)
	}
	var changeRules int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM task_changes WHERE task_id = $1 AND recurrence IS NOT NULL`, taskID).Scan(&changeRules); err != nil || changeRules < 1 {
		t.Fatalf("task-change snapshots carry the rule: %d %v", changeRules, err)
	}

}

func TestRecurrenceText(t *testing.T) {
	until := "2026-12-31"
	if got := recurrenceText(nil); got != "" {
		t.Fatalf("no rule = %q", got)
	}
	if got := recurrenceText(&tasks.TaskRecurrence{Interval: 1, Unit: "day"}); got != "every 1 day" {
		t.Fatalf("daily = %q", got)
	}
	if got := recurrenceText(&tasks.TaskRecurrence{Interval: 2, Unit: "week", DaysOfWeek: []int{1, 4}, Basis: "completion", Until: &until}); got != "every 2 weeks on weekdays 1,4 from completion until 2026-12-31" {
		t.Fatalf("weekly = %q", got)
	}
}
