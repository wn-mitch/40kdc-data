/**
 * Build the authoring input for the DSL stub fan-out (#21): join each
 * stub (isStubEntry) to its *correct* source rule in the 10e archive.
 *
 * The naive `ability.name → Datasheets_abilities.name` join is unsafe — ability
 * names collide across datasheets and factions (e.g. "Simulacrum Imperialis"
 * exists on a Sororitas *and* an Agents-of-the-Imperium "Sanctifiers" datasheet
 * with different rules). We disambiguate by chaining through the unit that
 * carries the ability and the faction it belongs to:
 *
 *   ability.unit_ids → core unit.name → archive Datasheet (name + faction code)
 *     → datasheet_id → Datasheets_abilities (datasheet_id + ability name)
 *
 * Output: data/_audit/author-input/<faction>.json — one entry per stub with the
 * resolved source rule (or `resolved:false` + a reason when the chain breaks),
 * ready to feed the classify→assemble→verify workflow.
 *
 * The archive lives outside the repo; point `ARMY_ASSIST_JSON` at it or rely on
 * the default `~/army-assist/src/assets/json`.
 *
 * Usage: npx tsx tools/src/author-input.ts [faction|--all]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { isStubEntry } from "./audit-coverage.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const CORE_ROOT = resolve(DATA_ROOT, "core");
const OUT_DIR = resolve(DATA_ROOT, "_audit", "author-input");
const ARCHIVE = process.env.ARMY_ASSIST_JSON ?? resolve(homedir(), "army-assist/src/assets/json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));
const norm = (s: string): string => s.toLowerCase().trim();

export interface SourceRule {
  datasheet_id: string;
  src_type: string | null;
  parameter: string | null;
  phases: string[] | null;
  description: string;
}

export interface AuthorInputEntry {
  faction: string;
  ability_id: string;
  name: string;
  unit_ids: string[];
  target: string | null;
  scope: Json;
  faction_id: string | null;
  ability_type: string | null;
  resolved: boolean;
  /** Why the source rule couldn't be resolved (when `resolved` is false). */
  reason?: string;
  src?: SourceRule;
}

export interface ArchiveIndex {
  /** kebab faction id → archive faction code (e.g. "adepta-sororitas" → "AS"). */
  factionCode: (kebab: string) => string | undefined;
  /** `${unitName}|${factionCode}` (lower) → datasheet ids. */
  datasheetsFor: (unitName: string, code: string) => string[];
  /** datasheet_id → (abilityName lower → rule). */
  ruleFor: (datasheetId: string, abilityName: string) => Omit<SourceRule, "datasheet_id"> | undefined;
  /**
   * datasheet_id → every ability on that datasheet, as `[name, rule]` pairs.
   * `name` is the archive's original (non-normalized) ability name. Used by the
   * seed tool to enumerate a zero-ability unit's datasheet abilities, where
   * {@link ruleFor} only answers a name we already know.
   */
  abilitiesFor: (datasheetId: string) => Array<[string, Omit<SourceRule, "datasheet_id">]>;
  /**
   * Fallback for faction- and detachment-scoped rules that live in the archive's
   * `Abilities.json` / `Detachment_abilities.json`, NOT on any unit datasheet
   * (e.g. "Battle Focus", "Sagas", "Mission Tactics"). The unit→datasheet chain
   * can't reach these, so {@link resolveSource} falls back here. Matches by
   * normalized name (allowing the archive's faction-prefixed form, e.g.
   * "Deathwatch Mission Tactics" for "Mission Tactics"); prefers a faction-code
   * match, else accepts a globally-unique name match (so cross-faction filing —
   * a Deathwatch unit under `adeptus-astartes` — still resolves safely).
   */
  factionRuleFor: (code: string | undefined, abilityName: string) => Omit<SourceRule, "datasheet_id"> | undefined;
}

/**
 * Kebab faction id → archive code, for the cases name-normalization can't bridge
 * (apostrophes the kebab drops, or an archive name that uses different words).
 */
const FACTION_CODE_ALIAS: Record<string, string> = {
  "emperors-children": "EC", // archive "Emperor's Children"
  "tau-empire": "TAU", // archive "T'au Empire"
  "leagues-of-votann": "LoV", // archive "Votann"
};

export function loadArchive(): ArchiveIndex {
  const factions: Json[] = readJSON(resolve(ARCHIVE, "Factions.json"));
  const codeByName = new Map<string, string>();
  for (const f of factions) codeByName.set(norm(f.name), f.id);

  const datasheets: Json[] = readJSON(resolve(ARCHIVE, "Datasheets.json"));
  const dsByNameCode = new Map<string, string[]>();
  for (const d of datasheets) {
    const key = `${norm(d.name)}|${d.faction_id}`;
    (dsByNameCode.get(key) ?? dsByNameCode.set(key, []).get(key)!).push(d.id);
  }

  const dsAbilities: Json[] = readJSON(resolve(ARCHIVE, "Datasheets_abilities.json"));
  // datasheet_id → (normalized name → { name: original, rule }). The original
  // name is retained so the seed tool can author from it; ruleFor keys on the
  // normalized name to match a name the caller already holds.
  type Entry = { name: string; rule: Omit<SourceRule, "datasheet_id"> };
  const byDatasheet = new Map<string, Map<string, Entry>>();
  for (const a of dsAbilities) {
    if (!a.datasheet_id || !a.name) continue;
    let m = byDatasheet.get(a.datasheet_id);
    if (!m) byDatasheet.set(a.datasheet_id, (m = new Map()));
    if (!m.has(norm(a.name))) {
      m.set(norm(a.name), {
        name: a.name,
        rule: {
          src_type: a.type ?? null,
          parameter: a.parameter ?? null,
          phases: a.phases ?? null,
          description: a.description ?? "",
        },
      });
    }
  }

  // Faction- and detachment-scoped rules (no datasheet). Each carries a
  // normalized name, faction code, and the source rule. `srcType` distinguishes
  // the two archive files for provenance.
  type FactionRule = { norm: string; code: string; rule: Omit<SourceRule, "datasheet_id"> };
  const factionRules: FactionRule[] = [];
  const pushFactionRules = (file: string, srcType: string): void => {
    let rows: Json[];
    try { rows = readJSON(resolve(ARCHIVE, file)); } catch { return; }
    for (const r of rows) {
      if (!r.name) continue;
      factionRules.push({
        norm: norm(r.name),
        code: r.faction_id ?? "",
        rule: { src_type: srcType, parameter: r.parameter ?? null, phases: r.phases ?? null, description: r.description ?? "" },
      });
    }
  };
  pushFactionRules("Abilities.json", "Faction");
  pushFactionRules("Detachment_abilities.json", "Detachment");

  // Match by exact normalized name OR the archive's faction-prefixed form
  // ("deathwatch mission tactics" matches "mission tactics").
  const nameMatches = (archiveNorm: string, queryNorm: string): boolean =>
    archiveNorm === queryNorm || archiveNorm.endsWith(` ${queryNorm}`);

  return {
    factionCode: (kebab) => FACTION_CODE_ALIAS[kebab] ?? codeByName.get(kebab.replace(/-/g, " ")),
    datasheetsFor: (unitName, code) => dsByNameCode.get(`${norm(unitName)}|${code}`) ?? [],
    ruleFor: (dsId, abilityName) => byDatasheet.get(dsId)?.get(norm(abilityName))?.rule,
    abilitiesFor: (dsId) =>
      Array.from(byDatasheet.get(dsId)?.values() ?? []).map((e) => [e.name, e.rule]),
    factionRuleFor: (code, abilityName) => {
      const q = norm(abilityName);
      // A rule with no description is useless for authoring — skip it so we
      // never hand the model empty source text (better to report unresolved).
      const hits = factionRules.filter((r) => nameMatches(r.norm, q) && r.rule.description.trim() !== "");
      if (hits.length === 0) return undefined;
      // Prefer a faction-code match; else only accept a globally-unique name so
      // we never silently bind to the wrong faction's same-named rule.
      const byCode = code ? hits.filter((r) => r.code === code) : [];
      if (byCode.length > 0) return byCode[0].rule;
      const exact = hits.filter((r) => r.norm === q);
      if (exact.length === 1) return exact[0].rule;
      return hits.length === 1 ? hits[0].rule : undefined;
    },
  };
}

/** Resolve the source rule for one stub via the unit→datasheet→ability chain. */
export function resolveSource(
  archive: ArchiveIndex,
  factionCode: string | undefined,
  unitNames: string[],
  abilityName: string,
): { src?: SourceRule; reason?: string } {
  if (!factionCode) return { reason: "no archive faction code for this faction" };
  // Faction/detachment-scoped rules have no unit to chain through — go straight
  // to the faction-rule fallback (Abilities.json / Detachment_abilities.json).
  if (unitNames.length === 0) {
    const fr = archive.factionRuleFor(factionCode, abilityName);
    if (fr) return { src: { datasheet_id: "", ...fr } };
    return { reason: "ability has no unit_ids and no matching faction/detachment rule" };
  }
  const tried: string[] = [];
  for (const unitName of unitNames) {
    const dsIds = archive.datasheetsFor(unitName, factionCode);
    if (dsIds.length === 0) tried.push(`${unitName}:no-datasheet`);
    for (const dsId of dsIds) {
      const rule = archive.ruleFor(dsId, abilityName);
      if (rule) return { src: { datasheet_id: dsId, ...rule } };
    }
  }
  // Datasheet join found nothing — the ability may be a faction/detachment rule
  // surfaced on the unit (e.g. "Mission Tactics" on a Deathwatch kill team).
  const fr = archive.factionRuleFor(factionCode, abilityName);
  if (fr) return { src: { datasheet_id: "", ...fr } };
  return { reason: `no matching ability on faction datasheets (tried: ${tried.join(", ") || unitNames.join(", ")})` };
}

function buildFaction(faction: string, archive: ArchiveIndex): AuthorInputEntry[] {
  const code = archive.factionCode(faction);
  const unitsPath = resolve(CORE_ROOT, faction, "units.json");
  const unitName = new Map<string, string>();
  if (existsSync(unitsPath)) for (const u of readJSON(unitsPath) as Json[]) unitName.set(u.id, u.name);

  const abilitiesPath = resolve(ENRICHMENT_ROOT, faction, "abilities.json");
  if (!existsSync(abilitiesPath)) return [];
  const abilities: Json[] = readJSON(abilitiesPath);

  const out: AuthorInputEntry[] = [];
  for (const a of abilities) {
    if (!isStubEntry(a)) continue;
    const unitIds: string[] = a.unit_ids ?? [];
    const unitNames = unitIds.map((id) => unitName.get(id)).filter((n): n is string => !!n);
    const { src, reason } = resolveSource(archive, code, unitNames, a.name);
    out.push({
      faction,
      ability_id: a.ability_id,
      name: a.name,
      unit_ids: unitIds,
      target: (a.effect && typeof a.effect === "object" && a.effect.target) || null,
      scope: a.scope ?? null,
      faction_id: a.faction_id ?? null,
      ability_type: a.ability_type ?? null,
      resolved: !!src,
      ...(src ? { src } : { reason }),
    });
  }
  return out;
}

function main(): void {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx tools/src/author-input.ts <faction|--all>");
    process.exit(1);
  }
  const archive = loadArchive();
  const factions =
    arg === "--all"
      ? readdirSync(ENRICHMENT_ROOT, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name !== "_example")
          .map((e) => e.name)
      : [arg];

  mkdirSync(OUT_DIR, { recursive: true });
  let totalStubs = 0;
  let totalResolved = 0;
  for (const faction of factions) {
    const entries = buildFaction(faction, archive);
    if (entries.length === 0) continue;
    const resolved = entries.filter((e) => e.resolved).length;
    totalStubs += entries.length;
    totalResolved += resolved;
    writeFileSync(resolve(OUT_DIR, `${faction}.json`), JSON.stringify(entries, null, 2) + "\n");
    console.log(`  ${faction}: ${entries.length} stubs, ${resolved} source-resolved`);
  }
  console.log(`\n${totalStubs} stubs total, ${totalResolved} resolved (${Math.round((100 * totalResolved) / Math.max(1, totalStubs))}%). → ${OUT_DIR}`);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main();
