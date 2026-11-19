import { View, div, type Context } from "gpui-kit";
import Spaces from "./ui/sidebar.js";
import Overlay from "./ui/overlay.js";
import { props } from "herdr";

export default class SpaceOrganizer extends View {
  // Group persistence belongs to Herdr shared state, never to the lifetime of this View.
  private content!: Spaces | Overlay;
  private invalid?: string;
  init(_props: Record<string, unknown> | undefined, cx: Context): void {
    const value: unknown = _props ?? props();
    const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (input.view !== undefined && !["sidebar", "menu", "group"].includes(String(input.view))) { this.invalid = "Unknown Space Organizer view."; return; }
    this.content = input.view === "menu" || input.view === "group" ? new Overlay() : new Spaces();
    this.content.init(input, cx);
  }
  render(cx: Context) { return this.invalid ? div().p(12).child(this.invalid) : this.content.render(cx); }
}
