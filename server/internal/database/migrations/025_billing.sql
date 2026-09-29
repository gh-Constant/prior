-- Paid plans. One row per account that has ever touched billing. The plan
-- an account gets is admin_plan when an admin granted one, otherwise the
-- Stripe plan while its status is active, trialing or past_due, otherwise
-- free. Plan ids and prices live in server/internal/billing/plans.go.
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
    status TEXT NOT NULL DEFAULT 'none',
    billing_interval TEXT NOT NULL DEFAULT '' CHECK (billing_interval IN ('', 'month', 'year')),
    amount_cents BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'eur',
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    admin_plan TEXT CHECK (admin_plan IN ('free', 'pro', 'team', 'enterprise')),
    admin_plan_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions(status, plan);

-- Paid Stripe invoices, for revenue reporting in the admin dashboard.
CREATE TABLE IF NOT EXISTS billing_payments (
    stripe_invoice_id TEXT PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'eur',
    paid_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_payments_paid_at_idx ON billing_payments(paid_at);
CREATE INDEX IF NOT EXISTS billing_payments_user_idx ON billing_payments(user_id);

-- Server-managed billing values, e.g. the signing secret of the Stripe
-- webhook endpoint the API creates for itself (sealed like user secrets).
CREATE TABLE IF NOT EXISTS billing_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What Prior AI actually cost, as reported by OpenRouter (USD millionths).
ALTER TABLE hosted_ai_usage
    ADD COLUMN IF NOT EXISTS cost_micros BIGINT NOT NULL DEFAULT 0;
