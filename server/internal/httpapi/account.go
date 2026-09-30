package httpapi

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/auth"
	"github.com/gh-Constant/prior/server/internal/mailer"
	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
)

// Account lifecycle and compliance endpoints (specs/ACCOUNT.md): email
// verification, password reset, account deletion and data export.

const (
	passwordResetTTL = 30 * time.Minute
	emailVerifyTTL   = 24 * time.Hour
	// Emails per account and purpose: one a minute, five an hour.
	emailCooldown   = time.Minute
	emailHourlyCap  = 5
	recentSignInAge = 10 * time.Minute
)

// meResponse is the account as the client sees it: the user plus the flags
// that drive the settings (never a secret).
type meResponse struct {
	store.User
	store.AccountStatus
}

func (s *Server) meView(ctx context.Context, user store.User) meResponse {
	status, err := s.store.AccountStatus(ctx, user.ID)
	if err != nil {
		slog.Warn("account status unavailable", "user_id_hash", userIDHash(user.ID), "error", err)
		status = store.AccountStatus{Locale: "en"}
	}
	// Verified means the address was confirmed (Google or our own link).
	user.EmailVerified = status.EmailVerifiedAt != nil
	return meResponse{User: user, AccountStatus: status}
}

// finishSignIn mints a session, or a 2FA challenge when the account has
// two-factor authentication turned on.
func (s *Server) finishSignIn(w http.ResponseWriter, r *http.Request, user store.User, device, platform string) {
	state, err := s.store.TOTPState(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to sign in"))
		return
	}
	if state.Enabled {
		challenge, err := randomToken(32)
		if err != nil {
			writeError(w, http.StatusInternalServerError, errors.New("unable to sign in"))
			return
		}
		expires, err := s.store.CreateAuthChallenge(r.Context(), user.ID, challenge, device, platform, 5*time.Minute)
		if err != nil {
			writeError(w, http.StatusInternalServerError, errors.New("unable to sign in"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"twoFactorRequired": true, "challenge": challenge, "expiresAt": expires})
		return
	}
	token, err := s.auth.CreateSession(r.Context(), user, device, platform)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to sign in"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": s.meView(r.Context(), user)})
}

func randomToken(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func writeCode(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "error": message})
}

// emailAllowed throttles account emails per account and purpose.
func (s *Server) emailAllowed(ctx context.Context, userID uuid.UUID, purpose string) bool {
	count, latest, err := s.store.AuthTokenActivity(ctx, userID, purpose, s.now().Add(-time.Hour))
	if err != nil {
		return false
	}
	if count >= emailHourlyCap {
		return false
	}
	return latest == nil || s.now().Sub(*latest) >= emailCooldown
}

func (s *Server) sendAccountEmail(ctx context.Context, user store.User, purpose string, kind mailer.Kind, route string, ttl time.Duration, language string) error {
	token, err := randomToken(32)
	if err != nil {
		return err
	}
	if err := s.store.CreateAuthToken(ctx, user.ID, purpose, user.Email, token, ttl); err != nil {
		return err
	}
	link := strings.TrimRight(s.webAppURL(), "/") + route + "?token=" + url.QueryEscape(token)
	message, err := mailer.Render(kind, language, user.Email, link)
	if err != nil {
		return err
	}
	return s.mail.Send(ctx, message)
}

func (s *Server) webAppURL() string {
	if s.cfg.WebAppURL != "" {
		return s.cfg.WebAppURL
	}
	return "https://app.prior.constantsuchet.fr"
}

func (s *Server) sendVerificationEmail(ctx context.Context, user store.User, language string) error {
	if !s.emailAllowed(ctx, user.ID, store.TokenEmailVerify) {
		return errors.New("verification email throttled")
	}
	return s.sendAccountEmail(ctx, user, store.TokenEmailVerify, mailer.KindVerifyEmail, "/verify-email", emailVerifyTTL, language)
}

// forgotPassword always answers 202 so the response never tells whether an
// account exists. The lookup and the email happen after the response.
func (s *Server) forgotPassword(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		Email    string `json:"email"`
		Language string `json:"language"`
	}
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid request"))
		return
	}
	email := strings.TrimSpace(body.Email)
	w.WriteHeader(http.StatusAccepted)
	if email == "" || len(email) > 320 || !strings.Contains(email, "@") {
		return
	}
	language := body.Language
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		user, locale, err := s.store.UserByEmail(ctx, email)
		if err != nil {
			return
		}
		if language == "" {
			language = locale
		}
		if !s.emailAllowed(ctx, user.ID, store.TokenPasswordReset) {
			return
		}
		if err := s.sendAccountEmail(ctx, user, store.TokenPasswordReset, mailer.KindPasswordReset, "/reset-password", passwordResetTTL, mailer.NormalizeLanguage(language)); err != nil {
			slog.Warn("password reset email failed", "user_id_hash", userIDHash(user.ID), "error", err)
		}
	}()
}

func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.Token == "" {
		writeError(w, http.StatusBadRequest, errors.New("token and password are required"))
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeCode(w, http.StatusBadRequest, "INVALID_PASSWORD", err.Error())
		return
	}
	userID, err := s.store.ResetPassword(r.Context(), body.Token, hash)
	if errors.Is(err, store.ErrTokenInvalid) {
		writeCode(w, http.StatusBadRequest, "TOKEN_INVALID", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to reset the password"))
		return
	}
	s.hub.closeUser(userID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) verifyEmail(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, errors.New("too many authentication attempts"))
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := decodeJSONStrict(r, &body); err != nil || body.Token == "" {
		writeError(w, http.StatusBadRequest, errors.New("token is required"))
		return
	}
	userID, err := s.store.VerifyEmail(r.Context(), body.Token)
	if errors.Is(err, store.ErrTokenInvalid) {
		writeCode(w, http.StatusBadRequest, "TOKEN_INVALID", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to verify the email"))
		return
	}
	s.notifySync(r.Context(), userID, "profile_required", 0)
	writeJSON(w, http.StatusOK, map[string]bool{"verified": true})
}

func (s *Server) resendVerification(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.accountLimiter, "account") {
		return
	}
	var body struct {
		Language string `json:"language"`
	}
	if err := decodeJSON(r, &body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, errors.New("invalid request"))
		return
	}
	status, err := s.store.AccountStatus(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to send the email"))
		return
	}
	if status.EmailVerifiedAt != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"alreadyVerified": true})
		return
	}
	language := status.Locale
	if body.Language != "" {
		language = mailer.NormalizeLanguage(body.Language)
		_ = s.store.SetUserLocale(r.Context(), user.ID, language)
	}
	if !s.emailAllowed(r.Context(), user.ID, store.TokenEmailVerify) {
		w.Header().Set("Retry-After", "60")
		writeCode(w, http.StatusTooManyRequests, "RATE_LIMITED", "please wait before asking for another email")
		return
	}
	if err := s.sendAccountEmail(r.Context(), user, store.TokenEmailVerify, mailer.KindVerifyEmail, "/verify-email", emailVerifyTTL, language); err != nil {
		slog.Warn("verification email failed", "user_id_hash", userIDHash(user.ID), "error", err)
		writeError(w, http.StatusBadGateway, errors.New("the email could not be sent, try again later"))
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// reauthenticate checks that the person at the keyboard owns the account:
// the current password for password accounts, otherwise a sign-in from
// less than ten minutes ago; plus a 2FA code when 2FA is on.
func (s *Server) reauthenticate(w http.ResponseWriter, r *http.Request, user store.User, password, code, recoveryCode string) bool {
	status, err := s.store.AccountStatus(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to check the account"))
		return false
	}
	if status.HasPassword {
		if err := s.auth.VerifyPassword(r.Context(), user.ID, password); err != nil {
			// 403, not 401: the session is fine, the password is not.
			writeCode(w, http.StatusForbidden, "INVALID_PASSWORD", "the password is incorrect")
			return false
		}
	} else {
		created, err := s.store.SessionCreatedAt(r.Context(), bearer(r))
		if err != nil || s.now().Sub(created) > recentSignInAge {
			writeCode(w, http.StatusForbidden, "REAUTH_REQUIRED", "sign in again to confirm it is you")
			return false
		}
	}
	if status.TwoFactorEnabled {
		if code == "" && recoveryCode == "" {
			writeCode(w, http.StatusForbidden, "TWO_FACTOR_REQUIRED", "enter a code from your authenticator app")
			return false
		}
		if !s.checkSecondFactor(w, r, user.ID, code, recoveryCode) {
			return false
		}
	}
	return true
}

func (s *Server) deleteMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.accountLimiter, "account") {
		return
	}
	var body struct {
		Email        string `json:"email"`
		Password     string `json:"password"`
		Code         string `json:"code"`
		RecoveryCode string `json:"recoveryCode"`
	}
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid request"))
		return
	}
	if !strings.EqualFold(strings.TrimSpace(body.Email), user.Email) {
		writeCode(w, http.StatusBadRequest, "EMAIL_MISMATCH", "type the email address of this account to confirm")
		return
	}
	if !s.reauthenticate(w, r, user, body.Password, body.Code, body.RecoveryCode) {
		return
	}
	if err := s.cancelSubscriptionForDeletion(r.Context(), user.ID); err != nil {
		slog.Warn("stripe cancel before deletion failed", "user_id_hash", userIDHash(user.ID), "error", err)
		writeCode(w, http.StatusBadGateway, "BILLING_CANCEL_FAILED", "your subscription could not be canceled, so the account was kept; try again in a moment")
		return
	}
	deleted, err := s.store.DeleteAccount(r.Context(), user.ID)
	if err != nil {
		slog.Error("account deletion failed", "user_id_hash", userIDHash(user.ID), "error", err)
		writeError(w, http.StatusInternalServerError, errors.New("unable to delete the account"))
		return
	}
	slog.Info("account deleted", "user_id_hash", userIDHash(user.ID), "transferred_projects", len(deleted.TransferredProjects), "deleted_projects", len(deleted.DeletedProjects))
	s.hub.closeUser(user.ID)
	for owner := range deleted.TransferredProjects {
		s.notifySync(r.Context(), owner, "workspace_required", 0)
	}
	for _, peer := range deleted.AffectedUsers {
		s.notifySync(r.Context(), peer, "collaboration_required", 0)
		s.notifySync(r.Context(), peer, "tasks_required", 0)
	}
	go s.revokeGoogleGrants(deleted.SealedGoogleTokens)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) cancelSubscriptionForDeletion(ctx context.Context, userID uuid.UUID) error {
	sub, err := s.store.GetSubscription(ctx, userID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		return err
	}
	if sub.StripeSubscriptionID == "" || sub.Status == "canceled" || sub.Status == "incomplete_expired" {
		return nil
	}
	if !s.stripe.Enabled() {
		return errors.New("stripe is not configured")
	}
	return s.stripe.CancelSubscriptionNow(ctx, sub.StripeSubscriptionID)
}

// googleRevokeURL is overridable in tests.
var googleRevokeURL = "https://oauth2.googleapis.com/revoke"

// revokeGoogleGrants revokes Gmail and Calendar refresh tokens, best effort.
func (s *Server) revokeGoogleGrants(sealed []string) {
	for _, value := range sealed {
		token, err := openSettingsValue(s.cfg.SettingsEncryptionKey, value)
		if err != nil || token == "" {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, googleRevokeURL, strings.NewReader("token="+url.QueryEscape(token)))
		if err == nil {
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			if response, doErr := http.DefaultClient.Do(request); doErr == nil {
				response.Body.Close()
			}
		}
		cancel()
	}
}

// exportMe streams a zip of the account's data (GDPR access/portability).
func (s *Server) exportMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.accountLimiter, "account") {
		return
	}
	data, err := s.store.ExportAccount(r.Context(), user.ID)
	if err != nil {
		slog.Error("export failed", "user_id_hash", userIDHash(user.ID), "error", err)
		writeError(w, http.StatusInternalServerError, errors.New("unable to export the account"))
		return
	}
	filename := "prior-export-" + s.now().UTC().Format("2006-01-02") + ".zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	archive := zip.NewWriter(w)
	if err := writeExportArchive(archive, data, s.now()); err != nil {
		slog.Error("export archive failed", "user_id_hash", userIDHash(user.ID), "error", err)
	}
	_ = archive.Close()
}

func writeExportArchive(archive *zip.Writer, data store.AccountExport, now time.Time) error {
	notes := map[string]any{"folders": data.Workspace.Folders, "notes": data.Workspace.Notes}
	attachments := make([]map[string]any, 0, len(data.Attachments))
	for _, item := range data.Attachments {
		attachments = append(attachments, map[string]any{"id": item.ID, "name": item.Name, "type": item.Type, "size": item.Size, "file": attachmentPath(item)})
	}
	files := []struct {
		name  string
		value any
	}{
		{"profile.json", data.Profile},
		{"tasks.json", data.Tasks},
		{"habits.json", data.Habits},
		{"areas.json", data.Workspace.Areas},
		{"projects.json", map[string]any{"personal": data.Workspace.Projects, "shared": data.SharedProjects}},
		{"notes.json", map[string]any{"folders": notes["folders"], "notes": notes["notes"], "attachments": attachments}},
		{"settings.json", map[string]any{"assistant": data.Settings, "preferences": data.AccountDocuments}},
		{"assistant-chats.json", data.Chats},
		{"game.json", data.Game},
	}
	readme := "Prior data export\n\nCreated " + now.UTC().Format(time.RFC3339) + " for " + data.Profile.Email + ".\n\n" +
		"Every file is JSON (UTF-8) except tasks.csv. Attachments of notes are in attachments/.\n" +
		"Passwords, sessions, access keys, API keys and connected-account tokens are never exported.\n" +
		"Shared projects list other members by display name and role only.\n"
	if err := writeZipFile(archive, "README.txt", []byte(readme)); err != nil {
		return err
	}
	for _, file := range files {
		encoded, err := json.MarshalIndent(file.value, "", "  ")
		if err != nil {
			return err
		}
		if err := writeZipFile(archive, file.name, encoded); err != nil {
			return err
		}
	}
	csvFile, err := archive.Create("tasks.csv")
	if err != nil {
		return err
	}
	if err := writeTasksCSV(csvFile, data.Tasks); err != nil {
		return err
	}
	for _, item := range data.Attachments {
		if err := writeZipFile(archive, attachmentPath(item), item.Content); err != nil {
			return err
		}
	}
	return nil
}

func attachmentPath(item store.ExportAttachment) string {
	name := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < 32 {
			return '_'
		}
		return r
	}, path.Base(item.Name))
	if name == "" || name == "." || name == ".." {
		name = "file"
	}
	return "attachments/" + item.ID + "-" + name
}

func writeZipFile(archive *zip.Writer, name string, content []byte) error {
	file, err := archive.Create(name)
	if err != nil {
		return err
	}
	_, err = file.Write(content)
	return err
}

// csvCell neutralizes spreadsheet formulas (CSV injection).
func csvCell(value string) string {
	if value != "" && strings.ContainsRune("=+-@\t\r", rune(value[0])) {
		return "'" + value
	}
	return value
}

func optional(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// checklistText renders a checklist as "[x] done; [ ] open".
func checklistText(items []tasks.ChecklistItem) string {
	parts := make([]string, 0, len(items))
	for _, item := range items {
		mark := "[ ] "
		if item.Done {
			mark = "[x] "
		}
		parts = append(parts, mark+item.Title)
	}
	return strings.Join(parts, "; ")
}

func writeTasksCSV(out io.Writer, list []tasks.Task) error {
	writer := csv.NewWriter(out)
	header := []string{"id", "title", "description", "status", "completed", "important", "urgent", "priority", "dueDate", "dueTime", "scheduledDate", "scheduledTime", "reminderAt", "checklist", "projectId", "areaId", "estimatedMinutes", "createdAt", "updatedAt"}
	if err := writer.Write(header); err != nil {
		return err
	}
	for _, task := range list {
		estimate := ""
		if task.EstimatedMinutes != nil {
			estimate = strconv.Itoa(*task.EstimatedMinutes)
		}
		row := []string{
			task.ID, csvCell(task.Title), csvCell(task.Description), task.Status, strconv.FormatBool(task.Completed),
			strconv.FormatBool(task.Important), strconv.FormatBool(task.Urgent), strconv.Itoa(task.Priority),
			optional(task.DueDate), optional(task.DueTime), optional(task.ScheduledDate), optional(task.ScheduledTime),
			optional(task.ReminderAt), csvCell(checklistText(task.Checklist)),
			optional(task.ProjectID), optional(task.AreaID), estimate,
			task.CreatedAt.UTC().Format(time.RFC3339), task.UpdatedAt.UTC().Format(time.RFC3339),
		}
		if err := writer.Write(row); err != nil {
			return err
		}
	}
	writer.Flush()
	return writer.Error()
}
