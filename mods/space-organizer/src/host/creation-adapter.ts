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
