package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

// Server-side completion proxy. Signed-in clients POST here and the API
// forwards to the user's stored OpenRouter key when they have one, or to
// Prior AI (the operator's hosted key, see hosted_ai.go) otherwise. The
// client-direct path in app/src/lib/ai.ts remains as fallback.
//
// Guarantees: validated model IDs (free-only for general chat on user keys),
// PII redaction before forwarding, a per-user daily cap on hosted requests,
// per-request budget logging (lengths only, never content or keys).
const openRouterCompletionsURL = "https://openrouter.ai/api/v1/chat/completions"

var allowedAgentModels = map[string]struct{}{
	"openrouter/free":                               {},
	"meta-llama/llama-3.3-70b-instruct:free":        {},
	"google/gemini-2.0-flash-exp:free":              {},
	"qwen/qwen-2.5-72b-instruct:free":               {},
	"deepseek/deepseek-r1:free":                     {},
	"meta-llama/llama-3.1-405b-instruct:free":       {},
	"google/gemma-3-27b-it:free":                    {},
	"mistralai/mistral-small-3.1-24b-instruct:free": {},
}

var emailRedactor = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
var openRouterModelID = regexp.MustCompile(`^[A-Za-z0-9._-]+/[A-Za-z0-9._:+-]+$`)

func redactPII(value string) string { return emailRedactor.ReplaceAllString(value, "[redacted-email]") }

// normalizeReasoningEffort allowlists the OpenRouter reasoning.effort values
// the proxy forwards. Anything else (including "auto") means the provider
// default applies and nothing is forwarded.
func normalizeReasoningEffort(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "none", "minimal", "low", "medium", "high", "xhigh":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func agentModelAllowed(model string) bool {
	model = strings.TrimSpace(model)
	if model == "" {
		return false
	}
	if _, ok := allowedAgentModels[model]; ok {
		return true
	}
	// Any other explicitly free OpenRouter model stays within the free tier.
	return strings.HasSuffix(model, ":free")
}

func (s *Server) agentComplete(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.agentLimiter, "agent") {
		return
	}
	var body struct {
		Model   string `json:"model"`
		Prompt  string `json:"prompt"`
		System  string `json:"system"`
		History []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"history"`
		WebSearch       bool   `json:"webSearch"`
		ReasoningEffort string `json:"reasoningEffort"`
		Purpose         string `json:"purpose"`
		// Provider "hosted" asks for Prior AI explicitly; anything else uses
		// the user's stored OpenRouter key and falls back to Prior AI when
		// no key is stored.
		Provider string `json:"provider"`
		// JSON requests a JSON object response (response_format).
		JSON bool `json:"json"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid agent request"))
		return
	}
	purpose, ok := normalizeAgentPurpose(body.Purpose)
	if !ok {
		writeError(w, http.StatusBadRequest, errors.New("invalid agent purpose"))
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" || len(prompt) > 20000 || len(body.System) > 40000 || len(body.History) > 8 {
		writeError(w, http.StatusBadRequest, errors.New("invalid agent request"))
		return
	}
	route, status, err := s.resolveCompletionRoute(r, user.ID, purpose, strings.TrimSpace(body.Model), body.Provider == "hosted")
	if err != nil {
		writeError(w, status, err)
		return
	}
	messages := make([]map[string]string, 0, len(body.History)+2)
	if strings.TrimSpace(body.System) != "" {
		messages = append(messages, map[string]string{"role": "system", "content": redactPII(body.System)})
	}
	for _, item := range body.History {
		if item.Role != "user" && item.Role != "assistant" {
			writeError(w, http.StatusBadRequest, errors.New("invalid agent request"))
			return
		}
		content := strings.TrimSpace(item.Content)
		if len(content) > 20000 {
			writeError(w, http.StatusBadRequest, errors.New("invalid agent request"))
			return
		}
		messages = append(messages, map[string]string{"role": item.Role, "content": redactPII(content)})
	}
	messages = append(messages, map[string]string{"role": "user", "content": redactPII(prompt)})

	reasoningEffort := normalizeReasoningEffort(body.ReasoningEffort)
	if route.hosted {
		// Hosted models and their effort are picked per purpose by the
		// operator; the client's preference targets its own model choice.
		reasoningEffort = normalizeReasoningEffort(s.cfg.HostedAI.ReasoningEffortFor(purpose))
	}
	if route.hosted && !s.hostedUsage.take(user.ID) {
		writeError(w, http.StatusTooManyRequests, errors.New("daily Prior AI limit reached; try again tomorrow or add your own OpenRouter key"))
		return
	}
	payload := completionPayload(route, messages, body.WebSearch, reasoningEffort, body.JSON)
	slog.Info("agent proxy request",
		"user_id_hash", userIDHash(user.ID),
		"hosted", route.hosted,
		"purpose", purpose,
		"model", route.model,
		"reasoning_effort", reasoningEffort,
		"prompt_chars", len(prompt),
		"history_messages", len(body.History))

	content, actualModel, err := s.requestChatCompletion(r.Context(), route, payload)
	if err != nil {
		slog.Warn("agent proxy upstream failed", "user_id_hash", userIDHash(user.ID), "hosted", route.hosted, "error", err)
		writeError(w, http.StatusBadGateway, err)
		return
	}
	provider := "openrouter"
	if route.hosted {
		provider = "hosted"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"content":     content,
		"actualModel": firstNonEmpty(actualModel, route.model),
		"provider":    provider,
	})
}

// resolveCompletionRoute picks the upstream for a completion: the user's own
// stored OpenRouter key when present (and not explicitly bypassed), otherwise
// Prior AI when the server has it configured.
func (s *Server) resolveCompletionRoute(r *http.Request, userID uuid.UUID, purpose, model string, wantHosted bool) (completionRoute, int, error) {
	hosted := s.cfg.HostedAI
	if !wantHosted {
		apiKey, err := s.storedOpenRouterKey(r, userID, purpose)
		if err != nil {
			return completionRoute{}, http.StatusInternalServerError, errors.New("unable to load assistant settings")
		}
		if apiKey != "" {
			if model == "" {
				model = "openrouter/free"
			}
			if !userModelAllowed(purpose, model) {
				return completionRoute{}, http.StatusBadRequest, errors.New("model is not allowlisted for the server proxy")
			}
			return completionRoute{url: s.openRouterURL(), apiKey: apiKey, model: model}, 0, nil
		}
		if !hosted.Enabled() {
			return completionRoute{}, http.StatusBadRequest, errors.New("no stored OpenRouter key; add one in Settings first")
		}
	}
	if !hosted.Enabled() {
		return completionRoute{}, http.StatusServiceUnavailable, errors.New("Prior AI is not configured on this server")
	}
	return hostedCompletionRoute(hosted, purpose), 0, nil
}

// userModelAllowed keeps general chat on free models for user keys (the
// historical proxy guarantee) and accepts any well-formed model ID for the
// feature drafts, where the user picks the model explicitly.
func userModelAllowed(purpose, model string) bool {
	if purpose == "agent" {
		return agentModelAllowed(model)
	}
	return len(model) <= 160 && openRouterModelID.MatchString(model)
}

func (s *Server) storedOpenRouterKey(r *http.Request, userID uuid.UUID, purpose string) (string, error) {
	stored, err := s.store.GetUserSettings(r.Context(), userID)
	if errors.Is(err, store.ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	storedKey := stored.OpenRouterAPIKey
	if purpose == "recommendations" && stored.RecommendationOpenRouterAPIKey != "" {
		storedKey = stored.RecommendationOpenRouterAPIKey
	}
	apiKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, storedKey)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(apiKey), nil
}

func (s *Server) openRouterURL() string {
	if s.openRouterCompletionsURL != "" {
		return s.openRouterCompletionsURL
	}
	return openRouterCompletionsURL
}

// requestChatCompletion posts an OpenAI-compatible chat/completions payload
// and returns the first choice's text. Errors are safe to show to the user:
// they never carry the upstream body, the key, or prompt content.
func (s *Server) requestChatCompletion(ctx context.Context, route completionRoute, payload map[string]any) (string, string, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", "", errors.New("unable to prepare completion")
	}
	forward, err := http.NewRequestWithContext(ctx, http.MethodPost, route.url, bytes.NewReader(encoded))
	if err != nil {
		return "", "", errors.New("unable to prepare completion")
	}
	forward.Header.Set("Content-Type", "application/json")
	forward.Header.Set("Authorization", "Bearer "+route.apiKey)
	forward.Header.Set("HTTP-Referer", "https://prior.constantsuchet.fr")
	forward.Header.Set("X-Title", "Prior AI Assistant")
	client := s.completionClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	response, err := client.Do(forward)
	if err != nil {
		return "", "", errors.New("assistant service is unavailable")
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", "", errors.New("assistant service returned an invalid response")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		slog.Warn("agent proxy upstream rejected", "hosted", route.hosted, "status", response.StatusCode)
		return "", "", errors.New("assistant service rejected the request")
	}
	var decoded struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Model string `json:"model"`
	}
	if err := json.Unmarshal(responseBody, &decoded); err != nil || len(decoded.Choices) == 0 {
		return "", "", errors.New("assistant service returned an invalid response")
	}
	return messageContentToString(decoded.Choices[0].Message.Content), decoded.Model, nil
}

func messageContentToString(content any) string {
	switch value := content.(type) {
	case string:
		return value
	case []any:
		var builder strings.Builder
		for _, part := range value {
			if item, ok := part.(map[string]any); ok {
				if text, ok := item["text"].(string); ok {
					builder.WriteString(text)
				}
			}
		}
		return builder.String()
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
