# Scrum, Kanban, Scrumban and story points

Agile projects (`projectType: "software"`) pick a methodology. It decides how tasks are sized, what cycles are called and whether the project has a Planning Poker tab. Standard projects are unchanged.

## Data

- `Project.methodology?: "kanban" | "scrum" | "scrumban"`, stored with the project (localStorage JSON, `metadata` JSONB on the server, `PATCH /v1/collaboration/projects/{id}` field `methodology`). Absent means `kanban`, which is exactly today's behaviour. The client never writes the key as `null`: an invalid value is deleted on read (`withNormalizedMethodology`), and switching a project back to Standard only changes `projectType` (the earlier methodology stays and is ignored, so switching back restores it). A shared project can still be cleared with an explicit `"methodology": null`. For a shared project the server copy decides what everyone sees: the owner's change goes through that PATCH too (see `specs/AGILE_COLLABORATION.md`, "Project type").
- `Task.storyPoints?: number | null`, a multiple of 0.5 from 0 to 999 (`lib/storyPoints.ts`, `tasks.NormalizeStoryPoints` on the server), `null` when not estimated. Stored in SQLite `tasks.story_points`, PostgreSQL `tasks`/`task_changes.story_points` and carried by sync mutations and task-change snapshots like `recurrence`. Existing data omits it. `estimatedMinutes` is a duration and unrelated.
- The value is kept when a project stops using points: switching Scrum back to Kanban hides the points, it does not erase them.

## What each methodology turns on

`agileFeatures(project)` in `app/src/lib/agile.ts` is the only place that maps a methodology to features; components ask for `points`, `sprints` or `poker`.

| Kind (picker label) | Points | Sprints | Planning Poker |
| --- | --- | --- | --- |
| Standard | no | no | no |
| Agile · Kanban | no | no | no |
| Agile · Scrum | yes | yes | yes |
| Agile · Scrumban | yes | no | yes |

The project type and methodology are one select (`components/ProjectKindSelect.tsx`: Standard, Agile · Kanban, Agile · Scrum, Agile · Scrumban, each with a one-line description; `CustomSelect` options accept a `description`). It is used by the new/edit project modal (`WorkHubView`) and the shared project editor (`collaboration/ProjectEditor.tsx`). `projectKindOf` / `applyProjectKind` convert between the select and the two project fields. `ProjectTypeChip` shows Standard, Kanban, Scrum or Scrumban.

## Story points instead of priority

`taskBadgeKind(project)` is `"points"` when `agileFeatures(project).points`, otherwise `"priority"`. In points mode the P1–P4 glyph is replaced by a story-points chip (`components/tasks/StoryPoints.tsx`):

- `StoryPointsChip`: "5 pts", "1 pt", "½ pt", or a dashed "–" (title "Not estimated"). The chip borrows the geometry of the surrounding chips (`task-chip`, `project-chip` or `collab-chip` variant).
- `TaskSizeBadge({ task, project, variant, children })`: the chip in points mode, otherwise `children` (the priority glyph). Used by `kanban/TaskCard.tsx` (and `ProjectTaskBoard`, `TasksKanban` pass the card's project as `sizeProject`).
- `TaskRow` (both variants): the chip leads the meta line (also on phones, where the priority glyph is hidden); the default row replaces its `P{n}` flag. Matrix rows (`showPriority={false}`) keep showing neither.
- `ProjectCollaboration` issue cards, phone rows and board cards, through `ProjectIssue.storyPoints` (`App.tsx` fills it from the task).

Priority stays an editable field in points mode (detail panel, composer); only its glyph is replaced.

Editing: the task detail panel has a "Story points" row above the priority (`StoryPointsPicker`, a deck of cards 0, ½, 1, 2, 3, 5, 8, 13, 21 plus Clear; a value outside the deck such as 4 gets its own card; 44px targets on phones), and the task composer has a "Points" pill (`StoryPointsSelect`, the same deck as a dropdown). Both only appear when the task's project is in points mode.

Components other code may rely on: `StoryPointsPicker` props `{ value: number | null; onChange(value: number | null): void; compact?: boolean; disabled?: boolean; label?: string }`, `STORY_POINT_DECK`, `formatStoryPoints` / `formatStoryPointsValue` (`lib/storyPoints.ts`).

## Sprints

Sprints are the existing cycles (`Project.cycles`, `startsOn`/`endsOn`/`issueIds`). In a Scrum project:

- The "Cycles" tab, its button and the cycle editor say "Sprints" / "New sprint" (`scrum.*` strings).
- The Board and Issues tabs get a sprint filter "Active sprint | All | Backlog" (issues in no sprint). It starts on the running sprint, or on All when none runs (`filterBySprint`).
- Sprint cards show a points progress bar ("13 of 21 pts done", "2 not estimated") from `sprintStats`, and a velocity summary sits above them: `velocity(cycles, issues, today)` is the average done points of the last three finished sprints that had issues, rounded to one decimal (none until a sprint has finished).
- The sprint editor shows each issue's points and the total committed to the sprint.

Scrumban keeps "Cycles" as they are. No burndown chart and no WIP limits for now.

## Server

- MCP `create_task` / `update_task` take `story_points` (`null` clears it on update); `list_tasks` / `get_task` return `storyPoints` (`specs/MCP.md`).
- The account export CSV (`tasks.csv`) has a `storyPoints` column; `tasks.json` includes the field.
- Settings → Import: a numeric Linear `Estimate` becomes `storyPoints` (`specs/IMPORT.md`).

## Planning poker API contract

The Planning Poker tab is a slot: `ProjectCollaboration` takes `renderPoker?: () => ReactNode` and shows the tab (`/projects/{id}/poker`, `"poker"` in `PROJECT_TABS`) only when the project's `agileFeatures(project).poker` is true **and** `renderPoker` is provided. The server API below is implemented by the poker workstream.

Base: `/v1/collaboration/projects/{projectID}/poker`

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /poker` | – | `{"session": PokerSession \| null}` (the active one) |
| `POST /poker` | `{"taskIds":[id, 1..50],"deck":"fibonacci"\|"modified"\|"tshirt"}` | 201 `PokerSession` |
| `GET /poker/{sessionID}` | – | `PokerSession` |
| `PUT /poker/{sessionID}/vote` | `{"taskId","value":"5"\|null}` | `PokerSession` |
| `POST /poker/{sessionID}/reveal` \| `/revote` \| `/close` | – | `PokerSession` |
| `POST /poker/{sessionID}/current` | `{"index":2}` | `PokerSession` |
| `POST /poker/{sessionID}/estimate` | `{"taskId","storyPoints":5\|null,"advance":true}` | `{"session":PokerSession,"task":Task}` |

```json
PokerSession = {"id","projectId","status":"active|closed","deck":"fibonacci",
 "facilitatorId":"uuid|null","canControl":true,"currentIndex":0,"round":1,"revealed":false,
 "items":[{"taskId","title","storyPoints":null,"finalPoints":null}],
 "participants":[{"userId","displayName","avatarUrl","role":"owner|editor|viewer","online":true,"voted":true,"vote":"5|null"}],
 "myVote":"5|null","createdAt","updatedAt"}
```

`vote` of other participants is null until `revealed`; `myVote` is always the viewer's own. Decks (string values; the UI shows `0.5` as ½ and `coffee` as a cup):

- fibonacci: `0, 1, 2, 3, 5, 8, 13, 21, ?, coffee`
- modified: `0, 0.5, 1, 2, 3, 5, 8, 13, 20, 40, 100, ?, coffee`
- tshirt: `XS, S, M, L, XL, ?, coffee` (points XS=1, S=2, M=3, L=5, XL=8)

Realtime message: `{"type":"poker_required","revision":0}`: the client refetches the session.

Rules: shared projects play in realtime between members; an unshared project plays solo (same table, the user walks through chosen tasks and saves with the normal task update, with a "Share to play with your team" call to action). Only owners and editors vote; viewers watch. The controller is whoever started the session or the project owner (any editor if the starter was deleted).

## Planning poker UI

Code: `app/src/components/poker/` (`PlanningPokerPanel` picks the controller, `PokerRoom` is the whole screen), `lib/poker.ts` (decks, vote maths, presets, the solo state machine and `useSoloPoker`), `useSharedPoker.ts` (API-backed controller). Strings live in the `poker` i18n namespace. The panel is passed to `ProjectCollaboration` as `renderPoker` by `App.tsx`.

**Flow.** The tab shows a start screen: a deck (Fibonacci, Modified Fibonacci, T-shirt sizes) and the tasks to estimate, with presets "Not estimated yet", "<active sprint>", "Outside any sprint" and "All open tasks" (1 to 50 tasks, `pokerPresets`). "Deal the cards" starts the session; everyone in the project who has the tab open sees the table. Each task is one round: people pick a card (the others only see a face-down card and "n of m voted"), the controller reveals, the table shows the cards (lowest/highest tags), average, median, range, a distribution and a hint (agreement, split, no numeric votes). The controller then accepts an estimate (prefilled with the deck card nearest the average, adjustable with `PokerPointsStepper`), which writes `storyPoints` on the task and moves to the next undecided task, or re-votes (round + 1, votes cleared) or skips. When every task has a final estimate the room shows "Everything is estimated" and the controller closes the session; "End session" closes it early (with a confirmation). Viewers watch and cannot vote. A closed session disappears; there is one active session per project.

**Controller bar.** `PokerPointsStepper` is kept instead of `StoryPointsPicker` because it steps through the session's own deck (including 20/40/100 and the T-shirt points) in one control, where the picker is the fixed nine-card task scale plus Clear. Figures are formatted with `formatStoryPointsValue`, so "½" is defined once.

**Solo mode.** A project that is not shared (`collaborationStore.isShared` is false) plays the same table against `useSoloPoker`: one participant (you), the session lives in memory, and Accept calls the normal task update (`onSetPoints`). A banner offers "Share to play with your team". Nothing is sent to the poker API.

**Keyboard.** Type a card to pick it (`5`, `13`, `.5`, `xl`, `?`, `c` for the coffee card; multi-key values wait 450 ms or resolve as soon as unambiguous), `Enter` reveals and, once revealed, accepts, `R` re-votes (controller), `Backspace`/`Delete` takes your card back before the reveal. Shortcuts are ignored while typing in a field, with a modifier key, or while a dialog is open.

**Realtime.** After every write the server sends `{"type":"poker_required"}` to each project member's sockets. `realtime.ts` forwards it as the `REALTIME_EVENT` DOM event without a sync, and `useSharedPoker` refetches `GET /poker` after a 150 ms debounce (a burst of votes costs one request). A 10 s poll while a session is active (30 s while idle) and a refetch on `visibilitychange`/`online` cover a dropped socket. Own writes are applied optimistically and rolled back by a refetch on failure. The accepted points reach the other members' task lists through the normal `tasks_required` sync, so the board shows them without a reload.

**Phones (< 760 px).** The queue becomes a horizontal chip strip above the table; the controls and the hand are docked at the bottom above the tab bar (hand scrolls horizontally, 44 px targets). When a task starts or the cards turn, the table is scrolled into view so the dock never hides it.
