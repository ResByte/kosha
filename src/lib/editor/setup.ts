import { EditorState, Compartment, Annotation, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  dropCursor,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from '@codemirror/language';

import { decorationsExtension, decorationsTheme } from './decorations';
import { writeFileBinary } from '$lib/tauri';

export const decorationCompartment = new Compartment();
export const themeCompartment = new Compartment();

/// Marks transactions that come from a prop sync (file switch) rather than
/// user typing. The update listener uses it to suppress the dirty flag.
export const syncAnnotation = Annotation.define<boolean>();

export const allDecorations: Extension[] = [decorationsExtension, decorationsTheme];

// Layout/typography styles — always applied regardless of theme
const baseTheme = EditorView.theme({
  '&': {
    fontSize: '16px',
    fontFamily: 'var(--font-sans)',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: 'var(--font-sans)',
    padding: '2rem 0',
    maxWidth: '72ch',
    margin: '0 auto',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-line': {
    padding: '2px 1rem',
    lineHeight: '1.7',
  },
});

// Color-only themes — swapped in/out by themeCompartment
const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
  },
  '.cm-content': {
    caretColor: 'var(--color-text)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(43, 108, 176, 0.15) !important',
  },
});

const darkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-text)',
    },
    '.cm-content': {
      caretColor: 'var(--color-text)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--color-text)',
    },
    '.cm-activeLine': {
      backgroundColor: '#323232',
    },
    '.cm-selectionBackground': {
      backgroundColor: '#214283 !important',
    },
    '.cm-gutters': {
      backgroundColor: '#313335',
      borderRight: '1px solid #3C3F41',
      color: '#606366',
    },
  },
  { dark: true }
);

async function handleImageInsert(file: File, view: EditorView) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const name = `${ts}-${safeName}`;
  const assetsPath = `assets/${name}`;

  const buffer = await file.arrayBuffer();
  await writeFileBinary(assetsPath, new Uint8Array(buffer));

  const pos = view.state.selection.main.head;
  view.dispatch({ changes: { from: pos, insert: `![${file.name}](./assets/${name})` } });
}

const imagePasteDropExtension = EditorView.domEventHandlers({
  paste(event, view) {
    const items = event.clipboardData?.items;
    if (!items) return false;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) handleImageInsert(file, view);
        return true;
      }
    }
    return false;
  },
  drop(event, view) {
    const files = event.dataTransfer?.files;
    if (!files) return false;
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        event.preventDefault();
        handleImageInsert(file, view);
        return true;
      }
    }
    return false;
  },
});

export function createEditorState(
  doc: string,
  onUpdate: (content: string) => void
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      bracketMatching(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        if (update.transactions.some((t) => t.annotation(syncAnnotation))) return;
        onUpdate(update.state.doc.toString());
      }),
      imagePasteDropExtension,
      baseTheme,
      themeCompartment.of(lightTheme),
      decorationCompartment.of(allDecorations),
    ],
  });
}

export function createEditorView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ state, parent });
}

export function applyTheme(view: EditorView, dark: boolean) {
  view.dispatch({
    effects: themeCompartment.reconfigure(dark ? darkTheme : lightTheme),
  });
}

export function setSourceMode(view: EditorView, sourceMode: boolean) {
  view.dispatch({
    effects: decorationCompartment.reconfigure(sourceMode ? [] : allDecorations),
  });
}
