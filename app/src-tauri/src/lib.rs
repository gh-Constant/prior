#[cfg(all(not(desktop), not(target_os = "android")))]
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::Emitter;
#[cfg(any(desktop, target_os = "android"))]
use tauri::Manager;
#[cfg(not(target_os = "android"))]
use tauri::State;
#[cfg(target_os = "android")]
use tauri::{AppHandle, Runtime};

#[cfg(desktop)]
struct SessionState;

#[cfg(all(not(desktop), not(target_os = "android")))]
struct SessionState(Mutex<Option<String>>);

#[cfg(desktop)]
#[tauri::command]
fn session_get(_state: State<'_, SessionState>) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("fr.constantsuchet.prior", "session_token")
        .map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(all(not(desktop), not(target_os = "android")))]
#[tauri::command]
fn session_get(state: State<'_, SessionState>) -> Result<Option<String>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "session state unavailable".to_string())?
        .clone())
}

#[cfg(desktop)]
#[tauri::command]
fn session_set(token: String, _state: State<'_, SessionState>) -> Result<(), String> {
    let entry = keyring::Entry::new("fr.constantsuchet.prior", "session_token")
        .map_err(|error| error.to_string())?;
    entry
        .set_password(&token)
        .map_err(|error| error.to_string())
}

#[cfg(all(not(desktop), not(target_os = "android")))]
#[tauri::command]
fn session_set(token: String, state: State<'_, SessionState>) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "session state unavailable".to_string())? = Some(token);
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn session_clear(_state: State<'_, SessionState>) -> Result<(), String> {
    let entry = keyring::Entry::new("fr.constantsuchet.prior", "session_token")
        .map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(all(not(desktop), not(target_os = "android")))]
#[tauri::command]
fn session_clear(state: State<'_, SessionState>) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "session state unavailable".to_string())? = None;
    Ok(())
}

#[cfg(target_os = "android")]
struct AndroidPluginState<R: Runtime> {
    handle: tauri::plugin::PluginHandle<R>,
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
struct AndroidSessionResult {
    token: Option<String>,
}

#[cfg(target_os = "android")]
fn prior_android_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("prior")
        .setup(|app, api| {
            let handle = api.register_android_plugin("fr.constantsuchet.prior", "PriorPlugin")?;
            app.manage(AndroidPluginState { handle });
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
async fn run_android_plugin<R, T>(
    app: AppHandle<R>,
    command: &str,
    payload: serde_json::Value,
) -> Result<T, String>
where
    R: Runtime,
    T: serde::de::DeserializeOwned,
{
    let handle = app.state::<AndroidPluginState<R>>().handle.clone();
    handle
        .run_mobile_plugin_async(command, payload)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn session_get<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let result: AndroidSessionResult =
        run_android_plugin(app, "get", serde_json::json!({})).await?;
    Ok(result.token)
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn session_set<R: Runtime>(app: AppHandle<R>, token: String) -> Result<(), String> {
    run_android_plugin(app, "set", serde_json::json!({ "token": token })).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn session_clear<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    run_android_plugin(app, "clear", serde_json::json!({})).await
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn widget_set_items<R: Runtime>(app: AppHandle<R>, items: Vec<String>) -> Result<(), String> {
    run_android_plugin(app, "setWidgetItems", serde_json::json!({ "items": items })).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![tauri_plugin_sql::Migration {
        version: 1,
        description: "initial local task store",
        sql: include_str!("../migrations/001_init.sql"),
        kind: tauri_plugin_sql::MigrationKind::Up,
    }];

    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.manage(SessionState);
    #[cfg(all(not(desktop), not(target_os = "android")))]
    let builder = builder.manage(SessionState(Mutex::new(None)));

    #[cfg(target_os = "android")]
    let builder = builder.plugin(prior_android_plugin());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if let Some(url) = argv
            .iter()
            .find(|argument| argument.starts_with("prior://"))
        {
            let _ = app.emit("deep-link://new-url", vec![url]);
        }
    }));

    builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:prior.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_websocket::init())
        .invoke_handler(tauri::generate_handler![
            session_get,
            session_set,
            session_clear,
            #[cfg(target_os = "android")]
            widget_set_items
        ])
        .setup(|_app| {
            #[cfg(desktop)]
            _app.get_webview_window("main")
                .map(|window| window.show())
                .transpose()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Prior");
}
