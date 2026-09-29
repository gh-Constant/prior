// Package billing holds Prior's plan catalog, the entitlements each plan
// grants, and a small Stripe client. Plans are defined here, in code, and
// the server creates the matching Stripe products and prices itself (see
// Stripe.EnsureCatalog), so prices never have to be set up by hand.
package billing

import (
	"strings"
	"time"
)

type PlanID string

const (
	PlanFree       PlanID = "free"
	PlanPro        PlanID = "pro"
	PlanTeam       PlanID = "team"
	PlanEnterprise PlanID = "enterprise"
)

type Interval string

const (
	Monthly Interval = "month"
	Yearly  Interval = "year"
)

// Plan is one offer. Limits of 0 mean unlimited, except AgentTokensPerMonth
// where 0 means the hosted agent is not included.
type Plan struct {
	ID   PlanID `json:"id"`
	Name string `json:"name"`
	// Prices in euro cents. Free plans have no price.
	MonthlyCents int64 `json:"monthlyCents"`
	YearlyCents  int64 `json:"yearlyCents"`
	// People in one shared project, owner included.
	MaxMembersPerProject int `json:"maxMembersPerProject"`
	// Projects the account owns that have at least one other member.
	MaxSharedProjects int `json:"maxSharedProjects"`
	// Prior AI (the server's OpenRouter key): recommendations, drafts and
	// dictation are unlimited under fair use; the agent is token-limited.
	HostedAI            bool  `json:"hostedAI"`
	AgentTokensPerMonth int64 `json:"agentTokensPerMonth"`
}

// Currency is the only currency Prior sells in.
const Currency = "eur"

var catalog = []Plan{
	{ID: PlanFree, Name: "Free", MaxMembersPerProject: 2, MaxSharedProjects: 3},
	{ID: PlanPro, Name: "Pro", MonthlyCents: 2000, YearlyCents: 19200, MaxMembersPerProject: 10, HostedAI: true, AgentTokensPerMonth: 2_000_000},
	{ID: PlanTeam, Name: "Team", MonthlyCents: 5000, YearlyCents: 48000, MaxMembersPerProject: 50, HostedAI: true, AgentTokensPerMonth: 8_000_000},
	{ID: PlanEnterprise, Name: "Enterprise", MonthlyCents: 19900, YearlyCents: 191000, HostedAI: true, AgentTokensPerMonth: 30_000_000},
}

// Plans returns the catalog in display order.
func Plans() []Plan {
	out := make([]Plan, len(catalog))
	copy(out, catalog)
	return out
}

// Lookup returns a plan by id. Unknown ids resolve to Free.
func Lookup(id PlanID) Plan {
	for _, plan := range catalog {
		if plan.ID == id {
			return plan
		}
	}
	return catalog[0]
}

// ParsePlan validates a plan id coming from a client or from Stripe.
func ParsePlan(value string) (PlanID, bool) {
	id := PlanID(strings.ToLower(strings.TrimSpace(value)))
	for _, plan := range catalog {
		if plan.ID == id {
			return id, true
		}
	}
	return "", false
}

// Paid reports whether the plan is sold through Stripe.
func (p Plan) Paid() bool { return p.MonthlyCents > 0 }

// PriceCents returns the recurring amount for an interval.
func (p Plan) PriceCents(interval Interval) int64 {
	if interval == Yearly {
		return p.YearlyCents
	}
	return p.MonthlyCents
}

// LookupKey is the Stripe price lookup_key for a plan and interval, e.g.
// "prior_pro_month". It is how the server finds its own prices again.
func LookupKey(plan PlanID, interval Interval) string {
	return "prior_" + string(plan) + "_" + string(interval)
}

// ParseLookupKey is the inverse of LookupKey.
func ParseLookupKey(key string) (PlanID, Interval, bool) {
	rest, ok := strings.CutPrefix(key, "prior_")
	if !ok {
		return "", "", false
	}
	planPart, intervalPart, ok := strings.Cut(rest, "_")
	if !ok {
		return "", "", false
	}
	plan, ok := ParsePlan(planPart)
	if !ok || !Lookup(plan).Paid() {
		return "", "", false
	}
	switch Interval(intervalPart) {
	case Monthly, Yearly:
		return plan, Interval(intervalPart), true
	}
	return "", "", false
}

// ActiveStatus reports whether a Stripe subscription status still grants
// the plan. past_due keeps access while Stripe retries the payment.
func ActiveStatus(status string) bool {
	switch status {
	case "active", "trialing", "past_due":
		return true
	}
	return false
}

// Entitlements is what one account may use right now.
type Entitlements struct {
	Plan                PlanID `json:"plan"`
	HostedAI            bool   `json:"hostedAI"`
	AgentTokensPerMonth int64  `json:"agentTokensPerMonth"`
	AgentTokensUsed     int64  `json:"agentTokensUsed"`
	// Start of the current quota month (UTC).
	UsagePeriodStart     time.Time `json:"usagePeriodStart"`
	MaxMembersPerProject int       `json:"maxMembersPerProject"`
	MaxSharedProjects    int       `json:"maxSharedProjects"`
}

// EntitlementsFor builds the entitlements of a plan given the agent tokens
// already used this month.
func EntitlementsFor(id PlanID, agentTokensUsed int64, now time.Time) Entitlements {
	plan := Lookup(id)
	return Entitlements{
		Plan:                 plan.ID,
		HostedAI:             plan.HostedAI,
		AgentTokensPerMonth:  plan.AgentTokensPerMonth,
		AgentTokensUsed:      agentTokensUsed,
		UsagePeriodStart:     MonthStart(now),
		MaxMembersPerProject: plan.MaxMembersPerProject,
		MaxSharedProjects:    plan.MaxSharedProjects,
	}
}

// AllowsMembers reports whether a project may grow to `members` people
// (owner included).
func (e Entitlements) AllowsMembers(members int) bool {
	return e.MaxMembersPerProject <= 0 || members <= e.MaxMembersPerProject
}

// AllowsSharedProjects reports whether the account may own `count` shared
// projects.
func (e Entitlements) AllowsSharedProjects(count int) bool {
	return e.MaxSharedProjects <= 0 || count <= e.MaxSharedProjects
}

// MonthStart returns the first instant of now's UTC month.
func MonthStart(now time.Time) time.Time {
	now = now.UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
}
