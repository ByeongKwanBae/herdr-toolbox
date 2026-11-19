import { changeGroups, type GroupChange } from "./groups.js";
import { machineReady, spaceGroup, type GroupSpace, type GroupState, type MachineKey, type MachineState } from "./model.js";

export interface DragPoint { x: number; y: number }
export interface GroupDrop { machine: MachineKey; group: string | null }

/** Pointer gesture only. Membership is validated again against live data on release. */
export class GroupDrag {
  private press?: { space: string; machine: MachineKey; point: DragPoint };
  active = false;
  over?: GroupDrop;
  get source(): string | undefined { return this.press?.space; }

  begin(space: GroupSpace, point: DragPoint): void {
    this.cancel();
    this.press = { space: space.id, machine: space.machine, point: { ...point } };
  }
  move(point: DragPoint, target?: GroupDrop): void {
    if (!this.press) return;
    if (Math.hypot(point.x - this.press.point.x, point.y - this.press.point.y) >= 5) this.active = true;
    this.over = this.active && target?.machine === this.press.machine ? target : undefined;
  }
  accepts(target: GroupDrop): boolean {
    return this.active && !!this.press && this.press.machine === target.machine;
  }
  release(target: GroupDrop, state: GroupState, spaces: readonly GroupSpace[], machines: readonly MachineState[]): GroupChange | null {
    const press = this.press, active = this.active;
    this.cancel();
    if (!press || !active) return null;
    const source = spaces.find(space => space.id === press.space);
    if (!source || source.machine !== press.machine) throw new Error("The dragged Space no longer exists on this machine.");
    if (target.machine !== source.machine) throw new Error("A Space can only join a group on the same machine.");
    if (!machineReady(machines, source.machine)) throw new Error("This machine's layout is not ready. Reconnect and try again.");
    if (target.group !== null && !state.groups.some(group => group.id === target.group && group.machine === target.machine)) throw new Error("The target group is no longer available on this machine.");
    const change: GroupChange = { type: "assign", space: source.id, group: target.group };
    changeGroups(state, change, spaces, machines);
    return (spaceGroup(state, source)?.id ?? null) === target.group ? null : change;
  }
  cancel(): void { this.press = undefined; this.active = false; this.over = undefined; }
}
