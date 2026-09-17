use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const SERVER_START_TIMEOUT: Duration = Duration::from_secs(15);
const SHORT_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const TURN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
pub struct CodexState(Mutex<Option<CodexHandle>>);

#[derive(Clone)]
struct CodexHandle {
    requests: Sender<CodexRequest>,
}

enum CodexRequest {
    AccountRead {
        response: Sender<Result<CodexAccount, String>>,
    },
    LoginStart {
        response: Sender<Result<CodexLoginStart, String>>,
    },
    LoginWait {
        login_id: String,
        response: Sender<Result<CodexAccount, String>>,
    },
    Logout {
        response: Sender<Result<CodexAccount, String>>,
    },
    Run {
        request: CodexRunRequest,
        response: Sender<Result<CodexRunResult, String>>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRunRequest {
    pub prompt: String,
    pub history: Vec<CodexHistoryMessage>,
    pub system_prompt: String,
    pub thread_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CodexHistoryMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccount {
    pub available: bool,
    pub authenticated: bool,
    pub auth_mode: Option<String>,
    pub plan_type: Option<String>,
    pub email: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginStart {
    pub login_id: String,
    pub auth_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRunResult {
    pub text: String,
    pub thread_id: String,
    pub actual_model: Option<String>,
}

#[tauri::command]
pub fn codex_account_read(state: tauri::State<'_, CodexState>) -> Result<CodexAccount, String> {
    let requests = state.sender()?;
    let (response, result) = response_channel();
    requests
        .send(CodexRequest::AccountRead { response })
        .map_err(|_| "The Codex connection closed. Try again.".to_string())?;
    receive(result, SHORT_REQUEST_TIMEOUT)
}

#[tauri::command]
pub fn codex_login_start(state: tauri::State<'_, CodexState>) -> Result<CodexLoginStart, String> {
    let requests = state.sender()?;
    let (response, result) = response_channel();
    requests
        .send(CodexRequest::LoginStart { response })
        .map_err(|_| "The Codex connection closed. Try again.".to_string())?;
    receive(result, SHORT_REQUEST_TIMEOUT)
}

#[tauri::command]
pub fn codex_login_wait(
    state: tauri::State<'_, CodexState>,
    login_id: String,
) -> Result<CodexAccount, String> {
    let requests = state.sender()?;
    let (response, result) = response_channel();
    requests
        .send(CodexRequest::LoginWait { login_id, response })
        .map_err(|_| "The Codex connection closed. Try again.".to_string())?;
    receive(result, LOGIN_TIMEOUT)
}

#[tauri::command]
pub fn codex_logout(state: tauri::State<'_, CodexState>) -> Result<CodexAccount, String> {
    let requests = state.sender()?;
    let (response, result) = response_channel();
    requests
        .send(CodexRequest::Logout { response })
        .map_err(|_| "The Codex connection closed. Try again.".to_string())?;
    receive(result, SHORT_REQUEST_TIMEOUT)
}

#[tauri::command]
pub fn codex_run(
    state: tauri::State<'_, CodexState>,
    request: CodexRunRequest,
) -> Result<CodexRunResult, String> {
    let requests = state.sender()?;
    let (response, result) = response_channel();
    requests
        .send(CodexRequest::Run { request, response })
        .map_err(|_| "The Codex connection closed. Try again.".to_string())?;
    receive(result, TURN_TIMEOUT)
}

type ResultReceiver<T> = Receiver<Result<T, String>>;

fn response_channel<T>() -> (Sender<Result<T, String>>, ResultReceiver<T>) {
    mpsc::channel()
}

fn receive<T>(result: ResultReceiver<T>, timeout: Duration) -> Result<T, String> {
    match result.recv_timeout(timeout) {
        Ok(result) => result,
        Err(RecvTimeoutError::Timeout) => {
            Err("Codex took too long to respond. Try again.".to_string())
        }
        Err(RecvTimeoutError::Disconnected) => {
            Err("The Codex connection closed. Try again.".to_string())
        }
    }
}

impl CodexState {
    fn sender(&self) -> Result<Sender<CodexRequest>, String> {
        let mut slot = self
            .0
            .lock()
            .map_err(|_| "The Codex connection is unavailable.".to_string())?;
        if slot.is_none() {
            *slot = Some(CodexHandle::start()?);
        }
        Ok(slot
            .as_ref()
            .expect("Codex handle was initialized above")
            .requests
            .clone())
    }
}

impl CodexHandle {
    fn start() -> Result<Self, String> {
        let (requests, receiver) = mpsc::channel();
        let (ready_sender, ready_receiver) = mpsc::channel();
        thread::Builder::new()
            .name("prior-codex-app-server".to_string())
            .spawn(move || match CodexProcess::spawn() {
                Ok(mut process) => {
                    let _ = ready_sender.send(Ok(()));
                    process.run(receiver);
                }
                Err(error) => {
                    let _ = ready_sender.send(Err(error));
                }
            })
            .map_err(|error| format!("Unable to start the Codex connection: {error}"))?;

        match ready_receiver.recv_timeout(SERVER_START_TIMEOUT) {
            Ok(Ok(())) => Ok(Self { requests }),
            Ok(Err(error)) => Err(error),
            Err(RecvTimeoutError::Timeout) => Err(
                "Codex did not start in time. Check that the Codex CLI is installed.".to_string(),
            ),
            Err(RecvTimeoutError::Disconnected) => {
                Err("The Codex connection could not start.".to_string())
            }
        }
    }
}

struct CodexProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl CodexProcess {
    fn spawn() -> Result<Self, String> {
        let executable = find_codex_executable().ok_or_else(|| {
            "Codex CLI was not found. Install Codex and make sure the `codex` command is available to the desktop app.".to_string()
        })?;
        let mut command = codex_command(&executable);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // App-server uses stdout for JSONL. Discard stderr so a noisy CLI
            // cannot fill an unread pipe and stall the integration.
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Prior could not start Codex: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Prior could not open Codex input.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Prior could not open Codex output.".to_string())?;
        let mut process = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        };

        process.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "prior",
                    "title": "Prior",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
        )?;
        process.notify("initialized", json!({}))?;
        Ok(process)
    }

    fn run(&mut self, receiver: Receiver<CodexRequest>) {
        while let Ok(request) = receiver.recv() {
            match request {
                CodexRequest::AccountRead { response } => {
                    let _ = response.send(self.account_read());
                }
                CodexRequest::LoginStart { response } => {
                    let _ = response.send(self.login_start());
                }
                CodexRequest::LoginWait { login_id, response } => {
                    let _ = response.send(self.login_wait(&login_id));
                }
                CodexRequest::Logout { response } => {
                    let _ = response.send(self.logout());
                }
                CodexRequest::Run { request, response } => {
                    let _ = response.send(self.run_turn(request));
                }
            }
        }
    }

    fn account_read(&mut self) -> Result<CodexAccount, String> {
        let result = self.request("account/read", json!({ "refreshToken": false }))?;
        Ok(account_from_response(&result))
    }

    fn login_start(&mut self) -> Result<CodexLoginStart, String> {
        let result = self.request(
            "account/login/start",
            json!({
                "type": "chatgpt",
                "useHostedLoginSuccessPage": true,
                "appBrand": "chatgpt"
            }),
        )?;
        let login_id = result
            .get("loginId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Codex did not return a login identifier.".to_string())?;
        let auth_url = result
            .get("authUrl")
            .and_then(Value::as_str)
            .filter(|value| value.starts_with("https://") || value.starts_with("http://localhost:"))
            .ok_or_else(|| "Codex did not return a valid sign-in URL.".to_string())?;
        Ok(CodexLoginStart {
            login_id: login_id.to_string(),
            auth_url: auth_url.to_string(),
        })
    }

    fn login_wait(&mut self, login_id: &str) -> Result<CodexAccount, String> {
        loop {
            let message = self.read_message()?;
            if message.get("method").and_then(Value::as_str) != Some("account/login/completed") {
                self.handle_server_request(&message)?;
                continue;
            }
            let params = message.get("params").cloned().unwrap_or(Value::Null);
            if params.get("loginId").and_then(Value::as_str) != Some(login_id) {
                continue;
            }
            if params.get("success").and_then(Value::as_bool) != Some(true) {
                let error = params
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("ChatGPT sign-in was cancelled or failed.");
                return Err(error.to_string());
            }
            return self.account_read();
        }
    }

    fn logout(&mut self) -> Result<CodexAccount, String> {
        self.request("account/logout", json!({}))?;
        self.account_read()
    }

    fn run_turn(&mut self, request: CodexRunRequest) -> Result<CodexRunResult, String> {
        let account = self.account_read()?;
        if account.auth_mode.as_deref() != Some("chatgpt") {
            return Err(
                "Connect Codex with ChatGPT in Settings before using the Codex provider."
                    .to_string(),
            );
        }

        let workspace = codex_workspace()?;
        let thread_id = match request.thread_id.as_deref().filter(|id| !id.is_empty()) {
            Some(thread_id) => thread_id.to_string(),
            None => {
                let result = self.request(
                    "thread/start",
                    json!({
                        "cwd": workspace,
                        "approvalPolicy": "never",
                        "sandbox": "readOnly",
                        "personality": "friendly",
                        "serviceName": "prior"
                    }),
                )?;
                result
                    .get("thread")
                    .and_then(|thread| thread.get("id"))
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| "Codex did not return a conversation identifier.".to_string())?
                    .to_string()
            }
        };

        let turn = self.request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{ "type": "text", "text": build_turn_input(&request) }],
                "cwd": workspace,
                "approvalPolicy": "never",
                "sandboxPolicy": {
                    "type": "readOnly",
                    "access": {
                        "type": "restricted",
                        "includePlatformDefaults": true,
                        "readableRoots": [workspace]
                    }
                },
                "summary": "concise",
                "personality": "friendly",
                "outputSchema": output_schema()
            }),
        )?;
        let turn_id = turn
            .get("turn")
            .and_then(|value| value.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);

        let mut streamed_text = String::new();
        let mut completed_text: Option<String> = None;
        loop {
            let message = self.read_message()?;
            let method = message
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if method == "item/agentMessage/delta" {
                if let Some(delta) = message
                    .get("params")
                    .and_then(|params| params.get("delta"))
                    .and_then(Value::as_str)
                {
                    streamed_text.push_str(delta);
                }
                continue;
            }
            if method == "item/completed" {
                if let Some(item) = message.get("params").and_then(|params| params.get("item")) {
                    if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            completed_text = Some(text.to_string());
                        }
                    }
                }
                continue;
            }
            if method == "turn/completed" {
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                let completed_turn = params.get("turn").cloned().unwrap_or(Value::Null);
                let completed_id = completed_turn.get("id").and_then(Value::as_str);
                if turn_id
                    .as_deref()
                    .is_some_and(|id| completed_id != Some(id))
                {
                    continue;
                }
                let status = completed_turn
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("failed");
                if status != "completed" {
                    return Err(turn_error(
                        &completed_turn,
                        "Codex could not complete the request.",
                    ));
                }
                break;
            }
            self.handle_server_request(&message)?;
        }

        let text = completed_text.unwrap_or(streamed_text);
        if text.trim().is_empty() {
            return Err("Codex returned an empty response. Try again.".to_string());
        }
        Ok(CodexRunResult {
            text,
            thread_id,
            actual_model: None,
        })
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({ "method": method, "id": id, "params": params }))?;
        loop {
            let message = self.read_message()?;
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = message.get("error") {
                    return Err(rpc_error(error));
                }
                return Ok(message.get("result").cloned().unwrap_or(Value::Null));
            }
            self.handle_server_request(&message)?;
        }
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(json!({ "method": method, "params": params }))
    }

    fn send(&mut self, message: Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
        line.push(b'\n');
        self.stdin
            .write_all(&line)
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Could not send a request to Codex: {error}"))
    }

    fn read_message(&mut self) -> Result<Value, String> {
        let mut line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Could not read Codex response: {error}"))?;
        if bytes == 0 {
            let status = self.child.try_wait().ok().flatten();
            let detail = status
                .and_then(|value| value.code())
                .map(|code| format!(" (exit code {code})"))
                .unwrap_or_default();
            return Err(format!(
                "The Codex app-server stopped unexpectedly{detail}."
            ));
        }
        serde_json::from_str(line.trim())
            .map_err(|error| format!("Codex returned invalid JSON: {error}"))
    }

    fn handle_server_request(&mut self, message: &Value) -> Result<(), String> {
        let Some(id) = message.get("id") else {
            return Ok(());
        };
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if method.is_empty() {
            return Ok(());
        }
        let result = if method == "item/permissions/requestApproval" {
            json!({ "permissions": {} })
        } else if method.ends_with("requestApproval") {
            json!({ "decision": "decline" })
        } else if method == "mcpServer/elicitation/request" {
            json!({ "action": "decline", "content": Value::Null })
        } else {
            return self.send_response_error(
                id,
                -32000,
                "Interactive Codex requests are not available in Prior.",
            );
        };
        self.send(json!({ "id": id, "result": result }))
    }

    fn send_response_error(&mut self, id: &Value, code: i64, message: &str) -> Result<(), String> {
        self.send(json!({ "id": id, "error": { "code": code, "message": message } }))
    }
}

impl Drop for CodexProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn account_from_response(response: &Value) -> CodexAccount {
    let account = response.get("account").filter(|value| value.is_object());
    CodexAccount {
        available: true,
        authenticated: account.is_some(),
        auth_mode: account
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
            .map(str::to_string),
        plan_type: account
            .and_then(|value| value.get("planType"))
            .and_then(Value::as_str)
            .map(str::to_string),
        email: account
            .and_then(|value| value.get("email"))
            .and_then(Value::as_str)
            .map(str::to_string),
        error: None,
    }
}

fn turn_error(turn: &Value, fallback: &str) -> String {
    turn.get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| fallback.to_string())
}

fn rpc_error(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Codex rejected the request.");
    if error
        .get("data")
        .and_then(|data| data.get("codexErrorInfo"))
        .and_then(|info| info.get("httpStatusCode"))
        .and_then(Value::as_u64)
        == Some(401)
    {
        return "Codex authentication expired. Reconnect with ChatGPT in Settings.".to_string();
    }
    message.to_string()
}

fn codex_workspace() -> Result<PathBuf, String> {
    let workspace = env::temp_dir().join("prior-codex");
    fs::create_dir_all(&workspace)
        .map_err(|error| format!("Could not prepare the Codex workspace: {error}"))?;
    Ok(workspace)
}

fn build_turn_input(request: &CodexRunRequest) -> String {
    let mut input = String::from(
        "You are the Prior in-app assistant. Follow the Prior application instructions below. Do not run shell commands, edit files, use Codex filesystem tools, or request approvals. Work only from the supplied workspace data. Return only the JSON object required by the Prior output contract; do not add markdown fences or commentary outside it.\n\n",
    );
    input.push_str(&request.system_prompt);
    if !request.history.is_empty() {
        input.push_str("\n\nRECENT CONVERSATION:\n");
        for message in request.history.iter().rev().take(8).rev() {
            input.push('\n');
            input.push_str(if message.role == "assistant" {
                "ASSISTANT: "
            } else {
                "USER: "
            });
            input.push_str(&message.content);
        }
    }
    input.push_str("\n\nCURRENT USER REQUEST:\n");
    input.push_str(&request.prompt);
    input
}

fn output_schema() -> Value {
    let item = json!({ "type": "object", "additionalProperties": true });
    json!({
        "type": "object",
        "properties": {
            "reply": { "type": "string" },
            "areas": { "type": "array", "items": item },
            "projects": { "type": "array", "items": item },
            "tasks": { "type": "array", "items": item },
            "habits": { "type": "array", "items": item },
            "notes": { "type": "array", "items": item },
            "folders": { "type": "array", "items": item }
        },
        "required": ["reply", "areas", "projects", "tasks", "habits", "notes", "folders"],
        "additionalProperties": false
    })
}

fn codex_command(executable: &Path) -> Command {
    if cfg!(target_os = "windows")
        && executable.extension().and_then(|value| value.to_str()) == Some("cmd")
    {
        let mut command = Command::new("cmd.exe");
        command
            .arg("/D")
            .arg("/S")
            .arg("/C")
            .arg(format!("\"{}\" app-server", executable.display()));
        command
    } else {
        let mut command = Command::new(executable);
        command.arg("app-server");
        command
    }
}

fn find_codex_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    let mut add = |path: PathBuf| {
        if !candidates
            .iter()
            .any(|candidate: &PathBuf| candidate == &path)
        {
            candidates.push(path);
        }
    };

    if let Some(path) = env::var_os("PRIOR_CODEX_PATH") {
        add(PathBuf::from(path));
    }
    if let Some(path) = env::var_os("CODEX_INSTALL_DIR") {
        let directory = PathBuf::from(path);
        add(directory.join("codex"));
        add(directory.join("codex.exe"));
    }
    let names: &[&str] = if cfg!(target_os = "windows") {
        &["codex.exe", "codex.cmd", "codex"]
    } else {
        &["codex"]
    };
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            for name in names {
                add(directory.join(name));
            }
        }
    }
    if let Some(home) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        for relative in [
            ".local/bin/codex",
            ".cargo/bin/codex",
            "bin/codex",
            "AppData/Local/Programs/OpenAI/Codex/bin/codex.exe",
            "AppData/Local/Programs/OpenAI/Codex/bin/codex.cmd",
        ] {
            add(home.join(relative));
        }
    }
    for path in [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        "/usr/bin/codex",
    ] {
        add(PathBuf::from(path));
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::{build_turn_input, output_schema, CodexRunRequest};

    #[test]
    fn turn_input_keeps_prior_context_and_recent_history() {
        let request = CodexRunRequest {
            prompt: "Create a task".to_string(),
            system_prompt: "Prior rules".to_string(),
            thread_id: None,
            history: vec![super::CodexHistoryMessage {
                role: "user".to_string(),
                content: "Earlier".to_string(),
            }],
        };
        let input = build_turn_input(&request);
        assert!(input.contains("Prior rules"));
        assert!(input.contains("Earlier"));
        assert!(input.contains("Create a task"));
    }

    #[test]
    fn output_schema_requires_the_prior_collections() {
        let schema = output_schema();
        let required = schema["required"].as_array().expect("required fields");
        assert!(required.iter().any(|field| field == "reply"));
        assert!(required.iter().any(|field| field == "tasks"));
        assert!(required.iter().any(|field| field == "notes"));
    }
}
