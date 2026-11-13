/**
 * Shared fixture for the BSData export tests that check army rules against
 * roster validation: the built catalogues, their unit entries and links, and
 * single-army roster specs for `validateRosterCore`.
 */
import { Dataset } from "../src/data/dataset.js";
import { validateRosterCore, type NormRoster, type RosterViolationCode } from "../src/data/roster-resolve.js";
import type { Detachment } from "../src/generated.js";
import { evaluateField, type EvalContext } from "../src/bsdata-export/evaluate.js";
import { buildExport } from "../src/bsdata-export/export.js";
import { BSDATA_IDS } from "../src/bsdata-export/ids.js";
import { children, str, type BsNode } from "../src/bsdata-export/source.js";

export const dataset = Dataset.embedded();
export const FACTIONS = Object.keys(BSDATA_IDS.catalogues);
const DP = BSDATA_IDS.system.costTypes["Detachment Points"];
export type Size = "incursion" | "strike-force";

export interface UnitEntry {
  readonly factionId: string;
  readonly unitId: string;
  readonly node: BsNode;
}

export interface ExportFixture {
  readonly catalogues: Map<string, BsNode>;
  readonly gst: BsNode;
  /** Unit entry id → its faction, unit id and entry node. */
  readonly entries: Map<string, UnitEntry>;
}

/**
 * A faction's catalogue with the content of the library it was split into, if any
 * (`libraries.ts`): its categories and shared entries alongside its own links.
 */
export function factionCatalogue(documents: readonly { file: string; document: BsNode }[], factionId: string): BsNode | undefined {
  const doc = documents.find((d) => d.file === BSDATA_IDS.catalogues[factionId].file);
  if (!doc) return undefined;
  const army = Object.values(doc.document)[0] as BsNode;
  const byId = new Map(documents.map((d) => Object.values(d.document)[0] as BsNode).map((c) => [str(c, "id")!, c]));
  const library = children(army, "catalogueLinks")
    .map((l) => byId.get(str(l, "targetId")!))
    .find((c) => c?.library === true && c.name === `${String(army.name)} Library`);
  if (!library) return army;
  const merged: BsNode = { ...army };
  for (const key of ["categoryEntries", "sharedSelectionEntries", "sharedSelectionEntryGroups", "sharedProfiles", "sharedRules", "sharedInfoGroups"]) {
    const all = [...children(army, key), ...children(library, key)];
    if (all.length > 0) merged[key] = all;
  }
  return merged;
}

export function loadExportFixture(): ExportFixture {
  const documents = buildExport({ version: "1.5.1", dataset });
  const gst = Object.values(documents[0].document)[0] as BsNode;
  const catalogues = new Map<string, BsNode>();
  const entries = new Map<string, UnitEntry>();
  for (const factionId of FACTIONS) {
    const catalogue = factionCatalogue(documents, factionId);
    if (!catalogue) continue;
    catalogues.set(factionId, catalogue);
    for (const node of children(catalogue, "sharedSelectionEntries")) {
      if (node.type !== "unit" && node.type !== "model") continue;
      const view = dataset.units.byFaction(factionId).find((u) => (u.raw.is_legend ? `${u.name} [Legends]` : u.name) === node.name);
      if (view) entries.set(str(node, "id")!, { factionId, unitId: view.id, node });
    }
  }
  return { catalogues, gst, entries };
}

export function rootFaction(factionId: string): string {
  return dataset.factions.get(factionId)?.raw.parent_faction_id ?? factionId;
}

export function sharedEntry(fx: ExportFixture, name: string): BsNode | undefined {
  return children(fx.gst, "sharedSelectionEntries").find((e) => e.name === name);
}

export function battleSizeId(fx: ExportFixture, size: Size): string {
  const group = children(sharedEntry(fx, "Battle Size")!, "selectionEntryGroups")[0];
  return str(children(group, "selectionEntries").find((o) => String(o.name).includes(size === "incursion" ? "Incursion" : "Strike Force"))!, "id")!;
}

export function detachmentOption(fx: ExportFixture, detachment: Detachment): BsNode {
  return children(fx.catalogues.get(rootFaction(detachment.faction_id))!, "sharedSelectionEntries").find(
    (e) => e.name === detachment.name && children(e, "costs").some((c) => str(c, "typeId") === DP),
  )!;
}

/** Unit links an army built from `host` offers: its own root list and, for a child faction, its parent's. */
export function unitLinks(fx: ExportFixture, host: string): { link: BsNode; entry: UnitEntry }[] {
  const lists = [fx.catalogues.get(host)!, ...(rootFaction(host) !== host ? [fx.catalogues.get(rootFaction(host))!] : [])];
  return lists.flatMap((c) =>
    children(c, "entryLinks")
      .map((link) => ({ link, entry: fx.entries.get(str(link, "targetId")!)! }))
      .filter(({ entry }) => entry !== undefined),
  );
}

/** A field on a linked node: the target's modifiers, then the link's. */
export function linkedField(target: BsNode, link: BsNode, entryId: string, field: string, base: number, ctx: EvalContext): number {
  const merged = { modifiers: [...children(target, "modifiers"), ...children(link, "modifiers")] };
  return evaluateField(merged, entryId, field, base, ctx);
}

export function evalContext(fx: ExportFixture, host: string, selected: readonly string[], size: Size = "strike-force"): EvalContext {
  return { modelCount: 1, earlierCopies: 0, primaryCatalogueId: str(fx.catalogues.get(host)!, "id")!, selected: new Set([battleSizeId(fx, size), ...selected]) };
}

export function roster(
  host: string,
  size: Size,
  detachmentIds: string[],
  units: (string | { unitId: string; isWarlord: boolean })[],
): NormRoster {
  return {
    factionId: host,
    battleSize: size,
    forceDisposition: null,
    detachmentIds,
    units: units.map((u) => {
      const { unitId, isWarlord } = typeof u === "string" ? { unitId: u, isWarlord: false } : u;
      return {
        unitId,
        modelCount: dataset.units.getAny(unitId)?.raw.model_count?.min ?? 1,
        isWarlord,
        enhancementId: null,
        leaderBodyguardId: null,
        counts: new Map(),
      };
    }),
  };
}

export function codes(spec: NormRoster): Set<RosterViolationCode> {
  return new Set(validateRosterCore(spec, dataset).army.map((v) => v.code));
}

/** Whether validation resolves `unitId` in `host`'s army to the record from `factionId`. */
export function resolvesTo(host: string, unitId: string, factionId: string): boolean {
  return (dataset.units.getInFaction(unitId, host) ?? dataset.units.getAny(unitId))?.raw.faction_id === factionId;
}
