/**
 * Tests for tauri.ts — verifies each wrapper calls invoke() with the correct
 * command name and argument shape.  The Tauri backend itself is mocked via
 * src/test-setup.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  readFile,
  writeFile,
  writeFileBinary,
  listDir,
  ensureDataDir,
  createDir,
  deleteFile,
  renameFile,
  searchNotes,
  rebuildSearchIndex,
  updateSearchIndex,
  listNoteTitles,
  findBacklinks,
  listAllTags,
  listNotesByTag,
  trashFile,
  readSettings,
  writeSettings,
} from './tauri';

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(null);
});

// ── File I/O ──────────────────────────────────────────────────────────────────

describe('readFile', () => {
  it('calls read_file with the given path', async () => {
    mockedInvoke.mockResolvedValue('file contents');
    const result = await readFile('notes/foo.md');
    expect(mockedInvoke).toHaveBeenCalledWith('read_file', { path: 'notes/foo.md' });
    expect(result).toBe('file contents');
  });

  it('propagates errors from invoke', async () => {
    mockedInvoke.mockRejectedValue(new Error('File not found'));
    await expect(readFile('missing.md')).rejects.toThrow('File not found');
  });
});

describe('writeFile', () => {
  it('calls write_file with path and content', async () => {
    await writeFile('notes/bar.md', '# Bar\n\nContent');
    expect(mockedInvoke).toHaveBeenCalledWith('write_file', {
      path: 'notes/bar.md',
      content: '# Bar\n\nContent',
    });
  });
});

describe('writeFileBinary', () => {
  it('calls write_file_binary with path and data array', async () => {
    const data = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    await writeFileBinary('assets/image.png', data);
    expect(mockedInvoke).toHaveBeenCalledWith('write_file_binary', {
      path: 'assets/image.png',
      data: [137, 80, 78, 71],
    });
  });

  it('converts Uint8Array to a plain array', async () => {
    const data = new Uint8Array([1, 2, 3]);
    await writeFileBinary('x.bin', data);
    const call = mockedInvoke.mock.calls[0];
    expect(Array.isArray((call[1] as Record<string, unknown>).data)).toBe(true);
  });
});

describe('listDir', () => {
  it('calls list_dir with null when no path given', async () => {
    mockedInvoke.mockResolvedValue([]);
    await listDir();
    expect(mockedInvoke).toHaveBeenCalledWith('list_dir', { path: null });
  });

  it('passes the provided path', async () => {
    mockedInvoke.mockResolvedValue([]);
    await listDir('notes');
    expect(mockedInvoke).toHaveBeenCalledWith('list_dir', { path: 'notes' });
  });

  it('passes null for empty string (falsy path)', async () => {
    mockedInvoke.mockResolvedValue([]);
    await listDir('');
    expect(mockedInvoke).toHaveBeenCalledWith('list_dir', { path: null });
  });
});

describe('ensureDataDir', () => {
  it('calls ensure_data_dir with no arguments', async () => {
    mockedInvoke.mockResolvedValue('/home/user/.kosha-data');
    const result = await ensureDataDir();
    expect(mockedInvoke).toHaveBeenCalledWith('ensure_data_dir');
    expect(result).toBe('/home/user/.kosha-data');
  });
});

describe('createDir', () => {
  it('calls create_dir with path', async () => {
    await createDir('projects/kosha');
    expect(mockedInvoke).toHaveBeenCalledWith('create_dir', { path: 'projects/kosha' });
  });
});

describe('deleteFile', () => {
  it('calls delete_file with path', async () => {
    await deleteFile('old-note.md');
    expect(mockedInvoke).toHaveBeenCalledWith('delete_file', { path: 'old-note.md' });
  });
});

describe('renameFile', () => {
  it('calls rename_file with from and to', async () => {
    await renameFile('old.md', 'new.md');
    expect(mockedInvoke).toHaveBeenCalledWith('rename_file', { from: 'old.md', to: 'new.md' });
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

describe('searchNotes', () => {
  it('calls search_notes with query and default limit 20', async () => {
    mockedInvoke.mockResolvedValue([]);
    await searchNotes('hello');
    expect(mockedInvoke).toHaveBeenCalledWith('search_notes', { query: 'hello', limit: 20 });
  });

  it('passes a custom limit', async () => {
    mockedInvoke.mockResolvedValue([]);
    await searchNotes('rust', 5);
    expect(mockedInvoke).toHaveBeenCalledWith('search_notes', { query: 'rust', limit: 5 });
  });
});

describe('rebuildSearchIndex', () => {
  it('calls rebuild_search_index and returns count', async () => {
    mockedInvoke.mockResolvedValue(42);
    const count = await rebuildSearchIndex();
    expect(mockedInvoke).toHaveBeenCalledWith('rebuild_search_index');
    expect(count).toBe(42);
  });
});

describe('updateSearchIndex', () => {
  it('calls update_search_index with the path', async () => {
    await updateSearchIndex('notes/hello.md');
    expect(mockedInvoke).toHaveBeenCalledWith('update_search_index', { path: 'notes/hello.md' });
  });
});

describe('listNoteTitles', () => {
  it('calls list_note_titles', async () => {
    mockedInvoke.mockResolvedValue([['notes/a.md', 'A']]);
    const result = await listNoteTitles();
    expect(mockedInvoke).toHaveBeenCalledWith('list_note_titles');
    expect(result).toEqual([['notes/a.md', 'A']]);
  });
});

describe('findBacklinks', () => {
  it('calls find_backlinks with noteName', async () => {
    mockedInvoke.mockResolvedValue([]);
    await findBacklinks('MyNote');
    expect(mockedInvoke).toHaveBeenCalledWith('find_backlinks', { noteName: 'MyNote' });
  });
});

// ── Tags ──────────────────────────────────────────────────────────────────────

describe('listAllTags', () => {
  it('calls list_all_tags', async () => {
    mockedInvoke.mockResolvedValue([['rust', 5], ['svelte', 3]]);
    const result = await listAllTags();
    expect(mockedInvoke).toHaveBeenCalledWith('list_all_tags');
    expect(result).toEqual([['rust', 5], ['svelte', 3]]);
  });
});

describe('listNotesByTag', () => {
  it('calls list_notes_by_tag with the tag', async () => {
    mockedInvoke.mockResolvedValue(['notes/a.md', 'notes/b.md']);
    const result = await listNotesByTag('rust');
    expect(mockedInvoke).toHaveBeenCalledWith('list_notes_by_tag', { tag: 'rust' });
    expect(result).toEqual(['notes/a.md', 'notes/b.md']);
  });
});

// ── Trash ─────────────────────────────────────────────────────────────────────

describe('trashFile', () => {
  it('calls trash_file with path', async () => {
    await trashFile('notes/old.md');
    expect(mockedInvoke).toHaveBeenCalledWith('trash_file', { path: 'notes/old.md' });
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

describe('readSettings', () => {
  it('calls read_settings and returns the object', async () => {
    mockedInvoke.mockResolvedValue({ theme: 'dark' });
    const settings = await readSettings();
    expect(mockedInvoke).toHaveBeenCalledWith('read_settings');
    expect(settings).toEqual({ theme: 'dark' });
  });
});

describe('writeSettings', () => {
  it('calls write_settings with the settings object', async () => {
    await writeSettings({ theme: 'light', fontSize: 16 });
    expect(mockedInvoke).toHaveBeenCalledWith('write_settings', {
      settings: { theme: 'light', fontSize: 16 },
    });
  });
});
