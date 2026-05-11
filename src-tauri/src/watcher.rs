use notify::{EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Holds the active watcher so it can be replaced when the data dir changes.
/// Dropping the inner watcher stops all watches and causes the event thread to exit.
pub struct WatcherState(pub Mutex<Option<notify::RecommendedWatcher>>);

impl WatcherState {
    pub fn new() -> Self {
        WatcherState(Mutex::new(None))
    }
}

/// Start watching `data_dir`. Replaces any previously active watcher stored in `state`.
pub fn start_file_watcher(app: AppHandle, data_dir: PathBuf, state: &WatcherState) {
    let (tx, rx) = std::sync::mpsc::channel();

    let mut watcher = match notify::recommended_watcher(move |res: Result<notify::Event, _>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("Failed to create file watcher: {}", e);
            return;
        }
    };

    if let Err(e) = watcher.watch(&data_dir, RecursiveMode::Recursive) {
        eprintln!("Failed to watch directory: {}", e);
        return;
    }

    // Replacing the old watcher drops it, which drops its tx clone, causing the
    // old event thread's rx.recv() to return Err and the thread to exit cleanly.
    *state.0.lock().unwrap() = Some(watcher);

    // Spawn a thread to forward watcher events to the frontend.
    std::thread::spawn(move || {
        loop {
            match rx.recv() {
                Ok(event) => handle_event(&app, &data_dir, event),
                Err(_) => break, // watcher was replaced/dropped
            }
        }
    });
}

fn handle_event(app: &AppHandle, data_dir: &PathBuf, event: notify::Event) {
    match event.kind {
        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {
            for path in &event.paths {
                let relative = path
                    .strip_prefix(data_dir)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                if relative.is_empty() || relative.ends_with(".icloud") {
                    continue;
                }

                let _ = app.emit("file-changed", &relative);

                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                if name.contains("conflicted copy") {
                    let _ = app.emit("icloud-conflict", &relative);
                }
            }
        }
        _ => {}
    }
}
