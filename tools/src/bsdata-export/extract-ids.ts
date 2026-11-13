/**
 * Builds the committed BSData id map (`bsdata-ids.json`) and format descriptor
 * (`format.json`) from a BSData wh40k-11e checkout, so the exporter can reuse
 * BSData's ids without the checkout at export time.
 *
 * Matching is by name within a faction's catalogue and the catalogues it links,
 * preferring the faction's own catalogue. Only names, ids, types and costs are
 * read; no rule text is copied.
 *
 *   npx tsx src/bsdata-export/extract-ids.ts [--bsdata <dir>] [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Dataset } from "../data/dataset.js";
import { nameToId } from "../converters/id-generator.js";
import { deriveFormat } from "./format.js";
import {
  catalogueClosure,
  children,
  FACTION_CATALOGUE_FILES,
  GAME_SYSTEM_FILE,
  loadBsdataDir,
  str,
  walk,
  type BsDocument,
  type BsNode,
} from "./source.js";
import { stableJson } from "./json.js";

export interface ProfileTypeIds {
  readonly id: string;
  readonly characteristics: Readonly<Record<string, string>>;
}

export interface BsdataIds {
  readonly gameSystem: { readonly id: string; readonly name: string; readonly revision: number };
  readonly system: {
    readonly costTypes: Readonly<Record<string, string>>;
    readonly profileTypes: Readonly<Record<string, ProfileTypeIds>>;
    readonly forces: Readonly<Record<string, string>>;
    readonly categories: Readonly<Record<string, string>>;
    readonly entries: Readonly<Record<string, string>>;
  };
  readonly catalogues: Readonly<Record<string, { readonly file: string; readonly id: string; readonly name: string }>>;
  readonly categories: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly units: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly weapons: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly detachments: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly enhancements: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly factionEntries: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const IDS_PATH = path.join(HERE, "bsdata-ids.json");
export const FORMAT_PATH = path.join(HERE, "format.json");

const SYSTEM_COST_TYPES = ["pts", "Detachment Points", "Enhancements"];
const SYSTEM_PROFILE_TYPES = ["Unit", "Ranged Weapons", "Melee Weapons", "Abilities", "Transport"];

/** Name key for matching: legends suffix dropped, slugged. */
export function matchKey(name: string): string | null {
  const bare = name.replace(/\s*\[Legends\]\s*$/i, "").trim();
  try {
    return nameToId(bare);
  } catch {
    return null;
  }
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`BSData checkout lacks ${what}`);
  return value;
}

function byName(nodes: readonly BsNode[], name: string, what: string): BsNode {
  return required(nodes.find((node) => str(node, "name") === name), `${what} "${name}"`);
}

function costValue(node: BsNode, typeId: string): number | undefined {
  const cost = children(node, "costs").find((c) => str(c, "typeId") === typeId);
  return typeof cost?.value === "number" ? cost.value : undefined;
}

function hasWeaponProfile(node: BsNode, weaponTypeIds: ReadonlySet<string>): boolean {
  return children(node, "profiles").some((profile) => weaponTypeIds.has(str(profile, "typeId") ?? ""));
}

function systemIds(gst: BsNode): BsdataIds["system"] {
  const costTypes = Object.fromEntries(
    SYSTEM_COST_TYPES.map((name) => [name, str(byName(children(gst, "costTypes"), name, "cost type"), "id")!]),
  );
  const profileTypes = Object.fromEntries(
    SYSTEM_PROFILE_TYPES.map((name) => {
      const type = byName(children(gst, "profileTypes"), name, "profile type");
      return [
        name,
        {
          id: str(type, "id")!,
          characteristics: Object.fromEntries(
            children(type, "characteristicTypes").map((c) => [str(c, "name")!, str(c, "id")!]),
          ),
        },
      ];
    }),
  );
  const armyRoster = byName(children(gst, "forceEntries"), "Army Roster", "force entry");
  const categories = Object.fromEntries(
    children(gst, "categoryEntries").map((c) => [str(c, "name")!, str(c, "id")!]),
  );
  const shared = children(gst, "sharedSelectionEntries");
  const sharedGroups = children(gst, "sharedSelectionEntryGroups");
  const links = children(gst, "entryLinks");
  const entries: Record<string, string> = {};
  const battleSize = byName(shared, "Battle Size", "shared entry");
  entries["Battle Size"] = str(battleSize, "id")!;
  entries["Battle Size link"] = str(byName(links, "Battle Size", "root link"), "id")!;
  const sizeGroup = byName(children(battleSize, "selectionEntryGroups"), "Battle Size", "group");
  entries["Battle Size group"] = str(sizeGroup, "id")!;
  for (const option of children(sizeGroup, "selectionEntries")) {
    const size = /Incursion|Strike Force|Onslaught/.exec(str(option, "name") ?? "")?.[0];
    if (size) entries[size] = str(option, "id")!;
  }
  entries["Show Legends"] = str(byName(shared, "Show Legends", "shared entry"), "id")!;
  const disposition = byName(shared, "Force Disposition", "shared entry");
  entries["Force Disposition"] = str(disposition, "id")!;
  entries["Force Disposition link"] = str(byName(links, "Force Disposition", "root link"), "id")!;
  const dispositionGroup = byName(sharedGroups, "Force Disposition", "shared group");
  entries["Force Disposition group"] = str(dispositionGroup, "id")!;
  for (const option of children(dispositionGroup, "selectionEntries")) {
    entries[`Force Disposition: ${str(option, "name")!}`] = str(option, "id")!;
  }
  for (const constraint of children(armyRoster, "constraints")) {
    const field = str(constraint, "field");
    const costName = Object.entries(costTypes).find(([, id]) => id === field)?.[0];
    if (costName) entries[`Army Roster limit: ${costName}`] = str(constraint, "id")!;
  }
  return { costTypes, profileTypes, forces: { "Army Roster": str(armyRoster, "id")! }, categories, entries };
}

interface Candidate {
  readonly key: string;
  readonly id: string;
  readonly node: BsNode;
  readonly ancestors: readonly BsNode[];
  readonly shared: boolean;
  readonly rank: number;
}

/** Top-level and nested selection entries across a closure, ranked own catalogue first, shared before nested. */
function entryCandidates(closure: readonly BsDocument[]): Candidate[] {
  const out: Candidate[] = [];
  closure.forEach((doc, rank) => {
    for (const visit of walk(doc.root, doc.kind)) {
      if (visit.kind !== "selectionEntry") continue;
      const name = str(visit.node, "name");
      const id = str(visit.node, "id");
      const key = name ? matchKey(name) : null;
      if (!key || !id) continue;
      const shared = visit.ancestors.length === 1;
      out.push({ key, id, node: visit.node, ancestors: visit.ancestors, shared, rank });
    }
  });
  return out.sort((a, b) => a.rank - b.rank || Number(b.shared) - Number(a.shared));
}

function pick(candidates: readonly Candidate[], key: string, accept: (c: Candidate) => boolean): Candidate | undefined {
  return candidates.find((c) => c.key === key && accept(c));
}

function mentions(node: BsNode, id: string): boolean {
  return JSON.stringify(node).includes(`"childId":"${id}"`);
}

export function extractIds(documents: readonly BsDocument[], dataset: Dataset): BsdataIds {
  const gstDoc = required(documents.find((doc) => doc.file === GAME_SYSTEM_FILE), GAME_SYSTEM_FILE);
  const gst = gstDoc.root;
  const system = systemIds(gst);
  const weaponTypeIds = new Set([
    system.profileTypes["Ranged Weapons"].id,
    system.profileTypes["Melee Weapons"].id,
  ]);
  const dpType = system.costTypes["Detachment Points"];
  const enhancementType = system.costTypes.Enhancements;

  const catalogues: Record<string, { file: string; id: string; name: string }> = {};
  const categories: Record<string, Record<string, string>> = {};
  const units: Record<string, Record<string, string>> = {};
  const weapons: Record<string, Record<string, string>> = {};
  const detachments: Record<string, Record<string, string>> = {};
  const enhancements: Record<string, Record<string, string>> = {};
  const factionEntries: Record<string, Record<string, string>> = {};

  for (const [factionId, file] of Object.entries(FACTION_CATALOGUE_FILES)) {
    const closure = catalogueClosure(documents, file);
    const own = closure[0];
    catalogues[factionId] = { file, id: str(own.root, "id")!, name: str(own.root, "name")! };

    const cats: Record<string, string> = {};
    for (const doc of [...closure].reverse()) {
      for (const c of children(doc.root, "categoryEntries")) cats[str(c, "name")!] = str(c, "id")!;
    }
    categories[factionId] = cats;

    // Child factions (Space Marine chapters) file their units and weapons under
    // the parent, so the parent's matches search every child catalogue too.
    const childClosures = Object.entries(FACTION_CATALOGUE_FILES)
      .filter(([childId]) => dataset.factions.get(childId)?.raw.parent_faction_id === factionId)
      .flatMap(([, childFile]) => catalogueClosure(documents, childFile));
    const candidates = entryCandidates([...new Set([...closure, ...childClosures])]);
    const isUnit = (c: Candidate): boolean => {
      const type = str(c.node, "type");
      return c.shared && (type === "unit" || type === "model");
    };
    const unitMap: Record<string, string> = {};
    for (const unit of dataset.units.byFaction(factionId)) {
      const key = matchKey(unit.name);
      const hit = key ? pick(candidates, key, isUnit) : undefined;
      if (hit) unitMap[unit.id] = hit.id;
    }
    units[factionId] = unitMap;

    const weaponMap: Record<string, string> = {};
    for (const weapon of dataset.weapons.byFaction(factionId)) {
      const key = matchKey(weapon.name);
      const hit = key
        ? pick(candidates, key, (c) => str(c.node, "type") === "upgrade" && hasWeaponProfile(c.node, weaponTypeIds))
        : undefined;
      if (hit) weaponMap[weapon.id] = hit.id;
    }
    weapons[factionId] = weaponMap;

    const detachmentMap: Record<string, string> = {};
    for (const detachment of dataset.detachments.byFaction(factionId)) {
      const key = matchKey(detachment.name);
      const hit = key ? pick(candidates, key, (c) => (costValue(c.node, dpType) ?? 0) > 0) : undefined;
      if (hit) detachmentMap[detachment.id] = hit.id;
    }
    detachments[factionId] = detachmentMap;

    const enhancementMap: Record<string, string> = {};
    for (const detachment of dataset.detachments.byFaction(factionId)) {
      const detachmentBsId = detachmentMap[detachment.id];
      for (const enhancementId of detachment.enhancement_ids ?? []) {
        const enhancement = dataset.enhancements.get(enhancementId);
        const key = enhancement ? matchKey(enhancement.name) : null;
        if (!enhancement || !key) continue;
        const named = candidates.filter((c) => c.key === key && costValue(c.node, enhancementType) === 1);
        const tied = detachmentBsId
          ? named.filter((c) => [c.node, ...c.ancestors].some((n) => mentions(n, detachmentBsId) && n !== c.ancestors[0]))
          : [];
        const hit = tied.length === 1 ? tied[0] : named.length === 1 ? named[0] : undefined;
        if (hit) enhancementMap[enhancement.id] = hit.id;
      }
    }
    enhancements[factionId] = enhancementMap;

    const entries: Record<string, string> = {};
    for (const doc of closure) {
      for (const entry of children(doc.root, "sharedSelectionEntries")) {
        const name = str(entry, "name");
        if ((name === "Detachment" || name === "Warlord") && !entries[name]) entries[name] = str(entry, "id")!;
      }
    }
    factionEntries[factionId] = entries;
  }

  return {
    gameSystem: {
      id: str(gst, "id")!,
      name: str(gst, "name")!,
      revision: required(typeof gst.revision === "number" ? gst.revision : undefined, "game system revision"),
    },
    system,
    catalogues,
    categories,
    units,
    weapons,
    detachments,
    enhancements,
    factionEntries,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf("--bsdata");
  const dir = path.resolve(
    path.join(HERE, "..", "..", ".."),
    dirFlag >= 0 ? args[dirFlag + 1] : "_private/bsdata-wh40k-11e",
  );
  const documents = loadBsdataDir(dir);
  const ids = stableJson(extractIds(documents, Dataset.embedded()));
  const format = stableJson(deriveFormat(documents.map((doc) => [doc.kind, doc.root] as const)));
  if (args.includes("--check")) {
    const stale = [
      [IDS_PATH, ids],
      [FORMAT_PATH, format],
    ].filter(([file, text]) => readFileSync(file, "utf8") !== text);
    for (const [file] of stale) console.error(`stale: ${path.relative(process.cwd(), file)}`);
    process.exitCode = stale.length > 0 ? 1 : 0;
    return;
  }
  writeFileSync(IDS_PATH, ids);
  writeFileSync(FORMAT_PATH, format);
  console.log(`wrote ${path.relative(process.cwd(), IDS_PATH)} and ${path.relative(process.cwd(), FORMAT_PATH)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
