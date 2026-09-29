# Prior design

Prior uses a warm paper background, ink-like foreground, a coral accent used sparingly, and four semantic quadrant colors. The mark is a four-cell geometric `P` that remains legible at small sizes.

The interface uses system typography, 100–220ms transitions, visible focus rings, touch targets of at least 44px on mobile, and `prefers-reduced-motion`. It is intentionally not a dashboard: no metrics, greeting, empty-state marketing, or ornamental panels.

## Light and dark

Both themes share one set of CSS tokens in `app/src/index.css`; dark overrides them under `:root[data-theme="dark"]` (warm near-black canvas, surfaces that step up in lightness: well `--surface-2` < `--canvas` < `--panel` < `--raised`, lifted tones for text, deeper shadows with a faint light rim). The dark sidebar rail stays a step below the canvas in both themes. Components use tokens (`--raised` for menus, popovers, modals and toasts; `--on-ink`/`--on-tone` for text on inverted or tone fills; `--seg-active` for selected segments) instead of literal colors; content that is authored for white pages (email HTML) keeps a light `--paper` sheet.

The preference (System, Light, Dark) lives in Settings → General, is stored as `prior.theme` and syncs with the account UI preferences. `public/theme-init.js` sets `<html data-theme>` before the first paint (an external script, so it passes the Tauri CSP), and `lib/theme.ts` keeps the document, `<meta name="theme-color">` and the desktop window theme in step afterwards.
