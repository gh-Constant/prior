# Prior Notes — implementation plan

Status: proposed plan, 2026-09-17. No application implementation is included.

## Product direction

Add Notes beside All tasks, Eisenhower, and Habits. Reproduce the recognizable Obsidian workspace and Markdown editing experience: nested file explorer, multiple open notes, Live Preview, source editing, reading mode, attachments, internal links, and a quiet writing surface. Adapt the same experience to touch and small screens.

Confirmed user choice: Prior owns the local note library and optionally syncs it through the existing account. Support importing and exporting Obsidian-compatible Markdown folders and attachments. Directly editing an existing filesystem vault is a separate possible extension; it requires file watching, external-edit reconciliation, and platform-specific permissions.

The release described here includes every explicitly requested capability. Implementation phases are checkpoints, not a reason to ship without mobile support, uploads, math, diagrams, or folders. Build the interaction and visual design within Prior; use its own branding and assets.

## Existing repository findings

| Area | Current implementation | Consequence for Notes |
| --- | --- | --- |
| Navigation | app/src/components/AppSidebar.tsx has three WorkspaceView values | Add notes and a note icon; change the navigation label from Task views to Workspace views. |
| Shell | app/src/App.tsx owns header actions, global shortcuts, filtering, and sync | Give Notes its own workspace and creation action. Scope keyboard handling so editing cannot trigger task actions or dismiss unrelated UI. |
| Local persistence | app/src/lib/localStore.ts uses native SQLite and browser localStorage | Keep task/habit storage intact. Add transactional note adapters with IndexedDB on web and SQLite on native. |
| Sync | Tasks/habits use snapshot mutations, an outbox, revisions, and WebSocket invalidation | Reuse authentication and invalidation, with a separate notes cursor/outbox and conflict-aware protocol. |
| Uploads | No attachment service found; server/internal/httpapi/server.go applies a global 1 MiB body limit | Introduce dedicated media transfers and route-specific limits; do not put video bytes in JSON sync. |
| Native | SQLite migrations registered in app/src-tauri/src/lib.rs; current latest is 003 | Add and register the next migrations; add scoped attachment filesystem/picker access. |
| Server | PostgreSQL migrations currently end at 005_task_details.sql | Add the next numbered migration and focused notes/attachment store and API modules. |
| Browser offline | No service worker, manifest, or app-shell cache found in the inspected client | Add an offline web shell, including lazy editor/rendering assets, if Notes must reopen without a network. |
| Rendering | No Markdown editor/rendering packages in app/package.json | Introduce a dedicated editor and shared renderer. |
| Appearance | app/src/index.css currently uses DM Sans, warm paper, charcoal navigation, coral accent | Follow actual CSS tokens. specs/DESIGN.md still describes a blue accent and should be reconciled during implementation. |
| Native media policy | tauri.conf.json has a restrictive CSP without the required media/blob/frame allowances | Add explicit rules for supported media sources, workers, and approved embeds. |
| Releases | Current workflow ships macOS, Windows, Linux, and Android | Include those native targets plus desktop/mobile browsers. Native iOS distribution would be a separate release-platform task. |

## Workspace and visual design

Desktop/wide web layout:

    Prior navigation | Files / Search | Note tabs                   | Inspector
                     |               | Folder breadcrumb   Actions | Outline
                     | Projects      |                             | Backlinks
                     |   Research    | Note title                  | Properties
                     |     Ideas     |                             |
                     |   Journal     | Markdown writing surface    |
                     |               |                             |
                     | Trash         | Saved locally / Sync status |

Use a 220–280 px resizable explorer, a comfortable 680–800 px writing column, and an optional 240–300 px inspector. Adjust by available workspace width, including the existing AI panel. Keep at least 480 px for the editor before showing additional permanent panes; use drawers below that. Restore panel sizes, selected note, open tabs, scroll, and editor mode per device.

Use compact rows, subtle separators, subdued controls, restrained accent color, and generous document spacing. Provide coordinated light/dark/system appearance, including the surrounding shell, menus, math, diagrams, and code. Keep controls visible on focus and touch; no actions available only on hover. Add a focus mode that hides secondary panes.

Desktop supports close/reorder/pin tabs, quick switching, and an optional two-note split view. Both panes share one underlying note state when showing the same document. The inspector and AI assistant share the right-side space rather than creating several competing narrow columns. Notes are not automatically sent to the AI assistant.

On phones, show a full-width editor, a Files/Search drawer, a compact open-note switcher, and a bottom formatting/attachment toolbar above the keyboard. Folder operations use a touch menu and Move to dialog as well as desktop drag/drop. Android Back and browser Back dismiss overlays first, then navigate note history. Respect safe areas, keyboard resize, orientation changes, and 44 px touch targets. On tablets, show the explorer when there is room; the inspector remains optional.

Accessibility includes keyboard tree navigation, labeled controls, visible focus, predictable focus restoration, screen-reader status announcements, reduced motion, and an accessible list alternative to the graph.

## Required feature scope

| Capability | Release behavior |
| --- | --- |
| Notes and folders | Create, rename, duplicate, move, sort, and trash notes; nested folders and subfolders; restore deleted trees; favorites and recent notes. |
| Markdown editing | Live Preview by default, explicit Source and Reading modes, undo/redo, find/replace, keyboard shortcuts, and formatting toolbar. |
| Standard formatting | Headings, emphasis, lists, nested checklists, links, blockquotes, code with highlighting, tables, footnotes, horizontal rules, and strikethrough. |
| Obsidian-style syntax | Wikilinks, aliases, heading/block links, note/block embeds, highlights, comments, callouts, tags, and preserved YAML frontmatter. |
| Images | Paste screenshots, drag/drop, choose files/photos, or use an external URL; inline preview, alt text, width controls, and full-size view. |
| Video | Import local video or paste a direct media URL; inline controls; supported YouTube/Vimeo URL embeds; progress, retry, and useful unsupported-format states. |
| Other attachments | Audio playback and PDF/file attachments using the same pipeline; PDF preview where supported and an Open/download fallback. |
| Math | Inline dollar-delimited and display double-dollar-delimited LaTeX math; editable source and readable rendering. This is math notation, not a complete LaTeX document compiler. |
| Diagrams/charts | Mermaid fenced blocks, including flowcharts, sequences, timelines, Gantt, and supported chart types; pan/zoom or full-screen view for large diagrams. |
| Connected notes | Wikilink autocomplete, backlinks, outline, missing-note creation, local and whole-library link graphs, and folder/tag filtering. |
| Search | Search titles, body text, tags, and folders offline; snippets and highlighted matches; quick note switcher. |
| Persistence | Autosave, local recovery/history, optional account sync, explicit conflict recovery, and attachment availability status. |
| Portability | Import .md files or a vault ZIP; export a note or folder/library ZIP with Markdown, folder structure, and attachments. |

The graph of connected notes and Mermaid diagrams are separate features. Both are included so “graphs” covers both interpretations.

Community plugin execution, arbitrary JavaScript/dataview blocks, Canvas/Bases editors, Obsidian Sync integration, multiplayer live editing, publishing, and direct filesystem-vault editing are outside this release. Preserve unsupported imported syntax as text and list skipped files; never silently discard it. Simple reusable note templates can follow once the core workspace is stable.

## Editor and renderer

Use CodeMirror 6 with its Markdown language support for source text, selections, history, keyboard behavior, and custom decorations. Live Preview is a custom extension: render inactive Markdown ranges inline, reveal source where the selection is editing, and use widgets for media, math, and diagrams. This interaction must be prototyped on a real mobile keyboard before committing to the full UI. CodeMirror supplies decoration primitives; it does not provide the finished Obsidian editor.

Store Markdown as the canonical body. Do not round-trip through HTML or an editor-specific document format. Preserve frontmatter, whitespace, unknown fenced blocks, and authored syntax. All toolbar and preview interactions create text transactions; checkbox toggles must remain undoable.

Use a shared Markdown pipeline based on remark/rehype, remark-gfm, math support, and explicit extensions for wiki syntax and callouts. React reading mode and CodeMirror preview widgets share link resolution, embed handling, sanitization, and a rendering fixture suite. Avoid regex-only parsing of nested Markdown. Use editor syntax trees and a shared syntax specification to prevent preview/source differences.

Use MathJax for the requested Obsidian-style math compatibility. Bundle required components, extensions, and fonts locally. Use Mermaid for diagrams, loaded only when needed, with strict security and bounded rendering. Render syntax errors as a small local error with source available; one bad formula/diagram must not break the note.

Choose pinned dependency versions after checking Node and WebView support. The inspected latest Mermaid documentation currently requires a newer Node baseline than Prior's Node 20 build setup and targets newer browsers. Either pin a verified compatible release or update the toolchain and support baseline deliberately; do not blindly add the latest version.

Keep editor transactions out of the app-wide React render loop. Cache expensive renders by source/theme, cancel stale work, dispose editor instances, and revoke object URLs. Bound recursive note embeds and detect cycles. Pause graph simulation when hidden. Lazy-load Notes, graph, math, and diagram code so the task view stays fast.

## Data and local persistence

Create focused types and repository interfaces under app/src/lib/notes/. Share business rules across platforms; only persistence and file access differ.

| Record | Core fields |
| --- | --- |
| NoteFolder | id, local account scope, parentId or root, name, ordering, createdAt, updatedAt, deletedAt, serverRevision |
| Note | id, local account scope, folderId or root, title, Markdown body, favorite, timestamps, deletedAt, serverRevision, localVersion |
| Attachment | id, local account scope, original filename, MIME, byte size, checksum, dimensions/duration if known, timestamps, remote object key, upload state |
| AttachmentLocal | attachmentId, device-local file/blob locator, cache state, pinned-offline state; never sync device paths |
| NoteLink | source note, target note/attachment or unresolved target, heading/block anchor; derived and rebuildable |
| NoteRevision | noteId, body/title/folder snapshot, timestamp, source revision/device; checkpoints rather than every keystroke |
| NotesOutbox | mutation UUID, entity, payload, base server revision, local version, retry state |
| NotesSyncState | account scope, cursor and protocol version, separate from the task/habit cursor |

Use SQLite metadata/text plus app-private attachment files on native, and IndexedDB records plus blobs/chunks on web. IndexedDB supports larger structured data and files/blobs; browser storage is still subject to quotas and eviction. Request persistent storage where available, surface quota errors, and offer export/storage management. [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Persist note edits and the corresponding outbox update in one transaction. Target a local save within 500 ms of idle; flush on note switch, blur, and app backgrounding, with a bounded periodic checkpoint while continuously typing. Do not depend on unload to finish asynchronous writes. Show Saved locally only after commit, Synced only after server acknowledgement, and keep a recoverable draft on failure.

Use one transactional native command for note/outbox operations if the current SQL plugin abstraction cannot guarantee a transaction on one connection. Attachment file writes use staging and atomic finalize, then a metadata transaction; a startup reconciliation cleans abandoned staging files without deleting referenced data.

Prevent folder cycles and cross-account parents locally and on the server. Normalize names and reject path separators; allow identical note titles in different folders, but require disambiguation within a folder. Resolve concurrent name collisions deterministically without overwriting content. Folder trash/restore applies to a recorded subtree; a concurrently edited descendant must be recovered, not silently deleted. Restoring into a missing parent uses a Recovered folder.

Use stable IDs for note and attachment identity. Store portable wiki/relative link text with a derived resolution index. Prefer explicit folder paths when titles are ambiguous. Rename/move operations update resolved references through the parsed link model, preserving aliases and ignoring code blocks; sync them as a revision-checked operation group. Conflicting reference edits remain recoverable. Export rewrites references to actual relative paths and reports unresolved links.

Account isolation is mandatory: scope notes, outboxes, caches, and attachment files to a user or a local guest library. Cancel old-session transfers on logout/account switch. Guest notes stay in their guest library until an explicit import into the account; never upload one account's local notes to another.

## Sync and recovery

Reuse Prior sessions and the existing WebSocket invalidation connection. Add dedicated POST /v1/notes/sync/push and GET /v1/notes/sync/pull endpoints and a notes cursor. This keeps existing task/habit clients from advancing a shared cursor past note changes they cannot apply. Add an authenticated capability check so new clients can retain local notes safely against an older server.

Each mutation carries an idempotency UUID and base server revision. Apply revision checks and the write atomically on the server, serialize dependent operations, and acknowledge the exact local version submitted. A later local edit must survive the acknowledgement of an earlier snapshot. Coalesce only mutations that have never been submitted; retry an uncertain request with its original immutable UUID and payload.

On a revision mismatch, return the canonical version and preserve the local draft as a named conflict copy/recovery record with an idempotent identifier. Offer Compare, Keep both, or explicitly replace after review. First release prioritizes preserving both versions over automatic text merging. Rejected mutations remain actionable without blocking unrelated notes. Delete-versus-edit conflicts also preserve the edited content.

Pull changes in bounded pages with a stable high-water mark and transactionally advance the cursor only after applying the page. If the cursor is too old, perform a snapshot resync while preserving the local outbox. Keep tombstones and revision history for at least 30 days; older devices use the snapshot recovery path rather than resurrecting deleted data.

Use a separate retryable attachment queue. Text can sync immediately with an attachment-pending state; it must not wait behind a large video. Transfer metadata and bytes separately. Realtime remains an invalidation signal, and reconnect/manual sync always works without it. Coordinate browser tabs with a per-account sync leader/lock and broadcast local updates to avoid conflicting local writers.

Current account sync does not establish Obsidian's end-to-end encrypted sync model. Keep that distinction explicit in product documentation; adding end-to-end encryption would require a separate key-management design. Never log note bodies, media URLs with tokens, or credentials.

## Attachments and media service

1. Paste, drop, or pick a file. Copy it into durable local storage before reporting it attached; insert a stable attachment reference and display the local preview immediately.
2. For an authenticated account, request an upload session from Prior's API. The API checks ownership, MIME/size policy, and available quota and reserves capacity.
3. Upload to private S3-compatible object storage using short-lived upload authorization. Use multipart/resumable transfers for videos; persist progress and renew expired URLs on retry. Provider selection and credentials remain deployment configuration.
4. Finalize only after the server verifies the expected object, byte size, and checksum/type policy. Publish ready metadata through notes sync. Failed/canceled sessions release quota and expire safely.
5. Resolve attachment IDs to short-lived download URLs online or local files/blobs offline. Support byte ranges for video seeking and avoid loading entire remote videos into memory.

Use dedicated binary-transfer code; the current JSON helper and its timeout are unsuitable for media bodies. Configure object-storage CORS, API route limits, and hosting/proxy limits intentionally. Suggested starting configurable limits: 20 MiB per image, 250 MiB per video, 1 MiB Markdown body, 4 MiB notes sync batch, and 1 GiB account attachments. Validate these against the chosen storage budget before release; expose limits before users select files.

Direct HTTPS image/video URLs remain external links; they are not automatically uploaded or available offline. Offer an explicit Save a local copy action where permitted by source access/CORS. YouTube/Vimeo use approved provider URLs and click-to-load embeds; unsupported providers become useful links. No generic server URL-fetch proxy in the first release.

Aim for JPEG/PNG/WebP/GIF images and MP4 with H.264/AAC playback across target devices; test actual codec support. Other imported containers/codecs remain downloadable with an Open externally fallback. Do not promise every MOV/MKV plays on every browser or add a transcoding service implicitly.

Locally added attachments stay available offline. Small synced images can cache automatically within a budget; large videos download on demand or through Make available offline. Evict only downloaded cache copies that are not pinned, never the sole unsynced local original. Provide clear offline/missing/upload-failed states. Revoke transient URLs when replacing or closing previews.

Attachment deletion is reference-aware across active notes, trash, and retained revisions. Garbage collection runs after retention and does not delete an attachment merely because one note was removed. Back up PostgreSQL and object storage together and verify restore references before shipping account media sync.

Render Markdown without executing raw scripts or arbitrary iframes. Validate protocols, sanitize supported HTML/SVG, restrict Mermaid overrides and executable links, and use scoped native paths. CSP must permit required blob/media/worker/font sources and only approved video frame hosts. Authorize every metadata/download/upload operation; object keys alone never grant access.

## Search, history, and import/export

Maintain a rebuildable local search/link index outside the typing path. Start with indexed titles/tags/folders and a worker-maintained body index; add specialized native full-text search only if measurements justify it. Both adapters must return equivalent results. Graph edges come from parsed links, not a separately authored database.

Support import by file selection or ZIP on every platform; directory selection is a progressive enhancement. Preview note/file counts, preserve folder structure, handle duplicate names, bound archive expansion, reject traversal/symlinks, and report unsupported files. Ignore Obsidian plugin/config execution. Resolve media paths and links before committing the import; interrupted imports must resume or roll back cleanly.

Export ordinary .md files plus an attachments directory and relative links, avoiding private Prior URLs or device paths. Include any media necessary for the chosen export, or explicitly report unavailable files. Re-import into Prior and open the fixture in Obsidian as portability checks during implementation.

Keep bounded local revision checkpoints and server history with restore-as-new-revision semantics. Trash defaults to 30-day retention. Restoring a previous body preserves current content in history and restores referenced media when still retained.

## Implementation sequence and gates

| Phase | Deliverable | Exit condition |
| --- | --- | --- |
| 1. Interaction prototype | Notes shell, responsive explorer/editor/inspector, theme samples, CodeMirror Live Preview prototype | Real touch keyboard, selection, undo, mixed media/math, and a long-note fixture work without caret jumps; desktop/phone layouts reviewed. |
| 2. Local foundation | Notes/folders repositories and migrations, account isolation, transactional outbox, autosave, recovery, tabs and trash | Nested CRUD and restart recovery pass on IndexedDB and SQLite; simulated write failures never report Saved. |
| 3. Complete editor | Markdown extensions, math, Mermaid, local image/video insertion, reading/source parity, search and links | Supported syntax fixtures and local attachments work offline on web/native; incomplete syntax cannot break typing. |
| 4. Account/media sync | Notes endpoints, conflict UI/history, upload sessions, private object storage, resumable transfers | Two offline clients reconnect without silent loss; interrupted video resumes; account boundaries and old-client compatibility pass. |
| 5. Knowledge workspace | Backlinks/outline, local/global graph, desktop split, import/export, favorites and touch folder operations | Move/rename preserves links; vault round-trip preserves notes/media; graph and search stay responsive. |
| 6. Cross-platform finish | Offline web shell, mobile refinements, accessibility, performance, storage controls, operational backup checks | Full acceptance matrix passes across shipped native targets and supported browsers; no task/habit regressions. |

These are six implementation milestones, not six small cosmetic changes. The main uncertainty is mobile Live Preview behavior; the second is attachment storage/transfer operations. Complete the prototype and choose the storage deployment before estimating a release date.

## Proposed code boundaries

| Location | Responsibility |
| --- | --- |
| app/src/components/notes/ | NotesWorkspace, explorer, tabs, editor host, reading view, inspector, graph, mobile toolbar, conflict dialog |
| app/src/lib/notes/ | Types, repositories, IndexedDB/SQLite adapters, document operations, sync, links/search, imports/exports, attachment queue |
| app/src/lib/notes/editor/ | CodeMirror extensions, Markdown dialect integration, preview widgets, shared rendering policy |
| app/src/hooks/ | Focused note workspace subscriptions and lifecycle hooks, with cleanup |
| app/src/App.tsx and AppSidebar.tsx | Lazy Notes entry, workspace-specific header actions, scoped shortcuts, history and sync registration |
| app/src-tauri/src/ and capabilities/ | Atomic note writes, app-private attachment access, mobile picker integration, scoped asset serving |
| app/src-tauri/migrations/ | Next SQLite migrations and registered versions |
| server/internal/notes/ | Notes models, validation, folder/link operation contracts |
| server/internal/store/ | Focused notes, revisions, and attachment persistence files |
| server/internal/httpapi/ | Notes sync, media upload/finalize/download authorization, capability discovery |
| server/internal/database/migrations/ | Next PostgreSQL migrations, constraints, indexes, notes change log |
| app/public/, app/vite.config.ts, app/nginx.conf | Offline web-shell support and predictable asset cache/update behavior |

Keep existing task/habit APIs and storage behavior compatible. Update architecture/sync/design specs to distinguish existing behavior from Notes when implementation lands. No AI tools or automatic note access are added by this plan.

## Verification and release criteria

Use Vitest/React Testing Library for parser fixtures, repository contracts, folder operations, editor actions, and component behavior; Go tests with PostgreSQL integration fixtures for server concurrency and authorization; Rust tests for native path/transaction boundaries. Add browser end-to-end coverage for workflows that depend on real selection, IndexedDB, uploads, and browser history. JSDOM alone cannot validate editor layout or mobile keyboards.

Required acceptance scenarios:

- Create Projects / Research / Drafts offline, add several notes, move a subtree, restart, and recover the same hierarchy and contents.
- Write a note mixing tables, code, callouts, wikilinks, block embeds, inline/display math, Mermaid, an uploaded image, and a local video. Switch editor modes without changing its Markdown unexpectedly.
- Paste a screenshot, select phone photos/video, drag files on desktop, insert external media URLs, cancel/retry upload, and seek remote video. Verify all states on the actual platform.
- Edit one note offline on two devices, including concurrent rename/delete cases; reconnect and retain both edits with a clear conflict resolution path.
- Crash or close during save/upload, retry an acknowledged-but-lost request, fill storage, and expire authorization. Never lose confirmed local data or upload under a different account.
- Upgrade from the existing app/database, connect an old client alongside a new client, and roll back the client. Existing tasks and habits remain usable; note tables and files are retained.
- Import/export nested Markdown and attachments, duplicate filenames, non-ASCII names, malformed archives, missing targets, and unsupported plugin blocks.
- Reopen the previously cached web app offline, including a note requiring lazy math/diagram assets. First-ever offline visits and uncached external media have explicit limits.
- Exercise phone keyboard resize, IME composition, dictation, selection handles, autocorrect, screen readers, text zoom, browser Back, Android Back, and tablet rotation.
- Exercise 5,000-note libraries, 100,000-character notes, a large Markdown import, many linked notes, and 250 MiB video transfers. Proposed targets: warm local note switch under 200 ms, title search under 150 ms, typing response under 50 ms on named reference devices. Measure and tune; these are targets, not current guarantees.

Test Chrome, Firefox, Safari, Android Chrome/WebView, iPhone/iPad Safari, and shipped macOS/Windows/Linux Tauri WebViews. Native iOS is not implied by the current release workflow.

Run the smallest relevant checks in each phase, then typecheck, client tests/build, Go formatting/vet/tests/build, and relevant native builds for the final change. Review light/dark layouts at 360, 390, 768, 1180, and 1440 px and with the AI panel open. No Roblox Studio testing applies to this project.

Roll out additive database/API support first, verify object storage and backups, then browser and native clients using the established release procedure. Gate the Notes entry on supported server capabilities for account sync while preserving local-only access. The planning task itself performs no deployment or client release.

## Reference basis

Reviewed official Obsidian documentation and its desktop/phone visual example on 2026-09-17. The workspace above is a proposed Prior design informed by those references, not a claim of full Obsidian compatibility.

- [Obsidian desktop and phone visual reference](https://obsidian.md/) — compact explorer, tabs, document/graph panes, restrained typography.
- [Views and editing mode](https://obsidian.md/help/edit-and-read) — source, Live Preview, and reading interactions.
- [File explorer](https://obsidian.md/help/plugins/file-explorer) — folder and file operations.
- [Markdown extensions](https://obsidian.md/help/obsidian-flavored-markdown) — syntax compatibility target.
- [Advanced formatting](https://obsidian.md/help/advanced-syntax) — Mermaid and MathJax-style math.
- [Attachments](https://obsidian.md/help/attachments) and [embedded files](https://obsidian.md/help/embeds) — local media and note embeds.
- [Accepted formats](https://obsidian.md/help/file-formats) — format examples; actual playback must be verified per Prior platform.
- [Graph view](https://obsidian.md/help/plugins/graph) and [mobile reference](https://obsidian.md/mobile) — connected notes and touch adaptation.
- [CodeMirror system guide](https://codemirror.net/docs/guide/) and [official decoration example](https://github.com/codemirror/website/blob/main/site/examples/decoration/index.md) — editor primitives for the proposed custom Live Preview.
- [remark-gfm](https://github.com/remarkjs/remark-gfm), [React Markdown](https://github.com/remarkjs/react-markdown), [MathJax components](https://docs.mathjax.org/en/latest/web/start.html), and [Mermaid usage](https://mermaid.js.org/config/usage.html) — rendering implementation candidates and runtime constraints.
