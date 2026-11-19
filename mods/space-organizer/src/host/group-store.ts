import { GROUPS_KEY, decodeGroups, type DecodedGroups, type GroupSpace, type GroupState, type MachineState, type MachineKey } from "../core/model.js";
import { changeGroups, pruneMembers, unfoldSelected, type GroupChange, type MissingMember } from "../core/groups.js";

export interface GroupApi {
  checking(): boolean;
  shared(key: string): unknown;
  setShared(key: string, value: unknown): unknown;
  spaces(): readonly GroupSpace[];
  machines(): readonly MachineState[];
  id(): string;
}

export class GroupStore {
  constructor(private readonly api: GroupApi) {}
  read(): DecodedGroups { return decodeGroups(this.api.shared(GROUPS_KEY)); }
  private write(update: (state: GroupState) => GroupState): boolean {
    if (this.api.checking()) return false;
    const current = this.read();
    if (!current.ok) throw new Error(current.error);
    const next = update(current.state);
    if (JSON.stringify(next) === JSON.stringify(current.state)) return false;
    this.api.setShared(GROUPS_KEY, next);
    return true;
  }
  create(machine: MachineKey, name: string, space?: string): boolean {
    return this.write(state => changeGroups(state, { type: "create", id: this.api.id(), machine, name, space }, this.api.spaces(), this.api.machines()));
  }
  change(change: GroupChange): boolean {
    return this.write(state => changeGroups(state, change, this.api.spaces(), this.api.machines()));
  }
  clean(candidates: readonly MissingMember[]): boolean {
    return this.write(state => pruneMembers(state, candidates, this.api.spaces(), this.api.machines()));
  }
  reveal(id: string): boolean {
    return this.write(state => unfoldSelected(state, this.api.spaces().find(space => space.id === id)));
  }
}
