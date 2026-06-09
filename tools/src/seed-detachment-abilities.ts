/**
 * Seed empty-modifier DSL stubs for new-detachment abilities — the detachment
 * rule, plus every stratagem and enhancement — so they flow through the normal
 * `author-input → author-batch propose/apply` authoring workflow.
 *
 * The authoring pipeline only fleshes stubs that already exist (it iterates
 * `hasEmptyModifier` entries). The faction-pack merge created the *core*
 * stratagem/enhancement entities with `ability_id: null` and left detachment
 * rules unmodelled, so nothing was authorable. This tool closes that gap:
 *
 *  - one stub per core stratagem/enhancement (id = the entity id), and the core
 *    entity's `ability_id` is wired to it.
 *  - one `ability_type:"detachment"` stub per detachment rule (id = a slug of the
 *    `detachment_rule_name` from staging), and `detachment.detachment_rule_id`
 *    is wired to it.
 *
 * Scope is the faction-pack staging (`faction-pack-input/<faction>.json`, already
 * trimmed to the new detachments). Idempotent: an ability id that already exists
 * is left untouched (so hand-authored rules survive), and an already-wired core
 * entity is skipped. Real mechanics are authored downstream — the stub effect is
 * the empty-modifier placeholder the pipeline recognises. No GW prose is written.
 *
 * Usage: tsx tools/src/seed-detachment-abilities.ts <faction-id>… | --all-xenos
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");

const XENOS = [
  "orks", "aeldari", "drukhari", "tyranids",
  "genestealer-cults", "necrons", "leagues-of-votann", "tau-empire",
];

const GAME_VERSION = { edition: "11th", dataslate: "pre-launch-provisional" } as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJson = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));
const writeJson = (p: string, v: unknown): void => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

/** kebab-case id slug matching `^[a-z0-9][a-z0-9-]*[a-z0-9]$`. */
const slug = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function emptyStub(
  abilityId: string,
  name: string,
  abilityType: string,
  factionId: string,
  detachmentId: string,
): Json {
  return {
    ability_id: abilityId,
    name,
    authored_by: "40kdc-community",
    game_version: { ...GAME_VERSION },
    version: "2025-q3",
    supersedes: null,
    unit_ids: [],
    faction_id: factionId,
    detachment_id: detachmentId,
    ability_type: abilityType,
    behavior: "passive",
    effect: { type: "stat-modifier", target: "unit", modifier: {} },
    scope: { range: "unit", duration: "permanent" },
  };
}

function seedFaction(faction: string): void {
  const stagingPath = resolve(DATA_ROOT, "_audit", "faction-pack-input", `${faction}.json`);
  if (!existsSync(stagingPath)) {
    console.log(`${faction}: no staging file, skipped`);
    return;
  }
  const staging = readJson(stagingPath);
  const dir = resolve(DATA_ROOT, "core", faction);
  const detachments = readJson(resolve(dir, "detachments.json"));
  const stratagems = readJson(resolve(dir, "stratagems.json"));
  const enhancements = readJson(resolve(dir, "enhancements.json"));
  const abilitiesPath = resolve(DATA_ROOT, "enrichment", faction, "abilities.json");
  const abilities = readJson(abilitiesPath);

  const detById = new Map<string, Json>(detachments.map((d: Json) => [d.id, d]));
  const abilityIds = new Set(abilities.map((a: Json) => a.ability_id as string));
  const stratById = new Map<string, Json>(stratagems.map((s: Json) => [s.id, s]));
  const enhById = new Map<string, Json>(enhancements.map((e: Json) => [e.id, e]));

  let added = 0;
  let wired = 0;

  const ensureStub = (id: string, name: string, type: string, detId: string): void => {
    if (abilityIds.has(id)) return; // already authored or seeded
    abilities.push(emptyStub(id, name, type, faction, detId));
    abilityIds.add(id);
    added++;
  };

  for (const sd of staging.detachments) {
    const det = detById.get(sd.id);
    if (!det) continue;

    // Detachment rule → ability_type "detachment".
    if (sd.detachment_rule_name) {
      let ruleId = slug(sd.detachment_rule_name);
      if (abilityIds.has(ruleId) && det.detachment_rule_id !== ruleId) ruleId = `${sd.id}-${ruleId}`;
      ensureStub(ruleId, sd.detachment_rule_name, "detachment", sd.id);
      if (!det.detachment_rule_id) {
        det.detachment_rule_id = ruleId;
        wired++;
      }
    }

    // Stratagems + enhancements → stub per core entity, wire its ability_id.
    for (const s of sd.stratagems ?? []) {
      const core = stratById.get(s.id);
      if (!core) continue;
      ensureStub(s.id, core.name, "stratagem", sd.id);
      if (core.ability_id == null) {
        core.ability_id = s.id;
        wired++;
      }
    }
    for (const e of sd.enhancements ?? []) {
      const core = enhById.get(e.id);
      if (!core) continue;
      ensureStub(e.id, core.name, "enhancement", sd.id);
      if (core.ability_id == null) {
        core.ability_id = e.id;
        wired++;
      }
    }
  }

  writeJson(abilitiesPath, abilities);
  writeJson(resolve(dir, "detachments.json"), detachments);
  writeJson(resolve(dir, "stratagems.json"), stratagems);
  writeJson(resolve(dir, "enhancements.json"), enhancements);
  console.log(`${faction}: +${added} stub abilities, wired ${wired} link(s)`);
}

function main(): void {
  const args = process.argv.slice(2);
  const factions = args.includes("--all-xenos") ? XENOS : args;
  if (factions.length === 0) {
    console.error("usage: seed-detachment-abilities.ts <faction-id>… | --all-xenos");
    process.exit(1);
  }
  for (const f of factions) seedFaction(f);
}

main();
