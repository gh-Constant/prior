package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"log/slog"
	"mime/multipart"
	"net"
	"net/http"
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
	openAIClient           *http.Client
	openAITranscriptionURL string
}

func New(cfg config.Config, pool *pgxpool.Pool) *Server {
	database := store.New(pool)
	return &Server{
		cfg:                    cfg,
		pool:                   pool,
		store:                  database,
		auth:                   auth.NewManager(cfg, database),
		hub:                    newHub(),
		limiter:                newRateLimiter(20, 10*time.Minute),
		openAIClient:           &http.Client{Timeout: 2 * time.Minute},
		openAITranscriptionURL: "https://api.openai.com/v1/audio/transcriptions",
	}
}

func (s *Server) CleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.auth.Cleanup()
		case <-ctx.Done():
			return
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
	mux.HandleFunc("GET /v1/me", s.me)
	mux.HandleFunc("PATCH /v1/me", s.updateMe)
	mux.HandleFunc("POST /transcribe", s.transcribe)
	mux.HandleFunc("GET /v1/settings", s.getSettings)
	mux.HandleFunc("POST /v1/settings", s.saveSettings)
	mux.HandleFunc("GET /v1/agent/chats", s.listAgentChats)
	mux.HandleFunc("POST /v1/agent/chats", s.createAgentChat)
	mux.HandleFunc("GET /v1/agent/chats/{chatID}", s.getAgentChat)
	mux.HandleFunc("POST /v1/agent/chats/{chatID}/messages", s.saveAgentChatMessage)
	mux.HandleFunc("POST /v1/sync/push", s.push)
	mux.HandleFunc("GET /v1/sync/pull", s.pull)
	mux.HandleFunc("POST /v1/workspace/sync", s.syncWorkspace)
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

func isCustomScheme(candidate string) bool {
	return !strings.HasPrefix(candidate, "http://") && !strings.HasPrefix(candidate, "https://")
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
      var target = {{.TargetURL}};
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
	_ = authCallbackTmpl.Execute(w, struct {
		Success   bool
		TargetURL string
	}{
		Success:   success,
		TargetURL: targetURL,
	})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
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
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid registration request"))
		return
	}
	token, user, err := s.auth.Register(r.Context(), body.Email, body.Password, body.DisplayName, body.Device, body.Platform)
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
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Device   string `json:"device"`
		Platform string `json:"platform"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid login request"))
		return
	}
	token, user, err := s.auth.Login(r.Context(), body.Email, body.Password, body.Device, body.Platform)
	if err != nil {
		status := http.StatusUnauthorized
		if !errors.Is(err, auth.ErrInvalidCredentials) {
			status = http.StatusInternalServerError
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) exchange(w http.ResponseWriter, r *http.Request) {
	var body struct{ Code, Device, Platform string }
	if err := decodeJSON(r, &body); err != nil || body.Code == "" {
		writeError(w, http.StatusBadRequest, errors.New("code is required"))
		return
	}
	token, user, err := s.auth.Exchange(r.Context(), body.Code, body.Device, body.Platform)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) googleNative(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		IDToken  string `json:"id_token"`
		Device   string `json:"device"`
		Platform string `json:"platform"`
	}
	if err := decodeJSON(r, &body); err != nil || body.IDToken == "" {
		writeError(w, http.StatusBadRequest, errors.New("Google ID token is required"))
		return
	}
	token, user, err := s.auth.VerifyNativeIDToken(r.Context(), body.IDToken, body.Device, body.Platform)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if _, err := s.requireUser(r); err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := s.store.RevokeSession(r.Context(), bearer(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) updateMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
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
	if displayName == "" || len(displayName) > 80 {
		writeError(w, http.StatusBadRequest, errors.New("username must be between 1 and 80 characters"))
		return
	}
	updated, err := s.store.UpdateUserProfile(r.Context(), user.ID, displayName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to update profile"))
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

const maxTranscriptionBytes int64 = 25 << 20

func (s *Server) transcribe(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
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
		slog.Warn("OpenAI transcription request failed", "user_id", user.ID, "error", err)
		writeError(w, http.StatusBadGateway, errors.New("transcription service is unavailable"))
		return
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		slog.Warn("OpenAI transcription request rejected", "user_id", user.ID, "status", response.StatusCode)
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
		writeError(w, http.StatusUnauthorized, err)
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
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat request"))
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
		writeError(w, http.StatusUnauthorized, err)
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
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	chatID, err := uuid.Parse(r.PathValue("chatID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat id"))
		return
	}
	var body struct {
		ID              string          `json:"id"`
		Role            string          `json:"role"`
		Content         string          `json:"content"`
		ProposedTasks   json.RawMessage `json:"proposedTasks"`
		ProposedHabits  json.RawMessage `json:"proposedHabits"`
		ProposedNotes   json.RawMessage `json:"proposedNotes"`
		ProposedFolders json.RawMessage `json:"proposedFolders"`
		ActualModel     string          `json:"actualModel"`
		CreatedAt       string          `json:"createdAt"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat message request"))
		return
	}
	messageID, err := uuid.Parse(body.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid chat message id"))
		return
	}
	message, err := s.store.SaveAgentChatMessage(r.Context(), store.SaveAgentChatMessageParams{
		UserID:          user.ID,
		ChatID:          chatID,
		MessageID:       messageID,
		Role:            body.Role,
		Content:         body.Content,
		ProposedTasks:   body.ProposedTasks,
		ProposedHabits:  body.ProposedHabits,
		ProposedNotes:   body.ProposedNotes,
		ProposedFolders: body.ProposedFolders,
		ActualModel:     body.ActualModel,
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, message)
}

func (s *Server) push(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	var body struct {
		Mutations []tasks.Mutation `json:"mutations"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Mutations) > 100 {
		writeError(w, http.StatusBadRequest, errors.New("invalid mutation batch"))
		return
	}
	results, err := s.store.Push(r.Context(), user.ID, body.Mutations)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.highestBroadcast(user.ID, results)
	type responseItem struct {
		MutationID string      `json:"mutationId"`
		Entity     string      `json:"entity"`
		Task       tasks.Task  `json:"task,omitempty"`
		Habit      tasks.Habit `json:"habit,omitempty"`
		Revision   int64       `json:"revision"`
	}
	response := make([]responseItem, 0, len(results))
	for _, item := range results {
		response = append(response, responseItem{MutationID: item.MutationID, Entity: item.Entity, Task: item.Task, Habit: item.Habit, Revision: item.Revision})
	}
	writeJSON(w, http.StatusOK, map[string]any{"applied": response})
}

func (s *Server) syncWorkspace(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	var snapshot workspace.Snapshot
	if err := decodeJSON(r, &snapshot); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid workspace snapshot"))
		return
	}
	merged, err := s.store.SyncWorkspace(r.Context(), user.ID, snapshot)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, merged)
}

func (s *Server) pull(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	since, err := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	if err != nil || since < 0 {
		since = 0
	}
	tasksFound, habitsFound, revision, err := s.store.Pull(r.Context(), user.ID, since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasksFound, "habits": habitsFound, "revision": revision})
}

func (s *Server) realtime(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"localhost", "127.0.0.1", "prior.constantsuchet.fr", "*.prior.constantsuchet.fr"}})
	if err != nil {
		return
	}
	s.hub.add(user.ID, connection)
	defer s.hub.remove(user.ID, connection)
	for {
		if _, _, err := connection.Read(r.Context()); err != nil {
			return
		}
	}
}

func (s *Server) highestBroadcast(userID uuid.UUID, results []store.AppliedMutation) {
	var latest int64
	for _, result := range results {
		if result.Revision > latest {
			latest = result.Revision
		}
	}
	if latest > 0 {
		s.hub.broadcast(userID, latest)
	}
}

func (s *Server) requireUser(r *http.Request) (store.User, error) {
	token := bearer(r)
	if token == "" {
		return store.User{}, errors.New("authentication required")
	}
	return s.store.UserForToken(r.Context(), token)
}

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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
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
			slog.Info("http request", "request_id", requestID, "method", r.Method, "path", r.URL.Path, "status", recorded.statusCode(), "duration_ms", time.Since(started).Milliseconds())
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

func decodeJSON(r *http.Request, value any) error {
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
	if forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ","); len(forwarded) > 0 && strings.TrimSpace(forwarded[0]) != "" {
		return strings.TrimSpace(forwarded[0])
	}
	return r.RemoteAddr
}

func makeRequestID() string {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(bytes)
}

type hub struct {
	mu      sync.Mutex
	clients map[uuid.UUID]map[*websocket.Conn]struct{}
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

func newHub() *hub { return &hub{clients: make(map[uuid.UUID]map[*websocket.Conn]struct{})} }
func (h *hub) add(userID uuid.UUID, connection *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[userID] == nil {
		h.clients[userID] = make(map[*websocket.Conn]struct{})
	}
	h.clients[userID][connection] = struct{}{}
}
func (h *hub) remove(userID uuid.UUID, connection *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients[userID], connection)
	if len(h.clients[userID]) == 0 {
		delete(h.clients, userID)
	}
	connection.Close(websocket.StatusNormalClosure, "bye")
}
func (h *hub) broadcast(userID uuid.UUID, revision int64) {
	h.mu.Lock()
	connections := make([]*websocket.Conn, 0, len(h.clients[userID]))
	for connection := range h.clients[userID] {
		connections = append(connections, connection)
	}
	h.mu.Unlock()
	payload, _ := json.Marshal(map[string]any{"type": "sync_required", "revision": revision})
	for _, connection := range connections {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := connection.Write(ctx, websocket.MessageText, payload)
		cancel()
		if err != nil {
			connection.Close(websocket.StatusGoingAway, "write failed")
		}
	}
}
