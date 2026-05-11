# Plan: Notion Export Import

## Context
User wants to import notes from Notion into Kosha. Approach: Notion's built-in "Export as Markdown & CSV" (produces a ZIP). Kosha will accept either the ZIP or an already-unzipped folder, clean up Notion-specific filename mangling, rewrite internal links to wiki-links, and copy asset files.

## Notion Export Format
Notion exports produce:
- `.md` files named `Page Title 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md` (32-char hex UUID suffix)
- Folders named `Page Title 1a2b3c4d.../` (same pattern)
- Internal links: `[Display Text](Relative%20Path%20uuid.md)`
- Image assets: `![alt](image%20name%20uuid.png)`
- CSV files for databases (skip)

## Files to Create/Modify

### New: `src-tauri/src/import.rs`
Core logic:
- `strip_notion_id(stem: &str) -> &str` — removes trailing ` <32 hex>` from filename stem
- `clean_filename(name: &str) -> String` — splits ext, strips UUID from stem, recombines
- `url_decode(s: &str) -> String` — simple %XX decoder (no external dep)
- `rewrite_notion_links(content: &str) -> String`:
  - `[text](path.md)` → `[[text]]` (wiki-link)
  - `![alt](path.png)` → `![alt](clean_path.png)` (URL-decode + strip UUID)
- `import_notion_folder(src, data_dir) -> Result<usize, String>` — walk folder recursively
- `import_notion_zip(zip_path, data_dir) -> Result<usize, String>` — iterate zip entries

### Modified: `src-tauri/Cargo.toml`
- Add `zip = "2"` dependency

### Modified: `src-tauri/src/lib.rs`
- Add `mod import;`
- Register `import_from_notion_zip`, `import_from_notion_folder` commands

### Modified: `src/lib/tauri.ts`
- Add `importNotionZip(path)`, `importNotionFolder(path)` wrappers
- Add `pickFile(filters?)` for ZIP file picker

### New: `src/lib/components/NotionImportModal.svelte`
UI with two import modes:
1. **Import ZIP** — `pickFile([{name:'ZIP',extensions:['zip']}])` → call `importNotionZip`
2. **Import folder** — `pickFolder()` → call `importNotionFolder`
- Shows spinner while importing
- Shows "X notes imported" on success, error on failure

### Modified: `src/lib/stores/app.svelte.ts`
- Add `notionImportModalOpen = $state(false)`

### Modified: `src/lib/components/Sidebar.svelte`
- Add import button (↓ icon) to sidebar header toolbar
- `onclick={() => { app.notionImportModalOpen = true; }}`

### Modified: `src/routes/+layout.svelte`
- Mount `<NotionImportModal />` and import it
- After import: refresh file tree (`app.fileTree = await listDir()`)
  - emit `data-dir-changed`? No — just reload file tree in the modal after import

## Key Implementation Details

### UUID stripping
```rust
fn strip_notion_id(stem: &str) -> &str {
    if stem.len() >= 33 {
        let sep = stem.len() - 33;
        if stem.as_bytes()[sep] == b' '
            && stem[sep+1..].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return &stem[..sep];
        }
    }
    stem
}
```

### Link rewriting (scan without regex)
Scan char-by-char for `[` then `](`. For each `[text](target)`:
- If target ends with `.md` (not http): emit `[[text]]`
- If target is an image (`![`): URL-decode target, strip UUID, emit `![alt](clean)`
- Otherwise: keep as-is

### ZIP processing
Iterate `zip::ZipArchive` entries directly (no temp dir). For each entry name, compute `clean_path` by stripping UUID from each component. For `.md` files: read text, rewrite links, write to data_dir. For image files: read bytes, write to data_dir.

### After successful import
Modal calls `app.fileTree = await listDir()` to refresh sidebar.

## Capabilities
`dialog:allow-open` already present — no changes needed.

## Verification
1. `cargo check` passes
2. `pnpm build` passes
3. Manual test: export a Notion workspace as Markdown & CSV ZIP → import → confirm notes appear in sidebar with clean names, wiki-links work
