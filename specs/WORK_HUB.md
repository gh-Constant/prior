# Prior work hub direction

## Product decision

Prior should help a person decide what to do next across personal, professional, and education work. The Eisenhower matrix remains a useful classification view, but it is not the primary information architecture.

The first work-hub release uses this deliberately small hierarchy:

```text
Area (ongoing responsibility)
  └── Project (finite outcome)
        └── Task (next action)
```

Notes can be attached directly to a project without forcing the user to maintain a parallel folder tree. Standalone tasks and notes remain valid.

## UX principles

- Today is the default destination and shows a short, actionable list rather than the whole database.
- Inbox is the safe place for fast capture before the user decides where something belongs.
- Projects are discovered through one searchable list grouped by Area; the sidebar does not become a second project database.
- Project pages show only the project's tasks and notes. Details are progressively disclosed instead of being permanently visible on every task row.
- Waiting/Delegated work is separated from executable work so it does not pollute Today.
- The user can always override recommendations. Automation explains why an item is surfaced but does not silently reorganize it.

## Minimal first-release model

Areas: `id`, `name`, `color`, timestamps, soft delete.

Projects: `id`, `areaId`, `name`, `description`, `status` (`planned`, `active`, `paused`, `completed`), timestamps, soft delete.

Tasks add optional `areaId`, `projectId`, `status` (`inbox`, `next`, `in_progress`, `waiting`, `done`), `scheduledDate`, `assigneeName`, and `followUpDate`. Existing priority and Eisenhower fields remain compatible.

Notes add optional `projectId`; existing note folders remain available for general notes.

The first release stores the new workspace metadata locally, matching the current local-first Notes model. Task fields remain part of the existing task snapshot so the current sync path can evolve without duplicating business logic. Server synchronization for Areas, Projects, and project-scoped Notes is a follow-up migration, not a reason to block the new UI.

## Navigation

- Focus: Today, Inbox
- Organize: Projects, All tasks
- Review: Waiting, Eisenhower, Habits, Notes

The Projects destination is a searchable grouped list. Selecting a project opens a focused project page with Tasks and Notes tabs.

## Recommendation rules for this slice

Today surfaces, in order:

1. due or overdue executable tasks;
2. tasks scheduled for today;
3. `next` tasks from active projects;
4. standalone `next` tasks;
5. a small number of unscheduled important tasks.

Waiting and delegated tasks are excluded from executable recommendations. A later scoring pass can add duration, energy, and calendar capacity without changing this model.

## Research references

- [Things: Getting Productive with Things](https://culturedcode.com/things/support/articles/6378414/) — Inbox, Today, Upcoming, Anytime, Someday, Projects, and Areas.
- [Things: Moving Items](https://culturedcode.com/things/support/articles/9651894/) — searchable destinations and keeping large hierarchies navigable.
- [Linear: Projects](https://linear.app/docs/projects) — project overview, project properties, documents, milestones, and issues.
- [Sunsama: Daily Planning](https://help.sunsama.com/docs/usage-guides/daily-planning/) — deliberate daily planning and avoiding overcommitment.
- [Todoist: Filters](https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH) — useful cross-cutting views without requiring every item to live in a new hierarchy.

## Delivery slices

1. Work-hub model, local persistence, migration-safe task fields, navigation, Today, Projects, project detail, and project-scoped notes.
2. Project/Area sync and account-safe conflict handling.
3. AI planning actions (`plan_today`, `review_projects`, and `find_waiting_work`) using the same deterministic task model.
4. Optional time/energy planning and calendar integrations only after the first slice is usable.

