package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuthExchangePreflight(t *testing.T) {
	server := &Server{}
	handler := server.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("preflight must not reach the authentication handler")
	}))
	for _, origin := range []string{
		"tauri://localhost",
		"http://tauri.localhost",
		"https://tauri.localhost",
		"http://localhost:1420",
		"https://app.prior.constantsuchet.fr",
	} {
		t.Run(origin, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodOptions, "/v1/auth/exchange", nil)
			request.Header.Set("Origin", origin)
			request.Header.Set("Access-Control-Request-Method", "POST")
			request.Header.Set("Access-Control-Request-Headers", "content-type")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != origin {
				t.Fatalf("native/web OAuth preflight rejected: status %d, headers %v", response.Code, response.Header())
			}
			if response.Header().Get("Access-Control-Allow-Methods") != "GET, POST, PATCH, DELETE, OPTIONS" || response.Header().Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" {
				t.Fatal("preflight does not permit the JSON code exchange")
			}
		})
	}
}

func TestRejectUntrustedOrigins(t *testing.T) {
	for _, origin := range []string{"null", "", "tauri://evil", "tauri://localhost.evil.example", "https://evil.example", "https://app.prior.constantsuchet.fr.evil.example"} {
		if allowedOrigin(origin) {
			t.Errorf("unexpectedly allowed origin %q", origin)
		}
	}
}

func TestCustomScheme(t *testing.T) {
	if !isCustomScheme("prior://auth/callback?code=123") {
		t.Error("expected prior:// scheme to be detected as custom scheme")
	}
	if isCustomScheme("https://app.prior.constantsuchet.fr/auth/callback") {
		t.Error("expected https:// not to be custom scheme")
	}
	if isCustomScheme("http://localhost:1420/auth/callback") {
		t.Error("expected http:// not to be custom scheme")
	}
}

func TestRenderAuthCallbackPage(t *testing.T) {
	t.Run("success page", func(t *testing.T) {
		w := httptest.NewRecorder()
		renderAuthCallbackPage(w, true, "prior://auth/callback?code=test-code")
		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", w.Code)
		}
		if contentType := w.Header().Get("Content-Type"); !strings.Contains(contentType, "text/html") {
			t.Fatalf("expected text/html content type, got %s", contentType)
		}
		body := w.Body.String()
		if !strings.Contains(body, "Welcome to Prior") ||
			!strings.Contains(body, "Google sign-in complete") ||
			!strings.Contains(body, "You're in.") ||
			!strings.Contains(body, "Open Prior") ||
			!strings.Contains(body, "coral-ribbon") {
			t.Fatalf("body missing success messages: %s", body)
		}
		if !strings.Contains(body, "prior://auth/callback?code=test-code") {
			t.Fatalf("body missing target url: %s", body)
		}
	})

	t.Run("error page", func(t *testing.T) {
		w := httptest.NewRecorder()
		renderAuthCallbackPage(w, false, "prior://auth/callback?error=auth_failed")
		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", w.Code)
		}
		body := w.Body.String()
		if !strings.Contains(body, "Sign-in interrupted") ||
			!strings.Contains(body, "Let's try that again.") ||
			!strings.Contains(body, "Return to Prior") {
			t.Fatalf("body missing error message: %s", body)
		}
	})
}

func TestGoogleNativeRequiresToken(t *testing.T) {
	server := &Server{limiter: newRateLimiter(20, time.Minute)}
	for _, body := range []string{`{}`, `{"id_token":""}`, `not-json`} {
		request := httptest.NewRequest(http.MethodPost, "/v1/auth/google/native", strings.NewReader(body))
		response := httptest.NewRecorder()
		server.googleNative(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %q: expected status 400, got %d", body, response.Code)
		}
	}
}

func TestUnauthorizedShape(t *testing.T) {
	w := httptest.NewRecorder()
	writeUnauthorized(w, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, `"code":"UNAUTHENTICATED"`) {
		t.Fatalf("401 body must carry code UNAUTHENTICATED, got %s", body)
	}
}

func TestDecodeJSONStrictness(t *testing.T) {
	// Sync payloads ignore unknown fields for forward compatibility.
	var lenient struct {
		Mutations []string `json:"mutations"`
	}
	lenientRequest := httptest.NewRequest(http.MethodPost, "/v1/sync/push", strings.NewReader(`{"mutations":[],"futureField":1}`))
	if err := decodeJSON(lenientRequest, &lenient); err != nil {
		t.Fatalf("lenient decode must ignore unknown fields: %v", err)
	}
	// Auth payloads stay strict so typos fail loudly.
	var strict struct {
		Email string `json:"email"`
	}
	strictRequest := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader(`{"email":"a@b.c","pasword":"x"}`))
	if err := decodeJSONStrict(strictRequest, &strict); err == nil {
		t.Fatal("strict decode must reject unknown fields on auth payloads")
	}
}

func TestCustomSchemeExactAllowlist(t *testing.T) {
	for _, candidate := range []string{
		"prior://evil/callback?code=123",
		"prior://auth/other?code=123",
		"prior://auth/callback.evil?code=123",
		"javascript:alert(1)",
		"not a url",
	} {
		if isCustomScheme(candidate) {
			t.Errorf("isCustomScheme(%q) must be false", candidate)
		}
	}
}

func TestNormalizeDevicePlatformCaps(t *testing.T) {
	device, platform, err := normalizeDevicePlatform(" Prior ", " web ")
	if err != nil || device != "Prior" || platform != "web" {
		t.Fatalf("expected trimmed values, got %q %q err %v", device, platform, err)
	}
	if _, _, err := normalizeDevicePlatform(strings.Repeat("x", 121), "web"); err == nil {
		t.Fatal("overlong device must be rejected")
	}
	if _, _, err := normalizeDevicePlatform("Prior", strings.Repeat("y", 121)); err == nil {
		t.Fatal("overlong platform must be rejected")
	}
}

func TestAgentProxyAllowlistAndRedaction(t *testing.T) {
	for _, model := range []string{"openrouter/free", "deepseek/deepseek-r1:free", "some-vendor/some-model:free"} {
		if !agentModelAllowed(model) {
			t.Errorf("model %q must be allowlisted", model)
		}
	}
	for _, model := range []string{"", "openai/gpt-4o", "anthropic/claude-sonnet-4"} {
		if agentModelAllowed(model) {
			t.Errorf("model %q must not be allowlisted", model)
		}
	}
	redacted := redactPII("contact me at jane.doe@example.com please")
	if strings.Contains(redacted, "jane.doe@example.com") || !strings.Contains(redacted, "[redacted-email]") {
		t.Fatalf("PII redaction failed: %q", redacted)
	}
}

func TestNormalizeReasoningEffort(t *testing.T) {
	for _, effort := range []string{"low", "medium", "high", "xhigh", "minimal", "none", " HIGH "} {
		if got := normalizeReasoningEffort(effort); got == "" {
			t.Errorf("effort %q must be forwarded", effort)
		}
	}
	for _, effort := range []string{"", "auto", "ultra", "max"} {
		if got := normalizeReasoningEffort(effort); got != "" {
			t.Errorf("effort %q must fall back to the provider default, got %q", effort, got)
		}
	}
}
