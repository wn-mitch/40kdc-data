/**
 * Reverse-link enrichment ability `unit_ids` arrays into each unit's
 * `ability_ids` in core data.
 *
 * Each `data/enrichment/<faction>/abilities.json` entry carries a
 * `unit_ids` array naming the units that ability applies to. This script
 * inverts that into `data/core/<faction>/units.json[*].ability_ids`.
 *
 * Additionally layers in `leader-attachments.json` — every `leader_id`
 * gains the `"leader"` core ability.
 *
 * Idempotent and additive: existing `ability_ids` are preserved so
 * manually-curated links (e.g. core abilities like "deep-strike",
 * "deadly-demise-d3" not reachable via the enrichment unit_ids path)
 * survive re-runs.
 *
 * Cross-faction routing: each `(unit_id, ability_id)` pair is bucketed
 * to whichever `data/core/<faction>/units.json` actually contains that
 * `unit_id` — so subfaction enrichment files contribute to the
 * appropriate shared core file (e.g. Blood Angels enrichment routes
 * into `adeptus-astartes/units.json`).
 *
 * Usage:
 *   npx tsx tools/src/link-abilities.ts                  # all factions
 *   npx tsx tools/src/link-abilities.ts --faction orks   # one faction
 *   npx tsx tools/src/link-abilities.ts --dry-run        # report only
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "../..");

interface EnrichmentAbility {
  ability_id: string | null;
  unit_ids: string[] | null;
}

interface CoreUnit {
  id: string;
  ability_ids?: string[];
  [k: string]: unknown;
}

interface LeaderAttachment {
  leader_id: string;
}

export interface LinkOptions {
  rootDir?: string;
  factionFilter?: string;
  dryRun?: boolean;
}

export interface LinkSummary {
  factionsScanned: number;
  unitsChanged: number;
  abilityLinksAdded: number;
  unknownUnitIdReferences: string[];
  filesWritten: string[];
}

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJSON(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function listFactionDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

export function linkAbilities(opts: LinkOptions = {}): LinkSummary {
  const root = opts.rootDir ?? DEFAULT_ROOT;
  const coreDir = resolve(root, "data/core");
  const enrichmentDir = resolve(root, "data/enrichment");

  // Collect (unit_id → set<ability_id>) from every enrichment file.
  const wanted = new Map<string, Set<string>>();

  for (const faction of listFactionDirs(enrichmentDir)) {
    const path = join(enrichmentDir, faction, "abilities.json");
    if (!existsSync(path)) continue;
    const abilities = readJSON<EnrichmentAbility[]>(path);
    for (const a of abilities) {
      if (!a.ability_id || !a.unit_ids) continue;
      for (const unitId of a.unit_ids) {
        let set = wanted.get(unitId);
        if (!set) wanted.set(unitId, (set = new Set()));
        set.add(a.ability_id);
      }
    }
  }

  // Layer in leader-attachments → "leader".
  for (const faction of listFactionDirs(coreDir)) {
    const path = join(coreDir, faction, "leader-attachments.json");
    if (!existsSync(path)) continue;
    const leaders = readJSON<LeaderAttachment[]>(path);
    for (const l of leaders) {
      let set = wanted.get(l.leader_id);
      if (!set) wanted.set(l.leader_id, (set = new Set()));
      set.add("leader");
    }
  }

  // Route each (unit_id, ability_id) pair to its owning core/<faction>/units.json.
  const factionsWithUnits = listFactionDirs(coreDir).filter((f) =>
    existsSync(join(coreDir, f, "units.json")),
  );

  let unitsChanged = 0;
  let linksAdded = 0;
  const handled = new Set<string>();
  const filesWritten: string[] = [];

  for (const faction of factionsWithUnits) {
    if (opts.factionFilter && opts.factionFilter !== faction) continue;
    const unitsPath = join(coreDir, faction, "units.json");
    const units = readJSON<CoreUnit[]>(unitsPath);
    let mutated = false;

    for (const unit of units) {
      const incoming = wanted.get(unit.id);
      if (!incoming) continue;
      handled.add(unit.id);

      const before = new Set(unit.ability_ids ?? []);
      const beforeCount = before.size;
      const merged = new Set([...before, ...incoming]);
      if (merged.size === beforeCount) continue;

      linksAdded += merged.size - beforeCount;
      unitsChanged += 1;
      unit.ability_ids = [...merged].sort();
      mutated = true;
    }

    if (mutated && !opts.dryRun) {
      writeJSON(unitsPath, units);
      filesWritten.push(unitsPath);
    }
  }

  // Surface unit_ids that no core file claims.
  const unknown: string[] = [];
  for (const unitId of wanted.keys()) {
    if (!handled.has(unitId)) unknown.push(unitId);
  }
  unknown.sort();

  return {
    factionsScanned: factionsWithUnits.length,
    unitsChanged,
    abilityLinksAdded: linksAdded,
    unknownUnitIdReferences: unknown,
    filesWritten,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") ===
    fileURLToPath(import.meta.url).replace(/\.\w+$/, "");

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: npx tsx tools/src/link-abilities.ts [--faction <id>] [--dry-run]",
    );
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const factionFlag = args.indexOf("--faction");
  const factionFilter =
    factionFlag !== -1 ? args[factionFlag + 1] : undefined;

  const summary = linkAbilities({ dryRun, factionFilter });

  console.log(`Factions scanned:     ${summary.factionsScanned}`);
  console.log(`Units changed:        ${summary.unitsChanged}`);
  console.log(`Ability links added:  ${summary.abilityLinksAdded}`);
  console.log(`Files written:        ${summary.filesWritten.length}`);

  if (summary.unknownUnitIdReferences.length > 0) {
    const preview = summary.unknownUnitIdReferences.slice(0, 20);
    console.log(
      `\nWarning: ${summary.unknownUnitIdReferences.length} unit_ids in enrichment files do not match any core unit:`,
    );
    for (const id of preview) console.log(`  ${id}`);
    if (summary.unknownUnitIdReferences.length > preview.length) {
      console.log(
        `  … and ${summary.unknownUnitIdReferences.length - preview.length} more`,
      );
    }
  }

  if (dryRun) console.log("\n(dry-run; no files written)");
}
