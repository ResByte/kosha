# Kosha refactor & mobile plan — review

Status: draft for discussion, not yet committed to.
Date: 2026-05-11.

## TL;DR

Two-part plan: (A) prune the Tauri desktop app — don't rewrite — to land an Obsidian-feel core in ~1.8k LOC, and (B) build a separate native SwiftUI iOS client that reads the same iCloud Drive folder. The two apps share no code, only files on disk.

This document captures the plan and a critical review of its assumptions, risks, and unknowns.

---

## Part A — Prune the desktop app

### A1. Delete unused features
- Notion import (`src-tauri/src/import.rs`, ~440 LOC; `NotionImportModal.svelte`).
- Template modal + `{{date}}` expansion.
- Custom in-app trash (`.trash/`, `list_trash`, `restore_from_trash`, `purge_old_trash`) → replace with system Trash via the `trash` crate.
- `SetupModal` + `ChangeFolderModal` → one Settings sheet.
- `Backlinks.svelte` panel → inline backlinks at the bottom of the note.
- `Outline.svelte` → optional popover via `Cmd+;`, or delete.
- `floating-toolbar.ts` + `formatting.test.ts` → keyboard-only formatting.
- `frontmatter-badge.ts` → fold into the consolidated decorations module.

Estimated removal: ~1200 LOC.

### A2. Consolidate decorations
Merge 11 files in `src/lib/editor/decorations/` into one `decorations.ts` that walks the syntax tree once and emits all decoration types in a single visitor. Today each plugin walks separately. Single-pass wins on both perf and LOC.

### A3. Move tags into FTS5
Add a `tags` column to the search index at index time. Drop `list_all_tags` / `list_notes_by_tag` and the recursive frontmatter scanner in `commands.rs` (~130 LOC).

### A4. Command palette
Single `CommandPalette.svelte` (`Cmd+K`) replaces SearchModal + switcher + assorted small modals. Modes: quick switch, full-text search, new note, open settings.

### A5. Reduced Rust surface
`commands.rs` drops from 841 → ~350 LOC. Keep file I/O, settings, data-dir management. Drop iCloud-path special-cases — let the user pick any folder via native dialog.

### A6. Cold-start
Move the startup `SearchIndex::rebuild` off the main thread; emit `index-ready` when done. Audit `tauri-plugin-shell` for actual use.

### Execution order
1. Delete unused (mechanical, low risk).
2. Merge decorations.
3. Consolidate modals into command palette.
4. Tags into FTS5.
5. Background indexing on startup.

---

## Part B — Native SwiftUI iOS client

Same iCloud Drive folder. No shared code.

- SwiftUI app, document-picker entry to locate the vault folder.
- `FileManager` + `NSFileCoordinator` for I/O; `NSMetadataQuery` for change notifications.
- TextKit 2 with a custom `NSTextLayoutFragment` for live-preview rendering (the approach Bear/iA Writer/Runestone use). No attempt to port CodeMirror to iOS.
- v1 search = substring iteration over files. No index.
- v1 omits: backlinks panel, image paste, tag browser.
- Conflict handling via iCloud's conflict versions API; reuse the desktop UX, not the code.

Target: ~1500 LOC of Swift for v1.

---

## Self-review: what's weak in this plan

### Things I asserted without verifying
1. **"Each decoration plugin walks the syntax tree separately."** I inferred this from the file count, not from reading every decoration. Some may already piggyback on a shared tree cursor via `syntaxTree(state)`. The perf claim in A2 needs to be benchmarked, not assumed. The LOC consolidation argument stands either way.
2. **"~1200 LOC removed in A1."** This is a back-of-envelope sum. Real number depends on how much of `lib.rs`, `app.svelte.ts`, and `+page.svelte` is entangled with the deleted modals. There will be carrier wreckage — store fields, event listeners, capability entries — that takes longer to clean than the obvious files.
3. **"Cold start drops noticeably with background indexing."** True only if indexing is currently the long pole. The synchronous `rebuild` runs on every launch, but for a small vault it may already be sub-100ms. Profile before optimizing.
4. **"Tauri-plugin-shell may be unused."** I didn't grep for it. Could be load-bearing for opening external links.

### Decisions that deserve pushback
1. **Killing the floating toolbar.** I called Obsidian as precedent, but the user may actually like it. This is a taste call disguised as a simplification. Flag for explicit user sign-off.
2. **Inlining backlinks at the bottom of the note instead of a panel.** Obsidian-default, but the current panel is already built and works. Removing it is a UX change, not a cleanup. Could keep the component, just stop showing it in the default layout.
3. **Dropping the Outline panel.** Same caveat — it's working code. The "delete it" suggestion is aesthetic, not technical.
4. **System Trash instead of `.trash/`.** Loses one thing: vault-portable undelete. If the user moves the vault to another machine, the in-app `.trash/` travels with it; the macOS Trash does not. For an iCloud-synced vault this might actually matter.
5. **Tags-in-FTS5.** Adds index-rebuild complexity (schema migration, reindex on schema bump). The current scanner is dumb but correct. Worth it only if tag queries are visibly slow today — they probably aren't on a personal vault.
6. **Single command palette replacing all modals.** Good UX direction, but it's the biggest UX change in the plan and the riskiest to ship without iteration. Should be its own PR with a way to revert.

### Risks I undersold
1. **Mobile live-preview is the hardest part of Part B, not the easiest.** I made it sound like "use TextKit 2 and you're done." Custom `NSTextLayoutFragment` rendering for inline markdown is genuinely hard — fragment invalidation, cursor placement inside hidden ranges, selection across collapsed syntax marks. Plan ~40% of iOS effort here, not 20%.
2. **iCloud `.icloud` placeholders on mobile.** Desktop currently filters them out (`commands.rs:163`). iOS needs to *trigger downloads* via `startDownloadingUbiquitousItem` and handle the async wait, not just hide them. This is a real piece of code, not a one-liner.
3. **NSMetadataQuery is slower and chattier than `notify`.** Expect different change-event semantics from the desktop watcher. Don't assume the desktop conflict-detection logic ports directly.
4. **Two codebases, one data format = schema discipline.** Any frontmatter convention, wiki-link syntax, or asset-path rule has to be specified in writing somewhere both apps consult. Today those rules live implicitly in Rust + TS. Write them down before the iOS app starts.
5. **MAS / sandboxing.** If the desktop app ever wants Mac App Store distribution, the current free-roaming file I/O won't pass review. Not urgent, but a future constraint worth noting now.

### Things the plan doesn't address but probably should
1. **Vault-level encryption / private notes.** If iCloud Drive holds the vault in plaintext, it's readable by anyone with the Apple ID. Out of scope, but worth a conscious decision.
2. **Plugin API.** Obsidian's stickiness comes largely from its plugin ecosystem. Kosha-minimal is the opposite bet. State the bet explicitly.
3. **Versioning / undo across sessions.** iCloud keeps file versions but the app doesn't expose them. Cheap win worth considering.
4. **Performance budget.** README claims < 8 MB bundle, < 1.5s cold start. The plan optimizes for "minimal" without restating those targets. They should be the acceptance criteria for the pruning PRs.

### Sequencing concern
Doing Part A before Part B is right, but the dependency I named — "iOS will read the simpler post-prune layout" — is overstated. The on-disk format barely changes (drop `.trash/`, that's it). The real reason to do A first is to avoid maintaining a feature on desktop that you don't intend to port. So the gating question for each deletion in A1 is: *"would I build this on iOS?"* If no, delete on desktop. If yes, keep and port. That's a cleaner filter than the list above.

---

## Open questions for the user

1. Floating toolbar: keep or kill?
2. Outline panel: keep or kill?
3. Backlinks: panel, inline at bottom, or both (toggle)?
4. System Trash vs portable `.trash/` — which matters more for an iCloud vault that moves between machines?
5. Mac App Store distribution ever a goal, or direct download forever?
6. Is there a vault size assumption (notes, total MB) we should design for? "Personal" and "10k notes" lead to different choices for search and indexing.

## Decision log
- _(empty — to be filled as choices are locked in)_
