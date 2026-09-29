package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gh-Constant/prior/server/internal/billing"
	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

// Paid plans. Plans and prices are defined in internal/billing; Stripe is
// the source of truth for who pays, mirrored into the subscriptions table by
// the webhook and by /v1/billing/sync (called when the user comes back from
// Checkout), so billing keeps working even before a webhook is configured.

type billingRuntime struct {
	mu             sync.Mutex
	webhookSecrets []string
}

func (s *Server) isAdmin(user store.User) bool {
	return user.EmailVerified && emailListed(s.cfg.Billing.AdminEmails, user.Email)
}

// planFor returns the plan the account uses right now. Admin accounts get
// Enterprise unless an explicit plan was set on them.
func (s *Server) planFor(ctx context.Context, user store.User) (billing.PlanID, store.Subscription, error) {
	if s.store == nil {
		return billing.PlanFree, store.Subscription{}, nil
	}
	sub, err := s.store.GetSubscription(ctx, user.ID)
	if err != nil {
		return billing.PlanFree, sub, err
	}
	plan := sub.EffectivePlan()
	if s.isAdmin(user) && sub.AdminPlan == nil && plan == billing.PlanFree {
		plan = billing.PlanEnterprise
	}
	return plan, sub, nil
}

func (s *Server) entitlements(ctx context.Context, user store.User) (billing.Entitlements, store.Subscription, error) {
	plan, sub, err := s.planFor(ctx, user)
	if err != nil {
		return billing.EntitlementsFor(billing.PlanFree, 0, time.Now()), sub, err
	}
	used := int64(0)
	if billing.Lookup(plan).HostedAI {
		used, err = s.store.HostedAITokensSince(ctx, user.ID, billing.MonthStart(time.Now()), "agent")
		if err != nil {
			return billing.EntitlementsFor(plan, 0, time.Now()), sub, err
		}
	}
	return billing.EntitlementsFor(plan, used, time.Now()), sub, nil
}

type billingResponse struct {
	Plan             billing.PlanID       `json:"plan"`
	Source           string               `json:"source"`
	Subscription     store.Subscription   `json:"subscription"`
	Entitlements     billing.Entitlements `json:"entitlements"`
	Plans            []billing.Plan       `json:"plans"`
	Currency         string               `json:"currency"`
	StripeEnabled    bool                 `json:"stripeEnabled"`
	HostedAIReady    bool                 `json:"hostedAIReady"`
	IsAdmin          bool                 `json:"isAdmin"`
	HasBillingPortal bool                 `json:"hasBillingPortal"`
}

func (s *Server) billingState(ctx context.Context, user store.User) (billingResponse, error) {
	ent, sub, err := s.entitlements(ctx, user)
	if err != nil {
		return billingResponse{}, err
	}
	source := sub.Source()
	if source == "free" && ent.Plan != billing.PlanFree {
		source = "admin"
	}
	return billingResponse{
		Plan:             ent.Plan,
		Source:           source,
		Subscription:     sub,
		Entitlements:     ent,
		Plans:            billing.Plans(),
		Currency:         billing.Currency,
		StripeEnabled:    s.stripe.Enabled(),
		HostedAIReady:    s.cfg.HostedAI.Enabled(),
		IsAdmin:          s.isAdmin(user),
		HasBillingPortal: s.stripe.Enabled() && sub.StripeCustomerID != "",
	}, nil
}

func (s *Server) getBilling(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	state, err := s.billingState(r.Context(), user)
	if err != nil {
		slog.Warn("billing state failed", "user_id_hash", userIDHash(user.ID), "error", err)
		writeError(w, http.StatusInternalServerError, errors.New("unable to load your plan"))
		return
	}
	writeJSON(w, http.StatusOK, state)
}

// billingReturnURL keeps Stripe redirects on Prior's own web origins.
func (s *Server) billingReturnURL(requested string) string {
	if parsed, err := url.Parse(strings.TrimSpace(requested)); err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != "" {
		origin := parsed.Scheme + "://" + parsed.Host
		if allowedOrigin(origin) || origin == originOf(s.cfg.Billing.ReturnURL) {
			parsed.RawQuery, parsed.Fragment = "", ""
			return parsed.String()
		}
	}
	return s.cfg.Billing.ReturnURL
}

func originOf(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func withQuery(base, query string) string {
	if strings.Contains(base, "?") {
		return base + "&" + query
	}
	return base + "?" + query
}

var checkoutLocales = map[string]bool{"fr": true, "en": true, "de": true, "es": true, "pt": true}

func (s *Server) billingCheckout(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.stripe.Enabled() {
		writeError(w, http.StatusServiceUnavailable, errors.New("payments are not configured on this server"))
		return
	}
	var body struct {
		Plan      string `json:"plan"`
		Interval  string `json:"interval"`
		ReturnURL string `json:"returnUrl"`
		Locale    string `json:"locale"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid checkout request"))
		return
	}
	planID, ok := billing.ParsePlan(body.Plan)
	if !ok || !billing.Lookup(planID).Paid() {
		writeError(w, http.StatusBadRequest, errors.New("unknown plan"))
		return
	}
	interval := billing.Interval(body.Interval)
	if interval != billing.Yearly {
		interval = billing.Monthly
	}
	returnURL := s.billingReturnURL(body.ReturnURL)
	sub, err := s.store.GetSubscription(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load your plan"))
		return
	}
	// Changing plan while subscribed goes through the portal, which prorates.
	if sub.StripeActive() && sub.StripeCustomerID != "" {
		portal, err := s.stripe.CreatePortalSession(r.Context(), sub.StripeCustomerID, returnURL)
		if err != nil {
			s.stripeFailure(w, user.ID, "portal", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"url": portal, "kind": "portal"})
		return
	}
	priceID, err := s.stripe.PriceID(r.Context(), planID, interval)
	if err != nil {
		s.stripeFailure(w, user.ID, "catalog", err)
		return
	}
	customer := sub.StripeCustomerID
	if customer == "" {
		customer, err = s.stripe.CreateCustomer(r.Context(), user.Email, user.DisplayName, user.ID.String())
		if err != nil {
			s.stripeFailure(w, user.ID, "customer", err)
			return
		}
		if err := s.store.SetStripeCustomer(r.Context(), user.ID, customer); err != nil {
			writeError(w, http.StatusInternalServerError, errors.New("unable to start checkout"))
			return
		}
	}
	locale := strings.ToLower(strings.TrimSpace(body.Locale))
	if !checkoutLocales[locale] {
		locale = "auto"
	}
	session, err := s.stripe.CreateCheckoutSession(r.Context(), billing.CheckoutParams{
		Customer:   customer,
		UserID:     user.ID.String(),
		PriceID:    priceID,
		SuccessURL: withQuery(returnURL, "billing=success&session_id={CHECKOUT_SESSION_ID}"),
		CancelURL:  withQuery(returnURL, "billing=cancel"),
		Locale:     locale,
	})
	if err != nil {
		s.stripeFailure(w, user.ID, "checkout", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": session.URL, "kind": "checkout"})
}

func (s *Server) billingPortal(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		ReturnURL string `json:"returnUrl"`
	}
	_ = decodeJSON(r, &body)
	sub, err := s.store.GetSubscription(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load your plan"))
		return
	}
	if !s.stripe.Enabled() || sub.StripeCustomerID == "" {
		writeError(w, http.StatusNotFound, errors.New("no billing account yet"))
		return
	}
	portal, err := s.stripe.CreatePortalSession(r.Context(), sub.StripeCustomerID, s.billingReturnURL(body.ReturnURL))
	if err != nil {
		s.stripeFailure(w, user.ID, "portal", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": portal})
}

// billingSync pulls the account's subscription from Stripe. The client
// calls it when it comes back from Checkout or the portal.
func (s *Server) billingSync(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if s.stripe.Enabled() {
		var body struct {
			SessionID string `json:"sessionId"`
		}
		_ = decodeJSON(r, &body)
		sub, err := s.store.GetSubscription(r.Context(), user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, errors.New("unable to load your plan"))
			return
		}
		customer := sub.StripeCustomerID
		if customer == "" && strings.HasPrefix(body.SessionID, "cs_") {
			if session, err := s.stripe.GetCheckoutSession(r.Context(), body.SessionID); err == nil && session.ClientReferenceID == user.ID.String() && session.Customer != "" {
				customer = session.Customer
				if err := s.store.SetStripeCustomer(r.Context(), user.ID, customer); err != nil {
					writeError(w, http.StatusInternalServerError, errors.New("unable to save your plan"))
					return
				}
			}
		}
		if customer != "" {
			if err := s.syncStripeCustomer(r.Context(), user.ID, customer); err != nil {
				s.stripeFailure(w, user.ID, "sync", err)
				return
			}
		}
	}
	state, err := s.billingState(r.Context(), user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load your plan"))
		return
	}
	writeJSON(w, http.StatusOK, state)
}

// syncStripeCustomer mirrors a customer's best subscription and paid
// invoices into the database.
func (s *Server) syncStripeCustomer(ctx context.Context, userID uuid.UUID, customer string) error {
	subs, err := s.stripe.ListSubscriptions(ctx, customer)
	if err != nil {
		return err
	}
	if best, ok := billing.BestSubscription(subs); ok {
		if err := s.applyStripeSubscription(ctx, userID, best); err != nil {
			return err
		}
	}
	invoices, err := s.stripe.ListPaidInvoices(ctx, customer)
	if err != nil {
		return err
	}
	for _, invoice := range invoices {
		id := userID
		if err := s.store.RecordPayment(ctx, invoice.ID, &id, invoice.AmountPaid, invoice.Currency, invoice.PaidAt()); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) applyStripeSubscription(ctx context.Context, userID uuid.UUID, sub billing.Subscription) error {
	resolved, ok := sub.Resolve()
	if !ok {
		return nil
	}
	return s.store.ApplyStripeSubscription(ctx, userID, store.StripeSubscriptionUpdate{
		CustomerID:        sub.Customer,
		SubscriptionID:    sub.ID,
		Plan:              resolved.Plan,
		Status:            sub.Status,
		Interval:          resolved.Interval,
		AmountCents:       resolved.AmountCents,
		Currency:          resolved.Currency,
		CurrentPeriodEnd:  resolved.PeriodEnd,
		CancelAtPeriodEnd: sub.CancelAtPeriodEnd,
	})
}

// stripeFailure logs Stripe's message (never the key) and returns a generic
// error to the client.
func (s *Server) stripeFailure(w http.ResponseWriter, userID uuid.UUID, step string, err error) {
	slog.Warn("stripe request failed", "step", step, "user_id_hash", userIDHash(userID), "error", err)
	writeError(w, http.StatusBadGateway, errors.New("the payment service is unavailable, please try again"))
}

const maxWebhookBytes = 1 << 20

func (s *Server) billingWebhook(w http.ResponseWriter, r *http.Request) {
	payload, err := io.ReadAll(io.LimitReader(r.Body, maxWebhookBytes+1))
	if err != nil || len(payload) > maxWebhookBytes {
		writeError(w, http.StatusBadRequest, errors.New("invalid payload"))
		return
	}
	event, err := billing.VerifyWebhook(payload, r.Header.Get("Stripe-Signature"), s.webhookSecrets(r.Context()), time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.handleStripeEvent(r.Context(), event); err != nil {
		slog.Warn("stripe webhook failed", "type", event.Type, "event", event.ID, "error", err)
		// A 5xx makes Stripe retry the event later.
		writeError(w, http.StatusInternalServerError, errors.New("webhook processing failed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"received": true})
}

func (s *Server) handleStripeEvent(ctx context.Context, event billing.Event) error {
	switch event.Type {
	case "checkout.session.completed":
		var session billing.CheckoutSession
		if err := json.Unmarshal(event.Data.Object, &session); err != nil {
			return err
		}
		if session.Customer == "" {
			return nil
		}
		userID, err := s.store.UserForStripeCustomer(ctx, session.Customer)
		if errors.Is(err, store.ErrNotFound) {
			parsed, parseErr := uuid.Parse(session.ClientReferenceID)
			if parseErr != nil {
				return nil
			}
			if err := s.store.SetStripeCustomer(ctx, parsed, session.Customer); err != nil {
				return err
			}
			userID, err = parsed, nil
		}
		if err != nil {
			return err
		}
		return s.syncStripeCustomer(ctx, userID, session.Customer)
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		var sub billing.Subscription
		if err := json.Unmarshal(event.Data.Object, &sub); err != nil {
			return err
		}
		userID, err := s.store.UserForStripeCustomer(ctx, sub.Customer)
		if errors.Is(err, store.ErrNotFound) {
			// Checkout's own event may arrive after this one; the
			// subscription metadata carries the account id.
			parsed, parseErr := uuid.Parse(sub.Metadata["prior_user_id"])
			if parseErr != nil {
				return nil
			}
			userID, err = parsed, nil
		}
		if err != nil {
			return err
		}
		return s.applyStripeSubscription(ctx, userID, sub)
	case "invoice.paid":
		var invoice billing.Invoice
		if err := json.Unmarshal(event.Data.Object, &invoice); err != nil {
			return err
		}
		var owner *uuid.UUID
		if userID, err := s.store.UserForStripeCustomer(ctx, invoice.Customer); err == nil {
			owner = &userID
		}
		return s.store.RecordPayment(ctx, invoice.ID, owner, invoice.AmountPaid, invoice.Currency, invoice.PaidAt())
	}
	return nil
}

func (s *Server) webhookSecretKey() string { return "stripe_webhook_secret_" + s.stripe.Mode() }

// webhookSecrets returns every secret a webhook may be signed with: the one
// from the environment and the one of the endpoint the API manages.
func (s *Server) webhookSecrets(ctx context.Context) []string {
	s.billing.mu.Lock()
	defer s.billing.mu.Unlock()
	if len(s.billing.webhookSecrets) == 0 {
		secrets := []string{}
		if secret := strings.TrimSpace(s.cfg.Billing.StripeWebhookSecret); secret != "" {
			secrets = append(secrets, secret)
		}
		if stored, err := s.store.GetBillingState(ctx, s.webhookSecretKey()); err == nil && stored != "" {
			if opened, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored); err == nil && opened != "" {
				secrets = append(secrets, opened)
			}
		}
		s.billing.webhookSecrets = secrets
	}
	return append([]string(nil), s.billing.webhookSecrets...)
}

// BootstrapBilling creates Prior's Stripe catalog (products, prices, portal
// configuration) and, unless STRIPE_WEBHOOK_SECRET is set, a webhook
// endpoint at PUBLIC_API_URL/v1/billing/webhook. It is idempotent and runs
// in the background on every start; failures are logged and retried lazily
// by checkout.
func (s *Server) BootstrapBilling(ctx context.Context) {
	if !s.stripe.Enabled() {
		return
	}
	catalog, err := s.stripe.EnsureCatalog(ctx)
	if err != nil {
		slog.Warn("stripe catalog bootstrap failed", "mode", s.stripe.Mode(), "error", err)
		return
	}
	slog.Info("stripe catalog ready", "mode", s.stripe.Mode(), "prices", len(catalog.Prices))
	if strings.TrimSpace(s.cfg.Billing.StripeWebhookSecret) != "" {
		return
	}
	endpoint := strings.TrimRight(s.cfg.PublicAPIURL, "/") + "/v1/billing/webhook"
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || strings.Contains(parsed.Host, "localhost") || strings.HasPrefix(parsed.Host, "127.") {
		slog.Info("stripe webhook not managed: PUBLIC_API_URL is not a public https URL; billing syncs on return from checkout")
		return
	}
	stored, err := s.store.GetBillingState(ctx, s.webhookSecretKey())
	if err != nil {
		slog.Warn("stripe webhook state unavailable", "error", err)
		return
	}
	known, _ := openSettingsValue(s.cfg.SettingsEncryptionKey, stored)
	secret, err := s.stripe.EnsureWebhook(ctx, endpoint, known)
	if err != nil {
		slog.Warn("stripe webhook bootstrap failed", "error", err)
		return
	}
	if secret == "" {
		return
	}
	sealed, err := sealSettingsValue(s.cfg.SettingsEncryptionKey, secret)
	if err != nil {
		slog.Warn("stripe webhook secret not sealed", "error", err)
		return
	}
	if err := s.store.SetBillingState(ctx, s.webhookSecretKey(), sealed); err != nil {
		slog.Warn("stripe webhook secret not saved", "error", err)
		return
	}
	s.billing.mu.Lock()
	s.billing.webhookSecrets = nil
	s.billing.mu.Unlock()
	slog.Info("stripe webhook endpoint created", "mode", s.stripe.Mode(), "url", endpoint)
}

// checkShareLimit enforces the owner's plan when a project grows. It
// returns a message for the client when the invite would exceed the plan.
func (s *Server) checkShareLimit(ctx context.Context, user store.User, projectID uuid.UUID, email string) (string, string, error) {
	ownerID, people, otherShared, err := s.store.ProjectShareSize(ctx, projectID)
	if err != nil || ownerID != user.ID {
		// Unknown projects and non-owners are rejected by the store call.
		return "", "", nil
	}
	already, err := s.store.IsProjectMemberEmail(ctx, projectID, email)
	if err != nil {
		return "", "", err
	}
	if already {
		return "", "", nil
	}
	ent, _, err := s.entitlements(ctx, user)
	if err != nil {
		return "", "", err
	}
	if people == 1 && !ent.AllowsSharedProjects(otherShared+1) {
		return "projects", fmt.Sprintf("your plan shares up to %d projects; upgrade to share more", ent.MaxSharedProjects), nil
	}
	if !ent.AllowsMembers(people + 1) {
		return "members", fmt.Sprintf("your plan allows %d people per shared project; upgrade to invite more", ent.MaxMembersPerProject), nil
	}
	return "", "", nil
}
