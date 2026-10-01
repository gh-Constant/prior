# Kanban

One generic board, `components/kanban/KanbanBoard.tsx`, renders every Kanban in the app:

- the Board tab of standard and software projects (`ProjectTaskBoard`, columns are statuses),
- the Board tab of shared agile projects (`ProjectCollaboration`, columns are workflow states),
- the **Kanban** layout of All tasks and My tasks (`TasksKanban`, columns depend on "Group by").

The board is state-driven: it receives `columns` (id, label, glyph, items, `canAdd`, `canDrop`, `previewCount`), a `renderCard` and `onMove(itemId, columnId)`, and keeps no data. Cards are drawn by the caller; `KanbanTaskCard` is the task card (completion circle, title, priority, due chip, project chip, checklist progress, blocked badge, assignee). Recurrence is not shown yet.

## Moving cards

Drag and drop uses Pointer Events, so one code path serves mouse, pen and touch.

- **Mouse and pen**: the drag starts after 4px of movement. A floating copy of the card follows the pointer, the column under it is highlighted with a drop slot, and the board auto-scrolls horizontally (and the page vertically) near its edges. Escape cancels; a card that was dragged never also gets the click.
- **Touch**: a ~300ms long-press arms the card (haptic tick, lifted look), then it follows the finger. Moving before the long-press fires means the user is scrolling and nothing starts; once armed, a non-passive `touchmove` listener stops the page from scrolling. A long-press released without moving opens the card menu (a bottom sheet on phones).
- **Keyboard and assistive tech**: the card menu (context-menu key, Shift+F10, right click) always lists "Move to <column>" for every column that accepts cards. Nothing is draggable only.
- Drop targets are the columns and, on phones, the column pills. A rejected move (`changeTask` throws for read-only shared projects) shows its message in a `role="alert"` inside the board.
- The elements that must stay clickable (completion circle, assignee picker) carry `data-kanban-nodrag`.

## Phone layout (up to 760px)

The board is one column per screen (86vw, horizontal `scroll-snap`) with a sticky row of column pills above it (label and count). Tapping a pill scrolls to the column; while a card is being dragged the pills are drop targets, which is the main way to move a card across columns on a phone; the edges also auto-scroll. The board runs edge to edge. The Done column shows its last three cards with a "show more" toggle (`previewCount`).

## Group by (All tasks, My tasks)

`lib/kanban.ts` holds the pure functions (`buildKanbanColumns`, `applyKanbanMove`, `kanbanColumnOf`, tested in `kanban.test.ts`). Layout (`prior.tasks.layout`: list or board) and grouping (`prior.tasks.groupBy`) persist in localStorage.

| Group by | Columns | A drop sets |
| --- | --- | --- |
| Status (default) | In progress, Up next, Inbox, Waiting, Backlog, Done (same statuses as the list) | `status`, and `completed` for Done. With the default "open" filter, Done shows the latest completed tasks |
| Priority | P1 to P4 | `priority` |
| Project | No project, then each project (finished projects only if they hold tasks) | `projectId`; `milestoneId` and `parentId` are cleared because they only make sense inside one project |
| Due date | Overdue, Today, Tomorrow, This week (+2 to +6 days), Later (+7 days or more), No date | Today, Tomorrow, the coming Friday when it falls in +2 to +6 days (else +3 days), +7 days, or no date (and no time). Overdue cannot receive cards |

The List | Kanban toggle is in the page header on desktop (with a segmented "Group by" above the board) and in the top bar on phones (the "Group by" button opens a sheet).
