# Week 3: Search + Links ✅

> **Status: Complete**
> **Goal:** Find anything instantly. Navigate by links, tags, and search.

> **Depends on:** Week 2 complete (all decorations + sidebar file tree)

---

## Task 1: SQLite FTS5 Full-Text Search

### 1.1 Add Rust dependencies

In `src-tauri/Cargo.toml`:

```toml
[dependencies]
rusqlite = { version = "0.32", features = ["bundled", "modern_sqlite"] }
```

### 1.2 Create search module

File: `src-tauri/src/search.rs`

```rust
use rusqlite::{Connection, params};
use std::path::PathBuf;
use serde::Serialize;

#[derive(Serialize)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub rank: f64,
}

pub struct SearchIndex {
    conn: Connection,
}

impl SearchIndex {
    pub fn new(db_path: &PathBuf) -> Result<Self, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

        conn.execute_batch("
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                path,
                title,
                content,
                tags,
                tokenize='porter unicode61'
            );
        ").map_err(|e| e.to_string())?;

        Ok(Self { conn })
    }

    /// Rebuild entire index from scratch by scanning all .md files
    pub fn rebuild(&self, data_dir: &PathBuf) -> Result<usize, String> {
        self.conn.execute("DELETE FROM notes_fts", []).map_err(|e| e.to_string())?;
        let count = self.index_directory(data_dir, data_dir)?;
        Ok(count)
    }

    fn index_directory(&self, dir: &PathBuf, base: &PathBuf) -> Result<usize, String> {
        let mut count = 0;
        let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name.starts_with('.') { continue; }

            if path.is_dir() {
                count += self.index_directory(&path, base)?;
            } else if name.ends_with(".md") {
                self.index_file(&path, base)?;
                count += 1;
            }
        }
        Ok(count)
    }

    fn index_file(&self, path: &PathBuf, base: &PathBuf) -> Result<(), String> {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let relative = path.strip_prefix(base).map_err(|e| e.to_string())?
            .to_string_lossy().to_string();

        // Extract title (first # heading or filename)
        let title = content.lines()
            .find(|l| l.starts_with("# "))
            .map(|l| l.trim_start_matches("# ").to_string())
            .unwrap_or_else(|| {
                path.file_stem().unwrap_or_default().to_string_lossy().to_string()
            });

        // Extract tags from frontmatter (simple regex, not full YAML parse)
        let tags = if content.starts_with("---") {
            content.split("---").nth(1)
                .and_then(|fm| fm.lines().find(|l| l.starts_with("tags:")))
                .unwrap_or("")
                .to_string()
        } else {
            String::new()
        };

        self.conn.execute(
            "INSERT INTO notes_fts (path, title, content, tags) VALUES (?1, ?2, ?3, ?4)",
            params![relative, title, content, tags],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Update a single file in the index (delete + re-insert)
    pub fn update_file(&self, path: &str, base: &PathBuf) -> Result<(), String> {
        self.conn.execute("DELETE FROM notes_fts WHERE path = ?1", params![path])
            .map_err(|e| e.to_string())?;
        let full_path = base.join(path);
        if full_path.exists() {
            self.index_file(&full_path, base)?;
        }
        Ok(())
    }

    /// Search notes by query
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT path, title, snippet(notes_fts, 2, '<mark>', '</mark>', '...', 32), rank
             FROM notes_fts
             WHERE notes_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2"
        ).map_err(|e| e.to_string())?;

        let results = stmt.query_map(params![query, limit as i64], |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
                rank: row.get(3)?,
            })
        }).map_err(|e| e.to_string())?;

        results.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// List all unique titles for quick switcher (fuzzy match done frontend-side)
    pub fn list_titles(&self) -> Result<Vec<(String, String)>, String> {
        let mut stmt = self.conn.prepare("SELECT path, title FROM notes_fts ORDER BY title")
            .map_err(|e| e.to_string())?;
        let results = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        results.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
}
```

### 1.3 Expose as Tauri commands

Add to `src-tauri/src/commands.rs` (or a new `search_commands.rs`):

```rust
use std::sync::Mutex;
use tauri::State;

pub struct AppSearchIndex(pub Mutex<SearchIndex>);

#[tauri::command]
pub fn rebuild_search_index(index: State<AppSearchIndex>) -> Result<usize, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.rebuild(&data_dir())
}

#[tauri::command]
pub fn search_notes(query: String, limit: Option<usize>, index: State<AppSearchIndex>) -> Result<Vec<SearchResult>, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.search(&query, limit.unwrap_or(20))
}

#[tauri::command]
pub fn update_search_index(path: String, index: State<AppSearchIndex>) -> Result<(), String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.update_file(&path, &data_dir())
}

#[tauri::command]
pub fn list_note_titles(index: State<AppSearchIndex>) -> Result<Vec<(String, String)>, String> {
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.list_titles()
}
```

Register in `main.rs`:

```rust
use commands::AppSearchIndex;
use search::SearchIndex;

fn main() {
    let db_path = dirs::home_dir().unwrap().join(".kosha-data/.kosha/search.db");
    std::fs::create_dir_all(db_path.parent().unwrap()).ok();
    let search_index = SearchIndex::new(&db_path).expect("Failed to init search index");

    tauri::Builder::default()
        .manage(AppSearchIndex(Mutex::new(search_index)))
        .invoke_handler(tauri::generate_handler![
            // ... existing commands ...
            commands::rebuild_search_index,
            commands::search_notes,
            commands::update_search_index,
            commands::list_note_titles,
        ])
        .setup(|app| {
            // Rebuild index on startup
            let index = app.state::<AppSearchIndex>();
            let idx = index.0.lock().unwrap();
            let count = idx.rebuild(&data_dir()).unwrap_or(0);
            println!("Indexed {} notes", count);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 1.4 TypeScript wrappers

Add to `src/lib/tauri.ts`:

```ts
export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

export async function searchNotes(query: string, limit?: number): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search_notes', { query, limit: limit ?? 20 });
}

export async function rebuildSearchIndex(): Promise<number> {
  return invoke<number>('rebuild_search_index');
}

export async function updateSearchIndex(path: string): Promise<void> {
  return invoke('update_search_index', { path });
}

export async function listNoteTitles(): Promise<[string, string][]> {
  return invoke<[string, string][]>('list_note_titles');
}
```

### 1.5 Update save to also update search index

In the save function (in `+page.svelte`), after `writeFile()`:

```ts
await updateSearchIndex(app.currentFile);
```

---

## Task 2: Search Modal (Cmd+K / Cmd+Shift+F)

### 2.1 Create SearchModal component

File: `src/lib/components/SearchModal.svelte`

Behavior:
- **Cmd+K** → Quick switcher mode (fuzzy title match)
  - Loads all note titles from `listNoteTitles()`
  - As user types, filter client-side (fuzzy match on title)
  - Arrow keys to navigate results, Enter to open
  - Show file path below title in muted text
- **Cmd+Shift+F** → Full-text search mode
  - As user types, call `searchNotes(query)` with debounce (300ms)
  - Show results with highlighted snippets (HTML from FTS5 `snippet()`)
  - Arrow keys to navigate, Enter to open

UI:
- Centered modal overlay (like VS Code's Cmd+P)
- Width: 600px max
- Input field at top with search icon
- Results list below (max 10-15 visible, scrollable)
- Mode indicator: "Quick Switch" vs "Search All"
- Escape or click outside to close

### 2.2 Register global shortcuts

In the root layout or a global handler:

```ts
function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.metaKey && e.key === 'k') {
    e.preventDefault();
    openSearchModal('switcher');
  }
  if (e.metaKey && e.shiftKey && e.key === 'f') {
    e.preventDefault();
    openSearchModal('search');
  }
}
```

### 2.3 Add state for search modal

In `app.svelte.ts`:

```ts
searchModalOpen = $state(false);
searchModalMode = $state<'switcher' | 'search'>('switcher');
```

---

## Task 3: Wiki-Links

### 3.1 Wiki-link decoration

File: `src/lib/editor/wiki-links.ts`

Behavior:
- `[[Note Name]]` in the editor renders as a styled chip/pill (blue background, rounded)
- Display only the note name (hide `[[` and `]]` when cursor is outside)
- Click navigates to the linked note (find by filename match in file tree)
- If the note doesn't exist, style differently (red/dashed border) — clicking creates the note

Implementation:
- CM6 `ViewPlugin` scanning for `[[...]]` patterns using regex or syntax tree
- `Decoration.replace()` to hide brackets + `Decoration.mark()` for styling
- Or `Decoration.widget()` for a clickable chip

### 3.2 Backlinks panel

File: `src/lib/components/Backlinks.svelte`

Behavior:
- Displayed below the editor (collapsible section)
- Shows all notes that contain `[[Current Note Name]]`
- Each backlink shows: note title, snippet of surrounding text
- Click to navigate to that note

Implementation:
- On note open, search for `[[filename]]` across all files
- Can use FTS5: `searchNotes('"[[filename]]"')` or scan files in Rust
- Cache results; update when files are saved

Add Tauri command:

```rust
#[tauri::command]
pub fn find_backlinks(note_name: String, index: State<AppSearchIndex>) -> Result<Vec<SearchResult>, String> {
    let query = format!("\"[[{}]]\"", note_name);
    let idx = index.0.lock().map_err(|e| e.to_string())?;
    idx.search(&query, 50)
}
```

### 3.3 Backlinks state

In `app.svelte.ts`:

```ts
backlinks = $state<SearchResult[]>([]);
```

Load backlinks when a note is opened:

```ts
async function openFile(path: string) {
  // ... existing load logic ...
  const noteName = path.split('/').pop()?.replace('.md', '') ?? '';
  app.backlinks = await findBacklinks(noteName);
}
```

---

## Task 4: Tag Panel

### 4.1 Collect all tags

Add Tauri command to extract all unique tags:

```rust
#[tauri::command]
pub fn list_all_tags() -> Result<Vec<(String, usize)>, String> {
    // Scan all .md files in data_dir
    // Parse frontmatter, collect tags
    // Return Vec of (tag_name, count) sorted by count desc
}
```

### 4.2 Tag section in sidebar

In `Sidebar.svelte`, add a "Tags" section:

- Shows all tags with note counts
- Click a tag → filter the file tree to show only notes with that tag
- Click again to clear filter
- Alphabetically sorted, or by count

### 4.3 Store tag filter state

In `app.svelte.ts`:

```ts
allTags = $state<{ tag: string; count: number }[]>([]);
activeTagFilter = $state<string | null>(null);
```

---

## Week 3 Acceptance Criteria (All Must Pass)

- [ ] FTS5 index builds on app startup (logs "Indexed N notes")
- [ ] FTS5 index updates incrementally on save
- [ ] `Cmd+K` opens quick switcher with fuzzy title filtering
- [ ] `Cmd+Shift+F` opens full-text search with highlighted snippets
- [ ] Search results navigable with arrow keys, Enter opens the note
- [ ] Escape closes search modal
- [ ] `[[wiki-links]]` render as styled chips in the editor
- [ ] Clicking a wiki-link navigates to the linked note
- [ ] Backlinks panel below editor shows notes that link to current note
- [ ] Tags panel in sidebar shows all tags with counts
- [ ] Clicking a tag filters the file tree
- [ ] Search across 100+ test notes returns in < 100ms
