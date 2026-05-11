<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import ConflictModal from '$lib/components/ConflictModal.svelte';
  import { app } from '$lib/stores/app.svelte';
  import { readFile, listDir, findBacklinks, writeSettings, getDataDir, updateSearchIndex } from '$lib/tauri';
  import { setDataDirPath } from '$lib/editor/context';
  import { listen } from '@tauri-apps/api/event';

  let { children } = $props();

  let conflictPath = $state<string | null>(null);

  onMount(async () => {
    // Load the current data dir into store
    const dir = await getDataDir().catch(() => '');
    app.dataDir = dir;
    if (dir) setDataDirPath(dir);

    // Listen for external file changes (from file watcher)
    listen<string>('file-changed', async (event) => {
      const changedPath = event.payload;
      // Skip hidden / trash paths
      if (changedPath.startsWith('.')) return;
      // Refresh file tree
      app.fileTree = await listDir().catch(() => app.fileTree);
      // Keep search index in sync with externally created/modified files
      if (changedPath.endsWith('.md')) {
        updateSearchIndex(changedPath).catch(() => {});
      }
      // Reload content if the currently open file changed externally
      if (changedPath === app.currentFile && !app.isDirty) {
        const content = await readFile(changedPath).catch(() => null);
        if (content !== null) app.fileContent = content;
      }
    });

    listen<string>('icloud-conflict', (event) => {
      conflictPath = event.payload;
    });

    // Reload everything when data dir changes
    listen<string>('data-dir-changed', async (event) => {
      const newDir = event.payload;
      app.dataDir = newDir;
      setDataDirPath(newDir);
      app.fileTree = await listDir().catch(() => []);
      // Clear editor — old file paths are no longer valid
      app.currentFile = null;
      app.fileContent = '';
      app.isDirty = false;
      app.backlinks = [];
    });
  });

  // Persist theme changes to settings.json
  $effect(() => {
    const theme = app.theme;
    writeSettings({ theme }).catch(() => {});
  });

  async function handleOpenFile(path: string, _content?: string) {
    const content = _content ?? (await readFile(path));
    app.currentFile = path;
    app.fileContent = content;
    app.isDirty = false;
    app.addToRecent(path);

    const noteName = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
    findBacklinks(noteName)
      .then((bl) => { app.backlinks = bl; })
      .catch(() => { app.backlinks = []; });
  }

  async function handleSearchOpen(path: string) {
    await handleOpenFile(path);
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.metaKey && e.key === 'b') {
      e.preventDefault();
      app.sidebarOpen = !app.sidebarOpen;
    }
    if (e.metaKey && e.key === 'k') {
      e.preventDefault();
      app.paletteMode = 'switcher';
      app.paletteOpen = true;
    }
    if (e.metaKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      app.paletteMode = 'search';
      app.paletteOpen = true;
    }
    if (e.metaKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      app.paletteMode = 'commands';
      app.paletteOpen = true;
    }
    if (e.metaKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      app.theme = app.theme === 'light' ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', app.theme === 'dark');
    }
    if (e.metaKey && e.key === '/') {
      e.preventDefault();
      app.sourceMode = !app.sourceMode;
    }
    if (e.metaKey && e.key === 'd') {
      e.preventDefault();
      app.dailyNoteRequest++;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="h-screen flex bg-[var(--color-surface)] overflow-hidden">
  {#if app.sidebarOpen}
    <aside
      class="w-64 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-alt,#F7FAFC)] overflow-y-auto"
    >
      <Sidebar onOpenFile={handleOpenFile} />
    </aside>
  {/if}

  <main class="flex-1 overflow-hidden flex flex-col min-w-0">
    {@render children()}
  </main>
</div>

<CommandPalette onOpenFile={handleSearchOpen} />
{#if conflictPath}
  <ConflictModal path={conflictPath} onClose={() => { conflictPath = null; }} />
{/if}
