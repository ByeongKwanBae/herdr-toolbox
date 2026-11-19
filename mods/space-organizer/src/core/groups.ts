import { groupName, spaceGroup, own, type GroupState, type GroupSpace, type MachineKey, type MachineState, machineReady } from "./model.js";

export type GroupChange =
  | { type: "create"; id: string; name: string; machine: MachineKey; space?: string }
  | { type: "rename"; group: string; name: string }
  | { type: "delete"; group: string }
  | { type: "assign"; space: string; group: string | null }
  | { type: "fold"; group: string; folded?: boolean };

export function changeGroups(state: GroupState, change: GroupChange, spaces: readonly GroupSpace[], machines: readonly MachineState[]): GroupState {
  const source = "space" in change && change.space ? spaces.find(space => space.id === change.space) : undefined;
  if ("space" in change && change.space && !source) throw new Error("The target Space no longer exists.");
  const group = "group" in change ? state.groups.find(group => group.id === change.group) : undefined;
  if ("group" in change && change.group !== null && !group) throw new Error("The group no longer exists.");
  const machine = change.type === "create" ? change.machine : group?.machine ?? source?.machine ?? null;
  if (change.type !== "fold" && !machineReady(machines, machine)) throw new Error("This machine's layout is not ready. Reconnect and try again.");
  const members = Object.fromEntries(Object.entries(state.members));
  let groups = state.groups.map(group => ({ ...group }));
  if (change.type === "create" || change.type === "rename") {
    const name = groupName(change.name);
    if (groups.some(item => item.machine === machine && item.id !== (change.type === "rename" ? change.group : null) && item.name.toLowerCase() === name.toLowerCase())) throw new Error("A group with this name already exists on this machine.");
    if (change.type === "create") {
      if (!change.id || groups.some(item => item.id === change.id)) throw new Error("The group ID already exists. Try again.");
      if (source && source.machine !== machine) throw new Error("A Space can only join a group on the same machine.");
      groups.push({ id: change.id, machine, name, folded: false });
      if (source) Object.defineProperty(members, source.id, { value: change.id, enumerable: true, configurable: true, writable: true });
    } else groups = groups.map(item => item.id === change.group ? { ...item, name } : item);
  } else if (change.type === "delete") {
    groups = groups.filter(item => item.id !== change.group);
    for (const [id, groupId] of Object.entries(members)) if (groupId === change.group) delete members[id];
  } else if (change.type === "assign") {
    if (!source) throw new Error("The target Space no longer exists.");
    if (group && group.machine !== source.machine) throw new Error("A Space can only join a group on the same machine.");
    if (group) Object.defineProperty(members, source.id, { value: group.id, enumerable: true, configurable: true, writable: true });
    else delete members[source.id];
  } else groups = groups.map(item => item.id === change.group ? { ...item, folded: change.folded ?? !item.folded } : item);
  return { schemaVersion: 1, groups, members };
}

export interface MissingMember { id: string; group: string; machine: MachineKey }
/** Deletion requires two ready observations at least one second apart. */
export class MembershipPruner {
  private missing = new Map<string, { group: string; machine: MachineKey; since: number }>();
  observe(state: GroupState, spaces: readonly GroupSpace[], machines: readonly MachineState[], now: number): MissingMember[] {
    const remove: MissingMember[] = [];
    const tracked = new Set<string>();
    for (const [id, groupId] of Object.entries(state.members)) {
      const group = state.groups.find(group => group.id === groupId);
      if (!group || !machineReady(machines, group.machine) || spaces.some(space => space.id === id && space.machine === group.machine)) { this.missing.delete(id); continue; }
      tracked.add(id);
      const previous = this.missing.get(id);
      if (!previous || previous.group !== groupId || previous.machine !== group.machine) this.missing.set(id, { group: groupId, machine: group.machine, since: now });
      else if (now - previous.since >= 1000) remove.push({ id, group: groupId, machine: group.machine });
    }
    for (const id of this.missing.keys()) if (!tracked.has(id)) this.missing.delete(id);
    return remove;
  }
}

export function pruneMembers(state: GroupState, candidates: readonly MissingMember[], spaces: readonly GroupSpace[], machines: readonly MachineState[]): GroupState {
  const members = Object.fromEntries(Object.entries(state.members));
  for (const candidate of candidates) {
    if (own(members, candidate.id) && members[candidate.id] === candidate.group && machineReady(machines, candidate.machine)
      && !spaces.some(space => space.id === candidate.id && space.machine === candidate.machine)) delete members[candidate.id];
  }
  return { ...state, members };
}

export function unfoldSelected(state: GroupState, space: GroupSpace | undefined): GroupState {
  const group = space && spaceGroup(state, space);
  return group?.folded ? { ...state, groups: state.groups.map(item => item.id === group.id ? { ...item, folded: false } : item) } : state;
}
