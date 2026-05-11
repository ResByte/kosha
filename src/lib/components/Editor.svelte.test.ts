/**
 * Component-level test for Editor.svelte's prop reactivity.
 *
 * The user-visible bug: clicking a file in the sidebar updates the store
 * (`app.fileContent`), but the editor area stays blank. That can only happen
 * if Editor.svelte's $effect doesn't dispatch the new content into its
 * CodeMirror view when the `content` prop changes — which would be a Svelte 5
 * reactivity break, not a CSS issue.
 *
 * This test mounts the real Editor.svelte via a test harness, mutates a
 * reactive props object, flushes Svelte, and asserts the editor's DOM
 * reflects the new content.
 *
 * File is `.svelte.ts` so the Svelte compiler runs `$state` runes for us.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import Harness from './EditorTestHarness.svelte';

let mounted: ReturnType<typeof mount> | null = null;
let target: HTMLDivElement | null = null;

afterEach(() => {
  if (mounted) { unmount(mounted); mounted = null; }
  if (target) { target.remove(); target = null; }
});

function getCmText(): string {
  return target!.querySelector('.cm-content')?.textContent ?? '';
}

describe('Editor.svelte — prop reactivity (regression for "click file shows nothing")', () => {
  it('renders the initial content prop into the editor', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);

    const state = $state({ content: 'initial body text', onContentChange: vi.fn() });
    mounted = mount(Harness, { target, props: { state } });

    flushSync();
    await tick();

    expect(getCmText()).toContain('initial body text');
  });

  it('updates the editor DOM when the content prop changes', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);

    const state = $state({ content: 'first file', onContentChange: vi.fn() });
    mounted = mount(Harness, { target, props: { state } });

    flushSync();
    await tick();
    expect(getCmText()).toContain('first file');

    // Simulate the click-a-file path: parent mutates the value.
    state.content = '# Switched\n\nsecond file body';
    flushSync();
    await tick();

    expect(getCmText()).toContain('second file body');
  });

  it('does not call onContentChange when content is changed via prop', async () => {
    // Loading a file should not mark it dirty.
    target = document.createElement('div');
    document.body.appendChild(target);

    const onContentChange = vi.fn();
    const state = $state({ content: '', onContentChange });
    mounted = mount(Harness, { target, props: { state } });

    flushSync();
    await tick();
    onContentChange.mockClear(); // ignore any mount-time calls

    state.content = 'loaded from disk';
    flushSync();
    await tick();

    expect(onContentChange).not.toHaveBeenCalled();
  });
});
