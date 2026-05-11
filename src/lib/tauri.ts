import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileEntry[] | null;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke('write_file', { path, content });
}

export async function listDir(path?: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_dir', { path: path || null });
}

export async function ensureDataDir(): Promise<string> {
  return invoke<string>('ensure_data_dir');
}

export async function createDir(path: string): Promise<void> {
  return invoke('create_dir', { path });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke('delete_file', { path });
}

export async function renameFile(from: string, to: string): Promise<void> {
  return invoke('rename_file', { from, to });
}

export async function searchNotes(query: string, limit?: number): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search_notes', { query, limit: limit ?? 20 });
}

export async function rebuildSearchIndex(): Promise<number> {
  return invoke<number>('rebuild_search_index');
}

export async function updateSearchIndex(path: string): Promise<void> {
  return invoke('update_search_index', { path });
}

export async function listNoteTitles(): Promise<[string, string][]> {
  return invoke<[string, string][]>('list_note_titles');
}

export async function findBacklinks(noteName: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('find_backlinks', { noteName });
}

export async function listAllTags(): Promise<[string, number][]> {
  return invoke<[string, number][]>('list_all_tags');
}

export async function listNotesByTag(tag: string): Promise<string[]> {
  return invoke<string[]>('list_notes_by_tag', { tag });
}

export async function trashFile(path: string): Promise<void> {
  return invoke('trash_file', { path });
}

export async function readSettings(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>('read_settings');
}

export async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  return invoke('write_settings', { settings });
}

export async function writeFileBinary(path: string, data: Uint8Array): Promise<void> {
  return invoke('write_file_binary', { path, data: Array.from(data) });
}

export async function getDataDir(): Promise<string> {
  return invoke<string>('get_data_dir');
}

export async function changeDataDir(path: string): Promise<void> {
  return invoke('change_data_dir', { path });
}

export async function pickFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false });
  if (Array.isArray(result)) return result[0] ?? null;
  return result;
}


