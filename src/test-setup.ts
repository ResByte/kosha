import { vi } from 'vitest';

// Mock Tauri core invoke — individual tests can override with vi.mocked(invoke).mockResolvedValue(...)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

// Mock Tauri event listener so components that call listen() don't throw
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));
