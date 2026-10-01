package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

func TestNormalizeAgentPurpose(t *testing.T) {
	for input, want := range map[string]string{"": "agent", "agent": "agent", " Mail ": "mail", "recommendations": "recommendations", "calendar": "calendar", "import": "import"} {
		got, ok := normalizeAgentPurpose(input)
		if !ok || got != want {
			t.Fatalf("normalizeAgentPurpose(%q) = %q, %v; want %q", input, got, ok, want)
		}
	}
	if _, ok := normalizeAgentPurpose("billing"); ok {
		t.Fatal("unknown purposes must be rejected")
	}
}

func TestHostedModelForFallsBackToAgentModel(t *testing.T) {
	cfg := config.HostedAIConfig{AgentModel: "agent/model", MailModel: "mail/model"}
	if got := cfg.ModelFor("mail"); got != "mail/model" {
		t.Fatalf("mail model = %q", got)
	}
	if got := cfg.ModelFor("recommendations"); got != "agent/model" {
		t.Fatalf("recommendations model should fall back to the agent model, got %q", got)
	}
	if got := cfg.ModelFor("agent"); got != "agent/model" {
		t.Fatalf("agent model = %q", got)
	}
}

func TestImportModelFallsBackToMailThenAgent(t *testing.T) {
	cfg := config.HostedAIConfig{AgentModel: "agent/model", MailModel: "mail/model"}
	if got := cfg.ModelFor("import"); got != "mail/model" {
		t.Fatalf("import model should default to the mail model, got %q", got)
	}
	cfg.ImportModel = "import/model"
	if got := cfg.ModelFor("import"); got != "import/model" {
		t.Fatalf("import model = %q", got)
	}
	if got := (config.HostedAIConfig{AgentModel: "agent/model"}).ModelFor("import"); got != "agent/model" {
		t.Fatalf("import model should end at the agent model, got %q", got)
	}
}

// AI import is Pro-only: it always runs on Prior AI, whatever the request
// asks for, so neither a missing plan nor a personal OpenRouter key opens it.
func TestImportPurposeIsHostedAndNeedsAPlan(t *testing.T) {
	server := &Server{cfg: config.Config{HostedAI: config.HostedAIConfig{
		APIKey: "operator-key", BaseURL: "https://ai.example.test", AgentModel: "agent/model", MailModel: "mail/model", ImportModel: "import/model",
		AllowedEmails: []string{"pro@example.com"},
	}}}
	request := httptest.NewRequest(http.MethodPost, "/v1/agent/complete", nil)

	for _, wantHosted := range []bool{false, true} {
		route, status, err := server.resolveCompletionRoute(request, store.User{Email: "free@example.com"}, "import", "", wantHosted)
		if err == nil || status != http.StatusPaymentRequired {
			t.Fatalf("a free user must get 402 for import (wantHosted=%v), got status %d err %v", wantHosted, status, err)
		}
		if route.hosted {
			t.Fatal("a refused request must not carry a route")
		}
		route, status, err = server.resolveCompletionRoute(request, store.User{Email: "pro@example.com"}, "import", "", wantHosted)
		if err != nil || status != 0 || !route.hosted || route.model != "import/model" || route.apiKey != "operator-key" {
			t.Fatalf("an entitled user gets Prior AI with the import model (wantHosted=%v), got %#v status %d err %v", wantHosted, route, status, err)
		}
	}
}

func TestHostedUsageEnforcesDailyLimit(t *testing.T) {
	usage := newHostedUsage(2)
	now := time.Date(2026, 9, 29, 23, 0, 0, 0, time.UTC)
	usage.now = func() time.Time { return now }
	user := uuid.New()
	other := uuid.New()
	if !usage.take(user) || !usage.take(user) {
		t.Fatal("first two requests must be allowed")
	}
	if usage.take(user) {
		t.Fatal("third request must be refused")
	}
	if !usage.take(other) {
		t.Fatal("limits are per user")
	}
	if got := usage.used(user); got != 2 {
		t.Fatalf("used = %d", got)
	}
	now = now.Add(2 * time.Hour)
	if usage.used(user) != 0 || !usage.take(user) {
		t.Fatal("the counter must reset on the next UTC day")
	}
	usage.sweep()
	if _, ok := usage.counts[other]; ok {
		t.Fatal("sweep must drop previous days")
	}
}

func TestHostedUsageWithoutLimit(t *testing.T) {
	usage := newHostedUsage(0)
	user := uuid.New()
	for range 1000 {
		if !usage.take(user) {
			t.Fatal("a non-positive limit disables the cap")
		}
	}
}

func TestCompletionPayloadForHostedRoute(t *testing.T) {
	route := hostedCompletionRoute(config.HostedAIConfig{
		APIKey:         " key ",
		BaseURL:        "https://example.test/api/v1",
		AgentModel:     "primary/model",
		FallbackModels: []string{"primary/model", "backup/model"},
	}, "agent")
	if route.url != "https://example.test/api/v1/chat/completions" || route.apiKey != "key" || !route.hosted {
		t.Fatalf("unexpected route: %#v", route)
	}
	payload := completionPayload(route, []map[string]string{{"role": "user", "content": "hi"}}, true, "", true)
	if usage, _ := payload["usage"].(map[string]bool); !usage["include"] {
		t.Fatal("hosted requests ask OpenRouter for their cost")
	}
	models, _ := payload["models"].([]string)
	if strings.Join(models, ",") != "primary/model,backup/model" {
		t.Fatalf("fallback models = %v", models)
	}
	if _, ok := payload["tools"]; ok {
		t.Fatal("hosted requests never enable paid web search")
	}
	if format, _ := payload["response_format"].(map[string]string); format["type"] != "json_object" {
		t.Fatalf("response_format = %#v", payload["response_format"])
	}
}

func TestCompletionPayloadForUserRoute(t *testing.T) {
	route := completionRoute{url: "https://openrouter.test", apiKey: "k", model: "openrouter/free", fallbacks: []string{"ignored/model"}}
	payload := completionPayload(route, nil, true, "low", false)
	if _, ok := payload["models"]; ok {
		t.Fatal("user routes keep the model the user picked")
	}
	if _, ok := payload["tools"]; !ok {
		t.Fatal("user routes keep web search")
	}
	if _, ok := payload["response_format"]; ok {
		t.Fatal("response_format is only sent when requested")
	}
}

func TestRequestChatCompletion(t *testing.T) {
	var gotAuth string
	var gotBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"model":"primary/model-2026","usage":{"total_tokens":1234,"cost":0.0021},"choices":[{"message":{"content":[{"type":"text","text":"{\"reply\":"},{"type":"text","text":"\"ok\"}"}]}}]}`))
	}))
	defer upstream.Close()
	server := &Server{completionClient: upstream.Client()}
	route := completionRoute{hosted: true, url: upstream.URL, apiKey: "secret", model: "primary/model"}
	result, err := server.requestChatCompletion(context.Background(), route, map[string]any{"model": route.model})
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if result.content != `{"reply":"ok"}` || result.model != "primary/model-2026" || result.totalTokens != 1234 || result.costMicros != 2100 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if gotAuth != "Bearer secret" || gotBody["model"] != "primary/model" {
		t.Fatalf("auth=%q body=%v", gotAuth, gotBody)
	}
}

func TestRequestChatCompletionHidesUpstreamErrors(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"invalid key sk-or-secret"}`, http.StatusUnauthorized)
	}))
	defer upstream.Close()
	server := &Server{completionClient: upstream.Client()}
	_, err := server.requestChatCompletion(context.Background(), completionRoute{url: upstream.URL, apiKey: "sk-or-secret"}, map[string]any{})
	if err == nil || strings.Contains(err.Error(), "sk-or") {
		t.Fatalf("expected a sanitized error, got %v", err)
	}
}

func TestUserModelAllowed(t *testing.T) {
	if userModelAllowed("agent", "openai/gpt-5") {
		t.Fatal("general chat on user keys stays free-only")
	}
	if !userModelAllowed("agent", "openrouter/free") || !userModelAllowed("mail", "openai/gpt-5-mini") {
		t.Fatal("free chat models and explicit draft models must be accepted")
	}
	if userModelAllowed("mail", "not a model") {
		t.Fatal("malformed model IDs must be rejected")
	}
}

func TestHostedReasoningEffortPerPurpose(t *testing.T) {
	cfg := config.HostedAIConfig{DraftReasoningEffort: "low"}
	if cfg.ReasoningEffortFor("agent") != "" || cfg.ReasoningEffortFor("mail") != "low" || cfg.ReasoningEffortFor("recommendations") != "low" {
		t.Fatal("drafts use the draft effort and the agent keeps the provider default")
	}
}

func TestHostedAIEntitlementDefaultsToAllowlist(t *testing.T) {
	server := &Server{cfg: config.Config{HostedAI: config.HostedAIConfig{AllowedEmails: []string{" Owner@Example.com "}}}}
	if got := server.hostedAIEntitlement(context.Background(), store.User{Email: "owner@example.com"}); !got.Allowed || got.AgentTokensPerMonth != 0 {
		t.Fatalf("allowlisted users get unlimited Prior AI, got %#v", got)
	}
	if got := server.hostedAIEntitlement(context.Background(), store.User{Email: "someone@example.com"}); got.Allowed {
		t.Fatal("users without a plan must not get Prior AI")
	}
	if got := server.hostedAIEntitlement(context.Background(), store.User{}); got.Allowed {
		t.Fatal("an empty email never matches")
	}
}

func TestWriteHostedAIErrorCodes(t *testing.T) {
	for status, code := range map[int]string{http.StatusPaymentRequired: "HOSTED_AI_REQUIRES_PLAN", http.StatusTooManyRequests: "HOSTED_AI_QUOTA"} {
		recorder := httptest.NewRecorder()
		writeHostedAIError(recorder, status, errHostedAIRequiresPlan)
		var body map[string]string
		_ = json.NewDecoder(recorder.Body).Decode(&body)
		if recorder.Code != status || body["code"] != code {
			t.Fatalf("status %d: got %d %#v", status, recorder.Code, body)
		}
	}
}

func TestMonthStart(t *testing.T) {
	got := monthStart(time.Date(2026, 9, 29, 23, 30, 0, 0, time.FixedZone("x", -5*3600)))
	if !got.Equal(time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -29)) {
		t.Fatalf("monthStart = %v", got)
	}
}
