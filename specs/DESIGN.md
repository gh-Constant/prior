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
- **Sheets**: `ContextMenu` renders as a bottom action sheet (portalled to `<body>`, grab handle, Cancel), `Modal` dialogs and the task composer are bottom sheets too (the composer is full height with a sticky header and footer lifted above the keyboard through `--keyboard-inset`, `lib/useKeyboardInset.ts`). Swiping down on a handle closes a sheet (`lib/useSheetDrag.ts`).
- **Project page**: compact header (icon, name, status and type chips), one action row (New issue, Share, "•••" with the secondary actions), statistics as a swipeable strip of cards, and the tabs as a sticky, scrollable segmented control. The Board tab is the phone Kanban (`specs/KANBAN.md`).
