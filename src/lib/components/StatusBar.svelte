<script lang="ts">
  import { app } from '$lib/stores/app.svelte';

  function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  function readingTime(words: number): string {
    const minutes = Math.ceil(words / 200);
    return minutes === 1 ? '1 min read' : `${minutes} min read`;
  }

  const words = $derived(wordCount(app.fileContent));
  const chars = $derived(app.fileContent.length);
  const fileName = $derived(app.currentFile?.split('/').pop() ?? '');
</script>

<div
  class="h-8 border-t border-[var(--color-border)] px-4 flex items-center gap-4 text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)] select-none flex-shrink-0"
>
  {#if app.currentFile}
    <span class="truncate max-w-xs" title={app.currentFile}>{fileName}</span>
    {#if app.isDirty}
      <span class="text-orange-400 font-medium">●</span>
    {/if}
    <span class="ml-auto flex items-center gap-4">
      <span>{words} words</span>
      <span>{chars} chars</span>
      <span>{readingTime(words)}</span>
      <span
        class="px-1.5 py-0.5 rounded text-[10px] font-medium"
        class:bg-blue-100={!app.sourceMode}
        class:text-blue-700={!app.sourceMode}
        class:bg-gray-100={app.sourceMode}
        class:text-gray-600={app.sourceMode}
      >
        {app.sourceMode ? 'Source' : 'Live'}
      </span>
      <button
        onclick={() => {
          app.theme = app.theme === 'light' ? 'dark' : 'light';
          document.documentElement.classList.toggle('dark', app.theme === 'dark');
        }}
        class="hover:text-[var(--color-text)]"
        title="Toggle theme (Cmd+Shift+T)"
        aria-label="Toggle theme"
      >
        {app.theme === 'light' ? '☀' : '☾'}
      </button>
    </span>
  {:else}
    <span>No file open</span>
  {/if}
</div>
