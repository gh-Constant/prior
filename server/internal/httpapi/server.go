package httpapi

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/gh-Constant/prior/server/internal/auth"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	cfg     config.Config
	pool    *pgxpool.Pool
	store   *store.Store
	auth    *auth.Manager
	hub     *hub
	limiter *rateLimiter
}

func New(cfg config.Config, pool *pgxpool.Pool) *Server {
	database := store.New(pool)
	return &Server{cfg: cfg, pool: pool, store: database, auth: auth.NewManager(cfg, database), hub: newHub(), limiter: newRateLimiter(20, 10*time.Minute)}
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
	mux.HandleFunc("POST /v1/auth/logout", s.logout)
	mux.HandleFunc("GET /v1/me", s.me)
	mux.HandleFunc("POST /v1/sync/push", s.push)
	mux.HandleFunc("GET /v1/sync/pull", s.pull)
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
		http.Redirect(w, r, returnTo+"?error=auth_failed", http.StatusFound)
		return
	}
	http.Redirect(w, r, returnTo, http.StatusFound)
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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		limited := http.MaxBytesReader(w, r.Body, 1<<20)
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
	return origin == "http://localhost:1420" || origin == "http://127.0.0.1:1420" || origin == "http://tauri.localhost" || origin == "https://tauri.localhost" || origin == "https://prior.constantsuchet.fr" || strings.HasSuffix(origin, ".prior.constantsuchet.fr")
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
