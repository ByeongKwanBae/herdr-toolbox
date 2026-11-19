export interface CreationSpace {
  id: string;
  machine: string | null;
  folder: string;
}
export interface CreationTarget { machine: string | null; platform: "windows" | "linux" | "macos" }
const LOCAL_WINDOWS: CreationTarget = { machine: null, platform: "windows" };

export interface CreationHost {
  checking(): boolean;
  pickFolder(): Promise<string | null>;
  spaces(): readonly CreationSpace[];
  create(folder: string): void;
  pause(ms: number): Promise<void>;
  failed(message: string): void;
  validGroup?(id: string): boolean;
  assignGroup?(space: string, group: string): void;
}

export type CreationPhase = "idle" | "picking" | "creating";
export type CreationResult = "created" | "cancelled" | "failed" | "skipped";
export interface CreationRequest { execute(host: CreationHost): Promise<CreationResult> }
export interface PendingCreation {
  token: number;
  group?: string;
  machine: string | null;
  folder: string;
  before: ReadonlySet<string>;
  startedAt: number;
}

// Matching is conservative on POSIX; the selected path itself is never rewritten.
function comparablePath(path: string, target: CreationTarget): string {
  return target.platform === "windows" ? path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : /^\/+$/u.test(path) ? "/" : path.replace(/\/+$/, "");
}

export function creationCandidates(before: ReadonlySet<string>, current: readonly CreationSpace[], folder: string, target: CreationTarget = LOCAL_WINDOWS): CreationSpace[] {
  return current.filter(space => space.machine === target.machine && !before.has(space.id)
    && comparablePath(space.folder, target) === comparablePath(folder, target));
}

/** Reserves synchronously, before scheduling a host task. No creation starts on init/render. */
export class FolderCreation {
  private currentPhase: CreationPhase = "idle";
  private sequence = 0;
  private active: PendingCreation | null = null;
  constructor(private readonly checking: () => boolean, private readonly now: () => number = Date.now, private readonly target: CreationTarget = LOCAL_WINDOWS) {}
  get phase(): CreationPhase { return this.currentPhase; }
  get busy(): boolean { return this.currentPhase !== "idle"; }
  get pending(): Readonly<PendingCreation> | null { return this.active; }

  begin(group?: string): CreationRequest | null {
    if (this.checking() || this.busy) return null;
    this.currentPhase = "picking";
    const token = ++this.sequence;
    let executed = false;
    return {
      execute: async host => {
        if (executed) return "skipped";
        executed = true;
        try {
          if (host.checking()) return "skipped";
          const folder = await host.pickFolder();
          if (folder === null) return "cancelled";
          if (host.checking()) return "skipped";
          if (group && !host.validGroup?.(group)) throw new Error("The destination group no longer exists or its machine is not ready. No Space was created.");
          if (!folder) throw new Error("No folder was selected.");
          // Take this snapshot after picking, immediately before issuing the command.
          const before = new Set(host.spaces().map(space => space.id));
          this.active = { token, group, machine: this.target.machine, folder, before, startedAt: this.now() };
          this.currentPhase = "creating";
          host.create(folder);
          for (let attempt = 0; attempt <= 20; attempt++) {
            if (host.checking()) return "skipped";
            // A delayed host wake-up must never attach a Space after the deadline.
            if (this.now() - this.active.startedAt > 5000) break;
            const matches = creationCandidates(before, host.spaces(), folder, this.target);
            if (group && !host.validGroup?.(group)) throw new Error("The destination group changed. Any created Space is left ungrouped; move it manually.");
            const unknown = host.spaces().some(space => space.machine === this.target.machine && !before.has(space.id) && !space.folder);
            if (group && unknown) throw new Error("A new Space has no folder information. Automatic grouping was cancelled; move it manually.");
            if (matches.length === 1) {
              if (group) {
                if (!host.assignGroup) throw new Error("Automatic grouping is unavailable. Move the new Space manually.");
                host.assignGroup(matches[0].id, group);
              }
              return "created";
            }
            if (matches.length > 1) throw new Error("More than one new Space matches this folder. Check the Spaces list; the request will not be repeated.");
            if (attempt === 20 || this.now() - this.active.startedAt >= 5000) break;
            await host.pause(250);
          }
          throw new Error("The new Space was not confirmed within 5 seconds. Check the Spaces list and the app notification before trying again; the request will not be repeated.");
        } catch (error) {
          host.failed(error instanceof Error ? error.message : String(error));
          return "failed";
        } finally {
          this.active = null;
          this.currentPhase = "idle";
        }
      },
    };
  }
}

/** Existing local picker behavior and constructor remain compatible. */
export class LocalCreation extends FolderCreation {}
