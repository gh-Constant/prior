package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
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
	ID          string         `json:"id"`
	AreaID      *string        `json:"areaId"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Icon        *string        `json:"icon"`
	Status      string         `json:"status"`
	Health      *string        `json:"health"`
	StartDate   *string        `json:"startDate"`
	TargetDate  *string        `json:"targetDate"`
	Cycles      []ProjectCycle `json:"cycles,omitempty"`
	// Milestones are the project's checkpoints; tasks point at one by id.
	Milestones []ProjectMilestone `json:"milestones,omitempty"`
	// ProjectType is "standard" or "software" (the agile workspace). Nil
	// means "standard" for projects saved before the type was synced.
	ProjectType *string `json:"projectType"`
	// Methodology is "kanban", "scrum" or "scrumban"; only meaningful for
	// "software" projects. Nil means "kanban" (specs/SCRUM.md).
	Methodology *string    `json:"methodology,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	DeletedAt   *time.Time `json:"deletedAt"`

	planningFieldsPresent   bool
	projectTypeFieldPresent bool
	methodologyFieldPresent bool
	milestonesFieldPresent  bool
}

type ProjectMilestone struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description,omitempty"`
	TargetDate  *string `json:"targetDate,omitempty"`
}

const MaxProjectMilestones = 100

type ProjectCycle struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	StartsOn string   `json:"startsOn"`
	EndsOn   string   `json:"endsOn"`
	IssueIDs []string `json:"issueIds,omitempty"`
}

const (
	ProjectHealthOnTrack  = "On track"
	ProjectHealthAtRisk   = "At risk"
	ProjectHealthOffTrack = "Off track"
	MaxProjectCycles      = 100
	MaxProjectCycleIssues = MaxItemsPerCollection
)

// UnmarshalJSON records whether planning fields were present in the payload.
// That lets workspace sync preserve planning metadata from older clients that
// only know the original project fields.
func (project *Project) UnmarshalJSON(data []byte) error {
	type projectAlias Project
	var decoded projectAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*project = Project(decoded)
	_, healthPresent := fields["health"]
	_, startDatePresent := fields["startDate"]
	_, targetDatePresent := fields["targetDate"]
	_, cyclesPresent := fields["cycles"]
	project.planningFieldsPresent = healthPresent || startDatePresent || targetDatePresent || cyclesPresent
	_, project.milestonesFieldPresent = fields["milestones"]
	_, project.projectTypeFieldPresent = fields["projectType"]
	_, project.methodologyFieldPresent = fields["methodology"]
	return nil
}

func (project Project) PlanningFieldsPresent() bool { return project.planningFieldsPresent }

// ProjectTypePresent reports whether the payload carried projectType, so
// older clients that never send it cannot reset the type to standard.
func (project Project) ProjectTypePresent() bool { return project.projectTypeFieldPresent }

// MethodologyPresent reports whether the payload carried methodology, so
// older clients that never send it cannot reset it to kanban.
func (project Project) MethodologyPresent() bool { return project.methodologyFieldPresent }

// MilestonesPresent reports whether the payload carried milestones (clients
// before 0.8 never send them and must not erase them).
func (project Project) MilestonesPresent() bool { return project.milestonesFieldPresent }

const (
	ProjectTypeStandard = "standard"
	ProjectTypeSoftware = "software"
)

// ValidProjectType accepts nil (standard) or one of the two known types.
func ValidProjectType(value *string) bool {
	return value == nil || *value == ProjectTypeStandard || *value == ProjectTypeSoftware
}

const (
	MethodologyKanban   = "kanban"
	MethodologyScrum    = "scrum"
	MethodologyScrumban = "scrumban"
)

// ValidMethodology accepts nil (kanban) or one of the three known methods.
func ValidMethodology(value *string) bool {
	return value == nil || *value == MethodologyKanban || *value == MethodologyScrum || *value == MethodologyScrumban
}

func (project Project) ValidatePlanning() error {
	if !ValidProjectType(project.ProjectType) {
		return errors.New("invalid project type")
	}
	if !ValidMethodology(project.Methodology) {
		return errors.New("invalid project methodology")
	}
	if project.Health != nil && *project.Health != ProjectHealthOnTrack && *project.Health != ProjectHealthAtRisk && *project.Health != ProjectHealthOffTrack {
		return errors.New("invalid project health")
	}
	if err := validateProjectDate(project.StartDate, "start date"); err != nil {
		return err
	}
	if err := validateProjectDate(project.TargetDate, "target date"); err != nil {
		return err
	}
	if project.StartDate != nil && project.TargetDate != nil && *project.TargetDate < *project.StartDate {
		return errors.New("invalid project target date: must be on or after the start date")
	}
	if err := validateMilestones(project.Milestones); err != nil {
		return err
	}
	if len(project.Cycles) > MaxProjectCycles {
		return errors.New("invalid project cycles: too many cycles")
	}
	seenCycleIDs := make(map[string]struct{}, len(project.Cycles))
	for index, cycle := range project.Cycles {
		cycleID := strings.TrimSpace(cycle.ID)
		if cycleID == "" || len(cycleID) > 128 {
			return fmt.Errorf("invalid project cycle %d id", index)
		}
		if _, exists := seenCycleIDs[cycleID]; exists {
			return fmt.Errorf("invalid project cycle %q: duplicate id", cycleID)
		}
		seenCycleIDs[cycleID] = struct{}{}
		if name := strings.TrimSpace(cycle.Name); name == "" || len(name) > 400 {
			return fmt.Errorf("invalid project cycle %q name", cycleID)
		}
		if err := validateProjectDateValue(cycle.StartsOn, "cycle start date"); err != nil {
			return fmt.Errorf("project cycle %q: %w", cycleID, err)
		}
		if err := validateProjectDateValue(cycle.EndsOn, "cycle end date"); err != nil {
			return fmt.Errorf("project cycle %q: %w", cycleID, err)
		}
		if cycle.EndsOn < cycle.StartsOn {
			return fmt.Errorf("invalid project cycle %q: end date must be on or after the start date", cycleID)
		}
		if len(cycle.IssueIDs) > MaxProjectCycleIssues {
			return fmt.Errorf("invalid project cycle %q: too many issues", cycleID)
		}
		seenIssueIDs := make(map[string]struct{}, len(cycle.IssueIDs))
		for _, issueID := range cycle.IssueIDs {
			parsed, err := uuid.Parse(strings.TrimSpace(issueID))
			if err != nil || parsed == uuid.Nil {
				return fmt.Errorf("invalid project cycle %q issue id", cycleID)
			}
			if _, exists := seenIssueIDs[parsed.String()]; exists {
				return fmt.Errorf("invalid project cycle %q: duplicate issue id", cycleID)
			}
			seenIssueIDs[parsed.String()] = struct{}{}
		}
	}
	return nil
}

func validateMilestones(milestones []ProjectMilestone) error {
	if len(milestones) > MaxProjectMilestones {
		return errors.New("invalid project milestones: too many milestones")
	}
	seen := make(map[string]struct{}, len(milestones))
	for index, milestone := range milestones {
		id := strings.TrimSpace(milestone.ID)
		if id == "" || len(id) > 128 {
			return fmt.Errorf("invalid project milestone %d id", index)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("invalid project milestone %q: duplicate id", id)
		}
		seen[id] = struct{}{}
		if name := strings.TrimSpace(milestone.Name); name == "" || len(name) > 400 {
			return fmt.Errorf("invalid project milestone %q name", id)
		}
		if len(milestone.Description) > 4000 {
			return fmt.Errorf("invalid project milestone %q description", id)
		}
		if err := validateProjectDate(milestone.TargetDate, "milestone target date"); err != nil {
			return fmt.Errorf("project milestone %q: %w", id, err)
		}
	}
	return nil
}

func validateProjectDate(value *string, field string) error {
	if value == nil {
		return nil
	}
	return validateProjectDateValue(*value, field)
}

func validateProjectDateValue(value, field string) error {
	if value == "" {
		return fmt.Errorf("invalid project %s", field)
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return fmt.Errorf("invalid project %s", field)
	}
	return nil
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
		if err := project.ValidatePlanning(); err != nil {
			return fmt.Errorf("projects[%d]: %w", index, err)
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
