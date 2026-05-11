<script lang="ts">
  import { app } from '$lib/stores/app.svelte';
  import { searchNotes, listNoteTitles, listDir, writeFile, changeDataDir, pickFolder, updateSearchIndex } from '$lib/tauri';

  let { onOpenFile }: { onOpenFile: (path: string) => void } = $props();

  type Mode = 'switcher' | 'search' | 'commands';

  type Item =
    | { kind: 'file'; path: string; title: string; snippet?: string }
    | { kind: 'command'; label: string; hint?: string; run: () => void | Promise<void> };

  let query = $state('');
  let items = $state<Item[]>([]);
  let selectedIdx = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let allTitles: [string, string][] = [];

  const modeLabel: Record<Mode, string> = {
    switcher: 'Switch',
    search: 'Search',
    commands: 'Commands',
  };

  const modePlaceholder: Record<Mode, string> = {
    switcher: 'Jump to note…',
    search: 'Search all notes…',
    commands: 'Run a command…',
  };

  const commands: Item[] = [
    {
      kind: 'command',
      label: 'New note',
      hint: 'Cmd+N',
      run: async () => {
        const name = `Untitled-${Date.now()}.md`;
        await writeFile(name, '');
        app.fileTree = await listDir();
        onOpenFile(name);
      },
    },
    {
      kind: 'command',
      label: "Open today's note",
      hint: 'Cmd+D',
      run: () => { app.dailyNoteRequest++; },
    },
    {
      kind: 'command',
      label: 'Change vault folder…',
      run: async () => {
        const chosen = await pickFolder();
        if (chosen) await changeDataDir(chosen);
      },
    },
    {
      kind: 'command',
      label: 'Toggle theme',
      hint: 'Cmd+Shift+T',
      run: () => {
        app.theme = app.theme === 'light' ? 'dark' : 'light';
        document.documentElement.classList.toggle('dark', app.theme === 'dark');
      },
    },
    {
      kind: 'command',
      label: 'Toggle source / preview mode',
      hint: 'Cmd+/',
      run: () => { app.sourceMode = !app.sourceMode; },
    },
    {
      kind: 'command',
      label: 'Toggle sidebar',
      hint: 'Cmd+B',
      run: () => { app.sidebarOpen = !app.sidebarOpen; },
    },
    {
      kind: 'command',
      label: 'Rebuild search index',
      run: async () => {
        const { rebuildSearchIndex } = await import('$lib/tauri');
        await rebuildSearchIndex();
      },
    },
  ];

  $effect(() => {
    if (app.paletteOpen) {
      query = '';
      selectedIdx = 0;
      setTimeout(() => inputEl?.focus(), 50);
      if (app.paletteMode === 'switcher') {
        loadAllTitles().then(() => { items = titleItems(''); });
      } else if (app.paletteMode === 'commands') {
        items = commands;
      } else {
        items = [];
      }
    }
  });

  async function loadAllTitles() {
    allTitles = await listNoteTitles();
  }

  function titleItems(q: string): Item[] {
    const ql = q.toLowerCase();
    const filtered = ql
      ? allTitles.filter(([path, title]) => title.toLowerCase().includes(ql) || path.toLowerCase().includes(ql))
      : allTitles;
    return filtered.map(([path, title]) => ({ kind: 'file', path, title }));
  }

  function commandItems(q: string): Item[] {
    const ql = q.toLowerCase();
    return ql ? commands.filter((c) => c.kind === 'command' && c.label.toLowerCase().includes(ql)) : commands;
  }

  function close() {
    app.paletteOpen = false;
    query = '';
    items = [];
  }

  function handleInput() {
    selectedIdx = 0;
    if (app.paletteMode === 'switcher') {
      items = titleItems(query);
    } else if (app.paletteMode === 'commands') {
      items = commandItems(query);
    } else {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(doSearch, 250);
    }
  }

  async function doSearch() {
    if (!query.trim()) { items = []; return; }
    const r = await searchNotes(query, 15);
    items = r.map((res) => ({ kind: 'file', path: res.path, title: res.title, snippet: res.snippet }));
  }

  async function activate(idx: number) {
    const it = items[idx];
    if (!it) return;
    if (it.kind === 'file') {
      onOpenFile(it.path);
    } else {
      await it.run();
    }
    close();
  }

  function cycleMode(direction: 1 | -1) {
    const order: Mode[] = ['switcher', 'search', 'commands'];
    const i = order.indexOf(app.paletteMode);
    app.paletteMode = order[(i + direction + order.length) % order.length];
    query = '';
    selectedIdx = 0;
    if (app.paletteMode === 'switcher') items = titleItems('');
    else if (app.paletteMode === 'commands') items = commands;
    else items = [];
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, items.length - 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); return; }
    if (e.key === 'Enter') { activate(selectedIdx); return; }
    if (e.key === 'Tab') { e.preventDefault(); cycleMode(e.shiftKey ? -1 : 1); return; }
  }
</script>

{#if app.paletteOpen}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/30 backdrop-blur-sm"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) close(); }}
  >
    <div class="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-xl border border-[var(--color-border)] overflow-hidden">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <svg class="text-[var(--color-text-muted)] flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          bind:this={inputEl}
          bind:value={query}
          oninput={handleInput}
          onkeydown={handleKeydown}
          class="flex-1 bg-transparent outline-none text-[var(--color-text)] text-sm placeholder-[var(--color-text-muted)]"
          placeholder={modePlaceholder[app.paletteMode]}
        />
        <span class="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-border)] px-1.5 py-0.5 rounded font-mono">
          {modeLabel[app.paletteMode]}
        </span>
      </div>

      <div class="max-h-80 overflow-y-auto py-1">
        {#if items.length === 0 && (app.paletteMode === 'search' || query.trim())}
          <div class="px-4 py-6 text-center text-[var(--color-text-muted)] text-sm">
            {app.paletteMode === 'search' && !query.trim() ? 'Type to search…' : 'No results'}
          </div>
        {:else}
          {#each items as item, i}
            <button
              class="w-full text-left px-4 py-2 hover:bg-[var(--color-surface-alt)]"
              class:bg-[var(--color-surface-alt)]={i === selectedIdx}
              onclick={() => activate(i)}
              onmouseenter={() => { selectedIdx = i; }}
            >
              {#if item.kind === 'file'}
                <div class="text-[var(--color-text)] text-sm font-medium truncate">{item.title || item.path}</div>
                {#if item.snippet}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="text-[var(--color-text-muted)] text-xs mt-0.5 line-clamp-1">{@html item.snippet}</div>
                {:else}
                  <div class="text-[var(--color-text-muted)] text-xs mt-0.5 truncate">{item.path}</div>
                {/if}
              {:else}
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[var(--color-text)] text-sm">{item.label}</span>
                  {#if item.hint}
                    <span class="text-[var(--color-text-muted)] text-[10px] font-mono">{item.hint}</span>
                  {/if}
                </div>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <div class="flex items-center gap-4 px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
        <span><kbd class="font-mono">↑↓</kbd> nav</span>
        <span><kbd class="font-mono">↵</kbd> select</span>
        <span><kbd class="font-mono">⇥</kbd> mode</span>
        <span><kbd class="font-mono">esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(mark) {
    background-color: rgba(43, 108, 176, 0.2);
    color: inherit;
    border-radius: 2px;
  }
</style>
