use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub struct TranscriptPollers {
    pub active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for TranscriptPollers {
    fn default() -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
        }
    }
}

impl TranscriptPollers {
    pub fn stop_all(&self) {
        if let Ok(active) = self.active.lock() {
            for cancel in active.values() {
                cancel.store(true, Ordering::Relaxed);
            }
        }
    }
}

#[tauri::command]
pub fn start_transcript_poll(
    subagent_id: String,
    session_id: String,
    transcript_path: String,
    state: tauri::State<'_, TranscriptPollers>,
    app: AppHandle,
) {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut active) = state.active.lock() {
        active.insert(subagent_id.clone(), cancel.clone());
    }
    std::thread::spawn(move || {
        run_poller(subagent_id, session_id, transcript_path, cancel, app);
    });
}

#[tauri::command]
pub fn stop_transcript_poll(
    subagent_id: String,
    state: tauri::State<'_, TranscriptPollers>,
) {
    if let Ok(mut active) = state.active.lock()
        && let Some(cancel) = active.remove(&subagent_id)
    {
        cancel.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn read_initial_prompt(
    transcript_path: String,
) -> Option<String> {
    let file = std::fs::File::open(&transcript_path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines() {
        let line = line.ok()?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: Value =
            serde_json::from_str(trimmed).ok()?;
        let msg_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if msg_type != "user" {
            continue;
        }
        // String content = user prompt; array content = tool results
        if let Some(text) = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            && !text.is_empty()
        {
            return Some(text.to_string());
        }
    }
    None
}

fn run_poller(
    subagent_id: String,
    session_id: String,
    transcript_path: String,
    cancel: Arc<AtomicBool>,
    app: AppHandle,
) {
    let path = std::path::Path::new(&transcript_path);
    let deadline = Instant::now() + Duration::from_secs(10);

    // Wait up to 10s for the transcript file to appear
    loop {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        if path.exists() {
            break;
        }
        if Instant::now() >= deadline {
            return; // file never appeared — exit silently
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };

    // Seek to EOF so we only pick up new lines from here on
    if file.seek(SeekFrom::End(0)).is_err() {
        return;
    }

    let mut buf = String::new();
    // Tracks open tool calls: tool_use_id → tool_name
    let mut pending_tools: HashMap<String, String> = HashMap::new();

    loop {
        if cancel.load(Ordering::Relaxed) {
            return;
        }

        let mut raw = Vec::new();
        if let Ok(n) = file.read_to_end(&mut raw)
            && n > 0
        {
            buf.push_str(&String::from_utf8_lossy(&raw));
        }

        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf = buf[pos + 1..].to_string();
            if line.is_empty() {
                continue;
            }
            process_line(
                &line,
                &subagent_id,
                &session_id,
                &mut pending_tools,
                &cancel,
                &app,
            );
        }

        std::thread::sleep(Duration::from_secs(1));
    }
}

fn process_line(
    line: &str,
    subagent_id: &str,
    session_id: &str,
    pending_tools: &mut HashMap<String, String>,
    cancel: &AtomicBool,
    app: &AppHandle,
) {
    if cancel.load(Ordering::Relaxed) {
        return;
    }

    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };

    let msg_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if msg_type == "assistant" {
        let Some(content) = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            return;
        };
        for block in content {
            handle_tool_use_block(
                block, subagent_id, session_id, pending_tools, app,
            );
        }
    } else if msg_type == "user" {
        let Some(content) = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            return;
        };
        for block in content {
            handle_tool_result_block(
                block, subagent_id, session_id, pending_tools, app,
            );
        }
    }
}

fn handle_tool_use_block(
    block: &Value,
    subagent_id: &str,
    session_id: &str,
    pending_tools: &mut HashMap<String, String>,
    app: &AppHandle,
) {
    let block_type = block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if block_type != "tool_use" {
        return;
    }

    let tool_name = block
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Skip Task tool to avoid recursion for nested subagents
    if tool_name == "Task" {
        return;
    }

    let tool_use_id = block
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !tool_use_id.is_empty() {
        pending_tools.insert(tool_use_id.to_string(), tool_name.to_string());
    }

    emit_event(
        app,
        subagent_id,
        session_id,
        "tool_start",
        serde_json::json!({ "toolName": tool_name }),
    );
}

fn handle_tool_result_block(
    block: &Value,
    subagent_id: &str,
    session_id: &str,
    pending_tools: &mut HashMap<String, String>,
    app: &AppHandle,
) {
    let block_type = block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if block_type != "tool_result" {
        return;
    }

    let tool_use_id = block
        .get("tool_use_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    pending_tools.remove(tool_use_id);

    emit_event(
        app,
        subagent_id,
        session_id,
        "tool_end",
        serde_json::json!({}),
    );
}

fn emit_event(
    app: &AppHandle,
    subagent_id: &str,
    session_id: &str,
    event_type: &str,
    payload: Value,
) {
    // session_id is the logical session; subagent_id identifies the NPC session
    let _ = session_id;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let event = serde_json::json!({
        "sessionId": subagent_id,
        "timestamp": timestamp,
        "type": event_type,
        "agentType": "claude_code",
        "payload": payload,
    });

    if let Ok(json_str) = serde_json::to_string(&event) {
        let _ = app.emit("agent-event", json_str);
    }
}
