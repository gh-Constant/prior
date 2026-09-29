# Billing, plans and admin dashboard

## Plans

Plans live in code, in `server/internal/billing/plans.go`. Prices include VAT (`tax_behavior=inclusive`).

| Plan | Monthly | Yearly | Prior AI | Assistant tokens / month | People per shared project | Shared projects |
|---|---|---|---|---|---|---|
| Free | 0 € | 0 € | No (own OpenRouter key or Codex) | – | 2 | 3 |
| Pro | 20 € | 192 € | Yes | 2M | 10 | Unlimited |
| Team | 50 € | 480 € | Yes | 8M | 50 | Unlimited |
| Enterprise | 199 € | 1 910 € | Yes | 30M | Unlimited | Unlimited |

- Prior AI recommendations, drafts and dictation are unlimited on paid plans; the hosted daily request cap (`AI_DAILY_REQUESTS_PER_USER`) stays as an abuse backstop.
- The assistant is metered in tokens per UTC calendar month, from the tokens OpenRouter reports.
- Share limits apply when the owner invites someone. People already in a project stay; re-inviting someone already in the project does not count twice. A refused invite returns `402 {"code":"PLAN_LIMIT","limit":"members"|"projects"}`.
- The admin accounts (`ADMIN_EMAILS`, verified email) get Enterprise and unlimited Prior AI.

`hostedAIEntitlement` (`server/internal/httpapi/entitlement.go`) is the only Prior AI gate; it reads the plan.

## Stripe

Environment variables on the API service (Coolify), never in the repository:

- `STRIPE_SECRET_KEY`: `sk_test_…` or `sk_live_…`.
- `STRIPE_PUBLISHABLE_KEY`: kept for future client-side Stripe use; not required today.
- `STRIPE_WEBHOOK_SECRET`: optional, only when the webhook endpoint is created by hand.
- `BILLING_RETURN_URL`: where Checkout and the portal return by default (`https://app.prior.constantsuchet.fr/`).
- `ADMIN_EMAILS`: comma-separated admin accounts (default `constantsuchet@gmail.com`).

On every start the API runs `BootstrapBilling`, which is idempotent:

1. Finds or creates one product per paid plan (`metadata.prior_plan`) and one price per plan and interval, identified by lookup key `prior_<plan>_<month|year>`. If an amount changes in code, a new price takes over the lookup key.
2. Finds or creates a customer-portal configuration (`metadata.prior_managed=true`) that allows switching between the plans, updating the card, invoices and cancelling at period end.
3. When `STRIPE_WEBHOOK_SECRET` is empty and `PUBLIC_API_URL` is a public https URL, finds or creates a webhook endpoint at `PUBLIC_API_URL/v1/billing/webhook` and stores its signing secret in `billing_state`, sealed with `SETTINGS_ENCRYPTION_KEY`.

Test and live keys each get their own catalog, portal configuration and webhook, since Stripe keeps the modes apart.

Subscription state is mirrored into `subscriptions` by the webhook (`checkout.session.completed`, `customer.subscription.*`, `invoice.paid`) and by `POST /v1/billing/sync`, which the client calls on return from Checkout (`?billing=success&session_id=…`). Billing therefore works even before a webhook is reachable.

## Endpoints

- `GET /v1/billing`: plan, source (`free`, `stripe`, `admin`), subscription, entitlements and usage, catalog, `isAdmin`.
- `POST /v1/billing/checkout {plan, interval, returnUrl, locale}`: returns a Checkout URL, or a portal URL when already subscribed (plan changes go through the portal so they prorate).
- `POST /v1/billing/portal {returnUrl}`: Stripe customer portal.
- `POST /v1/billing/sync {sessionId?}`: pulls the subscription and paid invoices from Stripe.
- `POST /v1/billing/webhook`: Stripe webhook, signature checked against every known secret.
- `GET /v1/admin/overview`, `GET /v1/admin/users?q=&plan=&sort=&limit=&offset=`, `PUT /v1/admin/users/{id}/plan {plan}`: admin only (403 otherwise). An empty plan removes a granted plan.

Return URLs must be on an origin the API already trusts for CORS; anything else falls back to `BILLING_RETURN_URL`.

## Admin dashboard

The app shows **Admin** in the sidebar only when `GET /v1/billing` says `isAdmin`; access is enforced on the server. It shows users, weekly activity, paying subscribers, MRR, revenue, Prior AI spend (from OpenRouter's reported cost, `hosted_ai_usage.cost_micros`), plan mix, spend by use, top spenders, latest payments and a searchable user list where the admin can grant any plan.
