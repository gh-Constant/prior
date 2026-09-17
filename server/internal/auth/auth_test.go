package auth

import (
	"testing"

	"github.com/gh-Constant/prior/server/internal/config"
)

func TestValidateReturnTo(t *testing.T) {
	manager := NewManager(config.Config{AllowedReturnOrigins: []string{"prior://auth/callback", "https://app.prior.constantsuchet.fr/auth/callback"}}, nil)
	valid, err := manager.validateReturnTo("prior://auth/callback")
	if err != nil || valid != "prior://auth/callback" {
		t.Fatalf("valid return URL rejected: %q %v", valid, err)
	}
	for _, candidate := range []string{"https://evil.example/callback", "prior://auth/callback?next=https://evil.example", "javascript:alert(1)"} {
		if _, err := manager.validateReturnTo(candidate); err == nil {
			t.Fatalf("expected %q to be rejected", candidate)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	got, err := normalizeEmail("  Person@Example.COM ")
	if err != nil || got != "person@example.com" {
		t.Fatalf("normalizeEmail() = %q, %v", got, err)
	}
	for _, value := range []string{"not-an-email", "Name <person@example.com>", ""} {
		if _, err := normalizeEmail(value); err == nil {
			t.Fatalf("normalizeEmail(%q) accepted invalid email", value)
		}
	}
}

func TestValidatePassword(t *testing.T) {
	if err := validatePassword("1234567"); err == nil {
		t.Fatal("short password accepted")
	}
	if err := validatePassword("12345678"); err != nil {
		t.Fatalf("valid password rejected: %v", err)
	}
}

func TestValidNativeAudience(t *testing.T) {
	fallback := NewManager(config.Config{GoogleClientID: "server-client.apps.googleusercontent.com"}, nil)
	if !fallback.validNativeAudience([]string{"server-client.apps.googleusercontent.com"}) {
		t.Fatal("server client audience rejected by default")
	}
	if fallback.validNativeAudience([]string{"android-client.apps.googleusercontent.com"}) {
		t.Fatal("foreign audience accepted by default")
	}
	custom := NewManager(config.Config{
		GoogleClientID:        "server-client.apps.googleusercontent.com",
		GoogleNativeAudiences: []string{"android-client.apps.googleusercontent.com"},
	}, nil)
	if !custom.validNativeAudience([]string{"other", "android-client.apps.googleusercontent.com"}) {
		t.Fatal("allowlisted Android audience rejected")
	}
	if custom.validNativeAudience([]string{"server-client.apps.googleusercontent.com"}) {
		t.Fatal("server client audience accepted when custom allowlist is set")
	}
	if custom.validNativeAudience(nil) || custom.validNativeAudience([]string{""}) {
		t.Fatal("empty audience accepted")
	}
}
