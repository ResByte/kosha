<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createEditorState, createEditorView, applyTheme, setSourceMode, syncAnnotation } from '$lib/editor/setup';
  import { EditorView } from '@codemirror/view';
  import { app } from '$lib/stores/app.svelte';

  let {
    content = '',
    onContentChange,
  }: {
    content: string;
    onContentChange: (content: string) => void;
  } = $props();

  let editorContainer: HTMLElement;
  let view: EditorView | null = null;

  onMount(() => {
    const state = createEditorState(content, onContentChange);
    view = createEditorView(editorContainer, state);

    // Handle wiki-link navigation
    editorContainer.addEventListener('wiki-link-click', (e: Event) => {
      const custom = e as CustomEvent<{ linkName: string }>;
      const linkName = custom.detail.linkName;
      const event = new CustomEvent('navigate-to-note', {
        detail: { linkName },
        bubbles: true,
      });
      editorContainer.dispatchEvent(event);
    });
  });

  onDestroy(() => {
    view?.destroy();
  });

  // Sync content prop → editor when file switches.
  // Read `content` unconditionally first so Svelte 5 always tracks it as a
  // dependency, even on the initial run when `view` may not yet be set.
  $effect(() => {
    const c = content;
    if (view && c !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: c },
        annotations: syncAnnotation.of(true),
      });
    }
  });

  // Sync theme
  $effect(() => {
    if (view) {
      applyTheme(view, app.theme === 'dark');
    }
  });

  // Sync source mode
  $effect(() => {
    if (view) {
      setSourceMode(view, app.sourceMode);
    }
  });
</script>

<div
  bind:this={editorContainer}
  class="editor-container h-full w-full overflow-auto"
></div>
