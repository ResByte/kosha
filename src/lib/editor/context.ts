/**
 * Editor context shared between the page and editor decorations.
 * Set once at startup from the Tauri backend.
 */
export let dataDirPath = '';

export function setDataDirPath(path: string) {
  dataDirPath = path;
}
