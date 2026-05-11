/**
 * Tests for the CodeMirror editor factory in setup.ts.
 *
 * Most behaviour is wired through CodeMirror itself; we focus on the contract
 * between `createEditorState`'s update listener and the `syncAnnotation` flag
 * because a regression here re-introduces the "files are dirty the moment
 * they load" bug.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createEditorState, syncAnnotation } from './setup';

describe('createEditorState — updateListener', () => {
  let view: EditorView;
  let onUpdate: ((c: string) => void) & { mock: { calls: unknown[][] } };
  let target: HTMLDivElement;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    onUpdate = vi.fn() as typeof onUpdate;
    view = new EditorView({
      state: createEditorState('initial content', onUpdate),
      parent: target,
    });
  });

  afterEach(() => {
    view.destroy();
    target.remove();
  });

  it('calls onUpdate for normal user-typed transactions', () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'typed by user' },
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('typed by user');
  });

  it('does NOT call onUpdate when the transaction carries syncAnnotation', () => {
    // This is the path the Svelte $effect uses when syncing a file-switch
    // into the editor. Triggering onUpdate here would mark the file dirty.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'loaded from disk' },
      annotations: syncAnnotation.of(true),
    });
    expect(onUpdate).not.toHaveBeenCalled();
    // The doc DID update — the gate only suppresses the dirty side-effect.
    expect(view.state.doc.toString()).toBe('loaded from disk');
  });

  it('still fires onUpdate for a user transaction after a sync transaction', () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'loaded' },
      annotations: syncAnnotation.of(true),
    });
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'then typed' },
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('then typed');
  });

  it('does not fire onUpdate for non-doc-changing transactions', () => {
    // Selection-only changes are not "content" changes.
    view.dispatch({ selection: { anchor: 0, head: 0 } });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('createEditorState — renders markdown content', () => {
  it('renders plain markdown into the cm-content DOM', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const view = new EditorView({
      state: createEditorState('# Heading\n\nbody text', () => {}),
      parent: target,
    });
    const cmContent = view.dom.querySelector('.cm-content');
    expect(cmContent).not.toBeNull();
    expect(cmContent!.textContent).toContain('body text');
    view.destroy();
    target.remove();
  });

  it('renders markdown with YAML frontmatter without throwing', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const md = '---\ntags: [a, b]\n---\n\n# Title\n\nbody';
    expect(() => {
      const view = new EditorView({
        state: createEditorState(md, () => {}),
        parent: target,
      });
      view.destroy();
    }).not.toThrow();
    target.remove();
  });

  it('reflects content after a sync dispatch (file switch path)', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const view = new EditorView({
      state: createEditorState('', () => {}),
      parent: target,
    });

    // Same dispatch shape that Editor.svelte's $effect uses on file open
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '# Switched\n\nnew body' },
      annotations: syncAnnotation.of(true),
    });

    expect(view.state.doc.toString()).toBe('# Switched\n\nnew body');
    const cmContent = view.dom.querySelector('.cm-content');
    expect(cmContent!.textContent).toContain('new body');
    view.destroy();
    target.remove();
  });

  // ── Regression: "Block decorations may not be specified via plugins" ────
  // Block-replacing decorations (frontmatter badge, code blocks, tables) MUST
  // come from a StateField. If they regress back into the ViewPlugin,
  // dispatching content that contains them throws and breaks the editor for
  // every file with those constructs.
  describe('block decorations do not throw when content is dispatched', () => {
    const cases: Array<[string, string]> = [
      ['frontmatter', '---\ntags: [a, b]\n---\n\n# Title\n\nbody'],
      ['fenced code block', '# Note\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n'],
      ['markdown table', '# Note\n\n| h1 | h2 |\n| -- | -- |\n| a  | b  |\n'],
      ['all three together', '---\ntags: [x]\n---\n\n# T\n\n```ts\nx;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'],
    ];

    for (const [label, md] of cases) {
      it(`dispatching content with ${label} does not throw`, () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const view = new EditorView({
          state: createEditorState('', () => {}),
          parent: target,
        });
        expect(() => {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: md },
            annotations: syncAnnotation.of(true),
          });
        }).not.toThrow();
        // Force CodeMirror to actually measure / apply decorations.
        view.requestMeasure();
        expect(view.state.doc.toString()).toBe(md);
        view.destroy();
        target.remove();
      });
    }
  });
});
