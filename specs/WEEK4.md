# Week 4: Polish ✅

> **Status: Complete**
> **Goal:** Your daily-driver personal knowledge keeper, synced across Macs via iCloud.

> **Depends on:** Week 3 complete (search + wiki-links + backlinks + tags)

---

## Task 1: Dark / Light Theme

### 1.1 TailwindCSS dark mode

In `app.css`, add dark theme tokens:

```css
@import "tailwindcss";

@theme {
  --color-primary: #2B6CB0;
  --color-surface: #FFFFFF;
  --color-surface-alt: #F7FAFC;
  --color-text: #1A202C;
  --color-text-muted: #718096;
  --color-border: #E2E8F0;
  --font-sans: "Inter", "SF Pro Text", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
}

.dark {
  --color-primary: #63B3ED;
  --color-surface: #1A1A2E;
  --color-surface-alt: #16213E;
  --color-text: #E2E8F0;
  --color-text-muted: #A0AEC0;
  --color-border: #2D3748;
}
```

### 1.2 Theme state and toggle

In `app.svelte.ts`:

```ts
theme = $state<'light' | 'dark'>('light');
```

Toggle logic (apply `dark` class to `<html>` element):

```ts
function toggleTheme() {
  app.theme = app.theme === 'light' ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', app.theme === 'dark');
  // Persist to settings.json
}
```

### 1.3 CodeMirror dark theme

Create a CM6 dark theme variant in `src/lib/editor/setup.ts`:

```ts
const darkEditorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--color-surface)' },
  '.cm-content': { color: 'var(--color-text)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-text)' },
  '.cm-activeLine': { backgroundColor: 'var(--color-surface-alt)' },
  // ... additional dark mode overrides
}, { dark: true });
```

Reconfigure CM6 theme when `app.theme` changes (use CM6's `Compartment` for dynamic reconfiguration).

### 1.4 Keyboard shortcut

`Cmd+Shift+T` → toggle dark/light theme

---

## Task 2: Source Mode Toggle

### 2.1 Cmd+/ toggles source mode

Behavior:
- **Live mode** (default): All decorations active. Markdown renders in-place.
- **Source mode**: All decorations disabled. Raw Markdown visible (like a plain text editor with syntax highlighting).

Implementation:
- Use a CM6 `Compartment` to hold all decoration extensions
- On toggle, reconfigure the compartment to an empty array (source mode) or the full decoration set (live mode)

In `app.svelte.ts`:

```ts
sourceMode = $state(false);
```

In the editor setup, wrap decorations in a compartment:

```ts
import { Compartment } from '@codemirror/state';

const decorationCompartment = new Compartment();

// In createEditorState, use:
decorationCompartment.of(allDecorationExtensions)

// To toggle:
view.dispatch({
  effects: decorationCompartment.reconfigure(
    sourceMode ? [] : allDecorationExtensions
  ),
});
```

### 2.2 Visual indicator

Show "Source" or "Live" mode in the status bar.

---

## Task 3: Floating Toolbar

### 3.1 Selection toolbar

Behavior:
- When user selects text, a floating toolbar appears above the selection
- Buttons: **Bold**, *Italic*, `Code`, [Link], ~~Strikethrough~~, Heading (dropdown)
- Clicking a button wraps the selection in the appropriate Markdown syntax
- Toolbar disappears when selection is cleared

Implementation:
- Use CM6's `showTooltip` or a custom Svelte component positioned via CM6's `coordsAtPos()`
- On selection change, check if selection is non-empty, compute position, show toolbar

```ts
import { showTooltip, Tooltip } from '@codemirror/view';

// Create a state field that provides tooltips based on selection
```

### 3.2 Toolbar actions

Each button inserts Markdown syntax around the selection:

| Button | Action |
|---|---|
| Bold | Wrap selection in `**...**` |
| Italic | Wrap selection in `*...*` |
| Code | Wrap selection in `` `...` `` |
| Link | Wrap selection in `[...](url)` and select "url" for typing |
| Strikethrough | Wrap selection in `~~...~~` |
| H1/H2/H3 | Prepend `# ` / `## ` / `### ` to line |

---

## Task 4: Trash

### 4.1 Soft delete

Behavior:
- Deleting a note moves it to `.trash/` directory (not permanent delete)
- Preserve the original relative path as part of the filename or subfolder structure
- Show "🗑 Trash" section at bottom of sidebar (collapsed by default)
- Clicking a trashed note opens it read-only with a "Restore" button
- Notes in `.trash/` older than 30 days are permanently deleted on app startup

### 4.2 Tauri commands

```rust
#[tauri::command]
pub fn trash_file(path: String) -> Result<(), String> {
    let base = data_dir();
    let source = base.join(&path);
    let trash_dir = base.join(".trash");
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;

    // Use timestamp prefix to avoid name collisions
    let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
    let filename = source.file_name().ok_or("Invalid filename")?;
    let dest = trash_dir.join(format!("{}_{}", timestamp, filename.to_string_lossy()));

    fs::rename(&source, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn restore_from_trash(trash_name: String, original_path: String) -> Result<(), String> {
    let base = data_dir();
    let source = base.join(".trash").join(&trash_name);
    let dest = base.join(&original_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&source, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn purge_old_trash(days: u64) -> Result<usize, String> {
    // Delete files in .trash/ older than `days` days
    // Return count of purged files
}
```

Add `chrono` to Cargo.toml: `chrono = "0.4"`

---

## Task 5: Templates

### 5.1 Templates folder

Behavior:
- `.md` files in `templates/` are available as note templates
- "New Note from Template" option in sidebar (or Cmd+Shift+N)
- Show template picker with template names
- Creating from template copies the template content into a new note

### 5.2 Default templates

On first run (if `templates/` doesn't exist), create it with one example:

`templates/daily-journal.md`:
```markdown
---
tags: [journal]
created: {{date}}
---

# Journal — {{date}}

## What I worked on


## What I learned


## Tomorrow
```

Replace `{{date}}` with current date when creating a note from this template.

---

## Task 6: iCloud Conflict Detection

### 6.1 File watcher for iCloud changes

File: `src-tauri/src/watcher.rs`

```rust
use notify::{Watcher, RecursiveMode, Event, EventKind};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

pub fn start_file_watcher(app: AppHandle, data_dir: PathBuf) {
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, _>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        }).expect("Failed to create watcher");

        watcher.watch(&data_dir, RecursiveMode::Recursive)
            .expect("Failed to watch directory");

        loop {
            if let Ok(event) = rx.recv() {
                match event.kind {
                    EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {
                        for path in &event.paths {
                            let relative = path.strip_prefix(&data_dir)
                                .map(|p| p.to_string_lossy().to_string())
                                .unwrap_or_default();

                            // Emit event to frontend
                            let _ = app.emit("file-changed", &relative);

                            // Check for iCloud conflict files
                            let name = path.file_name()
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
        }
    });
}
```

Add `notify = "7"` to Cargo.toml.

### 6.2 Start watcher on app launch

In `main.rs` `.setup()`:

```rust
.setup(|app| {
    // ... search index setup ...

    // Start file watcher
    let handle = app.handle().clone();
    watcher::start_file_watcher(handle, data_dir());

    Ok(())
})
```

### 6.3 Frontend handling

In root layout or +page.svelte, listen for events:

```ts
import { listen } from '@tauri-apps/api/event';

listen<string>('file-changed', (event) => {
  const changedPath = event.payload;
  if (changedPath === app.currentFile) {
    // Reload the file if it was changed externally
    reloadCurrentFile();
  }
  // Refresh file tree
  refreshFileTree();
});

listen<string>('icloud-conflict', (event) => {
  // Show conflict resolution UI
  showConflictDialog(event.payload);
});
```

### 6.4 Conflict resolution UI

Simple modal:
- "A conflicted copy was detected for [filename]"
- "Keep mine" — delete the conflict file
- "Keep theirs" — replace current with conflict file
- "Keep both" — rename one

---

## Task 7: Image Paste/Drop

### 7.1 Paste handler

In CM6 setup, add a DOM event handler:

```ts
EditorView.domEventHandlers({
  paste(event, view) {
    const items = event.clipboardData?.items;
    if (!items) return false;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) handleImageInsert(file, view);
        return true;
      }
    }
    return false;
  },
  drop(event, view) {
    const files = event.dataTransfer?.files;
    if (!files) return false;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        event.preventDefault();
        handleImageInsert(file, view);
        return true;
      }
    }
    return false;
  },
})
```

### 7.2 Save image and insert link

```ts
async function handleImageInsert(file: File, view: EditorView) {
  // Generate filename: assets/YYYYMMDD-HHMMSS-originalname.ext
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `${timestamp}-${file.name}`;
  const assetsPath = `assets/${name}`;

  // Read file as array buffer, write via Tauri
  const buffer = await file.arrayBuffer();
  await writeFileBinary(assetsPath, new Uint8Array(buffer));

  // Insert Markdown image link at cursor
  const pos = view.state.selection.main.head;
  const insert = `![${file.name}](./assets/${name})`;
  view.dispatch({ changes: { from: pos, insert } });
}
```

Add `writeFileBinary` Tauri command for binary file writes.

---

## Task 8: Word Count & Status Bar

### 8.1 Status bar component

File: `src/lib/components/StatusBar.svelte`

Display:
- Current file path
- Dirty indicator (dot or "unsaved")
- Word count
- Character count
- Estimated reading time (words / 200 wpm)
- Live/Source mode indicator
- Theme indicator (☀️ / 🌙)

Position: Fixed at bottom of editor area, 32px tall.

Word count: Compute from `app.fileContent` with a simple regex split on whitespace.

---

## Week 4 Acceptance Criteria (All Must Pass)

- [ ] `Cmd+Shift+T` toggles between dark and light theme
- [ ] Dark theme applies to sidebar, editor, search modal, status bar
- [ ] CodeMirror theme updates when toggling dark/light
- [ ] `Cmd+/` toggles between live preview and source mode
- [ ] Source mode shows raw Markdown with syntax highlighting only (no decorations)
- [ ] Floating toolbar appears on text selection with Bold, Italic, Code, Link, Strikethrough, Heading
- [ ] Toolbar buttons insert correct Markdown syntax around selection
- [ ] Delete moves file to `.trash/` instead of permanent delete
- [ ] Trash section in sidebar shows trashed files
- [ ] Trashed files older than 30 days are purged on startup
- [ ] "New Note from Template" creates note from `templates/` folder
- [ ] `{{date}}` placeholder in templates is replaced with current date
- [ ] File watcher detects external file changes and reloads open note
- [ ] iCloud conflict files trigger a resolution dialog
- [ ] Pasting an image saves to `./assets/` and inserts Markdown image link
- [ ] Dropping an image file into editor does the same
- [ ] Status bar shows: file path, dirty state, word count, reading time, mode
- [ ] Theme preference persists in `.kosha/settings.json`
- [ ] App feels polished enough to use daily

---

## Final Smoke Test

After all 4 weeks, verify end-to-end:

1. `pnpm tauri build` produces a `.dmg`
2. Install and launch from `/Applications`
3. Create a new note, type Markdown, verify live rendering
4. Create 50+ test notes across folders
5. Search finds notes in < 100ms
6. Wiki-links navigate between notes
7. Backlinks show correctly
8. Toggle dark mode, restart — theme persists
9. Copy the data directory to another Mac via iCloud — notes appear
10. Edit same note on both machines, verify conflict detection
11. Bundle size < 8 MB
12. Cold start < 1.5s
