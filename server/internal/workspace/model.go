package workspace

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
)

// Snapshot is used as the transport shape for a workspace sync. The server
// stores each collection in its own relational table; keeping this transport
// shape lets legacy local data be imported without introducing client-side
// migration code for every collection.
type Snapshot struct {
	Areas    []Area       `json:"areas"`
	Projects []Project    `json:"projects"`
	Folders  []NoteFolder `json:"folders"`
	Notes    []Note       `json:"notes"`
}

type Area struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Color     string     `json:"color"`
	Icon      *string    `json:"icon"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}

type Project struct {
	ID          string     `json:"id"`
	AreaID      *string    `json:"areaId"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Icon        *string    `json:"icon"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
}

type NoteFolder struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	ParentID      *string    `json:"parentId"`
	Color         *string    `json:"color"`
	WorkspaceKind *string    `json:"workspaceKind"`
	WorkspaceID   *string    `json:"workspaceId"`
	Icon          *string    `json:"icon"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	DeletedAt     *time.Time `json:"deletedAt"`
}

type Note struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	FolderID  *string    `json:"folderId"`
	ProjectID *string    `json:"projectId"`
	Favorite  bool       `json:"favorite"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}

const (
	MaxItemsPerCollection = 5000
	MaxNoteBodyBytes      = 1 << 20
)

func EmptySnapshot() Snapshot {
	return Snapshot{Areas: []Area{}, Projects: []Project{}, Folders: []NoteFolder{}, Notes: []Note{}}
}

func (snapshot Snapshot) Validate() error {
	if len(snapshot.Areas) > MaxItemsPerCollection || len(snapshot.Projects) > MaxItemsPerCollection || len(snapshot.Folders) > MaxItemsPerCollection || len(snapshot.Notes) > MaxItemsPerCollection {
		return errors.New("workspace contains too many items")
	}
	for index, area := range snapshot.Areas {
		if err := validateItem("area", area.ID, area.UpdatedAt); err != nil {
			return fmt.Errorf("areas[%d]: %w", index, err)
		}
		if len(area.Name) == 0 || len(area.Name) > 400 {
			return errors.New("area name must be between 1 and 400 characters")
		}
	}
	for index, project := range snapshot.Projects {
		if err := validateItem("project", project.ID, project.UpdatedAt); err != nil {
			return fmt.Errorf("projects[%d]: %w", index, err)
		}
		if len(project.Name) == 0 || len(project.Name) > 400 {
			return errors.New("project name must be between 1 and 400 characters")
		}
		if len(project.Description) > 10000 {
			return errors.New("project description is too long")
		}
		if project.Status != "planned" && project.Status != "active" && project.Status != "paused" && project.Status != "completed" {
			return errors.New("invalid project status")
		}
	}
	for index, folder := range snapshot.Folders {
		if err := validateItem("folder", folder.ID, folder.UpdatedAt); err != nil {
			return fmt.Errorf("folders[%d]: %w", index, err)
		}
		if len(folder.Name) == 0 || len(folder.Name) > 400 {
			return errors.New("folder name must be between 1 and 400 characters")
		}
		if folder.WorkspaceKind != nil && *folder.WorkspaceKind != "area" && *folder.WorkspaceKind != "project" {
			return errors.New("invalid workspace folder kind")
		}
	}
	for index, note := range snapshot.Notes {
		if err := validateItem("note", note.ID, note.UpdatedAt); err != nil {
			return fmt.Errorf("notes[%d]: %w", index, err)
		}
		if len(note.Title) == 0 || len(note.Title) > 400 {
			return errors.New("note title must be between 1 and 400 characters")
		}
		if len(note.Body) > MaxNoteBodyBytes {
			return errors.New("note body is too large")
		}
	}
	return nil
}

func validateItem(kind, id string, updatedAt time.Time) error {
	if _, err := uuid.Parse(id); err != nil {
		return fmt.Errorf("%s has an invalid id", kind)
	}
	if updatedAt.IsZero() {
		return fmt.Errorf("%s is missing updatedAt", kind)
	}
	return nil
}

func mergeByUpdatedAt[T any](existing, incoming []T, id func(T) string, updatedAt func(T) time.Time) []T {
	merged := make(map[string]T, len(existing)+len(incoming))
	for _, item := range existing {
		merged[id(item)] = item
	}
	for _, item := range incoming {
		key := id(item)
		current, exists := merged[key]
		if !exists || !updatedAt(item).Before(updatedAt(current)) {
			merged[key] = item
		}
	}
	result := make([]T, 0, len(merged))
	for _, item := range merged {
		result = append(result, item)
	}
	sort.Slice(result, func(left, right int) bool { return id(result[left]) < id(result[right]) })
	return result
}

func MergeSnapshots(existing, incoming Snapshot) (Snapshot, error) {
	if err := existing.Validate(); err != nil {
		return Snapshot{}, err
	}
	if err := incoming.Validate(); err != nil {
		return Snapshot{}, err
	}
	return Snapshot{
		Areas:    mergeByUpdatedAt(existing.Areas, incoming.Areas, func(item Area) string { return item.ID }, func(item Area) time.Time { return item.UpdatedAt }),
		Projects: mergeByUpdatedAt(existing.Projects, incoming.Projects, func(item Project) string { return item.ID }, func(item Project) time.Time { return item.UpdatedAt }),
		Folders:  mergeByUpdatedAt(existing.Folders, incoming.Folders, func(item NoteFolder) string { return item.ID }, func(item NoteFolder) time.Time { return item.UpdatedAt }),
		Notes:    mergeByUpdatedAt(existing.Notes, incoming.Notes, func(item Note) string { return item.ID }, func(item Note) time.Time { return item.UpdatedAt }),
	}, nil
}
