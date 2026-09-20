package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
)

type AccountDocument struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}
type DocumentMutation struct {
	ID    string          `json:"id"`
	Key   string          `json:"key"`
	Patch json.RawMessage `json:"patch"`
	Seed  bool            `json:"seed,omitempty"`
}
type DocumentSyncResult struct {
	Records []AccountDocument `json:"records"`
	Applied []string          `json:"applied"`
	Changed bool              `json:"-"`
}

func ValidateDocumentMutations(mutations []DocumentMutation) error {
	if len(mutations) > 100 {
		return errors.New("too many account mutations")
	}
	for _, m := range mutations {
		if _, err := uuid.Parse(m.ID); err != nil {
			return errors.New("invalid mutation id")
		}
		if len(m.Key) > 2048 || strings.ContainsRune(m.Key, 0) || !(strings.HasPrefix(m.Key, "calendar/") || m.Key == "preferences/agent" || m.Key == "preferences/ui") {
			return errors.New("invalid document key")
		}
		if len(m.Patch) > 12<<20 {
			return errors.New("document too large")
		}
		if string(m.Patch) != "null" {
			var value map[string]json.RawMessage
			if json.Unmarshal(m.Patch, &value) != nil || value == nil {
				return errors.New("patch must be an object or null")
			}
		}
	}
	return nil
}

// Patches merge independent fields. Deleted documents cannot be resurrected by
// an old offline device; new entities always receive a fresh id.
func (s *Store) SyncAccountDocuments(ctx context.Context, userID uuid.UUID, mutations []DocumentMutation) (DocumentSyncResult, error) {
	result := DocumentSyncResult{Records: []AccountDocument{}, Applied: []string{}}
	if err := ValidateDocumentMutations(mutations); err != nil {
		return result, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 907383))`, userID.String()); err != nil {
		return result, err
	}
	for _, m := range mutations {
		acknowledged, err := tx.Exec(ctx, `INSERT INTO account_document_mutations(user_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING`, userID, m.ID)
		if err != nil {
			return result, err
		}
		result.Applied = append(result.Applied, m.ID)
		if acknowledged.RowsAffected() == 0 {
			continue
		}
		var value any
		if string(m.Patch) != "null" {
			value = []byte(m.Patch)
		}
		changed, err := tx.Exec(ctx, `INSERT INTO account_documents(user_id,key,value) VALUES($1,$2,$3::jsonb)
   ON CONFLICT(user_id,key) DO UPDATE SET value = CASE WHEN EXCLUDED.value IS NULL THEN NULL ELSE account_documents.value || EXCLUDED.value END
   WHERE NOT $4 AND account_documents.value IS NOT NULL AND account_documents.value IS DISTINCT FROM
    CASE WHEN EXCLUDED.value IS NULL THEN NULL ELSE account_documents.value || EXCLUDED.value END`, userID, m.Key, value, m.Seed)
		if err != nil {
			return result, err
		}
		result.Changed = result.Changed || changed.RowsAffected() > 0
	}
	rows, err := tx.Query(ctx, `SELECT key, COALESCE(value,'null'::jsonb) FROM account_documents WHERE user_id=$1 ORDER BY key`, userID)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var record AccountDocument
		if err = rows.Scan(&record.Key, &record.Value); err != nil {
			rows.Close()
			return result, err
		}
		result.Records = append(result.Records, record)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}

func (s *Store) SaveNoteAttachment(ctx context.Context, userID, id uuid.UUID, name, contentType string, content []byte) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO note_attachments(user_id,id,name,content_type,content) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,id) DO NOTHING`, userID, id, name, contentType, content)
	return err
}
func (s *Store) LoadNoteAttachment(ctx context.Context, userID, id uuid.UUID) (string, string, []byte, error) {
	var name, contentType string
	var content []byte
	err := s.pool.QueryRow(ctx, `SELECT name,content_type,content FROM note_attachments WHERE user_id=$1 AND id=$2`, userID, id).Scan(&name, &contentType, &content)
	return name, contentType, content, err
}

type NoteAttachmentMeta struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Size int    `json:"size"`
}

func (s *Store) ListNoteAttachments(ctx context.Context, userID uuid.UUID) ([]NoteAttachmentMeta, error) {
	result := []NoteAttachmentMeta{}
	rows, err := s.pool.Query(ctx, `SELECT id::text,name,content_type,octet_length(content) FROM note_attachments WHERE user_id=$1 ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item NoteAttachmentMeta
		if err = rows.Scan(&item.ID, &item.Name, &item.Type, &item.Size); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
