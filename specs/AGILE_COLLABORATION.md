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

### Release 0.8 (collaboration redo)

- **Project type** (`projectType`: `standard` or `software`) lives in the
  project metadata and syncs like the planning fields, so the owner and every
  member see the same page. A client that omits the field keeps the stored
  value. Milestones (`milestones`) are stored the same way.
- **Invitations**: one click invites one or several emails. The owner gets
  the outcome inline (sent, emailed or not) and the link to copy
  (`/invite/<token>`, a web page that survives sign-up). Invitees receive an
  email (Resend, in the inviter's language) and, with an account, a realtime
  notification; they still accept. Pending invites can be resent (the link is
  rotated: only hashes are stored), copied or revoked. Members can leave.
  Role changes are optimistic and confirmed inline.
- **Issue fields** on tasks (migration `031`, SQLite `012`): `assigneeId` (the
  first assignee, see "Several assignees"), `parentId` (same project, no
  cycles), `milestoneId` and `relations` (`blocked_by`, `related`). Older
  clients that omit them keep the stored values. The people picker lists who
  follows a task; the assignees are the ones responsible ("My tasks", filters,
  quick assign on cards, a local notification when someone assigns you).
- **Activity** tab on agile projects: a GitHub-style grid of tasks completed
  (or created) per day, per person, from the task changelog
  (`GET /v1/collaboration/projects/{id}/activity`).
- **Realtime**: browsers now use the WebSocket too (the session token travels
  as the `prior.auth.<token>` subprotocol, never in the URL). Pushes notify
  only the members of the touched projects with `tasks_required`; the client
  runs just the part of the sync an event names (`tasks`, `shared`,
  `presence`). Member lists carry real presence (`online`).
- **Sub-tasks, blockers and milestones** (0.9): the task sheet edits the
  parent task, the "blocked by" tasks and the milestone, lists sub-tasks and
  creates new ones; cards show "Blocked", sub-task progress, the milestone and
  the parent. Agile projects manage milestones in Overview (target date,
  progress, which issues belong to them).
- **URLs**: every page has an address (`/projects/<id>/<tab>`, `/my-tasks`,
  `?task=<id>`…, see `app/src/lib/router.ts`); reloads and shared links
  reopen it, Back/Forward move between pages.

### Share links (invitation links)

The owner can also create a **reusable link** for a role, not tied to an email:
anyone with a Prior account who opens it can join as an editor or a viewer, after
confirming. It sits in the share dialog, under the email form ("Invitation link").

- **Storage.** A separate table, `project_share_links` (migration `036`), instead
  of extending `project_invites`: an email invitation is addressed to one person,
  single-use and accepted exactly once (`invitee_email NOT NULL`, `accepted_at`),
  while a link is anonymous, reusable and counted (`use_count`, optional
  `max_uses`), can be disabled (`revoked_at`) and may never expire (`expires_at`
  is nullable). Mixing the two would have loosened the email-match rule that
  protects invitations. Only `token_hash` (SHA-256) is stored; the 256-bit token
  has the same `/invite/<token>` shape as an emailed invitation, so
  `lib/pendingLink.ts` and `GET /v1/collaboration/invites/preview` handle both.
  A partial unique index keeps **one active link per role**: creating again
  rotates it (the previous link stops working). `created_by` and the project are
  `ON DELETE CASCADE`; the account deletion test walks the foreign key.
- **Who.** Only the project owner creates, lists, rotates and disables links
  (`GET`/`POST /v1/collaboration/projects/{id}/share-links`,
  `DELETE …/share-links/{linkId}`); editors and viewers get 403, strangers 404.
  Creating is rate-limited like invitations. The token is returned **once** at
  creation (hashes cannot be shown again): the creating device remembers the URL
  (`lib/shareLinkCache.ts`, local storage) so the owner can copy it again; on
  another device the owner regenerates. The dialog offers "never / 7 / 30 days"
  for new links.
- **Joining.** `POST /v1/collaboration/invites/accept` takes any invitation token:
  an email invitation (must match the account, as before) or a share link. A
  share link adds the account with the link's role; **nobody is downgraded** (an
  existing editor or the owner opening a viewer link changes nothing; a viewer
  opening an editor link becomes an editor). Already-covered visitors do not use
  up the link. Plan limits are the owner's: a link does not reserve a seat, so
  the member and shared-project limits are checked at join time (`402
  PLAN_LIMIT`, same shape as invitations). Errors carry codes: `LINK_REVOKED`,
  `LINK_EXPIRED`, `LINK_EXHAUSTED` (410), `INVITE_NOT_FOUND` (404). Members of the
  project (the owner's use count included) get `collaboration_required`.
  People the owner removed can rejoin while the link is active; disabling or
  rotating a link does not remove members.
- **Preview.** The preview is public (the token is the capability) and now
  returns `kind` (`invite` or `link`), `status` (`pending`, `accepted`,
  `expired`, `revoked`) and, for a signed-in caller, `alreadyMember`,
  `currentRole` and the project id.
- **Confirmation, never silent.** Opening any invitation link (email or share)
  stores its token (`pendingLink`) and, once the account has synced, shows
  `JoinInviteDialog`: "Join <project>? invited by X, as editor/viewer" with
  **Join**, **Later** (kept; offered again next launch) and **Decline** (forgets
  it). Nothing is joined before the person presses Join. Email invitations used
  to be accepted automatically on arrival; they now follow the same dialog (their
  in-app notification card still works, and is still shown while they are
  pending). People who arrive signed out see the invitation context on the
  sign-in/sign-up screen (`InvitePreviewCard`), sign up or in with a password or
  Google, go through the onboarding and the product tour (`PRODUCT_TOUR.md`), and
  only then get the dialog: it is gated by `canPromptToJoin` (signed in, no
  onboarding or tour open, onboarding status known). Expired, disabled or unknown
  links explain themselves in the dialog and are forgotten.

### Presence (who is online)

Co-members of a shared project see each other's state as a dot on the avatar:
green = online (active), orange = away, grey hollow ring = offline (the ring
shape means the state never rests on color alone).

- **Client**: `app/src/lib/presence.ts` runs an activity tracker for the app
  (pointer, keyboard, wheel, touch, focus, return to the foreground). After
  5 minutes without any of these (a hidden tab or a backgrounded app produces
  none) it reports `idle`, and `active` on the next interaction. `lib/realtime.ts`
  sends `{"type":"presence","state":"active"|"idle"}` over the realtime
  socket, and again on every (re)connect.
- **Server** (`httpapi/presence.go`): every connection is active unless it
  reported `idle`. A user is `online` when at least one connection is active
  (so an idle phone does not hide an active laptop), `away` when all are idle,
  `offline` without a connection. Member lists (`GET /v1/collaboration/projects`)
  and Planning Poker participants carry `presence` (`online`|`away`|`offline`),
  the legacy `online` flag (connected, whatever the activity) and, for an
  offline user, `lastSeenAt` (when their last connection closed here; absent
  after an API restart).
- **Push**: connect, disconnect and idle/active reports schedule one
  `presence_required` event, debounced by 2 s and sent only when the state
  differs from what co-members were last told (a page reload does not
  flicker). The audience is `ProjectPeerIDs`: owners and active members of the
  user's projects, never anyone else. Clients refetch the member lists
  (`presence` sync scope). State is per API instance (memory), like `online`.
- **UI**: the single `PresenceDot` (`components/collaboration/PresenceDot.tsx`,
  tooltip and accessible name "Online", "Away" or "Offline, last seen 5
  minutes ago") sits on `PersonAvatar` when the person has a state. It shows
  in the project header avatar stack (desktop and phone), the share dialog,
  assignee pickers and filter, the activity contributors and the Planning
  Poker seats. Task cards and comment authors do not show it. Your own avatar
  is always online. Tests: `presence.test.ts`, `PresenceDot.test.tsx`,
  `presence_test.go`, `presence_integration_test.go`.

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

`task_comments` and `comment_mentions` are implemented for shared projects
(see `COMMENTS.md`). Later, add `cycles`, `project_milestones`,
`task_relations`, `project_updates`, and `views`. Do not encode those concepts into JSON blobs
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
2. Add activity, subscribers, notifications, project updates (comments and
   @mentions are done: `COMMENTS.md`),
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

## Several assignees

A task can be assigned to several project members, not just one.

- **Data**: `Task.assigneeIds: string[]` is the source of truth (ordered, unique,
  at most 10, `MAX_ASSIGNEES` in `app/src/lib/assignees.ts` and
  `tasks.MaxAssignees` in Go). `assigneeId` stays the FIRST assignee (or null)
  so older clients and servers, which only know one, keep working; both fields
  are always written together. PostgreSQL migration `037` adds
  `assignee_ids JSONB NOT NULL DEFAULT '[]'` to `tasks` and `task_changes`
  (the `assignee_id` column and its foreign key stay) and backfills
  `assignee_ids = [assignee_id]`; SQLite migration `015` does the same with a
  JSON text column. Local data that only has `assigneeId` is normalized to
  `[assigneeId]` (`normalizeTask`).
- **Validation**: every id must be an active member of the task's project (same
  rule as the single assignee before; a private task only accepts its owner),
  otherwise the whole mutation is refused. More than 10, or an invalid UUID, is
  refused too. Duplicates collapse (first occurrence wins).
- **Compatibility on push** (`tasks.Task.ResolveAssignees`):
  `assigneeIds` sent: it wins (`[]` or `null` clears). Only `assigneeId` sent
  (an older client): the list becomes `[assigneeId]`, unless that id already is
  the stored first assignee, in which case the stored list is kept (an old
  client re-sending the same first assignee must not wipe the others); a null
  `assigneeId` clears the list. Neither sent: the stored list is kept. The
  client applies the same rule to a draft that only carries `assigneeId`
  (`resolveAssigneeIds`). Rows written by an older server instance (a legacy
  `assignee_id` that disagrees with the list) are read as `[assignee_id]`.
- **Deleting an account** removes the user from every list and moves
  `assignee_id` to the new first assignee.
- **Meaning**: "My tasks", the project "Mine" filter and "Unassigned" use the
  list (`isAssignedTo`, `taskAssigneeIds`); a task assigned to others but not to
  me stays out of my Today (`isAssignedToSomeoneElse`). The assignment
  notification fires on a device when the signed-in user was not among the
  assignees before the sync and is now (`newlyAssignedToMe`): the people who were
  already assigned are not notified again. There is no board grouping by
  assignee (columns are workflow states), so nothing to duplicate.
- **UI**: the assignee picker (task sheet, composer, quick assign on cards) is a
  multi-select menu (`AssigneeSelect`): toggling a member keeps the menu open,
  the people already assigned come first, the order of selection is the order of
  the list, "Unassign everyone" clears it. Cards and rows show stacked avatars
  (`AssigneeStack`): at most three, then "+N". On phones the menu rows are 44px
  tall. The assistant accepts `assignee` (one name) or `assignees` (several) and
  a change replaces the whole list; the review card shows the names.
- **Not covered**: the free-text `assigneeName` ("waiting on") is unrelated and
  unchanged. The Linear and Notion importers keep the assignee as a note
  (they cannot match names to members).
