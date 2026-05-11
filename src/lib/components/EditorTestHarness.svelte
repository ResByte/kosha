<script lang="ts">
  import Editor from './Editor.svelte';

  let { state }: { state: { content: string; onContentChange: (c: string) => void } } = $props();
</script>

<Editor content={state.content} onContentChange={state.onContentChange} />
