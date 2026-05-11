use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

/// Get the local app config directory (~/.kosha/).
/// This directory is never synced and holds config.json, search.db, settings.json.
/// In tests, KOSHA_TEST_CONFIG_DIR overrides the default location.
pub fn app_config_dir() -> PathBuf {
    #[cfg(test)]
    if let Ok(p) = std::env::var("KOSHA_TEST_CONFIG_DIR") {
        return PathBuf::from(p);
    }
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".kosha")
}

/// Get the config directory (alias for app_config_dir).
pub fn config_dir() -> PathBuf {
    app_config_dir()
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    pub data_dir: Option<String>,
}

/// Get the Kosha data directory (where notes are stored).
/// Priority: KOSHA_TEST_DATA_DIR (tests) > ~/.kosha/config.json > ~/kosha-data default.
pub fn data_dir() -> PathBuf {
    #[cfg(test)]
    if let Ok(p) = std::env::var("KOSHA_TEST_DATA_DIR") {
        return PathBuf::from(p);
    }
    let config_path = app_config_dir().join("config.json");
    if let Ok(content) = fs::read_to_string(&config_path) {
        if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
            if let Some(dir) = cfg.data_dir {
                return PathBuf::from(dir);
            }
        }
    }
    // Default: ~/kosha-data
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join("kosha-data")
}

pub fn read_app_config() -> AppConfig {
    let config_path = app_config_dir().join("config.json");
    if let Ok(content) = fs::read_to_string(&config_path) {
        if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
            return cfg;
        }
    }
    AppConfig::default()
}

pub fn write_app_config(cfg: &AppConfig) -> Result<(), String> {
    let config_dir = app_config_dir();
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_dir.join("config.json"), content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_data_dir() -> String {
    data_dir().to_string_lossy().to_string()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let full_path = data_dir().join(&path);
    fs::read_to_string(&full_path).map_err(|e| format!("Failed to read '{}': {}", path, e))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let full_path = data_dir().join(&path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&full_path, content).map_err(|e| format!("Failed to write '{}': {}", path, e))
}

#[tauri::command]
pub fn write_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    let full_path = data_dir().join(&path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&full_path, &data).map_err(|e| format!("Failed to write binary '{}': {}", path, e))
}

#[tauri::command]
pub fn list_dir(path: Option<String>) -> Result<Vec<FileEntry>, String> {
    let base = data_dir();
    let target = match &path {
        Some(p) if !p.is_empty() => base.join(p),
        _ => base.clone(),
    };

    if !target.exists() {
        fs::create_dir_all(&target).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    read_dir_recursive(&target, &base)
}

fn read_dir_recursive(dir: &Path, base: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    let read = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs, system files
        if name.starts_with('.') {
            continue;
        }
        if name.ends_with(".icloud") {
            continue;
        }

        let relative = path
            .strip_prefix(base)
            .map_err(|_| "Path prefix error".to_string())?
            .to_string_lossy()
            .to_string();

        if path.is_dir() {
            let children = read_dir_recursive(&path, base)?;
            entries.push(FileEntry {
                name,
                path: relative,
                is_dir: true,
                children: Some(children),
            });
        } else if name.ends_with(".md") {
            entries.push(FileEntry {
                name,
                path: relative,
                is_dir: false,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn ensure_data_dir() -> Result<String, String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data directory: {}", e))?;
    // Also ensure config dir exists
    let config = config_dir();
    fs::create_dir_all(&config).map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    let full_path = data_dir().join(&path);
    fs::create_dir_all(&full_path).map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let full_path = data_dir().join(&path);
    if full_path.is_dir() {
        fs::remove_dir_all(&full_path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        fs::remove_file(&full_path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[tauri::command]
pub fn rename_file(from: String, to: String) -> Result<(), String> {
    let from_path = data_dir().join(&from);
    let to_path = data_dir().join(&to);
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::rename(&from_path, &to_path).map_err(|e| format!("Failed to rename file: {}", e))
}

#[tauri::command]
pub fn trash_file(path: String) -> Result<(), String> {
    let full_path = data_dir().join(&path);
    trash::delete(&full_path).map_err(|e| format!("Failed to move '{}' to Trash: {}", path, e))
}

#[tauri::command]
pub fn read_settings() -> Result<serde_json::Value, String> {
    let settings_path = config_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }
    let content =
        fs::read_to_string(&settings_path).map_err(|e| format!("Failed to read settings: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))
}

#[tauri::command]
pub fn write_settings(settings: serde_json::Value) -> Result<(), String> {
    let settings_path = config_dir().join("settings.json");
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&settings_path, content).map_err(|e| format!("Failed to write settings: {}", e))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Creates a TempDir and sets KOSHA_TEST_DATA_DIR + KOSHA_TEST_CONFIG_DIR so both
    /// data_dir() and app_config_dir() point to it.
    /// Returns the TempDir (must be kept alive for the duration of the test).
    fn setup_data_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        std::env::set_var("KOSHA_TEST_DATA_DIR", dir.path().as_os_str());
        std::env::set_var("KOSHA_TEST_CONFIG_DIR", dir.path().as_os_str());
        dir
    }

    fn cleanup_data_dir() {
        std::env::remove_var("KOSHA_TEST_DATA_DIR");
        std::env::remove_var("KOSHA_TEST_CONFIG_DIR");
    }

    // ── File I/O commands (integration, isolated via KOSHA_TEST_DATA_DIR) ─────
    // These tests run single-threaded to avoid env-var race conditions.
    // Run: cargo test -- --test-threads=1

    #[test]
    fn ensure_data_dir_creates_directories() {
        let _dir = setup_data_dir();
        let result = ensure_data_dir().unwrap();
        let base = data_dir();
        assert!(base.exists());
        assert!(config_dir().exists());
        assert_eq!(result, base.to_string_lossy());
        cleanup_data_dir();
    }

    #[test]
    fn write_and_read_file_roundtrip() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        let content = "# Hello\n\nThis is a test note.";
        write_file("test-roundtrip.md".to_string(), content.to_string()).unwrap();
        let read_back = read_file("test-roundtrip.md".to_string()).unwrap();
        assert_eq!(read_back, content);
        cleanup_data_dir();
    }

    #[test]
    fn write_file_creates_parent_directories() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        write_file("subdir/nested/note.md".to_string(), "# Nested".to_string()).unwrap();
        assert!(data_dir().join("subdir/nested/note.md").exists());
        cleanup_data_dir();
    }

    #[test]
    fn read_file_returns_error_for_missing_file() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        let result = read_file("nonexistent.md".to_string());
        assert!(result.is_err());
        cleanup_data_dir();
    }

    #[test]
    fn write_file_binary_writes_bytes() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        let bytes: Vec<u8> = vec![137, 80, 78, 71, 13, 10, 26, 10]; // PNG magic
        write_file_binary("assets/test.png".to_string(), bytes.clone()).unwrap();
        let on_disk = fs::read(data_dir().join("assets/test.png")).unwrap();
        assert_eq!(on_disk, bytes);
        cleanup_data_dir();
    }

    #[test]
    fn create_and_list_dir() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        create_dir("projects".to_string()).unwrap();
        assert!(data_dir().join("projects").is_dir());
        let entries = list_dir(Some("projects".to_string())).unwrap();
        assert!(entries.is_empty()); // newly created dir has no .md files
        cleanup_data_dir();
    }

    #[test]
    fn list_dir_returns_md_files() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        write_file("alpha.md".to_string(), "# Alpha".to_string()).unwrap();
        write_file("beta.md".to_string(), "# Beta".to_string()).unwrap();
        fs::write(data_dir().join("ignore.txt"), "not md").unwrap();
        let entries = list_dir(None).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"alpha.md"));
        assert!(names.contains(&"beta.md"));
        assert!(!names.contains(&"ignore.txt"));
        cleanup_data_dir();
    }

    #[test]
    fn list_dir_sorts_dirs_before_files() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        write_file("note.md".to_string(), "# Note".to_string()).unwrap();
        create_dir("folder".to_string()).unwrap();
        write_file("folder/child.md".to_string(), "# Child".to_string()).unwrap();
        let entries = list_dir(None).unwrap();
        assert!(entries[0].is_dir, "Directories should come first");
        cleanup_data_dir();
    }

    #[test]
    fn delete_file_removes_file() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        write_file("to-delete.md".to_string(), "# Bye".to_string()).unwrap();
        assert!(data_dir().join("to-delete.md").exists());
        delete_file("to-delete.md".to_string()).unwrap();
        assert!(!data_dir().join("to-delete.md").exists());
        cleanup_data_dir();
    }

    #[test]
    fn rename_file_moves_to_new_path() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        write_file("old-name.md".to_string(), "# Old".to_string()).unwrap();
        rename_file("old-name.md".to_string(), "new-name.md".to_string()).unwrap();
        assert!(!data_dir().join("old-name.md").exists());
        assert!(data_dir().join("new-name.md").exists());
        cleanup_data_dir();
    }

    #[test]
    fn settings_read_and_write_roundtrip() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        let settings = serde_json::json!({ "theme": "dark", "fontSize": 16 });
        write_settings(settings.clone()).unwrap();
        let read_back = read_settings().unwrap();
        assert_eq!(read_back["theme"], "dark");
        assert_eq!(read_back["fontSize"], 16);
        cleanup_data_dir();
    }

    #[test]
    fn read_settings_returns_empty_object_when_no_file() {
        let _dir = setup_data_dir();
        ensure_data_dir().unwrap();
        let settings = read_settings().unwrap();
        assert!(settings.is_object());
        assert_eq!(settings.as_object().unwrap().len(), 0);
        cleanup_data_dir();
    }
}
