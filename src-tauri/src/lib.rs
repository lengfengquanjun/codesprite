use arboard::Clipboard;
use keyring::Entry;
use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    process::Command,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, State, WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_updater::UpdaterExt;

const APP_DATA_FILE: &str = "codesprite-data-v1.json";
const OPERATION_LOG_FILE: &str = "codesprite-operation.log";
const CREDENTIAL_SERVICE: &str = "CodeSprite";
const MIMO_PAY_AS_YOU_GO_URL: &str = "https://api.xiaomimimo.com/v1";
const MIMO_TOKEN_PLAN_URL: &str = "https://token-plan-cn.xiaomimimo.com/v1";

struct MetricsState(Mutex<System>);
struct StoreState(Mutex<()>);
struct LogState(Mutex<VecDeque<OperationLog>>);
struct SatelliteMenuState(AtomicBool);
struct AiHttpState(reqwest::Client);
struct WidgetDockState(Mutex<Option<WidgetDock>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WidgetEdge { Left, Right, Top, Bottom }

#[derive(Clone, Copy)]
struct WidgetDock {
    edge: WidgetEdge,
    transverse_center: i32,
}

impl WidgetEdge {
    fn as_str(self) -> &'static str {
        match self { Self::Left => "left", Self::Right => "right", Self::Top => "top", Self::Bottom => "bottom" }
    }
}

fn nearest_widget_edge(left: i32, right: i32, top: i32, bottom: i32, threshold: i32) -> Option<WidgetEdge> {
    [(WidgetEdge::Left, left), (WidgetEdge::Right, right), (WidgetEdge::Top, top), (WidgetEdge::Bottom, bottom)]
        .into_iter()
        .min_by_key(|(_, distance)| *distance)
        .filter(|(_, distance)| *distance <= threshold)
        .map(|(edge, _)| edge)
}

fn orb_edge_distances(window_x: i32, window_y: i32, scale: f64, left: i32, top: i32, right: i32, bottom: i32) -> [i32; 4] {
    let center_x = window_x + (60.0 * scale).round() as i32;
    let center_y = window_y + (60.0 * scale).round() as i32;
    let radius = (24.0 * scale).round() as i32;
    [
        (center_x - radius - left).abs(),
        (right - (center_x + radius)).abs(),
        (center_y - radius - top).abs(),
        (bottom - (center_y + radius)).abs(),
    ]
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationLog {
    timestamp: u128,
    level: String,
    area: String,
    action: String,
    message: String,
    details: Option<String>,
    window: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationLogInput {
    level: String,
    area: String,
    action: String,
    message: String,
    details: Option<String>,
    window: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemMetrics {
    cpu_usage: f32,
    memory_usage: f32,
    used_memory_gb: f64,
    total_memory_gb: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortProcess {
    port: u16,
    pid: u32,
    protocol: String,
    address: String,
    process_name: String,
    executable: Option<String>,
    command: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateInfo {
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolWindowSpec {
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    transparent: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SatelliteWindowSpec {
    tool: String,
    title: String,
    offset_x: f64,
    offset_y: f64,
    size: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiProviderConfig {
    id: String,
    protocol: String,
    base_url: String,
    model: String,
    timeout_ms: u64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiChatOptions {
    system_prompt: Option<String>,
    max_completion_tokens: Option<u32>,
    json_object: Option<bool>,
    temperature: Option<f32>,
    top_p: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiEndpointResolution {
    base_url: String,
    credential_kind: String,
}

fn app_data_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(APP_DATA_FILE))
}

fn operation_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(OPERATION_LOG_FILE))
}

fn validate_document_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown" | "txt") {
        return Err("仅支持 Markdown 或 TXT 文档".into());
    }
    Ok(path)
}

#[tauri::command]
fn choose_todo_document(current_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new()
        .set_title("选择或创建 CodeSprite 待办文档")
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name("CodeSprite-待办.md");
    if let Some(current) = current_path.filter(|value| !value.trim().is_empty()) {
        let path = PathBuf::from(current);
        if let Some(parent) = path.parent() { dialog = dialog.set_directory(parent); }
        if let Some(name) = path.file_name().and_then(|value| value.to_str()) { dialog = dialog.set_file_name(name); }
    }
    Ok(dialog.save_file().map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn read_text_document(path: String) -> Result<Option<String>, String> {
    let path = validate_document_path(&path)?;
    if !path.exists() { return Ok(None); }
    let metadata = fs::metadata(&path).map_err(|error| format!("无法读取文档信息：{error}"))?;
    if metadata.len() > 2 * 1024 * 1024 { return Err("文档超过 2MB，已停止读取".into()); }
    fs::read_to_string(path).map(Some).map_err(|error| format!("读取文档失败：{error}"))
}

#[tauri::command]
fn write_text_document(path: String, content: String) -> Result<(), String> {
    if content.len() > 2 * 1024 * 1024 { return Err("文档超过 2MB，已停止写入".into()); }
    let path = validate_document_path(&path)?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| format!("无法创建文档目录：{error}"))?; }
    let temporary = path.with_extension("codesprite.tmp");
    fs::write(&temporary, content.as_bytes()).map_err(|error| format!("写入临时文档失败：{error}"))?;
    fs::copy(&temporary, &path).map_err(|error| format!("保存文档失败：{error}"))?;
    let _ = fs::remove_file(temporary);
    Ok(())
}

#[tauri::command]
fn open_text_document(path: String) -> Result<(), String> {
    let path = validate_document_path(&path)?;
    if !path.exists() { return Err("文档尚未创建".into()); }
    open::that(path).map_err(|error| format!("打开文档失败：{error}"))
}

fn write_json_file(app: &tauri::AppHandle, value: &Value) -> Result<String, String> {
    let payload = serde_json::to_string(value).map_err(|error| error.to_string())?;
    let path = app_data_path(app)?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    fs::write(&temporary, &payload).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::copy(&path, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::copy(&temporary, &path) {
        if backup.exists() {
            let _ = fs::copy(&backup, &path);
        }
        return Err(error.to_string());
    }
    fs::remove_file(temporary).map_err(|error| error.to_string())?;
    Ok(payload)
}

fn append_operation_log(app: &tauri::AppHandle, state: &LogState, input: OperationLogInput) -> Result<(), String> {
    let entry = OperationLog {
        timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        level: input.level,
        area: input.area,
        action: input.action,
        message: input.message,
        details: input.details.map(|value| value.chars().take(1200).collect()),
        window: input.window,
    };
    {
        let mut entries = state.0.lock().map_err(|_| "operation log lock poisoned")?;
        entries.push_back(entry.clone());
        while entries.len() > 500 {
            entries.pop_front();
        }
    }
    let path = operation_log_path(app)?;
    if path.metadata().map(|metadata| metadata.len() > 2_000_000).unwrap_or(false) {
        let rotated = path.with_extension("log.1");
        let _ = fs::remove_file(&rotated);
        fs::rename(&path, rotated).map_err(|error| error.to_string())?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path).map_err(|error| error.to_string())?;
    writeln!(file, "{}", serde_json::to_string(&entry).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

fn credential(provider_id: &str) -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, provider_id).map_err(|error| error.to_string())
}

fn mimo_credential_kind(api_key: &str) -> &'static str {
    let normalized = api_key.trim().to_ascii_lowercase();
    if normalized.starts_with("tp-") { "token-plan" }
    else if normalized.starts_with("sk-") { "pay-as-you-go" }
    else { "unknown" }
}

fn resolve_mimo_base_url(configured_base_url: &str, api_key: &str) -> String {
    let configured = configured_base_url.trim().trim_end_matches('/');
    if configured != MIMO_PAY_AS_YOU_GO_URL && configured != MIMO_TOKEN_PLAN_URL {
        return configured.to_owned();
    }
    match mimo_credential_kind(api_key) {
        "token-plan" => MIMO_TOKEN_PLAN_URL.to_owned(),
        "pay-as-you-go" => MIMO_PAY_AS_YOU_GO_URL.to_owned(),
        _ => configured.to_owned(),
    }
}

#[tauri::command]
fn system_metrics(state: State<'_, MetricsState>) -> Result<SystemMetrics, String> {
    let mut system = state.0.lock().map_err(|_| "system metrics lock poisoned")?;
    system.refresh_cpu_usage();
    system.refresh_memory();
    let total_memory = system.total_memory();
    let used_memory = system.used_memory();
    let memory_usage = if total_memory == 0 {
        0.0
    } else {
        used_memory as f32 / total_memory as f32 * 100.0
    };
    Ok(SystemMetrics {
        cpu_usage: system.global_cpu_usage(),
        memory_usage,
        used_memory_gb: used_memory as f64 / 1024_f64.powi(3),
        total_memory_gb: total_memory as f64 / 1024_f64.powi(3),
    })
}

fn processes_for_port(port: u16) -> Result<Vec<PortProcess>, String> {
    if port == 0 { return Err("端口号必须在 1 到 65535 之间".into()); }
    let sockets = get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        ProtocolFlags::TCP | ProtocolFlags::UDP,
    ).map_err(|error| format!("读取系统端口失败：{error}"))?;
    let system = System::new_all();
    let mut result = Vec::new();
    for socket in sockets {
        let (protocol, address, matches) = match socket.protocol_socket_info {
            ProtocolSocketInfo::Tcp(info) => (
                "TCP",
                info.local_addr.to_string(),
                info.local_port == port && info.state == TcpState::Listen,
            ),
            ProtocolSocketInfo::Udp(info) => ("UDP", info.local_addr.to_string(), info.local_port == port),
        };
        if !matches { continue; }
        for pid in socket.associated_pids {
            if result.iter().any(|item: &PortProcess| item.pid == pid && item.protocol == protocol) { continue; }
            let process = system.process(Pid::from_u32(pid));
            result.push(PortProcess {
                port,
                pid,
                protocol: protocol.into(),
                address: address.clone(),
                process_name: process.map(|value| value.name().to_string_lossy().into_owned()).unwrap_or_else(|| "未知进程".into()),
                executable: process.and_then(|value| value.exe()).map(|value| value.to_string_lossy().into_owned()),
                command: process.map(|value| value.cmd().iter().map(|part| part.to_string_lossy().into_owned()).collect()).unwrap_or_default(),
            });
        }
    }
    result.sort_by_key(|item| item.pid);
    Ok(result)
}

#[tauri::command]
fn inspect_port(port: u16) -> Result<Vec<PortProcess>, String> {
    processes_for_port(port)
}

#[tauri::command]
fn kill_port_process(
    app: tauri::AppHandle,
    log_state: State<'_, LogState>,
    port: u16,
    pid: u32,
) -> Result<(), String> {
    if pid == std::process::id() { return Err("不能结束 CodeSprite 自身进程".into()); }
    let owner = processes_for_port(port)?.into_iter().find(|item| item.pid == pid)
        .ok_or_else(|| "端口归属已经变化，请重新查询后再操作".to_string())?;
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    let process = system.process(Pid::from_u32(pid)).ok_or("进程已经退出")?;
    if !process.kill() { return Err("系统拒绝结束该进程，请尝试以管理员身份运行 CodeSprite".into()); }
    let _ = append_operation_log(&app, &log_state, OperationLogInput {
        level: "warn".into(), area: "port".into(), action: "process.killed".into(),
        message: format!("已结束占用端口 {port} 的进程 {} ({pid})", owner.process_name),
        details: Some(json!({ "port": port, "pid": pid, "protocol": owner.protocol, "executable": owner.executable }).to_string()),
        window: Some("tool-port".into()),
    });
    Ok(())
}

fn validate_update_endpoint(endpoint: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(endpoint.trim()).map_err(|_| "更新地址不是有效 URL".to_string())?;
    if url.scheme() != "https" { return Err("正式更新地址必须使用 HTTPS".into()); }
    let has_template = endpoint.contains("{{");
    if has_template && !(endpoint.contains("{{target}}") && endpoint.contains("{{arch}}") && endpoint.contains("{{current_version}}")) {
        return Err("动态更新地址必须同时包含 {{target}}、{{arch}} 和 {{current_version}}".into());
    }
    Ok(url)
}

#[tauri::command]
async fn check_app_update(app: tauri::AppHandle, endpoint: String) -> Result<Option<AppUpdateInfo>, String> {
    let endpoint = validate_update_endpoint(&endpoint)?;
    let updater = app.updater_builder().endpoints(vec![endpoint]).map_err(|error| error.to_string())?
        .build().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| format!("检查更新失败：{error}"))?;
    Ok(update.map(|value| AppUpdateInfo {
        current_version: value.current_version,
        version: value.version,
        date: value.date.map(|date| date.to_string()),
        body: value.body,
    }))
}

#[tauri::command]
async fn install_app_update(app: tauri::AppHandle, endpoint: String) -> Result<(), String> {
    let endpoint = validate_update_endpoint(&endpoint)?;
    let updater = app.updater_builder().endpoints(vec![endpoint]).map_err(|error| error.to_string())?
        .build().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| format!("检查更新失败：{error}"))?
        .ok_or("当前已经是最新版本")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|error| format!("安装更新失败：{error}"))?;
    app.restart();
}

#[tauri::command]
fn read_app_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app_data_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_app_data(app: tauri::AppHandle, state: State<'_, StoreState>, payload: String) -> Result<(), String> {
    let value = serde_json::from_str::<Value>(&payload).map_err(|error| format!("invalid app data: {error}"))?;
    let _guard = state.0.lock().map_err(|_| "app data lock poisoned")?;
    write_json_file(&app, &value)?;
    app.emit("app-data-changed", ()).map_err(|error| error.to_string())
}

fn merge_app_sections(current: &mut Value, sections: &Value) -> Result<Vec<String>, String> {
    let target = current.as_object_mut().ok_or("stored app data root must be an object")?;
    let updates = sections.as_object().ok_or("sections must be an object")?;
    let mut changed = Vec::new();
    for (key, value) in updates {
        if matches!(key.as_str(), "settings" | "todos" | "clipboard" | "workspaces" | "namingHistory") {
            target.insert(key.clone(), value.clone());
            changed.push(key.clone());
        }
    }
    target.insert("schemaVersion".into(), json!(1));
    Ok(changed)
}

#[tauri::command]
fn update_app_sections(
    app: tauri::AppHandle,
    state: State<'_, StoreState>,
    log_state: State<'_, LogState>,
    sections: Value,
) -> Result<String, String> {
    let _guard = state.0.lock().map_err(|_| "app data lock poisoned")?;
    let path = app_data_path(&app)?;
    let mut current = if path.exists() {
        serde_json::from_str::<Value>(&fs::read_to_string(&path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("invalid stored app data: {error}"))?
    } else {
        json!({ "schemaVersion": 1 })
    };
    let changed = merge_app_sections(&mut current, &sections)?;
    let payload = write_json_file(&app, &current)?;
    let _ = append_operation_log(&app, &log_state, OperationLogInput {
        level: "debug".into(), area: "storage".into(), action: "sections.updated".into(),
        message: format!("已保存 {} 个数据分区", changed.len()), details: Some(changed.join(",")), window: None,
    });
    app.emit("app-data-changed", ()).map_err(|error| error.to_string())?;
    Ok(payload)
}

#[tauri::command]
fn write_operation_log(app: tauri::AppHandle, state: State<'_, LogState>, entry: OperationLogInput) -> Result<(), String> {
    append_operation_log(&app, &state, entry)
}

#[tauri::command]
fn read_operation_logs(app: tauri::AppHandle, state: State<'_, LogState>) -> Result<Vec<OperationLog>, String> {
    let entries = state.0.lock().map_err(|_| "operation log lock poisoned")?;
    if !entries.is_empty() {
        return Ok(entries.iter().cloned().collect());
    }
    drop(entries);
    let path = operation_log_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(content.lines().rev().take(500).filter_map(|line| serde_json::from_str::<OperationLog>(line).ok()).collect::<Vec<_>>().into_iter().rev().collect())
}

#[tauri::command]
fn clear_operation_logs(app: tauri::AppHandle, state: State<'_, LogState>) -> Result<(), String> {
    state.0.lock().map_err(|_| "operation log lock poisoned")?.clear();
    let path = operation_log_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_ai_secret(provider_id: String, api_key: String) -> Result<(), String> {
    if api_key.trim().len() < 12 {
        return Err("API Key 格式不正确".into());
    }
    credential(&provider_id)?.set_password(api_key.trim()).map_err(|error| error.to_string())
}

#[tauri::command]
fn has_ai_secret(provider_id: String) -> Result<bool, String> {
    match credential(&provider_id)?.get_password() {
        Ok(value) => Ok(!value.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_ai_secret(provider_id: String) -> Result<(), String> {
    match credential(&provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn resolve_ai_endpoint(provider_id: String, base_url: String) -> Result<AiEndpointResolution, String> {
    let api_key = credential(&provider_id)?.get_password().map_err(|error| match error {
        keyring::Error::NoEntry => "系统凭据库中没有找到 API Key".into(),
        other => other.to_string(),
    })?;
    Ok(AiEndpointResolution {
        base_url: resolve_mimo_base_url(&base_url, &api_key),
        credential_kind: mimo_credential_kind(&api_key).to_owned(),
    })
}

#[tauri::command]
async fn ai_chat(
    app: tauri::AppHandle,
    log_state: State<'_, LogState>,
    http_state: State<'_, AiHttpState>,
    config: AiProviderConfig,
    prompt: String,
    options: Option<AiChatOptions>,
) -> Result<String, String> {
    let started = SystemTime::now();
    let _ = append_operation_log(&app, &log_state, OperationLogInput {
        level: "info".into(), area: "ai".into(), action: "request.start".into(),
        message: format!("开始连接 {}", config.model),
        details: Some(format!("baseUrl={}, timeoutMs={}", config.base_url, config.timeout_ms)), window: None,
    });
    let result = async {
        if config.protocol != "openai-chat" {
            return Err("暂不支持该 AI 协议".into());
        }
        let api_key = credential(&config.id)?.get_password().map_err(|error| match error {
            keyring::Error::NoEntry => "请先在设置中保存 API Key".into(),
            other => other.to_string(),
        })?;
        let resolved_base_url = resolve_mimo_base_url(&config.base_url, &api_key);
        let credential_kind = mimo_credential_kind(&api_key);
        if resolved_base_url != config.base_url.trim().trim_end_matches('/') {
            let _ = append_operation_log(&app, &log_state, OperationLogInput {
                level: "info".into(), area: "ai".into(), action: "endpoint.auto_selected".into(),
                message: "已根据凭据类型自动选择 MiMo 接口".into(),
                details: Some(format!("credentialKind={credential_kind}, baseUrl={resolved_base_url}")), window: None,
            });
        }
        let endpoint = format!("{resolved_base_url}/chat/completions");
        let options = options.unwrap_or_default();
        let mut messages = Vec::new();
        if let Some(system_prompt) = options.system_prompt.filter(|value| !value.trim().is_empty()) {
            messages.push(json!({ "role": "system", "content": system_prompt }));
        }
        messages.push(json!({ "role": "user", "content": prompt }));
        let mut payload = json!({
            "model": config.model,
            "messages": messages,
            "stream": false,
            "thinking": { "type": "disabled" }
        });
        if let Some(object) = payload.as_object_mut() {
            if let Some(limit) = options.max_completion_tokens {
                object.insert("max_completion_tokens".into(), json!(limit.clamp(16, 1024)));
            }
            if options.json_object.unwrap_or(false) {
                object.insert("response_format".into(), json!({ "type": "json_object" }));
            }
            if let Some(temperature) = options.temperature {
                object.insert("temperature".into(), json!(temperature.clamp(0.0, 1.5)));
            }
            if let Some(top_p) = options.top_p {
                object.insert("top_p".into(), json!(top_p.clamp(0.01, 1.0)));
            }
        }
        let response = http_state.0
            .post(endpoint)
            .timeout(Duration::from_millis(config.timeout_ms.clamp(2_000, 60_000)))
            .header("api-key", &api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("AI 请求失败：{error}"))?;
        let status = response.status();
        let raw = response.text().await.map_err(|error| format!("读取 AI 响应失败：{error}"))?;
        let body = serde_json::from_str::<Value>(&raw).map_err(|error| format!("AI 响应不是合法 JSON（HTTP {status}）：{error}"))?;
        if !status.is_success() {
            let message = body.pointer("/error/message").and_then(Value::as_str).unwrap_or("未知错误");
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(format!("AI 服务返回 {status}：{message}（凭据类型：{credential_kind}，请确认 Key 未过期且套餐有效）"));
            }
            return Err(format!("AI 服务返回 {status}：{message}"));
        }
        body.pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "AI 响应中缺少 choices[0].message.content".into())
    }.await;
    let elapsed = started.elapsed().unwrap_or_default().as_millis();
    match &result {
        Ok(_) => { let _ = append_operation_log(&app, &log_state, OperationLogInput {
            level: "info".into(), area: "ai".into(), action: "request.success".into(),
            message: format!("模型连接成功（{elapsed}ms）"), details: None, window: None,
        }); },
        Err(error) => { let _ = append_operation_log(&app, &log_state, OperationLogInput {
            level: "error".into(), area: "ai".into(), action: "request.failed".into(),
            message: format!("模型连接失败（{elapsed}ms）"), details: Some(error.clone()), window: None,
        }); },
    }
    result
}

#[tauri::command]
fn clear_all_local_data(
    app: tauri::AppHandle,
    store_state: State<'_, StoreState>,
    log_state: State<'_, LogState>,
    provider_ids: Vec<String>,
) -> Result<(), String> {
    let _guard = store_state.0.lock().map_err(|_| "app data lock poisoned")?;
    let path = app_data_path(&app)?;
    for candidate in [&path, &path.with_extension("json.bak"), &path.with_extension("json.tmp")] {
        if candidate.exists() {
            fs::remove_file(candidate).map_err(|error| error.to_string())?;
        }
    }
    for provider_id in provider_ids {
        match credential(&provider_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    log_state.0.lock().map_err(|_| "operation log lock poisoned")?.clear();
    let log_path = operation_log_path(&app)?;
    if log_path.exists() {
        fs::remove_file(log_path).map_err(|error| error.to_string())?;
    }
    if let Some(window) = app.get_webview_window("todo-pinned") {
        let _ = window.close();
    }
    app.emit("app-data-reset", ()).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_clipboard_text() -> Result<Option<String>, String> {
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
    match clipboard.get_text() {
        Ok(text) if !text.trim().is_empty() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn write_clipboard_text(content: String) -> Result<(), String> {
    Clipboard::new().map_err(|error| error.to_string())?.set_text(content).map_err(|error| error.to_string())
}

#[tauri::command]
async fn launch_target(target: String, args: Vec<String>) -> Result<(), String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("启动目标不能为空".into());
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") || trimmed.starts_with("file://") {
        return open::that(trimmed).map_err(|error| error.to_string());
    }
    Command::new(trimmed)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法启动 {trimmed}：{error}"))
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    for window in app.webview_windows().into_values() {
        window.set_always_on_top(enabled).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_main_window(app: tauri::AppHandle, width: f64, height: f64, anchor_from_right: Option<f64>) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("main window not found")?;
    if let Some(anchor) = anchor_from_right {
        resize_around_right_anchor(window, width, height, anchor)
    } else {
        resize_around_center(window, width, height)
    }
}

fn resize_around_right_anchor(window: tauri::WebviewWindow, width: f64, height: f64, anchor_from_right: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let anchor_x = position.x + size.width as i32 - (anchor_from_right * scale).round() as i32;
    let center_y = position.y + size.height as i32 / 2;
    window.set_size(Size::Logical(LogicalSize { width, height })).map_err(|error| error.to_string())?;
    window.set_position(Position::Physical(PhysicalPosition {
        x: anchor_x - ((width - anchor_from_right) * scale).round() as i32,
        y: center_y - (height * scale).round() as i32 / 2,
    })).map_err(|error| error.to_string())
}

fn resize_around_center(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let center_x = position.x + size.width as i32 / 2;
    let center_y = position.y + size.height as i32 / 2;
    window.set_size(Size::Logical(LogicalSize { width, height })).map_err(|error| error.to_string())?;
    window.set_position(Position::Physical(PhysicalPosition {
        x: center_x - (width * scale).round() as i32 / 2,
        y: center_y - (height * scale).round() as i32 / 2,
    })).map_err(|error| error.to_string())
}

fn move_window(window: tauri::WebviewWindow, delta_x: i32, delta_y: i32) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    window.set_position(Position::Physical(PhysicalPosition {
        x: position.x + delta_x,
        y: position.y + delta_y,
    })).map_err(|error| error.to_string())
}

#[tauri::command]
fn move_widget_by(app: tauri::AppHandle, delta_x: i32, delta_y: i32) -> Result<(), String> {
    move_window(app.get_webview_window("main").ok_or("main window not found")?, delta_x, delta_y)
}

#[cfg(windows)]
fn set_window_bounds(window: &tauri::WebviewWindow, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let succeeded = unsafe { SetWindowPos(hwnd.0 as _, std::ptr::null_mut(), x, y, width, height, SWP_NOACTIVATE | SWP_NOZORDER) };
    if succeeded == 0 { Err(std::io::Error::last_os_error().to_string()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn set_window_bounds(window: &tauri::WebviewWindow, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    window.set_size(Size::Physical(tauri::PhysicalSize::new(width as u32, height as u32))).map_err(|error| error.to_string())?;
    window.set_position(Position::Physical(PhysicalPosition { x, y })).map_err(|error| error.to_string())
}

#[tauri::command]
fn snap_widget_to_edge(
    app: tauri::AppHandle,
    state: State<'_, WidgetDockState>,
    log_state: State<'_, LogState>,
    threshold: f64,
) -> Result<Option<String>, String> {
    let window = app.get_webview_window("main").ok_or("main window not found")?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let monitor = window.current_monitor().map_err(|error| error.to_string())?.ok_or("monitor not found")?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let left = monitor_position.x;
    let top = monitor_position.y;
    let right = left + monitor_size.width as i32;
    let bottom = top + monitor_size.height as i32;
    // 主球在 120×120 休眠窗口中以 (60,60) 为圆心、半径 24。
    // 必须使用球体边缘而不是透明 WebView 边缘，否则右侧和底部会多出 36px 透明余量。
    let edge_distances = orb_edge_distances(position.x, position.y, scale, left, top, right, bottom);
    let edge = nearest_widget_edge(
        edge_distances[0], edge_distances[1], edge_distances[2], edge_distances[3],
        (threshold * scale).round() as i32,
    );
    let Some(edge) = edge else {
        *state.0.lock().map_err(|_| "widget dock lock poisoned")? = None;
        return Ok(None);
    };
    let transverse_center = match edge {
        WidgetEdge::Left | WidgetEdge::Right => position.y + size.height as i32 / 2,
        WidgetEdge::Top | WidgetEdge::Bottom => position.x + size.width as i32 / 2,
    };
    *state.0.lock().map_err(|_| "widget dock lock poisoned")? = Some(WidgetDock { edge, transverse_center });
    let line_thickness = (8.0 * scale).round() as i32;
    let line_length = (54.0 * scale).round() as i32;
    let (x, y, width, height) = match edge {
        WidgetEdge::Left => (left, (transverse_center - line_length / 2).clamp(top, bottom - line_length), line_thickness, line_length),
        WidgetEdge::Right => (right - line_thickness, (transverse_center - line_length / 2).clamp(top, bottom - line_length), line_thickness, line_length),
        WidgetEdge::Top => ((transverse_center - line_length / 2).clamp(left, right - line_length), top, line_length, line_thickness),
        WidgetEdge::Bottom => ((transverse_center - line_length / 2).clamp(left, right - line_length), bottom - line_thickness, line_length, line_thickness),
    };
    set_window_bounds(&window, x, y, width, height)?;
    let edge_name = edge.as_str().to_string();
    let _ = app.emit_to("main", "widget-edge-collapsed", edge_name.clone());
    let _ = append_operation_log(&app, &log_state, OperationLogInput {
        level: "info".into(), area: "window".into(), action: "widget.snapped".into(),
        message: format!("水球已吸附到{}边缘", edge.as_str()),
        details: Some(json!({ "edge": edge.as_str(), "orbDistances": edge_distances, "lineBounds": { "x": x, "y": y, "width": width, "height": height } }).to_string()),
        window: Some("main".into()),
    });
    Ok(Some(edge_name))
}

#[tauri::command]
fn reveal_widget_from_edge(app: tauri::AppHandle, state: State<'_, WidgetDockState>, log_state: State<'_, LogState>) -> Result<bool, String> {
    let dock = *state.0.lock().map_err(|_| "widget dock lock poisoned")?;
    let Some(dock) = dock else { return Ok(false); };
    let window = app.get_webview_window("main").ok_or("main window not found")?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let monitor = window.current_monitor().map_err(|error| error.to_string())?.ok_or("monitor not found")?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let left = monitor_position.x;
    let top = monitor_position.y;
    let right = left + monitor_size.width as i32;
    let bottom = top + monitor_size.height as i32;
    let widget_size = (120.0 * scale).round() as i32;
    let (x, y) = match dock.edge {
        WidgetEdge::Left => (left, (dock.transverse_center - widget_size / 2).clamp(top, bottom - widget_size)),
        WidgetEdge::Right => (right - widget_size, (dock.transverse_center - widget_size / 2).clamp(top, bottom - widget_size)),
        WidgetEdge::Top => ((dock.transverse_center - widget_size / 2).clamp(left, right - widget_size), top),
        WidgetEdge::Bottom => ((dock.transverse_center - widget_size / 2).clamp(left, right - widget_size), bottom - widget_size),
    };
    set_window_bounds(&window, x, y, widget_size, widget_size)?;
    let _ = app.emit_to("main", "widget-edge-revealed", dock.edge.as_str());
    let _ = append_operation_log(&app, &log_state, OperationLogInput {
        level: "info".into(), area: "window".into(), action: "widget.revealed".into(),
        message: "鼠标靠近吸边细线，水球已恢复".into(),
        details: Some(json!({ "edge": dock.edge.as_str(), "x": x, "y": y, "size": widget_size }).to_string()),
        window: Some("main".into()),
    });
    Ok(true)
}

#[tauri::command]
fn move_tool_window_by(app: tauri::AppHandle, label: String, delta_x: i32, delta_y: i32) -> Result<(), String> {
    move_window(app.get_webview_window(&label).ok_or("tool window not found")?, delta_x, delta_y)
}

/// 透明工具窗必须跟随实际可见内容调整高度，否则空白透明区域仍会拦截桌面鼠标。
#[tauri::command]
fn resize_tool_window_height(app: tauri::AppHandle, label: String, height: f64) -> Result<(), String> {
    let window = app.get_webview_window(&label).ok_or("tool window not found")?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let current = window.inner_size().map_err(|error| error.to_string())?;
    let width = current.width as f64 / scale;
    window.set_size(Size::Logical(LogicalSize { width, height })).map_err(|error| error.to_string())
}

fn hide_satellite_windows(app: &tauri::AppHandle) -> usize {
    let mut hidden = 0;
    for (label, window) in app.webview_windows() {
        if label.starts_with("satellite-") {
            if window.hide().is_ok() {
                hidden += 1;
            }
        }
    }
    hidden
}

#[cfg(windows)]
fn set_satellite_bounds(window: &tauri::WebviewWindow, x: i32, y: i32, size: i32) -> Result<(), String> {
    set_window_bounds(window, x, y, size, size)
}

#[cfg(not(windows))]
fn set_satellite_bounds(window: &tauri::WebviewWindow, x: i32, y: i32, size: i32) -> Result<(), String> {
    set_window_bounds(window, x, y, size, size)
}

#[tauri::command]
async fn set_satellite_menu(
    app: tauri::AppHandle,
    log_state: State<'_, LogState>,
    menu_state: State<'_, SatelliteMenuState>,
    open: bool,
    items: Vec<SatelliteWindowSpec>,
    always_on_top: bool,
) -> Result<(), String> {
    if !open {
        menu_state.0.store(false, Ordering::SeqCst);
        let hidden = hide_satellite_windows(&app);
        let _ = append_operation_log(&app, &log_state, OperationLogInput {
            level: "info".into(), area: "window".into(), action: "satellites.hidden".into(),
            message: format!("已收起 {hidden} 个功能球"), details: None, window: Some("main".into()),
        });
        app.emit_to("main", "satellite-menu-closed", ()).map_err(|error| error.to_string())?;
        return Ok(());
    }

    let main = app.get_webview_window("main").ok_or("main window not found")?;
    let scale = main.scale_factor().map_err(|error| error.to_string())?;
    let main_position = main.outer_position().map_err(|error| error.to_string())?;
    let main_size = main.outer_size().map_err(|error| error.to_string())?;
    let center_x = main_position.x + main_size.width as i32 / 2;
    let center_y = main_position.y + main_size.height as i32 / 2;
    let monitor_bounds = main.current_monitor().map_err(|error| error.to_string())?.map(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        (position.x, position.y, position.x + size.width as i32, position.y + size.height as i32)
    });

    let mut placements = Vec::new();
    for item in items {
        if !item.tool.chars().all(|character| character.is_ascii_alphanumeric() || character == '-') {
            return Err(format!("invalid satellite tool id: {}", item.tool));
        }
        let label = format!("satellite-{}", item.tool);
        let physical_size = (item.size * scale).round() as i32;
        let mut x = center_x + (item.offset_x * scale).round() as i32 - physical_size / 2;
        let mut y = center_y + (item.offset_y * scale).round() as i32 - physical_size / 2;
        if let Some((left, top, right, bottom)) = monitor_bounds {
            x = x.clamp(left, right - physical_size);
            y = y.clamp(top, bottom - physical_size);
        }
        let window = if let Some(window) = app.get_webview_window(&label) {
            window
        } else {
            WebviewWindowBuilder::new(
                &app,
                &label,
                WebviewUrl::App(format!("index.html?view=satellite&tool={}", item.tool).into()),
            )
            .title(item.title)
            .inner_size(item.size, item.size)
            .min_inner_size(item.size, item.size)
            .max_inner_size(item.size, item.size)
            .transparent(true)
            .decorations(false)
            .resizable(false)
            .always_on_top(always_on_top)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?
        };
        window.set_always_on_top(always_on_top).map_err(|error| error.to_string())?;
        // Windows/winit 对普通窗口施加约 136px 的最小宽度。功能球是无边框桌面组件，
        // 必须通过原生 HWND 强制为配置尺寸，否则透明命中区域仍会形成看不见的矩形遮挡。
        set_satellite_bounds(&window, x, y, physical_size)?;
        window.show().map_err(|error| error.to_string())?;
        placements.push(json!({ "tool": item.tool, "x": x, "y": y, "size": physical_size }));
    }
    menu_state.0.store(true, Ordering::SeqCst);
    let _ = append_operation_log(&app, &log_state, OperationLogInput {
        level: "info".into(), area: "window".into(), action: "satellites.shown".into(),
        message: format!("已展开 {} 个独立功能球窗口", placements.len()),
        details: Some(Value::Array(placements).to_string()), window: Some("main".into()),
    });
    Ok(())
}

#[tauri::command]
async fn open_tool_window(
    app: tauri::AppHandle,
    tool: String,
    title: String,
    spec: ToolWindowSpec,
    always_on_top: bool,
) -> Result<(), String> {
    if let Some(pinned) = app.get_webview_window("todo-pinned") {
        let _ = pinned.hide();
    }
    let label = format!("tool-{tool}");
    if let Some(window) = app.get_webview_window(&label) {
        window.set_always_on_top(always_on_top).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(format!("index.html?tool={tool}").into()))
        .title(title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .center()
        .transparent(spec.transparent)
        .decorations(false)
        .resizable(true)
        .always_on_top(always_on_top)
        .shadow(!spec.transparent)
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn close_tool_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    app.get_webview_window(&label).ok_or("tool window not found")?.close().map_err(|error| error.to_string())?;
    let has_other_tools = app.webview_windows().keys().any(|window_label| window_label.starts_with("tool-") && window_label != &label);
    if !has_other_tools {
        if let Some(pinned) = app.get_webview_window("todo-pinned") {
            let _ = pinned.show();
        }
    }
    Ok(())
}

#[tauri::command]
async fn sync_pinned_todo_window(
    app: tauri::AppHandle,
    log_state: State<'_, LogState>,
    enabled: bool,
    always_on_top: bool,
) -> Result<(), String> {
    const LABEL: &str = "todo-pinned";
    if !enabled {
        if let Some(window) = app.get_webview_window(LABEL) {
            window.close().map_err(|error| error.to_string())?;
        }
        let _ = append_operation_log(&app, &log_state, OperationLogInput {
            level: "info".into(), area: "todo".into(), action: "pinned.closed".into(),
            message: "常驻待办窗口已关闭".into(), details: None, window: Some("main".into()),
        });
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        window.set_always_on_top(always_on_top).map_err(|error| error.to_string())?;
        position_pinned_todo(&app, &window)?;
        window.show().map_err(|error| error.to_string())?;
        let _ = append_operation_log(&app, &log_state, OperationLogInput {
            level: "info".into(), area: "todo".into(), action: "pinned.restored".into(),
            message: "已有常驻待办窗口已重新定位并显示".into(), details: Some(json!({ "alwaysOnTop": always_on_top }).to_string()), window: Some("main".into()),
        });
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?tool=todo&view=pinned".into()))
        .title("今日待办")
        .inner_size(300.0, 220.0)
        .min_inner_size(260.0, 160.0)
        .transparent(true)
        .decorations(false)
        .resizable(true)
        .always_on_top(always_on_top)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    position_pinned_todo(&app, &window)?;
    window.show().map_err(|error| error.to_string())?;
    let _ = append_operation_log(&app, &log_state, OperationLogInput {
        level: "info".into(), area: "todo".into(), action: "pinned.created".into(),
        message: "常驻待办窗口已创建并显示".into(), details: Some(json!({ "alwaysOnTop": always_on_top }).to_string()), window: Some("main".into()),
    });
    Ok(())
}

fn position_pinned_todo(app: &tauri::AppHandle, pinned: &tauri::WebviewWindow) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("main window not found")?;
    let scale = pinned.scale_factor().map_err(|error| error.to_string())?;
    let pinned_width = (300.0 * scale).round() as i32;
    let monitor = main.current_monitor().map_err(|error| error.to_string())?;
    let (_monitor_left, monitor_top, monitor_right, _monitor_bottom) = if let Some(monitor) = monitor {
        let position = monitor.position();
        let size = monitor.size();
        (position.x, position.y, position.x + size.width as i32, position.y + size.height as i32)
    } else {
        (0, 0, 1920, 1080)
    };
    let x = monitor_right - pinned_width - 24;
    let y = monitor_top + 24;
    pinned.set_position(Position::Physical(PhysicalPosition { x, y })).map_err(|error| error.to_string())
}

fn hide_application_to_tray(app: &tauri::AppHandle) {
    let state = app.state::<SatelliteMenuState>();
    state.0.store(false, Ordering::SeqCst);
    for window in app.webview_windows().into_values() {
        let _ = window.hide();
    }
    let log_state = app.state::<LogState>();
    let _ = append_operation_log(app, &log_state, OperationLogInput {
        level: "info".into(), area: "tray".into(), action: "application.hidden".into(),
        message: "应用界面已关闭，进程继续驻留系统托盘".into(), details: None, window: Some("main".into()),
    });
}

fn show_main_from_tray(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        let _ = app.emit_to("main", "tray-main-restored", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ai_http_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(60))
        .build()
        .expect("failed to initialize AI HTTP client");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(MetricsState(Mutex::new(System::new_all())))
        .manage(StoreState(Mutex::new(())))
        .manage(LogState(Mutex::new(VecDeque::new())))
        .manage(SatelliteMenuState(AtomicBool::new(false)))
        .manage(WidgetDockState(Mutex::new(None)))
        .manage(AiHttpState(ai_http_client))
        .setup(|app| {
            let show = MenuItem::with_id(app, "tray-show", "显示水球", true, None::<&str>)?;
            let naming = MenuItem::with_id(app, "tray-tool-naming", "变量命名", true, None::<&str>)?;
            let clipboard = MenuItem::with_id(app, "tray-tool-clipboard", "剪贴板", true, None::<&str>)?;
            let todo = MenuItem::with_id(app, "tray-tool-todo", "待办备忘", true, None::<&str>)?;
            let workspace = MenuItem::with_id(app, "tray-tool-workspace", "工作区", true, None::<&str>)?;
            let port = MenuItem::with_id(app, "tray-tool-port", "端口进程", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "tray-tool-settings", "设置", true, None::<&str>)?;
            let separator_one = PredefinedMenuItem::separator(app)?;
            let separator_two = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "tray-quit", "退出 CodeSprite", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &separator_one, &naming, &clipboard, &todo, &workspace, &port, &settings, &separator_two, &quit])?;
            let mut tray = TrayIconBuilder::with_id("codesprite-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("CodeSprite 程序员工具箱")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-show" => show_main_from_tray(app),
                    "tray-tool-naming" => { let _ = app.emit_to("main", "tray-open-tool", "naming"); },
                    "tray-tool-clipboard" => { let _ = app.emit_to("main", "tray-open-tool", "clipboard"); },
                    "tray-tool-todo" => { let _ = app.emit_to("main", "tray-open-tool", "todo"); },
                    "tray-tool-workspace" => { let _ = app.emit_to("main", "tray-open-tool", "workspace"); },
                    "tray-tool-port" => { let _ = app.emit_to("main", "tray-open-tool", "port"); },
                    "tray-tool-settings" => { let _ = app.emit_to("main", "tray-open-tool", "settings"); },
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main_from_tray(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    hide_application_to_tray(window.app_handle());
                    return;
                }
            }
            if !matches!(event, tauri::WindowEvent::Focused(false)) {
                return;
            }
            let app = window.app_handle().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(160));
                let state = app.state::<SatelliteMenuState>();
                if !state.0.load(Ordering::SeqCst) {
                    return;
                }
                let menu_has_focus = app.webview_windows().iter().any(|(label, candidate)| {
                    (label == "main" || label.starts_with("satellite-"))
                        && candidate.is_focused().unwrap_or(false)
                });
                if menu_has_focus {
                    return;
                }
                state.0.store(false, Ordering::SeqCst);
                let hidden = hide_satellite_windows(&app);
                let log_state = app.state::<LogState>();
                let _ = append_operation_log(&app, &log_state, OperationLogInput {
                    level: "info".into(), area: "window".into(), action: "satellites.focus_lost".into(),
                    message: format!("外部失焦，已收起 {hidden} 个功能球"), details: None, window: Some("main".into()),
                });
                let _ = app.emit_to("main", "satellite-menu-closed", ());
            });
        })
        .invoke_handler(tauri::generate_handler![
            system_metrics, read_app_data, write_app_data, update_app_sections,
            choose_todo_document, read_text_document, write_text_document, open_text_document,
            write_operation_log, read_operation_logs, clear_operation_logs, clear_all_local_data,
            save_ai_secret, has_ai_secret, delete_ai_secret, resolve_ai_endpoint, ai_chat,
            read_clipboard_text, write_clipboard_text, launch_target,
            inspect_port, kill_port_process, check_app_update, install_app_update,
            set_always_on_top, resize_main_window, move_widget_by,
            move_tool_window_by, resize_tool_window_height, set_satellite_menu, open_tool_window, close_tool_window, sync_pinned_todo_window
            , snap_widget_to_edge, reveal_widget_from_edge
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn section_updates_do_not_overwrite_unrelated_data() {
        let mut current = json!({
            "schemaVersion": 1,
            "settings": { "themeId": "violet-nebula", "metric": "cpu" },
            "clipboard": [{ "id": "old" }],
            "todos": [{ "id": "todo-1" }]
        });
        let changed = merge_app_sections(&mut current, &json!({ "clipboard": [{ "id": "new" }] })).unwrap();
        assert_eq!(changed, vec!["clipboard"]);
        assert_eq!(current.pointer("/settings/themeId").and_then(Value::as_str), Some("violet-nebula"));
        assert_eq!(current.pointer("/todos/0/id").and_then(Value::as_str), Some("todo-1"));
        assert_eq!(current.pointer("/clipboard/0/id").and_then(Value::as_str), Some("new"));
    }

    #[test]
    fn unknown_sections_are_ignored() {
        let mut current = json!({ "schemaVersion": 1 });
        let changed = merge_app_sections(&mut current, &json!({ "password": "must-not-be-stored" })).unwrap();
        assert!(changed.is_empty());
        assert!(current.get("password").is_none());
    }


    #[test]
    fn mimo_key_type_selects_matching_official_endpoint() {
        assert_eq!(resolve_mimo_base_url(MIMO_PAY_AS_YOU_GO_URL, "tp-example"), MIMO_TOKEN_PLAN_URL);
        assert_eq!(resolve_mimo_base_url(MIMO_TOKEN_PLAN_URL, "sk-example"), MIMO_PAY_AS_YOU_GO_URL);
        assert_eq!(resolve_mimo_base_url("https://proxy.example/v1", "tp-example"), "https://proxy.example/v1");
    }

    #[test]
    fn update_endpoint_requires_https_and_all_runtime_tokens() {
        assert!(validate_update_endpoint("https://updates.example.com/{{target}}/{{arch}}/{{current_version}}").is_ok());
        assert!(validate_update_endpoint("https://github.com/example/app/releases/latest/download/latest.json").is_ok());
        assert!(validate_update_endpoint("http://updates.example.com/{{target}}/{{arch}}/{{current_version}}").is_err());
        assert!(validate_update_endpoint("https://updates.example.com/{{target}}/latest.json").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn bound_tcp_listener_is_discoverable_by_port() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let port = listener.local_addr().unwrap().port();
        thread::sleep(Duration::from_millis(40));
        let owners = processes_for_port(port).expect("inspect bound port");
        assert!(owners.iter().any(|owner| owner.pid == std::process::id() && owner.protocol == "TCP"));
    }

    #[test]
    fn widget_edge_snap_uses_nearest_edge_within_threshold() {
        assert_eq!(nearest_widget_edge(12, 80, 30, 90, 34), Some(WidgetEdge::Left));
        assert_eq!(nearest_widget_edge(40, 41, 42, 43, 34), None);
        assert_eq!(nearest_widget_edge(20, 18, 60, 70, 34), Some(WidgetEdge::Right));
    }

    #[test]
    fn orb_touching_right_edge_has_zero_distance_despite_transparent_window_margin() {
        // 120px 窗口位于 x=1836 时，48px 水球右沿正好是 1920；窗口右沿则越界 36px。
        let distances = orb_edge_distances(1836, 400, 1.0, 0, 0, 1920, 1080);
        assert_eq!(distances[1], 0);
        assert_eq!(nearest_widget_edge(distances[0], distances[1], distances[2], distances[3], 34), Some(WidgetEdge::Right));
    }
}
