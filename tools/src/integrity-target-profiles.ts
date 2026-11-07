/**
 * A target profile names the unit whose statline it benchmarks, scoped to a faction (shared ids
 * such as `rhino` exist under several). Run as part of `checkReferentialIntegrity`, so a unit an
 * MFM release renames or retires fails validation instead of leaving a dead profile.
 */

import { existsSync, readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname, resolve } from "node:path";
import type { ValidationResult } from "./validate.js";

type Profile = { id?: unknown; faction_id?: unknown; unit_id?: unknown };

export async function checkTargetProfiles(root: string, result: ValidationResult): Promise<void> {
  const file = resolve(root, "core/target-profiles.json");
  if (!existsSync(file)) return;
  let profiles: unknown;
  try {
    profiles = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return; // unreadable: reported by schema validation
  }
  if (!Array.isArray(profiles)) return;

  const units = new Set<string>();
  for (const f of await glob("core/*/units.json", { cwd: root, absolute: true })) {
    const faction = basename(dirname(f));
    if (faction.startsWith("_")) continue;
    try {
      for (const u of JSON.parse(readFileSync(f, "utf8")) as Array<{ id?: string }>) if (u.id) units.add(`${faction}\u0000${u.id}`);
    } catch {
      // unreadable: reported by schema validation
    }
  }

  result.totalFiles++;
  (profiles as Profile[]).forEach((p, index) => {
    result.totalItems++;
    if (typeof p.faction_id !== "string" || typeof p.unit_id !== "string") return; // schema's job
    if (units.has(`${p.faction_id}\u0000${p.unit_id}`)) {
      result.passed++;
      return;
    }
    result.failed++;
    result.errors.push({
      file,
      index,
      errors: [{ path: `/${index}/unit_id`, message: `target profile "${String(p.id)}" names unit "${p.unit_id}", which ${p.faction_id} does not have` }],
    });
  });
}
