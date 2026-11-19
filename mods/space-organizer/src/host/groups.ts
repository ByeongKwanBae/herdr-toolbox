import { checking, shared, spaces, machines } from "herdr";
import { safeSetShared } from "./herdr-adapter.js";
import { GroupStore } from "./group-store.js";

// Created per sidebar/overlay. No host calls or persistent state at module scope.
export function groupStore(): GroupStore {
  return new GroupStore({ checking, shared, spaces, machines, setShared: safeSetShared,
    id: () => `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` });
}
