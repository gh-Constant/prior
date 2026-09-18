package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Optional server-side OpenRouter proxy (long-term BFF direction). When the
// user has a stored OpenRouter key, the client can POST here instead of
// calling OpenRouter directly, keeping the secret off the device. The
// client-direct path in app/src/lib/ai.ts remains as fallback.
//
// Guarantees: allowlisted models only, PII redaction before forwarding,
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
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid agent request"))
		return
	}
	model := strings.TrimSpace(body.Model)
	if model == "" {
		model = "openrouter/free"
	}
	if !agentModelAllowed(model) {
		writeError(w, http.StatusBadRequest, errors.New("model is not allowlisted for the server proxy"))
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" || len(prompt) > 20000 || len(body.System) > 20000 || len(body.History) > 8 {
		writeError(w, http.StatusBadRequest, errors.New("invalid agent request"))
		return
	}
	stored, err := s.store.GetUserSettings(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("no stored OpenRouter key; add one in Settings first"))
		return
	}
	apiKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored.OpenRouterAPIKey)
	if err != nil || strings.TrimSpace(apiKey) == "" {
		writeError(w, http.StatusBadRequest, errors.New("no stored OpenRouter key; add one in Settings first"))
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

	payload := map[string]any{
		"model":       model,
		"messages":    messages,
		"temperature": 0.2,
	}
	if body.WebSearch {
		payload["tools"] = []map[string]string{{"type": "openrouter:web_search"}}
	}
	reasoningEffort := normalizeReasoningEffort(body.ReasoningEffort)
	if reasoningEffort != "" {
		payload["reasoning"] = map[string]string{"effort": reasoningEffort}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to prepare completion"))
		return
	}
	slog.Info("agent proxy request",
		"user_id_hash", userIDHash(user.ID),
		"model", model,
		"reasoning_effort", reasoningEffort,
		"prompt_chars", len(prompt),
		"history_messages", len(body.History))

	forward, err := http.NewRequestWithContext(r.Context(), http.MethodPost, openRouterCompletionsURL, bytes.NewReader(encoded))
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to prepare completion"))
		return
	}
	forward.Header.Set("Content-Type", "application/json")
	forward.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	forward.Header.Set("HTTP-Referer", "https://prior.constantsuchet.fr")
	forward.Header.Set("X-Title", "Prior AI Assistant")
	client := &http.Client{Timeout: 60 * time.Second}
	response, err := client.Do(forward)
	if err != nil {
		slog.Warn("agent proxy upstream failed", "user_id_hash", userIDHash(user.ID), "error", err)
		writeError(w, http.StatusBadGateway, errors.New("assistant service is unavailable"))
		return
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadGateway, errors.New("assistant service returned an invalid response"))
		return
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		slog.Warn("agent proxy upstream rejected", "user_id_hash", userIDHash(user.ID), "status", response.StatusCode)
		writeError(w, http.StatusBadGateway, errors.New("assistant service rejected the request"))
		return
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
		writeError(w, http.StatusBadGateway, errors.New("assistant service returned an invalid response"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"content":     messageContentToString(decoded.Choices[0].Message.Content),
		"actualModel": firstNonEmpty(decoded.Model, model),
	})
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
