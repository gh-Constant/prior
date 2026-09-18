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
		RateLimitAuth:          getenvInt("RATE_LIMIT_AUTH_PER_MIN", 20),
		RateLimitPush:          getenvInt("RATE_LIMIT_PUSH_PER_MIN", 60),
		RateLimitPull:          getenvInt("RATE_LIMIT_PULL_PER_MIN", 120),
		RateLimitWorkspace:     getenvInt("RATE_LIMIT_WORKSPACE_PER_MIN", 30),
		RateLimitTranscribe:    getenvInt("RATE_LIMIT_TRANSCRIBE_PER_MIN", 10),
		RateLimitAgent:         getenvInt("RATE_LIMIT_AGENT_PER_MIN", 60),
		RateLimitSettings:      getenvInt("RATE_LIMIT_SETTINGS_PER_MIN", 60),
		RetentionMutationsDays: getenvInt("RETENTION_MUTATIONS_DAYS", 90),
		RetentionSessionsDays:  getenvInt("RETENTION_SESSIONS_DAYS", 30),
		TrustProxy:             getenv("TRUST_PROXY", "true") == "true",
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
