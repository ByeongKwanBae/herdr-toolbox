// Space actions retain Herdr 0.1.16 menu command/overlay contracts (Apache-2.0).
import { div, type Context, type FocusHandle } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { openOverlay, closeOverlay, checking, spaces, panes, machines } from "herdr";
import { themeColors, safeRun as run, safeExec as exec } from "../host/herdr-adapter.js";
import { groupStore } from "../host/groups.js";
import { spaceGroup, type MachineKey } from "../core/model.js";

interface Item { label: string; id: string; choose: (cx: Context) => void }

export default class OrganizerOverlay {
  private view = "menu";
  private overlay = "";
  private handle!: FocusHandle;
  private input?: InputState;
  private props: Record<string, unknown> = {};
  private error = "";
  private at = 0;
  private selected?: string;
  private git: "main" | "linked" | null = null;
  private store = groupStore();
  private get spaceId(): string | undefined { return typeof this.props.space === "string" ? this.props.space : undefined; }
  private get groupId(): string | undefined { return typeof this.props.group === "string" ? this.props.group : undefined; }
  private get machine(): MachineKey { return typeof this.props.machine === "string" && this.props.machine ? this.props.machine : null; }

  init(props: Record<string, unknown>, cx: Context): void {
    this.props = props;
    this.view = props.view === "group" ? "group" : "menu";
    this.overlay = typeof props.overlay === "string" ? props.overlay : "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    const decoded = this.store.read();
    if (this.view === "group") {
      const existing = decoded.ok ? decoded.state.groups.find(group => group.id === this.groupId) : undefined;
      if (!decoded.ok) this.error = decoded.error;
      else if (this.groupId && !existing) this.error = "The group no longer exists.";
      if (props.action !== "delete") {
        this.input = InputState.new({ value: existing?.name ?? "", placeholder: "Group name" });
        if (existing) this.input.set_selected_range({ start: 0, end: existing.name.length });
        this.input.on("change", (_event, cx) => { this.error = ""; cx.notify(); });
        this.input.on("submit", (_event, cx) => this.submit(cx));
        this.input.focus();
      }
    } else if (this.spaceId && props.mode !== "groups" && !checking()) {
      const space = spaces().find(space => space.id === this.spaceId);
      if (space) {
        const tabs = new Set(space.tabs.map(tab => tab.id));
        const folder = panes().find(pane => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder;
        if (folder) cx.spawn(async cx => {
          try {
            const [top, common] = await Promise.all([
              exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on: space.machine }),
              exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on: space.machine }),
            ]);
            if (top.code === 0 && common.code === 0) this.git = common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
          } catch { /* Native non-repository menus still work. */ }
          cx.notify();
        });
      }
    }
  }

  private dismiss(): void { if (!checking() && this.overlay) closeOverlay(this.overlay); }
  private open(props: Record<string, unknown>, dialog = false): void {
    if (checking()) return;
    this.dismiss();
    openOverlay({ mod: "space-organizer", kind: dialog ? "dialog" : "popup", width: dialog ? 420 : 280,
      height: dialog ? 255 : 460, props });
  }
  private target() {
    const space = spaces().find(space => space.id === this.spaceId);
    if (!space) { this.dismiss(); throw new Error("The target Space no longer exists."); }
    return space;
  }
  private submit(cx: Context): void {
    if (checking()) return;
    try {
      if (this.props.action === "delete" && this.groupId) this.store.change({ type: "delete", group: this.groupId });
      else if (this.props.action === "rename" && this.groupId) this.store.change({ type: "rename", group: this.groupId, name: this.input?.value() ?? "" });
      else this.store.create(this.machine, this.input?.value() ?? "", this.spaceId);
      this.dismiss();
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); cx.notify(); }
  }
  private items(): Item[] {
    const item = (id: string, label: string, choose: (cx: Context) => void): Item => ({ id, label, choose });
    const decoded = this.store.read();
    if (this.spaceId) {
      const space = spaces().find(space => space.id === this.spaceId);
      if (!space) return [item("missing-space", "Space no longer exists · Close", () => this.dismiss())];
      if (this.props.mode === "groups") {
        if (!decoded.ok) return [item("invalid-data", "Group data needs recovery", () => { throw new Error(decoded.error); })];
        return [
          ...decoded.state.groups.filter(group => group.machine === space.machine).map(group => item(`move-${group.id}`, group.name, () => {
            this.target(); this.store.change({ type: "assign", space: space.id, group: group.id }); this.dismiss();
          })),
          item("move-none", "Remove from group", () => { this.target(); this.store.change({ type: "assign", space: space.id, group: null }); this.dismiss(); }),
          item("new-and-move", "New group and move…", () => { const live = this.target(); this.open({ view: "group", action: "create", machine: live.machine, space: live.id }, true); }),
        ];
      }
      const actions: Item[] = [item("rename-space", "Rename", () => { const live = this.target(); this.dismiss(); run("space.rename", { id: live.id }); })];
      if (decoded.ok) {
        actions.push(item("new-and-move", "New group and move…", () => { const live = this.target(); this.open({ view: "group", action: "create", machine: live.machine, space: live.id }, true); }));
        actions.push(item("move-group", "Move to group…", () => { this.target(); this.open({ view: "menu", mode: "groups", space: space.id }); }));
        if (spaceGroup(decoded.state, space)) actions.push(item("ungroup", "Remove from group", () => { this.target(); this.store.change({ type: "assign", space: space.id, group: null }); this.dismiss(); }));
      }
      const worktree = (action: "new" | "open" | "remove") => {
        const live = this.target(); this.dismiss();
        openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: { space: live.id, action } });
      };
      if (this.git) actions.push(item("worktree-new", "New worktree", () => worktree("new")), item("worktree-open", "Open worktree", () => worktree("open")));
      if (this.git === "linked") actions.push(item("worktree-remove", "Remove worktree", () => worktree("remove")));
      actions.push(item("close-space", "Delete Space…", () => { const live = this.target(); this.dismiss(); run("space.close", { id: live.id }); }));
      return actions;
    }
    if (this.groupId) {
      if (!decoded.ok || !decoded.state.groups.some(group => group.id === this.groupId)) return [item("missing-group", "Group unavailable · Close", () => this.dismiss())];
      return [item("rename-group", "Rename group…", () => this.open({ view: "group", action: "rename", group: this.groupId }, true)),
        item("delete-group", "Delete group…", () => this.open({ view: "group", action: "delete", group: this.groupId }, true))];
    }
    return [
      ...(decoded.ok ? [item("create-group", "New group…", () => this.open({ view: "group", action: "create", machine: this.machine }, true))] : []),
      item("retry-order", "Retry Space ordering", () => { this.dismiss(); run("space-organizer.retry-order"); }),
      item("close-menu", "Close", () => this.dismiss()),
    ];
  }
  private choose(id: string | undefined, cx: Context): void {
    if (checking()) return;
    if ((this.spaceId && !spaces().some(space => space.id === this.spaceId)) || (this.groupId && !this.store.read().ok)) { this.dismiss(); return; }
    try {
      const action = this.items().find(item => item.id === id);
      if (!action) { this.dismiss(); return; }
      action.choose(cx);
    }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); cx.notify(); }
  }
  render(_cx: Context) {
    const t = themeColors();
    const decoded = this.store.read();
    const button = (id: string, text: string, choose: (cx: Context) => void) => h_flex().id(id).h(32).px(12).items_center()
      .rounded(7).bg(t.raised).cursor_pointer().hover(el => el.bg(t.hover)).on_click((_event, cx) => choose(cx)).child(text);
    if (this.view === "group") {
      const deleting = this.props.action === "delete";
      const group = decoded.ok ? decoded.state.groups.find(group => group.id === this.groupId) : undefined;
      return v_flex().id("group-dialog").track_focus(this.handle).w_full().p(18).gap(12)
        .bg(t.popover).text_color(t.foreground).text_size(13)
        .on_key_down(event => { if (event.key === "escape") this.dismiss(); })
        .child(div().font_semibold().text_size(15).child(deleting ? "Delete group?" : this.props.action === "rename" ? "Rename group" : "New group"))
        .when(deleting, el => el.child(div().child(`${group?.name ?? "This group"} will be removed. Its Spaces and terminals will stay open.`)))
        .when(!!this.input, el => el.child(Input.new(this.input!).h(36).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_color(t.foreground)))
        .child(div().text_size(11).text_color(t.muted).child(deleting ? "Only group membership is removed." : "1–60 characters · unique on this machine"))
        .when(!!this.error, el => el.child(div().text_color(t.blocked).child(this.error)))
        .child(h_flex().gap(8).justify_end().child(button("group-cancel", "Cancel", () => this.dismiss()))
          .child(button("group-save", deleting ? "Delete group" : "Save", cx => this.submit(cx))));
    }
    const items = this.items();
    const selectedIndex = items.findIndex(item => item.id === this.selected);
    if (selectedIndex >= 0) this.at = selectedIndex;
    this.at = Math.min(this.at, Math.max(0, items.length - 1));
    return v_flex().id("organizer-menu").track_focus(this.handle).w_full().max_h(440).min_h(0).p(6).gap(3)
      .bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((event, cx) => {
        if (event.key === "escape") this.dismiss();
        else if (event.key === "enter") this.choose(items[this.at]?.id, cx);
        else if (event.key === "down") { this.at = (this.at + 1) % items.length; this.selected = items[this.at]?.id; cx.notify(); }
        else if (event.key === "up") { this.at = (this.at + items.length - 1) % items.length; this.selected = items[this.at]?.id; cx.notify(); }
      })
      .child(div().px(8).py(4).text_size(11).text_color(t.muted).child(this.props.mode === "groups" ? "Move to group" : "Space Organizer"))
      .child(v_flex().h(Math.min(items.length * 31, 360)).flex_none().min_h(0).overflow_y_scrollbar().children(items.map((entry, index) => h_flex().id(entry.id).h(31).flex_none().px(8).items_center().rounded(6)
        .when(index === this.at, el => el.bg(t.selected)).cursor_pointer().hover(el => el.bg(t.hover))
        .on_click((_event, cx) => this.choose(entry.id, cx)).child(entry.label))))
      .when(!!this.error || !decoded.ok, el => el.child(div().px(8).text_color(t.blocked).text_size(11).child(this.error || (!decoded.ok ? decoded.error : ""))));
  }
}
