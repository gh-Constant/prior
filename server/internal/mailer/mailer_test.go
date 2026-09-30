package mailer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRenderEveryLanguage(t *testing.T) {
	for _, kind := range []Kind{KindPasswordReset, KindVerifyEmail} {
		for _, language := range Languages {
			message, err := Render(kind, language, "ada@example.com", "https://app.example/reset-password?token=abc&x=1")
			if err != nil {
				t.Fatal(err)
			}
			if message.Subject == "" || !strings.Contains(message.Text, "https://app.example/reset-password?token=abc&x=1") {
				t.Fatalf("%s/%s text = %q", kind, language, message.Text)
			}
			if !strings.Contains(message.HTML, `lang="`+language+`"`) || !strings.Contains(message.HTML, "ada@example.com") || !strings.Contains(message.HTML, "prefers-color-scheme: dark") {
				t.Fatalf("%s/%s html incomplete", kind, language)
			}
			if !strings.Contains(message.HTML, "token=abc&amp;x=1") {
				t.Fatalf("%s/%s link not escaped for HTML", kind, language)
			}
		}
	}
	if NormalizeLanguage("fr-FR") != "fr" || NormalizeLanguage("it") != "en" || NormalizeLanguage("") != "en" {
		t.Fatal("language normalization")
	}
}

func TestRenderEscapesEmail(t *testing.T) {
	message, err := Render(KindVerifyEmail, "en", "<b>x</b>@example.com", "https://app.example/verify-email?token=t")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(message.HTML, "<b>x</b>") {
		t.Fatal("recipient must be escaped")
	}
}

func TestResendSender(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/emails" || r.Header.Get("Authorization") != "Bearer re_test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"1"}`))
	}))
	defer server.Close()
	sender := New(Config{APIKey: "re_test", From: "Prior <no-reply@example.com>", BaseURL: server.URL})
	if err := sender.Send(context.Background(), Message{To: "ada@example.com", Subject: "Hi", HTML: "<p>x</p>", Text: "x"}); err != nil {
		t.Fatal(err)
	}
	if got["from"] != "Prior <no-reply@example.com>" || got["subject"] != "Hi" {
		t.Fatalf("payload = %v", got)
	}
	failing := New(Config{APIKey: "wrong", BaseURL: server.URL})
	if err := failing.Send(context.Background(), Message{To: "a@b.c"}); err == nil {
		t.Fatal("expected an error on 401")
	}
}

func TestSenderSelection(t *testing.T) {
	if _, ok := New(Config{}).(LogSender); !ok {
		t.Fatal("development without key logs")
	}
	if err := New(Config{Production: true}).Send(context.Background(), Message{}); err == nil {
		t.Fatal("production without key must not pretend to send")
	}
}
