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
