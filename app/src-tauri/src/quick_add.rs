//! Desktop quick capture (specs/QUICK_CAPTURE.md): a global shortcut opens a
//! small borderless, always-on-top window that creates a task through the
//! same local store and sync path as the main window. The shortcut lives in
//! Rust so it works while the main window is hidden.
use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

pub const LABEL: &str = "quick-add";

/// The registered quick-add shortcut, if any.
#[derive(Default)]
pub struct QuickAddState(pub Mutex<Option<Shortcut>>);

/// Shows the quick-add window, creating it on first use.
pub fn open<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        return Ok(());
    }
    let window =
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?quick-add=1".into()))
            .title("Prior")
            .inner_size(560.0, 184.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .focused(true)
            .build()?;
    window.set_focus()?;
    Ok(())
}

/// Plugin handler: the quick-add shortcut opens the window on key press.
pub fn handle_shortcut<R: Runtime>(app: &AppHandle<R>, _shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() == ShortcutState::Pressed {
        let _ = open(app);
    }
}

#[tauri::command]
pub fn quick_add_open<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn quick_add_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Registers the shortcut (e.g. "CommandOrControl+Shift+Space"), replacing
/// the previous one; `None` or an empty string turns quick add off.
#[tauri::command]
pub fn quick_add_set_shortcut<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, QuickAddState>,
    shortcut: Option<String>,
) -> Result<(), String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "quick add state unavailable".to_string())?;
    let next = match shortcut.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => {
            Some(Shortcut::from_str(value).map_err(|error| error.to_string())?)
        }
        _ => None,
    };
    if *current == next {
        return Ok(());
    }
    if let Some(previous) = current.take() {
        let _ = app.global_shortcut().unregister(previous);
    }
    if let Some(shortcut) = next {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|error| error.to_string())?;
        *current = Some(shortcut);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_parses() {
        assert!(Shortcut::from_str("CommandOrControl+Shift+Space").is_ok());
        assert!(Shortcut::from_str("Alt+Q").is_ok());
        assert!(Shortcut::from_str("not a shortcut+").is_err());
    }
}
