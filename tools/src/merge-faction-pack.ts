/**
 * Merge IP-safe faction-pack staging (`data/_audit/faction-pack-input/<faction>.json`,
 * produced by `extract-faction-pack.ts`) into `data/core/<faction>/`.
 *
 * For every staged detachment whose *core* entry is still a bare shell — empty
 * `stratagem_ids` AND empty `enhancement_ids` — this creates the core stratagem
 * and enhancement entities from the staged metadata and wires their ids onto the
 * detachment. Detachments that already carry entities (converted from army-assist,
 * or merged earlier) are left untouched, so re-running is additive and safe.
 *
 * The DSL link stays open: every created entity gets `ability_id: null`. Authoring
 * the mechanic happens separately via the `author:*` pipeline.
 *
 * Field provenance (mirrors the hand-merged Space Marine packs):
 *  - stratagem: name + cp_cost + phases + player_turn straight from staging; the
 *    GW `type` is omitted (faction packs don't print it for new detachments) and
 *    `timing` defaults to `once-per-phase` when the pack didn't state a frequency.
 *  - enhancement: name from staging; `cost: 0` + `points_provisional: true` until
 *    the Munitorum Field Manual lands; `keyword_restrictions` is the faction's
 *    army keyword; `upgrade_tag: true` (faction-pack enhancements are upgrades).
 *
 * IP firewall: staging carries names + numeric/enum metadata only — never prose —
 * so nothing this tool writes is GW rules text.
 *
 * Usage:
 *   tsx tools/src/merge-faction-pack.ts <faction-id> [<faction-id> …]
 *   tsx tools/src/merge-faction-pack.ts --all-xenos
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");

/** Faction-id → the army keyword that gates its enhancements. */
const FACTION_KEYWORD: Record<string, string> = {
  orks: "Orks",
  aeldari: "Aeldari",
  drukhari: "Drukhari",
  tyranids: "Tyranids",
  "genestealer-cults": "Genestealer Cults",
  necrons: "Necrons",
  "leagues-of-votann": "Leagues of Votann",
  "tau-empire": "T’au Empire",
};

const XENOS = Object.keys(FACTION_KEYWORD);

const GAME_VERSION = { edition: "11th", dataslate: "pre-launch-provisional" } as const;

interface StagedStratagem {
  id: string;
  name: string;
  type: string | null;
  cp_cost: number | null;
  phases: string[];
  player_turn: string | null;
  timing: string | null;
}
interface StagedEnhancement {
  id: string;
  name: string;
  cost: number | null;
}
interface StagedDetachment {
  id: string;
  name: string;
  detachment_rule_name: string | null;
  stratagems: StagedStratagem[];
  enhancements: StagedEnhancement[];
}
interface Staging {
  faction_id: string;
  detachments: StagedDetachment[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function mergeFaction(faction: string): void {
  const keyword = FACTION_KEYWORD[faction];
  if (!keyword) throw new Error(`no faction keyword mapping for ${faction}`);

  const dir = resolve(DATA_ROOT, "core", faction);
  const staging = readJson<Staging>(
    resolve(DATA_ROOT, "_audit", "faction-pack-input", `${faction}.json`),
  );
  const detachments = readJson<Record<string, unknown>[]>(resolve(dir, "detachments.json"));
  const stratagems = readJson<Record<string, unknown>[]>(resolve(dir, "stratagems.json"));
  const enhancements = readJson<Record<string, unknown>[]>(resolve(dir, "enhancements.json"));

  const detById = new Map(detachments.map((d) => [d.id as string, d]));
  const stratIds = new Set(stratagems.map((s) => s.id as string));
  const enhIds = new Set(enhancements.map((e) => e.id as string));

  let addedStrat = 0;
  let addedEnh = 0;
  let wiredDets = 0;
  const skipped: string[] = [];
  const renames: string[] = [];

  /**
   * A globally-unique id for a new entity. GW reuses stratagem/enhancement names
   * across detachments (e.g. Ork "Long, Uncontrolled Bursts" is in both More Dakka!
   * and Rollin' Deff) — distinct mechanics that collide on the bare name kebab. On
   * collision we detachment-scope the id so existing ids stay stable and the entity
   * collection (keyed by id) never overwrites. The staging entry is renamed to match.
   */
  function uniqueId(baseId: string, detId: string, taken: Set<string>): string {
    if (!taken.has(baseId)) return baseId;
    const scoped = `${detId}-${baseId}`;
    if (taken.has(scoped)) throw new Error(`cannot disambiguate id ${baseId} for ${detId}`);
    renames.push(`${baseId} → ${scoped}`);
    return scoped;
  }

  for (const sd of staging.detachments) {
    const det = detById.get(sd.id);
    if (!det) {
      skipped.push(`${sd.id} (no core detachment)`);
      continue;
    }
    const isBareShell =
      ((det.stratagem_ids as unknown[]) ?? []).length === 0 &&
      ((det.enhancement_ids as unknown[]) ?? []).length === 0;
    if (!isBareShell) continue; // already populated — leave it.

    for (const s of sd.stratagems) {
      s.id = uniqueId(s.id, sd.id, stratIds); // mutate staging to stay consistent
      stratagems.push({
        id: s.id,
        name: s.name,
        category: "detachment",
        detachment_id: sd.id,
        cp_cost: s.cp_cost ?? 1,
        phases: s.phases,
        player_turn: s.player_turn ?? "either",
        timing: s.timing ?? "once-per-phase",
        target_restrictions: null,
        ability_id: null,
        game_version: { ...GAME_VERSION },
      });
      stratIds.add(s.id);
      addedStrat++;
    }
    for (const e of sd.enhancements) {
      e.id = uniqueId(e.id, sd.id, enhIds);
      enhancements.push({
        id: e.id,
        name: e.name,
        detachment_id: sd.id,
        cost: e.cost ?? 0,
        keyword_restrictions: [keyword],
        ability_id: null,
        is_unique: true,
        game_version: { ...GAME_VERSION },
        points_provisional: true,
        upgrade_tag: true,
        max_targets: 1,
      });
      enhIds.add(e.id);
      addedEnh++;
    }

    det.stratagem_ids = sd.stratagems.map((s) => s.id);
    det.enhancement_ids = sd.enhancements.map((e) => e.id);
    wiredDets++;
  }

  writeJson(resolve(dir, "detachments.json"), detachments);
  writeJson(resolve(dir, "stratagems.json"), stratagems);
  writeJson(resolve(dir, "enhancements.json"), enhancements);
  // Persist any id renames back to staging so it stays the source for authoring.
  if (renames.length)
    writeJson(
      resolve(DATA_ROOT, "_audit", "faction-pack-input", `${faction}.json`),
      staging,
    );

  console.log(
    `${faction}: wired ${wiredDets} detachment(s), +${addedStrat} stratagems, +${addedEnh} enhancements` +
      (renames.length ? `; renamed ${renames.join("; ")}` : "") +
      (skipped.length ? `; skipped ${skipped.join(", ")}` : ""),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const factions = args.includes("--all-xenos") ? XENOS : args;
  if (factions.length === 0) {
    console.error("usage: merge-faction-pack.ts <faction-id>… | --all-xenos");
    process.exit(1);
  }
  for (const f of factions) mergeFaction(f);
}

main();
