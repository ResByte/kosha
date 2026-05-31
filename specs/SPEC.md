# Kosha — Technical Specification

> **कोश** (Sanskrit: "treasury") — A minimal personal knowledge keeper for macOS.
> Current release: **v0.3.0**

---

## Overview

Kosha is a native macOS desktop app for writing and organizing Markdown notes with **live in-place rendering** (Obsidian-style). Notes are plain `.md` files stored anywhere on disk or in iCloud. No server, no proprietary format, no lock-in.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Desktop shell | [Tauri v2](https://tauri.app) | `^2.10` |
| Frontend | [Svelte 5](https://svelte.dev) + SvelteKit | `svelte@^5`, `@sveltejs/kit@^2` |
| Language | TypeScript (strict) | `^5.x` |
| Editor | [CodeMirror 6](https://codemirror.net) | `@codemirror/*` latest |
| Styling | TailwindCSS v4 | `^4.1` |
| Math rendering | KaTeX | `^0.16` |
| Search | SQLite FTS5 via `rusqlite` | latest |
| File watching | `notify` crate | `7` |
| Frontmatter | `js-yaml` | `^4.x` |
| SvelteKit adapter | `@sveltejs/adapter-static` | latest |
| Package manager | pnpm | latest |

> All Markdown decorations are custom CM6 `StateField` / `ViewPlugin` implementations — no third-party live-preview library.

---

## Project Structure

```
kosha/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte       # Shell: sidebar, event listeners, theme persistence
│   │   ├── +layout.ts           # SSR disabled (required for Tauri)
│   │   └── +page.svelte         # Editor: load/save, shortcuts, templates
│   └── lib/
│       ├── components/
│       │   ├── Sidebar.svelte         # File tree, favorites, recent, tags, trash
│       │   ├── SearchModal.svelte     # Cmd+K / Cmd+Shift+F overlay
│       │   ├── StatusBar.svelte       # Word count, mode indicator
│       │   ├── TemplateModal.svelte   # Template picker, {{date}} substitution
│       │   ├── ConflictModal.svelte   # iCloud conflict resolution
│       │   ├── SetupModal.svelte      # First-run data directory picker
│       │   └── ChangeFolderModal.svelte
│       ├── editor/
│       │   ├── setup.ts         # CM6 editor factory, compartments, image drop
│       │   ├── decorations.ts   # All live-preview decorations (block + inline)
│       │   ├── floating-toolbar.ts   # Selection-triggered formatting bar
│       │   └── context.ts       # dataDirPath reactive store for image resolution
│       ├── stores/
│       │   └── app.svelte.ts    # Global AppState class (Svelte 5 $state runes)
│       ├── frontmatter.ts       # js-yaml parse/serialize, Date normalisation
│       └── tauri.ts             # Typed wrappers around every invoke() call
├── src-tauri/
│   └── src/
│       ├── lib.rs               # App entry, AppSearchIndex + WatcherState, command registration
│       ├── commands.rs          # All file I/O commands, data_dir(), app_config_dir()
│       ├── search.rs            # SQLite FTS5 index (porter stemmer), backlink lookup
│       ├── watcher.rs           # notify v7 watcher, emits file-changed / icloud-conflict
│       └── import.rs            # Notion ZIP + folder import
├── screenshots/
│   ├── light.png
│   └── dark.png
├── gen_icon.py                  # Icon generator (Pillow, 1024×1024)
└── icon.png                     # Source icon (1024×1024)
```

---

## Data Layout

| Path | Purpose |
|---|---|
| `~/.kosha/config.json` | Chosen notes directory (never synced) |
| `~/.kosha/settings.json` | UI settings (theme) |
| `~/.kosha/search.db` | SQLite FTS5 index (rebuilt per machine) |
| `~/kosha-data/` | Default notes directory (user-configurable) |
| `~/Library/Mobile Documents/com~apple~CloudDocs/Kosha` | iCloud notes path |
| `<data-dir>/.trash/` | Soft-deleted notes (auto-purged after 30 days) |

In tests, `KOSHA_TEST_DATA_DIR` and `KOSHA_TEST_CONFIG_DIR` override these paths.

---

## Note Format

```markdown
---
tags: [python, pandas]
created: 2026-05-30
---

# Handling Missing Values

Use `df.dropna()` or `df.fillna()` ...
```

Frontmatter is parsed with `js-yaml`. Tags are arrays. `created` is `YYYY-MM-DD`.

---

## Editor Behavior

**Live in-place rendering** — the core UX:

1. Type `# Heading` → the `#` hides, text renders as a styled heading
2. Click on the heading → the `#` reappears for editing
3. Move cursor away → the `#` hides again

This applies to all Markdown elements. Implemented as custom CM6 decorations:

| Element | Decorator |
|---|---|
| Headings | `inlineDecorationsPlugin` (ViewPlugin) |
| Bold / Italic / Strikethrough | `inlineDecorationsPlugin` |
| Inline code | `inlineDecorationsPlugin` |
| Links | `inlineDecorationsPlugin` → `LinkWidget` (span) |
| Images | `inlineDecorationsPlugin` → `ImageWidget` |
| Checkboxes | `inlineDecorationsPlugin` → `CheckboxWidget` |
| Horizontal rules | `inlineDecorationsPlugin` → `HRWidget` |
| Inline math `$...$` | `inlineDecorationsPlugin` → `MathWidget` (KaTeX) |
| Block math `$$...$$` | `inlineDecorationsPlugin` → `MathWidget` (KaTeX) |
| Wiki-links `[[Name]]` | `inlineDecorationsPlugin` → `WikiLinkWidget` |
| Blockquotes | `inlineDecorationsPlugin` (line class + hide `>`) |
| Fenced code blocks | `blockDecorationsField` (StateField) → `CodeBlockWidget` |
| Tables | `blockDecorationsField` (StateField) → `TableWidget` |
| YAML frontmatter | `blockDecorationsField` (StateField) → `FrontmatterBadgeWidget` |

Block decorations live in a `StateField` (CM6 requirement). Inline decorations live in a `ViewPlugin`. Both are viewport-bounded — only visible lines are processed.

---

## Performance Design

- **Viewport-bounded decoration**: `syntaxTree().iterate()` is scoped to `visibleRanges`; math and wiki-link regex scans loop only over visible lines
- **Line-change guards**: block and inline rebuilds only trigger when the cursor crosses a line boundary (not on every selection change)
- **Fast widget equality**: `TableWidget.eq()` uses cell-by-cell comparison instead of `JSON.stringify`
- **Auto-save**: 2-second debounce on content changes

---

## Color Scheme

Derived from the app icon (indigo → amber gradient, cream K):

| Token | Light | Dark |
|---|---|---|
| `--color-primary` | `#9B5C15` (amber) | `#D4A853` (gold) |
| `--color-surface` | `#FFFDF8` (warm white) | `#18161F` (dark charcoal) |
| `--color-surface-alt` | `#F7F0E4` (warm beige) | `#201E29` |
| `--color-text` | `#1E1649` (deep indigo) | `#EDE3CA` (warm cream) |
| `--color-text-muted` | `#6B587A` | `#8A8070` |
| `--color-border` | `#E0D5C5` (warm tan) | `#2E2B3A` |

---

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Quick switcher | `Cmd+K` |
| Full-text search | `Cmd+Shift+F` |
| New note | `Cmd+N` |
| New note from template | `Cmd+Shift+N` |
| Toggle sidebar | `Cmd+B` |
| Toggle source / live mode | `Cmd+/` |
| Toggle dark / light theme | `Cmd+Shift+T` |
| Manual save | `Cmd+S` |

---

## Adding a New Tauri Command

1. Add `#[tauri::command]` fn in `commands.rs` (or a new module)
2. Register it in `tauri::generate_handler![…]` in `lib.rs`
3. Add a typed wrapper in `src/lib/tauri.ts`

---

## Scope Exclusions

- No split-pane editor, block editor, or WYSIWYG
- No databases, Kanban boards, or task management
- No AI, semantic search, or embeddings
- No real-time collaboration or self-hosted sync
- No plugins or scripting API
- No Windows, Linux, iOS, Android, or web
