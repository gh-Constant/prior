package httpapi

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"github.com/gh-Constant/prior/server/internal/store"
)

// Per-user assistant settings. API keys sync across the user's devices so
// they only have to be entered once. They are readable solely by the owning
// authenticated user and are never logged.

const settingsSealPrefix = "gcm1:"

type settingsPayload struct {
	Initialized                    bool   `json:"initialized"`
	OpenRouterAPIKey               string `json:"openrouterApiKey"`
	RecommendationOpenRouterAPIKey string `json:"recommendationOpenrouterApiKey"`
	OpenAIAPIKey                   string `json:"openaiApiKey"`
	WebSearch                      bool   `json:"webSearch"`
}

func settingsSealingKey(configured string) ([32]byte, error) {
	var key [32]byte
	if configured == "" {
		return key, errors.New("settings encryption is not configured")
	}
	raw, err := hex.DecodeString(strings.TrimSpace(configured))
	if err != nil || len(raw) != 32 {
		return key, errors.New("settings encryption key must be 32 bytes, hex-encoded")
	}
	copy(key[:], raw)
	return key, nil
}

// sealSettingsValue encrypts plaintext with AES-256-GCM and returns an
// ASCII-armored value. An empty key stores the value as-is.
func sealSettingsValue(configured, plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	key, err := settingsSealingKey(configured)
	if err != nil {
		return plaintext, nil
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", errors.New("unable to seal settings value")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", errors.New("unable to seal settings value")
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", errors.New("unable to seal settings value")
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return settingsSealPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// openSettingsValue reverses sealSettingsValue. Unsealed values pass through.
func openSettingsValue(configured, stored string) (string, error) {
	if stored == "" || !strings.HasPrefix(stored, settingsSealPrefix) {
		return stored, nil
	}
	key, err := settingsSealingKey(configured)
	if err != nil {
		return "", errors.New("unable to open settings value")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, settingsSealPrefix))
	if err != nil {
		return "", errors.New("unable to open settings value")
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", errors.New("unable to open settings value")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", errors.New("unable to open settings value")
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("unable to open settings value")
	}
	plaintext, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("unable to open settings value")
	}
	return string(plaintext), nil
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	stored, err := s.store.GetUserSettings(r.Context(), user.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, settingsPayload{WebSearch: true})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load settings"))
		return
	}
	openRouterAPIKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored.OpenRouterAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load settings"))
		return
	}
	openAIAPIKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored.OpenAIAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load settings"))
		return
	}
	recommendationAPIKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored.RecommendationOpenRouterAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load settings"))
		return
	}
	writeJSON(w, http.StatusOK, settingsPayload{Initialized: true, OpenRouterAPIKey: openRouterAPIKey, RecommendationOpenRouterAPIKey: recommendationAPIKey, OpenAIAPIKey: openAIAPIKey, WebSearch: stored.WebSearch})
}

func (s *Server) saveSettings(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	// RecommendationOpenRouterAPIKey is optional for older clients. An omitted
	// field must leave the newer key untouched; an explicit empty string clears it.
	var body struct {
		OpenRouterAPIKey               string  `json:"openrouterApiKey"`
		RecommendationOpenRouterAPIKey *string `json:"recommendationOpenrouterApiKey"`
		OpenAIAPIKey                   string  `json:"openaiApiKey"`
		WebSearch                      bool    `json:"webSearch"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid settings request"))
		return
	}
	body.OpenRouterAPIKey = strings.TrimSpace(body.OpenRouterAPIKey)
	body.OpenAIAPIKey = strings.TrimSpace(body.OpenAIAPIKey)
	if len(body.OpenRouterAPIKey) > maxSettingsKeyChars || len(body.OpenAIAPIKey) > maxSettingsKeyChars || (body.RecommendationOpenRouterAPIKey != nil && len(strings.TrimSpace(*body.RecommendationOpenRouterAPIKey)) > maxSettingsKeyChars) {
		writeError(w, http.StatusBadRequest, errors.New("invalid settings request"))
		return
	}
	sealedOpenRouterAPIKey, err := sealSettingsValue(s.cfg.SettingsEncryptionKey, body.OpenRouterAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save settings"))
		return
	}
	sealedOpenAIAPIKey, err := sealSettingsValue(s.cfg.SettingsEncryptionKey, body.OpenAIAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save settings"))
		return
	}
	var sealedRecommendationAPIKey *string
	if body.RecommendationOpenRouterAPIKey != nil {
		sealed, sealErr := sealSettingsValue(s.cfg.SettingsEncryptionKey, strings.TrimSpace(*body.RecommendationOpenRouterAPIKey))
		if sealErr != nil {
			writeError(w, http.StatusInternalServerError, errors.New("unable to save settings"))
			return
		}
		sealedRecommendationAPIKey = &sealed
	}
	stored, err := s.store.SaveUserSettings(r.Context(), user.ID, sealedOpenRouterAPIKey, sealedRecommendationAPIKey, sealedOpenAIAPIKey, body.WebSearch)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save settings"))
		return
	}
	openRouterAPIKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored.OpenRouterAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save settings"))
		return
	}
	openAIAPIKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored.OpenAIAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save settings"))
		return
	}
	s.notifySync(r.Context(), user.ID, "settings", 0)
	recommendationAPIKey, err := openSettingsValue(s.cfg.SettingsEncryptionKey, stored.RecommendationOpenRouterAPIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save settings"))
		return
	}
	writeJSON(w, http.StatusOK, settingsPayload{Initialized: true, OpenRouterAPIKey: openRouterAPIKey, RecommendationOpenRouterAPIKey: recommendationAPIKey, OpenAIAPIKey: openAIAPIKey, WebSearch: stored.WebSearch})
}
