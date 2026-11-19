interface GitDirectoryResult { code: number; stdout: string }

/** A submodule or --separate-git-dir checkout is not a removable linked worktree. */
export async function linkedCheckout(top: string, common: string, gitDirectory: () => Promise<GitDirectoryResult>): Promise<boolean | null> {
  if (common === `${top}/.git`) return false;
  try {
    const own = await gitDirectory();
    return own.code === 0 && !!own.stdout ? own.stdout.replace(/\n$/, "") !== common : null;
  } catch { return null; } // Unknown preserves sidebar state and never enables Remove.
}
