/**
 * author:reconcile — deterministically back-link core entities to the community
 * abilities they were authored from, so the downstream lookup contract
 *
 *     raw-text-store[ entity.ability_id ?? entity.id ]   (and abilities.json[id])
 *
 * resolves for EVERY stratagem / enhancement / unit-ability / detachment-rule.
 *
 * Why this exists: core entities (stratagems/enhancements/units/detachments) and
 * the enrichment `abilities.json` were produced by independent pipelines, so their
 * ids diverge — the abilities pipeline disambiguates same-named rules across
 * detachments with a short tag (`flawless-construction-solar-spearhead`) that the
 * bare core id (`flawless-construction`) lacks. The app's join then misses. This
 * tool reconciles the two by populating the link fields the schema already carries.
 *
 * Pure and non-agentic — the project's structural-correctness rule (the model
 * never touches data structure). TS matches by (ability_type, detachment_id,
 * base-name) and inverse `unit_ids` index; no model, no rules text.
 *
 * What it writes (only fills null / additively merges; never clobbers a non-null
 * value unless --force):
 *   - stratagem.ability_id        <- abilities[type=stratagem]   by (detachment_id, base-name)
 *   - enhancement.ability_id      <- abilities[type=enhancement] by (detachment_id, base-name)
 *   - unit.ability_ids            <- union with the inverse index from abilities.unit_ids
 *   - detachment.detachment_rule_ids <- ALL abilities[type=detachment] for that detachment_id
 *
 * Single-id guarantee: it never invents a *new* id mapping — it points the core
 * entity's existing `ability_id` link field at the canonical abilities id, so all
 * three sources (core / abilities.json / raw-text store) agree on one key. New
 * entities seeded by `author:seed-core` already get `id == ability_id`, so there
 * is nothing to reconcile for those; this is the retroactive pass for legacy data.
 *
 * Reports orphans both directions (neither is auto-fixed here):
 *   - core entity with no matching ability  -> the ability still needs AUTHORING
 *   - ability with no matching core entity   -> the core entity needs SEEDING (author:seed-core)
 *
 * Usage:
 *   npx tsx tools/src/author-reconcile.ts <faction>... [--dry-run] [--force] [--json]
 *   npx tsx tools/src/author-reconcile.ts --all [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { kebab } from "./author-seed.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const CORE_ROOT = resolve(DATA_ROOT, "core");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));
const writeJSON = (p: string, v: Json): void => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

/**
 * Match key for a stratagem/enhancement: its owning detachment plus the rule's
 * "base" name — the name with any disambiguating parenthetical stripped, kebabed.
 * So core "FLAWLESS CONSTRUCTION" and ability "Flawless Construction (Solar
 * Spearhead)" both reduce to `flawless-construction`, and the detachment_id
 * separates the per-detachment variants.
 */
const baseName = (name: string): string => kebab(String(name ?? "").replace(/\([^)]*\)/g, " "));
const matchKey = (detachmentId: string | null | undefined, name: string): string =>
  `${detachmentId ?? ""}::${baseName(name)}`;
const versionKey = (entry: Json): string =>
  `${entry.game_version?.edition ?? ""}::${entry.game_version?.dataslate ?? ""}`;
const scopedKey = (entry: Json, key: string): string => `${versionKey(entry)}::${key}`;

function addToIndex<T>(index: Map<string, T[]>, key: string, value: T): void {
  const values = index.get(key);
  if (values) values.push(value);
  else index.set(key, [value]);
}

function detachmentRuleIds(
  exactRules: string[] | undefined,
  fallbackRules: string[] | undefined,
): string[] {
  const exact = [...new Set(exactRules ?? [])].sort();
  if (exact.length > 0) return exact;

  const fallback = [...new Set(fallbackRules ?? [])];
  return fallback.length === 1 ? fallback : [];
}

export interface ReconcileReport {
  faction: string;
  stratagems: { linked: number; alreadyLinked: number; orphanCore: string[]; collisions: string[] };
  enhancements: { linked: number; alreadyLinked: number; orphanCore: string[]; collisions: string[] };
  units: { abilityLinksAdded: number; unitsTouched: number; orphanAbilityUnits: string[] };
  detachments: { ruleIdsSet: number; multiRule: { detachment_id: string; ability_ids: string[] }[]; orphanCore: string[] };
  /** abilities with no core entity to attach to → author:seed-core candidates. */
  missingCoreEntities: { ability_id: string; ability_type: string; detachment_id: string | null; name: string }[];
}

interface CoreFiles {
  units?: Json[];
  stratagems?: Json[];
  enhancements?: Json[];
  detachments?: Json[];
}

function loadCore(faction: string): { files: CoreFiles; paths: Record<string, string> } {
  const files: CoreFiles = {};
  const paths: Record<string, string> = {};
  for (const n of ["units", "stratagems", "enhancements", "detachments"] as const) {
    const p = resolve(CORE_ROOT, faction, `${n}.json`);
    if (existsSync(p)) {
      files[n] = readJSON(p);
      paths[n] = p;
    }
  }
  return { files, paths };
}

/** Pure core: reconcile one faction's core entities against its abilities. Mutates `core` in place. */
export function reconcileFaction(faction: string, core: CoreFiles, abilities: Json[], force = false): ReconcileReport {
  const report: ReconcileReport = {
    faction,
    stratagems: { linked: 0, alreadyLinked: 0, orphanCore: [], collisions: [] },
    enhancements: { linked: 0, alreadyLinked: 0, orphanCore: [], collisions: [] },
    units: { abilityLinksAdded: 0, unitsTouched: 0, orphanAbilityUnits: [] },
    detachments: { ruleIdsSet: 0, multiRule: [], orphanCore: [] },
    missingCoreEntities: [],
  };

  // ── Build ability indexes ────────────────────────────────────────────
  // Entity identity is snapshot-scoped: historical and current rules may share
  // the same detachment and display name without both attaching to today's core.
  const byKey = new Map<string, Json[]>();
  const abilityById = new Map<string, Json>(abilities.map((ability) => [ability.ability_id, ability]));
  const usedAbilityIds = new Set<string>(); // abilities matched to a core entity
  const unitToAbilities = new Map<string, string[]>(); // unit_id → ability ids across snapshots
  const detachmentRules = new Map<string, string[]>(); // snapshot + detachment_id → rule ability ids
  const allDetachmentRules = new Map<string, string[]>(); // detachment_id → rule ability ids across snapshots
  for (const a of abilities) {
    if (a.ability_type === "stratagem" || a.ability_type === "enhancement") {
      const key = `${a.ability_type}|${scopedKey(a, matchKey(a.detachment_id, a.name))}`;
      addToIndex(byKey, key, a);
    }
    if (a.ability_type === "detachment" && a.detachment_id) {
      addToIndex(detachmentRules, scopedKey(a, a.detachment_id), a.ability_id);
      addToIndex(allDetachmentRules, a.detachment_id, a.ability_id);
    }
    for (const unitId of a.unit_ids ?? []) {
      addToIndex(unitToAbilities, unitId, a.ability_id);
    }
  }

  // ── stratagems / enhancements: set ability_id by match ───────────────
  const linkByType = (entities: Json[] | undefined, type: "stratagem" | "enhancement", bucket: ReconcileReport["stratagems"]) => {
    for (const e of entities ?? []) {
      const matches = byKey.get(`${type}|${scopedKey(e, matchKey(e.detachment_id, e.name))}`) ?? [];
      if (matches.length === 0 && e.ability_id) {
        const linked = abilityById.get(e.ability_id);
        const isHistoricalIdentity = linked?.ability_type === type
          && linked.detachment_id === e.detachment_id
          && baseName(linked.name) === baseName(e.name);
        if (isHistoricalIdentity) {
          usedAbilityIds.add(e.ability_id);
          bucket.alreadyLinked++;
          continue;
        }
      }
      if (matches.length === 0) {
        bucket.orphanCore.push(e.id);
        continue;
      }
      if (matches.length > 1) {
        bucket.collisions.push(`${e.id} → [${matches.map((m) => m.ability_id).join(", ")}]`);
        continue;
      }
      const abilityId = matches[0].ability_id;
      usedAbilityIds.add(abilityId);
      if (e.ability_id === abilityId) bucket.alreadyLinked++;
      else if (e.ability_id == null || force) {
        e.ability_id = abilityId;
        bucket.linked++;
      } else {
        // already linked to a DIFFERENT id, no --force → treat as a collision to surface
        bucket.collisions.push(`${e.id} has ability_id=${e.ability_id} but match=${abilityId} (use --force to overwrite)`);
      }
    }
  };
  linkByType(core.stratagems, "stratagem", report.stratagems);
  linkByType(core.enhancements, "enhancement", report.enhancements);

  // ── units: additively union ability_ids from the inverse index ──────
  const coreUnitIds = new Set((core.units ?? []).map((u) => u.id));
  for (const u of core.units ?? []) {
    const want = unitToAbilities.get(u.id) ?? [];
    if (want.length === 0) continue;
    const have = new Set<string>(u.ability_ids ?? []);
    let added = 0;
    for (const id of want) {
      usedAbilityIds.add(id);
      if (!have.has(id)) {
        have.add(id);
        added++;
      }
    }
    if (added > 0) {
      u.ability_ids = [...have];
      report.units.abilityLinksAdded += added;
      report.units.unitsTouched++;
    }
  }
  // abilities pointing at a unit_id that doesn't exist in core → orphan
  for (const [unitId, ids] of unitToAbilities) {
    if (!coreUnitIds.has(unitId) && core.units) report.units.orphanAbilityUnits.push(`${unitId} (${ids.length} abilities)`);
  }

  // ── detachments: set detachment_rule_ids (plural) ───────────────────
  const coreDetIds = new Set((core.detachments ?? []).map((d) => d.id));
  const coreDetVersions = new Set((core.detachments ?? []).map((d) => scopedKey(d, d.id)));
  for (const d of core.detachments ?? []) {
    const rules = detachmentRuleIds(
      detachmentRules.get(scopedKey(d, d.id)),
      allDetachmentRules.get(d.id),
    );
    if (rules.length === 0) {
      report.detachments.orphanCore.push(d.id);
      continue;
    }
    rules.forEach((r) => usedAbilityIds.add(r));
    const singularRule = rules.length === 1 ? rules[0] : null;
    if (
      JSON.stringify(d.detachment_rule_ids ?? null) !== JSON.stringify(rules)
      || (d.detachment_rule_id ?? null) !== singularRule
    ) {
      d.detachment_rule_ids = rules;
      d.detachment_rule_id = singularRule;
      report.detachments.ruleIdsSet++;
    }
    if (rules.length > 1) report.detachments.multiRule.push({ detachment_id: d.id, ability_ids: rules });
  }

  // ── orphan abilities (need a core entity seeded) ─────────────────────
  for (const a of abilities) {
    if (!["stratagem", "enhancement", "detachment"].includes(a.ability_type)) continue;
    if (usedAbilityIds.has(a.ability_id)) continue;
    if (
      a.detachment_id
      && coreDetIds.has(a.detachment_id)
      && !coreDetVersions.has(scopedKey(a, a.detachment_id))
    ) continue; // historical rule for a detachment whose core record has moved to a newer snapshot
    // a detachment-rule whose detachment_id simply has no core detachment, or a
    // stratagem/enhancement that matched nothing → its core entity is missing.
    report.missingCoreEntities.push({
      ability_id: a.ability_id,
      ability_type: a.ability_type,
      detachment_id: a.detachment_id ?? null,
      name: a.name,
    });
  }

  return report;
}

function printReport(r: ReconcileReport): void {
  const L: string[] = [`\n══ ${r.faction} ══`];
  L.push(
    `  stratagems:   +${r.stratagems.linked} linked (${r.stratagems.alreadyLinked} already), ` +
      `${r.stratagems.orphanCore.length} core w/o ability, ${r.stratagems.collisions.length} collisions`,
  );
  L.push(
    `  enhancements: +${r.enhancements.linked} linked (${r.enhancements.alreadyLinked} already), ` +
      `${r.enhancements.orphanCore.length} core w/o ability, ${r.enhancements.collisions.length} collisions`,
  );
  L.push(`  units:        +${r.units.abilityLinksAdded} ability links across ${r.units.unitsTouched} units`);
  L.push(`  detachments:  ${r.detachments.ruleIdsSet} rule-id sets, ${r.detachments.multiRule.length} multi-rule, ${r.detachments.orphanCore.length} w/o rule`);
  L.push(`  → missing core entities (need author:seed-core): ${r.missingCoreEntities.length}`);
  if (r.stratagems.collisions.length) L.push(`    strat collisions: ${r.stratagems.collisions.join(" ; ")}`);
  if (r.enhancements.collisions.length) L.push(`    enh collisions: ${r.enhancements.collisions.join(" ; ")}`);
  if (r.detachments.multiRule.length) L.push(`    multi-rule: ${r.detachments.multiRule.map((m) => `${m.detachment_id}[${m.ability_ids.join(",")}]`).join(" ; ")}`);
  console.log(L.join("\n"));
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const asJson = args.includes("--json");
  let factions = args.filter((a) => !a.startsWith("--"));
  if (args.includes("--all")) {
    factions = readdirSync(ENRICHMENT_ROOT).filter((f) => existsSync(resolve(ENRICHMENT_ROOT, f, "abilities.json")));
  }
  if (factions.length === 0) {
    console.error("Usage: author-reconcile <faction>... [--dry-run] [--force] [--json] | --all");
    process.exit(1);
  }

  const reports: ReconcileReport[] = [];
  for (const faction of factions) {
    const abilitiesPath = resolve(ENRICHMENT_ROOT, faction, "abilities.json");
    if (!existsSync(abilitiesPath)) {
      console.error(`  ${faction}: no abilities.json — skipping`);
      continue;
    }
    const abilities: Json[] = readJSON(abilitiesPath);
    const { files, paths } = loadCore(faction);
    const r = reconcileFaction(faction, files, abilities, force);
    reports.push(r);
    if (!asJson) printReport(r);

    if (!dryRun) {
      for (const n of ["stratagems", "enhancements", "units", "detachments"] as const) {
        if (files[n] && paths[n]) writeJSON(paths[n], files[n]);
      }
    }
  }

  if (asJson) console.log(JSON.stringify(reports, null, 2));
  const totalMissing = reports.reduce((n, r) => n + r.missingCoreEntities.length, 0);
  // summary → stderr so `--json` stdout stays a clean parseable document.
  process.stderr.write(
    `\n${dryRun ? "[dry-run] " : ""}reconciled ${reports.length} faction(s). ` +
      `${totalMissing} abilities still need a core entity (author:seed-core).\n`,
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main();
