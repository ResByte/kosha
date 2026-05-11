# Kosha — Project Specification

> **कोश** (Sanskrit: "treasury") — A minimal personal knowledge keeper for macOS.

## What You Are Building

A native macOS desktop app for writing and organizing Markdown notes with **live in-place rendering** (Typora/Obsidian-style). Notes are plain `.md` files stored in iCloud Drive. No server, no database for content, no collaboration.

---

## Tech Stack (Pinned Versions)

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Desktop Shell | Tauri v2 | `^2.10` | Rust backend, ~5 MB bundle |
| Frontend | Svelte 5 + SvelteKit | `svelte@^5.25`, `@sveltejs/kit@^2.20` | Compiler-based, no vDOM |
| Language | TypeScript | `^5.x` | Strict mode |
| Editor Engine | CodeMirror 6 | `@codemirror/*` latest | Framework-agnostic text editor |
| Live Preview | codemirror-live-markdown | latest | Composable CM6 plugins for Obsidian-style inline rendering |
| Math | KaTeX | `^0.16` | LaTeX rendering in editor widgets |
| Code Highlighting | Lezer | Built into CM6 | No extra dependency |
| CSS | TailwindCSS v4 | `^4.1` | Use `@tailwindcss/vite` plugin. CSS-first `@theme` config. |
| State | Svelte `$state` runes | Built-in | No external state library |
| Search | SQLite FTS5 via `rusqlite` | latest | In Tauri Rust backend |
| File Watching | `notify` crate | latest | Detect iCloud changes |
| Frontmatter | `gray-matter` | `^4.x` | YAML frontmatter parse/serialize |
| SvelteKit Adapter | `@sveltejs/adapter-static` | latest | Static SPA for Tauri (SSR disabled) |
| Package Manager | pnpm | latest | — |

---

## Project Structure

```
kosha/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs                 # Window setup, menu, global shortcuts
      commands.rs             # Tauri commands: read_file, write_file, list_dir, search
      search.rs               # FTS5 index build + query
      watcher.rs              # File watcher for iCloud changes
  src/
    routes/
      +layout.svelte          # Root layout: sidebar + main area
      +layout.ts              # export const ssr = false (required for Tauri)
      +page.svelte            # Editor page
    lib/
      components/
        Sidebar.svelte        # File tree, favorites, tags, recent
        Editor.svelte         # CodeMirror 6 wrapper + plugin setup
        SearchModal.svelte    # Cmd+K / Cmd+Shift+F overlay
        Backlinks.svelte      # Backlinks panel below editor
        Settings.svelte       # Theme, editor font/size
      editor/
        setup.ts              # CM6 extensions array: live-markdown plugins + custom decorations
        custom-decorations.ts # Blockquotes, HR, tables (gaps not covered by live-markdown)
        wiki-links.ts         # [[wiki-link]] decoration and click-to-navigate
        frontmatter-badge.ts  # Collapsible metadata badge at top of note
      stores/
        app.svelte.ts         # Svelte $state runes: open file, sidebar state, search results
      frontmatter.ts          # gray-matter wrapper: parse/serialize YAML frontmatter
      tauri.ts                # Typed wrappers around Tauri invoke() calls
    app.css                   # TailwindCSS v4: @import "tailwindcss"; @theme { ... }
  svelte.config.js            # SvelteKit config with adapter-static
  vite.config.ts              # Vite + @tailwindcss/vite plugin
  package.json
```

---

## Data Directory

All user data lives in iCloud Drive:

```
~/Library/Mobile Documents/com~kosha/
  .kosha/                        # App config (LOCAL ONLY, not synced)
    settings.json                # Preferences, theme, favorites list
    search.db                    # FTS5 index (rebuilt from files on each machine)
  work/                          # User folders (examples)
  learning/
  personal/
  references/
  templates/
    daily-journal.md
  .trash/                        # Soft-deleted notes (30-day retention)
```

The `.kosha/` directory should be excluded from iCloud sync (use `.nosync` suffix or store outside the iCloud container).

---

## Note Format

Every note is a `.md` file with optional YAML frontmatter:

```markdown
---
tags: [python, pandas]
created: 2026-02-20T10:00:00Z
---

# Handling Missing Values

Use `df.dropna()` or `df.fillna()` ...
```

Frontmatter is parsed with `gray-matter`. Tags are arrays. `created` is ISO 8601.

---

## Editor Behavior (Critical)

The editor uses **in-place live rendering**. This is the core UX:

1. User types `# Heading` → the `#` hides, text renders as a styled heading
2. User clicks on that heading → the `#` reappears for editing
3. User moves cursor away → the `#` hides again, heading style re-applies

This applies to ALL Markdown elements: bold, italic, links, images, code blocks, math, checkboxes, etc.

**Implementation:** CodeMirror 6 with `codemirror-live-markdown` plugins provide this behavior. The library handles the cursor-in/cursor-out decoration toggling.

| Markdown Element | Plugin Source |
|---|---|
| Headings `#` | `codemirror-live-markdown` |
| Bold/Italic/Strikethrough | `codemirror-live-markdown` |
| Links `[text](url)` | `codemirror-live-markdown` |
| Images `![alt](path)` | `codemirror-live-markdown` |
| Code blocks `` ```lang `` | `codemirror-live-markdown` + Lezer |
| Inline code `` `code` `` | `codemirror-live-markdown` |
| Math `$...$` / `$$...$$` | `codemirror-live-markdown` (KaTeX) |
| Checkboxes `- [ ]` | `codemirror-live-markdown` |
| Blockquotes `>` | Custom CM6 decoration |
| Horizontal rules `---` | Custom CM6 decoration |
| Tables | Custom CM6 decoration |
| `[[wiki-links]]` | Custom CM6 decoration |
| Frontmatter badge | Custom CM6 decoration |

---

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Quick switcher | `Cmd+K` |
| Full-text search | `Cmd+Shift+F` |
| New note | `Cmd+N` |
| New note in current folder | `Cmd+Shift+N` |
| Toggle sidebar | `Cmd+B` |
| Go back / forward | `Cmd+[ / Cmd+]` |
| Find in current note | `Cmd+F` |
| Toggle source/live mode | `Cmd+/` |
| Toggle dark/light theme | `Cmd+Shift+T` |
| Manual save | `Cmd+S` |

---

## Performance Targets

| Metric | Target |
|---|---|
| Open a note | < 30ms |
| Decoration render (per keystroke) | < 16ms (60fps) |
| Full-text search (5k notes) | < 100ms |
| App cold start | < 1.5s |
| App bundle size | < 8 MB |
| Frontend JS payload | < 5 KB gzipped (excl. CM6) |
| Memory (idle) | < 100 MB |
| Codebase | < 4,000 lines total |

---

## Build Phases

The project is built in 4 weekly phases. Each phase has its own spec file:

- [`WEEK1.md`](./WEEK1.md) — Editor Core (Tauri + SvelteKit + CM6 + live preview + file I/O)
- [`WEEK2.md`](./WEEK2.md) — Math, Images, Navigation (remaining decorations + sidebar file tree)
- [`WEEK3.md`](./WEEK3.md) — Search + Links (FTS5 + quick switcher + wiki-links + backlinks)
- [`WEEK4.md`](./WEEK4.md) — Polish (themes, toolbar, trash, templates, conflict detection)

**Each phase must be shippable.** At the end of each week, the app should be usable for its stated purpose.

---

## Scope Exclusions (Do NOT Build)

- No split-pane editor, block editor, or rich text WYSIWYG
- No databases, tables view, Kanban boards, task management
- No AI, LLM, semantic search, embeddings
- No reminders, recurring tasks, automations
- No graph view (backlinks panel only)
- No S3, self-hosted sync, CRDT, real-time collaboration
- No plugins, extensions, scripting API
- No Windows, Linux, iOS, Android, web app
