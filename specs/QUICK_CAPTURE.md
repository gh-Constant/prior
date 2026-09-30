# Quick capture

Adding a task should take one gesture from anywhere: a home-screen widget or launcher shortcut on Android, a global keyboard shortcut on desktop, and the `prior://new-task` deep link everywhere.

## `prior://new-task`

`parseNotificationTarget` (`app/src/lib/reminders.ts`) recognizes `prior://new-task` next to `prior://task/<id>` and `prior://habit/<id>`. `App` opens the new-task composer when it receives it:

| Platform | Delivery |
| --- | --- |
| Android | Intent filter for the `new-task` host in `AndroidManifest.xml`; cold starts through `getCurrent()` of the deep-link plugin, warm starts through `onOpenUrl`. |
| macOS, Windows, Linux | The `prior` scheme registered by the deep-link plugin (`tauri.conf.json`); a second instance forwards its URL through the single-instance plugin. |
| Web | A browser tab cannot receive `prior://`, so the web app accepts the same action as `https://app.prior.constantsuchet.fr/#/new-task`. |

A target that arrives before tasks are loaded waits in `pendingTarget`.

## Android

- **Quick-capture widget** (`QuickCaptureWidget` in `PriorWidget.kt`, Glance, `res/xml/prior_widget_quick_info.xml`): a coral "+" button that opens `prior://new-task`, and the next three Focus/Plan tasks for today. Tapping a row opens `prior://task/<id>`. It reads the same JSON snapshot as the other widgets, which the app writes to `SharedPreferences` (`PriorWidgetStore`) on every local change and sync; the widget never needs the webview to be alive. The snapshot's `focus.items` comes from `focusItems` in `app/src/lib/widgetSnapshot.ts`: the important tasks among today's open tasks (the Today widget's list), Focus (important and urgent) before Plan (important only), then by due date, at most `MAX_FOCUS_ITEMS` (3).
- **App shortcut** (`res/xml/shortcuts.xml`, declared on `MainActivity` with `android.app.shortcuts`): long-pressing the launcher icon offers "New task", which opens `prior://new-task`.
- Widget and shortcut labels are Android string resources in `values`, `values-fr`, `values-de`, `values-es` and `values-pt`.

## Desktop

- The global shortcut is registered in Rust (`app/src-tauri/src/quick_add.rs`, `tauri-plugin-global-shortcut`), so it works while the main window is hidden in the tray. The default is `CommandOrControl+Shift+Space` (⌘⇧Space on macOS, Ctrl+Shift+Space elsewhere).
- Pressing it shows the `quick-add` window: 560×184, borderless, always on top, not in the taskbar, centered, created on first use and then only shown and hidden. It loads `index.html?quick-add=1`, which `main.tsx` renders as `QuickAddWindow` instead of the full app.
- `QuickAddWindow`: a title field, Important and Urgent toggles, Enter saves, Esc closes. It saves through `localStore.saveTask`, the same local store and outbox as the main window, then emits `prior://quick-task-created`; the main window refreshes and syncs, so the task reaches the server through the normal sync path (`Store.Push`).
- The `quick-add` capability (`capabilities/quick-add.json`, desktop platforms only) grants that window the core, window hide/focus/theme and SQL permissions it needs, and nothing else.
- Settings → General → Quick add (`QuickAddSettings`, desktop only): turn the shortcut off, record a new one (at least one modifier; a bare key would steal typing in every app) or reset it. The choice is per device (`prior.quick-add.v1`) and applied with the `quick_add_set_shortcut` command, which unregisters the previous shortcut. A shortcut that cannot be registered (taken by another app, or invalid) shows an error and the previous shortcut is restored.

Rust commands: `quick_add_open`, `quick_add_hide`, `quick_add_set_shortcut` (desktop builds only).
