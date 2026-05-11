import type { FileEntry, SearchResult } from '$lib/tauri';

class AppState {
  currentFile = $state<string | null>(null);
  fileContent = $state('');
  fileTree = $state<FileEntry[]>([]);
  isDirty = $state(false);
  sidebarOpen = $state(true);

  // Command palette
  paletteOpen = $state(false);
  paletteMode = $state<'switcher' | 'search' | 'commands'>('switcher');
  searchResults = $state<SearchResult[]>([]);

  // Navigation
  favorites = $state<string[]>([]);
  recentFiles = $state<string[]>([]);

  // Tags
  allTags = $state<{ tag: string; count: number }[]>([]);
  activeTagFilter = $state<string | null>(null);

  // Backlinks
  backlinks = $state<SearchResult[]>([]);

  // UI
  theme = $state<'light' | 'dark'>('light');
  sourceMode = $state(false);

  // Vault / data directory
  dataDir = $state('');

  // Daily notes — increment to request opening today's note
  dailyNoteRequest = $state(0);

  addToRecent(path: string) {
    this.recentFiles = [path, ...this.recentFiles.filter((p) => p !== path)].slice(0, 10);
  }

  toggleFavorite(path: string) {
    if (this.favorites.includes(path)) {
      this.favorites = this.favorites.filter((p) => p !== path);
    } else {
      this.favorites = [...this.favorites, path];
    }
  }
}

export const app = new AppState();
