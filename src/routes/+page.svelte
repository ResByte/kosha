<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from '$lib/components/Editor.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import { app } from '$lib/stores/app.svelte';
  import {
    readFile,
    writeFile,
    listDir,
    ensureDataDir,
    updateSearchIndex,
    findBacklinks,
    listAllTags,
    readSettings,
  } from '$lib/tauri';
  import { setDataDirPath } from '$lib/editor/context';
  import { createDefaultNote } from '$lib/frontmatter';
  import { listen } from '@tauri-apps/api/event';

  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let pageRoot: HTMLDivElement;

  onMount(async () => {
    pageRoot.addEventListener('navigate-to-note', handleNavigateToNote as EventListener);
    const dataDir = await ensureDataDir();
    setDataDirPath(dataDir);
    app.fileTree = await listDir();

    // Restore saved theme
    try {
      const settings = await readSettings();
      if (settings.theme === 'dark') {
        app.theme = 'dark';
        document.documentElement.classList.add('dark');
      }
    } catch { /* ignore */ }

    // Tags depend on the search index — refresh once Rust signals it's ready.
    loadTags();
    listen('index-ready', () => loadTags());

    // Open first file if available
    const first = findFirstFile(app.fileTree);
    if (first) await openFile(first);
  });

  function findFirstFile(entries: typeof app.fileTree): string | null {
    for (const e of entries) {
      if (!e.is_dir) return e.path;
      if (e.children) {
        const found = findFirstFile(e.children);
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
    app.addToRecent(path);

    // Load backlinks
    const noteName = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
    findBacklinks(noteName)
      .then((bl) => { app.backlinks = bl; })
      .catch(() => { app.backlinks = []; });
  }

  async function loadTags() {
    try {
      const tags = await listAllTags();
      app.allTags = tags.map(([tag, count]) => ({ tag, count }));
    } catch {
      // Search index may not be ready yet
    }
  }

  function handleContentChange(newContent: string) {
    app.fileContent = newContent;
    app.isDirty = true;

    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(save, 2000);
  }

  async function save() {
    if (!app.currentFile || !app.isDirty) return;
    await writeFile(app.currentFile, app.fileContent);
    app.isDirty = false;
    updateSearchIndex(app.currentFile).catch(console.error);
    loadTags();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.metaKey && e.key === 's') {
      e.preventDefault();
      save();
    }
  }

  async function handleNavigateToNote(e: Event) {
    const custom = e as CustomEvent<{ linkName: string }>;
    const { linkName } = custom.detail;
    // Find note by name in file tree
    function findByName(entries: typeof app.fileTree): string | null {
      for (const entry of entries) {
        if (!entry.is_dir && entry.name.replace(/\.md$/, '') === linkName) return entry.path;
        if (entry.children) {
          const found = findByName(entry.children);
          if (found) return found;
        }
      }
      return null;
    }
    const path = findByName(app.fileTree);
    if (path) {
      await openFile(path);
    } else {
      // Note doesn't exist — create it
      const newPath = `${linkName}.md`;
      const content = createDefaultNote(linkName);
      await writeFile(newPath, content);
      app.fileTree = await listDir();
      await openFile(newPath);
      updateSearchIndex(newPath).catch(console.error);
    }
  }

  $effect(() => {
    if (app.dailyNoteRequest > 0) {
      openDailyNote().catch(console.error);
    }
  });

  async function openDailyNote() {
    const today = new Date().toISOString().slice(0, 10);
    const path = `daily/${today}.md`;
    let exists = true;
    try {
      await readFile(path);
    } catch {
      exists = false;
    }
    if (!exists) {
      const content = [
        '---',
        'tags: [daily]',
        `created: ${today}`,
        '---',
        '',
        `# ${today}`,
        '',
        '## Today\'s focus',
        '',
        '',
        '## Notes',
        '',
        '',
        '## Log',
        '',
      ].join('\n');
      await writeFile(path, content);
      app.fileTree = await listDir();
      updateSearchIndex(path).catch(console.error);
    }
    await openFile(path);
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="flex-1 overflow-hidden flex flex-row"
  role="presentation"
  bind:this={pageRoot}
>
  <div class="flex-1 overflow-hidden flex flex-col min-w-0">
    <div class="flex-1 overflow-hidden min-h-0">
      <Editor content={app.fileContent} onContentChange={handleContentChange} />
    </div>
    {#if app.backlinks.length > 0}
      <div class="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] max-h-48 overflow-y-auto">
        <div class="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
          Linked references ({app.backlinks.length})
        </div>
        {#each app.backlinks as link}
          <button
            class="w-full text-left px-4 py-1.5 hover:bg-[var(--color-surface-alt)]"
            onclick={() => openFile(link.path)}
          >
            <div class="text-[var(--color-text)] text-xs font-medium">{link.title || link.path}</div>
            {#if link.snippet}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <div class="text-[var(--color-text-muted)] text-[11px] mt-0.5 line-clamp-1">{@html link.snippet}</div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
    <StatusBar />
  </div>
</div>
