# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**PATH setup required** — Rust and pnpm are not on the default PATH:
```sh
export PNPM_HOME="$HOME/Library/pnpm" && export PATH="$PNPM_HOME:$PATH"
source "$HOME/.cargo/env"
```

| Task | Command |
|------|---------|
| Frontend build | `pnpm build` |
| Rust type-check | `cd src-tauri && cargo check` |
| Dev server (hot-reload) | `pnpm tauri dev` |
| Production DMG | `pnpm tauri build` |
| TS type-check | `pnpm check` |
| Run all JS tests | `pnpm test` |
| Run single JS test file | `pnpm test -- src/lib/tauri.test.ts` |
| Watch JS tests | `pnpm test:watch` |
| Run Rust tests (single-threaded) | `cd src-tauri && cargo test -- --test-threads=1` |

> Rust integration tests mutate `KOSHA_TEST_DATA_DIR` / `KOSHA_TEST_CONFIG_DIR` env vars, so they **must** run single-threaded.

## Architecture Overview

Kosha is a native macOS Markdown note-taking app built with **Tauri v2** (Rust backend) + **SvelteKit 5** (frontend) + **CodeMirror 6** editor + **TailwindCSS v4**.

### Data & config layout

| Path | Purpose |
|------|---------|
| `~/.kosha/config.json` | Stores chosen notes directory (never synced) |
| `~/.kosha/settings.json` | UI settings (theme, etc.) |
| `~/.kosha/search.db` | SQLite FTS5 search index |
| `~/kosha-data/` | Default notes directory (user-configurable) |
| `~/Library/Mobile Documents/com~apple~CloudDocs/Kosha` | iCloud notes path |
| `<data-dir>/.trash/` | Soft-deleted notes (timestamp-prefixed, auto-purged after 30 days) |

In tests, `KOSHA_TEST_DATA_DIR` and `KOSHA_TEST_CONFIG_DIR` override these paths to isolate from real user files.

### Rust backend (`src-tauri/src/`)

- **[lib.rs](src-tauri/src/lib.rs)** — App entry: initialises `AppSearchIndex` + `WatcherState`, registers all Tauri commands, rebuilds index and starts watcher on startup.
- **[commands.rs](src-tauri/src/commands.rs)** — All file I/O commands. `data_dir()` and `app_config_dir()` are the two canonical path resolvers used everywhere; both respect test env-var overrides. `change_data_dir` is a compound command: saves config → rebuilds index → restarts watcher → emits `data-dir-changed`.
- **[search.rs](src-tauri/src/search.rs)** — SQLite FTS5 index (porter stemmer). Supports full-text search, title listing, and backlink lookup.
- **[watcher.rs](src-tauri/src/watcher.rs)** — `notify` v7 file watcher stored in `WatcherState(Mutex<Option<RecommendedWatcher>>)`. Replacing the inner watcher drops the old one, cleanly stopping its event thread. Emits `file-changed` and `icloud-conflict` Tauri events to the frontend.
- **[import.rs](src-tauri/src/import.rs)** — Notion ZIP and folder import.

### Frontend (`src/`)

- **[src/lib/stores/app.svelte.ts](src/lib/stores/app.svelte.ts)** — Single global `AppState` class using Svelte 5 `$state` runes. All UI state lives here (current file, file tree, search, tags, backlinks, theme, modals, trash).
- **[src/lib/tauri.ts](src/lib/tauri.ts)** — Typed wrappers around every `invoke()` call. This is the only place that calls `invoke` directly; all components go through these functions.
- **[src/lib/editor/setup.ts](src/lib/editor/setup.ts)** — CM6 editor factory. Exports `decorationCompartment` and `themeCompartment` (swappable at runtime). The `allDecorations` array is order-sensitive: block-level decorations (code blocks, math, tables, images) must come before inline ones.
- **[src/lib/editor/decorations/](src/lib/editor/decorations/)** — One file per Markdown element type. Each exports a `*Decoration` (ViewPlugin/StateField) and a `*Theme` (EditorView.theme).
- **[src/lib/frontmatter.ts](src/lib/frontmatter.ts)** — YAML frontmatter parse/serialize using `js-yaml`. Normalises `Date` objects from js-yaml back to `YYYY-MM-DD` strings.
- **[src/routes/+layout.svelte](src/routes/+layout.svelte)** — Shell layout: sidebar + main area. Registers `file-changed`, `icloud-conflict`, and `data-dir-changed` Tauri event listeners. Persists `app.theme` to settings via `$effect`.
- **[src/routes/+page.svelte](src/routes/+page.svelte)** — Editor page. Handles auto-save, note creation, template expansion (`{{date}}`), tag loading, and keyboard shortcuts (`Cmd+N`, `Cmd+Shift+N`).

### Key global keyboard shortcuts (handled in `+layout.svelte` / `+page.svelte`)

| Shortcut | Action |
|----------|--------|
| `Cmd+B` | Toggle sidebar |
| `Cmd+K` | Quick switcher |
| `Cmd+Shift+F` | Full-text search |
| `Cmd+Shift+T` | Toggle dark/light theme |
| `Cmd+/` | Toggle source/preview mode |
| `Cmd+N` | New note |
| `Cmd+Shift+N` | New note from template |

### Testing strategy

- **JS unit tests** (`vitest` + `happy-dom`): `src/test-setup.ts` mocks `@tauri-apps/api/core` and `@tauri-apps/api/event` globally. Test files live alongside source as `*.test.ts`.
- **Rust integration tests** (`cargo test`): Live in `#[cfg(test)]` blocks inside each module. Use `tempfile::TempDir` + `KOSHA_TEST_DATA_DIR`/`KOSHA_TEST_CONFIG_DIR` env vars to isolate from user data. Must run single-threaded due to shared env vars.

### Adding a new Tauri command

1. Add the `#[tauri::command]` function in `commands.rs` (or a new module).
2. Register it in the `tauri::generate_handler![…]` list in `lib.rs`.
3. Add a typed wrapper in `src/lib/tauri.ts`.
