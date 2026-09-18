# Agile collaboration direction

## Decision summary

Prior already has the beginning of a personal work hub:

```text
Area -> Project -> Task
```

The next layer should make the project the collaboration boundary and use
"issue" as the agile vocabulary without throwing away the existing `Task`
model or the local-first behavior.

```text
Workspace
  -> Team -> Workflow states / Cycles / Labels
  -> Project -> Milestones / Views / Updates
  -> Issue (the existing Task record) -> Sub-issues / Relations / People
```

The important security decision is that a project link is not an access grant.
Project membership is explicit, checked on every server read and write, and
never inferred from a client-provided user name, email, or ID.

## Implementation status

This first implementation delivers the smallest useful secure slice: project
membership and expiring invite tokens, editor/viewer authorization, task people
stored by stable user ID, creator auto-membership on new tasks, shared-project
Overview/Issues/Board/Cycles surfaces, and a people/planning section in the task
composer. The workspace/team/cycle/view tables described below are the target
architecture for the next slices; they are intentionally not faked as client
only JSON or treated as complete in this change.

## What Linear's model contributes

The research used the following first-party documentation:

- [Conceptual model](https://linear.app/docs/conceptual-model)
- [Teams](https://linear.app/docs/teams)
- [Projects](https://linear.app/docs/projects)
- [Project overview](https://linear.app/docs/project-overview)
- [Issue status and workflows](https://linear.app/docs/configuring-workflows)
- [Triage](https://linear.app/docs/triage)
- [Cycles](https://linear.app/docs/use-cycles)
- [Custom views](https://linear.app/docs/custom-views)
- [Members and roles](https://linear.app/docs/members-roles)
- [Issue relations](https://linear.app/docs/issue-relations)
- [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)
- [Project milestones](https://linear.app/docs/project-milestones)
- [Display options](https://linear.app/docs/display-options)

The transferable ideas are:

1. A workspace is the access and navigation container. Teams own workflow
   conventions and planning cadence. Projects group work around an outcome.
2. Issues are the atomic unit of execution. An issue has one team, one current
   workflow state, optional project/cycle/milestone, people, labels, priority,
   and relationships.
3. Backlog and triage are scopes over workflow state, not duplicate copies of
   issues. A view is a durable filter and display configuration over the same
   records, not another task store.
4. A project overview should hold the brief, ownership, dates, health,
   members, resources, milestones, updates, and issue perspectives. The issue
   view should support list and board layouts with grouping and ordering.
5. The current user should be easy to assign, but assignment and membership
   are explicit records. Creating an issue automatically subscribes the
   creator; Prior will additionally add the creator to the task people set.
6. Sharing is separate from copying a URL. A guest/member can only see data
   that their workspace/team/project membership permits. Every endpoint must
   apply the same authorization predicate.

## Current Prior gap analysis

The current repository is deliberately single-user for work-hub data:

- `Task` has a free-text `assigneeName`, but no stable user reference or
  many-to-many people set.
- `Project` and `Area` are local scoped objects. The server workspace snapshot
  stores them under one `user_id`, and the task mutation path rejects a task
  owned by another user.
- `/v1/workspace/sync` is a whole-user snapshot merge. It is appropriate for
  private areas/projects/notes, but it must not become a way for a member to
  submit or receive another member's private records.
- The existing `status` values (`inbox`, `next`, `in_progress`, `waiting`,
  `done`) are useful personal planning states, but they are not a configurable
  team workflow with backlog/triage categories.
- `WorkHubView` already provides a clean project list, project detail, task
  list, notes, and a waiting scope. It is the correct surface to extend with
  project overview/issues/board/cycles and a share control.
- Local SQLite and browser storage need additive migrations. Existing records
  must continue to normalize missing fields to the current defaults.

## Canonical data model

### Workspace and membership

Add a collaboration layer instead of overloading `user_id`:

- `workspaces`: id, name, slug, owner_user_id, timestamps, deleted_at.
- `workspace_members`: workspace_id, user_id, role (`owner`, `admin`,
  `member`, `guest`), status, timestamps. Unique by workspace/user.
- `workspace_invites`: workspace_id, email, role, token_hash, inviter_user_id,
  expires_at, accepted_at, created_at. Store only a hash of the invite token.
- `teams`: workspace_id, name, key/short code, visibility, owner, timestamps.
- `team_members`: team_id, user_id, role, status.

Existing private work remains valid. A migration may create one personal
workspace per account, but access to existing private records should not widen
until the user explicitly shares a project.

### Projects, issues, and people

Extend the existing records additively:

- `projects`: nullable workspace_id, created_by, lead_user_id, visibility,
  start_at, target_at, health, plus the existing area/name/description/status.
- `project_members`: project_id, user_id, role (`owner`, `editor`, `viewer`),
  invited/active status, timestamps. The owner is inserted at creation.
- `tasks` (displayed as Issues inside agile surfaces): nullable team_id,
  workflow_state_id, cycle_id, milestone_id, parent_task_id, issue_number,
  sort_key, and a stable `created_by`.
- `task_people`: task_id, user_id, role (`owner`, `assignee`, `collaborator`),
  created_at. A unique key prevents duplicate people. The creator is inserted
  automatically for every authenticated new task; the UI can remove them only
  when another owner remains.
- `task_labels` / `labels`: scoped to a team or workspace.
- `workflow_states`: team_id, name, category (`triage`, `backlog`, `unstarted`,
  `started`, `completed`, `canceled`), color, position, is_default.

Later, add `cycles`, `project_milestones`, `task_relations`, `comments`,
`project_updates`, and `views`. Do not encode those concepts into JSON blobs
inside `tasks`; they need independently authorized and queryable records.

### Views

`views` should store the definition, not a materialized task list:

- owner_user_id, scope (`workspace`, `team`, `project`), scope_id, kind
  (`issues`, `projects`), name, shared flag;
- `filters` JSONB with a versioned schema;
- `display` JSONB for layout (`list`/`board`), grouping, ordering, and visible
  properties;
- favorite/order metadata per user in a separate table.

The first implementation can support filters for project, team, state, cycle,
assignee, priority, and label. Unknown filter keys must be rejected rather than
silently broadening a query.

## Security model

The server is authoritative for collaboration. The client can optimistically
render and queue work, but it never grants access.

1. Resolve the authenticated user from the hashed session token. Never accept
   `ownerId`, `memberId`, or an assignee email as an authority signal.
2. Centralize `authorizeWorkspace`, `authorizeProject`, and `authorizeTask`
   helpers in the store layer. Use them for list, get, search, sync, mutate,
   invite, comments, views, and notifications.
3. A private task remains visible to its owner. A task in a shared project is
   visible only to active project members (and, later, explicitly shared task
   members). A project member does not gain access to unrelated private tasks
   owned by the same user.
4. Validate that every referenced project/team/cycle/state/parent belongs to
   an accessible scope. Prevent cross-project parent/child and relation leaks.
5. Invitation tokens are random, single-use, expiring, and stored hashed.
   Accepting an invite requires the authenticated account to match the invite
   email or an explicit, auditable confirmation flow.
6. Server responses must be scoped before pagination/counts/aggregates are
   calculated, otherwise counts can leak private records.
7. Realtime messages should carry only a workspace/project revision hint. The
   client must re-fetch through authorized endpoints; never broadcast payloads
   to all workspace connections.
8. Keep private and shared sync planes separate initially. Existing personal
   task/workspace sync can remain compatible while shared projects use an
   ACL-aware collaboration API with per-project revisions and optimistic
   version checks.

## UI and interaction model

Use progressive disclosure so the current Prior calmness survives the added
planning power.

### Navigation

Keep the current groups but add a compact collaborative layer:

- Focus: Today, My tasks, Inbox
- Work: Projects, Teams, Views
- Review: Waiting, Cycles, Priority lens, Habits, Notes

The sidebar should show shared project/team badges only when the user has them;
it should not become a second database of every issue.

### Project page

Use four stable tabs:

- Overview: brief, lead/members, share button, status/health/dates, progress,
  milestones, latest update, resources.
- Issues: filtered list with compact property chips.
- Board: status columns with drag-and-drop when the project workflow supports
  it.
- Cycles: current/upcoming cycles and their issue counts/capacity.

The right details drawer holds editable metadata and the people picker. A
share modal shows current members, role, pending invites, and a constrained
invite form. Link copy is a secondary action with a note that access is still
required.

### Issue/task editor

Keep the fast title-first composer. Add a collapsed “Planning” section with
team, project, workflow state, cycle, milestone, labels, and parent. Add a
“People” picker that renders avatars/chips; initialize it with the current
user for authenticated creation. Keep the personal priority/importance/urgency
controls available as Prior-specific fields.

Rows/cards should show only the properties selected by the current view. Use
avatars for people, a state dot, project badge, cycle badge, and priority icon;
do not turn every task row into a form.

### Views

Start with saved project issue views: All issues, Active, Backlog, and a shared
custom view. Add list/board toggle, one filter bar, group/order menus, and a
small “Save view” action. Treat `Inbox`/`Triage` as a scope with clear intake
copy rather than a new collection.

## Delivery plan

### Slice 1: secure shared projects and task people

1. Add server migrations and models for workspaces, members, project members,
   invites, and task people.
2. Add authenticated collaboration endpoints for list/get/update project,
   invite/accept/revoke member, list project members, and list/update shared
   tasks. Keep personal sync unchanged.
3. Add local/cache migrations for stable task people IDs and project sharing
   metadata. New local tasks default the current authenticated user into the
   people set; anonymous local tasks remain private until synced.
4. Add project members/share UI and people picker UI. Add project shared badge,
   member avatars, and read-only treatment for viewers.
5. Add server authorization, invite, IDOR, and cross-account regression tests.

### Slice 2: teams and workflow/backlog/triage

1. Add teams, team membership, workflow states, and configurable state
   categories/defaults.
2. Map existing task statuses to a default workflow without changing old
   personal views. Backlog is the backlog category; triage is an explicit
   intake category.
3. Add project/team issue list and board views with drag/drop state changes,
   bulk selection, and accessible keyboard alternatives.

### Slice 3: cycles and milestones

1. Add team-scoped repeating cycles and project milestones.
2. Add current/upcoming/past cycle views, rollover rules, and project progress
   by milestone. Preserve historical cycle summaries when a cycle closes.

### Slice 4: durable views and collaboration history

1. Add saved views with versioned filters/display configuration and per-user
   favorites.
2. Add comments, activity, subscribers, notifications, project updates,
   dependencies/relations, and parent/sub-issue automation.

Initiatives, cross-team roadmaps, external integrations, and complex capacity
forecasting should come after these foundations. They are valuable Linear ideas
but would add more surface area than the current product can support safely in
the first collaborative release.

## Implementation order for this repository

Before editing UI, add the contracts and tests first:

1. `server/internal/workspace/model.go` and `server/internal/tasks/model.go`
   additive transport types and strict validation.
2. Next numbered PostgreSQL migration plus matching Tauri SQLite migration.
3. Store authorization helpers and collaboration handlers in
   `server/internal/httpapi/server.go` / `server/internal/store/store.go`.
4. `app/src/types.ts`, `app/src/lib/api.ts`, local store/cache, and sync client.
5. `WorkHubView` project detail/share surfaces and `TaskComposer` people/planning
   controls.
6. Tests for model validation, permissions, invites, task defaults, local
   account isolation, and the responsive UI states.

Use `git diff --check`, the focused Vitest suite, Go formatting/vet/tests, and
the client typecheck before considering the slice complete. Do not test through
Roblox Studio; this is a React/Go/Tauri application.
