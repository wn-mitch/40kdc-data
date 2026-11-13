/**
 * Detachment rules on army composition in the BSData export, checked against
 * roster validation (`validateRosterCore`): datasheet bars, keyword grants that
 * double a datasheet limit, detachment tag conflicts and unit minimums.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { validateRosterCore, type NormRoster, type RosterViolationCode } from "../src/data/roster-resolve.js";
import type { Detachment } from "../src/generated.js";
import { evaluateField, type EvalContext } from "../src/bsdata-export/evaluate.js";
import { buildExport } from "../src/bsdata-export/export.js";
import { BSDATA_IDS } from "../src/bsdata-export/ids.js";
import { hostsOffering, restrictingDetachments } from "../src/bsdata-export/restrictions.js";
import { children, str, type BsNode } from "../src/bsdata-export/source.js";

const dataset = Dataset.embedded();
const FACTIONS = Object.keys(BSDATA_IDS.catalogues);
const DP = BSDATA_IDS.system.costTypes["Detachment Points"];
type Size = "incursion" | "strike-force";

let catalogues: Map<string, BsNode>;
let gst: BsNode;
/** Unit entry id → its faction, unit id and entry node. */
let entries: Map<string, { factionId: string; unitId: string; node: BsNode }>;

function rootFaction(factionId: string): string {
  return dataset.factions.get(factionId)?.raw.parent_faction_id ?? factionId;
}

function sharedEntry(name: string): BsNode {
  return children(gst, "sharedSelectionEntries").find((e) => e.name === name)!;
}

function battleSizeId(size: Size): string {
  const group = children(sharedEntry("Battle Size"), "selectionEntryGroups")[0];
  return str(children(group, "selectionEntries").find((o) => String(o.name).includes(size === "incursion" ? "Incursion" : "Strike Force"))!, "id")!;
}

function detachmentOption(detachment: Detachment): BsNode {
  return children(catalogues.get(rootFaction(detachment.faction_id))!, "sharedSelectionEntries").find(
    (e) => e.name === detachment.name && children(e, "costs").some((c) => str(c, "typeId") === DP),
  )!;
}

/** Unit links an army built from `host` offers: its own root list and, for a child faction, its parent's. */
function unitLinks(host: string): { link: BsNode; entry: { factionId: string; unitId: string; node: BsNode } }[] {
  const lists = [catalogues.get(host)!, ...(rootFaction(host) !== host ? [catalogues.get(rootFaction(host))!] : [])];
  return lists.flatMap((c) =>
    children(c, "entryLinks")
      .map((link) => ({ link, entry: entries.get(str(link, "targetId")!)! }))
      .filter(({ entry }) => entry !== undefined),
  );
}

function limitId(entry: BsNode): string {
  return str(children(entry, "constraints").find((c) => str(c, "field") === "selections" && c.type === "max")!, "id")!;
}

/** A field on a linked entry: the entry's modifiers, then the link's. */
function linkedField(entry: BsNode, link: BsNode, field: string, base: number, ctx: EvalContext): number {
  const merged = { modifiers: [...children(entry, "modifiers"), ...children(link, "modifiers")] };
  return evaluateField(merged, str(entry, "id")!, field, base, ctx);
}

function roster(host: string, size: Size, detachmentIds: string[], unitIds: string[]): NormRoster {
  return {
    factionId: host,
    battleSize: size,
    forceDisposition: null,
    detachmentIds,
    units: unitIds.map((unitId) => ({
      unitId,
      modelCount: dataset.units.getAny(unitId)?.raw.model_count?.min ?? 1,
      isWarlord: false,
      enhancementId: null,
      leaderBodyguardId: null,
      counts: new Map(),
    })),
  };
}

function codes(spec: NormRoster): Set<RosterViolationCode> {
  return new Set(validateRosterCore(spec, dataset).army.map((v) => v.code));
}

/** Whether validation resolves `unitId` in `host`'s army to the record from `factionId`. */
function resolvesTo(host: string, unitId: string, factionId: string): boolean {
  return (dataset.units.getInFaction(unitId, host) ?? dataset.units.getAny(unitId))?.raw.faction_id === factionId;
}

beforeAll(() => {
  const documents = buildExport({ version: "1.5.1", dataset });
  gst = Object.values(documents[0].document)[0] as BsNode;
  catalogues = new Map();
  entries = new Map();
  for (const factionId of FACTIONS) {
    const doc = documents.find((d) => d.file === BSDATA_IDS.catalogues[factionId].file);
    if (!doc) continue;
    const catalogue = Object.values(doc.document)[0] as BsNode;
    catalogues.set(factionId, catalogue);
    for (const node of children(catalogue, "sharedSelectionEntries")) {
      if (node.type !== "unit" && node.type !== "model") continue;
      const view = dataset.units.byFaction(factionId).find((u) => (u.raw.is_legend ? `${u.name} [Legends]` : u.name) === node.name);
      if (view) entries.set(str(node, "id")!, { factionId, unitId: view.id, node });
    }
  }
}, 120_000);

describe("BSData export detachment rules agree with roster validation", () => {
  it("bars a datasheet while a detachment that excludes it is selected", () => {
    const cases = restrictingDetachments(dataset).flatMap((detachment) =>
      hostsOffering({ dataset, factions: FACTIONS }, detachment.id).flatMap((host) => unitLinks(host).map(({ link, entry }) => ({ detachment, host, link, entry }))),
    );
    expect(cases.length).toBeGreaterThan(500);
    // The toggle exists only when the dataset has Legends datasheets.
    const legendsToggle = sharedEntry("Show Legends");
    const showLegends = legendsToggle ? [str(legendsToggle, "id")!] : [];
    let barredSeen = 0;
    fc.assert(
      fc.property(fc.constantFrom(...cases), fc.boolean(), ({ detachment, host, link, entry }, chosen) => {
        fc.pre(resolvesTo(host, entry.unitId, entry.factionId));
        const optionId = str(detachmentOption(detachment), "id")!;
        const ctx: EvalContext = {
          modelCount: 1,
          earlierCopies: 0,
          primaryCatalogueId: str(catalogues.get(host)!, "id")!,
          selected: new Set([battleSizeId("strike-force"), ...showLegends, ...(chosen ? [optionId] : [])]),
        };
        const id = limitId(entry.node);
        const base = Number(children(entry.node, "constraints").find((c) => str(c, "id") === id)!.value);
        const exported = linkedField(entry.node, link, id, base, ctx) === 0;
        const reported = codes(roster(host, "strike-force", chosen ? [detachment.id] : [], [entry.unitId]));
        const expected = ["detachment-excluded-datasheet", "detachment-restriction-required", "detachment-restriction-excluded"].some((c) => reported.has(c as RosterViolationCode));
        if (expected) barredSeen += 1;
        expect({ host, detachment: detachment.id, unit: entry.unitId, chosen, barred: exported }).toEqual({ host, detachment: detachment.id, unit: entry.unitId, chosen, barred: expected });
        if (exported) expect(linkedField(entry.node, link, "hidden", 0, ctx)).toBe(1);
      }),
      { numRuns: 1500 },
    );
    expect(barredSeen).toBeGreaterThan(0);
  });

  it("doubles a datasheet limit while a detachment grants BATTLELINE", () => {
    const cases = FACTIONS.flatMap((host) =>
      unitLinks(host).flatMap(({ link, entry }) => {
        const unit = dataset.units.byFaction(entry.factionId).find((u) => u.id === entry.unitId)!.raw;
        return (unit.conditional_keywords ?? [])
          .filter((g) => g.required_detachment_id && (g.keyword === "Battleline" || g.keyword === "Dedicated Transport"))
          .filter((g) => hostsOffering({ dataset, factions: FACTIONS }, g.required_detachment_id!).includes(host))
          .map((g) => ({ host, link, entry, detachment: dataset.detachments.byFaction(host).find((d) => d.id === g.required_detachment_id)! }));
      }),
    );
    expect(cases.length).toBeGreaterThan(20);
    fc.assert(
      fc.property(fc.constantFrom(...cases), fc.constantFrom<Size>("incursion", "strike-force"), fc.boolean(), ({ host, link, entry, detachment }, size, chosen) => {
        fc.pre(resolvesTo(host, entry.unitId, entry.factionId));
        const ctx: EvalContext = {
          modelCount: 1,
          earlierCopies: 0,
          primaryCatalogueId: str(catalogues.get(host)!, "id")!,
          selected: new Set([battleSizeId(size), ...(chosen ? [str(detachmentOption(detachment), "id")!] : [])]),
        };
        const id = limitId(entry.node);
        const base = Number(children(entry.node, "constraints").find((c) => str(c, "id") === id)!.value);
        const limit = linkedField(entry.node, link, id, base, ctx);
        const over = (n: number): boolean =>
          codes(roster(host, size, chosen ? [detachment.id] : [], Array.from({ length: n }, () => entry.unitId))).has("unit-limit-exceeded");
        expect({ host, unit: entry.unitId, size, chosen, atLimit: over(limit), past: over(limit + 1) }).toEqual({ host, unit: entry.unitId, size, chosen, atLimit: false, past: true });
      }),
      { numRuns: 300 },
    );
  });

  it("caps detachments that share a tag at one per army", () => {
    const pairs = FACTIONS.flatMap((host) => {
      const offered = dataset.detachments.byFaction(host);
      return offered.flatMap((a, i) => offered.slice(i + 1).map((b) => ({ host, a, b })));
    });
    const tagCategories = (option: BsNode, root: BsNode): Set<string> => {
      const capped = new Set(
        children(root, "categoryEntries")
          .filter((c) => children(c, "constraints").some((k) => k.type === "max" && k.value === 1 && k.scope === "force"))
          .map((c) => str(c, "id")!),
      );
      return new Set(children(option, "categoryLinks").map((l) => str(l, "targetId")!).filter((id) => capped.has(id)));
    };
    let conflicts = 0;
    fc.assert(
      fc.property(fc.constantFrom(...pairs), ({ host, a, b }) => {
        const root = catalogues.get(rootFaction(host))!;
        const shared = [...tagCategories(detachmentOption(a), root)].some((id) => tagCategories(detachmentOption(b), root).has(id));
        const expected = codes(roster(host, "strike-force", [a.id, b.id], [])).has("detachment-tag-conflict");
        if (expected) conflicts += 1;
        expect({ host, a: a.id, b: b.id, shared }).toEqual({ host, a: a.id, b: b.id, shared: expected });
      }),
      { numRuns: 2000 },
    );
    expect(conflicts).toBeGreaterThan(0);
  });

  it("raises a keyword category's minimum while a detachment requires those units", () => {
    let checked = 0;
    for (const host of FACTIONS) {
      for (const detachment of dataset.detachments.byFaction(host)) {
        for (const minimum of detachment.unit_minimums ?? []) {
          const root = catalogues.get(rootFaction(host))!;
          const category = children(root, "categoryEntries").find((c) => c.name === minimum.keyword)!;
          expect(category, `${detachment.id} ${minimum.keyword}`).toBeDefined();
          const min = children(category, "constraints").find((c) => c.type === "min")!;
          const at = (selected: string[]): number =>
            evaluateField(category, "", str(min, "id")!, Number(min.value), { modelCount: 1, earlierCopies: 0, primaryCatalogueId: "", selected: new Set(selected) });
          expect(at([])).toBe(0);
          expect(at([str(detachmentOption(detachment), "id")!])).toBe(minimum.min);
          expect(codes(roster(host, "strike-force", [detachment.id], [])).has("unit-minimum-unmet")).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
