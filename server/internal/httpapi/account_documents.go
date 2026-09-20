package httpapi

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/gh-Constant/prior/server/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Server) syncAccountDocuments(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	if !s.allowEndpoint(w, r, s.workspaceLimiter, "account-data") {
		return
	}
	var body struct {
		Mutations []store.DocumentMutation `json:"mutations"`
	}
	if decodeJSON(r, &body) != nil || store.ValidateDocumentMutations(body.Mutations) != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid account mutations"))
		return
	}
	result, err := s.store.SyncAccountDocuments(r.Context(), user.ID, body.Mutations)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to synchronize account data"))
		return
	}
	if result.Changed {
		s.notifySync(r.Context(), user.ID, "account_required", 0)
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) saveNoteAttachment(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid attachment id"))
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if len(name) == 0 || len(name) > 500 {
		writeError(w, http.StatusBadRequest, errors.New("invalid attachment name"))
		return
	}
	content, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8<<20))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, errors.New("attachment exceeds 8 MB"))
		return
	}
	contentType := http.DetectContentType(content)
	if err = s.store.SaveNoteAttachment(r.Context(), user.ID, id, name, contentType, content); err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to save attachment"))
		return
	}
	s.notifySync(r.Context(), user.ID, "attachments_required", 0)
	writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
}

func (s *Server) getNoteAttachment(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid attachment id"))
		return
	}
	name, contentType, content, err := s.store.LoadNoteAttachment(r.Context(), user.ID, id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, errors.New("attachment not found"))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to load attachment"))
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(content)
}

func (s *Server) listNoteAttachments(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r)
	if err != nil {
		writeUnauthorized(w, err)
		return
	}
	result, err := s.store.ListNoteAttachments(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("unable to list attachments"))
		return
	}
	writeJSON(w, http.StatusOK, result)
}
