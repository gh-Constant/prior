package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/billing"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fakeStripeAPI is just enough of Stripe for checkout, sync and the catalog.
type fakeStripeAPI struct {
	mu        sync.Mutex
	customers int
	subs      []map[string]any
	invoices  []map[string]any
}

func (f *fakeStripeAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_ = r.ParseForm()
	write := func(value any) { _ = json.NewEncoder(w).Encode(value) }
	switch {
	case r.URL.Path == "/v1/products" && r.Method == http.MethodGet,
		r.URL.Path == "/v1/prices" && r.Method == http.MethodGet,
		r.URL.Path == "/v1/billing_portal/configurations" && r.Method == http.MethodGet:
		write(map[string]any{"data": []any{}})
	case r.URL.Path == "/v1/products":
		write(map[string]any{"id": "prod_" + r.Form.Get("metadata[prior_plan]")})
	case r.URL.Path == "/v1/prices":
		write(map[string]any{"id": "price_" + r.Form.Get("lookup_key"), "lookup_key": r.Form.Get("lookup_key")})
	case r.URL.Path == "/v1/billing_portal/configurations":
		write(map[string]any{"id": "bpc_1"})
	case r.URL.Path == "/v1/billing_portal/sessions":
		write(map[string]any{"url": "https://billing.stripe.test/portal"})
	case r.URL.Path == "/v1/customers":
		f.customers++
		write(map[string]any{"id": "cus_" + r.Form.Get("metadata[prior_user_id]")[:8]})
	case r.URL.Path == "/v1/checkout/sessions":
		if r.Form.Get("line_items[0][price]") != "price_prior_pro_month" || !strings.Contains(r.Form.Get("success_url"), "{CHECKOUT_SESSION_ID}") {
			w.WriteHeader(http.StatusBadRequest)
			write(map[string]any{"error": map[string]string{"message": "unexpected checkout " + r.Form.Encode()}})
			return
		}
		write(map[string]any{"id": "cs_1", "url": "https://checkout.stripe.test/cs_1", "customer": r.Form.Get("customer")})
	case r.URL.Path == "/v1/subscriptions":
		write(map[string]any{"data": f.subs})
	case r.URL.Path == "/v1/invoices":
		write(map[string]any{"data": f.invoices})
	default:
		w.WriteHeader(http.StatusNotFound)
		write(map[string]any{"error": map[string]string{"message": "unknown " + r.URL.Path}})
	}
}

func proSubscription(id, customer, status string) map[string]any {
	return map[string]any{
		"id": id, "customer": customer, "status": status, "created": time.Now().Unix(),
		"items": map[string]any{"data": []any{map[string]any{
			"current_period_end": time.Now().Add(30 * 24 * time.Hour).Unix(), "quantity": 1,
			"price": map[string]any{"id": "price_prior_pro_month", "lookup_key": "prior_pro_month", "unit_amount": 2000, "currency": "eur", "recurring": map[string]string{"interval": "month"}},
		}}},
	}
}

func TestBillingFlowPostgres(t *testing.T) {
	url := os.Getenv("PRIOR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set PRIOR_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx := context.Background()
	adminPool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer adminPool.Close()
	schema := "billing_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := adminPool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer adminPool.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	poolConfig, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}

	fake := &fakeStripeAPI{}
	stripeServer := httptest.NewServer(fake)
	defer stripeServer.Close()
	cfg := config.Config{Billing: config.BillingConfig{
		StripeSecretKey:     "sk_test_fake",
		StripeWebhookSecret: "whsec_test",
		ReturnURL:           "https://app.prior.constantsuchet.fr/",
		AdminEmails:         []string{"admin@example.com"},
	}}
	srv := New(cfg, pool)
	srv.stripe = billing.NewStripe("sk_test_fake", stripeServer.Client()).WithBaseURL(stripeServer.URL)
	handler := srv.Handler()

	newUser := func(email string, verified bool) (uuid.UUID, string) {
		user, err := srv.store.CreatePasswordUser(ctx, email, "x", strings.Split(email, "@")[0])
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE users SET email_verified = $2 WHERE id = $1`, user.ID, verified); err != nil {
			t.Fatal(err)
		}
		token := uuid.NewString()
		if err := srv.store.CreateSession(ctx, user.ID, token, "test", "web", time.Hour); err != nil {
			t.Fatal(err)
		}
		return user.ID, token
	}
	aliceID, alice := newUser("alice@example.com", false)
	_, admin := newUser("admin@example.com", true)
	_, impostor := newUser("Admin2@example.com", false)

	call := func(method, path, token, body string) (int, map[string]any) {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		var decoded map[string]any
		_ = json.Unmarshal(response.Body.Bytes(), &decoded)
		return response.Code, decoded
	}
	webhook := func(eventType string, object map[string]any) int {
		payload, _ := json.Marshal(map[string]any{"id": "evt_" + uuid.NewString(), "type": eventType, "data": map[string]any{"object": object}})
		request := httptest.NewRequest(http.MethodPost, "/v1/billing/webhook", strings.NewReader(string(payload)))
		request.Header.Set("Stripe-Signature", billing.SignWebhook(payload, "whsec_test", time.Now()))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response.Code
	}

	// Free account: no Prior AI, not admin.
	if code, body := call("GET", "/v1/billing", alice, ""); code != 200 || body["plan"] != "free" || body["isAdmin"] != false {
		t.Fatalf("alice billing = %d %v", code, body)
	}
	aliceUser, _ := srv.store.UserForToken(ctx, alice)
	if srv.hostedAIEntitlement(ctx, aliceUser).Allowed {
		t.Fatal("free accounts must not get Prior AI")
	}
	if code, body := call("GET", "/v1/billing", admin, ""); code != 200 || body["plan"] != "enterprise" || body["isAdmin"] != true {
		t.Fatalf("admin billing = %d %v", code, body)
	}

	// Free sharing: two people per project.
	projectID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES ($1, $2, 'Launch', now(), now())`, projectID, aliceID); err != nil {
		t.Fatal(err)
	}
	share := "/v1/collaboration/projects/" + projectID.String() + "/members"
	if code, body := call("POST", share, alice, `{"email":"bob@example.com","role":"editor"}`); code != 200 {
		t.Fatalf("first invite = %d %v", code, body)
	}
	if code, body := call("POST", share, alice, `{"email":"bob@example.com","role":"viewer"}`); code != 200 {
		t.Fatalf("re-inviting the same person must not count twice: %d %v", code, body)
	}
	if code, body := call("POST", share, alice, `{"email":"carol@example.com","role":"editor"}`); code != http.StatusPaymentRequired || body["code"] != "PLAN_LIMIT" || body["limit"] != "members" {
		t.Fatalf("third person on free = %d %v", code, body)
	}

	// Checkout creates the customer and a Checkout Session.
	if code, body := call("POST", "/v1/billing/checkout", alice, `{"plan":"pro","interval":"month","returnUrl":"https://evil.example/steal"}`); code != 200 || body["url"] != "https://checkout.stripe.test/cs_1" {
		t.Fatalf("checkout = %d %v", code, body)
	}
	sub, _ := srv.store.GetSubscription(ctx, aliceID)
	if sub.StripeCustomerID == "" || fake.customers != 1 {
		t.Fatalf("customer not linked: %#v", sub)
	}
	customer := sub.StripeCustomerID

	// Bad signatures are rejected.
	request := httptest.NewRequest(http.MethodPost, "/v1/billing/webhook", strings.NewReader(`{"type":"customer.subscription.updated"}`))
	request.Header.Set("Stripe-Signature", "t=1,v1=00")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unsigned webhook = %d", response.Code)
	}

	// The subscription webhook upgrades the account.
	if code := webhook("customer.subscription.updated", proSubscription("sub_1", customer, "active")); code != 200 {
		t.Fatalf("webhook = %d", code)
	}
	if code, body := call("GET", "/v1/billing", alice, ""); body["plan"] != "pro" || body["source"] != "stripe" {
		t.Fatalf("after webhook = %d %v", code, body)
	}
	aliceUser, _ = srv.store.UserForToken(ctx, alice)
	if got := srv.hostedAIEntitlement(ctx, aliceUser); !got.Allowed || got.AgentTokensPerMonth != 2_000_000 || got.Plan != "pro" {
		t.Fatalf("pro entitlement = %#v", got)
	}
	if code, body := call("POST", share, alice, `{"email":"carol@example.com","role":"editor"}`); code != 200 {
		t.Fatalf("pro can invite more people: %d %v", code, body)
	}

	// A late cancel for an older subscription does not downgrade.
	if code := webhook("customer.subscription.deleted", proSubscription("sub_old", customer, "canceled")); code != 200 {
		t.Fatalf("stale webhook = %d", code)
	}
	if _, body := call("GET", "/v1/billing", alice, ""); body["plan"] != "pro" {
		t.Fatalf("stale cancel downgraded: %v", body)
	}

	// Payments and usage feed the dashboard.
	if code := webhook("invoice.paid", map[string]any{"id": "in_1", "customer": customer, "status": "paid", "amount_paid": 2000, "currency": "eur", "created": time.Now().Unix()}); code != 200 {
		t.Fatalf("invoice webhook = %d", code)
	}
	if err := srv.store.RecordHostedAIUsage(ctx, aliceID, time.Now(), "agent", 1200, 2500); err != nil {
		t.Fatal(err)
	}

	// Sync from Stripe (return from checkout) is idempotent.
	fake.subs = []map[string]any{proSubscription("sub_1", customer, "active")}
	fake.invoices = []map[string]any{{"id": "in_1", "customer": customer, "status": "paid", "amount_paid": 2000, "currency": "eur", "created": time.Now().Unix()}}
	if code, body := call("POST", "/v1/billing/sync", alice, `{}`); code != 200 || body["plan"] != "pro" {
		t.Fatalf("sync = %d %v", code, body)
	}

	// Admin endpoints are server-side gated.
	for _, token := range []string{alice, impostor} {
		if code, _ := call("GET", "/v1/admin/overview", token, ""); code != http.StatusForbidden {
			t.Fatalf("non-admin overview = %d", code)
		}
	}
	code, body := call("GET", "/v1/admin/overview", admin, "")
	if code != 200 {
		t.Fatalf("overview = %d %v", code, body)
	}
	totals := body["overview"].(map[string]any)["totals"].(map[string]any)
	if totals["users"] != float64(3) || totals["payingUsers"] != float64(1) || totals["mrrCents"] != float64(2000) || totals["revenue30dCents"] != float64(2000) || totals["aiCost30dMicros"] != float64(2500) {
		t.Fatalf("totals = %v", totals)
	}
	code, body = call("GET", "/v1/admin/users?q=ALICE&sort=spend", admin, "")
	users, _ := body["users"].([]any)
	if code != 200 || body["total"] != float64(1) || len(users) != 1 || users[0].(map[string]any)["plan"] != "pro" {
		t.Fatalf("users = %d %v", code, body)
	}

	// Granting and removing a plan.
	planPath := "/v1/admin/users/" + aliceID.String() + "/plan"
	if code, _ := call("PUT", planPath, admin, `{"plan":"enterprise","note":"partner"}`); code != 200 {
		t.Fatalf("grant = %d", code)
	}
	if _, body := call("GET", "/v1/billing", alice, ""); body["plan"] != "enterprise" || body["source"] != "admin" {
		t.Fatalf("granted = %v", body)
	}
	if code, _ := call("PUT", planPath, admin, `{"plan":""}`); code != 200 {
		t.Fatalf("revoke = %d", code)
	}
	if _, body := call("GET", "/v1/billing", alice, ""); body["plan"] != "pro" {
		t.Fatalf("revoked = %v", body)
	}
	if code, _ := call("PUT", planPath, alice, `{"plan":"enterprise"}`); code != http.StatusForbidden {
		t.Fatal("users cannot grant themselves a plan")
	}
}
