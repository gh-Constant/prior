package store

import (
	"context"

	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MCPTokenPlatform marks sessions minted for external MCP clients (Claude
// Code). They can only reach the /mcp endpoint, never the account API.
const MCPTokenPlatform = "mcp"

// MCPProject is the compact project/area view exposed to MCP clients so they
// can resolve names to the IDs tasks reference.
type MCPProject struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Kind     string  `json:"kind"`
	AreaID   *string `json:"areaId,omitempty"`
	Status   string  `json:"status,omitempty"`
	IsShared bool    `json:"shared,omitempty"`
}

// currentTaskColumns is the column list shared by CurrentTasks and CurrentTask.
const currentTaskColumns = `id::text, title, description, due_date, due_time, priority, area_id::text, project_id::text, status, scheduled_date::text, scheduled_time, assignee_name, follow_up_date::text, follow_up_time, estimated_minutes, people_ids, completed, important, urgent, created_at, updated_at, deleted_at, revision, reminder_at, checklist, assignee_id::text, parent_id::text, milestone_id, relations, recurrence, story_points`

// currentTaskVisible limits a tasks row (alias t) to live tasks the user ($1)
// owns or can see through an active project membership.
const currentTaskVisible = `t.deleted_at IS NULL AND (t.user_id = $1 OR EXISTS (
			SELECT 1 FROM project_members pm
			WHERE pm.project_id = t.project_id AND pm.user_id = $1 AND pm.status = 'active'
		))`

// CurrentTasks returns the caller's live tasks plus tasks in projects shared
// with them, read from the materialized tasks table (not the changelog).
func (s *Store) CurrentTasks(ctx context.Context, userID uuid.UUID) ([]tasks.Task, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+currentTaskColumns+` FROM tasks t WHERE `+currentTaskVisible+` ORDER BY t.created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]tasks.Task, 0)
	for rows.Next() {
		task, err := scanCurrentTask(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, task)
	}
	return result, rows.Err()
}

// CurrentTask returns one live task the caller owns or can see through a
// shared project, or pgx.ErrNoRows when there is none.
func (s *Store) CurrentTask(ctx context.Context, userID, taskID uuid.UUID) (tasks.Task, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+currentTaskColumns+` FROM tasks t WHERE `+currentTaskVisible+` AND t.id = $2`, userID, taskID)
	if err != nil {
		return tasks.Task{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return tasks.Task{}, err
		}
		return tasks.Task{}, pgx.ErrNoRows
	}
	return scanCurrentTask(rows)
}

func scanCurrentTask(rows pgx.Rows) (tasks.Task, error) {
	var task tasks.Task
	var peopleJSON, checklist, relations, recurrence []byte
	if err := rows.Scan(&task.ID, &task.Title, &task.Description, &task.DueDate, &task.DueTime, &task.Priority, &task.AreaID, &task.ProjectID, &task.Status, &task.ScheduledDate, &task.ScheduledTime, &task.AssigneeName, &task.FollowUpDate, &task.FollowUpTime, &task.EstimatedMinutes, &peopleJSON, &task.Completed, &task.Important, &task.Urgent, &task.CreatedAt, &task.UpdatedAt, &task.DeletedAt, &task.ServerRevision, &task.ReminderAt, &checklist, &task.AssigneeID, &task.ParentID, &task.MilestoneID, &relations, &recurrence, &task.StoryPoints); err != nil {
		return task, err
	}
	if err := decodeTaskJSON(&task, peopleJSON, checklist); err != nil {
		return task, err
	}
	if err := decodeRelations(&task, relations); err != nil {
		return task, err
	}
	if err := decodeRecurrence(&task, recurrence); err != nil {
		return task, err
	}
	return task, nil
}

// CurrentHabits returns the caller's live habits from the habits table.
func (s *Store) CurrentHabits(ctx context.Context, userID uuid.UUID) ([]tasks.Habit, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, title, important, urgent, interval, unit, start_date, time_of_day, end_date, days_of_week, completed_dates, created_at, updated_at, deleted_at, revision
		FROM habits WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]tasks.Habit, 0)
	for rows.Next() {
		habit, err := scanHabitRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, habit)
	}
	return result, rows.Err()
}

// CurrentProjects lists the caller's areas, own projects and projects shared
// with them.
func (s *Store) CurrentProjects(ctx context.Context, userID uuid.UUID) ([]MCPProject, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, name, 'area'::text, NULL::text, ''::text, false FROM areas WHERE user_id = $1 AND deleted_at IS NULL
		UNION ALL
		SELECT p.id::text, p.name, 'project'::text, p.area_id::text, p.status, p.user_id <> $1
		FROM projects p WHERE p.deleted_at IS NULL AND (p.user_id = $1 OR EXISTS (
			SELECT 1 FROM project_members pm
			WHERE pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
		))`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]MCPProject, 0)
	for rows.Next() {
		var project MCPProject
		if err := rows.Scan(&project.ID, &project.Name, &project.Kind, &project.AreaID, &project.Status, &project.IsShared); err != nil {
			return nil, err
		}
		result = append(result, project)
	}
	return result, rows.Err()
}
