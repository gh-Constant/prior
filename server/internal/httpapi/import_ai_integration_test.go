package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/billing"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AI import goes through /v1/agent/complete with purpose "import". It must
// refuse free accounts with 402 (even with their own OpenRouter key), serve
// Pro accounts with the import model, and count toward hosted usage.
func TestAgentCompleteImportIsProOnlyPostgres(t *testing.T) {
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
	schema := "import_ai_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	var mu sync.Mutex
	var upstreamModels []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		mu.Lock()
		upstreamModels = append(upstreamModels, payload.Model)
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   payload.Model,
			"choices": []any{map[string]any{"message": map[string]any{"content": `{"tasks":[]}`}}},
			"usage":   map[string]any{"total_tokens": 42},
		})
	}))
	defer upstream.Close()

	cfg := config.Config{HostedAI: config.HostedAIConfig{
		APIKey: "operator-key", BaseURL: upstream.URL, AgentModel: "agent/model", MailModel: "mail/model", ImportModel: "import/model",
		DailyRequestsPerUser: 300,
	}}
	srv := New(cfg, pool)
	handler := srv.Handler()

	newUser := func(email string) (uuid.UUID, string) {
		user, err := srv.store.CreatePasswordUser(ctx, email, "x", strings.Split(email, "@")[0])
		if err != nil {
			t.Fatal(err)
		}
		token := uuid.NewString()
		if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
			t.Fatal(err)
		}
		return user.ID, token
	}
	_, free := newUser("free@example.com")
	proID, pro := newUser("pro@example.com")
	plan := billing.PlanPro
	if err := srv.store.SetAdminPlan(ctx, proID, &plan, "test"); err != nil {
		t.Fatal(err)
	}

	complete := func(token, body string) (int, map[string]any) {
		request := httptest.NewRequest(http.MethodPost, "/v1/agent/complete", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		var decoded map[string]any
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
		return response.Code, decoded
	}
	importBody := `{"model":"","prompt":"rows","system":"s","history":[],"webSearch":false,"purpose":"import","json":true,"provider":"hosted"}`

	// Free account: refused, with or without asking for Prior AI explicitly.
	for _, body := range []string{importBody, strings.Replace(importBody, `,"provider":"hosted"`, "", 1)} {
		if code, decoded := complete(free, body); code != http.StatusPaymentRequired || decoded["code"] != "HOSTED_AI_REQUIRES_PLAN" {
			t.Fatalf("free account import = %d %v; want 402 HOSTED_AI_REQUIRES_PLAN", code, decoded)
		}
	}
	mu.Lock()
	if len(upstreamModels) != 0 {
		t.Fatalf("a refused import must not reach the provider, got %v", upstreamModels)
	}
	mu.Unlock()

	// Pro account: served by Prior AI with the import model.
	code, decoded := complete(pro, importBody)
	if code != http.StatusOK || decoded["provider"] != "hosted" || decoded["content"] != `{"tasks":[]}` {
		t.Fatalf("pro account import = %d %v", code, decoded)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(upstreamModels) != 1 || upstreamModels[0] != "import/model" {
		t.Fatalf("the import model must be used, got %v", upstreamModels)
	}
	tokens, err := srv.store.HostedAITokensSince(ctx, proID, time.Now().Add(-time.Hour), "import")
	if err != nil || tokens != 42 {
		t.Fatalf("import usage must be recorded under its own purpose: %d, %v", tokens, err)
	}
}
