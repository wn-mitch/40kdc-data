/**
 * An `army-faction` condition must name a faction id, run as part of `checkReferentialIntegrity`
 * (integrity.ts). The engine compares it with the army's faction id, so a faction keyword or a
 * name no faction record has would never hold.
 */

import { readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname } from "node:path";
import type { ValidationResult } from "./validate.js";

/** Every faction an `army-faction` condition names, at any depth of a record. */
export function armyFactionRefs(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) armyFactionRefs(item, found);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "army-faction") {
      const faction = (record.parameters as { faction?: unknown } | undefined)?.faction;
      found.push(typeof faction === "string" ? faction : String(faction));
    }
    for (const child of Object.values(record)) armyFactionRefs(child, found);
  }
  return found;
}

/** Faction ids: every factions.json under core/. */
async function factionIds(root: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const file of await glob("core/*/factions.json", { cwd: root, absolute: true })) {
    try {
      for (const faction of JSON.parse(readFileSync(file, "utf8")) as Array<{ id?: unknown }>) if (typeof faction.id === "string") ids.add(faction.id);
    } catch {
      // unreadable: reported by schema validation
    }
  }
  return ids;
}

export async function checkArmyFactionRefs(root: string, result: ValidationResult): Promise<void> {
  const factions = await factionIds(root);
  const files = await glob("enrichment/*/abilities.json", { cwd: root, absolute: true });
  for (const file of files.sort()) {
    const dir = basename(dirname(file));
    if (dir.startsWith("_") && dir !== "_core") continue;
    let records: Array<{ ability_id?: unknown; effect?: unknown }>;
    try {
      records = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // unreadable: reported by schema validation
    }
    if (!Array.isArray(records)) continue;
    let fileCounted = false;
    records.forEach((record, index) => {
      const named = armyFactionRefs(record.effect);
      // Only records with an army-faction condition are counted.
      if (named.length === 0) return;
      if (!fileCounted) {
        result.totalFiles++;
        fileCounted = true;
      }
      result.totalItems++;
      const errors = named.filter((faction) => !factions.has(faction)).map((faction) => ({
        path: `/${index}/effect`,
        message: `ability "${String(record.ability_id)}": army-faction "${faction}" is not a faction id, so no army's faction can match it`,
      }));
      if (errors.length === 0) {
        result.passed++;
        return;
      }
      result.failed++;
      result.errors.push({ file, index, errors });
    });
  }
}
