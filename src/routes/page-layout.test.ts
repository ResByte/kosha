/**
 * Regression guard for the editor-blank bug.
 *
 * In a `flex flex-col` parent, CodeMirror's editor container only resolves
 * `h-full` to a real height when its parent is allowed to shrink below its
 * intrinsic content size. The Tailwind incantation for that is `min-h-0`.
 *
 * If a future refactor drops it from the editor wrapper, the editor renders
 * into a zero-height box and the page area appears blank even though the
 * underlying state is correct. Happy-dom can't compute flex layout so we
 * guard the structural invariant textually.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(resolve(here, '+page.svelte'), 'utf8');

describe('+page.svelte editor wrapper', () => {
  it('keeps min-h-0 on the editor wrapper so flex children can shrink', () => {
    // Match: a wrapper div whose class contains both flex-1 and min-h-0,
    // immediately followed (allowing whitespace) by the <Editor /> element.
    const re = /class="[^"]*\bflex-1\b[^"]*\bmin-h-0\b[^"]*"[^>]*>\s*<Editor\b/;
    expect(pageSrc).toMatch(re);
  });

  it('does not nest the editor inside a flex column with overflow-y-auto', () => {
    // The previous broken layout had `<div class="... flex flex-col"><div class="flex-1 overflow-y-auto"><Editor`.
    // That structure collapsed the editor to 0 height. Regression guard.
    const broken = /flex\s+flex-col[^"]*"[^>]*>\s*<div[^>]*overflow-y-auto[^>]*>\s*<Editor\b/;
    expect(pageSrc).not.toMatch(broken);
  });
});
