<script lang="ts">
  import { deleteFile, renameFile, readFile, writeFile, listDir } from '$lib/tauri';
  import { app } from '$lib/stores/app.svelte';

  let { path, onClose }: { path: string; onClose: () => void } = $props();

  const conflictName = $derived(path.split('/').pop() ?? path);
  // The original is the conflict file's name stripped of the "(... conflicted copy ...)" part
  const originalName = $derived(
    conflictName.replace(/\s+\([^)]*conflicted copy[^)]*\)/, '')
  );
  const originalPath = $derived(path.replace(conflictName, originalName));

  async function keepMine() {
    // Delete the conflict file
    await deleteFile(path).catch(console.error);
    app.fileTree = await listDir();
    onClose();
  }

  async function keepTheirs() {
    // Replace original with conflict file contents, delete conflict
    try {
      const content = await readFile(path);
      await writeFile(originalPath, content);
      await deleteFile(path);
      app.fileTree = await listDir();
      if (app.currentFile === originalPath) {
        app.fileContent = content;
      }
    } catch (e) {
      console.error(e);
    }
    onClose();
  }

  async function keepBoth() {
    // Rename conflict file to a timestamped name
    const ts = new Date().toISOString().slice(0, 10);
    const ext = conflictName.includes('.') ? `.${conflictName.split('.').pop()}` : '';
    const base = originalName.replace(/\.[^.]+$/, '');
    await renameFile(path, `${base}-conflict-${ts}${ext}`).catch(console.error);
    app.fileTree = await listDir();
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
  onclick={onClose}
>
  <div
    class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-96 p-5"
    role="alertdialog"
    aria-modal="true"
    aria-label="iCloud conflict detected"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
  >
    <h2 class="font-semibold text-[var(--color-text)] mb-2">iCloud Conflict Detected</h2>
    <p class="text-sm text-[var(--color-text-muted)] mb-4">
      A conflicted copy was found for <strong class="text-[var(--color-text)]">{originalName}</strong>.
      Which version would you like to keep?
    </p>
    <div class="flex flex-col gap-2">
      <button
        onclick={keepMine}
        class="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] text-left"
      >
        <strong>Keep mine</strong> — delete the conflict copy
      </button>
      <button
        onclick={keepTheirs}
        class="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] text-left"
      >
        <strong>Keep theirs</strong> — replace my version with the conflict copy
      </button>
      <button
        onclick={keepBoth}
        class="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] text-left"
      >
        <strong>Keep both</strong> — rename conflict copy
      </button>
    </div>
    <button
      onclick={onClose}
      class="mt-3 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
    >Cancel</button>
  </div>
</div>

<svelte:window onkeydown={handleKeydown} />
