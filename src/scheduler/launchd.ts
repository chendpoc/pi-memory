import { execa } from "execa";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { LAUNCHD_LABEL, LEGACY_LAUNCHD_LABELS } from "../constants/paths.js";
import { buildLaunchdMaintenancePlist, type LaunchdMaintenancePlistInput } from "./launchdPlist.js";

export function launchAgentPlistPath(label: string = LAUNCHD_LABEL): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function launchctlDomain(): string | null {
  const uid = process.getuid?.();
  return uid === undefined ? null : `gui/${uid}`;
}

async function launchctlBootout(label: string): Promise<void> {
  const domain = launchctlDomain();
  const plistPath = launchAgentPlistPath(label);

  if (domain) {
    await execa("launchctl", ["bootout", `${domain}/${label}`], { reject: false });
  }

  if (existsSync(plistPath)) {
    await execa("launchctl", ["unload", plistPath], { reject: false });
  }
}

async function launchctlBootstrap(plistPath: string): Promise<void> {
  const domain = launchctlDomain();
  if (!domain) {
    throw new Error("launchctl bootstrap requires a user id");
  }

  await execa("launchctl", ["bootstrap", domain, plistPath]);
}

/** True when the user LaunchAgent is registered in launchd (not merely when the plist file exists). */
export async function isLaunchAgentLoaded(label: string): Promise<boolean> {
  const domain = launchctlDomain();
  if (!domain) return false;

  const result = await execa("launchctl", ["print", `${domain}/${label}`], { reject: false });
  return result.exitCode === 0;
}

export type LaunchdSyncResult = {
  label: string;
  plistPath: string;
  /** Plist bytes changed on disk. */
  changed: boolean;
  /** launchctl bootstrap ran because the job was missing (e.g. prior bootstrap failed). */
  bootstrapped: boolean;
  removedLegacy: string[];
};

export async function syncLaunchdMaintenanceJob(
  input: LaunchdMaintenancePlistInput,
): Promise<LaunchdSyncResult> {
  const label = input.label;
  const plistPath = launchAgentPlistPath(label);
  const plist = buildLaunchdMaintenancePlist(input);

  let previous: string | null = null;
  if (existsSync(plistPath)) {
    const { readFile } = await import("node:fs/promises");
    previous = await readFile(plistPath, "utf8");
  }

  const removedLegacy: string[] = [];
  for (const legacyLabel of LEGACY_LAUNCHD_LABELS) {
    const legacyPath = launchAgentPlistPath(legacyLabel);
    if (!existsSync(legacyPath)) continue;

    await launchctlBootout(legacyLabel);
    await unlink(legacyPath).catch(() => {});
    removedLegacy.push(legacyLabel);
  }

  if (previous === plist) {
    if (await isLaunchAgentLoaded(label)) {
      return { label, plistPath, changed: false, bootstrapped: false, removedLegacy };
    }

    await launchctlBootstrap(plistPath);
    return { label, plistPath, changed: false, bootstrapped: true, removedLegacy };
  }

  await writeFile(plistPath, plist, "utf8");

  await launchctlBootout(label);
  await launchctlBootstrap(plistPath);

  return { label, plistPath, changed: true, bootstrapped: true, removedLegacy };
}
