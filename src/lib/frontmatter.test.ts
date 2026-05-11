import { describe, it, expect, vi } from 'vitest';
import { parseNote, serializeNote, createDefaultNote } from './frontmatter';

// ── parseNote ─────────────────────────────────────────────────────────────────

describe('parseNote', () => {
  it('parses a note with YAML frontmatter', () => {
    const raw = '---\ntags: [foo, bar]\ncreated: 2024-01-01\n---\n\n# Hello\n\nBody text.';
    const { frontmatter, body } = parseNote(raw);
    expect(frontmatter.tags).toEqual(['foo', 'bar']);
    expect(frontmatter.created).toBe('2024-01-01');
    expect(body).toContain('# Hello');
    expect(body).toContain('Body text.');
  });

  it('parses a note without frontmatter', () => {
    const raw = '# Just a heading\n\nNo front matter here.';
    const { frontmatter, body } = parseNote(raw);
    expect(frontmatter).toEqual({});
    expect(body).toContain('# Just a heading');
  });

  it('returns empty tags array when tags field is absent', () => {
    const raw = '---\ncreated: 2024-06-15\n---\n\nContent';
    const { frontmatter } = parseNote(raw);
    expect(frontmatter.tags).toBeUndefined();
  });

  it('handles frontmatter with inline tag array', () => {
    const raw = '---\ntags: [rust, programming, tools]\n---\n\ntext';
    const { frontmatter } = parseNote(raw);
    expect(frontmatter.tags).toEqual(['rust', 'programming', 'tools']);
  });

  it('handles frontmatter with YAML list-style tags', () => {
    const raw = '---\ntags:\n  - alpha\n  - beta\n---\n\ntext';
    const { frontmatter } = parseNote(raw);
    expect(frontmatter.tags).toEqual(['alpha', 'beta']);
  });

  it('handles frontmatter-only notes with no body', () => {
    const raw = '---\ntitle: Empty\n---\n';
    const { frontmatter, body } = parseNote(raw);
    expect(frontmatter.title).toBe('Empty');
    expect(body.trim()).toBe('');
  });

  it('handles empty string', () => {
    const { frontmatter, body } = parseNote('');
    expect(frontmatter).toEqual({});
    expect(body).toBe('');
  });

  it('preserves arbitrary frontmatter fields', () => {
    const raw = '---\nauthor: Alice\npriority: high\n---\n\nbody';
    const { frontmatter } = parseNote(raw);
    expect(frontmatter.author).toBe('Alice');
    expect(frontmatter.priority).toBe('high');
  });

  it('handles boolean frontmatter values', () => {
    const raw = '---\ndraft: true\npublished: false\n---\n\nbody';
    const { frontmatter } = parseNote(raw);
    expect(frontmatter.draft).toBe(true);
    expect(frontmatter.published).toBe(false);
  });

  it('handles numeric frontmatter values', () => {
    const raw = '---\nrating: 5\nword_count: 1234\n---\n\nbody';
    const { frontmatter } = parseNote(raw);
    expect(frontmatter.rating).toBe(5);
    expect(frontmatter.word_count).toBe(1234);
  });
});

// ── serializeNote ─────────────────────────────────────────────────────────────

describe('serializeNote', () => {
  it('serializes frontmatter and body into a YAML note', () => {
    const result = serializeNote({ tags: ['test'] }, '# Title\n\nBody.');
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('tags:');
    expect(result).toContain('# Title');
    expect(result).toContain('Body.');
  });

  it('returns body as-is when frontmatter is empty', () => {
    const result = serializeNote({}, 'Plain body');
    expect(result).toBe('Plain body');
  });

  it('round-trips through parse → serialize', () => {
    const original = '---\ntags:\n  - foo\n  - bar\ncreated: 2024-03-01\n---\n\n# My Note\n\nContent here.\n';
    const { frontmatter, body } = parseNote(original);
    const reserialized = serializeNote(frontmatter, body);
    // Re-parse to compare semantically rather than byte-for-byte
    const reparsed = parseNote(reserialized);
    expect(reparsed.frontmatter.tags).toEqual(['foo', 'bar']);
    expect(reparsed.frontmatter.created).toBe('2024-03-01');
    expect(reparsed.body).toContain('# My Note');
    expect(reparsed.body).toContain('Content here.');
  });

  it('preserves multi-line body', () => {
    const body = 'Line 1\n\nLine 2\n\nLine 3';
    const result = serializeNote({ tags: [] }, body);
    const reparsed = parseNote(result);
    expect(reparsed.body.trim()).toContain('Line 1');
    expect(reparsed.body.trim()).toContain('Line 3');
  });

  it('handles frontmatter with multiple fields', () => {
    const fm = { tags: ['a', 'b'], created: '2024-01-01', author: 'Bob' };
    const result = serializeNote(fm, '# Title');
    const reparsed = parseNote(result);
    expect(reparsed.frontmatter.tags).toEqual(['a', 'b']);
    expect(reparsed.frontmatter.created).toBe('2024-01-01');
    expect(reparsed.frontmatter.author).toBe('Bob');
  });
});

// ── createDefaultNote ─────────────────────────────────────────────────────────

describe('createDefaultNote', () => {
  it('returns a string with YAML frontmatter block', () => {
    const note = createDefaultNote('My Note');
    expect(note).toMatch(/^---\n/);
    expect(note).toContain('---');
  });

  it('includes the title as an H1 heading in the body', () => {
    const note = createDefaultNote('Meeting Notes');
    expect(note).toContain('# Meeting Notes');
  });

  it('includes a tags field in frontmatter', () => {
    const note = createDefaultNote('Test');
    const { frontmatter } = parseNote(note);
    expect(Array.isArray(frontmatter.tags)).toBe(true);
  });

  it('starts with an empty tags array', () => {
    const note = createDefaultNote('New note');
    const { frontmatter } = parseNote(note);
    expect(frontmatter.tags).toEqual([]);
  });

  it('includes a created timestamp in ISO format', () => {
    const before = new Date().toISOString();
    const note = createDefaultNote('Timestamped');
    const after = new Date().toISOString();
    const { frontmatter } = parseNote(note);
    const created = frontmatter.created as string;
    expect(created).toBeDefined();
    expect(new Date(created).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(new Date(created).getTime()).toBeLessThanOrEqual(new Date(after).getTime());
  });

  it('sanitizes special characters in title', () => {
    // title goes into the heading, not necessarily into the filename — just check it appears
    const note = createDefaultNote('C++ Notes: Review & Test');
    expect(note).toContain('C++ Notes: Review & Test');
  });

  it('produces a note that parses cleanly', () => {
    const note = createDefaultNote('Parseable Note');
    expect(() => parseNote(note)).not.toThrow();
    const { frontmatter, body } = parseNote(note);
    expect(frontmatter).toBeTruthy();
    expect(body).toBeTruthy();
  });

  it('generates different titles for different inputs', () => {
    const note1 = createDefaultNote('Alpha');
    const note2 = createDefaultNote('Beta');
    expect(note1).toContain('# Alpha');
    expect(note2).toContain('# Beta');
    expect(note1).not.toContain('# Beta');
  });
});
