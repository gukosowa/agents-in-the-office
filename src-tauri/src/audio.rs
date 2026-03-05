use std::fs::File;
use std::io::BufReader;
use std::sync::Mutex;

use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use tauri::{Emitter, Manager};

pub struct AudioState {
    handle: Option<OutputStreamHandle>,
    preview_sink: Option<Sink>,
    preview_generation: u64,
}

impl AudioState {
    pub fn new(handle: Option<OutputStreamHandle>) -> Self {
        Self {
            handle,
            preview_sink: None,
            preview_generation: 0,
        }
    }
}

/// Leak the `OutputStream` so it lives for the process lifetime.
/// Returns `Some(handle)` on success, `None` if no audio device.
pub fn init_output_stream() -> Option<OutputStreamHandle> {
    match OutputStream::try_default() {
        Ok((stream, handle)) => {
            // OutputStream is !Send — leak it so the handle stays valid
            Box::leak(Box::new(stream));
            Some(handle)
        }
        Err(e) => {
            eprintln!("[audio] No audio output device: {e}");
            None
        }
    }
}

#[tauri::command]
pub fn play_sound(
    path: String,
    volume: f32,
    state: tauri::State<'_, Mutex<AudioState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let Some(ref handle) = guard.handle else {
        return Ok(());
    };

    let file = File::open(&path).map_err(|e| {
        format!("Failed to open audio file {path}: {e}")
    })?;
    let reader = BufReader::new(file);
    let source = Decoder::new(reader).map_err(|e| {
        format!("Failed to decode audio file {path}: {e}")
    })?;

    let sink = Sink::try_new(handle).map_err(|e| {
        format!("Failed to create audio sink: {e}")
    })?;
    sink.set_volume(volume);
    sink.append(source);

    let app_handle = app.clone();
    drop(guard);

    std::thread::spawn(move || {
        sink.sleep_until_end();
        let _ = app_handle.emit("sound-ended", ());
    });

    Ok(())
}

#[tauri::command]
pub fn play_preview(
    path: String,
    volume: f32,
    state: tauri::State<'_, Mutex<AudioState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let Some(ref handle) = guard.handle else {
        return Ok(());
    };

    let file = File::open(&path).map_err(|e| {
        format!("Failed to open audio file {path}: {e}")
    })?;
    let reader = BufReader::new(file);
    let source = Decoder::new(reader).map_err(|e| {
        format!("Failed to decode audio file {path}: {e}")
    })?;

    let sink = Sink::try_new(handle).map_err(|e| {
        format!("Failed to create preview sink: {e}")
    })?;
    sink.set_volume(volume);
    sink.append(source);

    // Drop old preview sink (stops previous preview)
    guard.preview_sink = Some(sink);
    guard.preview_generation += 1;
    let generation = guard.preview_generation;

    let app_handle = app.clone();
    drop(guard);

    std::thread::spawn(move || {
        let audio_state = app_handle.state::<Mutex<AudioState>>();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let Ok(guard) = audio_state.lock() else {
                return;
            };
            // Generation changed → new preview replaced us
            if guard.preview_generation != generation {
                return;
            }
            // Sink gone → stopped externally
            let Some(ref sink) = guard.preview_sink else {
                return;
            };
            if sink.empty() {
                drop(guard);
                let _ = app_handle.emit("preview-ended", ());
                return;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_preview(
    state: tauri::State<'_, Mutex<AudioState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.preview_sink = None;
    Ok(())
}
