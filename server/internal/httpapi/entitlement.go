package httpapi

import (
	"context"
	"strings"

	"github.com/gh-Constant/prior/server/internal/store"
)

// HostedAIEntitlement says whether a user may use Prior AI (the operator's
// paid provider key) and with which quotas. Users without it can still use
// their own OpenRouter key or Codex.
type HostedAIEntitlement struct {
	Allowed bool   `json:"allowed"`
	Plan    string `json:"plan,omitempty"`
	// AgentTokensPerMonth caps assistant chat tokens per calendar month
	// (UTC). Zero means unlimited. Recommendations, mail, calendar drafts
	// and dictation are not token-capped.
	AgentTokensPerMonth int64 `json:"agentTokensPerMonth"`
}

// hostedAIEntitlement is the single gate for Prior AI. Every hosted
// completion and transcription goes through it, so plans only need to be
// plugged in here: look up the user's paid plan and return its quotas.
//
// Until plans exist, only the emails in AI_HOSTED_ALLOWED_EMAILS (the
// operator and testers) have access, without a token cap.
func (s *Server) hostedAIEntitlement(_ context.Context, user store.User) HostedAIEntitlement {
	if emailListed(s.cfg.HostedAI.AllowedEmails, user.Email) {
		return HostedAIEntitlement{Allowed: true, Plan: "staff"}
	}
	return HostedAIEntitlement{}
}

func emailListed(list []string, email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return false
	}
	for _, candidate := range list {
		if strings.ToLower(strings.TrimSpace(candidate)) == email {
			return true
		}
	}
	return false
}
