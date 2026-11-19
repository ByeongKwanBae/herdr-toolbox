import { folderRequest, posixPage, windowsPage, type FolderPage, type FolderPlatform } from "../core/folders.js";

export interface DirectoryResult { code: number; stdout: string; stderr: string }
export type DirectoryExec = (command: string, args: string[], options: { on: string; timeout: number }) => Promise<DirectoryResult>;
export const POSIX_PLATFORM = 'case "$(uname -s)" in Linux) printf linux;; Darwin) printf macos;; *) exit 64;; esac';
const POSIX_FOLDER_HEADER = `p=$1
case "$p" in ''|'~') p=$HOME;; '~/'*) p=$HOME/\${p#\\~/};; esac
case "$p" in /*) ;; *) printf '%s\\n' 'Use an absolute folder path or ~.' >&2; exit 1;; esac
CDPATH= cd -P "$p" || exit 1
if ! [ -r . ] || ! [ -x . ]; then printf '%s\\n' 'Cannot read this folder.' >&2; exit 1; fi
printf 'SO-FOLDERS-1\\000%s\\000%s\\000' "$HOME" "$PWD"`;
/** Validates the selected directory without expanding its children. */
export const POSIX_VALIDATE_FOLDER = `${POSIX_FOLDER_HEADER}
exit 0`;
export const POSIX_FOLDERS = `${POSIX_FOLDER_HEADER}
n=0
for p in "$PWD"/* "$PWD"/.[!.]* "$PWD"/..?*; do
  [ -d "$p" ] || continue
  name=\${p##*/}
  printf '%s\\000' "$name"
  n=$((n+1)); [ "$n" -gt 500 ] && break
done
exit 0`;

/** PowerShell's UTF-16LE transport; neither path data nor script uses shell quoting. */
export function encodedPowerShell(text: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); bytes.push(code & 255, code >>> 8); }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const value = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    result += alphabet[value >>> 18] + alphabet[(value >>> 12) & 63] + (index + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : "=") + (index + 2 < bytes.length ? alphabet[value & 63] : "=");
  }
  return result;
}
export function windowsFoldersScript(path = "", validateOnly = false): string {
  // Only base64 data is interpolated. Quotes, newlines, $, backticks and Unicode remain data.
  return String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
try {
$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedPowerShell(path)}'))
$userHome=[Environment]::GetFolderPath('UserProfile')
if (!$userHome) { $userHome=$HOME }
if (!$p -or $p -eq '~') { $p=$userHome }
elseif ($p.StartsWith('~\') -or $p.StartsWith('~/')) { $p=[IO.Path]::Combine($userHome,$p.Substring(2)) }
$item=Get-Item -LiteralPath $p -Force -ErrorAction Stop
if (!$item.PSIsContainer -or $item.PSProvider.Name -ne 'FileSystem') { throw 'Choose a filesystem folder.' }
$folder=$item.FullName
$folders=@(${validateOnly ? "" : "Get-ChildItem -LiteralPath $folder -Directory -Force -ErrorAction Stop | Select-Object -First 501 | ForEach-Object { @{name=$_.Name} }"})
$roots=@(Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root })
$currentRoot=[IO.Path]::GetPathRoot($folder)
if ($currentRoot -and $roots -notcontains $currentRoot) { $roots+=,$currentRoot }
$json=@{version=1;path=$folder;home=$userHome;roots=$roots;folders=$folders} | ConvertTo-Json -Depth 4 -Compress
$bytes=[Text.Encoding]::UTF8.GetBytes($json)
$output=[Console]::OpenStandardOutput()
$output.Write($bytes,0,$bytes.Length)
$output.Flush()
} catch {
  $errorBytes=[Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
  $errorOutput=[Console]::OpenStandardError()
  $errorOutput.Write($errorBytes,0,$errorBytes.Length)
  $errorOutput.Flush()
  exit 1
}`;
}
function failure(result: DirectoryResult): Error { return new Error((result.stderr || "Could not read the remote folder.").trim().slice(0, 700)); }
export class RemoteDirectory {
  private platform?: FolderPlatform;
  private powerShell = "powershell.exe";
  constructor(private readonly machine: string, private readonly execute: DirectoryExec) {
    if (!machine) throw new Error("Choose a remote machine.");
  }
  async read(path?: string): Promise<FolderPage> { return this.inspect(path, false); }
  async validate(path: string): Promise<string> { return (await this.inspect(path, true)).path; }
  private async inspect(path: string | undefined, validateOnly: boolean): Promise<FolderPage> {
    if (!this.platform) {
      try {
        const result = await this.execute("sh", ["-c", POSIX_PLATFORM], { on: this.machine, timeout: 10000 });
        const platform = result.stdout.trim();
        if (result.code === 0 && (platform === "linux" || platform === "macos")) this.platform = platform;
      } catch { /* Native Windows normally has no sh. */ }
      if (!this.platform) {
        const script = encodedPowerShell("if ($env:OS -ne 'Windows_NT') { exit 1 }; [Console]::Write('windows')");
        let result: DirectoryResult | undefined;
        for (const program of ["powershell.exe", "pwsh"]) {
          try { result = await this.execute(program, ["-NoProfile", "-NonInteractive", "-EncodedCommand", script], { on: this.machine, timeout: 10000 }); this.powerShell = program; break; }
          catch { /* Try the other supported Windows PowerShell executable. */ }
        }
        if (!result || result.code !== 0 || result.stdout.trim() !== "windows") throw new Error("Could not inspect this machine. Reconnect and retry. Linux/macOS need sh; Windows needs PowerShell.");
        this.platform = "windows";
      }
    }
    folderRequest(path, this.platform);
    const result = this.platform === "windows"
      ? await this.execute(this.powerShell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedPowerShell(windowsFoldersScript(path, validateOnly))], { on: this.machine, timeout: 10000 })
      : await this.execute("sh", ["-c", validateOnly ? POSIX_VALIDATE_FOLDER : POSIX_FOLDERS, "space-organizer-folders", path ?? ""], { on: this.machine, timeout: 10000 });
    if (result.code !== 0) throw failure(result);
    return this.platform === "windows" ? windowsPage(result.stdout) : posixPage(result.stdout, this.platform);
  }
}
