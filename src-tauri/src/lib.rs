mod audio;
mod transcript;
mod watcher;

#[cfg(target_os = "macos")]
mod macos_focus;

fn append_error_log(message: &str) {
    use std::io::Write;
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let dir = home.join(".agents-in-the-office");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("error.log");
    let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return;
    };
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let _ = writeln!(f, "[{ts}] {message}");
}

#[cfg(target_os = "macos")]
fn activate_app(name: &str) {
    let escaped =
        name.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"tell application "{escaped}" to activate"#,
    );
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();
}

#[tauri::command]
fn focus_terminal_window(
    term_program: String,
    cwd: String,
) {
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(move || {
            let Some(pid) =
                macos_focus::find_pid(&term_program)
            else {
                append_error_log(&format!(
                    "focus_terminal: no process for \
                     '{term_program}'",
                ));
                return;
            };

            // Bring the app to the foreground
            activate_app(&term_program);

            if !macos_focus::ensure_trusted() {
                append_error_log(
                    "focus_terminal: Accessibility \
                     permission not yet granted \
                     — macOS prompt shown",
                );
                return;
            }

            if !macos_focus::raise_window(pid, &cwd) {
                append_error_log(&format!(
                    "focus_terminal: no window matching \
                     cwd={cwd} in '{term_program}' \
                     (pid={pid})",
                ));
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (term_program, cwd);
    }
}

#[tauri::command]
fn allow_file_scope(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    app.fs_scope()
        .allow_file(std::path::PathBuf::from(&path))
        .map_err(|e| format!("scope error: {e}"))
}

#[tauri::command]
fn set_executable(path: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&path, perms)
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(transcript::TranscriptPollers::default())
        .invoke_handler(tauri::generate_handler![
            allow_file_scope,
            set_executable,
            focus_terminal_window,
            transcript::start_transcript_poll,
            transcript::stop_transcript_poll,
            transcript::read_initial_prompt,
            audio::play_sound,
            audio::play_preview,
            audio::stop_preview,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager;
                let pollers =
                    window.state::<transcript::TranscriptPollers>();
                pollers.stop_all();
            }
        })
        .setup(|app| {
            use tauri::{Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

            let window_title = if cfg!(target_os = "macos") {
                ""
            } else {
                "Agents in the Office"
            };

            let win_builder = WebviewWindowBuilder::new(
                app, "main", WebviewUrl::default(),
            )
                .title(window_title)
                .inner_size(1280.0, 800.0)
                .min_inner_size(320.0, 240.0);

            #[cfg(target_os = "macos")]
            let win_builder =
                win_builder.title_bar_style(TitleBarStyle::Overlay);

            let win = win_builder.build()?;

            // On first launch the window-state plugin has no saved
            // state, and .maximized(true) on the builder is unreliable
            // on macOS with overlay title bar. Maximize explicitly.
            let first_launch = app
                .path()
                .app_config_dir()
                .map(|d: std::path::PathBuf| {
                    !d.join(
                        tauri_plugin_window_state::DEFAULT_FILENAME,
                    )
                    .exists()
                })
                .unwrap_or(true);
            if first_launch {
                let _ = win.maximize();
            }

            let audio_handle = audio::init_output_stream();
            app.manage(std::sync::Mutex::new(
                audio::AudioState::new(audio_handle),
            ));

            watcher::start_watcher(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
