// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag onto a group to change membership.

/*! Modified from Herdr App 0.1.16 Spaces; Apache-2.0. See LICENSE and THIRD_PARTY_NOTICES.md. */
import { div, svg, type Context, type AsyncContext, type Color } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, openOverlay, shared, watchFolder, window, layout, checking, pickFolder, notify, nextCommand, type SpaceInfo, type PaneInfo, type Status, type ExecResult, type FolderWatch } from "herdr";
import { safeRun as run, safeSetShared as setShared, safeExec as exec, safeHc as hc, colorState, color as parseColor, themeColors } from "../host/herdr-adapter.js";
import { LocalCreation } from "../core/creation.js";
import { creationAdapter } from "../host/creation-adapter.js";
import { groupStore } from "../host/groups.js";
import { emptyGroups, spaceGroup, groupStatus, machineReady, type GroupState, type MachineKey } from "../core/model.js";
import { MembershipPruner, type GroupChange } from "../core/groups.js";
import { desiredOrder, orderIntent, OrderSynchronizer, type OrderSpace } from "../core/ordering.js";
import { GroupDrag, type DragPoint, type GroupDrop } from "../core/drag.js";

type Theme = ReturnType<typeof themeColors>;
type Div = ReturnType<typeof div>;
interface LayoutNode { id?: string; size?: { px?: number }; children?: LayoutNode[] }
interface GitInfo { name: string; branch: string; ahead: number; behind: number; repo: string; linked: boolean }
interface Machine { name: string; state?: string; why?: string; target: string; via?: string; session?: string; temporary?: boolean; keeps_running_after_logout?: boolean }
interface Reconnection { machine: Machine; removed: boolean; busy?: boolean; error?: string | null }
interface Row { w: SpaceInfo; i: number; g: GitInfo | null; tree: string | null; label?: string }
interface RenderedRow { element: Div; active: boolean }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function machine(value: unknown): value is Machine { return record(value) && typeof value.name === "string" && typeof value.target === "string"; }
function machineList(value: unknown): Machine[] { return record(value) && Array.isArray(value.machines) ? value.machines.filter(machine).filter(m => !m.temporary) : []; }
function savedReconnects(value: unknown): Record<string, Reconnection> {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Reconnection] => record(entry[1]) && machine(entry[1].machine) && typeof entry[1].removed === "boolean"));
}

function find(node: LayoutNode | null | undefined, id: string): LayoutNode | null {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout() as LayoutNode | null, "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s: SpaceInfo, ps: PaneInfo[]) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }: Pick<Row, "tree">) => (tree ? 28 : 30);
const RAIL_CELL = 32;
// Group headers sit below machine headers; guides line up with their chevrons.
const GROUP_INDENT = 10;
const GROUP_GUIDE = 22;
const GROUP_MEMBERS = 32;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
const railCell = (el: Div) => h_flex().flex_none().justify_center().child(el);
const where = (s: SpaceInfo, ps: PaneInfo[]) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a: Promise<ExecResult>, b: Promise<ExecResult>): Promise<[ExecResult, ExecResult]> {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map(d => { if (d.status === "rejected") throw d.reason; return d.value; }) as [ExecResult, ExecResult];
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK: Record<string, Color> = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status: Status | null) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t: Theme, status: Status | null) {
  return (status ? t[status] : undefined) ?? t.unknown;
}

export default class Spaces {
  private git: Record<string, GitInfo | null> = {};
  private checked: Record<string, number> = {};
  private unsure = new Set<string>();
  private pending = new Set<string>();
  private busy: Record<string, boolean> = {};
  private ready: Record<string, boolean> = {};
  private at: Record<string, string> = {};
  private watching = new Map<string, FolderWatch>();
  private shown = new Set<string>();
  private born: Record<string, number> = {};
  private scroll!: ReturnType<typeof ScrollHandle.new>;
  private activeAt = -1;
  private machines: Machine[] = [];
  private reconnecting: Record<string, Reconnection> = {};
  private folded = new Set<string | null>();
  private refreshing = false;
  private copiedLogin: string | null = null;
  private revealed: string | undefined;
  private revealedAt = -1;
  private creation = new LocalCreation(checking);
  private store = groupStore();
  private groups: GroupState = emptyGroups();
  private pruner = new MembershipPruner();
  private synchronizer = new OrderSynchronizer();
  private intent = "";
  private syncing = false;
  private orderPending = false;
  private orderGeneration = 0;
  private lastActive?: string;
  private groupError = "";
  private warnedData = "";
  private desired: { id: string; tree: "├─" | "└─" | null }[] = [];
  private drag = new GroupDrag();
  private groupPressed?: string;
  private pointerBounds?: { x: number; y: number; width: number; height: number };

  private trackPointerBounds(event: { position: DragPoint; local_position?: DragPoint; bounds?: { width: number; height: number } }): void {
    if (event.bounds && event.local_position) this.pointerBounds = {
      x: event.position.x - event.local_position.x, y: event.position.y - event.local_position.y,
      width: event.bounds.width, height: event.bounds.height,
    };
  }

  private dragMove(point: DragPoint, target: GroupDrop | undefined, cx: Context): void {
    if (checking() || !this.drag.source) return;
    cx.stop_propagation();
    const before = JSON.stringify([this.drag.active, this.drag.over]);
    this.drag.move(point, target);
    if (before !== JSON.stringify([this.drag.active, this.drag.over])) cx.notify();
  }
  private cancelDrag(cx: Context): void {
    if (!this.drag.source && !this.groupPressed) return;
    this.drag.cancel(); this.groupPressed = undefined; cx.notify();
  }
  private drop(target: GroupDrop, cx: Context): void {
    if (checking()) { this.drag.cancel(); return; }
    try {
      const current = this.store.read();
      if (!current.ok) throw new Error(current.error);
      const change = this.drag.release(target, current.state, spaces(), machines());
      if (change) this.store.change(change);
    } catch (error) {
      this.drag.cancel();
      notify({ title: "Couldn't move Space", body: error instanceof Error ? error.message : String(error), level: "error" });
    }
    this.groupPressed = undefined;
    cx.stop_propagation(); cx.notify();
  }
  private dropHighlight(target: GroupDrop): boolean {
    return this.drag.active && this.drag.over?.machine === target.machine && this.drag.over?.group === target.group;
  }

  private local(cx: Context, group?: string): void {
    const request = this.creation.begin(group);
    if (!request) return;
    cx.notify();
    cx.spawn(async cx => {
      // phase() validates task ownership after every await, including picker return.
      const activeChecking = () => { cx.phase(); return checking(); };
      const host = creationAdapter({ checking: activeChecking, pickFolder, spaces, run, notify }, ms => cx.sleep(ms));
      host.validGroup = id => {
        if (activeChecking()) return false;
        const current = this.store.read();
        return current.ok && current.state.groups.some(item => item.id === id && item.machine === null) && machineReady(machines(), null);
      };
      host.assignGroup = (space, group) => { if (!activeChecking()) this.store.change({ type: "assign", space, group }); };
      await request.execute(host);
      cx.notify();
    });
  }

  private organizerMenu(machine: MachineKey = null, group?: string): void {
    if (!checking()) openOverlay({ mod: "space-organizer", kind: "popup", width: 280, height: 460, props: { view: "menu", machine, group } });
  }
  private groupChange(change: GroupChange, cx: Context): void {
    if (checking()) return;
    try { this.store.change(change); }
    catch (error) { notify({ title: "Couldn't change group", body: error instanceof Error ? error.message : String(error), level: "error" }); }
    cx.notify();
  }
  private orderSpaces(sp = spaces(), ps = panes()): OrderSpace[] {
    return sp.map(space => ({ id: space.id, machine: space.machine, repo: this.git[where(space, ps)]?.repo ?? null, linked: this.git[where(space, ps)]?.linked ?? false }));
  }
  private refreshGroups(cx: Context): void {
    if (checking()) return;
    let decoded = this.store.read();
    if (!decoded.ok) {
      this.groups = emptyGroups(); this.groupError = decoded.error;
      if (this.warnedData !== decoded.error) { this.warnedData = decoded.error; notify({ title: "Group data needs recovery", body: decoded.error, level: "error" }); }
      return;
    }
    this.groupError = ""; this.warnedData = "";
    const intent = orderIntent(decoded.state);
    if (intent !== this.intent) { this.intent = intent; this.orderGeneration++; this.synchronizer.reset(); }
    const sp = spaces(), ms = machines();
    const active = sp.find(space => space.active)?.id;
    if (active !== this.lastActive) {
      this.lastActive = active;
      if (active) this.store.reveal(active);
    }
    const missing = this.pruner.observe(decoded.state, sp, ms, Date.now());
    if (missing.length && this.store.clean(missing)) {
      const cleaned = this.store.read();
      // Host deletions must not give a conflicting order operation a fresh budget.
      if (cleaned.ok) this.intent = orderIntent(cleaned.state);
    }
    decoded = this.store.read();
    if (!decoded.ok) return;
    this.groups = decoded.state;
    if (this.syncing) return;
    const current = this.orderSpaces(sp), wanted = desiredOrder(current, this.groups);
    const pending = wanted.some((item, index) => item.id !== current[index].id);
    if (this.orderPending !== pending) { this.orderPending = pending; cx.notify(); }
    const target = [...new Set(current.map(space => space.machine))].flatMap(machine => machineReady(ms, machine)
      ? wanted.filter(item => current.find(space => space.id === item.id)?.machine === machine).map(item => item.id)
      : current.filter(space => space.machine === machine).map(space => space.id));
    // Waiting for a disconnected machine does not consume or reset retry budget.
    if (target.every((id, index) => id === current[index].id) && wanted.some((item, index) => item.id !== current[index].id)) return;
    const step = this.synchronizer.step(current, target, Date.now());
    if (step.warn) { notify({ title: "Space ordering paused", body: "Three attempts did not converge. Actual order is shown with group labels. Use Retry Space ordering or change membership to try again.", level: "error" }); cx.notify(); }
    if (!step.moves.length) return;
    this.syncing = true;
    const generation = this.orderGeneration;
    cx.spawn(async cx => {
      const expected = current.map(space => space.id);
      try {
        for (const move of step.moves) {
          cx.phase();
          if (checking() || generation !== this.orderGeneration) break;
          const live = spaces();
          const space = live.find(space => space.id === move.id);
          if (!space || !machineReady(machines(), space.machine) || live.length !== expected.length || live.some((space, index) => space.id !== expected[index])) break;
          run("space.move", { id: move.id, index: move.index });
          expected.splice(move.index - 1, 0, expected.splice(expected.indexOf(move.id), 1)[0]);
          await cx.sleep(40);
        }
      } catch { /* The same bounded operation observes and retries on its next tick. */ }
      finally { this.syncing = false; cx.notify(); }
    });
  }
  private refreshColors(sp: SpaceInfo[]): void {
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const kept = colorState(shared("space.colors"));
    let changed = false;
    for (const space of sp) {
      if (kept[space.id] || space.name === "~") continue;
      const uses = (color: string) => Object.values(kept).filter(value => value === color).length;
      kept[space.id] = palette.reduce((best, color) => uses(color) < uses(best) ? color : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
  }
  init(_props: Record<string, unknown>, cx: Context) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    try {
      this.reconnecting = savedReconnects(JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}"));
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { const value: unknown = JSON.parse(localStorage.getItem("machines.folded") ?? "[]"); this.folded = new Set(Array.isArray(value) ? value.filter((v): v is string | null => v === null || typeof v === "string") : []); } catch { this.folded = new Set(); }
    if (checking()) return;
    this.lastActive = spaces().find(space => space.active)?.id;
    this.checkNew(cx);
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "retry-order") { this.orderGeneration++; this.synchronizer.reset(); this.refreshGroups(cx); cx.notify(); }
      }
    });
  }

  checkNew(cx: Context) {
    const now = Date.now();
    const sp = spaces();
    this.refreshColors(sp);
    this.refreshGroups(cx);
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some(s => !this.shown.has(s.id)) || this.syncing) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now: number, sp: SpaceInfo[], ps: PaneInfo[]) {
    // Moved there: what it knew of that place may be old.
    const at: Record<string, string> = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter((g): g is GitInfo => g !== null).map(g => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf: Record<string, SpaceInfo> = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy: Record<string, boolean> = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name ?? ""] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name ?? ""] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key: string, keys: Set<string>) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx: Context) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = machineList(JSON.parse(r.stdout)); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine: Machine | undefined) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine: Machine | undefined, cx: Context) {
    if (!machine || checking()) return;
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    if (!checking()) localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async (args: string[]) => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          if (!checking()) localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        if (!checking()) localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e);
        state.busy = false;
      }
      if (!checking()) localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys: Set<string> | string[], cx: Context) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key: string, cx: AsyncContext) {
    if (checking()) return;
    const [on, cwd] = JSON.parse(key) as [string | null, string];
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo: string, cx: Context) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  menu(w: SpaceInfo) {
    // A popup is as tall as its items; height is only the most.
    if (checking() || !spaces().some(s => s.id === w.id)) return;
    openOverlay({ mod: "space-organizer", kind: "popup", width: 280, height: 460, props: { view: "menu", space: w.id } });
  }

  // Derive presentation only: all movement happens in the bounded task above.
  ordered(): Row[] {
    const sp = spaces(), ps = panes();
    const decoded = this.store.read();
    this.groups = decoded.ok ? decoded.state : emptyGroups();
    const actual = this.orderSpaces(sp, ps);
    this.desired = desiredOrder(actual, this.groups);
    const aligned = new Map<MachineKey, boolean>();
    for (const machine of new Set(actual.map(space => space.machine))) {
      const current = actual.filter(space => space.machine === machine).map(space => space.id);
      const target = this.desired.filter(item => actual.find(space => space.id === item.id)?.machine === machine);
      aligned.set(machine, current.every((id, index) => id === target[index].id));
    }
    const trees = new Map(this.desired.map(item => [item.id, item.tree]));
    const ready = (space: SpaceInfo) => this.shown.has(space.id) || where(space, ps) in this.git || Date.now() - (this.born[space.id] ??= Date.now()) > 1500;
    // These are instance-only observation flags; there are no host writes in render.
    for (const space of sp) if (ready(space)) this.shown.add(space.id);
    return sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null,
      tree: aligned.get(w.machine) ? trees.get(w.id) ?? null : null,
      label: aligned.get(w.machine) ? undefined : spaceGroup(this.groups, w)?.name,
    })).filter(row => this.shown.has(row.w.id));
  }

  private sections(machine: MachineKey, rows: Row[], t: Theme, collapsed: boolean): RenderedRow[] {
    const draw = (row: Row): RenderedRow => ({ element: collapsed ? this.compact(row, t) : this.row(row, t), active: row.w.active });
    const drawMember = (row: Row): RenderedRow => ({ element: this.row(row, t, true), active: row.w.active });
    if (collapsed) return rows.map(draw);
    const actual = spaces().filter(space => space.machine === machine);
    const target = this.desired.filter(item => actual.some(space => space.id === item.id));
    if (!actual.every((space, index) => space.id === target[index]?.id)) return rows.map(draw);
    const rendered: RenderedRow[] = [];
    const ready = machineReady(machines(), machine);
    for (const group of this.groups.groups.filter(group => group.machine === machine)) {
      const members = actual.filter(space => spaceGroup(this.groups, space)?.id === group.id);
      const status = ready ? groupStatus(members) ?? null : null;
      const target: GroupDrop = { machine, group: group.id };
      const head = h_flex().id(`group-${group.id}`).h(29).ml(GROUP_INDENT).px(7).gap(6).items_center().rounded(6)
        .text_size(12).text_color(t.foreground).cursor_pointer().hover(el => el.bg(t.hover))
        .when(this.drag.active && (!ready || !this.drag.accepts(target)), el => el.cursor_no_drop())
        .when(this.dropHighlight(target), el => el.bg(t.selected).text_color(t.accent))
        .tooltip(ready ? `${group.name} · ${members.length} Spaces · ${status ?? "no agent status"}` : `${group.name} · Machine unavailable · Space count and agent state are unknown. Membership is preserved.`)
        .on_mouse_down("left", (_event, cx) => { this.cancelDrag(cx); this.groupPressed = group.id; cx.notify(); })
        .on_mouse_move((event, cx) => this.dragMove(event.position, ready ? target : undefined, cx))
        .on_mouse_up("left", (_event, cx) => {
          if (this.drag.source) this.drop(target, cx);
          else if (this.groupPressed === group.id) { this.groupPressed = undefined; this.groupChange({ type: "fold", group: group.id }, cx); }
        })
        .on_mouse_down("right", (_event, cx) => { this.cancelDrag(cx); this.organizerMenu(machine, group.id); })
        .child(svg(`mods/workspace-chrome/chevron-${group.folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.muted))
        .child(svg("mods/workspace-chrome/folder.svg").size(14).flex_none().text_color(ready ? t.accent : t.dim))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(group.name))
        .child(div().flex_none().text_size(11).text_color(t.muted).child(ready ? String(members.length) : "?"))
        .when(!!status, el => el.child(div().text_color(tone(t, status)).tooltip(status!).child(glyph(status))))
        .when(machine === null, el => el.child(div().id(`group-new-${group.id}`).px(5).flex_none().rounded(4)
          .tooltip("Choose a local folder in this group").when(this.creation.busy || !ready, el => el.opacity(0.4))
          .on_mouse_down("left", (_event, cx) => { this.cancelDrag(cx); cx.stop_propagation(); })
          .on_mouse_up("left", (_event, cx) => cx.stop_propagation())
          .on_click((_event, cx) => { cx.stop_propagation(); if (ready) this.local(cx, group.id); }).child(this.creation.busy ? "…" : "+")));
      rendered.push({ element: head, active: false });
      if (!group.folded) rendered.push(...rows.filter(row => spaceGroup(this.groups, row.w)?.id === group.id).map(drawMember));
    }
    // This stable target is present even when every Space is grouped.
    if (this.drag.active && this.drag.accepts({ machine, group: null })) {
      const target: GroupDrop = { machine, group: null };
      rendered.push({ active: false, element: h_flex().id(`ungroup-drop-${machine ?? "local"}`).h(29).ml(GROUP_INDENT).px(7).items_center().rounded(6)
        .text_size(11).text_color(t.muted).tooltip("Drop here to remove from group")
        .child(div().flex_1().min_w(0).truncate().child("Drop here to remove from group"))
        .when(this.dropHighlight(target), el => el.bg(t.selected).text_color(t.accent))
        .on_mouse_move((event, cx) => this.dragMove(event.position, ready ? target : undefined, cx))
        .on_mouse_up("left", (_event, cx) => this.drop(target, cx)) });
    }
    rendered.push(...rows.filter(row => !spaceGroup(this.groups, row.w)).map(draw));
    return rendered;
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t: Theme, collapsed: boolean) {
    const rows = this.ordered();
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, login notes and loading rows count too.
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...rows.map(r => r.w.machine).filter((name): name is string => !!name), ...this.groups.groups.map(group => group.machine).filter((name): name is string => !!name), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = (m: string | null) => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = (m: string | null) => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      const sections = this.sections(null, rows, t, collapsed);
      this.activeAt = sections.findIndex(row => row.active);
      return sections.map(row => row.element);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = m ? this.reconnecting[m] : undefined;
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = !collapsed && this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(!collapsed, el => el.border_b(1).border_color(t.border))
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("right", () => this.organizerMenu(m))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          if (!checking()) localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip(m ? `New space on ${m}` : "Choose a local folder")
            .when(!m && this.creation.busy, el => el.opacity(0.4))
            .on_click((_e, cx) => { cx.stop_propagation(); if (m) run("space.new", { machine: m }); else this.local(cx); }).child(!m && this.creation.busy ? "…" : "+")))
          .child(div().id(`machine-menu-${m ?? "local"}`).flex_none().px(3).rounded(4).tooltip("Group actions")
            .on_click((_event, cx) => { cx.stop_propagation(); this.organizerMenu(m); }).child("⋯"))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { if (m) run("space.new", { machine: m }); else this.local(cx); })
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) { before += 1; return [head]; }
      const cell = collapsed ? railCell : (el: Div) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const sections = this.sections(m, mine, t, collapsed);
      const items = [cell(head), ...guidance, ...(folded ? [] : sections.length ? sections.map(row => row.element) : [loading(m) ? loadingRow(m) : cell(empty)])];
      const first = folded ? -1 : sections.findIndex(row => row.active);
      if (first >= 0) this.activeAt = before + 1 + guidance.length + first;
      before += items.length;
      return items;
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  gitTail(g: GitInfo, tree: string | null, name: string, t: Theme) {
    const raw = g.branch ?? "detached";
    const same = (a: string) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(where ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree, label }: Row, t: Theme, grouped = false) {
    const on = w.active;
    const colors = colorState(shared("space.colors"));
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? parseColor(color) : (MARK[color] ?? t[color]);
    const target: GroupDrop = { machine: w.machine, group: spaceGroup(this.groups, w)?.id ?? null };
    const element = v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .when(grouped, el => el.pl(GROUP_MEMBERS)
        .child(div().absolute().left(GROUP_GUIDE).top(0).bottom(0).w(1).bg(t.border)))
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on && !grouped, (el) => el.bg(t.selected))
      .when(!on && !grouped, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.drag.active && this.drag.source === w.id, el => el.opacity(0.5))
      .when(this.drag.active && (!machineReady(machines(), w.machine) || !this.drag.accepts(target)), el => el.cursor_no_drop())
      .when(!grouped && this.dropHighlight(target) && this.drag.source !== w.id, el => el.bg(t.selected))
      .on_mouse_down("left", (event, cx) => { if (!checking()) { this.drag.begin(w, event.position); cx.notify(); } })
      .on_mouse_move((event, cx) => this.dragMove(event.position, machineReady(machines(), w.machine) ? target : undefined, cx))
      .on_mouse_up("left", (_event, cx) => {
        if (this.drag.active) this.drop(target, cx);
        else { const selected = this.drag.source === w.id; this.cancelDrag(cx); if (selected) run("space.select", { id: w.id }); }
      })
      .on_mouse_down("right", (_event, cx) => { this.cancelDrag(cx); this.menu(w); })
      .child(
        h_flex()
          .h_full().rounded(8)
          .when(grouped, el => el.px(8)
            .when(on || (this.dropHighlight(target) && this.drag.source !== w.id), el => el.bg(t.selected))
            .when(!on, el => el.hover(el => el.bg(t.hover))))
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_initial().min_w(SIDE_MIN).truncate().text_color(t.foreground).child(w.name))
          .when(!!label, el => el.child(div().text_size(10).text_color(t.muted).truncate().tooltip("Group · ordering pending").child(label!)))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
    // The guide sits inside the original row hitbox, outside its selected content.
    // Every Space remains one direct scroll child, including nested worktrees.
    return element;
  }

  compact({ w, i }: Row, t: Theme) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => this.menu(w))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render(_cx: Context) {
    const t = themeColors();
    const collapsed = narrow();
    const sp = spaces();
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (!this.drag.source && this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_mouse_down("left", event => this.trackPointerBounds(event))
      .on_hover((hovered, cx) => {
        if (hovered || (!this.drag.source && !this.groupPressed)) return;
        // Child hitboxes and a rebuilt list can change hover without leaving the sidebar.
        const point = globalThis.window.mouse_position(), bounds = this.pointerBounds;
        if (!bounds || point.x < bounds.x || point.y < bounds.y || point.x >= bounds.x + bounds.width || point.y >= bounds.y + bounds.height) this.cancelDrag(cx);
      })
      .on_mouse_down_out((_event, cx) => this.cancelDrag(cx))
      .on_mouse_up("left", (_event, cx) => this.cancelDrag(cx))
      .on_mouse_move((event, cx) => { this.trackPointerBounds(event); this.dragMove(event.position, undefined, cx); })
      .child(h_flex().h(31).flex_none().pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip(this.creation.busy ? "Waiting for local folder selection or Space creation" : "Choose a local folder for a new Space")
          .when(this.creation.busy, el => el.opacity(0.4))
          .on_click((_e, cx) => this.local(cx)).child(this.creation.busy ? div().child("…") : svg("mods/workspace-chrome/plus.svg").size(14)))
        .when(!collapsed, el => el.child(div().id("organizer-menu").size(26).flex().items_center().justify_center().rounded(6)
          .tooltip("Group actions").hover(s => s.bg(t.hover)).on_click(() => this.organizerMenu()).child("⋯"))))
      .when(!collapsed && !!this.groupError, el => el.child(div().px(12).py(5).text_size(11).text_color(t.blocked).child("Group data needs recovery. Spaces remain available.")))
      .when(!collapsed && this.orderPending, el => el.child(div().id("order-status").px(12).py(5).text_size(11).text_color(t.muted)
        .when(this.synchronizer.failed, el => el.cursor_pointer().on_click(() => run("space-organizer.retry-order")))
        .child(this.synchronizer.failed ? "Ordering paused · click to retry" : "Sorting Spaces · actual order shown")))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_hidden().overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (!this.drag.source && this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        .children(list));
  }
}
