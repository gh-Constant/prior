package httpapi

import (
	"net/http"
	"net/http/httptest"
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
