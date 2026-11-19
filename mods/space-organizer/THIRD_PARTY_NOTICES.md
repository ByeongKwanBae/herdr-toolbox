# Third-party notices

`src/ui/sidebar.ts` is a modified TypeScript port of Herdr App 0.1.16's
`defaults/mods/spaces/main.js`, obtained from the installed app's shipped mod.
A separate development mod was created with `mod.clone`. Original comments have
been retained except the drag-reordering description, which was updated to match
this port, and the ordering/presentation code, which now incorporates groups.
Original SHA-256 values and
the SDK baseline are recorded in `sdk.lock.json`.

Source: https://github.com/herdrdev/herdr-app
License: Apache-2.0; the complete license is included in `LICENSE`.
The installed Herdr 0.1.16 LICENSE was used, with its text unchanged.

Modifications: strict TypeScript types, guarded checking mode, local folder
creation with bounded observation and duplicate-request protection, machine-local
group persistence, unified bounded ordering, safe automatic membership and
self-opening menu/input/confirmation overlays.

`src/ui/overlay.ts` adapts the Space actions and worktree dispatch contracts from
Herdr 0.1.16's `defaults/mods/menu/main.js`. It adds group actions, fresh target
validation and stable item IDs. Rename/Close prompts and the worktree dialog and
operations are still supplied by the host. The tested host menu and worktree
source hashes are also recorded in `sdk.lock.json`; their full code is not bundled.

The mod references `mods/workspace-chrome/*.svg` from the installed app. No
Herdr icons, fonts, SDK declarations, gpui runtime or their third-party
dependencies are copied into the build. These assets remain host-provided;
Herdr's installed `THIRD-PARTY-NOTICES` contains their notices (including Lucide).
The declaration files are cached locally for development only and are not
distributed. The build includes this notice and the upstream license.
