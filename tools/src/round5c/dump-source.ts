import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { type AbilityRow, type AbilityRowKind, CORE_FACTION, type DumpProse, loadDumpProse, type OwnerQuery, type ProseQuery } from "../mfm/dump-prose.js";
import { DEFAULT_DUMP_PATH } from "../mfm/loader.js";
import { assembleStoreSource } from "../mfm/store-source.js";
import { hashJson } from "../round4/hash.js";
import { round5cDataRoot } from "./entries.js";
import type { SkippedSourceRecord, SourceConflict, SourceLoadReport, SourceRecord } from "./source.js";

/**
 * Source prose for the workbench, read from the GW MFM dump through the faction-safe
 * {@link DumpProse} lookups. The abilities are the repo's enrichment records; each is looked up
 * among the rows its own owners print: the units it is on (pinned to their datasheets by the
 * units' `mfm` references), its detachment (pinned the same way), the faction's army rules, or
 * the core rules. An ability whose owners print two different texts (a Combat Patrol datasheet
 * and a codex one) is a conflict, not a guess.
 */

type EnrichmentAbility = {
  ability_id?: unknown;
  name?: unknown;
  ability_type?: unknown;
  unit_ids?: unknown;
  detachment_id?: unknown;
  game_version?: unknown;
};

type CoreRecord = { id?: unknown; external_refs?: unknown; ability_ids?: unknown };

export type DumpSourceOptions = {
  /** The repo data root (`data/`), for enrichment abilities and core owner records. */
  dataRoot?: string;
  dumpPath?: string;
  /** The prose index; loaded from `dumpPath` when absent. */
  prose?: DumpProse;
};

const DETACHMENT_KINDS: Record<string, readonly AbilityRowKind[]> = {
  stratagem: ["stratagem"],
  enhancement: ["enhancement"],
  detachment: ["detachment-rule", "rule-section", "menu-option"],
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function readArray<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function mfmIds(record: CoreRecord): string[] {
  if (!Array.isArray(record.external_refs)) return [];
  return record.external_refs.flatMap((ref) => (ref && typeof ref === "object" && (ref as Record<string, unknown>).namespace === "mfm" && typeof (ref as Record<string, unknown>).id === "string" ? [(ref as Record<string, string>).id] : []));
}

/** Core records of one kind across every faction dir: id → the faction dirs holding it and their dump ids. */
function coreIndex(dataRoot: string, file: string): Map<string, Array<{ faction: string; mfm: string[] }>> {
  const index = new Map<string, Array<{ faction: string; mfm: string[] }>>();
  const coreRoot = join(dataRoot, "core");
  if (!existsSync(coreRoot)) return index;
  for (const faction of readdirSync(coreRoot).sort()) {
    for (const record of readArray<CoreRecord>(join(coreRoot, faction, file))) {
      if (typeof record.id !== "string") continue;
      index.set(record.id, [...(index.get(record.id) ?? []), { faction, mfm: mfmIds(record) }]);
    }
  }
  return index;
}

/**
 * The factions whose rows each datasheet or detachment prints. A supplement's datasheet prints
 * under the supplement's faction (D7) even while the repo files the unit under its parent; a
 * unit pinned to its own datasheet ids is looked up wherever those datasheets print.
 */
function printingFactions(prose: DumpProse): Map<string, Set<string>> {
  const factions = new Map<string, Set<string>>();
  for (const row of prose.rows) {
    if (row.owner.kind !== "datasheet" && row.owner.kind !== "detachment") continue;
    const set = factions.get(row.owner.id) ?? new Set<string>();
    set.add(row.faction);
    factions.set(row.owner.id, set);
  }
  return factions;
}

/** `<faction>\u0000<ability id>` → the faction's units whose core record lists the ability. */
function unitsListing(dataRoot: string): Map<string, string[]> {
  const listing = new Map<string, string[]>();
  const coreRoot = join(dataRoot, "core");
  if (!existsSync(coreRoot)) return listing;
  for (const faction of readdirSync(coreRoot).sort()) {
    for (const unit of readArray<CoreRecord>(join(coreRoot, faction, "units.json"))) {
      if (typeof unit.id !== "string") continue;
      for (const abilityId of strings(unit.ability_ids)) {
        const key = `${faction}\u0000${abilityId}`;
        listing.set(key, [...(listing.get(key) ?? []), unit.id]);
      }
    }
  }
  return listing;
}

type Indexes = {
  listing: Map<string, string[]>;
  units: Map<string, Array<{ faction: string; mfm: string[] }>>;
  detachments: Map<string, Array<{ faction: string; mfm: string[] }>>;
  printing: Map<string, Set<string>>;
};

/** The query's factions: its own, and every faction that prints one of the pinned dump ids. */
function withPrinting(factions: readonly string[], pinned: readonly string[], printing: Indexes["printing"]): string[] {
  return [...new Set([...factions, ...pinned.flatMap((id) => [...(printing.get(id) ?? [])])])];
}

/** The (faction, owner) queries an enrichment ability's prose is looked up under, most specific first. */
function ownerQueries(faction: string, abilityId: string, ability: EnrichmentAbility, { listing, units, detachments, printing }: Indexes): Array<Omit<ProseQuery, "ability">> {
  const type = text(ability.ability_type);
  if (faction === CORE_FACTION) return [{ faction: CORE_FACTION, owner: { kind: "core" } }];
  const detachment = text(ability.detachment_id);
  if (detachment && type && DETACHMENT_KINDS[type]) {
    const homes = (detachments.get(detachment) ?? []).filter((home) => home.faction === faction);
    const detachmentIds = homes.flatMap((home) => home.mfm);
    const owner: OwnerQuery = detachmentIds.length ? { kind: "detachment", id: detachment, detachmentIds } : { kind: "detachment", id: detachment };
    return [{ faction: withPrinting([faction], detachmentIds, printing), owner, kinds: DETACHMENT_KINDS[type] }];
  }
  // The units the enrichment record names, and the units whose own record lists the ability.
  const unitIds = [...new Set([...strings(ability.unit_ids), ...(listing.get(`${faction}\u0000${abilityId}`) ?? [])])];
  if (unitIds.length) {
    return unitIds.map((unit) => {
      const homes = units.get(unit) ?? [];
      const local = homes.filter((home) => home.faction === faction);
      // A shared unit lives in its parent's dir; its rows print under either faction.
      const pinned = (local.length ? local : homes).flatMap((home) => home.mfm);
      const factions = [...new Set([faction, ...(local.length ? [] : homes.map((home) => home.faction))])];
      const owner: OwnerQuery = pinned.length ? { kind: "unit", id: unit, datasheetIds: pinned } : { kind: "unit", id: unit };
      return { faction: withPrinting(factions, pinned, printing), owner };
    });
  }
  // Faction rules, and the few records with no owner of their own: the army rules; a core
  // stratagem or core ability outside `_core` is still a core rule.
  // A Combat Patrol prints its own army rules, which are their own records (D10); the repo's
  // faction rule is the codex one.
  const army: Omit<ProseQuery, "ability"> = { faction, owner: { kind: "army" }, combatPatrol: false };
  return type === "stratagem" || type === "core" ? [{ faction: CORE_FACTION, owner: { kind: "core" } }, army] : [army];
}

/** A row's prose as the workbench stores it: a stratagem keeps its WHEN/TARGET/EFFECT/RESTRICTIONS fragments. */
function rowSource(row: AbilityRow): ReturnType<typeof assembleStoreSource> {
  if (row.kind === "stratagem" && row.stratagem) {
    const { when, target, effect, secondaryEffect, restrictions } = row.stratagem;
    // A secondary effect is printed as part of the card's effect.
    const fullEffect = [effect, secondaryEffect].filter(Boolean).join("\n") || undefined;
    return assembleStoreSource({ when, target, effect: fullEffect, restrictions });
  }
  return row.text ? assembleStoreSource({ raw_text: row.text }) : null;
}

type Identity = { faction: string; file: string; row: number; ability: EnrichmentAbility };

/**
 * The abilities the workbench reviews: every enrichment ability record, then every core
 * stratagem, enhancement and detachment rule that has no enrichment record yet (keyed by
 * `ability_id ?? id`), typed and owned by its detachment. `data/core/stratagems.json` holds the core stratagems.
 */
function identities(dataRoot: string): Identity[] {
  const out: Identity[] = [];
  const seen = new Set<string>();
  const add = (faction: string, file: string, row: number, ability: EnrichmentAbility): void => {
    const id = text(ability.ability_id);
    if (id) {
      if (seen.has(`${faction}\u0000${id}`)) return;
      seen.add(`${faction}\u0000${id}`);
    }
    out.push({ faction, file, row, ability });
  };
  const dirs = (root: string): string[] => (existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && (!entry.name.startsWith("_") || entry.name === CORE_FACTION)).map((entry) => entry.name).sort() : []);
  const enrichmentRoot = join(dataRoot, "enrichment");
  for (const faction of dirs(enrichmentRoot)) {
    readArray<EnrichmentAbility>(join(enrichmentRoot, faction, "abilities.json")).forEach((ability, index) => add(faction, `enrichment/${faction}/abilities.json`, index + 1, ability));
  }
  type CoreRule = { id?: unknown; name?: unknown; ability_id?: unknown; detachment_id?: unknown; detachment_rule_id?: unknown; detachment_rule_ids?: unknown; game_version?: unknown };
  const coreRoot = join(dataRoot, "core");
  readArray<CoreRule>(join(coreRoot, "stratagems.json")).forEach((item, index) => add(CORE_FACTION, "core/stratagems.json", index + 1, { ability_id: item.ability_id ?? item.id, name: item.name, ability_type: "stratagem", game_version: item.game_version }));
  for (const faction of dirs(coreRoot)) {
    for (const [file, type] of [["stratagems.json", "stratagem"], ["enhancements.json", "enhancement"]] as const) {
      readArray<CoreRule>(join(coreRoot, faction, file)).forEach((item, index) => add(faction, `core/${faction}/${file}`, index + 1, { ability_id: item.ability_id ?? item.id, name: item.name, ability_type: type, detachment_id: item.detachment_id, game_version: item.game_version }));
    }
    readArray<CoreRule>(join(coreRoot, faction, "detachments.json")).forEach((detachment, index) => {
      for (const rule of new Set([...strings([detachment.detachment_rule_id]), ...strings(detachment.detachment_rule_ids)])) {
        add(faction, `core/${faction}/detachments.json`, index + 1, { ability_id: rule, ability_type: "detachment", detachment_id: detachment.id, game_version: detachment.game_version });
      }
    });
  }
  return out;
}

/** Every repo ability (enrichment records, and core stratagems, enhancements and detachment rules) with the dump prose its owners print. */
export function loadDumpSourceRecords(options: DumpSourceOptions = {}): SourceLoadReport {
  const dataRoot = resolve(options.dataRoot ?? round5cDataRoot());
  const dumpPath = options.dumpPath ?? DEFAULT_DUMP_PATH;
  const prose = options.prose ?? loadDumpProse(dumpPath);
  const indexes: Indexes = { listing: unitsListing(dataRoot), units: coreIndex(dataRoot, "units.json"), detachments: coreIndex(dataRoot, "detachments.json"), printing: printingFactions(prose) };
  const records: SourceRecord[] = [];
  const skipped: SkippedSourceRecord[] = [];
  const conflicts: SourceConflict[] = [];
  {
    for (const { faction, file, row, ability } of identities(dataRoot)) {
      const abilityId = text(ability.ability_id);
      if (!abilityId) {
        skipped.push({ file, row, reason: "missing-identity", factionId: faction });
        continue;
      }
      // One text per distinct assembled source, with every row that prints it.
      const variants = new Map<string, { source: NonNullable<ReturnType<typeof assembleStoreSource>>; rows: AbilityRow[] }>();
      for (const query of ownerQueries(faction, abilityId, ability, indexes)) {
        for (const variant of prose.variants({ ...query, ability: abilityId })) {
          for (const candidate of variant.rows) {
            const source = rowSource(candidate);
            if (!source) continue;
            const existing = variants.get(source.text);
            if (existing) {
              if (!existing.rows.includes(candidate)) existing.rows.push(candidate);
            } else variants.set(source.text, { source, rows: [candidate] });
          }
        }
      }
      if (variants.size === 0) {
        skipped.push({ file, row, reason: "missing-prose", factionId: faction, abilityId });
        continue;
      }
      if (variants.size > 1) {
        const all = [...variants.values()];
        conflicts.push({
          factionId: faction,
          abilityId,
          sourceHashes: all.map((variant) => hashJson({ text: variant.source.text })),
          locations: all.flatMap((variant) => variant.rows.map((item) => ({ file: item.ref, row }))),
        });
        continue;
      }
      const [{ source, rows }] = [...variants.values()];
      records.push({
        factionId: faction,
        abilityId,
        sourceHash: hashJson({ text: source.text }),
        text: source.text,
        fragments: source.fragments,
        sourceType: text(ability.ability_type),
        sourceKind: "mfm",
        name: rows[0]!.name,
        metadata: {
          game_version: ability.game_version ?? null,
          source: { kind: "mfm", refs: rows.map((item) => item.ref), publication: rows[0]!.publication?.name ?? null },
        },
      });
    }
  }
  records.sort((left, right) => `${left.factionId}\u0000${left.abilityId}`.localeCompare(`${right.factionId}\u0000${right.abilityId}`));
  return { origin: `dump:${dumpPath}`, records, skipped, conflicts };
}
