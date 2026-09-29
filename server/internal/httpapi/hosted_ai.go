package httpapi

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/google/uuid"
)

// Prior AI: the server-owned, OpenAI-compatible provider (OpenRouter by
// default) that powers the assistant, recommendations, mail and calendar
// drafts, and dictation for signed-in users who have not configured their
// own keys. The key lives only in the API environment (AI_API_KEY).

// agentPurposes lists the use cases a completion may declare. Each maps to
// its own hosted model (see config.HostedAIConfig.ModelFor).
var agentPurposes = map[string]struct{}{
	"agent":           {},
	"recommendations": {},
	"mail":            {},
	"calendar":        {},
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

func (s *Server) hostedAIStatus(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	hosted := s.cfg.HostedAI
	response := map[string]any{
		"available":     hosted.Enabled(),
		"transcription": hosted.TranscriptionEnabled(),
		"dailyLimit":    hosted.DailyRequestsPerUser,
		"usedToday":     s.hostedUsage.used(user.ID),
	}
	if hosted.Enabled() {
		response["models"] = map[string]string{
			"agent":           hosted.ModelFor("agent"),
			"recommendations": hosted.ModelFor("recommendations"),
			"mail":            hosted.ModelFor("mail"),
			"calendar":        hosted.ModelFor("calendar"),
		}
	}
	writeJSON(w, http.StatusOK, response)
}
