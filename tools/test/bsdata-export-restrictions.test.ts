/**
 * Detachment rules on army composition in the BSData export, checked against
 * roster validation (`validateRosterCore`): datasheet bars (excluded
 * datasheets, required and excluded keywords), keyword grants that
 * double a datasheet limit, detachment tag conflicts and unit minimums.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import type { RosterViolationCode } from "../src/data/roster-resolve.js";
import { Dataset } from "../src/data/dataset.js";
import { RAW_DATA } from "../src/data/bundle.generated.js";
import type { Detachment } from "../src/generated.js";
import { evaluateField, type EvalContext } from "../src/bsdata-export/evaluate.js";
import { hostsOffering, restrictingDetachments } from "../src/bsdata-export/restrictions.js";
import { children, str, type BsNode } from "../src/bsdata-export/source.js";
import {
  battleSizeId as sizeId,
  codes,
  dataset,
  detachmentOption as option,
  FACTIONS,
  linkedField as linked,
  loadExportFixture,
  resolvesTo,
  rootFaction,
  roster,
  sharedEntry as shared,
  unitLinks as links,
  type ExportFixture,
  type Size,
} from "./bsdata-export-fixture.js";

let fx: ExportFixture;
let catalogues: Map<string, BsNode>;
const battleSizeId = (size: Size): string => sizeId(fx, size);
const detachmentOption = (d: Parameters<typeof option>[1]): BsNode => option(fx, d);
const sharedEntry = (name: string): BsNode | undefined => shared(fx, name);
const unitLinks = (host: string) => links(fx, host);
const linkedField = (entry: BsNode, link: BsNode, field: string, base: number, ctx: EvalContext): number => linked(entry, link, str(entry, "id")!, field, base, ctx);

function limitId(entry: BsNode): string {
  return str(children(entry, "constraints").find((c) => str(c, "field") === "selections" && c.type === "max")!, "id")!;
}

/**
 * Whether the export bars `entry` in `host`'s army (its datasheet limit evaluates to 0, and then
 * it is hidden), with `detachment` selected or not, and whether roster validation refuses it.
 */
function barVerdict(
  fixture: ExportFixture,
  ds: Dataset,
  c: { detachment: Detachment; host: string; link: BsNode; entry: { unitId: string; node: BsNode } },
  chosen: boolean,
): { exported: boolean; barred: boolean } {
  // The toggle exists only when the dataset has Legends datasheets.
  const legendsToggle = shared(fixture, "Show Legends");
  const ctx: EvalContext = {
    modelCount: 1,
    earlierCopies: 0,
    primaryCatalogueId: str(fixture.catalogues.get(c.host)!, "id")!,
    selected: new Set([sizeId(fixture, "strike-force"), ...(legendsToggle ? [str(legendsToggle, "id")!] : []), ...(chosen ? [str(option(fixture, c.detachment), "id")!] : [])]),
  };
  const entryId = str(c.entry.node, "id")!;
  const id = limitId(c.entry.node);
  const base = Number(children(c.entry.node, "constraints").find((k) => str(k, "id") === id)!.value);
  const exported = linked(c.entry.node, c.link, entryId, id, base, ctx) === 0;
  if (exported) expect(linked(c.entry.node, c.link, entryId, "hidden", 0, ctx)).toBe(1);
  const reported = codes(roster(c.host, "strike-force", chosen ? [c.detachment.id] : [], [c.entry.unitId]), ds);
  const barred = (["detachment-excluded-datasheet", "detachment-restriction-required", "detachment-restriction-excluded"] as RosterViolationCode[]).some((code) => reported.has(code));
  return { exported, barred };
}

beforeAll(() => {
  fx = loadExportFixture();
  catalogues = fx.catalogues;
}, 120_000);

describe("BSData export detachment rules agree with roster validation", () => {
  it("bars a datasheet while a detachment that excludes it is selected", () => {
    const cases = restrictingDetachments(dataset).flatMap((detachment) =>
      hostsOffering({ dataset, factions: FACTIONS }, detachment.id).flatMap((host) => unitLinks(host).map(({ link, entry }) => ({ detachment, host, link, entry }))),
    );
    expect(cases.length).toBeGreaterThan(500);
    let barredSeen = 0;
    fc.assert(
      fc.property(fc.constantFrom(...cases), fc.boolean(), ({ detachment, host, link, entry }, chosen) => {
        fc.pre(resolvesTo(host, entry.unitId, entry.factionId));
        const verdict = barVerdict(fx, dataset, { detachment, host, link, entry }, chosen);
        if (verdict.barred) barredSeen += 1;
        expect(verdict.exported).toEqual(verdict.barred);
      }),
      { numRuns: 1500 },
    );
    expect(barredSeen).toBeGreaterThan(0);
  });

  it("bars by excluded keywords, and by required keywords the detachment grants", () => {
    // No detachment excludes a keyword, and every required keyword is a Chapter's, so the test adds
    // both: Subterranean Assault excludes BURROWER (which it grants two units) and Kult of Speed
    // requires BATTLELINE (which it grants one unit).
    const restrictions: { host: string; id: string; restrictions: Detachment["restrictions"] }[] = [
      { host: "tyranids", id: "subterranean-assault", restrictions: { excluded_keywords: ["Burrower"] } },
      { host: "orks", id: "kult-of-speed", restrictions: { required_keywords: ["Battleline"] } },
    ];
    const ds = new Dataset({
      ...RAW_DATA,
      detachments: RAW_DATA.detachments.map((d) => {
        const added = restrictions.find((r) => r.host === d.faction_id && r.id === d.id);
        return added ? { ...d, restrictions: added.restrictions } : d;
      }),
    } as typeof RAW_DATA);
    const modified = loadExportFixture(ds);
    for (const { host, id } of restrictions) {
      const detachment = ds.detachments.byFaction(host).find((d) => d.id === id)!;
      const tally = { barred: 0, kept: 0 };
      for (const { link, entry } of links(modified, host)) {
        if (!resolvesTo(host, entry.unitId, entry.factionId)) continue;
        for (const chosen of [false, true]) {
          const verdict = barVerdict(modified, ds, { detachment, host, link, entry }, chosen);
          expect(verdict.exported, `${id} ${entry.factionId}/${entry.unitId} chosen=${chosen}`).toBe(verdict.barred);
          if (chosen) tally[verdict.barred ? "barred" : "kept"] += 1;
        }
      }
      expect(tally.barred, id).toBeGreaterThan(0);
      expect(tally.kept, id).toBeGreaterThan(0);
    }
    // The granted keyword decides: Kult of Speed keeps the unit it makes BATTLELINE.
    const granted = ds.units.byFaction("orks").find((u) => (u.raw.conditional_keywords ?? []).some((g) => g.required_detachment_id === "kult-of-speed" && g.keyword === "Battleline"))!;
    expect(granted.raw.keywords ?? []).not.toContain("Battleline");
    expect(codes(roster("orks", "strike-force", ["kult-of-speed"], [granted.id]), ds).has("detachment-restriction-required")).toBe(false);
  }, 300_000);

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
