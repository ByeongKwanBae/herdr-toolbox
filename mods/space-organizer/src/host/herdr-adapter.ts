import { checking, run, setShared, exec, hc, theme } from "herdr";
import type { Color } from "gpui-kit";

// Keep all inherited writes and external processes inert during herdr-app check.
export const safeRun: typeof run = (name, args) => checking() ? null : run(name, args);
export const safeSetShared: typeof setShared = (key, value) => checking() ? null : setShared(key, value);
export const safeExec: typeof exec = (command, args, options) => checking()
  ? Promise.reject(new Error("External processes are disabled during app checks.")) : exec(command, args, options);
export const safeHc: typeof hc = args => checking()
  ? Promise.reject(new Error("External processes are disabled during app checks.")) : hc(args);

export function colorState(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function color(value: string): Color {
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value as Color;
  return "#808080";
}

// Herdr declares theme values as strings; gpui-kit requires concrete colors.
export function themeColors(): Record<string, Color> {
  return Object.fromEntries(Object.entries(theme()).map(([key, value]) => [key, color(value)]));
}
