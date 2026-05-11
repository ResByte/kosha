# Week 1: Editor Core

> **Goal:** Edit Markdown files with live in-place rendering in a native macOS window.

---

## Prerequisites

Install before starting:

```bash
# Rust (for Tauri backend)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node via nvm
nvm install --lts

# pnpm
npm install -g pnpm

# Tauri CLI
cargo install tauri-cli
```

Verify: `cargo tauri --version` should print `tauri-cli 2.x.x`.

---

## Task 1: Scaffold Project

### 1.1 Create Tauri + SvelteKit project

```bash
pnpm create tauri-app kosha -- --template sveltekit-ts
cd kosha
pnpm install
```

### 1.2 Install TailwindCSS v4

```bash
pnpm add -D tailwindcss @tailwindcss/vite
```

Update `vite.config.ts`:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
});
```

Create `src/app.css`:

```css
@import "tailwindcss";

@theme {
  --color-primary: #2B6CB0;
  --color-surface: #FFFFFF;
  --color-surface-dark: #1A1A2E;
  --color-text: #1A202C;
  --color-text-muted: #718096;
  --color-border: #E2E8F0;
  --font-sans: "Inter", "SF Pro Text", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
}
```

Import in `src/routes/+layout.svelte`:

```svelte
<script>
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

### 1.3 Disable SSR for Tauri

Create `src/routes/+layout.ts`:

```ts
export const ssr = false;
export const prerender = true;
```

### 1.4 Configure Tauri

In `src-tauri/tauri.conf.json`, ensure:

```json
{
  "build": {
    "frontendDist": "../build"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "Kosha",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "decorations": true,
        "resizable": true
      }
    ]
  }
}
```

### 1.5 Verify scaffold

```bash
pnpm tauri dev
```

**Acceptance:** A native macOS window opens showing the SvelteKit default page.

---

## Task 2: Install CodeMirror 6 + Live Markdown

### 2.1 Install dependencies

```bash
pnpm add codemirror @codemirror/lang-markdown @codemirror/language-data \
  @codemirror/state @codemirror/view @codemirror/commands \
  @codemirror/search @codemirror/autocomplete \
  codemirror-live-markdown gray-matter
```

> **Note:** If `codemirror-live-markdown` is not available on npm, fall back to building custom CM6 decorations manually. See the "Fallback" section at the bottom of this file.

### 2.2 Create editor setup

Create `src/lib/editor/setup.ts`:

```ts
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';

// Import codemirror-live-markdown plugins
// Adjust imports based on actual library API
// import { livePreviewPlugin, mathPlugin, ... } from 'codemirror-live-markdown';

export function createEditorState(doc: string, onUpdate: (content: string) => void): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onUpdate(update.state.doc.toString());
        }
      }),
      // Add codemirror-live-markdown plugins here once available:
      // livePreviewPlugin,
      // mathPlugin({ inline: true }),
      // etc.
      editorTheme,
    ],
  });
}

const editorTheme = EditorView.theme({
  '&': {
    fontSize: '16px',
    fontFamily: 'var(--font-sans)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-sans)',
    padding: '1rem 0',
    maxWidth: '72ch',
    margin: '0 auto',
  },
  '.cm-gutters': {
    display: 'none', // Hide gutters for note-taking
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-line': {
    padding: '2px 0',
  },
});

export function createEditorView(
  parent: HTMLElement,
  state: EditorState
): EditorView {
  return new EditorView({ state, parent });
}
```

### 2.3 Create Editor component

Create `src/lib/components/Editor.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createEditorState, createEditorView } from '$lib/editor/setup';
  import type { EditorView } from '@codemirror/view';

  let { content = '', onContentChange }: {
    content: string;
    onContentChange: (content: string) => void;
  } = $props();

  let editorContainer: HTMLElement;
  let view: EditorView | null = null;

  onMount(() => {
    const state = createEditorState(content, onContentChange);
    view = createEditorView(editorContainer, state);
  });

  onDestroy(() => {
    view?.destroy();
  });

  // Update editor when content prop changes externally (e.g., file switch)
  $effect(() => {
    if (view && content !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
  });
</script>

<div bind:this={editorContainer} class="editor-container h-full w-full overflow-auto"></div>
```

### 2.4 Wire into page

Update `src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import Editor from '$lib/components/Editor.svelte';

  let content = $state('# Welcome to Kosha\n\nStart typing your notes here.\n\n## Features\n\n- **Bold text** and *italic text*\n- `inline code`\n- [Links](https://example.com)\n\n> A blockquote\n\n- [ ] A todo item\n- [x] A completed item\n');

  function handleContentChange(newContent: string) {
    content = newContent;
  }
</script>

<main class="h-screen bg-white">
  <Editor {content} onContentChange={handleContentChange} />
</main>
```

**Acceptance:** App opens with a CodeMirror 6 editor showing Markdown with syntax highlighting. Typing works. If `codemirror-live-markdown` is integrated, Markdown renders inline.

---

## Task 3: Tauri File I/O Commands

### 3.1 Add Rust dependencies

In `src-tauri/Cargo.toml`, add:

```toml
[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### 3.2 Create Tauri commands

Create `src-tauri/src/commands.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};
use serde::Serialize;

/// Get the Kosha data directory (iCloud Drive path)
fn data_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    // For development, use a local directory. Switch to iCloud path for production:
    // home.join("Library/Mobile Documents/com~kosha")
    home.join(".kosha-data")
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let full_path = data_dir().join(&path);
    fs::read_to_string(&full_path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let full_path = data_dir().join(&path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }
    fs::write(&full_path, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
pub fn list_dir(path: Option<String>) -> Result<Vec<FileEntry>, String> {
    let base = data_dir();
    let target = match &path {
        Some(p) => base.join(p),
        None => base.clone(),
    };

    // Create data dir if it doesn't exist
    if !target.exists() {
        fs::create_dir_all(&target).map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    read_dir_recursive(&target, &base)
}

fn read_dir_recursive(dir: &Path, base: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let read = fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in read {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs (except .trash)
        if name.starts_with('.') && name != ".trash" {
            continue;
        }

        let relative = path.strip_prefix(base)
            .map_err(|_| "Path error".to_string())?
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
        // Dirs first, then alphabetical
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn ensure_data_dir() -> Result<String, String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}
```

Add `dirs` dependency to `src-tauri/Cargo.toml`:

```toml
dirs = "6"
```

### 3.3 Register commands in main.rs

Update `src-tauri/src/main.rs`:

```rust
mod commands;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::list_dir,
            commands::ensure_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 3.4 Create TypeScript wrappers

Create `src/lib/tauri.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileEntry[] | null;
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke('write_file', { path, content });
}

export async function listDir(path?: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_dir', { path: path ?? null });
}

export async function ensureDataDir(): Promise<string> {
  return invoke<string>('ensure_data_dir');
}
```

**Acceptance:** Can call `readFile`, `writeFile`, `listDir` from the frontend. Files persist to disk.

---

## Task 4: Wire Editor to File System

### 4.1 Create app state

Create `src/lib/stores/app.svelte.ts`:

```ts
import type { FileEntry } from '$lib/tauri';

class AppState {
  currentFile = $state<string | null>(null);   // relative path of open file
  fileContent = $state('');                     // raw .md content
  fileTree = $state<FileEntry[]>([]);           // sidebar tree
  isDirty = $state(false);                      // unsaved changes
  sidebarOpen = $state(true);                   // sidebar visibility
}

export const app = new AppState();
```

### 4.2 Create frontmatter helper

Create `src/lib/frontmatter.ts`:

```ts
import matter from 'gray-matter';

export interface NoteFrontmatter {
  tags?: string[];
  created?: string;
  [key: string]: unknown;
}

export function parseNote(raw: string): { frontmatter: NoteFrontmatter; body: string } {
  const { data, content } = matter(raw);
  return { frontmatter: data as NoteFrontmatter, body: content };
}

export function serializeNote(frontmatter: NoteFrontmatter, body: string): string {
  return matter.stringify(body, frontmatter);
}
```

### 4.3 Auto-save with debounce

Update `src/routes/+page.svelte` to load/save files:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from '$lib/components/Editor.svelte';
  import { app } from '$lib/stores/app.svelte';
  import { readFile, writeFile, listDir, ensureDataDir } from '$lib/tauri';

  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    await ensureDataDir();
    app.fileTree = await listDir();

    // Open first .md file if available
    const firstFile = findFirstFile(app.fileTree);
    if (firstFile) {
      await openFile(firstFile);
    }
  });

  function findFirstFile(entries: typeof app.fileTree): string | null {
    for (const entry of entries) {
      if (!entry.is_dir) return entry.path;
      if (entry.children) {
        const found = findFirstFile(entry.children);
        if (found) return found;
      }
    }
    return null;
  }

  async function openFile(path: string) {
    const content = await readFile(path);
    app.currentFile = path;
    app.fileContent = content;
    app.isDirty = false;
  }

  function handleContentChange(newContent: string) {
    app.fileContent = newContent;
    app.isDirty = true;

    // Debounced auto-save (2 seconds)
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => save(), 2000);
  }

  async function save() {
    if (app.currentFile && app.isDirty) {
      await writeFile(app.currentFile, app.fileContent);
      app.isDirty = false;
    }
  }
</script>

<main class="h-screen bg-white flex flex-col">
  <div class="flex-1 overflow-hidden">
    <Editor content={app.fileContent} onContentChange={handleContentChange} />
  </div>
  {#if app.currentFile}
    <div class="h-8 border-t border-gray-200 px-4 flex items-center text-xs text-gray-400">
      {app.currentFile} {app.isDirty ? '(unsaved)' : ''}
    </div>
  {/if}
</main>
```

**Acceptance:**
1. App opens and loads the first `.md` file from the data directory
2. Edits auto-save to disk after 2 seconds of inactivity
3. Status bar shows current file path and save state

---

## Task 5: First Custom Decorations (if codemirror-live-markdown is unavailable)

If `codemirror-live-markdown` is not available or insufficient, implement these three decorations manually in Week 1:

### 5.1 Headings

Create `src/lib/editor/decorations/headings.ts`:

The decoration should:
- Scan the CM6 syntax tree for `ATXHeading1`, `ATXHeading2`, etc.
- If cursor is NOT on the heading line: use `Decoration.replace()` to hide the `#` markers, and `Decoration.line()` to apply font-size/weight styling
- If cursor IS on the heading line: remove all decorations, show raw `# ` syntax

### 5.2 Emphasis (bold/italic)

Create `src/lib/editor/decorations/emphasis.ts`:

- Scan for `StrongEmphasis` and `Emphasis` nodes
- When cursor is outside: `Decoration.replace()` hides `**`/`*` markers, `Decoration.mark()` applies bold/italic style
- When cursor is inside: show raw markers

### 5.3 Inline code

Create `src/lib/editor/decorations/inline-code.ts`:

- Scan for `InlineCode` nodes
- When cursor is outside: hide backticks, apply monospace + background styling
- When cursor is inside: show backticks

**Pattern for all decorations:**

```ts
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursor = view.state.selection.main.head;

  syntaxTree(view.state).iterate({
    enter(node) {
      // Check node type, check if cursor is inside, add decorations
    },
  });

  return builder.finish();
}

export const headingDecoration = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);
```

---

## Week 1 Acceptance Criteria (All Must Pass)

- [ ] `pnpm tauri dev` opens a native macOS window
- [ ] CodeMirror 6 editor fills the window with Markdown syntax highlighting
- [ ] Typing in the editor works (undo/redo, selections, line wrapping)
- [ ] At least headings, bold/italic, and inline code render in-place (decorations hide markers when cursor is away)
- [ ] Files read from and write to `~/.kosha-data/` (dev path)
- [ ] Auto-save fires 2 seconds after last keystroke
- [ ] Status bar shows current file name and dirty state
- [ ] `pnpm tauri build` produces a working `.dmg` / `.app` bundle

---

## Fallback: codemirror-live-markdown Unavailable

If the library is not on npm or its API differs from expected:

1. Check `https://github.com/blueberrycongee/codemirror-live-markdown` for install instructions
2. If unusable, skip it entirely and build all decorations manually using the CM6 `ViewPlugin` + `Decoration` pattern shown above
3. The manual approach is proven (Obsidian uses it) but will add ~3-5 days of work spread across Weeks 1-2
4. Also check the CM6 community extension for "hybrid markdown editing" from `discuss.codemirror.net` (Jan 2026) as another starting point
