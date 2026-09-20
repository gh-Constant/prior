package httpapi

// Google Calendar backend.
//
// Calendar grants are separate from Prior sign-in and Gmail. The server keeps
// the offline refresh token sealed, then exposes only a short-lived access
// token to the client so the browser can read events from Google's Calendar
// API without receiving a durable credential.

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

const (
	calendarScopeReadonly  = "https://www.googleapis.com/auth/calendar.readonly"
	calendarGoogleAuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"
	calendarGoogleTokenURL = "https://oauth2.googleapis.com/token"
	calendarProfileURL     = "https://openidconnect.googleapis.com/v1/userinfo"
	calendarRevokeURL      = "https://oauth2.googleapis.com/revoke"
)

type calendarConnectState struct {
	userID   uuid.UUID
	returnTo string
	verifier string
	expires  time.Time
}

var (
	calendarStatesMu sync.Mutex
	calendarStates   = map[string]calendarConnectState{}
)

func (s *Server) calendarConnectStart(w http.ResponseWriter, r *http.Request) {
	if !s.allowEndpoint(w, r, s.authLimiter(), "calendar connect") {
		return
	}
	user, err := s.store.UserForToken(r.Context(), r.URL.Query().Get("token"))
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	returnTo := strings.TrimSpace(r.URL.Query().Get("return_to"))
	if returnTo == "" || !validCalendarReturnTo(s.cfg.AllowedReturnOrigins, returnTo) {
		writeError(w, http.StatusBadRequest, errors.New("return_to is not allowlisted"))
		return
	}
	oauthCfg, err := s.calendarOAuthConfig()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	state, err := calendarRandomString(24)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to start Google Calendar connect"))
		return
	}
	verifier, err := calendarRandomString(64)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to start Google Calendar connect"))
		return
	}
	calendarStatesMu.Lock()
	calendarStates[state] = calendarConnectState{userID: user.ID, returnTo: returnTo, verifier: verifier, expires: time.Now().Add(10 * time.Minute)}
	pruneCalendarStates()
	calendarStatesMu.Unlock()

	authURL := oauthCfg.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("code_challenge", calendarCodeChallenge(verifier)),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		oauth2.SetAuthURLParam("prompt", "consent select_account"),
	)
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (s *Server) calendarGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if !s.allowEndpoint(w, r, s.limiter, "calendar callback") {
		return
	}
	query := r.URL.Query()
	calendarStatesMu.Lock()
	pending, ok := calendarStates[query.Get("state")]
	delete(calendarStates, query.Get("state"))
	calendarStatesMu.Unlock()
	if !ok || time.Now().After(pending.expires) {
		writeError(w, http.StatusBadRequest, errors.New("Google Calendar connect session expired; please try again"))
		return
	}
	if query.Get("error") != "" {
		calendarRedirect(w, r, pending.returnTo, "calendar_denied", "")
		return
	}
	code := query.Get("code")
	if code == "" {
		calendarRedirect(w, r, pending.returnTo, "calendar_failed", "")
		return
	}

	oauthCfg, err := s.calendarOAuthConfig()
	if err != nil {
		calendarRedirect(w, r, pending.returnTo, "calendar_failed", "")
		return
	}
	token, err := oauthCfg.Exchange(r.Context(), code, oauth2.SetAuthURLParam("code_verifier", pending.verifier))
	if err != nil {
		slog.Warn("google calendar token exchange failed", "user_id_hash", userIDHash(pending.userID))
		calendarRedirect(w, r, pending.returnTo, "calendar_failed", "")
		return
	}
	if token.RefreshToken == "" {
		calendarRedirect(w, r, pending.returnTo, "calendar_refresh_required", "")
		return
	}

	email, err := calendarAccountEmail(r.Context(), token.AccessToken)
	if err != nil || email == "" {
		slog.Warn("google calendar profile lookup failed", "user_id_hash", userIDHash(pending.userID))
		calendarRedirect(w, r, pending.returnTo, "calendar_failed", "")
		return
	}
	sealed, err := sealSettingsValue(s.cfg.SettingsEncryptionKey, token.RefreshToken)
	if err != nil {
		calendarRedirect(w, r, pending.returnTo, "calendar_failed", "")
		return
	}
	if err := s.store.SaveCalendarAccount(r.Context(), pending.userID, "google", email, sealed, strings.Join(oauthCfg.Scopes, " ")); err != nil {
		calendarRedirect(w, r, pending.returnTo, "calendar_failed", "")
		return
	}
	calendarRedirect(w, r, pending.returnTo, "", email)
}

func (s *Server) calendarAccounts(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	accounts, err := s.store.ListCalendarAccounts(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load Google Calendar accounts"))
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

func (s *Server) calendarToken(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.settingsLimiter, "calendar token") {
		return
	}
	var account store.CalendarAccount
	if rawID := strings.TrimSpace(r.URL.Query().Get("account_id")); rawID != "" {
		accountID, parseErr := uuid.Parse(rawID)
		if parseErr != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid calendar account id"))
			return
		}
		account, err = s.store.GetCalendarAccount(r.Context(), user.ID, accountID)
	} else {
		account, err = s.store.NewestCalendarAccount(r.Context(), user.ID, "google")
	}
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, errors.New("no Google Calendar account connected"))
			return
		}
		writeError(w, http.StatusInternalServerError, errors.New("unable to load Google Calendar accounts"))
		return
	}
	refreshToken, err := openSettingsValue(s.cfg.SettingsEncryptionKey, account.RefreshToken)
	if err != nil || refreshToken == "" {
		writeError(w, http.StatusInternalServerError, errors.New("unable to open the Google Calendar connection"))
		return
	}
	oauthCfg, err := s.calendarOAuthConfig()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	token, err := oauthCfg.TokenSource(r.Context(), &oauth2.Token{RefreshToken: refreshToken}).Token()
	if err != nil || token.AccessToken == "" {
		slog.Warn("google calendar refresh failed", "user_id_hash", userIDHash(user.ID))
		writeError(w, http.StatusBadGateway, errors.New("Google Calendar needs to be reconnected"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accessToken": token.AccessToken, "expiresIn": 3600, "email": account.Email})
}

func (s *Server) calendarDisconnect(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	accountID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid calendar account id"))
		return
	}
	account, err := s.store.GetCalendarAccount(r.Context(), user.ID, accountID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, errors.New("Google Calendar account not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, errors.New("unable to load Google Calendar accounts"))
		return
	}
	if refreshToken, openErr := openSettingsValue(s.cfg.SettingsEncryptionKey, account.RefreshToken); openErr == nil && refreshToken != "" {
		body := strings.NewReader("token=" + url.QueryEscape(refreshToken))
		if revokeReq, reqErr := http.NewRequestWithContext(r.Context(), http.MethodPost, calendarRevokeURL, body); reqErr == nil {
			revokeReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			if revokeRes, doErr := http.DefaultClient.Do(revokeReq); doErr == nil {
				revokeRes.Body.Close()
			}
		}
	}
	if err := s.store.DeleteCalendarAccount(r.Context(), user.ID, accountID); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to disconnect Google Calendar"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func validCalendarReturnTo(allowed []string, returnTo string) bool {
	parsed, err := url.Parse(returnTo)
	if err != nil || parsed.Fragment == "" || !strings.HasPrefix(parsed.Fragment, "/calendar-connected") || parsed.User != nil || parsed.RawQuery != "" {
		return false
	}
	if parsed.Scheme == "prior" && parsed.Host == "auth" && parsed.Path == "/callback" {
		return true
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" || parsed.Path != "" && parsed.Path != "/" || parsed.Host == "" {
		return false
	}
	if parsed.Scheme == "http" {
		host := parsed.Hostname()
		if host != "localhost" && host != "127.0.0.1" && host != "::1" {
			return false
		}
	}
	returnOrigin := strings.ToLower(parsed.Scheme + "://" + parsed.Host)
	for _, origin := range allowed {
		allowedParsed, parseErr := url.Parse(strings.TrimSpace(origin))
		if parseErr != nil || allowedParsed.Host == "" || (allowedParsed.Scheme != "https" && allowedParsed.Scheme != "http") {
			continue
		}
		if returnOrigin == strings.ToLower(allowedParsed.Scheme+"://"+allowedParsed.Host) {
			return true
		}
	}
	return false
}

func calendarRedirect(w http.ResponseWriter, r *http.Request, returnTo, errorCode, email string) {
	separator := "?"
	if strings.Contains(returnTo, "?") {
		separator = "&"
	}
	params := url.Values{}
	if errorCode != "" {
		params.Set("error", errorCode)
	}
	if email != "" {
		params.Set("email", email)
	}
	if len(params) > 0 {
		returnTo += separator + params.Encode()
	}
	http.Redirect(w, r, returnTo, http.StatusFound)
}

func (s *Server) calendarOAuthConfig() (*oauth2.Config, error) {
	if s.cfg.GoogleClientID == "" || s.cfg.GoogleClientSecret == "" {
		return nil, errors.New("Google OAuth is not configured")
	}
	redirect := s.cfg.GoogleRedirectURL
	if strings.HasSuffix(redirect, "/auth/google/callback") {
		redirect = strings.TrimSuffix(redirect, "/auth/google/callback") + "/v1/calendar/google/callback"
	}
	return &oauth2.Config{
		ClientID:     s.cfg.GoogleClientID,
		ClientSecret: s.cfg.GoogleClientSecret,
		RedirectURL:  redirect,
		Endpoint:     oauth2.Endpoint{AuthURL: calendarGoogleAuthURL, TokenURL: calendarGoogleTokenURL},
		Scopes:       []string{"openid", "email", "profile", calendarScopeReadonly},
	}, nil
}

func calendarAccountEmail(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, calendarProfileURL, nil)
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
		return "", fmt.Errorf("Google profile status %d", res.StatusCode)
	}
	var profile struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(res.Body).Decode(&profile); err != nil {
		return "", err
	}
	return strings.TrimSpace(profile.Email), nil
}

func calendarRandomString(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func calendarCodeChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func pruneCalendarStates() {
	now := time.Now()
	for key, value := range calendarStates {
		if now.After(value.expires) {
			delete(calendarStates, key)
		}
	}
}
