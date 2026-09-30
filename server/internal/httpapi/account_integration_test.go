package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/billing"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/gh-Constant/prior/server/internal/mailer"
	"github.com/gh-Constant/prior/server/internal/totp"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newIntegrationServer migrates a private schema and returns a server whose
// emails are recorded.
func newIntegrationServer(t *testing.T, cfg config.Config) (*Server, *pgxpool.Pool, *mailer.Recorder) {
	t.Helper()
	dbURL := os.Getenv("PRIOR_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("set PRIOR_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx := context.Background()
	adminPool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(adminPool.Close)
	schema := "account_http_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := adminPool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = adminPool.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE") })
	poolConfig, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Fatal(err)
	}
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if cfg.SessionTTL == 0 {
		cfg.SessionTTL = time.Hour
	}
	srv := New(cfg, pool)
	recorder := &mailer.Recorder{}
	srv.mail = recorder
	return srv, pool, recorder
}

type apiCaller func(method, path, token, body string) (int, map[string]any)

func callerFor(srv *Server) apiCaller {
	handler := srv.Handler()
	return func(method, path, token, body string) (int, map[string]any) {
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
}

func tokenFromLink(t *testing.T, link string) string {
	t.Helper()
	parsed, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.Query().Get("token")
}

func waitForEmail(t *testing.T, recorder *mailer.Recorder, to string, count int) mailer.Message {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		matching := 0
		var last mailer.Message
		for _, message := range recorder.Messages() {
			if strings.EqualFold(message.To, to) {
				matching++
				last = message
			}
		}
		if matching >= count {
			return last
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no email #%d to %s", count, to)
	return mailer.Message{}
}

func TestEmailVerificationAndPasswordResetPostgres(t *testing.T) {
	srv, pool, recorder := newIntegrationServer(t, config.Config{WebAppURL: "https://app.example"})
	call := callerFor(srv)
	ctx := context.Background()

	code, body := call("POST", "/v1/auth/register", "", `{"email":"ada@example.com","password":"correct horse","displayName":"Ada","language":"fr"}`)
	if code != 201 {
		t.Fatalf("register = %d %v", code, body)
	}
	token := body["token"].(string)
	user := body["user"].(map[string]any)
	if user["emailVerified"] != false || user["hasPassword"] != true || user["locale"] != "fr" || user["twoFactorEnabled"] != false {
		t.Fatalf("new account = %v", user)
	}
	verify := waitForEmail(t, recorder, "ada@example.com", 1)
	if !strings.HasPrefix(verify.Link, "https://app.example/verify-email?token=") || !strings.Contains(verify.Subject, "Confirmez") {
		t.Fatalf("verification email = %q %q", verify.Subject, verify.Link)
	}
	var stored int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM auth_tokens WHERE token_hash = $1`, []byte(tokenFromLink(t, verify.Link))).Scan(&stored); err != nil || stored != 0 {
		t.Fatalf("raw token must never be stored: %d %v", stored, err)
	}
	// Resend is throttled to one a minute.
	if code, _ := call("POST", "/v1/auth/email/verify/resend", token, `{}`); code != 429 {
		t.Fatalf("resend within a minute = %d", code)
	}
	if code, body := call("POST", "/v1/auth/email/verify", "", `{"token":"nope"}`); code != 400 || body["code"] != "TOKEN_INVALID" {
		t.Fatalf("bad verify = %d %v", code, body)
	}
	verifyToken := tokenFromLink(t, verify.Link)
	if code, body := call("POST", "/v1/auth/email/verify", "", `{"token":"`+verifyToken+`"}`); code != 200 || body["verified"] != true {
		t.Fatalf("verify = %d %v", code, body)
	}
	if code, _ := call("POST", "/v1/auth/email/verify", "", `{"token":"`+verifyToken+`"}`); code != 400 {
		t.Fatal("verification token must be single-use")
	}
	if code, me := call("GET", "/v1/me", token, ""); code != 200 || me["emailVerified"] != true || me["emailVerifiedAt"] == nil {
		t.Fatalf("me after verify = %d %v", code, me)
	}
	if code, body := call("POST", "/v1/auth/email/verify/resend", token, `{}`); code != 200 || body["alreadyVerified"] != true {
		t.Fatalf("resend when verified = %d %v", code, body)
	}

	// Forgot password: same answer for unknown and known emails.
	if code, _ := call("POST", "/v1/auth/password/forgot", "", `{"email":"nobody@example.com"}`); code != 202 {
		t.Fatalf("unknown forgot = %d", code)
	}
	if code, _ := call("POST", "/v1/auth/password/forgot", "", `{"email":"ADA@example.com","language":"de"}`); code != 202 {
		t.Fatalf("forgot = %d", code)
	}
	reset := waitForEmail(t, recorder, "ada@example.com", 2)
	if !strings.HasPrefix(reset.Link, "https://app.example/reset-password?token=") || !strings.Contains(reset.Subject, "Passwort") {
		t.Fatalf("reset email = %q %q", reset.Subject, reset.Link)
	}
	if len(recorder.Messages()) != 2 {
		t.Fatalf("unknown email must not send anything: %d", len(recorder.Messages()))
	}
	resetToken := tokenFromLink(t, reset.Link)
	if code, body := call("POST", "/v1/auth/password/reset", "", `{"token":"`+resetToken+`","password":"short"}`); code != 400 || body["code"] != "INVALID_PASSWORD" {
		t.Fatalf("weak reset = %d %v", code, body)
	}
	if code, _ := call("POST", "/v1/auth/password/reset", "", `{"token":"`+resetToken+`","password":"a brand new password"}`); code != 204 {
		t.Fatalf("reset = %d", code)
	}
	if code, _ := call("GET", "/v1/me", token, ""); code != 401 {
		t.Fatal("a reset must revoke every session")
	}
	if code, _ := call("POST", "/v1/auth/password/reset", "", `{"token":"`+resetToken+`","password":"another password!"}`); code != 400 {
		t.Fatal("reset token must be single-use")
	}
	if code, _ := call("POST", "/v1/auth/login", "", `{"email":"ada@example.com","password":"correct horse"}`); code != 401 {
		t.Fatal("old password must stop working")
	}
	if code, body := call("POST", "/v1/auth/login", "", `{"email":"ada@example.com","password":"a brand new password"}`); code != 200 || body["token"] == nil {
		t.Fatalf("login with new password = %d %v", code, body)
	}
	// An expired token is refused.
	if _, err := pool.Exec(ctx, `UPDATE auth_tokens SET expires_at = now() - interval '1 minute', used_at = NULL`); err != nil {
		t.Fatal(err)
	}
	if code, _ := call("POST", "/v1/auth/email/verify", "", `{"token":"`+verifyToken+`"}`); code != 400 {
		t.Fatal("expired token must be refused")
	}
}

const testTOTPKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

func TestTwoFactorFlowPostgres(t *testing.T) {
	srv, pool, _ := newIntegrationServer(t, config.Config{TOTPEncryptionKey: testTOTPKey})
	call := callerFor(srv)
	ctx := context.Background()
	clock := time.Now()
	srv.now = func() time.Time { return clock }

	code, body := call("POST", "/v1/auth/register", "", `{"email":"grace@example.com","password":"correct horse"}`)
	if code != 201 {
		t.Fatalf("register = %d %v", code, body)
	}
	session := body["token"].(string)
	if code, status := call("GET", "/v1/auth/2fa", session, ""); code != 200 || status["enabled"] != false || status["available"] != true {
		t.Fatalf("status = %d %v", code, status)
	}
	code, setup := call("POST", "/v1/auth/2fa/setup", session, "")
	if code != 200 || !strings.HasPrefix(setup["otpauthUrl"].(string), "otpauth://totp/Prior:grace@example.com?") {
		t.Fatalf("setup = %d %v", code, setup)
	}
	secret := setup["secret"].(string)
	var sealed string
	if err := pool.QueryRow(ctx, `SELECT totp_pending_secret FROM users WHERE email = 'grace@example.com'`).Scan(&sealed); err != nil || strings.Contains(sealed, secret) || !strings.HasPrefix(sealed, "gcm1:") {
		t.Fatalf("secret must be sealed at rest: %q %v", sealed, err)
	}
	if code, body := call("POST", "/v1/auth/2fa/enable", session, `{"code":"000000"}`); code != 400 || body["code"] != "INVALID_CODE" {
		t.Fatalf("wrong enable code = %d %v", code, body)
	}
	current, _ := totp.Code(secret, totp.Step(clock))
	code, enabled := call("POST", "/v1/auth/2fa/enable", session, `{"code":"`+current+`"}`)
	if code != 200 {
		t.Fatalf("enable = %d %v", code, enabled)
	}
	recovery := enabled["recoveryCodes"].([]any)
	if len(recovery) != 10 {
		t.Fatalf("recovery codes = %v", recovery)
	}

	// Password sign-in now returns a challenge, not a session.
	code, login := call("POST", "/v1/auth/login", "", `{"email":"grace@example.com","password":"correct horse","device":"Prior","platform":"web"}`)
	if code != 200 || login["twoFactorRequired"] != true || login["token"] != nil {
		t.Fatalf("login with 2FA = %d %v", code, login)
	}
	challenge := login["challenge"].(string)
	// The code used to enable 2FA cannot be replayed.
	if code, body := call("POST", "/v1/auth/2fa/verify", "", `{"challenge":"`+challenge+`","code":"`+current+`"}`); code != 400 || body["code"] != "INVALID_CODE" {
		t.Fatalf("replayed code = %d %v", code, body)
	}
	clock = clock.Add(totp.Period)
	next, _ := totp.Code(secret, totp.Step(clock))
	code, verified := call("POST", "/v1/auth/2fa/verify", "", `{"challenge":"`+challenge+`","code":"`+next+`"}`)
	if code != 200 || verified["token"] == nil {
		t.Fatalf("verify = %d %v", code, verified)
	}
	if code, _ := call("POST", "/v1/auth/2fa/verify", "", `{"challenge":"`+challenge+`","code":"`+next+`"}`); code != 400 {
		t.Fatal("a challenge must be single-use")
	}

	// Recovery code sign-in, single use.
	_, login = call("POST", "/v1/auth/login", "", `{"email":"grace@example.com","password":"correct horse"}`)
	recoveryCode := strings.ToUpper(recovery[0].(string))
	if code, body := call("POST", "/v1/auth/2fa/verify", "", `{"challenge":"`+login["challenge"].(string)+`","recoveryCode":"`+recoveryCode+`"}`); code != 200 || body["token"] == nil {
		t.Fatalf("recovery sign-in = %d %v", code, body)
	}
	_, login = call("POST", "/v1/auth/login", "", `{"email":"grace@example.com","password":"correct horse"}`)
	if code, _ := call("POST", "/v1/auth/2fa/verify", "", `{"challenge":"`+login["challenge"].(string)+`","recoveryCode":"`+recoveryCode+`"}`); code != 400 {
		t.Fatal("recovery codes are single-use")
	}
	if code, status := call("GET", "/v1/auth/2fa", session, ""); code != 200 || status["recoveryCodesLeft"] != float64(9) {
		t.Fatalf("codes left = %v", status)
	}

	// Lockout after repeated failures, across challenges.
	lockedOut := false
	for attempt := 0; attempt < 12 && !lockedOut; attempt++ {
		_, fresh := call("POST", "/v1/auth/login", "", `{"email":"grace@example.com","password":"correct horse"}`)
		code, body := call("POST", "/v1/auth/2fa/verify", "", `{"challenge":"`+fresh["challenge"].(string)+`","code":"999999"}`)
		if code == 429 && body["code"] == "TWO_FACTOR_LOCKED" {
			lockedOut = true
		}
		srv.limiter = newRateLimiter(1000, time.Minute)
	}
	if !lockedOut {
		t.Fatal("repeated wrong codes must lock verification")
	}
	clock = clock.Add(2 * totp.Period)
	good, _ := totp.Code(secret, totp.Step(clock))
	_, fresh := call("POST", "/v1/auth/login", "", `{"email":"grace@example.com","password":"correct horse"}`)
	if code, _ := call("POST", "/v1/auth/2fa/verify", "", `{"challenge":"`+fresh["challenge"].(string)+`","code":"`+good+`"}`); code != 429 {
		t.Fatalf("a locked account refuses even a valid code, got %d", code)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET totp_locked_until = NULL`); err != nil {
		t.Fatal(err)
	}

	// Disabling needs the password and a code.
	if code, body := call("POST", "/v1/auth/2fa/disable", session, `{"password":"wrong password","code":"`+good+`"}`); code != 403 || body["code"] != "INVALID_PASSWORD" {
		t.Fatalf("disable with wrong password = %d %v", code, body)
	}
	if code, body := call("POST", "/v1/auth/2fa/disable", session, `{"password":"correct horse"}`); code != 403 || body["code"] != "TWO_FACTOR_REQUIRED" {
		t.Fatalf("disable without code = %d %v", code, body)
	}
	if code, body := call("POST", "/v1/auth/2fa/disable", session, `{"password":"correct horse","code":"`+good+`"}`); code != 204 {
		t.Fatalf("disable = %d %v", code, body)
	}
	if code, login := call("POST", "/v1/auth/login", "", `{"email":"grace@example.com","password":"correct horse"}`); code != 200 || login["token"] == nil {
		t.Fatalf("login after disabling = %d %v", code, login)
	}
}

func TestTwoFactorRequiresEncryptionKeyPostgres(t *testing.T) {
	srv, _, _ := newIntegrationServer(t, config.Config{})
	call := callerFor(srv)
	_, body := call("POST", "/v1/auth/register", "", `{"email":"k@example.com","password":"correct horse"}`)
	if code, body := call("POST", "/v1/auth/2fa/setup", body["token"].(string), ""); code != 503 || body["code"] != "TWO_FACTOR_UNAVAILABLE" {
		t.Fatalf("setup without key = %d %v", code, body)
	}
}

func TestDeleteAndExportAccountPostgres(t *testing.T) {
	srv, pool, _ := newIntegrationServer(t, config.Config{})
	call := callerFor(srv)
	ctx := context.Background()
	clock := time.Now()
	srv.now = func() time.Time { return clock }

	_, body := call("POST", "/v1/auth/register", "", `{"email":"lin@example.com","password":"correct horse","displayName":"Lin"}`)
	token := body["token"].(string)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	taskID := uuid.NewString()
	push := `{"mutations":[{"id":"` + uuid.NewString() + `","kind":"upsert","entity":"task","createdAt":"` + now + `","task":{"id":"` + taskID + `","title":"=cmd|calc","description":"secret plan","priority":2,"status":"next","important":true,"urgent":false,"completed":false,"createdAt":"` + now + `","updatedAt":"` + now + `","deletedAt":null}}]}`
	if code, body := call("POST", "/v1/sync/push", token, push); code != 200 {
		t.Fatalf("push = %d %v", code, body)
	}
	if _, err := srv.store.SaveUserSettings(ctx, mustUserID(t, srv, token), "sk-or-secret", nil, "sk-openai-secret", true); err != nil {
		t.Fatal(err)
	}
	if err := srv.store.SaveNoteAttachment(ctx, mustUserID(t, srv, token), uuid.New(), "../plan.txt", "text/plain", []byte("attached")); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest("GET", "/v1/me/export", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	srv.Handler().ServeHTTP(response, request)
	if response.Code != 200 || response.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("export = %d %s", response.Code, response.Body.String())
	}
	archive, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, file := range archive.File {
		reader, _ := file.Open()
		content, _ := io.ReadAll(reader)
		reader.Close()
		files[file.Name] = string(content)
	}
	for _, name := range []string{"README.txt", "profile.json", "tasks.json", "tasks.csv", "habits.json", "notes.json", "projects.json", "settings.json", "game.json", "assistant-chats.json", "comments.json"} {
		if _, ok := files[name]; !ok {
			t.Fatalf("export misses %s (has %v)", name, keys(files))
		}
	}
	if !strings.Contains(files["tasks.json"], "secret plan") || !strings.Contains(files["tasks.csv"], "'=cmd|calc") {
		t.Fatalf("tasks export = %s / %s", files["tasks.json"], files["tasks.csv"])
	}
	all := strings.Join(values(files), "\n")
	for _, forbidden := range []string{"sk-or-secret", "sk-openai-secret", "$2a$", token} {
		if strings.Contains(all, forbidden) {
			t.Fatalf("export leaks %q", forbidden)
		}
	}
	attachment := false
	for name, content := range files {
		if strings.HasPrefix(name, "attachments/") && strings.HasSuffix(name, "-plan.txt") && content == "attached" && !strings.Contains(name, "..") {
			attachment = true
		}
	}
	if !attachment {
		t.Fatalf("attachment missing: %v", keys(files))
	}

	// Deletion requires the email and the password.
	if code, body := call("DELETE", "/v1/me", token, `{"email":"other@example.com","password":"correct horse"}`); code != 400 || body["code"] != "EMAIL_MISMATCH" {
		t.Fatalf("wrong email = %d %v", code, body)
	}
	if code, body := call("DELETE", "/v1/me", token, `{"email":"lin@example.com","password":"nope nope"}`); code != 403 || body["code"] != "INVALID_PASSWORD" {
		t.Fatalf("wrong password = %d %v", code, body)
	}
	if code, body := call("DELETE", "/v1/me", token, `{"email":"LIN@example.com","password":"correct horse"}`); code != 204 {
		t.Fatalf("delete = %d %v", code, body)
	}
	if code, _ := call("GET", "/v1/me", token, ""); code != 401 {
		t.Fatal("the session must be gone")
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE id = $1`, taskID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("task left = %d %v", count, err)
	}

	// Google-only accounts: a recent sign-in instead of a password.
	googleUser, err := srv.store.UpsertUser(ctx, "google-sub-1", "g@example.com", true, "G", "")
	if err != nil {
		t.Fatal(err)
	}
	googleToken := uuid.NewString()
	if err := srv.store.CreateSession(ctx, googleUser.ID, googleToken, "test", "web", time.Hour); err != nil {
		t.Fatal(err)
	}
	if code, me := call("GET", "/v1/me", googleToken, ""); code != 200 || me["emailVerified"] != true || me["hasPassword"] != false || me["googleLinked"] != true {
		t.Fatalf("google me = %d %v", code, me)
	}
	clock = time.Now().Add(11 * time.Minute)
	if code, body := call("DELETE", "/v1/me", googleToken, `{"email":"g@example.com"}`); code != 403 || body["code"] != "REAUTH_REQUIRED" {
		t.Fatalf("stale google session = %d %v", code, body)
	}
	clock = time.Now()
	if code, body := call("DELETE", "/v1/me", googleToken, `{"email":"g@example.com"}`); code != 204 {
		t.Fatalf("google delete = %d %v", code, body)
	}
}

func TestDeleteCancelsStripeFirstPostgres(t *testing.T) {
	srv, pool, _ := newIntegrationServer(t, config.Config{})
	call := callerFor(srv)
	ctx := context.Background()
	_, body := call("POST", "/v1/auth/register", "", `{"email":"pay@example.com","password":"correct horse"}`)
	token := body["token"].(string)
	userID := mustUserID(t, srv, token)
	if _, err := pool.Exec(ctx, `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status) VALUES ($1, 'cus_9', 'sub_9', 'pro', 'active')`, userID); err != nil {
		t.Fatal(err)
	}
	// Stripe unreachable: the account is kept.
	if code, body := call("DELETE", "/v1/me", token, `{"email":"pay@example.com","password":"correct horse"}`); code != 502 || body["code"] != "BILLING_CANCEL_FAILED" {
		t.Fatalf("delete without stripe = %d %v", code, body)
	}
	canceled := ""
	stripe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			canceled = r.URL.Path
		}
		_, _ = w.Write([]byte(`{"id":"sub_9","status":"canceled"}`))
	}))
	defer stripe.Close()
	srv.stripe = billing.NewStripe("sk_test_fake", stripe.Client()).WithBaseURL(stripe.URL)
	if code, body := call("DELETE", "/v1/me", token, `{"email":"pay@example.com","password":"correct horse"}`); code != 204 {
		t.Fatalf("delete = %d %v", code, body)
	}
	if canceled != "/v1/subscriptions/sub_9" {
		t.Fatalf("stripe cancel path = %q", canceled)
	}
}

func keys(files map[string]string) []string {
	result := make([]string, 0, len(files))
	for name := range files {
		result = append(result, name)
	}
	return result
}

func values(files map[string]string) []string {
	result := make([]string, 0, len(files))
	for _, content := range files {
		result = append(result, content)
	}
	return result
}
