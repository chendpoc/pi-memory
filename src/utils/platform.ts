export type PiMemoryPlatform = "darwin" | "win32" | "other";

export function getPlatform(): PiMemoryPlatform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  return "other";
}

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function isMacOS(): boolean {
  return process.platform === "darwin";
}

/** Unix-like platforms where chmod / UDS cleanup apply. */
export function isUnixLike(): boolean {
  return !isWindows();
}
