/**
 * Warlord eligibility and army keyword caps in the BSData export, checked
 * against roster validation (`validateRosterCore`).
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import type { RosterViolationCode } from "../src/data/roster-resolve.js";
import type { Detachment } from "../src/generated.js";
import { evaluateField } from "../src/bsdata-export/evaluate.js";
import { BSDATA_IDS } from "../src/bsdata-export/ids.js";
import { children, str, type BsNode } from "../src/bsdata-export/source.js";
import { isSupremeCommander } from "../src/bsdata-export/warlord.js";
import {
  codes,
  dataset,
  detachmentOption,
  evalContext,
  FACTIONS,
  linkedField,
  loadExportFixture,
  resolvesTo,
  rootFaction,
  roster,
  unitLinks,
  type ExportFixture,
  type UnitEntry,
} from "./bsdata-export-fixture.js";

const WARLORD_CODES: readonly RosterViolationCode[] = [
  "cannot-be-warlord",
  "warlord-not-character",
  "warlord-not-mandated",
  "warlord-not-supreme-commander",
  "ally-cannot-be-warlord",
];

let fx: ExportFixture;
let supremeCategory: string;

beforeAll(() => {
  fx = loadExportFixture();
  supremeCategory = str(children(fx.gst, "categoryEntries").find((c) => c.name === "Supreme Commander")!, "id")!;
}, 120_000);

function unitOf(entry: UnitEntry) {
  return dataset.units.byFaction(entry.factionId).find((u) => u.id === entry.unitId)!.raw;
}

function warlordOption(entry: UnitEntry): BsNode | undefined {
  return children(entry.node, "entryLinks").find((l) => l.name === "Warlord");
}

/** Links whose unit only the army's own rules govern (allied offers have their own tests). */
function nativeLinks(host: string): { link: BsNode; entry: UnitEntry }[] {
  return unitLinks(fx, host).filter(
    ({ link, entry }) => !children(link, "categoryLinks").some((c) => String(c.name).startsWith("Allies:")) && resolvesTo(host, entry.unitId, entry.factionId),
  );
}

describe("BSData export Warlord rules agree with roster validation", () => {
  /** Whether the export lets `entry` be a lone Warlord, and whether validation does. */
  function verdicts(host: string, link: BsNode, entry: UnitEntry, detachment: Detachment | undefined): { exported: boolean; expected: boolean } {
    const ctx = evalContext(fx, host, detachment ? [str(detachmentOption(fx, detachment), "id")!] : []);
    const option = warlordOption(entry);
    const root = fx.catalogues.get(rootFaction(detachment?.faction_id ?? host))!;
    const mandated = children(root, "categoryEntries")
      .filter((c) => String(c.name).startsWith("Warlord: "))
      .every((category) => {
        const min = children(category, "constraints").find((k) => k.type === "min")!;
        const required = evaluateField(category, "", str(min, "id")!, Number(min.value), ctx);
        return required === 0 || children(option ?? {}, "categoryLinks").some((l) => str(l, "targetId") === str(category, "id"));
      });
    const exported = option !== undefined && linkedField(option, link, "", "hidden", 0, ctx) === 0 && mandated;
    const reported = codes(roster(host, "strike-force", detachment ? [detachment.id] : [], [{ unitId: entry.unitId, isWarlord: true }]));
    return { exported, expected: !WARLORD_CODES.some((c) => reported.has(c)) };
  }

  it("offers the Warlord option exactly where a lone Warlord is legal", () => {
    const cases = FACTIONS.flatMap((host) => nativeLinks(host).map((c) => ({ host, ...c })));
    let legal = 0;
    let illegal = 0;
    fc.assert(
      fc.property(fc.constantFrom(...cases), fc.nat(), ({ host, link, entry }, pick) => {
        const offered = dataset.detachments.byFaction(host);
        const detachment = pick % (offered.length + 1) === offered.length ? undefined : offered[pick % (offered.length + 1)];
        const { exported, expected } = verdicts(host, link, entry, detachment);
        if (expected) legal += 1;
        else illegal += 1;
        expect({ host, unit: entry.unitId, detachment: detachment?.id, legal: exported }).toEqual({ host, unit: entry.unitId, detachment: detachment?.id, legal: expected });
      }),
      { numRuns: 3000 },
    );
    expect(legal).toBeGreaterThan(0);
    expect(illegal).toBeGreaterThan(0);
  });

  it("follows every detachment that names or mandates its Warlord, for every unit in the army", () => {
    let named = 0;
    for (const host of FACTIONS) {
      for (const detachment of dataset.detachments.byFaction(host)) {
        const names = [...(detachment.mandatory_warlord_datasheet_ids ?? []), ...(detachment.granted_warlord_datasheet_ids ?? [])];
        if (names.length === 0) continue;
        // The army's own datasheets, including those only its exclusive allied pools offer.
        const own = unitLinks(fx, host).filter(({ entry }) => rootFaction(entry.factionId) === rootFaction(host) && resolvesTo(host, entry.unitId, entry.factionId));
        for (const { link, entry } of own) {
          if (names.includes(entry.unitId)) named += 1;
          for (const chosen of [detachment, undefined]) {
            const { exported, expected } = verdicts(host, link, entry, chosen);
            expect({ host, detachment: chosen?.id, unit: entry.unitId, legal: exported }).toEqual({ host, detachment: chosen?.id, unit: entry.unitId, legal: expected });
          }
        }
      }
    }
    expect(named).toBeGreaterThan(3);
  });

  it("hides every other Warlord option once the army includes a Supreme Commander", () => {
    const pairs = FACTIONS.flatMap((host) => {
      const links = nativeLinks(host);
      const supreme = links.filter(({ entry }) => isSupremeCommander(dataset, unitOf(entry)));
      const others = links.filter(({ entry }) => warlordOption(entry) !== undefined && entry.unitId !== supreme[0]?.entry.unitId);
      return supreme.flatMap((s) => others.map((o) => ({ host, supreme: s, other: o })));
    });
    expect(pairs.length).toBeGreaterThan(100);
    fc.assert(
      fc.property(fc.constantFrom(...pairs), ({ host, supreme, other }) => {
        fc.pre(other.entry.unitId !== supreme.entry.unitId);
        expect(children(supreme.entry.node, "categoryLinks").some((l) => str(l, "targetId") === supremeCategory)).toBe(true);
        const ctx = evalContext(fx, host, [supremeCategory]);
        const option = warlordOption(other.entry)!;
        const exported = linkedField(option, other.link, "", "hidden", 0, ctx) === 0;
        const reported = codes(roster(host, "strike-force", [], [supreme.entry.unitId, { unitId: other.entry.unitId, isWarlord: true }]));
        const expected = !WARLORD_CODES.some((c) => reported.has(c));
        expect({ host, supreme: supreme.entry.unitId, warlord: other.entry.unitId, legal: exported }).toEqual({
          host,
          supreme: supreme.entry.unitId,
          warlord: other.entry.unitId,
          legal: expected,
        });
      }),
      { numRuns: 1000 },
    );
  });
});

describe("BSData export keyword caps agree with roster validation", () => {
  it("caps the army's keyword units as its faction's keyword limits do", () => {
    const hosts = FACTIONS.filter((f) => (dataset.factions.get(f)?.raw.keyword_limits ?? []).length > 0);
    expect(hosts.length).toBeGreaterThan(3);
    const limited = new Map(
      hosts.map((host) => {
        const categories = children(fx.catalogues.get(host)!, "categoryEntries").filter((c) => String(c.name).startsWith("Limit: "));
        const ids = new Set(categories.map((c) => str(c, "id")!));
        // Every unit counts toward a cap, allied offers included.
        const links = unitLinks(fx, host).filter(({ link, entry }) => resolvesTo(host, entry.unitId, entry.factionId)).filter(({ link }) => children(link, "categoryLinks").some((l) => ids.has(str(l, "targetId")!)));
        return [host, { categories, links }] as const;
      }),
    );
    for (const host of hosts) expect(limited.get(host)!.links.length, host).toBeGreaterThan(0);
    let exceeded = 0;
    fc.assert(
      fc.property(fc.constantFrom(...hosts), fc.array(fc.nat(), { minLength: 1, maxLength: 4 }), fc.nat(), (host, picks, pick) => {
        const { categories, links } = limited.get(host)!;
        const chosen = picks.map((p) => links[p % links.length]);
        const offered = dataset.detachments.byFaction(host);
        const detachment = pick % 2 === 0 ? offered[pick % offered.length] : undefined;
        const counts = new Map(categories.map((c) => [str(c, "id")!, chosen.filter(({ link }) => children(link, "categoryLinks").some((l) => str(l, "targetId") === str(c, "id"))).length]));
        const present = [...counts].filter(([, n]) => n > 0).map(([id]) => id);
        const ctx = evalContext(fx, host, [...(detachment ? [str(detachmentOption(fx, detachment), "id")!] : []), ...present]);
        const over = categories.some((c) => {
          const max = children(c, "constraints").find((k) => k.type === "max")!;
          const value = evaluateField(c, "", str(max, "id")!, Number(max.value), ctx);
          return value >= 0 && counts.get(str(c, "id")!)! > value;
        });
        const reported = codes(roster(host, "strike-force", detachment ? [detachment.id] : [], chosen.map(({ entry }) => entry.unitId))).has("keyword-limit-exceeded");
        if (reported) exceeded += 1;
        expect({ host, units: chosen.map(({ entry }) => entry.unitId), detachment: detachment?.id, over }).toEqual({
          host,
          units: chosen.map(({ entry }) => entry.unitId),
          detachment: detachment?.id,
          over: reported,
        });
      }),
      { numRuns: 1500 },
    );
    expect(exceeded).toBeGreaterThan(0);
  });

  it("defines the Supreme Commander category in the game system", () => {
    expect(BSDATA_IDS.gameSystem.id).toBe(str(fx.gst, "id"));
    expect(supremeCategory).toBeDefined();
  });
});
