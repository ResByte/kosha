/**
 * Live-preview decorations for markdown.
 *
 * CodeMirror requires block-replacing decorations to come from a StateField,
 * not a ViewPlugin (it throws "Block decorations may not be specified via
 * plugins" otherwise). So this module exposes two extensions:
 *   - blockDecorationsField   — StateField for frontmatter / code blocks / tables
 *   - inlineDecorationsPlugin — ViewPlugin for everything else
 *
 * Both share helper widget classes and the tree walk shape. Each handler
 * hides its source markup when the caret is outside the relevant range and
 * exposes raw markdown when it's inside — Obsidian-style live preview.
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { type Range, StateField, type EditorState, type Extension } from '@codemirror/state';
import { highlightTree, classHighlighter } from '@lezer/highlight';
import { languages } from '@codemirror/language-data';
import { convertFileSrc } from '@tauri-apps/api/core';
import katex from 'katex';
import { dataDirPath } from '$lib/editor/context';
import { app } from '$lib/stores/app.svelte';

// ─── Shared marks ────────────────────────────────────────────────────────────

const hideMarker = Decoration.replace({});
const boldMark = Decoration.mark({ class: 'cm-bold' });
const italicMark = Decoration.mark({ class: 'cm-italic' });
const strikeMark = Decoration.mark({ class: 'cm-strikethrough' });
const inlineCodeMark = Decoration.mark({ class: 'cm-inline-code' });

const headingStyles: Record<string, string> = {
  ATXHeading1: 'cm-heading cm-heading-1',
  ATXHeading2: 'cm-heading cm-heading-2',
  ATXHeading3: 'cm-heading cm-heading-3',
  ATXHeading4: 'cm-heading cm-heading-4',
  ATXHeading5: 'cm-heading cm-heading-5',
  ATXHeading6: 'cm-heading cm-heading-6',
};

// ─── Widgets ─────────────────────────────────────────────────────────────────

class LinkWidget extends WidgetType {
  constructor(readonly text: string, readonly url: string) { super(); }
  eq(o: LinkWidget) { return o.text === this.text && o.url === this.url; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-link-widget';
    el.textContent = this.text;
    el.title = this.url;
    el.setAttribute('data-url', this.url);
    return el;
  }
  ignoreEvent() { return false; }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  eq(o: CheckboxWidget) { return o.checked === this.checked; }
  toDOM() {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'cm-checkbox';
    el.checked = this.checked;
    el.setAttribute('data-pos', String(this.pos));
    return el;
  }
  ignoreEvent() { return false; }
}

class HRWidget extends WidgetType {
  toDOM() { const el = document.createElement('hr'); el.className = 'cm-hr'; return el; }
  ignoreEvent() { return true; }
}
const hrWidget = new HRWidget();

class ImageWidget extends WidgetType {
  constructor(readonly alt: string, readonly src: string) { super(); }
  eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt; }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-image-widget';
    const img = document.createElement('img');
    img.alt = this.alt;
    img.className = 'cm-image';
    img.src = resolveImageSrc(this.src);
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent() { return true; }
}

function resolveImageSrc(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  const decoded = decodeURIComponent(src);
  const absPath = decoded.startsWith('/')
    ? decoded
    : `${dataDirPath}/${decoded.replace(/^\.\//, '')}`;
  return convertFileSrc(absPath);
}

class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean) { super(); }
  eq(o: MathWidget) { return o.tex === this.tex && o.display === this.display; }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-math-block' : 'cm-math-inline';
    try {
      katex.render(this.tex, el, { displayMode: this.display, throwOnError: false, output: 'html', trust: false });
    } catch {
      el.textContent = this.tex;
      el.classList.add('cm-math-error');
    }
    return el;
  }
  ignoreEvent() { return true; }
}

class WikiLinkWidget extends WidgetType {
  constructor(readonly linkText: string, readonly exists: boolean) { super(); }
  eq(o: WikiLinkWidget) { return o.linkText === this.linkText && o.exists === this.exists; }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-wiki-link ${this.exists ? 'cm-wiki-link-exists' : 'cm-wiki-link-missing'}`;
    el.textContent = this.linkText;
    el.setAttribute('data-link', this.linkText);
    return el;
  }
  ignoreEvent() { return false; }
}

class FrontmatterBadgeWidget extends WidgetType {
  constructor(readonly fieldCount: number) { super(); }
  eq(o: FrontmatterBadgeWidget) { return o.fieldCount === this.fieldCount; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-frontmatter-badge';
    el.textContent = `Metadata (${this.fieldCount} field${this.fieldCount !== 1 ? 's' : ''})`;
    return el;
  }
  ignoreEvent() { return false; }
}

class CodeBlockWidget extends WidgetType {
  constructor(readonly lang: string, readonly code: string) { super(); }
  eq(o: CodeBlockWidget) { return o.lang === this.lang && o.code === this.code; }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-code-block';

    const header = document.createElement('div');
    header.className = 'cm-code-block-header';
    const langLabel = document.createElement('span');
    langLabel.className = 'cm-code-block-lang';
    langLabel.textContent = this.lang || 'plain text';
    header.appendChild(langLabel);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'cm-code-block-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.code).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 2000);
      });
    };
    header.appendChild(copyBtn);
    wrap.appendChild(header);

    const pre = document.createElement('pre');
    pre.className = 'cm-code-block-pre';
    const codeEl = document.createElement('code');
    codeEl.textContent = this.code;
    pre.appendChild(codeEl);
    wrap.appendChild(pre);

    if (this.lang) {
      highlightCode(this.code, this.lang).then((html) => { codeEl.innerHTML = html; });
    }
    return wrap;
  }
  ignoreEvent() { return false; }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function highlightCode(code: string, langName: string): Promise<string> {
  const langDesc = languages.find(
    (l) =>
      l.name.toLowerCase() === langName.toLowerCase() ||
      l.alias.some((a) => a.toLowerCase() === langName.toLowerCase())
  );
  if (!langDesc) return escapeHtml(code);
  try {
    const langSupport = await langDesc.load();
    const tree = langSupport.language.parser.parse(code);
    let html = '';
    let pos = 0;
    highlightTree(tree, classHighlighter, (from, to, cls) => {
      if (from > pos) html += escapeHtml(code.slice(pos, from));
      html += `<span class="${cls}">${escapeHtml(code.slice(from, to))}</span>`;
      pos = to;
    });
    if (pos < code.length) html += escapeHtml(code.slice(pos));
    return html;
  } catch {
    return escapeHtml(code);
  }
}

interface TableData {
  headers: string[];
  alignments: Array<'left' | 'center' | 'right' | 'none'>;
  rows: string[][];
}

class TableWidget extends WidgetType {
  constructor(readonly tableData: TableData) { super(); }
  eq(o: TableWidget) {
    const a = this.tableData, b = o.tableData;
    return a.headers.length === b.headers.length &&
      a.rows.length === b.rows.length &&
      a.headers.every((h, i) => h === b.headers[i]) &&
      a.rows.every((r, i) => r.length === b.rows[i].length && r.every((c, j) => c === b.rows[i][j]));
  }
  toDOM() { return renderTableDOM(this.tableData); }
  ignoreEvent() { return true; }
}

function parseTableCells(line: string): string[] {
  return line.split('|').slice(1, -1).map((c) => c.trim());
}

function parseTable(lines: string[]): TableData | null {
  if (lines.length < 2) return null;
  const headers = parseTableCells(lines[0]);
  const separators = parseTableCells(lines[1]);
  if (!separators.every((s) => /^:?-+:?$/.test(s.trim()))) return null;
  const alignments = separators.map((cell): 'left' | 'center' | 'right' | 'none' => {
    const t = cell.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    if (t.startsWith(':')) return 'left';
    return 'none';
  });
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].trim()) break;
    rows.push(parseTableCells(lines[i]));
  }
  return { headers, alignments, rows };
}

function renderTableDOM(data: TableData): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cm-table-wrap';
  const table = document.createElement('table');
  table.className = 'cm-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  data.headers.forEach((cell, i) => {
    const th = document.createElement('th');
    th.textContent = cell;
    th.style.textAlign = data.alignments[i] === 'none' ? 'left' : data.alignments[i];
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  if (data.rows.length > 0) {
    const tbody = document.createElement('tbody');
    data.rows.forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((cell, i) => {
        const td = document.createElement('td');
        td.textContent = cell;
        td.style.textAlign = data.alignments[i] === 'none' ? 'left' : (data.alignments[i] ?? 'left');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }
  wrap.appendChild(table);
  return wrap;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cursorOutside(from: number, to: number, head: number): boolean {
  return head < from || head > to;
}

function findInnerNode(parent: { from: number; node: { toTree(): { iterate(spec: { enter(n: { name: string; from: number; to: number }): void }): void } } }, names: string[]): Record<string, { from: number; to: number }> {
  const found: Record<string, { from: number; to: number }> = {};
  parent.node.toTree().iterate({
    enter(inner) {
      if (names.includes(inner.name) && !found[inner.name]) {
        found[inner.name] = { from: parent.from + inner.from, to: parent.from + inner.to };
      }
    },
  });
  return found;
}

function noteExists(name: string): boolean {
  function searchTree(entries: typeof app.fileTree): boolean {
    for (const e of entries) {
      if (!e.is_dir && e.name.replace(/\.md$/, '') === name) return true;
      if (e.children && searchTree(e.children)) return true;
    }
    return false;
  }
  return searchTree(app.fileTree);
}

// ─── Block decorations (StateField — CodeMirror requires this) ──────────────

/// Frontmatter, fenced code blocks, and tables — anything that uses
/// `Decoration.replace({ ..., block: true })`. CodeMirror REJECTS block
/// decorations supplied from a ViewPlugin, so they must live in a StateField.
function buildBlockDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { doc, selection } = state;
  const head = selection.main.head;

  // Frontmatter — collapse the YAML block into a one-line badge.
  if (doc.lines >= 1 && doc.line(1).text.trim() === '---') {
    let frontmatterEnd = -1;
    for (let i = 2; i <= Math.min(doc.lines, 50); i++) {
      if (doc.line(i).text.trim() === '---') { frontmatterEnd = i; break; }
    }
    if (frontmatterEnd !== -1) {
      const fmFrom = doc.line(1).from;
      const fmTo = doc.line(frontmatterEnd).to;
      if (cursorOutside(fmFrom, fmTo, head)) {
        let yaml = '';
        for (let i = 2; i < frontmatterEnd; i++) yaml += doc.line(i).text + '\n';
        const fieldCount = yaml.split('\n').filter((l) => /^\s*\w+\s*:/.test(l)).length;
        ranges.push(
          Decoration.replace({ widget: new FrontmatterBadgeWidget(fieldCount), block: true })
            .range(fmFrom, fmTo)
        );
      }
    }
  }

  // Fenced code blocks and tables — syntax tree walk.
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode') {
        if (head >= node.from && head <= node.to) return false;
        const inner = findInnerNode(node, ['CodeInfo', 'CodeText']);
        const lang = inner.CodeInfo ? doc.sliceString(inner.CodeInfo.from, inner.CodeInfo.to).trim() : '';
        const codeFrom = inner.CodeText?.from ?? node.from;
        const codeTo = inner.CodeText?.to ?? node.to;
        const code = doc.sliceString(codeFrom, codeTo).replace(/\n$/, '');
        ranges.push(
          Decoration.replace({ widget: new CodeBlockWidget(lang, code), block: true })
            .range(node.from, node.to)
        );
        return false;
      }
      if (node.name === 'Table') {
        if (head >= node.from && head <= node.to) return false;
        const tableText = doc.sliceString(node.from, node.to);
        const lines = tableText.split('\n').filter((l) => l.trim().length > 0);
        const data = parseTable(lines);
        if (data && data.headers.length > 0) {
          ranges.push(
            Decoration.replace({ widget: new TableWidget(data), block: true })
              .range(node.from, node.to)
          );
        }
        return false;
      }
    },
  });

  return Decoration.set(ranges, true);
}

const blockDecorationsField = StateField.define<DecorationSet>({
  create(state) { return buildBlockDecorations(state); },
  update(value, tr) {
    if (tr.docChanged) return buildBlockDecorations(tr.state);
    if (tr.selection) {
      const prevLine = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
      const newLine = tr.state.doc.lineAt(tr.state.selection.main.head).number;
      if (prevLine !== newLine) return buildBlockDecorations(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ─── Inline / line decorations (ViewPlugin) ─────────────────────────────────

/// Everything that isn't a block decoration: headings, emphasis, blockquote
/// line classes, inline code, links, images, tasks, HR, inline math, and
/// wiki-links. These can live in a ViewPlugin.
function buildInlineDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { doc, selection } = view.state;
  const head = selection.main.head;
  const cursorLineNum = doc.lineAt(head).number;
  const visFrom = view.visibleRanges[0]?.from ?? 0;
  const visTo = view.visibleRanges[view.visibleRanges.length - 1]?.to ?? doc.length;

  syntaxTree(view.state).iterate({
    from: visFrom,
    to: visTo,
    enter(node) {
      const name = node.name;

      // Headings: hide markers and apply line class when caret is off the line
      if (headingStyles[name]) {
        const line = doc.lineAt(node.from);
        if (line.number !== cursorLineNum) {
          const inner = findInnerNode(node, ['HeaderMark']);
          if (inner.HeaderMark && inner.HeaderMark.to + 1 <= node.to) {
            ranges.push(hideMarker.range(inner.HeaderMark.from, inner.HeaderMark.to + 1));
          }
          ranges.push(Decoration.line({ class: headingStyles[name] }).range(line.from));
        }
        return;
      }

      if (name === 'StrongEmphasis') {
        if (cursorOutside(node.from, node.to, head)) {
          ranges.push(hideMarker.range(node.from, node.from + 2));
          ranges.push(hideMarker.range(node.to - 2, node.to));
          ranges.push(boldMark.range(node.from + 2, node.to - 2));
        }
        return false;
      }
      if (name === 'Emphasis') {
        if (cursorOutside(node.from, node.to, head)) {
          ranges.push(hideMarker.range(node.from, node.from + 1));
          ranges.push(hideMarker.range(node.to - 1, node.to));
          ranges.push(italicMark.range(node.from + 1, node.to - 1));
        }
        return false;
      }
      if (name === 'Strikethrough') {
        if (cursorOutside(node.from, node.to, head)) {
          ranges.push(hideMarker.range(node.from, node.from + 2));
          ranges.push(hideMarker.range(node.to - 2, node.to));
          ranges.push(strikeMark.range(node.from + 2, node.to - 2));
        }
        return false;
      }
      if (name === 'InlineCode') {
        if (cursorOutside(node.from, node.to, head)) {
          const text = view.state.sliceDoc(node.from, node.to);
          let tickLen = 0;
          while (tickLen < text.length && text[tickLen] === '`') tickLen++;
          ranges.push(hideMarker.range(node.from, node.from + tickLen));
          ranges.push(hideMarker.range(node.to - tickLen, node.to));
          ranges.push(inlineCodeMark.range(node.from + tickLen, node.to - tickLen));
        }
        return false;
      }
      if (name === 'Blockquote') {
        for (let pos = node.from; pos <= node.to; ) {
          const line = doc.lineAt(pos);
          ranges.push(Decoration.line({ class: 'cm-blockquote' }).range(line.from));
          const match = line.text.match(/^(>+\s?)/);
          if (match) ranges.push(hideMarker.range(line.from, line.from + match[0].length));
          pos = line.to + 1;
        }
        return false;
      }
      if (name === 'Link') {
        if (cursorOutside(node.from, node.to, head)) {
          const inner = findInnerNode(node, ['LinkText', 'URL']);
          if (inner.LinkText) {
            const textFrom = inner.LinkText.from + 1;
            const textTo = inner.LinkText.to - 1;
            const linkText = view.state.sliceDoc(textFrom, textTo);
            const linkUrl = inner.URL ? view.state.sliceDoc(inner.URL.from, inner.URL.to) : '';
            if (linkText) {
              ranges.push(
                Decoration.replace({ widget: new LinkWidget(linkText, linkUrl) }).range(node.from, node.to)
              );
            }
          }
        }
        return false;
      }
      if (name === 'Image') {
        const line = doc.lineAt(node.from);
        if (head >= line.from && head <= line.to) return false;
        const inner = findInnerNode(node, ['URL', 'LinkLabel']);
        const src = inner.URL ? doc.sliceString(inner.URL.from, inner.URL.to) : '';
        const alt = inner.LinkLabel ? doc.sliceString(inner.LinkLabel.from + 1, inner.LinkLabel.to - 1) : '';
        if (src) {
          ranges.push(
            Decoration.replace({ widget: new ImageWidget(alt, src) }).range(node.from, node.to)
          );
        }
        return false;
      }
      if (name === 'Task') {
        const inner = findInnerNode(node, ['TaskMarker']);
        if (inner.TaskMarker) {
          const markerText = view.state.sliceDoc(inner.TaskMarker.from, inner.TaskMarker.to);
          const checked = markerText.toLowerCase() === '[x]';
          ranges.push(
            Decoration.replace({ widget: new CheckboxWidget(checked, inner.TaskMarker.from) })
              .range(inner.TaskMarker.from, inner.TaskMarker.to)
          );
        }
        return false;
      }
      if (name === 'HorizontalRule') {
        const line = doc.lineAt(node.from);
        if (cursorOutside(line.from, line.to, head)) {
          ranges.push(Decoration.replace({ widget: hrWidget }).range(node.from, node.to));
        }
        return false;
      }
      // FencedCode and Table are handled by blockDecorationsField — skip here.
      if (name === 'FencedCode' || name === 'Table') return false;
    },
  });

  // Inline math $...$ (block $$...$$ is also inline-replace because KaTeX
  // renders inline; CodeMirror only treats `block: true` decorations as block).
  // Only scan visible range to avoid full-document string allocation.
  const blockMathRanges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  const blockMathRe = /\$\$([\s\S]+?)\$\$/g;
  const inlineMathRe = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;
  const wikiRe = /\[\[([^\]]+)\]\]/g;

  const visStartLine = doc.lineAt(visFrom).number;
  const visEndLine = doc.lineAt(visTo).number;

  // Scan visible lines only for block math, inline math, and wiki-links.
  for (let lineNum = visStartLine; lineNum <= visEndLine; lineNum++) {
    const line = doc.line(lineNum);

    // Block math (may span lines — capture opener line, regex across sliced text)
    blockMathRe.lastIndex = 0;
    while ((m = blockMathRe.exec(line.text)) !== null) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      blockMathRanges.push([from, to]);
      if (cursorOutside(from, to, head)) {
        ranges.push(
          Decoration.replace({ widget: new MathWidget(m[1].trim(), true) }).range(from, to)
        );
      }
    }

    // Inline math — skip lines inside a block math range
    if (blockMathRanges.some(([a, b]) => line.from >= a && line.from < b)) continue;
    inlineMathRe.lastIndex = 0;
    while ((m = inlineMathRe.exec(line.text)) !== null) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (cursorOutside(from, to, head)) {
        ranges.push(Decoration.replace({ widget: new MathWidget(m[1], false) }).range(from, to));
      }
    }

    // Wiki-links [[Name]]
    wikiRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = wikiRe.exec(line.text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      if (cursorOutside(from, to, head)) {
        const linkName = match[1];
        ranges.push(
          Decoration.replace({ widget: new WikiLinkWidget(linkName, noteExists(linkName)) })
            .range(from, to)
        );
      }
    }
  }

  return Decoration.set(ranges, true);
}

const inlineDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildInlineDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildInlineDecorations(update.view);
      } else if (update.selectionSet) {
        const prevLine = update.startState.doc.lineAt(update.startState.selection.main.head).number;
        const newLine = update.state.doc.lineAt(update.state.selection.main.head).number;
        if (prevLine !== newLine) this.decorations = buildInlineDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      click(e, view) {
        const target = e.target as HTMLElement;
        if (target.classList.contains('cm-link-widget')) {
          const url = target.getAttribute('data-url');
          if (url && (e.metaKey || e.ctrlKey)) {
            import('@tauri-apps/plugin-shell').then(({ open }) => open(url)).catch(() => {
              window.open(url, '_blank');
            });
          }
        } else if (target.classList.contains('cm-wiki-link')) {
          const linkName = target.getAttribute('data-link');
          if (linkName) {
            target.dispatchEvent(new CustomEvent('wiki-link-click', { detail: { linkName }, bubbles: true }));
          }
        }
      },
      mousedown(e, view) {
        const target = e.target as HTMLInputElement;
        if (target.classList.contains('cm-checkbox')) {
          e.preventDefault();
          const pos = parseInt(target.getAttribute('data-pos') ?? '0');
          const currentText = view.state.sliceDoc(pos, pos + 3);
          const newText = currentText === '[ ]' ? '[x]' : '[ ]';
          view.dispatch({ changes: { from: pos, to: pos + 3, insert: newText } });
          return true;
        }
      },
    },
  }
);

/// Combined extension: order matters — the state field is added before the
/// view plugin so block decorations are in place before inline ones layer on.
export const decorationsExtension: Extension = [blockDecorationsField, inlineDecorationsPlugin];

// ─── Theme ───────────────────────────────────────────────────────────────────

export const decorationsTheme = EditorView.baseTheme({
  // Headings
  '.cm-heading': { fontFamily: 'var(--font-sans)', fontWeight: '700', lineHeight: '1.3' },
  '.cm-heading-1': { fontSize: '2em', color: 'var(--color-text)' },
  '.cm-heading-2': { fontSize: '1.6em', color: 'var(--color-text)' },
  '.cm-heading-3': { fontSize: '1.3em', color: 'var(--color-text)' },
  '.cm-heading-4': { fontSize: '1.1em', color: 'var(--color-text)' },
  '.cm-heading-5': { fontSize: '1em', color: 'var(--color-text-muted)' },
  '.cm-heading-6': { fontSize: '0.9em', color: 'var(--color-text-muted)' },

  // Emphasis
  '.cm-bold': { fontWeight: '700' },
  '.cm-italic': { fontStyle: 'italic' },
  '.cm-strikethrough': { textDecoration: 'line-through', color: 'var(--color-text-muted)' },

  // Inline code
  '.cm-inline-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    borderRadius: '3px',
    padding: '1px 4px',
    color: 'var(--color-text)',
  },
  '&light .cm-inline-code': { backgroundColor: 'rgba(0,0,0,0.06)' },
  '&dark .cm-inline-code': { backgroundColor: 'rgba(255,255,255,0.1)' },

  // Blockquote
  '.cm-blockquote': {
    borderLeft: '3px solid var(--color-primary)',
    paddingLeft: '1rem',
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
    marginLeft: '0',
  },
  '&light .cm-blockquote': { backgroundColor: 'rgba(155, 92, 21, 0.05)' },
  '&dark .cm-blockquote': { backgroundColor: 'rgba(212, 168, 83, 0.07)' },

  // Links
  '.cm-link-widget': { color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer' },
  '.cm-link-widget:hover': { opacity: '0.8' },

  // Checkboxes
  '.cm-checkbox': { cursor: 'pointer', verticalAlign: 'middle', marginRight: '4px', accentColor: 'var(--color-primary)' },

  // HR
  '.cm-hr': { border: 'none', borderTop: '2px solid var(--color-border)', margin: '0.5em 0', display: 'block' },

  // Images
  '.cm-image-widget': { display: 'block', lineHeight: '1' },
  '.cm-image': { maxWidth: '100%', height: 'auto', borderRadius: '6px', display: 'block', margin: '0.25em 0' },

  // Math
  '.cm-math-inline': { display: 'inline', verticalAlign: 'middle', cursor: 'default' },
  '.cm-math-block': { display: 'block', textAlign: 'center', padding: '0.5em 0', overflowX: 'auto', cursor: 'default' },
  '.cm-math-error': { color: '#DC2626', fontFamily: 'var(--font-mono)', fontSize: '0.9em' },

  // Wiki-links
  '.cm-wiki-link': { borderRadius: '4px', padding: '1px 6px', fontSize: '0.9em', cursor: 'pointer', fontWeight: '500' },
  '.cm-wiki-link-exists': { color: 'var(--color-primary)' },
  '&light .cm-wiki-link-exists': { backgroundColor: 'rgba(155, 92, 21, 0.10)', border: '1px solid rgba(155, 92, 21, 0.3)' },
  '&dark .cm-wiki-link-exists': { backgroundColor: 'rgba(212, 168, 83, 0.15)', border: '1px solid rgba(212, 168, 83, 0.4)' },
  '&light .cm-wiki-link-missing': { backgroundColor: 'rgba(229, 62, 62, 0.08)', color: '#E53E3E', border: '1px dashed rgba(229, 62, 62, 0.4)' },
  '&dark .cm-wiki-link-missing': { backgroundColor: 'rgba(252, 129, 129, 0.1)', color: '#FC8181', border: '1px dashed rgba(252, 129, 129, 0.5)' },
  '.cm-wiki-link:hover': { opacity: '0.8' },

  // Frontmatter badge
  '.cm-frontmatter-badge': {
    display: 'inline-block',
    backgroundColor: 'var(--color-surface-alt, #F7FAFC)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    padding: '3px 10px',
    fontSize: '0.78em',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    userSelect: 'none',
    margin: '4px 0',
  },

  // Tables
  '.cm-table-wrap': { margin: '0.5em 1rem', overflowX: 'auto' },
  '.cm-table': { borderCollapse: 'collapse', width: '100%', fontSize: '0.9em', fontFamily: 'var(--font-sans)' },
  '.cm-table th': { fontWeight: '600', padding: '6px 12px', border: '1px solid var(--color-border)', color: 'var(--color-text)', whiteSpace: 'nowrap' },
  '.cm-table td': { padding: '6px 12px', border: '1px solid var(--color-border)', color: 'var(--color-text)', verticalAlign: 'top' },
  '&light .cm-table th': { backgroundColor: 'rgba(0,0,0,0.04)' },
  '&dark .cm-table th': { backgroundColor: 'rgba(255,255,255,0.06)' },
  '&light .cm-table tr:nth-child(even) td': { backgroundColor: 'rgba(0,0,0,0.02)' },
  '&dark .cm-table tr:nth-child(even) td': { backgroundColor: 'rgba(255,255,255,0.03)' },

  // Code blocks
  '.cm-code-block': {
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    margin: '0.5em 1rem',
    overflow: 'hidden',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-code-block-header': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 12px',
    borderBottom: '1px solid var(--color-border)',
  },
  '&light .cm-code-block-header': { backgroundColor: 'rgba(0,0,0,0.04)' },
  '&dark .cm-code-block-header': { backgroundColor: '#353739' },
  '.cm-code-block-lang': {
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-muted)',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  '.cm-code-block-copy': {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    opacity: '0',
    transition: 'opacity 0.15s, color 0.15s',
  },
  '.cm-code-block:hover .cm-code-block-copy': { opacity: '1' },
  '&light .cm-code-block-copy.copied': { color: '#38A169', borderColor: '#38A169' },
  '&dark .cm-code-block-copy.copied': { color: '#6A8759', borderColor: '#6A8759' },
  '.cm-code-block-pre': {
    margin: '0',
    padding: '12px 16px',
    overflowX: 'auto',
    fontSize: '13.5px',
    lineHeight: '1.6',
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text)',
    whiteSpace: 'pre',
  },
  '&light .cm-code-block-pre': { backgroundColor: 'rgba(0,0,0,0.02)' },
  '&dark .cm-code-block-pre': { backgroundColor: '#313335' },

  // @lezer/highlight tokens — light
  '&light .tok-keyword': { color: '#7C3AED', fontWeight: '600' },
  '&light .tok-string': { color: '#059669' },
  '&light .tok-string2': { color: '#059669' },
  '&light .tok-number': { color: '#D97706' },
  '&light .tok-comment': { color: '#6B7280', fontStyle: 'italic' },
  '&light .tok-variableName': { color: '#1D4ED8' },
  '&light .tok-typeName': { color: '#0891B2' },
  '&light .tok-className': { color: '#0891B2', fontWeight: '600' },
  '&light .tok-propertyName': { color: '#0F766E' },
  '&light .tok-operator': { color: '#BE185D' },
  '&light .tok-punctuation': { color: '#374151' },
  '&light .tok-meta': { color: '#6B7280' },
  '&light .tok-atom': { color: '#D97706' },
  '&light .tok-bool': { color: '#7C3AED' },
  '&light .tok-function(variableName)': { color: '#1D4ED8' },
  '&light .tok-definition(variableName)': { color: '#1D4ED8', fontWeight: '600' },
  '&light .tok-namespace': { color: '#0891B2' },
  '&light .tok-self': { color: '#7C3AED', fontStyle: 'italic' },
  '&light .tok-null': { color: '#7C3AED' },
  '&light .tok-regexp': { color: '#B45309' },
  '&light .tok-escape': { color: '#D97706' },
  '&light .tok-attributeName': { color: '#0F766E' },
  '&light .tok-attributeValue': { color: '#059669' },
  '&light .tok-tagName': { color: '#BE185D', fontWeight: '600' },
  '&light .tok-angleBracket': { color: '#6B7280' },
  '&light .tok-invalid': { color: '#DC2626' },

  // @lezer/highlight tokens — dark (Darcula-ish)
  '&dark .tok-keyword': { color: '#CC7832', fontWeight: '600' },
  '&dark .tok-string': { color: '#6A8759' },
  '&dark .tok-string2': { color: '#6A8759' },
  '&dark .tok-number': { color: '#6897BB' },
  '&dark .tok-comment': { color: '#808080', fontStyle: 'italic' },
  '&dark .tok-variableName': { color: '#A9B7C6' },
  '&dark .tok-typeName': { color: '#A9B7C6' },
  '&dark .tok-className': { color: '#FFC66D', fontWeight: '600' },
  '&dark .tok-propertyName': { color: '#9876AA' },
  '&dark .tok-operator': { color: '#A9B7C6' },
  '&dark .tok-punctuation': { color: '#A9B7C6' },
  '&dark .tok-meta': { color: '#BBB529' },
  '&dark .tok-atom': { color: '#CC7832' },
  '&dark .tok-bool': { color: '#CC7832' },
  '&dark .tok-function(variableName)': { color: '#FFC66D' },
  '&dark .tok-definition(variableName)': { color: '#FFC66D', fontWeight: '600' },
  '&dark .tok-namespace': { color: '#A9B7C6' },
  '&dark .tok-self': { color: '#94558D', fontStyle: 'italic' },
  '&dark .tok-null': { color: '#CC7832' },
  '&dark .tok-regexp': { color: '#6A8759' },
  '&dark .tok-escape': { color: '#CC7832' },
  '&dark .tok-attributeName': { color: '#BABABA' },
  '&dark .tok-attributeValue': { color: '#6A8759' },
  '&dark .tok-tagName': { color: '#E8BF6A', fontWeight: '600' },
  '&dark .tok-angleBracket': { color: '#A9B7C6' },
  '&dark .tok-invalid': { color: '#FF0000' },
});
