package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/gh-Constant/prior/server/internal/store"
	"golang.org/x/oauth2"
)

type stateValue struct {
	returnTo  string
	verifier  string
	nonce     string
	expiresAt time.Time
}
type exchangeValue struct {
	user      store.User
	expiresAt time.Time
}

type Manager struct {
	cfg       config.Config
	store     *store.Store
	mu        sync.Mutex
	states    map[string]stateValue
	exchanges map[[32]byte]exchangeValue
	oauth     *oauth2.Config
	provider  *oidc.Provider
	verifier  *oidc.IDTokenVerifier
}

func NewManager(cfg config.Config, database *store.Store) *Manager {
	return &Manager{
		cfg: cfg, store: database, states: make(map[string]stateValue), exchanges: make(map[[32]byte]exchangeValue),
		oauth: &oauth2.Config{ClientID: cfg.GoogleClientID, ClientSecret: cfg.GoogleClientSecret, RedirectURL: cfg.GoogleRedirectURL, Endpoint: oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"}, Scopes: []string{oidc.ScopeOpenID, "email", "profile"}},
	}
}

func (m *Manager) Start(ctx context.Context, returnTo string) (string, error) {
	if m.cfg.GoogleClientID == "" || m.cfg.GoogleClientSecret == "" {
		return "", errors.New("Google OAuth is not configured")
	}
	if _, _, err := m.oidc(ctx); err != nil {
		return "", fmt.Errorf("load Google OpenID configuration: %w", err)
	}
	safeReturnTo, err := m.validateReturnTo(returnTo)
	if err != nil {
		return "", err
	}
	state, err := randomString(32)
	if err != nil {
		return "", err
	}
	verifier, err := randomString(32)
	if err != nil {
		return "", err
	}
	nonce, err := randomString(32)
	if err != nil {
		return "", err
	}
	challengeHash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(challengeHash[:])
	m.mu.Lock()
	m.states[state] = stateValue{returnTo: safeReturnTo, verifier: verifier, nonce: nonce, expiresAt: time.Now().Add(10 * time.Minute)}
	m.mu.Unlock()
	return m.oauth.AuthCodeURL(state, oauth2.AccessTypeOnline, oauth2.SetAuthURLParam("code_challenge", challenge), oauth2.SetAuthURLParam("code_challenge_method", "S256"), oauth2.SetAuthURLParam("nonce", nonce)), nil
}

func (m *Manager) Callback(ctx context.Context, code, state string) (string, error) {
	m.mu.Lock()
	value, ok := m.states[state]
	delete(m.states, state)
	m.mu.Unlock()
	if !ok || time.Now().After(value.expiresAt) {
		return "", errors.New("invalid or expired OAuth state")
	}
	if code == "" {
		return value.returnTo, errors.New("OAuth code is missing")
	}
	_, verifier, err := m.oidc(ctx)
	if err != nil {
		return value.returnTo, err
	}
	token, err := m.oauth.Exchange(ctx, code, oauth2.SetAuthURLParam("code_verifier", value.verifier))
	if err != nil {
		return value.returnTo, fmt.Errorf("exchange Google code: %w", err)
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return value.returnTo, errors.New("Google did not return an ID token")
	}
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return value.returnTo, fmt.Errorf("verify Google identity: %w", err)
	}
	if idToken.Nonce != value.nonce {
		return value.returnTo, errors.New("Google nonce validation failed")
	}
	var claims struct {
		Subject       string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return value.returnTo, fmt.Errorf("read Google identity: %w", err)
	}
	if claims.Subject == "" || claims.Email == "" || !claims.EmailVerified {
		return value.returnTo, errors.New("Google account has no verified email")
	}
	user, err := m.store.UpsertUser(ctx, claims.Subject, claims.Email, claims.EmailVerified, claims.Name, claims.Picture)
	if err != nil {
		return value.returnTo, fmt.Errorf("save Prior user: %w", err)
	}
	exchangeCode, err := randomString(32)
	if err != nil {
		return value.returnTo, err
	}
	m.mu.Lock()
	m.exchanges[sha256.Sum256([]byte(exchangeCode))] = exchangeValue{user: user, expiresAt: time.Now().Add(2 * time.Minute)}
	m.mu.Unlock()
	return value.returnTo + "?code=" + url.QueryEscape(exchangeCode), nil
}

func (m *Manager) Exchange(ctx context.Context, code string, device, platform string) (string, store.User, error) {
	hash := sha256.Sum256([]byte(code))
	m.mu.Lock()
	value, ok := m.exchanges[hash]
	delete(m.exchanges, hash)
	m.mu.Unlock()
	if !ok || time.Now().After(value.expiresAt) {
		return "", store.User{}, errors.New("invalid or expired exchange code")
	}
	token, err := randomString(32)
	if err != nil {
		return "", store.User{}, err
	}
	if err := m.store.CreateSession(ctx, value.user.ID, token, device, platform, m.cfg.SessionTTL); err != nil {
		return "", store.User{}, err
	}
	return token, value.user, nil
}

func (m *Manager) oidc(ctx context.Context) (*oidc.Provider, *oidc.IDTokenVerifier, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.provider != nil && m.verifier != nil {
		return m.provider, m.verifier, nil
	}
	provider, err := oidc.NewProvider(ctx, "https://accounts.google.com")
	if err != nil {
		return nil, nil, err
	}
	m.provider = provider
	m.verifier = provider.Verifier(&oidc.Config{ClientID: m.cfg.GoogleClientID})
	m.oauth.Endpoint = provider.Endpoint()
	return m.provider, m.verifier, nil
}

func (m *Manager) validateReturnTo(candidate string) (string, error) {
	if candidate == "" {
		if len(m.cfg.AllowedReturnOrigins) == 0 {
			return "", errors.New("no auth return URL configured")
		}
		candidate = m.cfg.AllowedReturnOrigins[0]
	}
	parsed, err := url.Parse(candidate)
	if err != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("invalid auth return URL")
	}
	base := parsed.Scheme + "://" + parsed.Host + parsed.Path
	for _, allowed := range m.cfg.AllowedReturnOrigins {
		if base == strings.TrimRight(allowed, "/") {
			return base, nil
		}
	}
	return "", errors.New("auth return URL is not allowlisted")
}

func randomString(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func (m *Manager) Cleanup() {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, value := range m.states {
		if now.After(value.expiresAt) {
			delete(m.states, key)
		}
	}
	for key, value := range m.exchanges {
		if now.After(value.expiresAt) {
			delete(m.exchanges, key)
		}
	}
}
