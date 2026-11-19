import type { CreationHost, CreationSpace } from "../core/creation.js";

export interface CreationApi {
  checking(): boolean;
  pickFolder(options: { prompt: string }): Promise<string | null>;
  spaces(): readonly CreationSpace[];
  run(command: string, args: Record<string, unknown>): unknown;
  notify(options: { title: string; body: string; level: "error" }): unknown;
}

export function creationAdapter(api: CreationApi, pause: (ms: number) => Promise<void>): CreationHost {
  return {
    checking: () => api.checking(),
    pickFolder: () => api.checking() ? Promise.resolve(null) : api.pickFolder({ prompt: "Choose a local folder for the new Space" }),
    spaces: () => api.spaces(),
    create: folder => { if (!api.checking()) api.run("space.new", { folder, machine: "" }); },
    pause,
    failed: message => {
      if (!api.checking()) api.notify({ title: "Couldn't create a local Space", body: message, level: "error" });
    },
  };
}

export interface RemoteCreationApi {
  checking(): boolean;
  ready(): boolean;
  validateFolder(path: string): Promise<string>;
  spaces(): readonly CreationSpace[];
  run(command: string, args: Record<string, unknown>): unknown;
  failed(message: string): void;
}
export function remoteCreationAdapter(api: RemoteCreationApi, machine: string, selected: string, pause: (ms: number) => Promise<void>): CreationHost {
  const ready = () => { if (!api.ready()) throw new Error("This machine is not ready. Reconnect and retry."); };
  return {
    checking: () => api.checking(),
    pickFolder: async () => {
      if (api.checking()) return null;
      ready();
      const path = await api.validateFolder(selected);
      if (api.checking()) return null;
      ready();
      return path;
    },
    spaces: () => api.spaces(),
    create: folder => { if (!api.checking()) { ready(); api.run("space.new", { machine, folder }); } },
    pause,
    failed: message => { if (!api.checking()) api.failed(message); },
  };
}
