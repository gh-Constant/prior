// Package mailer sends Prior's transactional emails (password reset, email
// verification). Delivery sits behind Sender so tests and development never
// reach a real provider.
package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Message is one email with an HTML and a plain-text body.
type Message struct {
	To      string
	Subject string
	HTML    string
	Text    string
	// Link is the action link inside the message. Only the development
	// logger prints it; it is never logged in production.
	Link string
}

// Sender delivers a message.
type Sender interface {
	Send(ctx context.Context, message Message) error
}

// Config selects the sender. An empty APIKey logs links in development and
// drops messages (with a warning, never the link) in production.
type Config struct {
	APIKey     string
	From       string
	Production bool
	// BaseURL overrides the Resend API in tests.
	BaseURL string
	Client  *http.Client
}

// New returns the sender for cfg.
func New(cfg Config) Sender {
	if strings.TrimSpace(cfg.APIKey) == "" {
		if cfg.Production {
			return disabledSender{}
		}
		return LogSender{}
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	if base == "" {
		base = "https://api.resend.com"
	}
	from := strings.TrimSpace(cfg.From)
	if from == "" {
		from = "Prior <no-reply@prior.constantsuchet.fr>"
	}
	return &ResendSender{apiKey: cfg.APIKey, from: from, baseURL: base, client: client}
}

// ResendSender posts to the Resend HTTP API.
type ResendSender struct {
	apiKey  string
	from    string
	baseURL string
	client  *http.Client
}

func (s *ResendSender) Send(ctx context.Context, message Message) error {
	payload, err := json.Marshal(map[string]any{
		"from":    s.from,
		"to":      []string{message.To},
		"subject": message.Subject,
		"html":    message.HTML,
		"text":    message.Text,
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+"/emails", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+s.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("resend request failed: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
	if response.StatusCode >= 300 {
		return fmt.Errorf("resend returned %d", response.StatusCode)
	}
	return nil
}

// LogSender prints the action link to stdout for local development.
type LogSender struct{}

func (LogSender) Send(_ context.Context, message Message) error {
	slog.Info("development email (RESEND_API_KEY is empty)", "to", message.To, "subject", message.Subject, "link", message.Link)
	return nil
}

type disabledSender struct{}

func (disabledSender) Send(_ context.Context, message Message) error {
	slog.Warn("email not sent: RESEND_API_KEY is not configured", "subject", message.Subject)
	return errors.New("email delivery is not configured")
}

// Recorder keeps messages in memory for tests.
type Recorder struct {
	mu       sync.Mutex
	messages []Message
}

func (r *Recorder) Send(_ context.Context, message Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.messages = append(r.messages, message)
	return nil
}

// Messages returns a copy of what was sent.
func (r *Recorder) Messages() []Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Message(nil), r.messages...)
}

// Last returns the most recent message sent to an address.
func (r *Recorder) Last(to string) (Message, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for index := len(r.messages) - 1; index >= 0; index-- {
		if strings.EqualFold(r.messages[index].To, to) {
			return r.messages[index], true
		}
	}
	return Message{}, false
}
