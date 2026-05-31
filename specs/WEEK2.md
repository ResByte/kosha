# Week 2: Remaining Decorations + Navigation ✅

> **Status: Complete**
> **Goal:** Full live-preview editor with all Markdown elements. Browse and create notes in folder tree.

> **Depends on:** Week 1 complete (Tauri + SvelteKit + CM6 + basic decorations + file I/O)

---

## Task 1: Complete All Editor Decorations

By end of this task, every GFM Markdown element should render in-place.

### 1.1 Code blocks with syntax highlighting

File: `src/lib/editor/decorations/code-blocks.ts` (or via `codemirror-live-markdown`)

Behavior:
- `` ```python `` → fenced code block renders with Lezer-based syntax highlighting
- The `` ``` `` fence markers hide when cursor is outside the block
- Show language label (e.g., "python") in top-right corner of the block
- Show "Copy" button on hover (copies block content to clipboard)
- Background: light gray (`bg-gray-50` / dark mode equivalent)
- Font: monospace (`var(--font-mono)`)

Implementation:
- Use `Decoration.widget()` to replace the entire code block range with a custom widget
- Inside the widget, use Lezer parsers from `@codemirror/language-data` for highlighting
- When cursor enters the block range, remove widget, show raw fenced Markdown

### 1.2 Math (KaTeX)

File: `src/lib/editor/decorations/math.ts` (or via `codemirror-live-markdown`)

```bash
pnpm add katex
```

Behavior:
- `$E = mc^2$` → renders inline KaTeX math
- `$$\int_0^1 f(x) dx$$` → renders block-level KaTeX math
- When cursor is inside, show raw `$...$` or `$$...$$` syntax

Implementation:
- Use `Decoration.widget()` with a DOM element containing `katex.renderToString()`
- Add KaTeX CSS: import `katex/dist/katex.min.css` in `app.css` or load via CDN

### 1.3 Images

File: `src/lib/editor/decorations/images.ts` (or via `codemirror-live-markdown`)

Behavior:
- `![alt text](./assets/photo.png)` → renders the image inline
- Resolve relative paths against the data directory
- Max width: 100% of editor content area
- When cursor is on the image line, show raw Markdown syntax

Implementation:
- `Decoration.widget()` replacing the full line range
- Widget creates an `<img>` element
- For Tauri, use `convertFileSrc()` from `@tauri-apps/api/core` to convert file paths to webview-accessible URLs

### 1.4 Links

File: `src/lib/editor/decorations/links.ts` (or via `codemirror-live-markdown`)

Behavior:
- `[text](url)` → collapse to show only `text` styled as a link (underlined, blue)
- `Cmd+click` opens URL in default browser (via Tauri `shell.open()`)
- When cursor is on the link, expand to show full `[text](url)` syntax

### 1.5 Checkboxes

Behavior:
- `- [ ] task` → renders as ☐ with text
- `- [x] task` → renders as ☑ with text (strikethrough optional)
- Clicking the checkbox toggles `[ ]` ↔ `[x]` in the source

### 1.6 Blockquotes (custom)

File: `src/lib/editor/custom-decorations.ts`

Behavior:
- `> text` → hide `> ` marker, apply left blue border + light background to the line
- Nesting supported (`>> text` gets double indent)

Implementation:
- `Decoration.replace()` to hide `> ` markers
- `Decoration.line()` to add CSS class with `border-left: 3px solid var(--color-primary); padding-left: 1rem; background: var(--color-surface-light);`

### 1.7 Horizontal rules (custom)

Behavior:
- `---` or `***` or `___` → replace with a styled `<hr>` widget
- When cursor is on the line, show raw `---`

### 1.8 Tables (custom)

Behavior:
- GFM tables render as a formatted HTML table widget
- When cursor is inside the table block, show raw pipe-delimited syntax
- No table editing UI (just rendering)

### 1.9 Frontmatter badge (custom)

File: `src/lib/editor/frontmatter-badge.ts`

Behavior:
- YAML frontmatter block (`---\n...\n---`) collapses into a small badge: "📋 Metadata (3 fields)"
- Click the badge or move cursor into frontmatter area to expand and show raw YAML
- When cursor moves out, collapse again

---

## Task 2: Sidebar File Tree

### 2.1 Create Sidebar component

File: `src/lib/components/Sidebar.svelte`

```svelte
<script lang="ts">
  import { app } from '$lib/stores/app.svelte';
  import { readFile, listDir } from '$lib/tauri';
  import type { FileEntry } from '$lib/tauri';

  async function openFile(entry: FileEntry) {
    if (entry.is_dir) return;
    const content = await readFile(entry.path);
    app.currentFile = entry.path;
    app.fileContent = content;
    app.isDirty = false;
  }
</script>

<!-- Render file tree recursively -->
<!-- Folders: collapsible, bold, folder icon -->
<!-- Files: .md files, click to open, highlight active file -->
<!-- Show: favorites section at top, then file tree -->
```

Requirements:
- Recursive tree rendering with collapsible folders
- Active file highlighted (by matching `app.currentFile`)
- Icons: 📁 for folders, 📄 for files (or use simple SVG icons)
- Width: 260px, resizable with drag handle (stretch goal)
- `Cmd+B` toggles sidebar visibility

### 2.2 Create new note

Add a "New Note" button (+ icon) in the sidebar header.

Behavior:
- Click → prompt for note name (or generate as `Untitled-YYYY-MM-DD.md`)
- Create file with default frontmatter:
  ```yaml
  ---
  tags: []
  created: 2026-02-25T10:00:00Z
  ---

  # Note Title
  ```
- Open the new note in the editor
- Refresh file tree

### 2.3 Create new folder

Add "New Folder" option (right-click context menu or button).

Tauri command needed in `commands.rs`:

```rust
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    let full_path = data_dir().join(&path);
    fs::create_dir_all(&full_path).map_err(|e| format!("Failed to create dir: {}", e))
}
```

### 2.4 Favorites & Recent

In `app.svelte.ts`, add:

```ts
favorites = $state<string[]>([]);    // paths of favorited notes
recentFiles = $state<string[]>([]);  // last 10 opened files
```

Persist to `.kosha/settings.json` via Tauri commands. Load on startup.

Sidebar sections (top to bottom):
1. **Favorites** — pinned notes (star icon to toggle)
2. **Recent** — last 10 opened notes
3. **Files** — full folder tree

---

## Task 3: Update Layout

### 3.1 Root layout with sidebar + editor

Update `src/routes/+layout.svelte`:

```svelte
<script>
  import '../app.css';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import { app } from '$lib/stores/app.svelte';

  let { children } = $props();
</script>

<div class="h-screen flex">
  {#if app.sidebarOpen}
    <aside class="w-64 border-r border-gray-200 bg-gray-50 flex-shrink-0 overflow-y-auto">
      <Sidebar />
    </aside>
  {/if}
  <main class="flex-1 overflow-hidden">
    {@render children()}
  </main>
</div>
```

### 3.2 Keyboard shortcut: Cmd+B to toggle sidebar

Register in `src/lib/editor/setup.ts` or as a global Svelte handler:

```ts
function handleKeydown(e: KeyboardEvent) {
  if (e.metaKey && e.key === 'b') {
    e.preventDefault();
    app.sidebarOpen = !app.sidebarOpen;
  }
}
```

---

## Week 2 Acceptance Criteria (All Must Pass)

- [ ] All Markdown elements render in-place: headings, bold, italic, strikethrough, links, images, code blocks (with syntax highlighting), inline code, math (KaTeX), checkboxes, blockquotes, horizontal rules, tables, frontmatter badge
- [ ] Cursor entering a decorated element reveals raw Markdown syntax; cursor leaving re-applies decoration
- [ ] Sidebar shows file tree matching disk structure
- [ ] Clicking a file in sidebar opens it in the editor
- [ ] "New Note" creates a file with default frontmatter and opens it
- [ ] "New Folder" creates a directory
- [ ] Favorites section shows pinned notes
- [ ] Recent section shows last 10 opened files
- [ ] `Cmd+B` toggles sidebar visibility
- [ ] Code blocks show language label and copy button
- [ ] Images render inline (using `convertFileSrc` for Tauri paths)
- [ ] Math renders via KaTeX (inline and block)
