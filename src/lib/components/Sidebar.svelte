<script lang="ts">
  import { app } from '$lib/stores/app.svelte';
  import { readFile, listDir, createDir, writeFile, listNotesByTag, trashFile, pickFolder, changeDataDir } from '$lib/tauri';
  import type { FileEntry } from '$lib/tauri';

  let { onOpenFile }: { onOpenFile: (path: string, content: string) => void } = $props();

  let expandedDirs = $state(new Set<string>());
  let expandedSections = $state(new Set(['files', 'favorites', 'recent']));
  let tagFilteredPaths = $state<Set<string>>(new Set());
  let showNewFolderInput = $state(false);
  let newFolderName = $state('');

  $effect(() => {
    const tag = app.activeTagFilter;
    if (tag) {
      listNotesByTag(tag)
        .then((paths) => { tagFilteredPaths = new Set(paths); })
        .catch(() => { tagFilteredPaths = new Set(); });
    } else {
      tagFilteredPaths = new Set();
    }
  });

  function toggleDir(path: string) {
    const next = new Set(expandedDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedDirs = next;
  }

  function toggleSection(name: string) {
    const next = new Set(expandedSections);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    expandedSections = next;
  }

  async function openFile(entry: FileEntry) {
    if (entry.is_dir) {
      toggleDir(entry.path);
      return;
    }
    const content = await readFile(entry.path);
    app.currentFile = entry.path;
    app.fileContent = content;
    app.isDirty = false;
    app.addToRecent(entry.path);
    onOpenFile(entry.path, content);
  }

  async function openByPath(path: string) {
    try {
      const content = await readFile(path);
      app.currentFile = path;
      app.fileContent = content;
      app.isDirty = false;
      onOpenFile(path, content);
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }

  async function newNote() {
    const name = `Untitled-${Date.now()}.md`;
    try {
      await writeFile(name, '');
      app.fileTree = await listDir();
      await openByPath(name);
    } catch (e) {
      console.error('Failed to create note:', e);
    }
  }

  function startNewFolder() {
    newFolderName = '';
    showNewFolderInput = true;
  }

  async function confirmNewFolder() {
    const name = newFolderName.trim();
    showNewFolderInput = false;
    newFolderName = '';
    if (!name) return;
    try {
      await createDir(name);
      app.fileTree = await listDir();
    } catch (e) {
      console.error('Failed to create folder:', e);
    }
  }

  async function handleTrash(entry: FileEntry) {
    await trashFile(entry.path);
    app.fileTree = await listDir();
    // Clear editor if the open file was the trashed item or inside a trashed folder
    if (app.currentFile === entry.path ||
        (entry.is_dir && app.currentFile?.startsWith(entry.path + '/'))) {
      app.currentFile = null;
      app.fileContent = '';
      app.isDirty = false;
    }
  }

  function fileName(path: string): string {
    return path.split('/').pop()?.replace(/\.md$/, '') ?? path;
  }

  function isActive(path: string): boolean {
    return app.currentFile === path;
  }

  function filterByTag(entries: FileEntry[]): FileEntry[] {
    if (!app.activeTagFilter) return entries;
    return entries.reduce<FileEntry[]>((acc, e) => {
      if (e.is_dir && e.children) {
        const filtered = filterByTag(e.children);
        if (filtered.length > 0) acc.push({ ...e, children: filtered });
      } else if (!e.is_dir && tagFilteredPaths.has(e.path)) {
        acc.push(e);
      }
      return acc;
    }, []);
  }

  const filteredTree = $derived(filterByTag(app.fileTree));
</script>

<div class="flex flex-col h-full text-sm select-none">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
    <span class="font-semibold text-[var(--color-text)] text-xs uppercase tracking-wide">Kosha</span>
    <div class="flex gap-1">
      <button
        onclick={newNote}
        class="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        title="New Note (Cmd+N)"
        aria-label="New Note"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </button>
      <button
        onclick={startNewFolder}
        class="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        title="New Folder"
        aria-label="New Folder"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
        </svg>
      </button>
      <button
        onclick={() => { app.dailyNoteRequest++; }}
        class="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        title="Open Today's Note (Cmd+D)"
        aria-label="Open Today's Note"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto py-1">

    <!-- Inline New Folder Input -->
    {#if showNewFolderInput}
      <div class="px-3 py-1.5">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={newFolderName}
          placeholder="Folder name…"
          autofocus
          class="w-full text-xs px-2 py-1 rounded border border-blue-400 bg-[var(--color-surface)] text-[var(--color-text)] outline-none"
          onkeydown={(e) => {
            if (e.key === 'Enter') confirmNewFolder();
            if (e.key === 'Escape') { showNewFolderInput = false; newFolderName = ''; }
          }}
          onblur={confirmNewFolder}
        />
      </div>
    {/if}

    <!-- Favorites -->
    {#if app.favorites.length > 0}
      <button
        class="w-full flex items-center gap-1 px-3 py-1 text-xs text-[var(--color-text-muted)] uppercase tracking-wide hover:text-[var(--color-text)]"
        onclick={() => toggleSection('favorites')}
      >
        <span class="transition-transform" class:rotate-90={expandedSections.has('favorites')}>›</span>
        Favorites
      </button>
      {#if expandedSections.has('favorites')}
        {#each app.favorites as fav}
          <button
            class="w-full flex items-center gap-1.5 px-3 py-1 truncate hover:bg-[var(--color-border)]"
            class:bg-[var(--color-border)]={isActive(fav)}
            class:text-[var(--color-primary)]={isActive(fav)}
            onclick={() => openByPath(fav)}
          >
            <span class="text-yellow-400">★</span>
            <span class="truncate text-[var(--color-text)]">{fileName(fav)}</span>
          </button>
        {/each}
      {/if}
    {/if}

    <!-- Recent -->
    {#if app.recentFiles.length > 0}
      <button
        class="w-full flex items-center gap-1 px-3 py-1 text-xs text-[var(--color-text-muted)] uppercase tracking-wide hover:text-[var(--color-text)]"
        onclick={() => toggleSection('recent')}
      >
        <span class="transition-transform" class:rotate-90={expandedSections.has('recent')}>›</span>
        Recent
      </button>
      {#if expandedSections.has('recent')}
        {#each app.recentFiles.slice(0, 5) as recent}
          <button
            class="w-full flex items-center gap-1.5 px-3 py-1 truncate hover:bg-[var(--color-border)]"
            class:bg-[var(--color-border)]={isActive(recent)}
            onclick={() => openByPath(recent)}
          >
            <span class="text-[var(--color-text-muted)]">◷</span>
            <span class="truncate text-[var(--color-text)]">{fileName(recent)}</span>
          </button>
        {/each}
      {/if}
    {/if}

    <!-- Files -->
    <button
      class="w-full flex items-center gap-1 px-3 py-1 text-xs text-[var(--color-text-muted)] uppercase tracking-wide hover:text-[var(--color-text)]"
      onclick={() => toggleSection('files')}
    >
      <span class="transition-transform" class:rotate-90={expandedSections.has('files')}>›</span>
      Files
    </button>
    {#if expandedSections.has('files')}
      {#each filteredTree as entry}
        {@render FileNode({ entry, depth: 0, openFile, onTrash: handleTrash, activeFile: app.currentFile, expandedDirs })}
      {/each}
    {/if}

    <!-- Tags -->
    {#if app.allTags.length > 0}
      <button
        class="w-full flex items-center gap-1 px-3 py-1 text-xs text-[var(--color-text-muted)] uppercase tracking-wide hover:text-[var(--color-text)] mt-2"
        onclick={() => toggleSection('tags')}
      >
        <span class="transition-transform" class:rotate-90={expandedSections.has('tags')}>›</span>
        Tags
      </button>
      {#if expandedSections.has('tags')}
        <div class="px-3 py-1 flex flex-wrap gap-1">
          {#each app.allTags as { tag, count }}
            <button
              class="px-2 py-0.5 rounded-full text-xs border"
              class:bg-[var(--color-border)]={app.activeTagFilter === tag}
              class:border-[var(--color-primary)]={app.activeTagFilter === tag}
              class:text-[var(--color-primary)]={app.activeTagFilter === tag}
              class:border-[var(--color-border)]={app.activeTagFilter !== tag}
              class:text-[var(--color-text-muted)]={app.activeTagFilter !== tag}
              onclick={() => { app.activeTagFilter = app.activeTagFilter === tag ? null : tag; }}
            >
              {tag} <span class="opacity-60">{count}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}

  </div>

  <!-- Vault footer -->
  <div class="border-t border-[var(--color-border)] px-3 py-2 flex items-center gap-1.5 min-w-0">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="flex-shrink-0 text-[var(--color-text-muted)]">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9,22 9,12 15,12 15,22"/>
    </svg>
    <span class="flex-1 truncate text-[10px] text-[var(--color-text-muted)] min-w-0" title={app.dataDir}>
      {app.dataDir ? app.dataDir.replace(/^\/Users\/[^/]+\//, '~/') : '…'}
    </span>
    <button
      onclick={async () => { const p = await pickFolder(); if (p) await changeDataDir(p); }}
      class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] text-[var(--color-text-muted)] transition"
      title="Change vault folder"
    >
      Change
    </button>
  </div>
</div>

<!-- Recursive FileNode component -->
{#snippet FileNode({ entry, depth, openFile: open, onTrash, activeFile, expandedDirs: expanded }: {
  entry: FileEntry;
  depth: number;
  openFile: (e: FileEntry) => void;
  onTrash: (e: FileEntry) => void;
  activeFile: string | null;
  expandedDirs: Set<string>;
})}
  <div class="group flex items-center hover:bg-[var(--color-border)]" style="padding-left: {(depth + 1) * 12}px">
    <button
      class="flex-1 flex items-center gap-1.5 py-0.5 truncate min-w-0"
      class:text-[var(--color-primary)]={!entry.is_dir && activeFile === entry.path}
      onclick={() => open(entry)}
    >
      {#if entry.is_dir}
        <span class="text-[var(--color-text-muted)] text-xs flex-shrink-0">{expanded.has(entry.path) ? '▾' : '▸'}</span>
        <span class="text-[var(--color-text-muted)] flex-shrink-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
        </span>
      {:else}
        <span class="text-[var(--color-text-muted)] flex-shrink-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
          </svg>
        </span>
      {/if}
      <span class="truncate text-[var(--color-text)] text-[13px]">
        {entry.is_dir ? entry.name : entry.name.replace(/\.md$/, '')}
      </span>
    </button>
    <button
      onclick={(ev) => { ev.stopPropagation(); onTrash(entry); }}
      class="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 mr-1 flex-shrink-0 text-[var(--color-text-muted)] hover:text-red-500"
      title="Move to Trash"
      aria-label="Move to Trash"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    </button>
  </div>
  {#if entry.is_dir && expanded.has(entry.path) && entry.children}
    {#each entry.children as child}
      {@render FileNode({ entry: child, depth: depth + 1, openFile: open, onTrash, activeFile, expandedDirs: expanded })}
    {/each}
  {/if}
{/snippet}
