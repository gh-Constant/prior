package httpapi

// Gmail inbox backend.
//
// The refresh token granted during Gmail connect is stored sealed (see
// settings.go); the client only ever receives short-lived access tokens via
// /v1/mail/token. Those tokens carry the scopes the user approved during
// connect (see GMAIL_SCOPES below) and are minted by Google directly, so the
// server never proxies message content.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
)

// Mail OAuth scopes requested during connect. Read-only is NOT enough: the
// inboxarchives (remove INBOX), stars, marks read/unread and applies tags.
// gmail.labels grants label/tag management; gmail.modify covers the rest.
const (
	mailScopeModify = "https://www.googleapis.com/auth/gmail.modify"
	mailScopeLabels = "https://www.googleapis.com/auth/gmail.labels"
)

const (
	mailGoogleAuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"
	mailGoogleTokenURL = "https://oauth2.googleapis.com/token"
	mailProfileURL     = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
	mailRevokeURL      = "https://oauth2.googleapis.com/revoke"
)

type mailConnectState struct {
	userID   uuid.UUID
	returnTo string
	verifier string
	expires  time.Time
}

var (
	mailStatesMu sync.Mutex
	mailStates   = map[string]mailConnectState{}
)

// mailConnectStart begins the Gmail OAuth grant. Authenticated (the session
// token arrives as ?token= because a top-level redirect cannot set headers).
// A PKCE verifier + short-lived state bind the callback to this user.
func (s *Server) mailConnectStart(w http.ResponseWriter, r *http.Request) {
	if !s.allowEndpoint(w, r, s.authLimiter(), "mail connect") {
		return
	}
	user, err := s.store.UserForToken(r.Context(), r.URL.Query().Get("token"))
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	returnTo := strings.TrimSpace(r.URL.Query().Get("return_to"))
	if returnTo == "" || !validMailReturnTo(s.cfg.AllowedReturnOrigins, returnTo) {
		writeError(w, http.StatusBadRequest, errors.New("return_to is not allowlisted"))
		return
	}
	oauthCfg, err := s.mailOAuthConfig()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	state, err := mailRandomString(24)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to start Gmail connect"))
		return
	}
	verifier, err := mailRandomString(64)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to start Gmail connect"))
		return
	}
	mailStatesMu.Lock()
	mailStates[state] = mailConnectState{userID: user.ID, returnTo: returnTo, verifier: verifier, expires: time.Now().Add(10 * time.Minute)}
	pruneMailStates()
	mailStatesMu.Unlock()

	challenge := mailCodeChallenge(verifier)
	authURL := oauthCfg.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("code_challenge", challenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		oauth2.SetAuthURLParam("prompt", "consent select_account"),
	)
	http.Redirect(w, r, authURL, http.StatusFound)
}

// mailGoogleCallback completes the grant: code → tokens (PKCE), Gmail address
// lookup, sealed refresh-token storage, then back to the app return_to.
func (s *Server) mailGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if !s.allowEndpoint(w, r, s.limiter, "mail callback") {
		return
	}
	query := r.URL.Query()
	if query.Get("error") != "" {
		writeError(w, http.StatusBadRequest, errors.New("Google did not approve Gmail access"))
		return
	}
	mailStatesMu.Lock()
	pending, ok := mailStates[query.Get("state")]
	delete(mailStates, query.Get("state"))
	mailStatesMu.Unlock()
	code := query.Get("code")
	if !ok || time.Now().After(pending.expires) || code == "" {
		writeError(w, http.StatusBadRequest, errors.New("Gmail connect session expired; please try again"))
		return
	}

	oauthCfg, err := s.mailOAuthConfig()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	token, err := oauthCfg.Exchange(r.Context(), code, oauth2.SetAuthURLParam("code_verifier", pending.verifier))
	if err != nil {
		slog.Warn("gmail token exchange failed", "user_id_hash", userIDHash(pending.userID))
		writeError(w, http.StatusBadGateway, errors.New("Google did not return Gmail tokens"))
		return
	}
	if token.RefreshToken == "" {
		writeError(w, http.StatusBadGateway, errors.New("Google did not return a refresh token; reconnect and approve access"))
		return
	}

	email, err := mailAccountEmail(r.Context(), token.AccessToken)
	if err != nil || email == "" {
		slog.Warn("gmail profile lookup failed", "user_id_hash", userIDHash(pending.userID))
		writeError(w, http.StatusBadGateway, errors.New("unable to read the Gmail address"))
		return
	}

	sealed, err := sealSettingsValue(s.cfg.SettingsEncryptionKey, token.RefreshToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save the Gmail connection"))
		return
	}
	if err := s.store.SaveMailAccount(r.Context(), pending.userID, "gmail", email, sealed, strings.Join(oauthCfg.Scopes, " ")); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save the Gmail connection"))
		return
	}

	separator := "?"
	if strings.Contains(pending.returnTo, "?") {
		separator = "&"
	}
	http.Redirect(w, r, pending.returnTo+separator+"email="+url.QueryEscape(email), http.StatusFound)
}

// mailAccounts lists the user's connected Gmail accounts (never any secrets).
func (s *Server) mailAccounts(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	accounts, err := s.store.ListMailAccounts(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load Gmail accounts"))
		return
	}
	type publicAccount struct {
		ID          string `json:"id"`
		Email       string `json:"email"`
		ConnectedAt string `json:"connectedAt"`
	}
	out := make([]publicAccount, 0, len(accounts))
	for _, account := range accounts {
		out = append(out, publicAccount{ID: account.ID.String(), Email: account.Email, ConnectedAt: account.ConnectedAt.UTC().Format(time.RFC3339)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": out})
}

// mailToken mints a short-lived Gmail access token for the caller's newest
// connected account by refreshing the sealed offline token. The refresh token
// itself never leaves the server; the client uses the access token directly
// against the Gmail REST API.
func (s *Server) mailToken(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.settingsLimiter, "mail token") {
		return
	}
	account, err := s.store.NewestMailAccount(r.Context(), user.ID, "gmail")
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, errors.New("no Gmail account connected"))
			return
		}
		writeError(w, http.StatusInternalServerError, errors.New("unable to load Gmail accounts"))
		return
	}
	refreshToken, err := openSettingsValue(s.cfg.SettingsEncryptionKey, account.RefreshToken)
	if err != nil || refreshToken == "" {
		writeError(w, http.StatusInternalServerError, errors.New("unable to open the Gmail connection"))
		return
	}
	oauthCfg, err := s.mailOAuthConfig()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	token, err := oauthCfg.TokenSource(r.Context(), &oauth2.Token{RefreshToken: refreshToken}).Token()
	if err != nil || token.AccessToken == "" {
		slog.Warn("gmail refresh failed", "user_id_hash", userIDHash(user.ID))
		writeError(w, http.StatusBadGateway, errors.New("Gmail needs to be reconnected"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accessToken": token.AccessToken, "expiresIn": 3600, "email": account.Email})
}

// mailDisconnect revokes the grant at Google (best effort), then deletes the
// stored token. Message content was never stored server-side.
func (s *Server) mailDisconnect(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid account id"))
		return
	}
	account, err := s.store.GetMailAccount(r.Context(), user.ID, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, errors.New("Gmail account not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, errors.New("unable to load Gmail accounts"))
		return
	}
	if refreshToken, err := openSettingsValue(s.cfg.SettingsEncryptionKey, account.RefreshToken); err == nil && refreshToken != "" {
		body := strings.NewReader("token=" + url.QueryEscape(refreshToken))
		if revokeReq, reqErr := http.NewRequestWithContext(r.Context(), http.MethodPost, mailRevokeURL, body); reqErr == nil {
			revokeReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			if revokeRes, doErr := http.DefaultClient.Do(revokeReq); doErr == nil {
				revokeRes.Body.Close()
			}
		}
	}
	if err := s.store.DeleteMailAccount(r.Context(), user.ID, id); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to disconnect Gmail"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// validMailReturnTo allows the in-app hash route on an already-allowlisted
// origin, but never arbitrary URLs. Native shells use
// prior://auth/callback#/mail-connected?email=… (deep link), web uses
// {origin}/#/mail-connected?email=…. The allowlist stores full sign-in
// return URLs (…/auth/callback), so web returns are matched on origin
// (scheme + host) rather than the full path.
func validMailReturnTo(allowed []string, returnTo string) bool {
	parsed, err := url.Parse(returnTo)
	if err != nil || parsed.Fragment == "" || !strings.HasPrefix(parsed.Fragment, "/mail-connected") {
		return false
	}
	if parsed.User != nil {
		return false
	}
	if parsed.Scheme == "prior" && parsed.Host == "auth" && parsed.Path == "/callback" {
		return parsed.RawQuery == ""
	}
	if parsed.RawQuery != "" {
		return false
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return false
	}
	if parsed.Host == "" {
		return false
	}
	// Plain http is only ever a loopback dev origin; production origins are https.
	if parsed.Scheme == "http" {
		host := parsed.Hostname()
		if host != "localhost" && host != "127.0.0.1" && host != "::1" {
			return false
		}
	}
	returnOrigin := strings.ToLower(parsed.Scheme + "://" + parsed.Host)
	for _, origin := range allowed {
		allowedParsed, err := url.Parse(strings.TrimSpace(origin))
		if err != nil || allowedParsed.Host == "" {
			continue
		}
		if allowedParsed.Scheme != "https" && allowedParsed.Scheme != "http" {
			continue
		}
		if returnOrigin == strings.ToLower(allowedParsed.Scheme+"://"+allowedParsed.Host) {
			return true
		}
	}
	return false
}

// mailAccountEmail resolves the Gmail address for a fresh access token.
func mailAccountEmail(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mailProfileURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gmail profile status %d", res.StatusCode)
	}
	var profile struct {
		EmailAddress string `json:"emailAddress"`
	}
	if err := json.NewDecoder(res.Body).Decode(&profile); err != nil {
		return "", err
	}
	return strings.TrimSpace(profile.EmailAddress), nil
}

func mailRandomString(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func mailCodeChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func pruneMailStates() {
	now := time.Now()
	for key, value := range mailStates {
		if now.After(value.expires) {
			delete(mailStates, key)
		}
	}
}

// mailOAuthConfig builds the Gmail OAuth client from the shared Google
// credentials. The mail callback reuses the sign-in redirect base
// (/v1/mail/google/callback instead of /auth/google/callback) so no extra env
// var is needed; that exact URL must be registered in the Google Cloud
// console (see the OAuth notes in the final handoff summary).
func (s *Server) mailOAuthConfig() (*oauth2.Config, error) {
	if s.cfg.GoogleClientID == "" || s.cfg.GoogleClientSecret == "" {
		return nil, errors.New("Google OAuth is not configured")
	}
	redirect := s.cfg.GoogleRedirectURL
	if strings.HasSuffix(redirect, "/auth/google/callback") {
		redirect = strings.TrimSuffix(redirect, "/auth/google/callback") + "/v1/mail/google/callback"
	}
	return &oauth2.Config{
		ClientID:     s.cfg.GoogleClientID,
		ClientSecret: s.cfg.GoogleClientSecret,
		RedirectURL:  redirect,
		Endpoint:     oauth2.Endpoint{AuthURL: mailGoogleAuthURL, TokenURL: mailGoogleTokenURL},
		Scopes:       []string{mailScopeModify, mailScopeLabels},
	}, nil
}
