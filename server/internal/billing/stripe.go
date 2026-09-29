package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// StripeAPIVersion pins the request and managed-webhook payload shape.
const StripeAPIVersion = "2025-03-31.basil"

// WebhookEvents are the events Prior's webhook listens to.
var WebhookEvents = []string{
	"checkout.session.completed",
	"customer.subscription.created",
	"customer.subscription.updated",
	"customer.subscription.deleted",
	"invoice.paid",
}

// Stripe is a minimal form-encoded client for the handful of Stripe
// endpoints Prior uses. The secret key only ever comes from the
// environment (STRIPE_SECRET_KEY) and is never logged.
type Stripe struct {
	secret  string
	baseURL string
	client  *http.Client

	mu      sync.Mutex
	catalog *Catalog
}

func NewStripe(secret string, client *http.Client) *Stripe {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &Stripe{secret: strings.TrimSpace(secret), baseURL: "https://api.stripe.com", client: client}
}

// WithBaseURL points the client at a fake server in tests.
func (s *Stripe) WithBaseURL(base string) *Stripe {
	s.baseURL = strings.TrimRight(base, "/")
	return s
}

func (s *Stripe) Enabled() bool { return s != nil && s.secret != "" }

// Live reports whether the key is a live-mode key.
func (s *Stripe) Live() bool {
	return strings.HasPrefix(s.secret, "sk_live_") || strings.HasPrefix(s.secret, "rk_live_")
}

// Mode is "live" or "test"; used to key state that differs per mode.
func (s *Stripe) Mode() string {
	if s.Live() {
		return "live"
	}
	return "test"
}

type StripeError struct {
	Status  int
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *StripeError) Error() string {
	return fmt.Sprintf("stripe %d %s: %s", e.Status, e.Type, e.Message)
}

func (s *Stripe) do(ctx context.Context, method, path string, form url.Values, idempotencyKey string, out any) error {
	if !s.Enabled() {
		return errors.New("stripe is not configured")
	}
	var body io.Reader
	target := s.baseURL + path
	if method == http.MethodGet || method == http.MethodDelete {
		if len(form) > 0 {
			target += "?" + form.Encode()
		}
	} else {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return err
	}
	req.SetBasicAuth(s.secret, "")
	req.Header.Set("Stripe-Version", StripeAPIVersion)
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("stripe request failed: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		var envelope struct {
			Error StripeError `json:"error"`
		}
		_ = json.Unmarshal(raw, &envelope)
		envelope.Error.Status = resp.StatusCode
		if envelope.Error.Message == "" {
			envelope.Error.Message = http.StatusText(resp.StatusCode)
		}
		return &envelope.Error
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// ── Objects ──

type Price struct {
	ID         string            `json:"id"`
	Active     bool              `json:"active"`
	LookupKey  string            `json:"lookup_key"`
	UnitAmount int64             `json:"unit_amount"`
	Currency   string            `json:"currency"`
	Product    json.RawMessage   `json:"product"`
	Metadata   map[string]string `json:"metadata"`
	Recurring  *struct {
		Interval string `json:"interval"`
	} `json:"recurring"`
}

// ProductID returns the product id whether or not the product was expanded.
func (p Price) ProductID() string {
	var id string
	if json.Unmarshal(p.Product, &id) == nil {
		return id
	}
	var object struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(p.Product, &object)
	return object.ID
}

type Product struct {
	ID       string            `json:"id"`
	Active   bool              `json:"active"`
	Name     string            `json:"name"`
	Metadata map[string]string `json:"metadata"`
}

type Subscription struct {
	ID                string            `json:"id"`
	Customer          string            `json:"customer"`
	Status            string            `json:"status"`
	CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
	CurrentPeriodEnd  int64             `json:"current_period_end"`
	Created           int64             `json:"created"`
	Metadata          map[string]string `json:"metadata"`
	Items             struct {
		Data []struct {
			CurrentPeriodEnd int64 `json:"current_period_end"`
			Quantity         int64 `json:"quantity"`
			Price            Price `json:"price"`
		} `json:"data"`
	} `json:"items"`
}

// SubscriptionPlan is what a Stripe subscription means for Prior.
type SubscriptionPlan struct {
	Plan        PlanID
	Interval    Interval
	AmountCents int64
	Currency    string
	PeriodEnd   time.Time
}

// Resolve maps the subscription's price to a Prior plan. Newer API versions
// moved current_period_end to the items, so both places are read.
func (sub Subscription) Resolve() (SubscriptionPlan, bool) {
	for _, item := range sub.Items.Data {
		plan, interval, ok := ParseLookupKey(item.Price.LookupKey)
		if !ok {
			if id, found := ParsePlan(item.Price.Metadata["prior_plan"]); found && Lookup(id).Paid() && item.Price.Recurring != nil {
				plan, interval, ok = id, Interval(item.Price.Recurring.Interval), true
			}
		}
		if !ok {
			continue
		}
		periodEnd := sub.CurrentPeriodEnd
		if item.CurrentPeriodEnd > 0 {
			periodEnd = item.CurrentPeriodEnd
		}
		quantity := item.Quantity
		if quantity <= 0 {
			quantity = 1
		}
		result := SubscriptionPlan{Plan: plan, Interval: interval, AmountCents: item.Price.UnitAmount * quantity, Currency: item.Price.Currency}
		if periodEnd > 0 {
			result.PeriodEnd = time.Unix(periodEnd, 0).UTC()
		}
		return result, true
	}
	return SubscriptionPlan{}, false
}

type Invoice struct {
	ID                string `json:"id"`
	Customer          string `json:"customer"`
	Status            string `json:"status"`
	AmountPaid        int64  `json:"amount_paid"`
	Currency          string `json:"currency"`
	Created           int64  `json:"created"`
	StatusTransitions struct {
		PaidAt int64 `json:"paid_at"`
	} `json:"status_transitions"`
}

// PaidAt returns when the invoice was paid, falling back to its creation.
func (i Invoice) PaidAt() time.Time {
	if i.StatusTransitions.PaidAt > 0 {
		return time.Unix(i.StatusTransitions.PaidAt, 0).UTC()
	}
	return time.Unix(i.Created, 0).UTC()
}

type CheckoutSession struct {
	ID                string            `json:"id"`
	URL               string            `json:"url"`
	Customer          string            `json:"customer"`
	Subscription      string            `json:"subscription"`
	ClientReferenceID string            `json:"client_reference_id"`
	Metadata          map[string]string `json:"metadata"`
}

type list[T any] struct {
	Data    []T  `json:"data"`
	HasMore bool `json:"has_more"`
}

// ── Catalog ──

// Catalog maps each lookup key to its live price id, and each paid plan to
// its product id.
type Catalog struct {
	Prices   map[string]Price
	Products map[PlanID]string
	// PortalConfiguration is the customer-portal configuration Prior owns.
	PortalConfiguration string
}

var productDescriptions = map[PlanID]string{
	PlanPro:        "Prior AI included: unlimited recommendations and dictation, 2M assistant tokens a month, up to 10 people per shared project.",
	PlanTeam:       "Prior AI included: unlimited recommendations and dictation, 8M assistant tokens a month, up to 50 people per shared project.",
	PlanEnterprise: "Prior AI included: unlimited recommendations and dictation, 30M assistant tokens a month, unlimited sharing, priority support.",
}

// EnsureCatalog finds or creates one product per paid plan and one price per
// plan and interval, identified by lookup_key. It is idempotent: running it
// on every start (or against a fresh live account) converges to the catalog
// defined in plans.go. A price whose amount changed in code is replaced and
// takes over the lookup key.
func (s *Stripe) EnsureCatalog(ctx context.Context) (*Catalog, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.catalog != nil {
		return s.catalog, nil
	}
	catalog := &Catalog{Prices: map[string]Price{}, Products: map[PlanID]string{}}

	var products list[Product]
	if err := s.do(ctx, http.MethodGet, "/v1/products", url.Values{"limit": {"100"}, "active": {"true"}}, "", &products); err != nil {
		return nil, err
	}
	for _, product := range products.Data {
		if id, ok := ParsePlan(product.Metadata["prior_plan"]); ok {
			if _, seen := catalog.Products[id]; !seen {
				catalog.Products[id] = product.ID
			}
		}
	}

	query := url.Values{"limit": {"100"}, "active": {"true"}}
	for _, plan := range catalog_paid() {
		for _, interval := range []Interval{Monthly, Yearly} {
			query.Add("lookup_keys[]", LookupKey(plan.ID, interval))
		}
	}
	var prices list[Price]
	if err := s.do(ctx, http.MethodGet, "/v1/prices", query, "", &prices); err != nil {
		return nil, err
	}
	existing := map[string]Price{}
	for _, price := range prices.Data {
		existing[price.LookupKey] = price
	}

	for _, plan := range catalog_paid() {
		productID := catalog.Products[plan.ID]
		if productID == "" {
			form := url.Values{
				"name":                 {"Prior " + plan.Name},
				"description":          {productDescriptions[plan.ID]},
				"metadata[prior_plan]": {string(plan.ID)},
			}
			var created Product
			if err := s.do(ctx, http.MethodPost, "/v1/products", form, "prior-product-"+string(plan.ID)+"-v1", &created); err != nil {
				return nil, err
			}
			productID = created.ID
			catalog.Products[plan.ID] = productID
		}
		for _, interval := range []Interval{Monthly, Yearly} {
			key := LookupKey(plan.ID, interval)
			amount := plan.PriceCents(interval)
			if price, ok := existing[key]; ok && price.UnitAmount == amount && price.Currency == Currency && price.ProductID() == productID {
				catalog.Prices[key] = price
				continue
			}
			form := url.Values{
				"product":              {productID},
				"currency":             {Currency},
				"unit_amount":          {strconv.FormatInt(amount, 10)},
				"recurring[interval]":  {string(interval)},
				"lookup_key":           {key},
				"transfer_lookup_key":  {"true"},
				"tax_behavior":         {"inclusive"},
				"metadata[prior_plan]": {string(plan.ID)},
			}
			var created Price
			idem := fmt.Sprintf("prior-price-%s-%d-%s", key, amount, productID)
			if err := s.do(ctx, http.MethodPost, "/v1/prices", form, idem, &created); err != nil {
				return nil, err
			}
			catalog.Prices[key] = created
		}
	}

	portal, err := s.ensurePortalConfiguration(ctx, catalog)
	if err != nil {
		return nil, err
	}
	catalog.PortalConfiguration = portal
	s.catalog = catalog
	return catalog, nil
}

func catalog_paid() []Plan {
	var paid []Plan
	for _, plan := range catalog {
		if plan.Paid() {
			paid = append(paid, plan)
		}
	}
	return paid
}

// ensurePortalConfiguration keeps one customer-portal configuration that
// lets subscribers switch between Prior's plans, update their card, see
// invoices and cancel at the end of the period.
func (s *Stripe) ensurePortalConfiguration(ctx context.Context, catalog *Catalog) (string, error) {
	form := url.Values{
		"business_profile[headline]":                               {"Prior subscription"},
		"features[payment_method_update][enabled]":                 {"true"},
		"features[invoice_history][enabled]":                       {"true"},
		"features[customer_update][enabled]":                       {"true"},
		"features[customer_update][allowed_updates][]":             {"email", "address", "tax_id"},
		"features[subscription_cancel][enabled]":                   {"true"},
		"features[subscription_cancel][mode]":                      {"at_period_end"},
		"features[subscription_update][enabled]":                   {"true"},
		"features[subscription_update][proration_behavior]":        {"create_prorations"},
		"features[subscription_update][default_allowed_updates][]": {"price"},
		"metadata[prior_managed]":                                  {"true"},
	}
	for index, plan := range catalog_paid() {
		prefix := fmt.Sprintf("features[subscription_update][products][%d]", index)
		form.Set(prefix+"[product]", catalog.Products[plan.ID])
		for _, interval := range []Interval{Monthly, Yearly} {
			form.Add(prefix+"[prices][]", catalog.Prices[LookupKey(plan.ID, interval)].ID)
		}
	}
	var configs list[struct {
		ID       string            `json:"id"`
		Active   bool              `json:"active"`
		Metadata map[string]string `json:"metadata"`
	}]
	if err := s.do(ctx, http.MethodGet, "/v1/billing_portal/configurations", url.Values{"limit": {"100"}, "active": {"true"}}, "", &configs); err != nil {
		return "", err
	}
	for _, config := range configs.Data {
		if config.Metadata["prior_managed"] == "true" {
			// Refresh the allowed prices in case the catalog changed.
			var updated struct {
				ID string `json:"id"`
			}
			form.Del("metadata[prior_managed]")
			if err := s.do(ctx, http.MethodPost, "/v1/billing_portal/configurations/"+config.ID, form, "", &updated); err != nil {
				return "", err
			}
			return config.ID, nil
		}
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := s.do(ctx, http.MethodPost, "/v1/billing_portal/configurations", form, "", &created); err != nil {
		return "", err
	}
	return created.ID, nil
}

// PriceID returns the price id for a plan and interval, loading the catalog
// on first use.
func (s *Stripe) PriceID(ctx context.Context, plan PlanID, interval Interval) (string, error) {
	catalog, err := s.EnsureCatalog(ctx)
	if err != nil {
		return "", err
	}
	price, ok := catalog.Prices[LookupKey(plan, interval)]
	if !ok {
		return "", fmt.Errorf("no Stripe price for %s", LookupKey(plan, interval))
	}
	return price.ID, nil
}

// ── Customers, checkout, portal ──

func (s *Stripe) CreateCustomer(ctx context.Context, email, name, userID string) (string, error) {
	form := url.Values{"email": {email}, "metadata[prior_user_id]": {userID}}
	if name != "" {
		form.Set("name", name)
	}
	var customer struct {
		ID string `json:"id"`
	}
	if err := s.do(ctx, http.MethodPost, "/v1/customers", form, "prior-customer-"+userID, &customer); err != nil {
		return "", err
	}
	return customer.ID, nil
}

type CheckoutParams struct {
	Customer   string
	UserID     string
	PriceID    string
	SuccessURL string
	CancelURL  string
	Locale     string
}

func (s *Stripe) CreateCheckoutSession(ctx context.Context, params CheckoutParams) (CheckoutSession, error) {
	form := url.Values{
		"mode":                                       {"subscription"},
		"customer":                                   {params.Customer},
		"client_reference_id":                        {params.UserID},
		"line_items[0][price]":                       {params.PriceID},
		"line_items[0][quantity]":                    {"1"},
		"success_url":                                {params.SuccessURL},
		"cancel_url":                                 {params.CancelURL},
		"allow_promotion_codes":                      {"true"},
		"billing_address_collection":                 {"auto"},
		"customer_update[address]":                   {"auto"},
		"customer_update[name]":                      {"auto"},
		"tax_id_collection[enabled]":                 {"true"},
		"metadata[prior_user_id]":                    {params.UserID},
		"subscription_data[metadata][prior_user_id]": {params.UserID},
	}
	if params.Locale != "" {
		form.Set("locale", params.Locale)
	}
	var session CheckoutSession
	err := s.do(ctx, http.MethodPost, "/v1/checkout/sessions", form, "", &session)
	return session, err
}

func (s *Stripe) GetCheckoutSession(ctx context.Context, id string) (CheckoutSession, error) {
	var session CheckoutSession
	err := s.do(ctx, http.MethodGet, "/v1/checkout/sessions/"+url.PathEscape(id), nil, "", &session)
	return session, err
}

func (s *Stripe) CreatePortalSession(ctx context.Context, customer, returnURL string) (string, error) {
	catalog, err := s.EnsureCatalog(ctx)
	if err != nil {
		return "", err
	}
	form := url.Values{"customer": {customer}, "return_url": {returnURL}}
	if catalog.PortalConfiguration != "" {
		form.Set("configuration", catalog.PortalConfiguration)
	}
	var session struct {
		URL string `json:"url"`
	}
	if err := s.do(ctx, http.MethodPost, "/v1/billing_portal/sessions", form, "", &session); err != nil {
		return "", err
	}
	return session.URL, nil
}

func (s *Stripe) GetSubscription(ctx context.Context, id string) (Subscription, error) {
	var sub Subscription
	err := s.do(ctx, http.MethodGet, "/v1/subscriptions/"+url.PathEscape(id), nil, "", &sub)
	return sub, err
}

// ListSubscriptions returns the customer's subscriptions in every status,
// newest first.
func (s *Stripe) ListSubscriptions(ctx context.Context, customer string) ([]Subscription, error) {
	var subs list[Subscription]
	err := s.do(ctx, http.MethodGet, "/v1/subscriptions", url.Values{"customer": {customer}, "status": {"all"}, "limit": {"20"}}, "", &subs)
	return subs.Data, err
}

// ListPaidInvoices returns the customer's most recent paid invoices.
func (s *Stripe) ListPaidInvoices(ctx context.Context, customer string) ([]Invoice, error) {
	var invoices list[Invoice]
	err := s.do(ctx, http.MethodGet, "/v1/invoices", url.Values{"customer": {customer}, "status": {"paid"}, "limit": {"50"}}, "", &invoices)
	return invoices.Data, err
}

// BestSubscription picks the subscription that should drive the account's
// plan: an active one first, then the most recent.
func BestSubscription(subs []Subscription) (Subscription, bool) {
	var best Subscription
	found := false
	for _, sub := range subs {
		if _, ok := sub.Resolve(); !ok {
			continue
		}
		if !found {
			best, found = sub, true
			continue
		}
		bestActive, subActive := ActiveStatus(best.Status), ActiveStatus(sub.Status)
		if subActive && !bestActive || subActive == bestActive && sub.Created > best.Created {
			best = sub
		}
	}
	return best, found
}

// ── Webhooks ──

type WebhookEndpoint struct {
	ID       string            `json:"id"`
	URL      string            `json:"url"`
	Secret   string            `json:"secret"`
	Metadata map[string]string `json:"metadata"`
}

// EnsureWebhook makes sure a Prior-managed webhook endpoint points at
// endpointURL. Stripe only reveals a signing secret when the endpoint is
// created, so when the caller no longer knows the secret (knownSecret == "")
// the managed endpoint is replaced. It returns the secret to keep, or ""
// when the existing secret is still valid.
func (s *Stripe) EnsureWebhook(ctx context.Context, endpointURL, knownSecret string) (string, error) {
	var endpoints list[WebhookEndpoint]
	if err := s.do(ctx, http.MethodGet, "/v1/webhook_endpoints", url.Values{"limit": {"100"}}, "", &endpoints); err != nil {
		return "", err
	}
	for _, endpoint := range endpoints.Data {
		if endpoint.Metadata["prior_managed"] != "true" {
			continue
		}
		if endpoint.URL == endpointURL && knownSecret != "" {
			form := url.Values{}
			for _, event := range WebhookEvents {
				form.Add("enabled_events[]", event)
			}
			if err := s.do(ctx, http.MethodPost, "/v1/webhook_endpoints/"+endpoint.ID, form, "", nil); err != nil {
				return "", err
			}
			return "", nil
		}
		if err := s.do(ctx, http.MethodDelete, "/v1/webhook_endpoints/"+endpoint.ID, nil, "", nil); err != nil {
			return "", err
		}
	}
	form := url.Values{
		"url":                     {endpointURL},
		"api_version":             {StripeAPIVersion},
		"description":             {"Prior API (managed automatically)"},
		"metadata[prior_managed]": {"true"},
	}
	for _, event := range WebhookEvents {
		form.Add("enabled_events[]", event)
	}
	var created WebhookEndpoint
	if err := s.do(ctx, http.MethodPost, "/v1/webhook_endpoints", form, "", &created); err != nil {
		return "", err
	}
	if created.Secret == "" {
		return "", errors.New("stripe did not return a webhook secret")
	}
	return created.Secret, nil
}

type Event struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Livemode bool   `json:"livemode"`
	Data     struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// WebhookTolerance bounds how old a signed webhook may be.
const WebhookTolerance = 5 * time.Minute

var ErrBadSignature = errors.New("invalid stripe signature")

// VerifyWebhook checks the Stripe-Signature header (t=...,v1=...) against
// any of the given secrets and decodes the event.
func VerifyWebhook(payload []byte, header string, secrets []string, now time.Time) (Event, error) {
	var timestamp int64
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch key {
		case "t":
			timestamp, _ = strconv.ParseInt(value, 10, 64)
		case "v1":
			signatures = append(signatures, value)
		}
	}
	if timestamp == 0 || len(signatures) == 0 {
		return Event{}, ErrBadSignature
	}
	age := now.Sub(time.Unix(timestamp, 0))
	if age > WebhookTolerance || age < -WebhookTolerance {
		return Event{}, ErrBadSignature
	}
	signed := strconv.FormatInt(timestamp, 10) + "." + string(payload)
	valid := false
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(signed))
		expected := mac.Sum(nil)
		for _, candidate := range signatures {
			decoded, err := hex.DecodeString(candidate)
			if err == nil && hmac.Equal(decoded, expected) {
				valid = true
			}
		}
	}
	if !valid {
		return Event{}, ErrBadSignature
	}
	var event Event
	if err := json.Unmarshal(payload, &event); err != nil {
		return Event{}, fmt.Errorf("invalid stripe event: %w", err)
	}
	return event, nil
}

// SignWebhook produces a Stripe-Signature header; used by tests.
func SignWebhook(payload []byte, secret string, at time.Time) string {
	timestamp := strconv.FormatInt(at.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "." + string(payload)))
	return "t=" + timestamp + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}
