package httpapi

import (
	"context"
	"log/slog"
	"strings"

	"github.com/gh-Constant/prior/server/internal/billing"
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
// Paid plans (internal/billing) include Prior AI with a monthly assistant
// token budget. The admin account and the emails in
// AI_HOSTED_ALLOWED_EMAILS (testers) have access without a token cap.
func (s *Server) hostedAIEntitlement(ctx context.Context, user store.User) HostedAIEntitlement {
	if s.isAdmin(user) || emailListed(s.cfg.HostedAI.AllowedEmails, user.Email) {
		return HostedAIEntitlement{Allowed: true, Plan: "staff"}
	}
	planID, _, err := s.planFor(ctx, user)
	if err != nil {
		slog.Warn("plan lookup failed", "user_id_hash", userIDHash(user.ID), "error", err)
		return HostedAIEntitlement{}
	}
	plan := billing.Lookup(planID)
	if !plan.HostedAI || plan.AgentTokensPerMonth <= 0 {
		return HostedAIEntitlement{Plan: string(plan.ID)}
	}
	return HostedAIEntitlement{Allowed: true, Plan: string(plan.ID), AgentTokensPerMonth: plan.AgentTokensPerMonth}
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
