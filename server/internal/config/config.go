package config

import (
	"os"
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
}

func Load() Config {
	ttl, err := time.ParseDuration(getenv("SESSION_TTL", "720h"))
	if err != nil {
		ttl = 720 * time.Hour
	}
	return Config{
		Env:                   getenv("APP_ENV", "development"),
		HTTPAddr:              getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:           os.Getenv("DATABASE_URL"),
		PublicAPIURL:          getenv("PUBLIC_API_URL", "http://localhost:8080"),
		GoogleClientID:        os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:    os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:     getenv("GOOGLE_REDIRECT_URL", "http://localhost:8080/auth/google/callback"),
		AllowedReturnOrigins:  split(getenv("ALLOWED_AUTH_RETURN_ORIGINS", "prior://auth/callback,http://localhost:1420/auth/callback")),
		GoogleNativeAudiences: split(os.Getenv("GOOGLE_NATIVE_AUDIENCES")),
		SessionTTL:            ttl,
	}
}

func (c Config) Production() bool { return c.Env == "production" }

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
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
