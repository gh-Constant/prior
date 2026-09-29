package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/billing"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Subscription is an account's billing row. The zero value is a free
// account that never subscribed.
type Subscription struct {
	UserID               uuid.UUID `json:"-"`
	StripeCustomerID     string    `json:"-"`
	StripeSubscriptionID string    `json:"-"`
	// Plan and Status mirror the Stripe subscription.
	Plan              billing.PlanID   `json:"stripePlan"`
	Status            string           `json:"status"`
	Interval          billing.Interval `json:"interval,omitempty"`
	AmountCents       int64            `json:"amountCents"`
	Currency          string           `json:"currency"`
	CurrentPeriodEnd  *time.Time       `json:"currentPeriodEnd,omitempty"`
	CancelAtPeriodEnd bool             `json:"cancelAtPeriodEnd"`
	// AdminPlan overrides everything when an admin granted a plan.
	AdminPlan *billing.PlanID `json:"adminPlan,omitempty"`
}

// StripeActive reports whether the Stripe subscription currently grants
// its plan.
func (s Subscription) StripeActive() bool {
	return s.StripeSubscriptionID != "" && billing.ActiveStatus(s.Status) && billing.Lookup(s.Plan).Paid()
}

// EffectivePlan is the plan the account uses right now.
func (s Subscription) EffectivePlan() billing.PlanID {
	if s.AdminPlan != nil {
		return *s.AdminPlan
	}
	if s.StripeActive() {
		return s.Plan
	}
	return billing.PlanFree
}

// Source says where the effective plan comes from: admin, stripe or free.
func (s Subscription) Source() string {
	switch {
	case s.AdminPlan != nil:
		return "admin"
	case s.StripeActive():
		return "stripe"
	default:
		return "free"
	}
}

// effectivePlanSQL mirrors Subscription.EffectivePlan for reports. It expects
// the subscriptions table aliased as sub.
const effectivePlanSQL = `CASE
	WHEN sub.admin_plan IS NOT NULL THEN sub.admin_plan
	WHEN sub.stripe_subscription_id IS NOT NULL AND sub.status IN ('active', 'trialing', 'past_due') THEN sub.plan
	ELSE 'free' END`

const subscriptionColumns = `user_id, COALESCE(stripe_customer_id, ''), COALESCE(stripe_subscription_id, ''), plan, status,
	billing_interval, amount_cents, currency, current_period_end, cancel_at_period_end, admin_plan`

func scanSubscription(row pgx.Row) (Subscription, error) {
	var sub Subscription
	var plan, interval string
	var adminPlan *string
	if err := row.Scan(&sub.UserID, &sub.StripeCustomerID, &sub.StripeSubscriptionID, &plan, &sub.Status, &interval,
		&sub.AmountCents, &sub.Currency, &sub.CurrentPeriodEnd, &sub.CancelAtPeriodEnd, &adminPlan); err != nil {
		return Subscription{}, err
	}
	sub.Plan = billing.PlanID(plan)
	sub.Interval = billing.Interval(interval)
	if adminPlan != nil {
		id := billing.PlanID(*adminPlan)
		sub.AdminPlan = &id
	}
	return sub, nil
}

// GetSubscription returns the account's billing row, or a free zero value.
func (s *Store) GetSubscription(ctx context.Context, userID uuid.UUID) (Subscription, error) {
	sub, err := scanSubscription(s.pool.QueryRow(ctx, `SELECT `+subscriptionColumns+` FROM subscriptions WHERE user_id = $1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Subscription{UserID: userID, Plan: billing.PlanFree, Status: "none", Currency: billing.Currency}, nil
	}
	return sub, err
}

// SetStripeCustomer links an account to its Stripe customer.
func (s *Store) SetStripeCustomer(ctx context.Context, userID uuid.UUID, customerID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO subscriptions (user_id, stripe_customer_id) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = now()`,
		userID, customerID)
	return err
}

// UserForStripeCustomer finds the account that owns a Stripe customer.
func (s *Store) UserForStripeCustomer(ctx context.Context, customerID string) (uuid.UUID, error) {
	var userID uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1`, customerID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	return userID, err
}

// StripeSubscriptionUpdate is the state of one Stripe subscription.
type StripeSubscriptionUpdate struct {
	CustomerID        string
	SubscriptionID    string
	Plan              billing.PlanID
	Status            string
	Interval          billing.Interval
	AmountCents       int64
	Currency          string
	CurrentPeriodEnd  time.Time
	CancelAtPeriodEnd bool
}

// ApplyStripeSubscription stores a subscription's state. An update for a
// different subscription than the stored one only wins when it is active or
// the stored one is not, so a stale "canceled" event for an old
// subscription cannot downgrade a customer who re-subscribed.
func (s *Store) ApplyStripeSubscription(ctx context.Context, userID uuid.UUID, update StripeSubscriptionUpdate) error {
	var periodEnd *time.Time
	if !update.CurrentPeriodEnd.IsZero() {
		value := update.CurrentPeriodEnd.UTC()
		periodEnd = &value
	}
	currency := strings.ToLower(update.Currency)
	if currency == "" {
		currency = billing.Currency
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, billing_interval,
			amount_cents, currency, current_period_end, cancel_at_period_end)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (user_id) DO UPDATE SET
			stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
			stripe_subscription_id = EXCLUDED.stripe_subscription_id,
			plan = EXCLUDED.plan, status = EXCLUDED.status, billing_interval = EXCLUDED.billing_interval,
			amount_cents = EXCLUDED.amount_cents, currency = EXCLUDED.currency,
			current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
			updated_at = now()
		WHERE subscriptions.stripe_subscription_id IS NULL
			OR subscriptions.stripe_subscription_id = EXCLUDED.stripe_subscription_id
			OR EXCLUDED.status IN ('active', 'trialing', 'past_due')
			OR subscriptions.status NOT IN ('active', 'trialing', 'past_due')`,
		userID, update.CustomerID, update.SubscriptionID, string(update.Plan), update.Status, string(update.Interval),
		update.AmountCents, currency, periodEnd, update.CancelAtPeriodEnd)
	return err
}

// RecordPayment stores one paid invoice. Replays are ignored.
func (s *Store) RecordPayment(ctx context.Context, invoiceID string, userID *uuid.UUID, amountCents int64, currency string, paidAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO billing_payments (stripe_invoice_id, user_id, amount_cents, currency, paid_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (stripe_invoice_id) DO UPDATE SET user_id = COALESCE(EXCLUDED.user_id, billing_payments.user_id)`,
		invoiceID, userID, amountCents, strings.ToLower(currency), paidAt.UTC())
	return err
}

// SetAdminPlan grants a plan regardless of Stripe; nil removes the grant.
func (s *Store) SetAdminPlan(ctx context.Context, userID uuid.UUID, plan *billing.PlanID, note string) error {
	var value *string
	if plan != nil {
		text := string(*plan)
		value = &text
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO subscriptions (user_id, admin_plan, admin_plan_note)
		SELECT id, $2, $3 FROM users WHERE id = $1
		ON CONFLICT (user_id) DO UPDATE SET admin_plan = EXCLUDED.admin_plan, admin_plan_note = EXCLUDED.admin_plan_note, updated_at = now()`,
		userID, value, note)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetBillingState(ctx context.Context, key string) (string, error) {
	var value string
	err := s.pool.QueryRow(ctx, `SELECT value FROM billing_state WHERE key = $1`, key).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return value, err
}

func (s *Store) SetBillingState(ctx context.Context, key, value string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO billing_state (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}

// ProjectShareSize returns a project's owner, the people in it (active
// members, owner included, plus pending invites) and how many other
// projects that owner already shares.
func (s *Store) ProjectShareSize(ctx context.Context, projectID uuid.UUID) (ownerID uuid.UUID, people int, otherSharedProjects int, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT o.user_id,
			1 + (SELECT count(*) FROM project_members WHERE project_id = $1 AND status = 'active' AND user_id <> o.user_id)
			  + (SELECT count(*) FROM project_invites WHERE project_id = $1 AND accepted_at IS NULL AND expires_at > now()),
			(SELECT count(*) FROM projects p
				WHERE p.user_id = o.user_id AND p.id <> $1 AND (
					EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.status = 'active' AND m.user_id <> o.user_id)
					OR EXISTS (SELECT 1 FROM project_invites i WHERE i.project_id = p.id AND i.accepted_at IS NULL AND i.expires_at > now())))
		FROM projects o WHERE o.id = $1`, projectID).Scan(&ownerID, &people, &otherSharedProjects)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, 0, 0, ErrNotFound
	}
	return ownerID, people, otherSharedProjects, err
}

// IsProjectMemberEmail reports whether the email is already an active
// member or has a pending invite, so inviting it again (for example to
// change the role) does not grow the project.
func (s *Store) IsProjectMemberEmail(ctx context.Context, projectID uuid.UUID, email string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM project_members m JOIN users u ON u.id = m.user_id
			WHERE m.project_id = $1 AND m.status = 'active' AND lower(u.email) = $2
		) OR EXISTS (
			SELECT 1 FROM project_invites WHERE project_id = $1 AND invitee_email = $2 AND accepted_at IS NULL AND expires_at > now()
		)`, projectID, normalizeEmailValue(email)).Scan(&exists)
	return exists, err
}
