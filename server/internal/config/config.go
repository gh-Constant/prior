package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env                  string
	HTTPAddr             string
	DatabaseURL          string
	PublicAPIURL         string
	GoogleClientID       string
	GoogleClientSecret   string
	GoogleRedirectURL    string
	AllowedReturnOrigins []string
	// Extra accepted `aud` values for ID tokens coming from the native
	// Android sign-in (Credential Manager). Defaults to GoogleClientID.
	GoogleNativeAudiences []string
	SessionTTL            time.Duration
	// Hex-encoded 32-byte key used to seal per-user assistant secrets
	// (OpenRouter API key) at rest with AES-256-GCM. Empty disables
	// at-rest sealing; access is still restricted to the owning user.
	SettingsEncryptionKey string
	// Per-endpoint rate limits (requests per minute). Zero means use defaults.
	RateLimitAuth       int
	RateLimitPush       int
	RateLimitPull       int
	RateLimitWorkspace  int
	RateLimitTranscribe int
	RateLimitAgent      int
	RateLimitSettings   int
	// Retention windows for background cleanup.
	RetentionMutationsDays int
	RetentionSessionsDays  int
	// TrustProxy controls whether X-Forwarded-For is honored. It is only
	// honored when the direct peer is loopback or a private address, so this
	// is safe to leave enabled behind Coolify/Caddy. Set to false to always
	// use the direct peer IP.
	TrustProxy bool
	// HostedAI is Prior's own server-side AI (Prior AI). When its API key is
	// set, signed-in users get the assistant, recommendations, mail and
	// calendar drafts, and dictation without configuring any key themselves.
	HostedAI HostedAIConfig
	// MinAndroidVersion, when set (e.g. 1.4.0), makes installed Android apps
	// older than it show a blocking update screen. Empty = never force.
	MinAndroidVersion string
	// Billing is Stripe plus the admin allowlist.
	Billing BillingConfig
	// Transactional email through Resend (password reset, verification).
	// An empty key logs links in development and sends nothing in production.
	ResendAPIKey string
	EmailFrom    string
	// Web app origin used in emailed links (/reset-password, /verify-email).
	WebAppURL string
	// Hex-encoded 32-byte AES-256-GCM key sealing TOTP secrets. 2FA cannot be
	// turned on while it is empty.
	TOTPEncryptionKey string
}

// BillingConfig holds Stripe settings. Keys only ever come from the
// environment; the server creates its own products, prices, portal
// configuration and (when no secret is given) webhook endpoint.
type BillingConfig struct {
	StripeSecretKey      string
	StripePublishableKey string
	// Optional: signing secret of a webhook endpoint created by hand. When
	// empty, the API manages its own endpoint at PUBLIC_API_URL.
	StripeWebhookSecret string
	// Where Stripe Checkout and the customer portal send people back to
	// when the client did not give an allowed return URL.
	ReturnURL string
	// Verified emails that may open the admin dashboard.
	AdminEmails []string
}

func (c BillingConfig) StripeEnabled() bool { return strings.TrimSpace(c.StripeSecretKey) != "" }

// HostedAIConfig describes the OpenAI-compatible provider Prior pays for.
// Model IDs are per use case so they can be swapped without a release.
type HostedAIConfig struct {
	APIKey  string
	BaseURL string
	// Model per purpose. Empty purposes fall back to AgentModel.
	AgentModel           string
	RecommendationsModel string
	MailModel            string
	CalendarModel        string
	// Extra models OpenRouter tries in order when the primary one fails.
	FallbackModels []string
	// OpenRouter reasoning.effort for the assistant and for the short drafts
	// (recommendations, mail, calendar). Empty keeps the provider default.
	AgentReasoningEffort string
	DraftReasoningEffort string
	// Hosted requests (completions + transcriptions) per user per UTC day.
	// An abuse backstop; plan quotas live in the API's entitlement check.
	DailyRequestsPerUser int
	// Emails with Prior AI access before paid plans exist (operator, testers).
	AllowedEmails []string
	// OpenAI-compatible /audio/transcriptions endpoint for dictation.
	TranscriptionAPIKey string
	TranscriptionURL    string
	TranscriptionModel  string
}

func (c HostedAIConfig) Enabled() bool { return strings.TrimSpace(c.APIKey) != "" }

func (c HostedAIConfig) TranscriptionEnabled() bool {
	return strings.TrimSpace(c.TranscriptionAPIKey) != "" && strings.TrimSpace(c.TranscriptionURL) != ""
}

// ModelFor returns the configured model for a purpose ("agent",
// "recommendations", "mail", "calendar").
func (c HostedAIConfig) ModelFor(purpose string) string {
	switch purpose {
	case "recommendations":
		return firstSet(c.RecommendationsModel, c.AgentModel)
	case "mail":
		return firstSet(c.MailModel, c.AgentModel)
	case "calendar":
		return firstSet(c.CalendarModel, c.AgentModel)
	default:
		return c.AgentModel
	}
}

// ReasoningEffortFor returns the configured reasoning effort for a purpose.
func (c HostedAIConfig) ReasoningEffortFor(purpose string) string {
	if purpose == "agent" || purpose == "" {
		return strings.TrimSpace(c.AgentReasoningEffort)
	}
	return strings.TrimSpace(c.DraftReasoningEffort)
}

func firstSet(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func Load() Config {
	ttl, err := time.ParseDuration(getenv("SESSION_TTL", "720h"))
	if err != nil {
		ttl = 720 * time.Hour
	}
	return Config{
		Env:                    getenv("APP_ENV", "development"),
		HTTPAddr:               getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:            os.Getenv("DATABASE_URL"),
		PublicAPIURL:           getenv("PUBLIC_API_URL", "http://localhost:8080"),
		GoogleClientID:         os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:     os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:      getenv("GOOGLE_REDIRECT_URL", "http://localhost:8080/auth/google/callback"),
		AllowedReturnOrigins:   split(getenv("ALLOWED_AUTH_RETURN_ORIGINS", "prior://auth/callback,http://localhost:1420/auth/callback,http://127.0.0.1:1420/auth/callback,https://app.prior.constantsuchet.fr/auth/callback")),
		GoogleNativeAudiences:  split(os.Getenv("GOOGLE_NATIVE_AUDIENCES")),
		SettingsEncryptionKey:  os.Getenv("SETTINGS_ENCRYPTION_KEY"),
		SessionTTL:             ttl,
		RateLimitAuth:          getenvInt("RATE_LIMIT_AUTH_PER_MIN", 60),
		RateLimitPush:          getenvInt("RATE_LIMIT_PUSH_PER_MIN", 300),
		RateLimitPull:          getenvInt("RATE_LIMIT_PULL_PER_MIN", 600),
		RateLimitWorkspace:     getenvInt("RATE_LIMIT_WORKSPACE_PER_MIN", 300),
		RateLimitTranscribe:    getenvInt("RATE_LIMIT_TRANSCRIBE_PER_MIN", 30),
		RateLimitAgent:         getenvInt("RATE_LIMIT_AGENT_PER_MIN", 120),
		RateLimitSettings:      getenvInt("RATE_LIMIT_SETTINGS_PER_MIN", 120),
		RetentionMutationsDays: getenvInt("RETENTION_MUTATIONS_DAYS", 90),
		RetentionSessionsDays:  getenvInt("RETENTION_SESSIONS_DAYS", 30),
		TrustProxy:             getenv("TRUST_PROXY", "true") == "true",
		HostedAI:               loadHostedAI(),
		MinAndroidVersion:      strings.TrimSpace(os.Getenv("MIN_ANDROID_VERSION")),
		ResendAPIKey:           os.Getenv("RESEND_API_KEY"),
		EmailFrom:              getenv("EMAIL_FROM", "Prior <no-reply@prior.constantsuchet.fr>"),
		WebAppURL:              strings.TrimRight(getenv("WEB_APP_URL", "https://app.prior.constantsuchet.fr"), "/"),
		TOTPEncryptionKey:      os.Getenv("TOTP_ENCRYPTION_KEY"),
		Billing: BillingConfig{
			StripeSecretKey:      os.Getenv("STRIPE_SECRET_KEY"),
			StripePublishableKey: os.Getenv("STRIPE_PUBLISHABLE_KEY"),
			StripeWebhookSecret:  os.Getenv("STRIPE_WEBHOOK_SECRET"),
			ReturnURL:            getenv("BILLING_RETURN_URL", "https://app.prior.constantsuchet.fr/"),
			AdminEmails:          split(getenv("ADMIN_EMAILS", "constantsuchet@gmail.com")),
		},
	}
}

// loadHostedAI reads Prior AI's settings. Defaults follow the model research
// of 2026-09-29 (see specs/AI.md) and are meant to be overridden by env as prices
// and models move.
func loadHostedAI() HostedAIConfig {
	apiKey := os.Getenv("AI_API_KEY")
	baseURL := strings.TrimRight(getenv("AI_BASE_URL", "https://openrouter.ai/api/v1"), "/")
	return HostedAIConfig{
		APIKey:               apiKey,
		BaseURL:              baseURL,
		AgentModel:           getenv("AI_MODEL_AGENT", "z-ai/glm-5.3-flash"),
		RecommendationsModel: getenv("AI_MODEL_RECOMMENDATIONS", "openai/gpt-6-luna"),
		MailModel:            getenv("AI_MODEL_MAIL", "openai/gpt-6-luna"),
		CalendarModel:        getenv("AI_MODEL_CALENDAR", "openai/gpt-6-luna"),
		FallbackModels:       split(getenv("AI_MODEL_FALLBACKS", "deepseek/deepseek-v4.1-flash")),
		AgentReasoningEffort: os.Getenv("AI_REASONING_EFFORT_AGENT"),
		DraftReasoningEffort: getenv("AI_REASONING_EFFORT_DRAFTS", "low"),
		DailyRequestsPerUser: getenvInt("AI_DAILY_REQUESTS_PER_USER", 300),
		AllowedEmails:        split(os.Getenv("AI_HOSTED_ALLOWED_EMAILS")),
		// One OpenRouter key covers chat and speech-to-text by default.
		TranscriptionAPIKey: getenv("AI_TRANSCRIPTION_API_KEY", apiKey),
		TranscriptionURL:    getenv("AI_TRANSCRIPTION_URL", baseURL+"/audio/transcriptions"),
		TranscriptionModel:  getenv("AI_TRANSCRIPTION_MODEL", "microsoft/mai-transcribe-2"),
	}
}

func (c Config) Production() bool { return c.Env == "production" }

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func split(value string) []string {
	var result []string
	for _, part := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
