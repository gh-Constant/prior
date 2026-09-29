package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gh-Constant/prior/server/internal/billing"
	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

// Admin dashboard. Access is decided here, on the server: the signed-in
// account must have a verified email listed in ADMIN_EMAILS.

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return store.User{}, false
	}
	if !s.isAdmin(user) {
		writeError(w, http.StatusForbidden, errors.New("admin access required"))
		return store.User{}, false
	}
	return user, true
}

func (s *Server) adminOverview(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	overview, err := s.store.AdminOverview(r.Context())
	if err != nil {
		slog.Warn("admin overview failed", "error", err)
		writeError(w, http.StatusInternalServerError, errors.New("unable to load the dashboard"))
		return
	}
	stripeMode := ""
	if s.stripe.Enabled() {
		stripeMode = s.stripe.Mode()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"overview":      overview,
		"plans":         billing.Plans(),
		"stripeMode":    stripeMode,
		"hostedAIReady": s.cfg.HostedAI.Enabled(),
	})
}

func (s *Server) adminUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	query := r.URL.Query()
	limit, _ := strconv.Atoi(query.Get("limit"))
	offset, _ := strconv.Atoi(query.Get("offset"))
	plan := ""
	if parsed, ok := billing.ParsePlan(query.Get("plan")); ok {
		plan = string(parsed)
	}
	users, total, err := s.store.AdminUsers(r.Context(), store.AdminUserQuery{
		Search: query.Get("q"),
		Plan:   plan,
		Sort:   query.Get("sort"),
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		slog.Warn("admin users failed", "error", err)
		writeError(w, http.StatusInternalServerError, errors.New("unable to load users"))
		return
	}
	if users == nil {
		users = []store.AdminUser{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users, "total": total})
}

// adminSetPlan grants a plan to an account, or with an empty plan removes
// the grant so Stripe (or Free) applies again. It never touches Stripe.
func (s *Server) adminSetPlan(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	userID, err := uuid.Parse(r.PathValue("userID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid user id"))
		return
	}
	var body struct {
		Plan string `json:"plan"`
		Note string `json:"note"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid plan request"))
		return
	}
	var plan *billing.PlanID
	if strings.TrimSpace(body.Plan) != "" {
		parsed, ok := billing.ParsePlan(body.Plan)
		if !ok {
			writeError(w, http.StatusBadRequest, errors.New("unknown plan"))
			return
		}
		plan = &parsed
	}
	note := strings.TrimSpace(body.Note)
	if len(note) > 200 {
		note = note[:200]
	}
	if err := s.store.SetAdminPlan(r.Context(), userID, plan, note); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, errors.New("user not found"))
			return
		}
		writeError(w, http.StatusInternalServerError, errors.New("unable to update the plan"))
		return
	}
	granted := ""
	if plan != nil {
		granted = string(*plan)
	}
	slog.Info("admin granted plan", "admin_hash", userIDHash(admin.ID), "user_id_hash", userIDHash(userID), "plan", granted)
	writeJSON(w, http.StatusOK, map[string]string{"plan": granted})
}
