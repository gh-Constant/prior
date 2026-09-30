package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"
)

// Decision model client (TypeSafe Jev, through OpenRouter's decisions
// endpoint). Jev does not write text: it reads a state and answers typed
// questions (noul = yes/no probability, choice = one option of a set,
// score = position on ordered levels). Prior uses it wherever a feature only
// needs to pick or rank, and keeps every word the user reads in code.

// decisionQuestion is one typed question. Criteria is a map of option to
// description for "choice" and "noul", and an ordered list of levels (low to
// high) for "score".
type decisionQuestion struct {
	Type         string `json:"type"`
	Instructions any    `json:"instructions"`
	Criteria     any    `json:"criteria,omitempty"`
}

type decisionRequest struct {
	Model     string                      `json:"model"`
	State     any                         `json:"state"`
	Questions map[string]decisionQuestion `json:"questions"`
}

// decisionAnswer holds whichever field matches the question's type.
type decisionAnswer struct {
	Type          string             `json:"type"`
	Noul          *float64           `json:"noul"`
	Choice        string             `json:"choice"`
	Score         *float64           `json:"score"`
	Confidence    float64            `json:"confidence"`
	Probabilities map[string]float64 `json:"probabilities"`
}

type decisionResult struct {
	model       string
	answers     map[string]decisionAnswer
	totalTokens int64
	costMicros  int64
}

// A decision must come back while the user waits; the chat model is the
// fallback, so a slow decision call is abandoned early.
const decisionTimeout = 15 * time.Second

// requestDecisions posts one decision request with the hosted key. Errors
// never carry the upstream body, the key, or the state.
func (s *Server) requestDecisions(ctx context.Context, request decisionRequest) (decisionResult, error) {
	hosted := s.cfg.HostedAI
	if !hosted.DecisionsEnabled() {
		return decisionResult{}, errors.New("decision model is not configured")
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		return decisionResult{}, errors.New("unable to prepare decision")
	}
	ctx, cancel := context.WithTimeout(ctx, decisionTimeout)
	defer cancel()
	forward, err := http.NewRequestWithContext(ctx, http.MethodPost, hosted.DecisionsURL, bytes.NewReader(encoded))
	if err != nil {
		return decisionResult{}, errors.New("unable to prepare decision")
	}
	forward.Header.Set("Content-Type", "application/json")
	forward.Header.Set("Authorization", "Bearer "+strings.TrimSpace(hosted.APIKey))
	forward.Header.Set("HTTP-Referer", "https://prior.constantsuchet.fr")
	forward.Header.Set("X-Title", "Prior AI Assistant")
	client := s.completionClient
	if client == nil {
		client = &http.Client{Timeout: decisionTimeout}
	}
	response, err := client.Do(forward)
	if err != nil {
		return decisionResult{}, errors.New("decision service is unavailable")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return decisionResult{}, errors.New("decision service returned an invalid response")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		slog.Warn("decision upstream rejected", "status", response.StatusCode)
		return decisionResult{}, errors.New("decision service rejected the request")
	}
	var decoded struct {
		Model   string                    `json:"model"`
		Answers map[string]decisionAnswer `json:"answers"`
		Usage   struct {
			InputTokens  int64   `json:"input_tokens"`
			OutputTokens int64   `json:"output_tokens"`
			Cost         float64 `json:"cost"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil || decoded.Answers == nil {
		return decisionResult{}, errors.New("decision service returned an invalid response")
	}
	return decisionResult{
		model:       decoded.Model,
		answers:     decoded.Answers,
		totalTokens: decoded.Usage.InputTokens + decoded.Usage.OutputTokens,
		costMicros:  int64(math.Round(decoded.Usage.Cost * 1e6)),
	}, nil
}

// scoreOf returns a score answer, or -1 when the question got no usable
// answer (callers treat that as "lowest").
func (r decisionResult) scoreOf(key string) float64 {
	answer, ok := r.answers[key]
	if !ok || answer.Score == nil || math.IsNaN(*answer.Score) || math.IsInf(*answer.Score, 0) {
		return -1
	}
	return *answer.Score
}
