package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
)

// The gamified mode (specs/GAMIFICATION.md). XP itself is earned through
// sync; these endpoints read the result and apply the player's choices.

func gameStatus(err error) int {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, store.ErrHandleTaken), errors.Is(err, store.ErrNotEnough):
		return http.StatusConflict
	case errors.Is(err, store.ErrInvalidHandle), errors.Is(err, store.ErrInvalidGameSettings):
		return http.StatusBadRequest
	case errors.Is(err, store.ErrNotOwned), errors.Is(err, store.ErrNotProjectOwner), errors.Is(err, store.ErrKudosNotAllowed):
		return http.StatusForbidden
	default:
		return http.StatusInternalServerError
	}
}

func writeGameError(w http.ResponseWriter, err error) {
	status := gameStatus(err)
	if status == http.StatusInternalServerError {
		slog.Error("game request failed", "error", err)
		writeError(w, status, errors.New("game request failed"))
		return
	}
	if errors.Is(err, store.ErrInvalidHandle) {
		reason := strings.TrimPrefix(err.Error(), store.ErrInvalidHandle.Error()+"\n")
		writeJSON(w, status, map[string]string{"code": "INVALID_HANDLE", "reason": reason, "error": "invalid handle"})
		return
	}
	writeError(w, status, err)
}

func (s *Server) gameState(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	state, err := s.store.GameState(r.Context(), user.ID)
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) gameSettings(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body store.GameSettings
	if err := decodeJSONStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid game settings"))
		return
	}
	profile, err := s.store.UpdateGameSettings(r.Context(), user.ID, body)
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (s *Server) gameHandleAvailable(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	available, reason, err := s.store.HandleAvailable(r.Context(), user.ID, r.URL.Query().Get("handle"))
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": available, "reason": reason})
}

func (s *Server) gameSetHandle(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		Handle string `json:"handle"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("handle is required"))
		return
	}
	handle, err := s.store.SetGameHandle(r.Context(), user.ID, body.Handle)
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"handle": handle})
}

func (s *Server) gameEquip(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		Slot   string `json:"slot"`
		ItemID string `json:"itemId"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Slot == "" {
		writeError(w, http.StatusBadRequest, errors.New("slot is required"))
		return
	}
	equipped, err := s.store.EquipGameItem(r.Context(), user.ID, body.Slot, body.ItemID)
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"equipped": equipped})
}

func (s *Server) gamePin(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		Achievements []string `json:"achievements"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("achievements are required"))
		return
	}
	pinned, err := s.store.PinAchievements(r.Context(), user.ID, body.Achievements)
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pinnedAchievements": pinned})
}

func (s *Server) gamePetName(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("name is required"))
		return
	}
	name, err := s.store.SetPetName(r.Context(), user.ID, body.Name)
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"name": name})
}

func (s *Server) gameOpenChest(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	drops, err := s.store.OpenChest(r.Context(), user.ID, r.PathValue("chestID"))
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"drops": drops})
}

func (s *Server) gameCraft(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		ItemID string `json:"itemId"`
	}
	if err := decodeJSON(r, &body); err != nil || body.ItemID == "" {
		writeError(w, http.StatusBadRequest, errors.New("itemId is required"))
		return
	}
	stardust, err := s.store.CraftItem(r.Context(), user.ID, body.ItemID)
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"stardust": stardust})
}

func (s *Server) gameAckEvents(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		UpTo int64 `json:"upTo"`
	}
	if err := decodeJSON(r, &body); err != nil || body.UpTo <= 0 {
		writeError(w, http.StatusBadRequest, errors.New("upTo is required"))
		return
	}
	if err := s.store.AckGameEvents(r.Context(), user.ID, body.UpTo); err != nil {
		writeGameError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gameLeaderboard(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit == 0 {
		limit = 50
	}
	board, err := s.store.GameLeaderboard(r.Context(), user.ID, r.PathValue("board"), limit)
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, board)
}

func (s *Server) gameLeague(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	league, err := s.store.GameLeague(r.Context(), user.ID, time.Now())
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, league)
}

func (s *Server) gameProjectLeaderboard(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusNotFound, store.ErrNotFound)
		return
	}
	board, err := s.store.ProjectLeaderboard(r.Context(), user.ID, projectID, time.Now())
	if err != nil {
		writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, board)
}

func (s *Server) gameSetProjectLeaderboard(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusNotFound, store.ErrNotFound)
		return
	}
	var body struct {
		Mode       string `json:"mode"`
		TeamGoalXP int    `json:"teamGoalXp"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("mode is required"))
		return
	}
	if err := s.store.SetProjectLeaderboard(r.Context(), user.ID, projectID, body.Mode, body.TeamGoalXP); err != nil {
		writeGameError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gameProjectLeaderboardChoice(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	projectID, err := uuid.Parse(r.PathValue("projectID"))
	if err != nil {
		writeError(w, http.StatusNotFound, store.ErrNotFound)
		return
	}
	var body struct {
		Joined *bool `json:"joined"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Joined == nil {
		writeError(w, http.StatusBadRequest, errors.New("joined is required"))
		return
	}
	if err := s.store.SetProjectLeaderboardChoice(r.Context(), user.ID, projectID, *body.Joined); err != nil {
		writeGameError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) gameKudos(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	var body struct {
		TaskID string `json:"taskId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("taskId is required"))
		return
	}
	taskID, err := uuid.Parse(body.TaskID)
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("taskId is required"))
		return
	}
	if err := s.store.GiveKudos(r.Context(), user.ID, taskID); err != nil {
		writeGameError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// invitePreview is public: the invite landing shows it before sign-in. The
// token is the capability, and a wrong token reveals nothing.
func (s *Server) invitePreview(w http.ResponseWriter, r *http.Request) {
	preview, err := s.store.InvitePreview(r.Context(), r.URL.Query().Get("token"))
	if err != nil {
		writeGameError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, preview)
}
