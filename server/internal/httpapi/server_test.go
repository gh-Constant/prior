package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
			if response.Header().Get("Access-Control-Allow-Methods") != "GET, POST, OPTIONS" || response.Header().Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" {
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
