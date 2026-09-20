package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"log/slog"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/gh-Constant/prior/server/internal/auth"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/gh-Constant/prior/server/internal/workspace"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	cfg                    config.Config
	pool                   *pgxpool.Pool
	store                  *store.Store
	auth                   *auth.Manager
	hub                    *hub
	limiter                *rateLimiter
	pushLimiter            *rateLimiter
	pullLimiter            *rateLimiter
	workspaceLimiter       *rateLimiter
	transcribeLimiter      *rateLimiter
	agentLimiter           *rateLimiter
	settingsLimiter        *rateLimiter
	openAIClient           *http.Client
	openAITranscriptionURL string
}

func New(cfg config.Config, pool *pgxpool.Pool) *Server {
	database := store.New(pool)
	perMinute := func(value, fallback int) *rateLimiter {
		if value <= 0 {
			value = fallback
		}
		return newRateLimiter(value, time.Minute)
	}
	return &Server{
		cfg:                    cfg,
		pool:                   pool,
		store:                  database,
		auth:                   auth.NewManager(cfg, database),
		hub:                    newHub(),
		limiter:                newRateLimiter(firstPositive(cfg.RateLimitAuth, 20), 10*time.Minute),
		pushLimiter:            perMinute(cfg.RateLimitPush, 60),
		pullLimiter:            perMinute(cfg.RateLimitPull, 120),
		workspaceLimiter:       perMinute(cfg.RateLimitWorkspace, 30),
		transcribeLimiter:      perMinute(cfg.RateLimitTranscribe, 10),
		agentLimiter:           perMinute(cfg.RateLimitAgent, 60),
		settingsLimiter:        perMinute(cfg.RateLimitSettings, 60),
		openAIClient:           &http.Client{Timeout: 2 * time.Minute},
		openAITranscriptionURL: "https://api.openai.com/v1/audio/transcriptions",
	}
}

func firstPositive(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func (s *Server) CleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	// Nightly retention runs at most once per 24h; the 5-minute tick also
	// sweeps rate-limiter buckets so the in-memory map cannot grow unbounded.
	var lastRetention time.Time
	for {
		select {
		case <-ticker.C:
			s.auth.Cleanup()
			s.sweepLimiters()
			if time.Since(lastRetention) >= 24*time.Hour {
				retentionCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
				if err := s.store.CleanupRetention(retentionCtx, s.cfg.RetentionMutationsDays, s.cfg.RetentionSessionsDays); err != nil {
					slog.Warn("retention cleanup failed", "error", err)
				} else {
					lastRetention = time.Now()
				}
				cancel()
			}
		case <-ctx.Done():
			return
		}
	}
}

func (s *Server) sweepLimiters() {
	for _, limiter := range []*rateLimiter{s.limiter, s.pushLimiter, s.pullLimiter, s.workspaceLimiter, s.transcribeLimiter, s.agentLimiter, s.settingsLimiter} {
		if limiter != nil {
			limiter.sweep()
		}
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /ready", s.ready)
	mux.HandleFunc("GET /auth/google/start", s.googleStart)
	mux.HandleFunc("GET /auth/google/callback", s.googleCallback)
	mux.HandleFunc("POST /v1/auth/register", s.register)
	mux.HandleFunc("POST /v1/auth/login", s.login)
	mux.HandleFunc("POST /v1/auth/exchange", s.exchange)
	mux.HandleFunc("POST /v1/auth/google/native", s.googleNative)
	mux.HandleFunc("POST /v1/auth/logout", s.logout)
	mux.HandleFunc("POST /v1/auth/password/set", s.setPassword)
	mux.HandleFunc("POST /v1/auth/password/change", s.changePassword)
	mux.HandleFunc("GET /v1/me", s.me)
	mux.HandleFunc("PATCH /v1/me", s.updateMe)
	mux.HandleFunc("POST /transcribe", s.transcribe)
	mux.HandleFunc("GET /v1/settings", s.getSettings)
	mux.HandleFunc("POST /v1/settings", s.saveSettings)
	mux.HandleFunc("GET /v1/agent/chats", s.listAgentChats)
	mux.HandleFunc("POST /v1/agent/chats", s.createAgentChat)
	mux.HandleFunc("GET /v1/agent/chats/{chatID}", s.getAgentChat)
	mux.HandleFunc("POST /v1/agent/chats/{chatID}/messages", s.saveAgentChatMessage)
	mux.HandleFunc("POST /v1/agent/complete", s.agentComplete)
	mux.HandleFunc("GET /v1/sessions", s.listSessions)
	mux.HandleFunc("DELETE /v1/sessions", s.revokeAllSessions)
	mux.HandleFunc("DELETE /v1/sessions/{id}", s.revokeSession)
	mux.HandleFunc("GET /v1/mail/connect/start", s.mailConnectStart)
	mux.HandleFunc("GET /v1/mail/google/callback", s.mailGoogleCallback)
	mux.HandleFunc("GET /v1/mail/accounts", s.mailAccounts)
	mux.HandleFunc("GET /v1/mail/token", s.mailToken)
	mux.HandleFunc("DELETE /v1/mail/accounts/{id}", s.mailDisconnect)
	mux.HandleFunc("GET /v1/calendar/connect/start", s.calendarConnectStart)
	mux.HandleFunc("GET /v1/calendar/google/callback", s.calendarGoogleCallback)
	mux.HandleFunc("GET /v1/calendar/accounts", s.calendarAccounts)
	mux.HandleFunc("GET /v1/calendar/token", s.calendarToken)
	mux.HandleFunc("DELETE /v1/calendar/accounts/{id}", s.calendarDisconnect)
	mux.HandleFunc("GET /metrics", s.metrics)
	mux.HandleFunc("POST /v1/sync/push", s.push)
	mux.HandleFunc("GET /v1/sync/pull", s.pull)
	mux.HandleFunc("POST /v1/workspace/sync", s.syncWorkspace)
	mux.HandleFunc("GET /v1/collaboration/projects", s.collaborationProjects)
	mux.HandleFunc("PATCH /v1/collaboration/projects/{projectID}", s.updateCollaborativeProject)
	mux.HandleFunc("GET /v1/collaboration/projects/{projectID}/members", s.collaborationProjectMembers)
	mux.HandleFunc("POST /v1/collaboration/projects/{projectID}/members", s.shareProject)
	mux.HandleFunc("PATCH /v1/collaboration/projects/{projectID}/members/{userID}", s.updateProjectMember)
	mux.HandleFunc("DELETE /v1/collaboration/projects/{projectID}/members/{userID}", s.removeProjectMember)
	mux.HandleFunc("DELETE /v1/collaboration/projects/{projectID}/invites/{inviteID}", s.revokeProjectInvite)
	mux.HandleFunc("POST /v1/collaboration/invites/accept", s.acceptProjectInvite)
	mux.HandleFunc("GET /v1/realtime", s.realtime)
	return s.middleware(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if err := s.pool.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) googleStart(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	location, err := s.auth.Start(r.Context(), r.URL.Query().Get("return_to"))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	http.Redirect(w, r, location, http.StatusFound)
}

func (s *Server) googleCallback(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many authentication attempts", http.StatusTooManyRequests)
		return
	}
	returnTo, err := s.auth.Callback(r.Context(), r.URL.Query().Get("code"), r.URL.Query().Get("state"))
	if err != nil {
		if returnTo == "" {
			http.Error(w, "authentication failed", http.StatusBadRequest)
			return
		}
		target := returnTo + "?error=auth_failed"
		if isCustomScheme(target) {
			renderAuthCallbackPage(w, false, target)
			return
		}
		http.Redirect(w, r, target, http.StatusFound)
		return
	}
	if isCustomScheme(returnTo) {
		renderAuthCallbackPage(w, true, returnTo)
		return
	}
	http.Redirect(w, r, returnTo, http.StatusFound)
}

// isCustomScheme reports whether candidate is the exact native return target
// (prior://auth/callback, optional query). Only allowlisted custom-scheme
// returns render the callback page; https App Links always 302 instead.
func isCustomScheme(candidate string) bool {
	parsed, err := url.Parse(candidate)
	if err != nil {
		return false
	}
	return parsed.Scheme == "prior" && parsed.Host == "auth" && parsed.Path == "/callback"
}

var authCallbackTmpl = template.Must(template.New("authCallback").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#20201f">
  <title>{{if .Success}}Welcome to Prior{{else}}Sign-in interrupted - Prior{{end}}</title>
  <style>
    :root {
      --bg: #20201f;
      --panel: #2a2825e8;
      --text: #f8f7f4;
      --muted: #a5a39e;
      --soft-muted: #c9c4bc;
      --accent: #fa654a;
      --accent-bright: #ff9670;
      --ink: #272522;
      --line: #ffffff1c;
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; background: var(--bg); }
    body {
      margin: 0;
      min-width: 320px;
      min-height: 100vh;
      color: var(--text);
      background: var(--bg);
      font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      position: relative;
      isolation: isolate;
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 32px 20px;
      overflow: hidden;
    }
    .coral-field {
      position: absolute;
      inset: -100px 0 -160px;
      z-index: -1;
      overflow: hidden;
      pointer-events: none;
    }
    .coral-field::before {
      content: "";
      position: absolute;
      inset: 20% 10% 0;
      background: radial-gradient(ellipse at 50% 80%, #f64c262b, transparent 60%);
    }
    .coral-ribbon {
      position: absolute;
      width: 1180px;
      height: 430px;
      top: 54%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-19deg);
      border-radius: 50%;
      background: conic-gradient(from 24deg, #542921, #ff9670 9%, #ff5838 24%, #862c20 35%, #20201f 45%, #20201f 53%, #743c2b 65%, #ffb394 76%, #fa654a 86%, #782f24);
      mask-image: radial-gradient(ellipse at center, transparent 51%, #000 51.5%, #000 67%, transparent 67.5%);
      filter: drop-shadow(0 20px 30px #0005);
      opacity: .74;
    }
    .coral-ribbon-edge {
      position: absolute;
      width: 1170px;
      height: 420px;
      top: 54%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-19deg);
      border: 1px solid #ff977438;
      border-radius: 50%;
      box-shadow: 0 0 60px #fa654a0b;
    }
    .coral-field::after {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at 50% 32%, #20201f00 10%, #20201f80 42%, transparent 70%), linear-gradient(0deg, #20201f, transparent 24%);
    }
    .auth-shell {
      display: flex;
      align-items: center;
      flex-direction: column;
      width: min(100%, 500px);
      gap: 24px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      color: var(--text);
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -.06em;
      text-decoration: none;
    }
    .brand-mark {
      width: 34px;
      height: 34px;
      object-fit: contain;
    }
    .panel {
      width: 100%;
      padding: 42px 40px 34px;
      text-align: center;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 28px 80px #0006, inset 0 1px #ffffff0c;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    .status-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 62px;
      height: 62px;
      margin-bottom: 26px;
      border-radius: 16px;
    }
    .status-mark.success {
      color: var(--ink);
      background: var(--accent);
      box-shadow: 0 12px 30px #fa654a3d;
    }
    .status-mark.error {
      color: var(--accent-bright);
      background: #fa654a16;
      border: 1px solid #fa654a66;
    }
    .status-mark svg {
      width: 30px;
      height: 30px;
    }
    .eyebrow {
      margin: 0 0 14px;
      color: var(--accent-bright);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .18em;
      line-height: 1.2;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      color: var(--text);
      font-size: clamp(42px, 9vw, 62px);
      font-weight: 500;
      letter-spacing: -.073em;
      line-height: .94;
    }
    .copy {
      max-width: 350px;
      margin: 18px auto 0;
      color: var(--soft-muted);
      font-size: 15px;
      line-height: 1.6;
    }
    .actions {
      display: grid;
      gap: 12px;
      margin-top: 30px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      gap: 14px;
      padding: 0 18px;
      color: var(--ink);
      background: var(--accent);
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: background .15s ease, transform .15s ease;
    }
    .btn:hover {
      background: var(--accent-bright);
      transform: translateY(-1px);
    }
    .btn:focus-visible {
      outline: 2px solid var(--accent-bright);
      outline-offset: 4px;
    }
    .arrow {
      font-size: 18px;
      font-weight: 400;
      line-height: 0;
    }
    .note,
    .footer-note {
      margin: 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }
    .footer-note {
      opacity: .74;
    }
    @media (max-width: 520px) {
      .page { padding: 24px 16px; }
      .auth-shell { gap: 20px; }
      .panel { padding: 34px 24px 28px; }
      .status-mark { margin-bottom: 22px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .btn { transition: none; }
      .btn:hover { transform: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="coral-field" aria-hidden="true">
      <div class="coral-ribbon"></div>
      <div class="coral-ribbon-edge"></div>
    </div>
    <main class="auth-shell">
      <a class="brand" href="https://prior.constantsuchet.fr/" aria-label="Prior home">
        <svg class="brand-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <rect width="64" height="64" rx="18" fill="#183D4E"/>
          <path d="M17 16h16.5c8.56 0 13.5 4.53 13.5 11.56 0 7.16-5.1 11.72-13.5 11.72H25v8.72h-8V16ZM25 22.82v11.64h7.83c3.62 0 5.99-2.02 5.99-5.86 0-3.78-2.37-5.78-5.99-5.78H25Z" fill="#F6F7F2"/>
          <path d="m39.75 42.5 6.25 6.25" stroke="#C5E86C" stroke-width="4.5" stroke-linecap="round"/>
        </svg>
        <span>Prior</span>
      </a>
      <section class="panel" aria-labelledby="auth-title">
        {{if .Success}}
          <div class="status-mark success" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m5 12.5 4.2 4.2L19 7"/>
            </svg>
          </div>
          <p class="eyebrow">Google sign-in complete</p>
          <h1 id="auth-title">You're in.</h1>
          <p class="copy">Your Prior account is connected. Return to the app and get back to what matters.</p>
          {{if .TargetURL}}
            <div class="actions">
              <a href="{{.TargetURL}}" class="btn">Open Prior <span class="arrow" aria-hidden="true">↗</span></a>
              <p class="note">Prior should open automatically. You can close this window.</p>
            </div>
          {{end}}
        {{else}}
          <div class="status-mark error" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>
            </svg>
          </div>
          <p class="eyebrow">Sign-in interrupted</p>
          <h1 id="auth-title">Let's try that again.</h1>
          <p class="copy">Google sign-in could not be completed. Return to Prior and try again.</p>
          {{if .TargetURL}}
            <div class="actions">
              <a href="{{.TargetURL}}" class="btn">Return to Prior <span class="arrow" aria-hidden="true">↗</span></a>
            </div>
          {{end}}
        {{end}}
      </section>
      <p class="footer-note">A clearer space for your tasks.</p>
    </main>
  </div>
  {{if and .Success .TargetURL}}
  <script>
    (function() {
      var target = "{{.TargetJS}}";
      if (!target || window.__priorRedirected) return;
      window.__priorRedirected = true;
      window.location.replace(target);
    })();
  </script>
  {{end}}
</body>
</html>`))

func renderAuthCallbackPage(w http.ResponseWriter, success bool, targetURL string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	// Callers gate targetURL through isCustomScheme (exact prior://auth/callback)
	// or validated https return_to, so marking it trusted here is safe and
	// prevents html/template from sanitizing it to #ZgotmplZ.
	_ = authCallbackTmpl.Execute(w, struct {
		Success   bool
		TargetURL template.URL
		TargetJS  template.JS
	}{
		Success:   success,
		TargetURL: template.URL(targetURL),
		TargetJS:  template.JS(targetURL),
	})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
		Device      string `json:"device"`
		Platform    string `json:"platform"`
	}
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid registration request"))
		return
	}
	device, platform, err := normalizeDevicePlatform(body.Device, body.Platform)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	token, user, err := s.auth.Register(r.Context(), body.Email, body.Password, body.DisplayName, device, platform)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, store.ErrEmailTaken) {
			status = http.StatusConflict
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "user": user})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Device   string `json:"device"`
		Platform string `json:"platform"`
	}
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid login request"))
		return
	}
	device, platform, err := normalizeDevicePlatform(body.Device, body.Platform)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	token, user, err := s.auth.Login(r.Context(), body.Email, body.Password, device, platform)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			writeUnauthorized(w, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) exchange(w http.ResponseWriter, r *http.Request) {
	var body struct{ Code, Device, Platform string }
	if err := decodeJSONStrict(r, &body); err != nil || body.Code == "" {
		writeError(w, http.StatusBadRequest, errors.New("code is required"))
		return
	}
	device, platform, err := normalizeDevicePlatform(body.Device, body.Platform)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	token, user, err := s.auth.Exchange(r.Context(), body.Code, device, platform)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) googleNative(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		IDToken  string `json:"id_token"`
		Device   string `json:"device"`
		Platform string `json:"platform"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.IDToken == "" {
		writeError(w, http.StatusBadRequest, errors.New("Google ID token is required"))
		return
	}
	device, platform, err := normalizeDevicePlatform(body.Device, body.Platform)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	token, user, err := s.auth.VerifyNativeIDToken(r.Context(), body.IDToken, device, platform)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireUser(r); err != nil {
		writeUnauthorized(w, err)
		return
	}
	if err := s.store.RevokeSession(r.Context(), bearer(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setPassword(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.NewPassword == "" {
		writeError(w, http.StatusBadRequest, errors.New("new password is required"))
		return
	}
	if err := s.auth.SetPassword(r.Context(), user.ID, body.CurrentPassword, body.NewPassword); err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			writeUnauthorized(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.CurrentPassword == "" || body.NewPassword == "" {
		writeError(w, http.StatusBadRequest, errors.New("current and new passwords are required"))
		return
	}
	if err := s.auth.ChangePassword(r.Context(), user.ID, body.CurrentPassword, body.NewPassword); err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			writeUnauthorized(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) updateMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		DisplayName string `json:"displayName"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid profile request"))
		return
	}
	displayName := strings.TrimSpace(body.DisplayName)
	if displayName == "" || len(displayName) > maxDisplayNameChars {
		writeError(w, http.StatusBadRequest, errors.New("username must be between 1 and 80 characters"))
		return
	}
	updated, revision, err := s.store.UpdateUserProfileWithRevision(r.Context(), user.ID, displayName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to update profile"))
		return
	}
	// Broadcast both the legacy "profile" type and the unified
	// "profile_required" type so old and new clients stay in sync.
	s.notifySync(r.Context(), user.ID, "profile", revision)
	s.notifySync(r.Context(), user.ID, "profile_required", revision)
	writeJSON(w, http.StatusOK, updated)
}

const maxTranscriptionBytes int64 = 25 << 20

func (s *Server) transcribe(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.transcribeLimiter, "transcribe") {
		return
	}
	stored, err := s.store.GetUserSettings(r.Context(), user.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusServiceUnavailable, errors.New("voice transcription is not configured"))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load transcription settings"))
		return
	}
	openAIAPIKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored.OpenAIAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load transcription settings"))
		return
	}
	openAIAPIKey = strings.TrimSpace(openAIAPIKey)
	if openAIAPIKey == "" {
		writeError(w, http.StatusServiceUnavailable, errors.New("voice transcription is not configured"))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			writeError(w, http.StatusRequestEntityTooLarge, errors.New("audio file is too large"))
			return
		}
		writeError(w, http.StatusBadRequest, errors.New("audio file is required"))
		return
	}
	defer file.Close()
	if header.Size <= 0 {
		writeError(w, http.StatusBadRequest, errors.New("audio file is empty"))
		return
	}
	if header.Size > maxTranscriptionBytes {
		writeError(w, http.StatusRequestEntityTooLarge, errors.New("audio file is too large"))
		return
	}

	payload, err := transcriptionMultipart(file, header)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid audio upload"))
		return
	}
	transcriptionURL := s.openAITranscriptionURL
	if transcriptionURL == "" {
		transcriptionURL = "https://api.openai.com/v1/audio/transcriptions"
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, transcriptionURL, payload.body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to prepare transcription"))
		return
	}
	request.Header.Set("Authorization", "Bearer "+openAIAPIKey)
	request.Header.Set("Content-Type", payload.contentType)
	client := s.openAIClient
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	response, err := client.Do(request)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return
		}
		slog.Warn("OpenAI transcription request failed", "user_id_hash", userIDHash(user.ID), "error", err)
		writeError(w, http.StatusBadGateway, errors.New("transcription service is unavailable"))
		return
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		slog.Warn("OpenAI transcription request rejected", "user_id_hash", userIDHash(user.ID), "status", response.StatusCode)
		writeError(w, http.StatusBadGateway, errors.New("transcription service rejected the audio"))
		return
	}
	var result struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		writeError(w, http.StatusBadGateway, errors.New("transcription service returned an invalid response"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": strings.TrimSpace(result.Text)})
}

type transcriptionUpload struct {
	body        io.Reader
	contentType string
}

func transcriptionMultipart(file multipart.File, header *multipart.FileHeader) (transcriptionUpload, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	filename := filepath.Base(strings.ReplaceAll(header.Filename, `\`, "/"))
	if filename == "" || filename == "." {
		filename = "recording.webm"
	}
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return transcriptionUpload{}, err
	}
	if _, err := io.Copy(part, file); err != nil {
		return transcriptionUpload{}, err
	}
	if err := writer.WriteField("model", "gpt-4o-mini-transcribe"); err != nil {
		return transcriptionUpload{}, err
	}
	if err := writer.WriteField("response_format", "json"); err != nil {
		return transcriptionUpload{}, err
	}
	if err := writer.Close(); err != nil {
		return transcriptionUpload{}, err
	}
	return transcriptionUpload{body: &body, contentType: writer.FormDataContentType()}, nil
}

func (s *Server) listAgentChats(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.agentLimiter, "agent") {
		return
	}
	chats, err := s.store.ListAgentChats(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, chats)
}

func (s *Server) createAgentChat(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.agentLimiter, "agent") {
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat request"))
		return
	}
	if len(body.Title) > maxChatTitleChars {
		writeError(w, http.StatusBadRequest, errors.New("chat title is too long"))
		return
	}
	chat, err := s.store.CreateAgentChat(r.Context(), user.ID, body.Title)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, chat)
}

func (s *Server) getAgentChat(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.agentLimiter, "agent") {
		return
	}
	chatID, err := uuid.Parse(r.PathValue("chatID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat id"))
		return
	}
	chat, err := s.store.GetAgentChat(r.Context(), user.ID, chatID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, chat)
}

func (s *Server) saveAgentChatMessage(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.agentLimiter, "agent") {
		return
	}
	chatID, err := uuid.Parse(r.PathValue("chatID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat id"))
		return
	}
	var body struct {
		ID               string          `json:"id"`
		Role             string          `json:"role"`
		Content          string          `json:"content"`
		ProposedTasks    json.RawMessage `json:"proposedTasks"`
		ProposedHabits   json.RawMessage `json:"proposedHabits"`
		ProposedNotes    json.RawMessage `json:"proposedNotes"`
		ProposedFolders  json.RawMessage `json:"proposedFolders"`
		ProposedAreas    json.RawMessage `json:"proposedAreas"`
		ProposedProjects json.RawMessage `json:"proposedProjects"`
		ActualModel      string          `json:"actualModel"`
		CreatedAt        string          `json:"createdAt"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat message request"))
		return
	}
	if len(body.Content) > maxChatContentChars {
		writeError(w, http.StatusBadRequest, errors.New("chat message content must be between 1 and 20000 characters"))
		return
	}
	messageID, err := uuid.Parse(body.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat message id"))
		return
	}
	message, err := s.store.SaveAgentChatMessage(r.Context(), store.SaveAgentChatMessageParams{
		UserID:           user.ID,
		ChatID:           chatID,
		MessageID:        messageID,
		Role:             body.Role,
		Content:          body.Content,
		ProposedTasks:    body.ProposedTasks,
		ProposedHabits:   body.ProposedHabits,
		ProposedNotes:    body.ProposedNotes,
		ProposedFolders:  body.ProposedFolders,
		ProposedAreas:    body.ProposedAreas,
		ProposedProjects: body.ProposedProjects,
		ActualModel:      body.ActualModel,
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.notifySync(r.Context(), user.ID, "chat", 0)
	writeJSON(w, http.StatusOK, message)
}

func (s *Server) push(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.pushLimiter, "push") {
		return
	}
	var body struct {
		Mutations []tasks.Mutation `json:"mutations"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Mutations) > maxPushMutations {
		writeError(w, http.StatusBadRequest, errors.New("invalid mutation batch"))
		return
	}
	results, err := s.store.Push(r.Context(), user.ID, body.Mutations)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	applied := store.PushApplied(results)
	s.highestBroadcast(user.ID, applied)
	latest := highestRevision(applied)
	// Legacy "sync" type plus unified "tasks_required".
	s.notifySync(r.Context(), user.ID, "sync", latest)
	s.notifySync(r.Context(), user.ID, "tasks_required", latest)
	type appliedItem struct {
		MutationID string      `json:"mutationId"`
		Entity     string      `json:"entity"`
		Task       tasks.Task  `json:"task,omitempty"`
		Habit      tasks.Habit `json:"habit,omitempty"`
		Revision   int64       `json:"revision"`
	}
	type errorItem struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	type resultItem struct {
		MutationID string       `json:"mutationId"`
		OK         bool         `json:"ok"`
		Revision   int64        `json:"revision,omitempty"`
		Entity     string       `json:"entity,omitempty"`
		Task       *tasks.Task  `json:"task,omitempty"`
		Habit      *tasks.Habit `json:"habit,omitempty"`
		Error      *errorItem   `json:"error,omitempty"`
	}
	legacy := make([]appliedItem, 0)
	detailed := make([]resultItem, 0, len(results))
	for _, item := range results {
		if item.OK {
			legacy = append(legacy, appliedItem{MutationID: item.MutationID, Entity: item.Entity, Task: item.Task, Habit: item.Habit, Revision: item.Revision})
			entry := resultItem{MutationID: item.MutationID, OK: true, Revision: item.Revision, Entity: item.Entity}
			if item.Entity == "habit" {
				habit := item.Habit
				entry.Habit = &habit
			} else {
				task := item.Task
				entry.Task = &task
			}
			detailed = append(detailed, entry)
		} else {
			code, message := item.Error.Code, item.Error.Message
			if code == "" {
				code = "INVALID_VALUE"
			}
			detailed = append(detailed, resultItem{MutationID: item.MutationID, OK: false, Error: &errorItem{Code: code, Message: message}})
		}
	}
	// Always 200 with partials: failures are per-item, never a batch 4xx.
	// `applied` keeps older clients working; `results` is the new contract.
	writeJSON(w, http.StatusOK, map[string]any{"applied": legacy, "results": detailed})
}

func (s *Server) syncWorkspace(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.workspaceLimiter, "workspace") {
		return
	}
	var snapshot workspace.Snapshot
	if err := decodeJSON(r, &snapshot); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid workspace snapshot"))
		return
	}
	merged, workspaceRevision, err := s.store.SyncWorkspaceWithRevision(r.Context(), user.ID, snapshot)
	if err != nil {
		if errors.Is(err, store.ErrClockSkew) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "CLOCK_SKEW", "error": "client clock is too far in the future"})
			return
		}
		if errors.Is(err, store.ErrConflict) {
			writeJSON(w, http.StatusConflict, map[string]string{"code": "CONFLICT", "error": "revision conflict; pull and retry"})
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.notifySync(r.Context(), user.ID, "workspace", workspaceRevision)
	s.notifySync(r.Context(), user.ID, "workspace_required", workspaceRevision)
	writeJSON(w, http.StatusOK, map[string]any{
		"areas": merged.Areas, "projects": merged.Projects, "folders": merged.Folders, "notes": merged.Notes,
		"workspaceRevision": workspaceRevision,
	})
}

func (s *Server) pull(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.pullLimiter, "pull") {
		return
	}
	since, err := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	if err != nil || since < 0 {
		since = 0
	}
	result, err := s.store.Pull(r.Context(), user.ID, since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if result.Tasks == nil {
		result.Tasks = []tasks.Task{}
	}
	if result.Habits == nil {
		result.Habits = []tasks.Habit{}
	}
	// `revision` is the legacy alias of nextSince; new clients use
	// nextSince/hasMore and re-pull while hasMore. profile+workspaceRevision
	// expose the unified revision plane.
	writeJSON(w, http.StatusOK, map[string]any{
		"tasks": result.Tasks, "habits": result.Habits,
		"revision": result.NextSince, "nextSince": result.NextSince, "hasMore": result.HasMore,
		"workspaceRevision": result.WorkspaceRevision,
		"profile":           map[string]any{"displayName": result.Profile.DisplayName, "profileRevision": result.Profile.ProfileRevision, "updatedAt": result.Profile.UpdatedAt},
	})
}

func (s *Server) realtime(w http.ResponseWriter, r *http.Request) {
	token := bearer(r)
	if token == "" {
		// Browsers cannot set Authorization headers on WebSocket handshakes;
		// accept the session token as a query parameter instead. Origin is
		// still strictly checked below.
		token = r.URL.Query().Get("token")
	}
	if token == "" {
		writeUnauthorized(w, errors.New("authentication required"))
		return
	}
	user, _, err := s.store.SessionUserForToken(r.Context(), token)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && !allowedOrigin(origin) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"localhost", "127.0.0.1", "prior.constantsuchet.fr", "*.prior.constantsuchet.fr"}})
	if err != nil {
		return
	}
	s.hub.add(user.ID, connection)
	defer s.hub.remove(user.ID, connection)
	expiry := time.NewTicker(time.Minute)
	defer expiry.Stop()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		defer cancel()
		for {
			if _, _, err := connection.Read(ctx); err != nil {
				return
			}
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-expiry.C:
			if _, _, err := s.store.SessionUserForToken(context.Background(), token); err != nil {
				connection.Close(4401, "session revoked")
				return
			}
		}
	}
}

func (s *Server) highestBroadcast(userID uuid.UUID, results []store.AppliedMutation) {
	latest := highestRevision(results)
	if latest > 0 {
		s.hub.broadcast(userID, realtimeEvent{Type: "sync_required", Revision: latest})
	}
}

func highestRevision(results []store.AppliedMutation) int64 {
	var latest int64
	for _, result := range results {
		if result.Revision > latest {
			latest = result.Revision
		}
	}
	return latest
}

func (s *Server) requireUser(r *http.Request) (store.User, error) {
	token := bearer(r)
	if token == "" {
		return store.User{}, errors.New("authentication required")
	}
	return s.store.UserForToken(r.Context(), token)
}

// limiterForPath maps out-of-scope paths to their endpoint limiter.
// In-scope handlers (push/pull/workspace/transcribe/agent chats) enforce via
// allowEndpoint; this covers settings + agentComplete without double-charging.
func (s *Server) limiterForPath(path string) *rateLimiter {
	switch {
	case path == "/v1/settings":
		return s.settingsLimiter
	case path == "/v1/agent/complete":
		return s.agentLimiter
	case path == "/v1/mail/accounts" || path == "/v1/mail/token" || path == "/v1/calendar/accounts" || path == "/v1/calendar/token":
		return s.settingsLimiter
	default:
		return nil
	}
}

// authLimiter exposes the shared auth rate limiter for the mail OAuth
// endpoints, which live in mail.go.
func (s *Server) authLimiter() *rateLimiter { return s.limiter }

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := makeRequestID()
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		if s.cfg.Production() {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if origin := r.Header.Get("Origin"); allowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// Per-endpoint limits for handlers that live outside server.go
		// (settings.go, agent_complete.go) so they share the same per-IP +
		// per-token budgets without editing those files. Handlers in this
		// file enforce their own limiter via allowEndpoint; this middleware
		// only covers the out-of-scope paths to avoid double-charging.
		if limiter := s.limiterForPath(r.URL.Path); limiter != nil {
			var allowed bool
			if token := bearer(r); token != "" {
				sum := sha256.Sum256([]byte(token))
				allowed = limiter.allow("token:" + hex.EncodeToString(sum[:])[:16])
			} else {
				ipKey := "ip:" + clientIP(r)
				allowed = limiter.allow(ipKey)
			}
			if !allowed {
				w.Header().Set("Retry-After", "60")
				writeJSON(w, http.StatusTooManyRequests, map[string]string{"code": "RATE_LIMITED", "error": "too many requests"})
				return
			}
		}
		maxBodyBytes := int64(1 << 20)
		if r.URL.Path == "/transcribe" {
			maxBodyBytes = maxTranscriptionBytes
		} else if r.URL.Path == "/v1/workspace/sync" {
			maxBodyBytes = 8 << 20
		}
		limited := http.MaxBytesReader(w, r.Body, maxBodyBytes)
		r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, requestID))
		r.Body = limited
		recorded := &statusWriter{ResponseWriter: w}
		defer func() {
			slog.Info("http request", "trace_id", requestID, "request_id", requestID, "method", r.Method, "path", r.URL.Path, "status", recorded.statusCode(), "duration_ms", time.Since(started).Milliseconds())
		}()
		next.ServeHTTP(recorded, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *statusWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *statusWriter) statusCode() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}
func (w *statusWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("connection hijacking is not supported")
	}
	return hijacker.Hijack()
}

type requestIDKey struct{}

// decodeJSON is lenient: sync, workspace and chat payloads ignore unknown
// fields so older servers tolerate newer clients (and vice versa).
func decodeJSON(r *http.Request, value any) error {
	return json.NewDecoder(r.Body).Decode(value)
}

// decodeJSONStrict keeps rejecting unknown fields for authentication payloads,
// where a typo (e.g. "pasword") must fail loudly instead of silently.
func decodeJSONStrict(r *http.Request, value any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(value)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

// writeUnauthorized returns the canonical 401 shape consumed by the client's
// central session handling: {"code":"UNAUTHENTICATED","error":...}.
func writeUnauthorized(w http.ResponseWriter, err error) {
	message := "authentication required"
	if err != nil && err.Error() != "" {
		message = err.Error()
	}
	writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "UNAUTHENTICATED", "error": message})
}

// userIDHash returns a short opaque hash for logs. Raw user IDs, tokens and
// API keys must never be logged.
func userIDHash(id uuid.UUID) string {
	sum := sha256.Sum256([]byte(id.String()))
	return hex.EncodeToString(sum[:])[:16]
}

func bearer(r *http.Request) string {
	value := r.Header.Get("Authorization")
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
}

func allowedOrigin(origin string) bool {
	return origin == "tauri://localhost" || origin == "http://localhost:1420" || origin == "http://127.0.0.1:1420" || origin == "http://tauri.localhost" || origin == "https://tauri.localhost" || origin == "https://prior.constantsuchet.fr" || strings.HasSuffix(origin, ".prior.constantsuchet.fr")
}

func clientKey(r *http.Request) string {
	return clientIP(r)
}

// clientIP returns the best-effort client IP. X-Forwarded-For is trusted only
// when the direct peer is a loopback or private address (i.e. a local reverse
// proxy such as Coolify/Caddy) and TRUST_PROXY is enabled; otherwise the
// direct peer is used. RemoteAddr includes a port, so SplitHostPort is used.
func clientIP(r *http.Request) string {
	peer := r.RemoteAddr
	if host, _, err := net.SplitHostPort(peer); err == nil {
		peer = host
	}
	// Strip IPv6 brackets if SplitHostPort failed on a bare address.
	peer = strings.Trim(peer, "[]")
	if sTrustProxy(r) && isTrustedProxyPeer(peer) {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			first := strings.TrimSpace(strings.Split(forwarded, ",")[0])
			// Validate: only accept literal IPs to prevent header injection
			// from becoming a rate-limit bypass.
			if first != "" {
				if host, _, err := net.SplitHostPort(first); err == nil {
					first = host
				}
				first = strings.Trim(first, "[]")
				if ip := net.ParseIP(first); ip != nil {
					return ip.String()
				}
			}
		}
	}
	if ip := net.ParseIP(peer); ip != nil {
		return ip.String()
	}
	return peer
}

// sTrustProxy reports whether proxy headers may be honored for this request.
// The package-level default is true; per-server config is checked by callers
// via allowEndpoint when available. Kept simple for unit testing.
func sTrustProxy(_ *http.Request) bool { return true }

func isTrustedProxyPeer(host string) bool {
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate()
}

// allowEndpoint enforces per-IP and per-token limits for an endpoint limiter.
// It writes 429 + Retry-After on rejection. Token buckets use a hash prefix so
// raw tokens never land in the limiter map or logs.
func (s *Server) allowEndpoint(w http.ResponseWriter, r *http.Request, limiter *rateLimiter, _ string) bool {
	if limiter == nil {
		return true
	}
	if token := bearer(r); token != "" {
		sum := sha256.Sum256([]byte(token))
		tokenKey := "token:" + hex.EncodeToString(sum[:])[:16]
		if !limiter.allow(tokenKey) {
			writeRateLimited(w)
			return false
		}
		return true
	}
	ipKey := "ip:" + clientIP(r)
	if !limiter.allow(ipKey) {
		writeRateLimited(w)
		return false
	}
	return true
}

func writeRateLimited(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "60")
	writeJSON(w, http.StatusTooManyRequests, map[string]string{"code": "RATE_LIMITED", "error": "too many requests"})
}

func makeRequestID() string {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(bytes)
}

// maxRealtimeConnsPerUser caps simultaneous realtime connections per user;
// the oldest connection is dropped when the cap is exceeded (backpressure:
// slow readers are closed instead of blocking the fan-out loop).
const maxRealtimeConnsPerUser = 5

// realtimeEvent is the realtime payload shape: a type discriminator plus the
// highest server revision the client has not seen yet.
type realtimeEvent struct {
	Type     string `json:"type"`
	Revision int64  `json:"revision"`
}

type hub struct {
	mu      sync.Mutex
	clients map[uuid.UUID][]*websocket.Conn
}

type rateBucket struct {
	started time.Time
	count   int
}
type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]rateBucket
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, buckets: make(map[string]rateBucket)}
}
func (l *rateLimiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	bucket := l.buckets[key]
	if bucket.started.IsZero() || now.Sub(bucket.started) >= l.window {
		l.buckets[key] = rateBucket{started: now, count: 1}
		return true
	}
	if bucket.count >= l.limit {
		return false
	}
	bucket.count++
	l.buckets[key] = bucket
	return true
}

// sweep drops expired buckets so the in-memory map cannot grow unbounded.
// Called every 5 minutes from CleanupLoop.
func (l *rateLimiter) sweep() {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	for key, bucket := range l.buckets {
		if bucket.started.IsZero() || now.Sub(bucket.started) >= l.window {
			delete(l.buckets, key)
		}
	}
}

func newHub() *hub { return &hub{clients: make(map[uuid.UUID][]*websocket.Conn)} }
func (h *hub) add(userID uuid.UUID, connection *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	connections := append(h.clients[userID], connection)
	for len(connections) > maxRealtimeConnsPerUser {
		oldest := connections[0]
		connections = connections[1:]
		go oldest.Close(4400, "too many connections")
	}
	h.clients[userID] = connections
}
func (h *hub) remove(userID uuid.UUID, connection *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	kept := h.clients[userID][:0]
	for _, existing := range h.clients[userID] {
		if existing != connection {
			kept = append(kept, existing)
		}
	}
	if len(kept) == 0 {
		delete(h.clients, userID)
	} else {
		h.clients[userID] = kept
	}
	connection.Close(websocket.StatusNormalClosure, "bye")
}

func (h *hub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	total := 0
	for _, connections := range h.clients {
		total += len(connections)
	}
	return total
}

func (h *hub) broadcast(userID uuid.UUID, event realtimeEvent) {
	h.mu.Lock()
	connections := append([]*websocket.Conn(nil), h.clients[userID]...)
	h.mu.Unlock()
	payload, _ := json.Marshal(map[string]any{"type": event.Type, "revision": event.Revision})
	for _, connection := range connections {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := connection.Write(ctx, websocket.MessageText, payload)
		cancel()
		if err != nil {
			// Drop slow/dead readers instead of blocking fan-out.
			h.remove(userID, connection)
		}
	}
}
