# Kosha

> **कोश** (Sanskrit: "treasury") — A minimal personal knowledge keeper for macOS.

Kosha is a native macOS app for writing and organizing Markdown notes with **live in-place rendering** — type `# Heading`, the `#` hides and your text renders as a styled heading. Move your cursor back in and the syntax reappears for editing. No mode switching, no preview pane.

![Kosha editor](https://placeholder.example/screenshot.png)

---

## Features

- **Live Markdown rendering** — headings, bold, italic, strikethrough, inline code, blockquotes, links, checkboxes, horizontal rules, wiki-links, and YAML frontmatter all render in-place
- **Plain `.md` files** — no proprietary format, no lock-in; your notes work in any editor
- **Full-text search** — SQLite FTS5 index with porter stemming; `Cmd+K` quick-switcher, `Cmd+Shift+F` full-text search
- **Wiki-links** — `[[Note Name]]` navigates between notes; backlinks panel shows what links to the current note
- **Tags** — YAML frontmatter tags with sidebar filtering
- **Dark / light theme** — toggle with `Cmd+Shift+T`, persists across restarts
- **Auto-save** — debounced 2-second write to disk; `Cmd+S` for manual save
- **iCloud sync ready** — production data lives in `~/Library/Mobile Documents/com~kosha/`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri v2](https://tauri.app) (Rust backend, ~5 MB bundle) |
| Frontend | [Svelte 5](https://svelte.dev) + [SvelteKit](https://kit.svelte.dev) |
| Language | TypeScript (strict mode) |
| Editor | [CodeMirror 6](https://codemirror.net) |
| Styling | [TailwindCSS v4](https://tailwindcss.com) |
| Math | [KaTeX](https://katex.org) |
| Search | SQLite FTS5 via [`rusqlite`](https://github.com/rusqlite/rusqlite) |
| Package manager | pnpm |

---

## Getting Started

### Prerequisites

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Node (via nvm or direct)
node --version   # >= 18

# pnpm
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

### Install & run

```bash
git clone <repo-url> kosha
cd kosha
pnpm install

# Development (hot reload)
pnpm tauri dev

# Production build
pnpm tauri build
```

> **First run:** the app creates `~/.kosha-data/` and indexes any `.md` files it finds there. A sample "Getting Started" note is included.

---

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Quick switcher | `Cmd+K` |
| Full-text search | `Cmd+Shift+F` |
| New note | `Cmd+N` |
| Toggle sidebar | `Cmd+B` |
| Find in current note | `Cmd+F` |
| Toggle source / live mode | `Cmd+/` |
| Toggle dark / light theme | `Cmd+Shift+T` |
| Manual save | `Cmd+S` |
| Go back / forward | `Cmd+[` / `Cmd+]` |

---

## Project Structure

```
kosha/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte       # Root layout: sidebar + keyboard shortcuts
│   │   ├── +layout.ts           # SSR disabled (required for Tauri)
│   │   └── +page.svelte         # Editor page: load/save, backlinks, status bar
│   └── lib/
│       ├── components/
│       │   ├── Editor.svelte    # CodeMirror 6 wrapper
│       │   ├── Sidebar.svelte   # File tree, favorites, recent, tags
│       │   ├── SearchModal.svelte
│       │   ├── Backlinks.svelte
│       │   └── StatusBar.svelte
│       ├── editor/
│       │   ├── setup.ts         # CM6 extensions, theme/decoration compartments
│       │   ├── wiki-links.ts    # [[wiki-link]] decoration
│       │   ├── frontmatter-badge.ts
│       │   └── decorations/
│       │       ├── headings.ts
│       │       ├── emphasis.ts
│       │       ├── inline-code.ts
│       │       ├── blockquotes.ts
│       │       ├── links.ts
│       │       ├── checkboxes.ts
│       │       └── hr.ts
│       ├── stores/
│       │   └── app.svelte.ts    # Global state (Svelte 5 $state runes)
│       ├── frontmatter.ts       # gray-matter wrapper
│       └── tauri.ts             # Typed invoke() wrappers
├── src-tauri/
│   └── src/
│       ├── main.rs
│       ├── lib.rs               # App setup, search commands
│       ├── commands.rs          # File I/O, trash, settings, tags
│       └── search.rs            # SQLite FTS5 index
├── specs/                       # Product specification
│   ├── SPEC.md
│   ├── WEEK1.md  ✅
│   ├── WEEK2.md
│   ├── WEEK3.md
│   └── WEEK4.md
└── static/
    └── favicon.png
```

---

## Data Directory

```
~/.kosha-data/            # Dev (switches to iCloud in production)
  .kosha/
    settings.json         # Theme, favorites, editor preferences
    search.db             # SQLite FTS5 index (rebuilt on each machine)
  welcome/
    Getting Started.md
  your-folder/
    your-note.md
  .trash/                 # Soft-deleted notes (purged after 30 days)
```

### Note format

```markdown
---
tags: [python, pandas]
created: 2026-02-20T10:00:00Z
---

# Handling Missing Values

Use `df.dropna()` or `df.fillna()` ...
```

---

## Build Phases

| Week | Scope | Status |
|---|---|---|
| **Week 1** | Editor core — Tauri + SvelteKit + CM6 + live preview + file I/O | ✅ Complete |
| **Week 2** | Remaining decorations (math, images, tables, code blocks) + sidebar file tree | 🔲 Planned |
| **Week 3** | Search + wiki-links + backlinks + tag panel | 🔲 Planned |
| **Week 4** | Polish — dark theme, toolbar, trash, templates, iCloud conflict detection | 🔲 Planned |

---

## Performance Targets

| Metric | Target |
|---|---|
| Open a note | < 30 ms |
| Decoration render per keystroke | < 16 ms (60 fps) |
| Full-text search (5 k notes) | < 100 ms |
| App cold start | < 1.5 s |
| App bundle | < 8 MB |

---

## Scope

Kosha is intentionally minimal. It will **not** include:

- Split-pane editor, block editor, or rich-text WYSIWYG
- Databases, Kanban boards, or task management
- AI, semantic search, or embeddings
- Real-time collaboration or self-hosted sync
- Plugins or a scripting API
- Windows, Linux, iOS, Android, or web

---

## License

MIT
