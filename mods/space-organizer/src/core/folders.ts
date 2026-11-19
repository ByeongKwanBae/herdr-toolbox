export type FolderPlatform = "linux" | "macos" | "windows";
export interface FolderEntry { name: string; path: string }
export interface FolderPage {
  platform: FolderPlatform;
  path: string;
  home: string;
  roots: string[];
  folders: FolderEntry[];
  limited: boolean;
}
export const FOLDER_LIMIT = 500;

export function absoluteFolder(path: string, platform: FolderPlatform): boolean {
  if (!path || path.includes("\0")) return false;
  return platform === "windows" ? /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(path) : path.startsWith("/");
}
export function folderRequest(path: string | undefined, platform: FolderPlatform): void {
  if (path?.includes("\0")) throw new Error("Invalid folder path.");
  if (path === undefined || path === "" || path === "~" || path.startsWith("~/") || (platform === "windows" && path.startsWith("~\\"))) return;
  if (!absoluteFolder(path, platform)) throw new Error("Use an absolute folder path or ~ for home.");
}
export function childFolder(parent: string, name: string, platform: FolderPlatform): string {
  if (!name || name === "." || name === ".." || /[\0/]/.test(name) || (platform === "windows" && name.includes("\\"))) throw new Error("Invalid directory name in remote response.");
  const separator = platform === "windows" ? "\\" : "/";
  return parent.replace(platform === "windows" ? /[\\/]+$/ : /\/+$/, "") + separator + name;
}
/** One new child only; never accept a path, traversal or invisible control characters. */
export function newFolderName(name: string): string {
  if (!name.trim() || name === "." || name === ".." || /[\u0000-\u001f\u007f/]/u.test(name)) throw new Error("Enter a single folder name without / or control characters; . and .. are not allowed.");
  return name;
}
export function parentFolder(path: string, platform: FolderPlatform): string | null {
  if (!absoluteFolder(path, platform)) return null;
  if (platform !== "windows") {
    const clean = path.replace(/\/+$/, "");
    if (!clean) return null;
    return clean.slice(0, clean.lastIndexOf("/")) || "/";
  }
  const clean = path.replace(/\//g, "\\").replace(/\\+$/, "");
  if (/^[a-z]:$/i.test(clean) || /^\\\\[^\\]+\\[^\\]+$/.test(clean)) return null;
  const parent = clean.slice(0, clean.lastIndexOf("\\"));
  return /^[a-z]:$/i.test(parent) || /^\\\\[^\\]+\\[^\\]+$/.test(parent) ? parent + "\\" : parent || null;
}
export function posixPage(output: string, platform: "linux" | "macos"): FolderPage {
  const parts = output.split("\0");
  if (parts.pop() !== "" || parts.shift() !== "SO-FOLDERS-1") throw new Error("Invalid remote folder response.");
  const home = parts.shift(), path = parts.shift();
  if (!home || !path || !absoluteFolder(home, platform) || !absoluteFolder(path, platform) || parts.length > FOLDER_LIMIT + 1) throw new Error("Invalid remote folder response.");
  const folders = parts.map(name => ({ name, path: childFolder(path, name, platform) }));
  return { platform, path, home, roots: ["/"], folders: folders.slice(0, FOLDER_LIMIT).sort((a, b) => a.name.localeCompare(b.name)), limited: folders.length > FOLDER_LIMIT };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function windowsPage(output: string): FolderPage {
  let raw: unknown;
  try { raw = JSON.parse(output.replace(/^\uFEFF/, "")); }
  catch { throw new Error("Invalid remote folder response."); }
  if (!record(raw) || raw.version !== 1 || typeof raw.path !== "string" || typeof raw.home !== "string" || !Array.isArray(raw.roots) || !Array.isArray(raw.folders)) throw new Error("Invalid remote folder response.");
  const path = raw.path, home = raw.home;
  if (!absoluteFolder(path, "windows") || !absoluteFolder(home, "windows") || raw.roots.length > 64 || raw.folders.length > FOLDER_LIMIT + 1) throw new Error("Invalid remote folder response.");
  const roots = raw.roots.map(root => { if (typeof root !== "string" || !absoluteFolder(root, "windows")) throw new Error("Invalid remote drive."); return root; });
  const folders = raw.folders.map(entry => {
    if (!record(entry) || typeof entry.name !== "string") throw new Error("Invalid remote directory.");
    return { name: entry.name, path: childFolder(path, entry.name, "windows") };
  });
  return { platform: "windows", path, home, roots, folders: folders.slice(0, FOLDER_LIMIT).sort((a, b) => a.name.localeCompare(b.name)), limited: folders.length > FOLDER_LIMIT };
}

/** Latest navigation wins. Errors retain the last list but disable selection. */
export class FolderBrowser {
  page: FolderPage | null = null;
  loading = false;
  error = "";
  private generation = 0;
  private addressRevision = 0;
  private navigatingRevision = 0;
  private closed = false;
  constructor(private readonly read: (path?: string) => Promise<FolderPage>) {}
  get selectable(): boolean { return !this.closed && !this.loading && !this.error && !!this.page; }
  noteAddressEdit(): void { this.addressRevision++; }
  get canSyncAddress(): boolean { return this.addressRevision === this.navigatingRevision; }
  async navigate(path?: string): Promise<boolean> {
    if (this.closed) return false;
    const generation = ++this.generation;
    this.navigatingRevision = this.addressRevision;
    this.loading = true; this.error = "";
    try {
      const page = await this.read(path);
      if (this.closed || generation !== this.generation) return false;
      this.page = page;
      return true;
    } catch (error) {
      if (!this.closed && generation === this.generation) this.error = error instanceof Error ? error.message : String(error);
      return false;
    } finally { if (!this.closed && generation === this.generation) this.loading = false; }
  }
  close(): void { this.closed = true; this.generation++; this.loading = false; }
}
