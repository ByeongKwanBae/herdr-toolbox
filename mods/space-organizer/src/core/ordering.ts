import { spaceGroup, type GroupState, type MachineKey } from "./model.js";

export interface OrderSpace { id: string; machine: MachineKey; repo: string | null; linked: boolean }
export interface OrderedSpace { id: string; tree: "├─" | "└─" | null }

export function desiredOrder(spaces: readonly OrderSpace[], state: GroupState): OrderedSpace[] {
  const out: OrderedSpace[] = [];
  // Preserve the host's machine blocks exactly, including their relative order.
  const machines = [...new Set(spaces.map(space => space.machine))];
  for (const machine of machines) {
    const local = spaces.filter(space => space.machine === machine);
    const groups = state.groups.filter(group => group.machine === machine).map(group => group.id);
    for (const id of [...groups, null]) {
      const area = local.filter(space => (spaceGroup(state, space)?.id ?? null) === id);
      const mains = new Set(area.filter(space => space.repo && !space.linked).map(space => space.repo));
      const nested = (space: OrderSpace) => space.linked && !!space.repo && mains.has(space.repo);
      const placed = new Set<string>();
      for (const space of area) {
        if (nested(space)) continue;
        out.push({ id: space.id, tree: null });
        if (!space.repo || space.linked || placed.has(space.repo)) continue;
        placed.add(space.repo);
        const children = area.filter(child => nested(child) && child.repo === space.repo);
        children.forEach((child, index) => out.push({ id: child.id, tree: index === children.length - 1 ? "└─" : "├─" }));
      }
    }
  }
  return out;
}

export interface SpaceMove { id: string; index: number }
export function movePlan(current: readonly OrderSpace[], target: readonly string[]): SpaceMove[] {
  if (new Set(current.map(space => space.id)).size !== current.length || new Set(target).size !== target.length
    || current.length !== target.length || target.some(id => !current.some(space => space.id === id))) throw new Error("The order plan must contain the same unique Space IDs.");
  const byId = new Map(current.map(space => [space.id, space]));
  if (target.some((id, index) => byId.get(id)!.machine !== current[index].machine)) throw new Error("An order plan cannot cross machine blocks.");
  const simulated = current.map(space => space.id), moves: SpaceMove[] = [];
  for (let index = 0; index < target.length; index++) {
    const from = simulated.indexOf(target[index]);
    if (from === index) continue;
    moves.push({ id: target[index], index: index + 1 });
    simulated.splice(index, 0, simulated.splice(from, 1)[0]);
  }
  return moves;
}

export function orderIntent(state: GroupState): string {
  return JSON.stringify([state.groups.map(group => [group.id, group.machine]), Object.entries(state.members).sort(([a], [b]) => a.localeCompare(b))]);
}

/** One budget per user operation. Space arrivals, removals and rendering do not reset it. */
export class OrderSynchronizer {
  private attempts = 0;
  private at = -Infinity;
  private exhausted = false;
  private warned = false;
  private pending = false;
  reset(): void { this.attempts = 0; this.at = -Infinity; this.exhausted = false; this.warned = false; this.pending = false; }
  get failed(): boolean { return this.exhausted && this.pending; }
  step(current: readonly OrderSpace[], target: readonly string[], now: number): { moves: SpaceMove[]; warn: boolean } {
    const plan = movePlan(current, target);
    if (!plan.length) {
      this.pending = false;
      // Successful operations may finish, but an exhausted budget stays locked
      // until explicit retry or a new membership intent, even after a late echo.
      if (!this.exhausted) { this.attempts = 0; this.at = -Infinity; }
      return { moves: [], warn: false };
    }
    this.pending = true;
    if (this.exhausted || now - this.at < 1000) return { moves: [], warn: false };
    if (this.attempts >= 3) {
      this.exhausted = true;
      const warn = !this.warned; this.warned = true;
      return { moves: [], warn };
    }
    this.at = now; this.attempts++;
    return { moves: plan, warn: false };
  }
}
