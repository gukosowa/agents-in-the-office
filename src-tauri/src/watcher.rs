use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

const STALE_THRESHOLD: Duration = Duration::from_secs(300);

fn base_dir() -> Option<PathBuf> {
    dirs::home_dir()
        .map(|h| h.join(".agents-in-the-office"))
}

fn process_file(path: &Path, app: &AppHandle) {
    if path.extension().and_then(|e| e.to_str()) != Some("json") {
        return;
    }

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            eprintln!(
                "Failed to read event file {}: {e}",
                path.display()
            );
            return;
        }
    };

    if let Err(e) = app.emit("agent-event", &content) {
        eprintln!("Failed to emit agent-event: {e}");
        return;
    }

    if let Err(e) = fs::remove_file(path)
        && e.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!(
            "Failed to delete event file {}: {e}",
            path.display()
        );
    }
}

fn process_existing_files(dir: &Path, app: &AppHandle) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Failed to read events directory: {e}");
            return;
        }
    };

    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json")
        {
            continue;
        }

        let is_stale = path
            .metadata()
            .and_then(|m| m.modified())
            .map(|modified| {
                now.duration_since(modified).unwrap_or_default()
                    > STALE_THRESHOLD
            })
            .unwrap_or(false);

        if is_stale {
            if let Err(e) = fs::remove_file(&path) {
                eprintln!(
                    "Failed to delete stale file {}: {e}",
                    path.display()
                );
            }
        } else {
            process_file(&path, app);
        }
    }
}

/// Read persistent session state files and emit synthetic
/// `session_start` events so the game spawns NPCs for sessions
/// that were already running before the app (re)started.
fn restore_sessions(sessions_dir: &Path, app: &AppHandle) {
    let entries = match fs::read_dir(sessions_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json")
        {
            continue;
        }

        // Delete session files older than the stale threshold —
        // the real session is certainly dead by then.
        let is_stale = path
            .metadata()
            .and_then(|m| m.modified())
            .map(|modified| {
                now.duration_since(modified).unwrap_or_default()
                    > STALE_THRESHOLD
            })
            .unwrap_or(false);

        if is_stale {
            let _ = fs::remove_file(&path);
            continue;
        }

        // Read the session state and emit it as an agent-event.
        // The frontend's reconnect logic in agentStore handles
        // creating the session + spawning the NPC.
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if let Err(e) = app.emit("agent-session-restore", &content)
        {
            eprintln!("Failed to emit session restore: {e}");
        }
    }
}

pub fn start_watcher(app: &AppHandle) {
    let Some(base) = base_dir() else {
        eprintln!(
            "Failed to determine home directory for events watcher"
        );
        return;
    };

    let events_dir = base.join("events");
    let sessions_dir = base.join("sessions");

    if let Err(e) = fs::create_dir_all(&events_dir) {
        eprintln!(
            "Failed to create events directory {}: {e}",
            events_dir.display()
        );
        return;
    }
    let _ = fs::create_dir_all(&sessions_dir);

    let app = app.clone();
    let watch_dir = events_dir.clone();

    std::thread::spawn(move || {
        // First restore any running sessions, then process
        // leftover event files. Order matters: restore creates
        // sessions, then events update them with latest state.
        restore_sessions(&sessions_dir, &app);
        process_existing_files(&watch_dir, &app);

        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match RecommendedWatcher::new(
            tx,
            notify::Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create file watcher: {e}");
                return;
            }
        };

        if let Err(e) =
            watcher.watch(&watch_dir, RecursiveMode::NonRecursive)
        {
            eprintln!("Failed to watch events directory: {e}");
            return;
        }

        for result in rx {
            match result {
                Ok(event) => {
                    if matches!(
                        event.kind,
                        EventKind::Create(_)
                            | EventKind::Modify(_)
                    ) {
                        for path in &event.paths {
                            process_file(path, &app);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("File watcher error: {e}");
                }
            }
        }
    });
}
