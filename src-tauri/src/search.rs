use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Clone)]
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

        conn.execute_batch(
            "
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                path UNINDEXED,
                title,
                content,
                tags,
                tokenize='porter unicode61'
            );
            CREATE TABLE IF NOT EXISTS note_tags (
                path TEXT NOT NULL,
                tag  TEXT NOT NULL,
                PRIMARY KEY (path, tag)
            );
            CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);
        ",
        )
        .map_err(|e| e.to_string())?;

        Ok(Self { conn })
    }

    /// Rebuild the entire index by scanning all .md files
    pub fn rebuild(&self, data_dir: &PathBuf) -> Result<usize, String> {
        self.conn
            .execute("DELETE FROM notes_fts", [])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM note_tags", [])
            .map_err(|e| e.to_string())?;
        self.index_directory(data_dir, data_dir)
    }

    fn index_directory(&self, dir: &PathBuf, base: &PathBuf) -> Result<usize, String> {
        let mut count = 0;
        let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if name.starts_with('.') {
                continue;
            }

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
        let relative = path
            .strip_prefix(base)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();

        // Extract title: first # heading or filename
        let title = content
            .lines()
            .find(|l| l.starts_with("# "))
            .map(|l| l.trim_start_matches("# ").to_string())
            .unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });

        // Extract tags from frontmatter
        let tag_list = extract_tag_list(&content);
        let tags_joined = tag_list.join(" ");

        self.conn
            .execute(
                "INSERT INTO notes_fts (path, title, content, tags) VALUES (?1, ?2, ?3, ?4)",
                params![relative, title, content, tags_joined],
            )
            .map_err(|e| e.to_string())?;

        for tag in &tag_list {
            self.conn
                .execute(
                    "INSERT OR IGNORE INTO note_tags (path, tag) VALUES (?1, ?2)",
                    params![relative, tag],
                )
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    /// Update a single file (delete + re-insert)
    pub fn update_file(&self, path: &str, base: &PathBuf) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM notes_fts WHERE path = ?1", params![path])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM note_tags WHERE path = ?1", params![path])
            .map_err(|e| e.to_string())?;

        let full_path = base.join(path);
        if full_path.exists() {
            self.index_file(&full_path, base)?;
        }

        Ok(())
    }

    /// All tags with usage counts, sorted by count desc then name asc.
    pub fn list_all_tags(&self) -> Result<Vec<(String, usize)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT tag, COUNT(*) AS n FROM note_tags
                 GROUP BY tag ORDER BY n DESC, tag ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Paths of notes tagged with the given tag.
    pub fn list_notes_by_tag(&self, tag: &str) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT path FROM note_tags WHERE tag = ?1 ORDER BY path")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![tag], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Full-text search
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT path, title, snippet(notes_fts, 2, '<mark>', '</mark>', '...', 32), rank
                 FROM notes_fts
                 WHERE notes_fts MATCH ?1
                 ORDER BY rank
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;

        let results = stmt
            .query_map(params![query, limit as i64], |row| {
                Ok(SearchResult {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    snippet: row.get(2)?,
                    rank: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;

        results
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// List all note titles for quick switcher
    pub fn list_titles(&self) -> Result<Vec<(String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT path, title FROM notes_fts ORDER BY title")
            .map_err(|e| e.to_string())?;

        let results = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        results
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Find backlinks: notes that mention [[note_name]]
    pub fn find_backlinks(
        &self,
        note_name: &str,
        limit: usize,
    ) -> Result<Vec<SearchResult>, String> {
        // Escape special FTS5 characters in the note name
        let escaped = note_name.replace('"', "\"\"");
        let query = format!("\"[[{}]]\"", escaped);
        let results = self.search(&query, limit)?;
        // FTS5's unicode61 tokenizer strips [[ ]] brackets, so the phrase query
        // degenerates to the bare note name — this can self-match the target note.
        // Filter out any result whose file stem equals note_name (case-insensitive).
        let note_name_lower = note_name.to_lowercase();
        Ok(results
            .into_iter()
            .filter(|r| {
                let stem = std::path::Path::new(&r.path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                stem != note_name_lower
            })
            .collect())
    }
}

/// Parse the `tags:` field from YAML frontmatter, handling both
/// inline (`tags: [a, b]`) and block (`tags:\n  - a\n  - b`) styles.
fn extract_tag_list(content: &str) -> Vec<String> {
    if !content.starts_with("---") {
        return Vec::new();
    }
    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() < 3 {
        return Vec::new();
    }
    let frontmatter = parts[1];

    // Inline form
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("tags:") {
            let rest = rest.trim();
            if rest.starts_with('[') {
                return rest
                    .trim_matches(|c| c == '[' || c == ']')
                    .split(',')
                    .map(|t| t.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
                    .filter(|t| !t.is_empty())
                    .collect();
            }
        }
    }

    // Block form: tags: \n  - a \n  - b
    let mut in_tags = false;
    let mut tags = Vec::new();
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("tags:") {
            in_tags = true;
            continue;
        }
        if in_tags {
            if let Some(item) = trimmed.strip_prefix("- ") {
                tags.push(item.trim_matches(|c| c == '"' || c == '\'').to_string());
            } else if !trimmed.is_empty() && !trimmed.starts_with('#') {
                break;
            }
        }
    }
    tags
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── helpers ───────────────────────────────────────────────────────────────

    fn make_index(dir: &TempDir) -> SearchIndex {
        let db = dir.path().join("test.db");
        SearchIndex::new(&db).expect("Failed to create SearchIndex")
    }

    fn write_note(dir: &TempDir, name: &str, content: &str) {
        let path = dir.path().join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn base(dir: &TempDir) -> PathBuf {
        dir.path().to_path_buf()
    }

    // ── SearchIndex::new ──────────────────────────────────────────────────────

    #[test]
    fn new_creates_fts_table_without_error() {
        let dir = TempDir::new().unwrap();
        let idx = make_index(&dir);
        // Verify the table is queryable
        let results = idx.search("anything", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn new_is_idempotent_on_existing_db() {
        let dir = TempDir::new().unwrap();
        let db = dir.path().join("test.db");
        // Create twice — CREATE VIRTUAL TABLE IF NOT EXISTS must not fail
        SearchIndex::new(&db).unwrap();
        SearchIndex::new(&db).unwrap();
    }

    // ── rebuild ───────────────────────────────────────────────────────────────

    #[test]
    fn rebuild_empty_dir_returns_zero() {
        let dir = TempDir::new().unwrap();
        let idx = make_index(&dir);
        let count = idx.rebuild(&base(&dir)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn rebuild_counts_only_md_files() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "a.md", "# A");
        write_note(&dir, "b.md", "# B");
        fs::write(dir.path().join("readme.txt"), "not markdown").unwrap();
        let idx = make_index(&dir);
        let count = idx.rebuild(&base(&dir)).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn rebuild_skips_hidden_files_and_dirs() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "visible.md", "# Visible");
        write_note(&dir, ".hidden.md", "# Hidden");
        fs::create_dir(dir.path().join(".trash")).unwrap();
        fs::write(dir.path().join(".trash/deleted.md"), "# Deleted").unwrap();
        let idx = make_index(&dir);
        let count = idx.rebuild(&base(&dir)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn rebuild_indexes_files_in_subdirectories() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "root.md", "# Root");
        write_note(&dir, "subdir/nested.md", "# Nested");
        write_note(&dir, "subdir/deep/note.md", "# Deep");
        let idx = make_index(&dir);
        let count = idx.rebuild(&base(&dir)).unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn rebuild_clears_previous_index() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "a.md", "# A");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        // Delete the file and rebuild — should now have 0
        fs::remove_file(dir.path().join("a.md")).unwrap();
        let count = idx.rebuild(&base(&dir)).unwrap();
        assert_eq!(count, 0);
        let results = idx.search("A", 10).unwrap();
        assert!(results.is_empty());
    }

    // ── search ────────────────────────────────────────────────────────────────

    #[test]
    fn search_finds_content_by_word() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "rust.md", "# Rust\n\nRust is a systems programming language.");
        write_note(&dir, "python.md", "# Python\n\nPython is a scripting language.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let results = idx.search("Rust", 10).unwrap();
        assert!(!results.is_empty());
        assert!(results.iter().any(|r| r.path == "rust.md"));
        assert!(!results.iter().any(|r| r.path == "python.md"));
    }

    #[test]
    fn search_result_path_is_relative() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "subdir/note.md", "# Note\n\nContent about uniqueword123.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let results = idx.search("uniqueword123", 10).unwrap();
        assert_eq!(results[0].path, "subdir/note.md");
    }

    #[test]
    fn search_result_includes_snippet() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "snip.md", "# Snippet Test\n\nThe word snipword appears here.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let results = idx.search("snipword", 10).unwrap();
        assert!(!results.is_empty());
        // Snippet contains the matched word (possibly highlighted with <mark>)
        assert!(results[0].snippet.contains("snipword") || results[0].snippet.contains("Snippet"));
    }

    #[test]
    fn search_is_case_insensitive() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "case.md", "# Case\n\nHello World.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        assert!(!idx.search("hello", 10).unwrap().is_empty());
        assert!(!idx.search("HELLO", 10).unwrap().is_empty());
        assert!(!idx.search("Hello", 10).unwrap().is_empty());
    }

    #[test]
    fn search_limit_caps_number_of_results() {
        let dir = TempDir::new().unwrap();
        for i in 0..10 {
            write_note(&dir, &format!("note{}.md", i), "# Note\n\ncommonword here.");
        }
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let results = idx.search("commonword", 3).unwrap();
        assert!(results.len() <= 3);
    }

    #[test]
    fn search_returns_empty_for_missing_term() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "a.md", "# A\n\nSome content.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let results = idx.search("xyznonexistenttermxyz", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_empty_index_returns_empty() {
        let dir = TempDir::new().unwrap();
        let idx = make_index(&dir);
        let results = idx.search("anything", 10).unwrap();
        assert!(results.is_empty());
    }

    // ── list_titles ───────────────────────────────────────────────────────────

    #[test]
    fn list_titles_extracts_h1_heading_as_title() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "my-note.md", "# My Great Note\n\nBody text.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let titles = idx.list_titles().unwrap();
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0].0, "my-note.md");
        assert_eq!(titles[0].1, "My Great Note");
    }

    #[test]
    fn list_titles_falls_back_to_filename_when_no_h1() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "untitled-note.md", "No heading here.\nJust body text.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let titles = idx.list_titles().unwrap();
        assert_eq!(titles[0].1, "untitled-note");
    }

    #[test]
    fn list_titles_uses_first_h1_not_later_ones() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "multi.md", "# First Heading\n\nSome text.\n\n# Second Heading");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let titles = idx.list_titles().unwrap();
        assert_eq!(titles[0].1, "First Heading");
    }

    #[test]
    fn list_titles_returns_all_notes_sorted_by_title() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "c.md", "# Charlie");
        write_note(&dir, "a.md", "# Alpha");
        write_note(&dir, "b.md", "# Beta");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let titles = idx.list_titles().unwrap();
        assert_eq!(titles.len(), 3);
        assert_eq!(titles[0].1, "Alpha");
        assert_eq!(titles[1].1, "Beta");
        assert_eq!(titles[2].1, "Charlie");
    }

    #[test]
    fn list_titles_empty_index() {
        let dir = TempDir::new().unwrap();
        let idx = make_index(&dir);
        let titles = idx.list_titles().unwrap();
        assert!(titles.is_empty());
    }

    // ── find_backlinks ────────────────────────────────────────────────────────

    #[test]
    fn find_backlinks_finds_wiki_link_references() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "target.md", "# Target\n\nI am the target.");
        write_note(&dir, "source.md", "# Source\n\nSee [[Target]] for details.");
        write_note(&dir, "other.md", "# Other\n\nNothing relevant.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let backlinks = idx.find_backlinks("Target", 50).unwrap();
        assert!(!backlinks.is_empty());
        assert!(backlinks.iter().any(|r| r.path == "source.md"));
        assert!(!backlinks.iter().any(|r| r.path == "target.md"));
    }

    #[test]
    fn find_backlinks_returns_empty_when_no_references() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "lonely.md", "# Lonely\n\nNo one links here.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let backlinks = idx.find_backlinks("Lonely", 50).unwrap();
        assert!(backlinks.is_empty());
    }

    #[test]
    fn find_backlinks_finds_multiple_sources() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "hub.md", "# Hub");
        write_note(&dir, "src1.md", "# Src1\n\nSee [[Hub]].");
        write_note(&dir, "src2.md", "# Src2\n\nAlso [[Hub]] is relevant.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let backlinks = idx.find_backlinks("Hub", 50).unwrap();
        assert!(backlinks.iter().any(|r| r.path == "src1.md"));
        assert!(backlinks.iter().any(|r| r.path == "src2.md"));
    }

    // ── update_file ───────────────────────────────────────────────────────────

    #[test]
    fn update_file_re_indexes_changed_content() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "mutable.md", "# Mutable\n\nOriginal content only.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();

        // Update the file and call update_file
        write_note(&dir, "mutable.md", "# Mutable\n\nUpdated with newterm9999.");
        idx.update_file("mutable.md", &base(&dir)).unwrap();

        let old_results = idx.search("Original", 10).unwrap();
        assert!(old_results.is_empty(), "Old content should be gone after update");

        let new_results = idx.search("newterm9999", 10).unwrap();
        assert!(!new_results.is_empty(), "New content should be searchable after update");
    }

    #[test]
    fn update_file_removes_entry_when_file_is_deleted() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "deleteme.md", "# Delete\n\nThis will be removed.");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();

        // Verify it was indexed
        assert!(!idx.search("removed", 10).unwrap().is_empty());

        // Delete the file and update index
        fs::remove_file(dir.path().join("deleteme.md")).unwrap();
        idx.update_file("deleteme.md", &base(&dir)).unwrap();

        assert!(idx.search("removed", 10).unwrap().is_empty());
    }

    // ── extract_tag_list ─────────────────────────────────────────────────────

    #[test]
    fn extract_tag_list_inline() {
        let v = extract_tag_list("---\ntags: [rust, svelte, tauri]\n---\n");
        assert_eq!(v, vec!["rust", "svelte", "tauri"]);
    }

    #[test]
    fn extract_tag_list_block() {
        let v = extract_tag_list("---\ntags:\n  - apple\n  - banana\n---\n");
        assert_eq!(v, vec!["apple", "banana"]);
    }

    #[test]
    fn extract_tag_list_no_frontmatter() {
        assert!(extract_tag_list("# Plain").is_empty());
    }

    #[test]
    fn extract_tag_list_no_tags_key() {
        assert!(extract_tag_list("---\nauthor: Alice\n---\n").is_empty());
    }

    #[test]
    fn extract_tag_list_incomplete_frontmatter() {
        assert!(extract_tag_list("---\ntags: [a]\nno closing").is_empty());
    }

    // ── list_all_tags / list_notes_by_tag ────────────────────────────────────

    #[test]
    fn list_all_tags_aggregates_counts() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "a.md", "---\ntags: [rust, svelte]\n---\n# A");
        write_note(&dir, "b.md", "---\ntags: [rust]\n---\n# B");
        write_note(&dir, "c.md", "# C");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let tags = idx.list_all_tags().unwrap();
        // rust=2, svelte=1; sorted by count desc
        assert_eq!(tags[0], ("rust".into(), 2));
        assert_eq!(tags[1], ("svelte".into(), 1));
    }

    #[test]
    fn list_notes_by_tag_returns_matching_paths() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "a.md", "---\ntags: [rust]\n---\n# A");
        write_note(&dir, "b.md", "---\ntags: [python]\n---\n# B");
        write_note(&dir, "c.md", "---\ntags: [rust, python]\n---\n# C");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        let rust_notes = idx.list_notes_by_tag("rust").unwrap();
        assert_eq!(rust_notes, vec!["a.md".to_string(), "c.md".to_string()]);
    }

    #[test]
    fn update_file_refreshes_tag_table() {
        let dir = TempDir::new().unwrap();
        write_note(&dir, "n.md", "---\ntags: [old]\n---\n# N");
        let idx = make_index(&dir);
        idx.rebuild(&base(&dir)).unwrap();
        assert_eq!(idx.list_notes_by_tag("old").unwrap(), vec!["n.md".to_string()]);
        write_note(&dir, "n.md", "---\ntags: [new]\n---\n# N");
        idx.update_file("n.md", &base(&dir)).unwrap();
        assert!(idx.list_notes_by_tag("old").unwrap().is_empty());
        assert_eq!(idx.list_notes_by_tag("new").unwrap(), vec!["n.md".to_string()]);
    }
}
