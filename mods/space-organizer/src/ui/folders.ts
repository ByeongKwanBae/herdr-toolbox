import { div, svg, type Context, type FocusHandle } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { checking, machines, spaces, closeOverlay } from "herdr";
import { FolderBrowser, parentFolder } from "../core/folders.js";
import { FolderCreation } from "../core/creation.js";
import { machineReady } from "../core/model.js";
import { RemoteDirectory } from "../host/remote-directory.js";
import { remoteCreationAdapter } from "../host/creation-adapter.js";
import { groupStore } from "../host/groups.js";
import { safeExec, safeRun, themeColors } from "../host/herdr-adapter.js";

export default class RemoteFolders {
  private machine = "";
  private group?: string;
  private overlay = "";
  private path!: InputState;
  private focus!: FocusHandle;
  private directory!: RemoteDirectory;
  private browser!: FolderBrowser;
  private store = groupStore();
  private roots = false;
  private creating = false;
  private closed = false;
  private error = "";
  private get inert(): boolean { return checking() || this.closed; }
  private assertReady(): void {
    if (this.inert) throw new Error("Folder selection was cancelled.");
    if (!machineReady(machines(), this.machine)) throw new Error("This machine is not ready. Reconnect and retry.");
  }
  init(props: Record<string, unknown>, cx: Context): void {
    this.machine = typeof props.machine === "string" ? props.machine : "";
    this.group = typeof props.group === "string" ? props.group : undefined;
    this.overlay = typeof props.overlay === "string" ? props.overlay : "";
    this.path = InputState.new({ value: "", placeholder: "Absolute path or ~ for home" });
    this.focus = cx.focus_handle();
    this.path.on("submit", (_event, cx) => this.navigate(this.path.value(), cx));
    this.path.on("change", (_event, cx) => cx.notify());
    this.path.focus();
    if (!this.machine) { this.error = "Choose a remote machine."; return; }
    this.directory = new RemoteDirectory(this.machine, async (program, args, options) => {
      this.assertReady();
      const result = await safeExec(program, args, options);
      this.assertReady();
      return result;
    });
    this.browser = new FolderBrowser(path => this.directory.read(path));
    if (!checking()) this.navigate(undefined, cx);
  }
  close(): void { this.closed = true; this.browser?.close(); }
  private dismiss(): void {
    this.close();
    if (!checking() && this.overlay) closeOverlay(this.overlay);
  }
  private navigate(path: string | undefined, cx: Context): void {
    if (this.inert || this.creating || !this.browser) return;
    this.roots = false; this.error = "";
    const task = this.browser.navigate(path);
    cx.notify();
    cx.spawn(async cx => {
      const updated = await task;
      cx.phase();
      if (this.inert) return;
      if (updated && this.browser.page) this.path.set_value(this.browser.page.path);
      cx.notify();
    });
  }
  private create(cx: Context): void {
    const page = this.browser?.page;
    if (this.inert || this.creating || this.roots || !this.browser?.selectable || !page || this.path.value() !== page.path) return;
    this.creating = true; this.error = ""; cx.notify();
    cx.spawn(async cx => {
      const inactive = () => { cx.phase(); return this.inert; };
      const creation = new FolderCreation(inactive, Date.now, { machine: this.machine, platform: page.platform });
      const request = creation.begin(this.group);
      try {
        const result = await request?.execute({
          ...remoteCreationAdapter({
            checking: inactive,
            ready: () => machineReady(machines(), this.machine),
            validateFolder: async path => (await this.directory.read(path)).path,
            spaces,
            run: safeRun,
            failed: message => { this.error = message; },
          }, this.machine, page.path, ms => cx.sleep(ms)),
          validGroup: id => {
            if (inactive() || !machineReady(machines(), this.machine)) return false;
            const current = this.store.read();
            return current.ok && current.state.groups.some(group => group.id === id && group.machine === this.machine);
          },
          assignGroup: (space, group) => { if (!inactive()) this.store.change({ type: "assign", space, group }); },
        });
        if (!inactive() && result === "created") this.dismiss();
      } catch (error) { if (!this.inert) this.error = error instanceof Error ? error.message : String(error); }
      finally { this.creating = false; if (!this.inert) cx.notify(); }
    });
  }
  render(_cx: Context) {
    const t = themeColors(), page = this.browser?.page;
    const busy = this.creating || !!this.browser?.loading;
    const button = (id: string, label: string, enabled: boolean, choose: (cx: Context) => void) => h_flex().id(id).h(30).px(10).flex_none().items_center().rounded(6)
      .bg(t.raised).when(!enabled, el => el.opacity(0.4)).when(enabled, el => el.cursor_pointer().hover(el => el.bg(t.hover)))
      .on_click((_event, cx) => { if (enabled) choose(cx); }).child(label);
    const error = this.error || this.browser?.error;
    const edited = !!page && this.path.value() !== page.path;
    const parent = page && parentFolder(page.path, page.platform);
    const current = this.store.read();
    const group = current.ok ? current.state.groups.find(group => group.id === this.group && group.machine === this.machine) : undefined;
    const folders = this.roots ? (page?.roots ?? []).map(path => ({ name: path, path })) : page?.folders ?? [];
    return v_flex().id("remote-folders").track_focus(this.focus).h(560).w_full().min_h(0).p(18).gap(10)
      .bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((event, cx) => { if (event.key === "escape") { cx.stop_propagation(); if (!this.creating) this.dismiss(); } })
      .child(h_flex().items_center().gap(8).flex_none()
        .child(svg("mods/workspace-chrome/server.svg").size(16).flex_none().text_color(t.muted))
        .child(div().font_semibold().text_size(16).child("Choose remote folder"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(this.machine)))
      .when(!!this.group, el => el.child(div().flex_none().text_size(11).text_color(group ? t.muted : t.blocked).child(group ? `New Space in group: ${group.name}` : "Destination group is unavailable. No Space will be created.")))
      .child(h_flex().gap(7).flex_none()
        .child(Input.new(this.path).h(34).flex_1().min_w(0).px(9).rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
        .child(button("folder-go", "Go", !busy && !!this.browser, cx => this.navigate(this.path.value(), cx))))
      .child(h_flex().gap(6).flex_none()
        .child(button("folder-home", "Home", !busy && !!this.browser, cx => this.navigate(undefined, cx)))
        .child(button("folder-up", "Up", !busy && !!parent, cx => this.navigate(parent ?? undefined, cx)))
        .child(button("folder-roots", page?.platform === "windows" ? "Drives / roots" : "Root", !busy && !!page, cx => { this.roots = true; this.error = ""; cx.notify(); }))
        .child(button("folder-refresh", "Refresh", !busy && !!this.browser, cx => this.navigate(page?.path, cx)))
        .child(div().flex_1()).when(!!page, el => el.child(div().text_size(11).text_color(t.muted).child(page!.platform))))
      .child(v_flex().id("folder-list").flex_1().min_h(0).overflow_hidden().overflow_y_scrollbar().p(4).rounded(6).border_1().border_color(t.border)
        .when(busy, el => el.child(div().p(12).text_color(t.muted).child(this.creating ? "Creating Space…" : "Loading folders…")))
        .when(!busy, el => el.children(folders.map(entry => h_flex().id(`folder-${entry.path}`).h(29).flex_none().px(8).gap(8).items_center().rounded(5).cursor_pointer().hover(el => el.bg(t.hover))
          .tooltip(entry.path).on_click((_event, cx) => this.navigate(entry.path, cx))
          .child(svg("mods/workspace-chrome/folder.svg").size(14).flex_none().text_color(t.accent))
          .child(div().flex_1().min_w(0).truncate().child(entry.name))))
          .when(!folders.length && !!page, el => el.child(div().p(12).text_color(t.muted).child("No subfolders. You can create a Space here.")))))
      .when(!!page?.limited, el => el.child(div().flex_none().text_size(11).text_color(t.muted).child("First 500 folders shown. Enter a path to open another folder.")))
      .when(!!error, el => el.child(div().max_h(70).flex_none().overflow_y_scrollbar().text_size(12).text_color(t.blocked).child(error!)))
      .child(h_flex().gap(8).flex_none().items_center()
        .child(div().flex_1().min_w(0).truncate().tooltip(page?.path ?? "").text_size(11).text_color(t.muted).child(this.roots ? "Choose a drive or root" : edited ? "Press Go to open this path" : page?.path ?? "Choose a folder"))
        .child(button("folder-cancel", "Cancel", !this.creating, () => this.dismiss()))
        .child(button("folder-create", "Create Space here", !busy && !this.roots && !edited && !!this.browser?.selectable && (!this.group || !!group), cx => this.create(cx))));
  }
}
