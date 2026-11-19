export const GROUPS_KEY = "space-organizer.groups";
export type MachineKey = string | null;
export interface Group { id: string; machine: MachineKey; name: string; folded: boolean }
export interface GroupState { schemaVersion: 1; groups: Group[]; members: Record<string, string> }
export interface GroupSpace { id: string; machine: MachineKey; status?: "blocked" | "done" | "working" | "idle" | null }
export interface MachineState { name: MachineKey; layout: "ready" | "loading" | "unavailable" }
export type DecodedGroups = { ok: true; state: GroupState } | { ok: false; error: string };
export const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
export const emptyGroups = (): GroupState => ({ schemaVersion: 1, groups: [], members: Object.create(null) as Record<string, string> });
export const machineReady = (list: readonly MachineState[], machine: MachineKey): boolean => list.some(item => item.name === machine && item.layout === "ready");

export function groupName(value: string): string {
  const name = value.normalize("NFC").trim();
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error("Group names cannot contain control characters.");
  if ([...name].length < 1 || [...name].length > 60) throw new Error("Use a group name with 1–60 characters.");
  return name;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function decodeGroups(value: unknown): DecodedGroups {
  if (value === undefined || value === null) return { ok: true, state: emptyGroups() };
  try {
    if (!record(value) || !own(value, "schemaVersion") || value.schemaVersion !== 1) throw new Error("Unsupported group schema.");
    if (!own(value, "groups") || !Array.isArray(value.groups) || !own(value, "members") || !record(value.members)) throw new Error("Invalid group data.");
    const ids = new Set<string>(), names = new Set<string>();
    const groups: Group[] = value.groups.map((raw: unknown) => {
      if (!record(raw) || !["id", "machine", "name", "folded"].every(key => own(raw, key))
        || typeof raw.id !== "string" || !raw.id || ids.has(raw.id) || typeof raw.name !== "string"
        || (raw.machine !== null && (typeof raw.machine !== "string" || !raw.machine)) || typeof raw.folded !== "boolean") throw new Error("Invalid group entry.");
      const name = groupName(raw.name);
      if (name !== raw.name) throw new Error("Group name is not normalized.");
      const key = JSON.stringify([raw.machine, name.toLowerCase()]);
      if (names.has(key)) throw new Error("Duplicate group names.");
      ids.add(raw.id); names.add(key);
      return { id: raw.id, machine: raw.machine, name, folded: raw.folded };
    });
    const entries = Object.entries(value.members);
    if (entries.some(([id, group]) => !id || typeof group !== "string" || !ids.has(group))) throw new Error("Invalid group membership.");
    return { ok: true, state: { schemaVersion: 1, groups, members: Object.fromEntries(entries) as Record<string, string> } };
  } catch (error) {
    return { ok: false, error: `${error instanceof Error ? error.message : String(error)} Existing data is preserved. Restore compatible group data before editing groups.` };
  }
}

export function spaceGroup(state: GroupState, space: GroupSpace): Group | undefined {
  const id = own(state.members, space.id) ? state.members[space.id] : undefined;
  return state.groups.find(group => group.id === id && group.machine === space.machine);
}

export function groupStatus(spaces: readonly GroupSpace[]): GroupSpace["status"] {
  return ["blocked", "done", "working", "idle"].find(status => spaces.some(space => space.status === status)) as GroupSpace["status"];
}
