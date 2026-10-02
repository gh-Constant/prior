# Prior design

Prior uses a warm paper background, ink-like foreground, a coral accent used sparingly, and four semantic quadrant colors. The mark is a four-cell geometric `P` that remains legible at small sizes.

The interface uses system typography, 100–220ms transitions, visible focus rings, touch targets of at least 44px on mobile, and `prefers-reduced-motion`. It is intentionally not a dashboard: no metrics, greeting, empty-state marketing, or ornamental panels.

## Light and dark

Both themes share one set of CSS tokens in `app/src/index.css`; dark overrides them under `:root[data-theme="dark"]` (warm near-black canvas, surfaces that step up in lightness: well `--surface-2` < `--canvas` < `--panel` < `--raised`, lifted tones for text, deeper shadows with a faint light rim). The dark sidebar rail stays a step below the canvas in both themes. Components use tokens (`--raised` for menus, popovers, modals and toasts; `--on-ink`/`--on-tone` for text on inverted or tone fills; `--seg-active` for selected segments) instead of literal colors; content that is authored for white pages (email HTML) keeps a light `--paper` sheet.

The preference (System, Light, Dark) lives in Settings → General, is stored as `prior.theme` and syncs with the account UI preferences. `public/theme-init.js` sets `<html data-theme>` before the first paint (an external script, so it passes the Tauri CSP), and `lib/theme.ts` keeps the document, `<meta name="theme-color">` and the desktop window theme in step afterwards.

## Phone layout

Phones (viewport up to 760px) get their own shell; above that, nothing changes. The rules live in the `@media (max-width: 760px)` blocks of `index.css`, the component stylesheets and `src/phone.css` (loaded last), and a view only branches in React where the markup differs (`useIsPhone`, `lib/useMediaQuery.ts`).

- **Native feel**: safe-area insets everywhere (`env(safe-area-inset-*)`), `100dvh`, no horizontal page scroll (`overflow-x: clip`), no tap highlight, contained overscroll, inputs at 16px (no iOS zoom) and touch targets of at least 44px. The `--mobile-tabbar-h` and `--mobile-bar-h` variables size the fixed chrome; `--mobile-sticky-top` is where sticky rows (Kanban pills, group headers) stop under it.
- **Tab bar** (`MobileTabBar`): Today, Tasks, a central (+), Projects, More. Calendar and the other views are tiles of the More screen (`MobileMoreScreen`, a two-column grid with a tint per view, Calendar first). Blurred translucent background, hairline top border, an active pill behind the icon. A project page keeps Projects active.
- **Top bar** (`MobileTopBar`): for views without their own phone heading, a sticky bar holds the actions (search, assistant and, for Tasks, the List | Kanban toggle and "Group by") with the large title under it; once the title scrolls away the bar turns translucent and shows the title compactly. The email-verification banner is a single line below the title.
- **Tasks**: search, Filters and Sort share one row (Sort is an icon opening a sheet); the list is edge to edge. Touch swipe on a row (`lib/useRowSwipe.ts`): right past 35% of the width completes (haptic tick at the threshold), left opens the row menu as a sheet; `touch-action: pan-y` keeps vertical scrolling native and reduced motion removes the spring.
- **Assignees**: a task has several (`AssigneeSelect`, a multi-select menu that stays open while members are toggled, assigned people first, 44px rows on phones). Cards and rows show overlapping avatars (`AssigneeStack`, three at most, then a "+N" disc) with the names in the accessible label.
- **Sheets**: `ContextMenu` renders as a bottom action sheet (portalled to `<body>`, grab handle, Cancel), `Modal` dialogs and the task composer are bottom sheets too (the composer is full height with a sticky header and footer lifted above the keyboard through `--keyboard-inset`, `lib/useKeyboardInset.ts`). Swiping down on a handle closes a sheet (`lib/useSheetDrag.ts`).
- **Project page** (`ProjectPhoneHeader`, `ProjectPhoneSummary`, `ProjectPhoneGroups` in `ProjectDetailParts.tsx`; styles in `phone.css`): a sticky navigation bar (back to Projects, the project name once the large title has scrolled away, the members, which open sharing, and "•••" with every secondary action as a sheet), then a compact hero (icon, area, name, two-line description, status and type chips) and one summary card (progress, then due date, cycle and health side by side). The tabs are sticky underline tabs under the bar, so they never look like the Kanban column pills. Phones open on the list (Issues for agile projects), grouped by status in foldable sections with Done folded; the Board tab is the phone Kanban (`specs/KANBAN.md`), opened on its first column with cards. There is no "New task" button: the central (+) of the tab bar creates the task in the open project (an issue in its backlog for agile projects; a plain task when the shared project is read-only). Agile projects keep the leaderboard in their Overview tab.

## Assistant identity

The assistant (product name "Prior AI") is a small character, not a letter: a coral pebble with two glossy eyes, blush cheeks and a gold sprout on top, with a gold four-point spark floating beside it. `components/AgentIdentity.tsx` draws it in pure SVG + CSS (no images, no libraries), crisp from 16px to 160px. Its body is a radial gradient built from `--accent` (`color-mix` toward white and a dark coral), so it follows light, dark and any accent; eyes and mouth use a fixed warm ink so the face reads on every surface, including the always-dark sidebar rail. Sizes: `tiny` (22px, message avatar and rail), `small` (28px, headers and entry points), `hero` (92px, the empty state; it waves once and its eyes follow the pointer while idle). `AgentIdentity` keeps its original props (`thinking`, `size`) and adds `mood` and `wave`; an explicit `mood` wins over `thinking`. Each instance gets its own blink and glance rhythm, so several mascots never blink in unison.

| Mood | When | What it does |
|---|---|---|
| `idle` | Default | Slow breathing, natural blinks, an occasional glance, the sprout sways and the spark twinkles |
| `thinking` | A request is waiting for the model (also `thinking`) | Eyes look up and aside, three sparks orbit the head, the spark spins, a soft coral glow |
| `working` | A stream is writing the answer (Codex) | Eyes sweep as if reading, a gentle bob |
| `happy` | Proposals were applied (about 3 seconds) | Squinting smile, a hop, a burst of sparks |
| `sad` | The assistant reported an error (about 3 seconds) | Drooping eyes, worried brows, one tear |
| `listening` | Dictation is recording | Wide eyes, a pulsing ring |

All motion stops under `prefers-reduced-motion`; each mood still reads from its pose alone (eyes, brows, mouth, orbit position). The sidebar derives the mood (`AgentSidebar.tsx`); other entry points (Today, Mail, the rail, the phone top bar) use the same component.

In the conversation, the empty state greets the user by first name and time of day with four suggestion pills; the "thinking" row (`components/agent/AgentThinking.tsx`) shows the mascot beside a shimmering status line that moves through phases on a timer (the request has no real progress events) and a sketch of the answer to come; a fresh answer eases in block by block. The send button turns into a stop button while a request runs.

### Review panel

What the assistant proposes appears as one "Proposed changes" panel per message (`components/agent/ReviewPanel.tsx`, cards in `ReviewCards.tsx`, diff data in `reviewModel.ts`). Create cards read like Prior task rows (round include check, priority glyph, due chip, project, checklist, assignee, reminder, quadrant, the reasoning as a muted line); edit cards show only the fields that really change as `old → new` rows, the old value struck through and muted, the new one highlighted, using the user's current data for the "before" values. Tasks can be edited in place (title, due date, priority) before they are added. A floating bar at the bottom of the message applies everything ticked ("Apply all" runs areas, projects and folders first, then tasks, habits, notes and finally the edits, one after the other) or dismisses the panel (remembered locally, with "Show again"). An applied card collapses to one line with a check; when everything is applied the panel folds into a green "All applied" summary and the mascot is happy. There is no undo: nothing the assistant proposes can delete data, and applying goes through the same confirm paths as before. On phones the cards are full-width, every target is at least 44px and the apply bar keeps its place above the composer.

`lab.html#agent` (dev only) shows every mood, the thinking row and a review panel with fake handlers.
