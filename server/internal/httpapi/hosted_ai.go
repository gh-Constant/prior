package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

// Prior AI: the server-owned, OpenAI-compatible provider (OpenRouter by
// default) that powers the assistant, recommendations, mail and calendar
// drafts, and dictation for signed-in users who have not configured their
// own keys. The key lives only in the API environment (AI_API_KEY). Today
// recommendations go to the decision model first (decisions.go).

// agentPurposes lists the use cases a completion may declare. Each maps to
// its own hosted model (see config.HostedAIConfig.ModelFor).
var agentPurposes = map[string]struct{}{
	"agent":           {},
	"recommendations": {},
	"mail":            {},
	"calendar":        {},
	// "import" organises files exported from Todoist, Linear or Notion. It
	// is Prior AI only (see resolveCompletionRoute), so it is a Pro feature.
	"import": {},
	// "planning" estimates task durations for time blocking. It is answered
	// only by the decision model (planning_decisions.go) and is Prior AI only.
	"planning": {},
}

func normalizeAgentPurpose(value string) (string, bool) {
	purpose := strings.ToLower(strings.TrimSpace(value))
	if purpose == "" {
		purpose = "agent"
	}
	_, ok := agentPurposes[purpose]
	return purpose, ok
}

// hostedUsage counts hosted requests per user per UTC day so one account
// cannot run up the shared provider bill. It is in-memory: a restart resets
// the day's counters, which is an acceptable trade-off for a single API
// instance.
type hostedUsage struct {
	mu     sync.Mutex
	limit  int
	counts map[uuid.UUID]hostedUsageDay
	now    func() time.Time
}

type hostedUsageDay struct {
	day   string
	count int
}

func newHostedUsage(limit int) *hostedUsage {
	return &hostedUsage{limit: limit, counts: map[uuid.UUID]hostedUsageDay{}, now: time.Now}
}

func (u *hostedUsage) today() string { return u.now().UTC().Format("2006-01-02") }

// take reserves one hosted request for the user. It returns false once the
// daily limit is reached. A non-positive limit disables the cap.
func (u *hostedUsage) take(userID uuid.UUID) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	day := u.today()
	entry := u.counts[userID]
	if entry.day != day {
		entry = hostedUsageDay{day: day}
	}
	if u.limit > 0 && entry.count >= u.limit {
		return false
	}
	entry.count++
	u.counts[userID] = entry
	return true
}

func (u *hostedUsage) used(userID uuid.UUID) int {
	u.mu.Lock()
	defer u.mu.Unlock()
	entry := u.counts[userID]
	if entry.day != u.today() {
		return 0
	}
	return entry.count
}

// sweep drops counters from previous days.
func (u *hostedUsage) sweep() {
	u.mu.Lock()
	defer u.mu.Unlock()
	day := u.today()
	for userID, entry := range u.counts {
		if entry.day != day {
			delete(u.counts, userID)
		}
	}
}

// completionRoute is the resolved upstream for one completion request.
type completionRoute struct {
	hosted bool
	url    string
	apiKey string
	model  string
	// fallbacks are sent as OpenRouter's `models` array (primary first).
	fallbacks []string
}

func hostedCompletionRoute(cfg config.HostedAIConfig, purpose string) completionRoute {
	return completionRoute{
		hosted:    true,
		url:       cfg.BaseURL + "/chat/completions",
		apiKey:    strings.TrimSpace(cfg.APIKey),
		model:     cfg.ModelFor(purpose),
		fallbacks: cfg.FallbackModels,
	}
}

// completionPayload builds the chat/completions body for a route.
func completionPayload(route completionRoute, messages []map[string]string, webSearch bool, reasoningEffort string, jsonOutput bool) map[string]any {
	payload := map[string]any{
		"model":       route.model,
		"messages":    messages,
		"temperature": 0.2,
	}
	if route.hosted && len(route.fallbacks) > 0 {
		models := []string{route.model}
		for _, model := range route.fallbacks {
			if model != route.model {
				models = append(models, model)
			}
		}
		payload["models"] = models
	}
	if route.hosted {
		// Ask OpenRouter to report what each hosted call cost, for the
		// admin dashboard.
		payload["usage"] = map[string]bool{"include": true}
	}
	if webSearch && !route.hosted {
		payload["tools"] = []map[string]string{{"type": "openrouter:web_search"}}
	}
	if reasoningEffort != "" {
		payload["reasoning"] = map[string]string{"effort": reasoningEffort}
	}
	if jsonOutput {
		payload["response_format"] = map[string]string{"type": "json_object"}
	}
	return payload
}

var (
	errHostedAIRequiresPlan = errors.New("Prior AI is included in paid plans; use your own OpenRouter key or Codex otherwise")
	errHostedAIAgentQuota   = errors.New("monthly Prior AI assistant quota reached for your plan")
)

// writeHostedAIError adds a machine-readable code to Prior AI refusals so the
// client can show the plan or quota message instead of a generic failure.
func writeHostedAIError(w http.ResponseWriter, status int, err error) {
	switch status {
	case http.StatusPaymentRequired:
		writeJSON(w, status, map[string]string{"code": "HOSTED_AI_REQUIRES_PLAN", "error": err.Error()})
	case http.StatusTooManyRequests:
		writeJSON(w, status, map[string]string{"code": "HOSTED_AI_QUOTA", "error": err.Error()})
	default:
		writeError(w, status, err)
	}
}

func monthStart(now time.Time) time.Time {
	now = now.UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// checkHostedAgentQuota enforces the plan's monthly token cap on assistant
// chat. Other purposes are not token-capped.
func (s *Server) checkHostedAgentQuota(ctx context.Context, user store.User, purpose string) (int, error) {
	if purpose != "agent" {
		return 0, nil
	}
	limit := s.hostedAIEntitlement(ctx, user).AgentTokensPerMonth
	if limit <= 0 {
		return 0, nil
	}
	used, err := s.store.HostedAITokensSince(ctx, user.ID, monthStart(time.Now()), "agent")
	if err != nil {
		return http.StatusInternalServerError, errors.New("unable to check Prior AI usage")
	}
	if used >= limit {
		return http.StatusTooManyRequests, errHostedAIAgentQuota
	}
	return 0, nil
}

// recordHostedUsage persists one hosted request. A failed write is logged,
// never shown: the user already got their answer.
func (s *Server) recordHostedUsage(ctx context.Context, userID uuid.UUID, purpose string, tokens, costMicros int64) {
	if s.store == nil {
		return
	}
	if err := s.store.RecordHostedAIUsage(ctx, userID, time.Now(), purpose, tokens, costMicros); err != nil {
		slog.Warn("hosted AI usage not recorded", "user_id_hash", userIDHash(userID), "purpose", purpose, "error", err)
	}
}

func (s *Server) hostedAIStatus(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	hosted := s.cfg.HostedAI
	entitlement := s.hostedAIEntitlement(r.Context(), user)
	response := map[string]any{
		"available":     hosted.Enabled() && entitlement.Allowed,
		"configured":    hosted.Enabled(),
		"entitlement":   entitlement,
		"transcription": hosted.TranscriptionEnabled() && entitlement.Allowed,
		"dailyLimit":    hosted.DailyRequestsPerUser,
		"usedToday":     s.hostedUsage.used(user.ID),
	}
	if hosted.Enabled() {
		recommendations := hosted.ModelFor("recommendations")
		if hosted.DecisionsEnabled() {
			recommendations = hosted.DecisionsModel
		}
		response["models"] = map[string]string{
			"agent":           hosted.ModelFor("agent"),
			"recommendations": recommendations,
			"mail":            hosted.ModelFor("mail"),
			"calendar":        hosted.ModelFor("calendar"),
			"import":          hosted.ModelFor("import"),
		}
	}
	writeJSON(w, http.StatusOK, response)
}
