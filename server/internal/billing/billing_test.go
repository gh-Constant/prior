package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestLookupKeysRoundTrip(t *testing.T) {
	for _, plan := range Plans() {
		for _, interval := range []Interval{Monthly, Yearly} {
			id, gotInterval, ok := ParseLookupKey(LookupKey(plan.ID, interval))
			if ok != plan.Paid() {
				t.Fatalf("%s/%s parse ok=%v", plan.ID, interval, ok)
			}
			if ok && (id != plan.ID || gotInterval != interval) {
				t.Fatalf("round trip %s/%s = %s/%s", plan.ID, interval, id, gotInterval)
			}
		}
	}
	for _, key := range []string{"", "prior_", "prior_pro", "prior_pro_week", "other_pro_month", "prior_free_month"} {
		if _, _, ok := ParseLookupKey(key); ok {
			t.Fatalf("accepted %q", key)
		}
	}
}

func TestCatalogIsHonest(t *testing.T) {
	free := Lookup(PlanFree)
	if free.HostedAI || free.AgentTokensPerMonth != 0 || free.Paid() {
		t.Fatal("the free plan never includes Prior AI")
	}
	previous := free
	for _, id := range []PlanID{PlanPro, PlanTeam, PlanEnterprise} {
		plan := Lookup(id)
		if !plan.HostedAI || plan.AgentTokensPerMonth <= previous.AgentTokensPerMonth || plan.MonthlyCents <= previous.MonthlyCents {
			t.Fatalf("%s must give more than %s for more money", id, previous.ID)
		}
		if plan.YearlyCents >= plan.MonthlyCents*12 {
			t.Fatalf("%s yearly price must be a discount", id)
		}
		previous = plan
	}
	if Lookup("nope").ID != PlanFree {
		t.Fatal("unknown plans resolve to free")
	}
}

func TestEntitlementLimits(t *testing.T) {
	free := EntitlementsFor(PlanFree, 0, time.Now())
	if !free.AllowsMembers(2) || free.AllowsMembers(3) {
		t.Fatal("free projects hold two people")
	}
	if !free.AllowsSharedProjects(3) || free.AllowsSharedProjects(4) {
		t.Fatal("free accounts share three projects")
	}
	enterprise := EntitlementsFor(PlanEnterprise, 0, time.Now())
	if !enterprise.AllowsMembers(10_000) || !enterprise.AllowsSharedProjects(10_000) {
		t.Fatal("enterprise sharing is unlimited")
	}
	start := MonthStart(time.Date(2026, 3, 31, 23, 0, 0, 0, time.FixedZone("x", -3*3600)))
	if !start.Equal(time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("month start = %v", start)
	}
}

func TestVerifyWebhook(t *testing.T) {
	payload := []byte(`{"id":"evt_1","type":"invoice.paid","data":{"object":{"id":"in_1"}}}`)
	now := time.Unix(1_800_000_000, 0)
	header := SignWebhook(payload, "whsec_a", now)
	event, err := VerifyWebhook(payload, header, []string{"whsec_other", "whsec_a"}, now.Add(time.Minute))
	if err != nil || event.Type != "invoice.paid" || event.ID != "evt_1" {
		t.Fatalf("event=%#v err=%v", event, err)
	}
	if _, err := VerifyWebhook(payload, header, []string{"whsec_b"}, now); err == nil {
		t.Fatal("wrong secret accepted")
	}
	if _, err := VerifyWebhook(append(payload, ' '), header, []string{"whsec_a"}, now); err == nil {
		t.Fatal("tampered payload accepted")
	}
	if _, err := VerifyWebhook(payload, header, []string{"whsec_a"}, now.Add(10*time.Minute)); err == nil {
		t.Fatal("replayed webhook accepted")
	}
	if _, err := VerifyWebhook(payload, "garbage", []string{"whsec_a"}, now); err == nil {
		t.Fatal("malformed header accepted")
	}
	if _, err := VerifyWebhook(payload, header, nil, now); err == nil {
		t.Fatal("no secret must reject")
	}
}

func TestSubscriptionResolve(t *testing.T) {
	var sub Subscription
	raw := `{"id":"sub_1","customer":"cus_1","status":"active","current_period_end":0,"items":{"data":[{"current_period_end":1800000000,"quantity":1,"price":{"id":"price_1","lookup_key":"prior_team_year","unit_amount":48000,"currency":"eur","recurring":{"interval":"year"}}}]}}`
	if err := json.Unmarshal([]byte(raw), &sub); err != nil {
		t.Fatal(err)
	}
	resolved, ok := sub.Resolve()
	if !ok || resolved.Plan != PlanTeam || resolved.Interval != Yearly || resolved.AmountCents != 48000 || resolved.PeriodEnd.Unix() != 1_800_000_000 {
		t.Fatalf("resolved = %#v ok=%v", resolved, ok)
	}
	sub.Items.Data[0].Price.LookupKey = "something_else"
	if _, ok := sub.Resolve(); ok {
		t.Fatal("foreign prices are not Prior plans")
	}
	sub.Items.Data[0].Price.Metadata = map[string]string{"prior_plan": "pro"}
	if resolved, ok := sub.Resolve(); !ok || resolved.Plan != PlanPro {
		t.Fatal("price metadata identifies older prices")
	}
}

func TestBestSubscriptionPrefersActive(t *testing.T) {
	newSub := func(id, status string, created int64) Subscription {
		var sub Subscription
		sub.ID, sub.Status, sub.Created = id, status, created
		sub.Items.Data = append(sub.Items.Data, struct {
			CurrentPeriodEnd int64 `json:"current_period_end"`
			Quantity         int64 `json:"quantity"`
			Price            Price `json:"price"`
		}{Price: Price{LookupKey: "prior_pro_month"}})
		return sub
	}
	best, ok := BestSubscription([]Subscription{newSub("old", "active", 1), newSub("new", "canceled", 5), newSub("mid", "incomplete_expired", 3)})
	if !ok || best.ID != "old" {
		t.Fatalf("best = %s", best.ID)
	}
	best, _ = BestSubscription([]Subscription{newSub("a", "canceled", 1), newSub("b", "canceled", 2)})
	if best.ID != "b" {
		t.Fatalf("latest inactive wins among inactive, got %s", best.ID)
	}
}

// fakeStripe records created objects and serves list calls from them.
type fakeStripe struct {
	mu       sync.Mutex
	products []map[string]any
	prices   []map[string]any
	portals  []map[string]any
	creates  int
}

func (f *fakeStripe) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if user, _, _ := r.BasicAuth(); user != "sk_test_fake" || r.Header.Get("Stripe-Version") != StripeAPIVersion {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"bad key"}}`))
		return
	}
	_ = r.ParseForm()
	write := func(value any) { _ = json.NewEncoder(w).Encode(value) }
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/v1/products":
		write(map[string]any{"data": f.products})
	case r.Method == http.MethodPost && r.URL.Path == "/v1/products":
		f.creates++
		product := map[string]any{"id": "prod_" + r.Form.Get("metadata[prior_plan]"), "active": true, "metadata": map[string]string{"prior_plan": r.Form.Get("metadata[prior_plan]")}}
		f.products = append(f.products, product)
		write(product)
	case r.Method == http.MethodGet && r.URL.Path == "/v1/prices":
		keys := map[string]bool{}
		for _, key := range r.URL.Query()["lookup_keys[]"] {
			keys[key] = true
		}
		var out []map[string]any
		for _, price := range f.prices {
			if keys[price["lookup_key"].(string)] {
				out = append(out, price)
			}
		}
		write(map[string]any{"data": out})
	case r.Method == http.MethodPost && r.URL.Path == "/v1/prices":
		f.creates++
		amount := r.Form.Get("unit_amount")
		var cents int64
		_ = json.Unmarshal([]byte(amount), &cents)
		price := map[string]any{"id": "price_" + r.Form.Get("lookup_key"), "lookup_key": r.Form.Get("lookup_key"), "unit_amount": cents, "currency": r.Form.Get("currency"), "product": r.Form.Get("product"), "active": true}
		f.prices = append(f.prices, price)
		write(price)
	case r.Method == http.MethodGet && r.URL.Path == "/v1/billing_portal/configurations":
		write(map[string]any{"data": f.portals})
	case r.Method == http.MethodPost && r.URL.Path == "/v1/billing_portal/configurations":
		f.creates++
		portal := map[string]any{"id": "bpc_1", "active": true, "metadata": map[string]string{"prior_managed": "true"}}
		f.portals = append(f.portals, portal)
		write(portal)
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/billing_portal/configurations/"):
		write(map[string]any{"id": strings.TrimPrefix(r.URL.Path, "/v1/billing_portal/configurations/")})
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"unknown route"}}`))
	}
}

func TestEnsureCatalogIsIdempotent(t *testing.T) {
	fake := &fakeStripe{}
	server := httptest.NewServer(fake)
	defer server.Close()

	first, err := NewStripe("sk_test_fake", server.Client()).WithBaseURL(server.URL).EnsureCatalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Prices) != 6 || len(first.Products) != 3 || first.PortalConfiguration != "bpc_1" {
		t.Fatalf("catalog = %#v", first)
	}
	if got := first.Prices["prior_pro_month"].UnitAmount; got != 2000 {
		t.Fatalf("pro monthly = %d", got)
	}
	created := fake.creates

	// A second server start (fresh client, same account) creates nothing.
	second, err := NewStripe("sk_test_fake", server.Client()).WithBaseURL(server.URL).EnsureCatalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if fake.creates != created || second.Prices["prior_team_year"].ID != first.Prices["prior_team_year"].ID {
		t.Fatalf("second run created %d objects", fake.creates-created)
	}
}

func TestStripeErrorsNeverCarryTheKey(t *testing.T) {
	fake := &fakeStripe{}
	server := httptest.NewServer(fake)
	defer server.Close()
	_, err := NewStripe("sk_live_secret_value", server.Client()).WithBaseURL(server.URL).EnsureCatalog(context.Background())
	if err == nil || strings.Contains(err.Error(), "sk_live") {
		t.Fatalf("err = %v", err)
	}
	if !NewStripe("sk_live_x", nil).Live() || NewStripe("sk_test_x", nil).Live() || NewStripe("", nil).Enabled() {
		t.Fatal("mode detection")
	}
}
