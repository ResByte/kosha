mod commands;
mod search;
mod watcher;

use commands::{app_config_dir, data_dir};
use search::SearchIndex;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use watcher::WatcherState;

pub struct AppSearchIndex(pub Mutex<SearchIndex>);

#[tauri::command]
fn rebuild_search_index(index: State<AppSearchIndex>) -> Result<usize, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.rebuild(&data_dir())
}

#[tauri::command]
fn search_notes(
    query: String,
    limit: Option<usize>,
    index: State<AppSearchIndex>,
) -> Result<Vec<search::SearchResult>, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.search(&query, limit.unwrap_or(20))
}

#[tauri::command]
fn update_search_index(path: String, index: State<AppSearchIndex>) -> Result<(), String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.update_file(&path, &data_dir())
}

#[tauri::command]
fn list_note_titles(index: State<AppSearchIndex>) -> Result<Vec<(String, String)>, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.list_titles()
}

#[tauri::command]
fn find_backlinks(
    note_name: String,
    index: State<AppSearchIndex>,
) -> Result<Vec<search::SearchResult>, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.find_backlinks(&note_name, 50)
}

#[tauri::command]
fn list_all_tags(index: State<AppSearchIndex>) -> Result<Vec<(String, usize)>, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.list_all_tags()
}

#[tauri::command]
fn list_notes_by_tag(
    tag: String,
    index: State<AppSearchIndex>,
) -> Result<Vec<String>, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.list_notes_by_tag(&tag)
}

/// Saves the new data dir to config, rebuilds the search index,
/// restarts the file watcher, and emits `data-dir-changed` to the frontend.
#[tauri::command]
fn change_data_dir(
    path: String,
    app_handle: AppHandle,
    index: State<AppSearchIndex>,
    watcher: State<WatcherState>,
) -> Result<(), String> {
    // 1. Save config
    let mut cfg = commands::read_app_config();
    cfg.data_dir = Some(path.clone());
    commands::write_app_config(&cfg)?;

    // 2. Ensure new data dir exists
    let new_data_dir = std::path::PathBuf::from(&path);
    std::fs::create_dir_all(&new_data_dir).map_err(|e| e.to_string())?;

    // 3. Rebuild search index against new dir
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    match idx.rebuild(&new_data_dir) {
        Ok(count) => println!("Re-indexed {} notes in new data dir", count),
        Err(e) => eprintln!("Failed to re-index after data dir change: {}", e),
    }
    drop(idx);

    // 4. Restart file watcher on new dir
    watcher::start_file_watcher(app_handle.clone(), new_data_dir, &*watcher);

    // 5. Tell the frontend to reload
    app_handle
        .emit("data-dir-changed", &path)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ensure local app config dir exists (~/.kosha/)
    let config_dir = app_config_dir();
    std::fs::create_dir_all(&config_dir).ok();

    let db_path = config_dir.join("search.db");
    let search_index = SearchIndex::new(&db_path).expect("Failed to initialize search index");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppSearchIndex(Mutex::new(search_index)))
        .manage(WatcherState::new())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::list_dir,
            commands::ensure_data_dir,
            commands::create_dir,
            commands::delete_file,
            commands::rename_file,
            commands::trash_file,
            commands::read_settings,
            commands::write_settings,
            commands::write_file_binary,
            commands::get_data_dir,
            rebuild_search_index,
            search_notes,
            update_search_index,
            list_note_titles,
            find_backlinks,
            list_all_tags,
            list_notes_by_tag,
            change_data_dir,
        ])
        .setup(|app| {
            // Rebuild search index on a background thread so the window
            // can open immediately on cold start. Emits `index-ready`
            // (payload: indexed file count) when done.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let index = handle.state::<AppSearchIndex>();
                let idx = match index.0.lock() {
                    Ok(g) => g,
                    Err(e) => { eprintln!("Index mutex poisoned: {}", e); return; }
                };
                match idx.rebuild(&data_dir()) {
                    Ok(count) => {
                        println!("Indexed {} notes", count);
                        let _ = handle.emit("index-ready", count);
                    }
                    Err(e) => eprintln!("Failed to index notes: {}", e),
                }
            });

            // Start file watcher (iCloud + external changes)
            let watcher_handle = app.handle().clone();
            let watcher_state = app.state::<WatcherState>();
            watcher::start_file_watcher(watcher_handle, data_dir(), &*watcher_state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Kosha");
}
