<script lang="ts">
  /// Mirrors how +page.svelte feeds the global app store into the Editor.
  /// If this works in a test but the real app doesn't, the bug isn't here.
  import Editor from './Editor.svelte';
  import { app } from '$lib/stores/app.svelte';
</script>

<Editor content={app.fileContent} onContentChange={(c) => { app.fileContent = c; }} />
