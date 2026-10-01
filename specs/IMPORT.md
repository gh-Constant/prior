# Import from Todoist, Linear and Notion

Settings → Import (`/settings/import`, also the palette command "Import from Todoist, Linear or Notion") brings tasks over from official exports. It is file based: no OAuth, no API tokens, nothing leaves the device unless the user switches on AI mode. Everything deterministic runs locally; AI is an optional, Pro-only extra.

## Wizard

1. **Source.** Four cards (Todoist, Linear, Notion, Other) with two or three lines on how to export, a drop zone / file picker (CSV, ZIP, text; several files) and a "Paste text" box. The card only changes the instructions: what each file is comes from its headers (`lib/import/analyze.ts`). AI mode is a switch here (see below).
2. **Preview.** Tasks grouped by project with checkboxes (per task and per project), sub-tasks indented, warnings, and options: include completed/canceled (off), skip tasks that already exist (on: same title in the same project, case-insensitive), area for new projects (areas from the file, none, an existing area, or a new one). A generic CSV shows its column mapping, prefilled from the headers.
3. **Import.** Progress bar, then "N tasks and M projects imported" with Open tasks / Import more.

Nothing is written before step 3. The wizard turns the preview into an `ImportPlan` (`planImport.ts`: selection, completed filter, duplicates, parents ordered before children, area choice) and hands it to `App.importTasks`.

## Reading files (`app/src/lib/import/`)

| File | Role |
|---|---|
| `csv.ts` | RFC 4180 reader: quotes, escaped quotes, newlines in fields, BOM, CRLF, `,` `;` tab detected from the header line. |
| `zip.ts` | `fflate`. A `.zip` yields its `.csv` files (Todoist backup, Notion "Markdown & CSV"); nested zips (Notion), `__MACOSX` and Notion `_all.csv` duplicates are skipped; Windows-1252 spreadsheets are decoded. |
| `dates.ts` | ISO, "October 3, 2026", "3 oct 2026", `03/10/2026`, Notion ranges (the end wins), times, and relative words, in en/fr/de/es/pt. Numeric order (day-first or month-first) is inferred from the file, else from the UI language. |
| `todoist.ts` | `TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT, RESPONSIBLE, DATE, DEADLINE, DURATION…`. One file is one project (named after the file). Sections ("Doing", "En cours"… put tasks in progress), notes appended to the task above, `INDENT` makes sub-tasks, CSV priority 4..1 becomes P1..P4, `DATE` or else `DEADLINE` is the due date. |
| `linear.ts` | Issues of a Linear project become a **software** project; loose issues go to a project named after their team, and the team is the area. Status by name then by timestamps (Triage→inbox, Backlog→backlog, Todo→next, In Progress/In Review→in progress, Done→done, Canceled/Duplicate→canceled). Parent issue through the issue ID. Labels, assignee, milestone and the Linear ID go in the description: assignees are not mapped to Prior members. |
| `generic.ts`, `notion.ts` | Any table: columns found by header name in five languages (title, notes, due, priority, status, done, project, labels, parent) and editable in the preview. Notion tweaks: file names lose their 32-hex id, relation cells ("Name (https://www.notion.so/…)") keep the name, the database name is the project when there is no Project column. |
| `text.ts` | A pasted list without AI: bullets, `[ ]`/`[x]`, indentation for sub-tasks, `# Heading` for projects, and what quick add understands (`tomorrow p1`, `Friday 3pm`). |

Every reader returns an `ImportBatch` (`types.ts`): projects, `ImportedTask`s (key, optional `parentKey`, state open/completed/canceled…) and structured `warnings` that the UI words in the user's language. Unreadable dates are kept as `Date: <text>` in the description; repeat phrases ("every monday", "tous les lundis") are kept as `Repeats: <text>` until recurring tasks exist.

**Recurrence hook.** `lib/import/recurrence.ts` exports `toRecurrence(text)`, which returns `null` for now. When `Task.recurrence` lands, implement it there (reuse the quick-add parser or `lib/recurrence.ts`): the importers then set `ImportedTask.recurrence` instead of the description note, `PlanTask.recurrence` carries it, and `App.importTasks` already spreads it into `localStore.saveTask`.

## Persisting (`App.tsx`)

`saveNamedTasks` is the shared part of the assistant's `addAgentTasks` and `importTasks`: it resolves area and project names (creating missing ones), finds a parent by batch `parentKey` or by `parentTitle` in the same project, and saves each task with `localStore.saveTask`. `importTasks` first creates the projects (`addAgentProjects`, with their `projectType`), then the tasks parents first, then one `refresh()` and one `syncNow()` (tasks and workspace). Tasks are saved directly, never through `changeTask`, so imported completed tasks earn no XP and trigger no celebration.

## AI mode ("Organise with Prior AI", Pro)

- The switch is shown to signed-in users only. It reads `GET /v1/agent/hosted` (`entitlement.allowed`, `available`): enabled for Pro, Team, Enterprise and staff; disabled with "Available with Pro" and a link to Plans otherwise; hidden when signed out.
- Free text and files no reader recognises (no title column) are read by the model; known exports are first read by their reader and then cleaned up: the model splits "title — details", infers priority and dates written in words, spots repeat phrases and suggests projects for loose tasks, never overwriting what the file already says.
- The client sends at most 10 sequential requests of at most 12,000 characters to `POST /v1/agent/complete` with `purpose: "import"`, `provider: "hosted"`, `json: true`, with a progress bar and a cancel button. Answers are validated and clamped (priority 1–4, ISO dates, lengths, parents must exist earlier in the same project, at most 2,000 AI tasks). A failed request leaves that part as the reader found it; a refusal (402/429) stops the AI and the preview says so.
- The result lands in the same preview; the user confirms before anything is saved.
- **Server-side**: `import` is in `agentPurposes`; `resolveCompletionRoute` always routes it to Prior AI, so a user's own OpenRouter key never unlocks it, and `hostedAIEntitlement` decides: free accounts get `402 HOSTED_AI_REQUIRES_PLAN`. The model is `AI_MODEL_IMPORT`, defaulting to the mail model. Tests: `hosted_ai_test.go` (routing and entitlement) and `import_ai_integration_test.go` (free 402, Pro 200 with the import model, usage recorded).

## Limits

5,000 tasks per file (warning beyond), 25 MB per file, 200 CSV files per archive. Dropping a CSV is never an upload: files are read in the browser or the desktop webview.
