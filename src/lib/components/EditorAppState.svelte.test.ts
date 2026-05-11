/**
 * Confirms the cross-component flow that the real app uses:
 *   Sidebar/click → app.fileContent = X  → +page reads it  → Editor displays X
 *
 * If this passes, the click-shows-nothing bug isn't in the store or the
 * Svelte 5 reactivity path through the global `app` singleton.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import Harness from './EditorAppStateHarness.svelte';
import { app } from '$lib/stores/app.svelte';

let mounted: ReturnType<typeof mount> | null = null;
let target: HTMLDivElement | null = null;

afterEach(() => {
  if (mounted) { unmount(mounted); mounted = null; }
  if (target) { target.remove(); target = null; }
  app.fileContent = '';
  app.currentFile = null;
});

function cmText(): string {
  return target!.querySelector('.cm-content')?.textContent ?? '';
}

describe('Editor reflects changes to global app.fileContent', () => {
  it('shows the initial app.fileContent on mount', async () => {
    app.fileContent = 'starting content';
    target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(Harness, { target, props: {} });
    flushSync();
    await tick();

    expect(cmText()).toContain('starting content');
  });

  it('updates the editor when app.fileContent is mutated externally', async () => {
    app.fileContent = 'first note';
    target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(Harness, { target, props: {} });
    flushSync();
    await tick();
    expect(cmText()).toContain('first note');

    // Same code path Sidebar uses after readFile:
    app.fileContent = '# Second note\n\nbody of second';
    flushSync();
    await tick();

    expect(cmText()).toContain('body of second');
  });

  it('handles a sequence of file switches', async () => {
    app.fileContent = 'one';
    target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(Harness, { target, props: {} });
    flushSync(); await tick();
    expect(cmText()).toContain('one');

    app.fileContent = 'two';
    flushSync(); await tick();
    expect(cmText()).toContain('two');

    app.fileContent = 'three';
    flushSync(); await tick();
    expect(cmText()).toContain('three');
  });
});
