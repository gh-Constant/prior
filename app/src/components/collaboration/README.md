# Collaboration UI foundation

These components are presentation-only. They do not read stores, send requests,
change access permissions, or persist collaboration fields on `Task` / `Project`.

- `WorkHubView.collaborationByProject[projectId]` renders the default project
  workspace with Overview, Issues, Board and Cycles. The app supplies this
  mapping for every project; server-backed entries additionally provide ACLs,
  members and invitations. Pass `onOpenNotes` to retain a notes entry point in
  the Overview resources card.
- `ProjectCollaboration` accepts issues, workflow states, cycles, optional overview
  metadata and sharing props. It defaults to view-only. Board grouping is display
  only; moving cards and workflow mutations are not implemented.
- `TaskComposer.planning` adds controlled people and collapsed planning controls.
  The parent owns this draft, initializes the authenticated creator as an owner,
  supplies only accessible project members/options, and handles save/cancel/reset.
  People/planning callbacks do not change the existing `onSave(TaskDraft)` payload.
  Use `TaskPlanning` independently in a read-only details drawer. Its `readOnly`
  flag applies only to these controls, not to the rest of `TaskComposer`.
- `ProjectShareDialog` emits invite, role, revoke and copy-link callbacks. Pass
  `busy`, `error`, `notice` and refreshed members/invites from the parent. No
  success is assumed after a callback; an email is retained for retry. Owners
  cannot be demoted in this surface. Invitations are limited to editor/viewer.
- Callback props that are absent disable or omit the corresponding action.
  Project `readOnly` overrides sharing management. Opening an issue remains
  available for viewing; the caller must honor read-only access in its drawer.

UI role restrictions are presentation behavior, not authorization. Future server
integration must validate permissions and referenced IDs independently. Copying a
project link does not grant access. No API, persistence, clipboard or network
behavior is supplied by these components.
