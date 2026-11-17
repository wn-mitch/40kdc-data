/**
 * The BSData export lays out detachments, enhancements, army rules and model
 * statlines as BSData does, and that layout offers what roster validation allows:
 * each army sees its own detachments and no other army's, each enhancement shows
 * under exactly the units that may take it, and each model prints its statline.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { validateRosterCore, type RosterViolationCode } from "../src/data/roster-resolve.js";
import { evaluateField } from "../src/bsdata-export/evaluate.js";
import { children, str, type BsNode } from "../src/bsdata-export/source.js";
import { dataset, detachmentOptions, FACTIONS, loadExportFixture, rootFaction, type ExportFixture } from "./bsdata-export-fixture.js";

let fx: ExportFixture;

beforeAll(() => {
  fx = loadExportFixture();
}, 120_000);

const catalogueId = (factionId: string): string => str(fx.catalogues.get(factionId)!, "id")!;

/** Whether `node` is hidden in an army whose primary catalogue is `factionId`'s, with `selected` chosen. */
function hiddenIn(node: BsNode, factionId: string, selected: readonly string[] = []): boolean {
  return evaluateField(node, str(node, "id")!, "hidden", node.hidden === true ? 1 : 0, {
    modelCount: 1,
    earlierCopies: 0,
    primaryCatalogueId: catalogueId(factionId),
    selected: new Set(selected),
  }) === 1;
}

const INELIGIBLE: readonly RosterViolationCode[] = [
  "enhancement-on-non-character",
  "enhancement-on-epic-hero",
  "enhancement-on-excluded-model",
  "enhancement-keyword-mismatch",
  "enhancement-missing-ability",
  "enhancement-excluded-keyword",
];

/** Whether roster validation lets `unitId` take `enhancementId` in `factionId`'s army with `detachmentId`. */
function validationAllows(factionId: string, unitId: string, detachmentId: string, enhancementId: string): boolean {
  const unit = (dataset.units.getInFaction(unitId, factionId) ?? dataset.units.getAny(unitId)!).raw;
  const report = validateRosterCore(
    {
      factionId,
      battleSize: "strike-force",
      forceDisposition: null,
      detachmentIds: [detachmentId],
      units: [{ unitId, modelCount: unit.model_count?.min ?? 1, isWarlord: false, enhancementId, leaderBodyguardId: null, counts: new Map() }],
    },
    dataset,
  );
  return !report.army.some((v) => INELIGIBLE.includes(v.code));
}

describe("BSData export detachments", () => {
  it("offers each army one Detachment selection, its own or its root's, when its family has detachments", () => {
    for (const factionId of FACTIONS) {
      const root = rootFaction(factionId);
      const reachable = [fx.catalogues.get(factionId)!, ...(root !== factionId ? [fx.catalogues.get(root)!] : [])];
      const links = reachable.flatMap((c) => children(c, "entryLinks")).filter((l) => l.name === "Detachment");
      const familyHas = FACTIONS.some((f) => rootFaction(f) === root && dataset.detachments.byFaction(f).length > 0);
      expect(links.length, factionId).toBe(familyHas ? 1 : 0);
    }
  });

  it("shows an army exactly the detachments it offers, inline in its family's selection", () => {
    let checked = 0;
    for (const factionId of FACTIONS) {
      const root = rootFaction(factionId);
      const offered = new Set(dataset.detachments.byFaction(factionId).map((d) => d.name));
      for (const option of detachmentOptions(fx.catalogues.get(root)!)) {
        expect({ factionId, detachment: option.name, shown: !hiddenIn(option, factionId) }).toEqual({
          factionId,
          detachment: option.name,
          shown: offered.has(String(option.name)),
        });
        checked += 1;
      }
      for (const name of offered) expect(detachmentOptions(fx.catalogues.get(root)!).some((o) => o.name === name), `${factionId} ${name}`).toBe(true);
    }
    // Chapter detachments are hidden from the other Chapters and from Space Marines.
    expect(checked).toBeGreaterThan(400);
  });
});

describe("BSData export enhancements", () => {
  const groupOf = (root: string): BsNode | undefined => children(fx.catalogues.get(root)!, "sharedSelectionEntryGroups").find((g) => g.name === "Enhancements");

  it("links each unit to its family's one shared Enhancements group, never to a group of its own", () => {
    for (const { factionId, node } of fx.entries.values()) {
      expect(children(node, "selectionEntryGroups").some((g) => g.name === "Enhancements"), String(node.name)).toBe(false);
      const links = children(node, "entryLinks").filter((l) => l.name === "Enhancements");
      expect(links.length, String(node.name)).toBeLessThanOrEqual(1);
      if (links.length === 1) {
        expect(links[0].type).toBe("selectionEntryGroup");
        expect(str(links[0], "targetId")).toBe(str(groupOf(rootFaction(factionId))!, "id"));
      }
    }
  });

  it("shows an enhancement under exactly the units roster validation lets take it", () => {
    const cases = FACTIONS.filter((f) => rootFaction(f) === f && groupOf(f)).flatMap((root) => {
      const enhancements = children(groupOf(root)!, "selectionEntries");
      const units = [...fx.entries.entries()].filter(([, e]) => rootFaction(e.factionId) === root);
      return enhancements.flatMap((node) => units.map(([entryId, unit]) => ({ root, node, entryId, unit })));
    });
    expect(cases.length).toBeGreaterThan(5000);
    fc.assert(
      fc.property(fc.constantFrom(...cases), ({ root, node, entryId, unit }) => {
        const conditions = children(node, "modifiers").flatMap((m) => children(m, "conditionGroups").flatMap((g) => children(g, "conditions")).concat(children(m, "conditions")));
        // The enhancement's detachment is the one whose selection it waits for; its name picks it there.
        const detachmentOptionId = str(conditions.find((c) => c.scope === "force" && c.type === "lessThan")!, "childId");
        const option = detachmentOptions(fx.catalogues.get(root)!).find((o) => str(o, "id") === detachmentOptionId)!;
        const detachment = dataset.detachments.all.find((d) => rootFaction(d.faction_id) === root && d.name === option.name)!;
        const enhancement = (detachment.enhancement_ids ?? []).map((id) => dataset.enhancements.getAny(id)!).find((e) => e.name === node.name)!;
        // Hidden under a unit when every listed eligible unit is someone else (BSData's `ancestor` conditions).
        const listed = conditions.filter((c) => c.scope === "ancestor" && c.type === "notInstanceOf").map((c) => str(c, "childId"));
        const shown = node.hidden !== true && listed.includes(entryId);
        expect({ unit: unit.unitId, enhancement: enhancement.id, shown }).toEqual({
          unit: unit.unitId,
          enhancement: enhancement.id,
          // Validated in each army that offers the detachment, since only there can the enhancement be taken.
          shown: FACTIONS.filter((f) => dataset.detachments.byFaction(f).some((d) => d.id === detachment.id)).some((f) =>
            validationAllows(f, unit.unitId, detachment.id, enhancement.id),
          ),
        });
      }),
      { numRuns: 3000 },
    );
  });
});

describe("BSData export army rules", () => {
  it("defines each family's army rules at catalogue level and links them from every army and unit", () => {
    for (const factionId of FACTIONS) {
      const ruleIds = dataset.factions.get(factionId)?.raw.faction_rule_ids ?? [];
      const rules = new Map(children(fx.catalogues.get(rootFaction(factionId))!, "sharedRules").map((r) => [str(r, "id")!, r]));
      const linked = children(fx.catalogues.get(factionId)!, "infoLinks").filter((l) => l.type === "rule").map((l) => rules.get(str(l, "targetId")!));
      expect(linked.every((r) => r !== undefined && String(r.description).length > 0), factionId).toBe(true);
      expect(linked.length, factionId).toBe(ruleIds.length);
    }
    for (const { factionId, unitId, node } of fx.entries.values()) {
      const armyRules = new Set(dataset.factions.get(rootFaction(factionId))?.raw.faction_rule_ids ?? []);
      for (const familyMember of FACTIONS.filter((f) => rootFaction(f) === rootFaction(factionId))) {
        for (const id of dataset.factions.get(familyMember)?.raw.faction_rule_ids ?? []) armyRules.add(id);
      }
      const unit = dataset.units.getInFaction(unitId, factionId)!.raw;
      const abilityIds = (unit.ability_ids ?? []).map((ref) => (typeof ref === "string" ? ref : String((ref as { id?: unknown }).id)));
      const expected = abilityIds.filter((id) => armyRules.has(id)).length;
      const links = children(node, "infoLinks").filter((l) => l.type === "rule");
      expect(links.length, `${factionId}/${unitId}`).toBe(expected);
    }
  });
});

describe("BSData export model statlines", () => {
  it("prints a Unit profile on every model entry of a multi-model unit, named for the model", () => {
    let checked = 0;
    for (const { unitId, node } of fx.entries.values()) {
      const unit = dataset.units.getAny(unitId)!.raw;
      if (node.type !== "unit") continue;
      const models = children(node, "selectionEntryGroups")
        .filter((g) => g.name === "Models")
        .flatMap((g) => [...children(g, "selectionEntries"), ...children(g, "selectionEntryGroups").flatMap((s) => children(s, "selectionEntries"))])
        .filter((e) => e.type === "model");
      for (const model of models) {
        const statlines = children(model, "profiles").filter((p) => p.typeName === "Unit");
        const name = String(model.name).replace(/ \(no wargear\)$/, "");
        // A row resolves when a profile is named for it, its composition row names one, or the unit has only one.
        const row = dataset.unitCompositionOf(unit)?.models?.find((m) => m.name === name);
        const resolves = unit.profiles.length === 1 || unit.profiles.some((p) => p.name === name || (row?.profile_name != null && p.name === row.profile_name));
        expect(statlines.map((p) => p.name), `${unitId} ${String(model.name)}`).toEqual(resolves ? [name] : []);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe("BSData export companion and loadout statlines", () => {
  const entryOf = ([factionId, unitId]: readonly [string, string]): BsNode => [...fx.entries.values()].find((e) => e.factionId === factionId && e.unitId === unitId)!.node;
  /** The first Unit profile anywhere in `node`: on the entry itself or on one of its models. */
  const firstStatline = (node: BsNode): BsNode | undefined => {
    const own = children(node, "profiles").find((p) => p.typeName === "Unit");
    if (own) return own;
    for (const key of ["selectionEntryGroups", "selectionEntries"]) {
      for (const child of children(node, key)) {
        const found = firstStatline(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const characteristics = (p: BsNode): Record<string, unknown> => Object.fromEntries(children(p, "characteristics").map((c) => [String(c.name), c.$text]));

  it("prints a companion datasheet's statline on the unit it takes the field with, in its own numbers", () => {
    for (const [host, companion] of [
      [["imperial-knights", "canis-rex"], ["imperial-knights", "sir-hekhtur"]],
      [["adeptus-astartes", "marneus-calgar"], ["adeptus-astartes", "victrix-honour-guard"]],
    ] as const) {
      const shown = children(entryOf(host), "profiles").find((p) => p.typeName === "Unit" && p.name === dataset.units.getInFaction(companion[1], companion[0])!.name);
      expect(shown, `${host[1]} shows ${companion[1]}`).toBeDefined();
      const own = firstStatline(entryOf(companion))!;
      expect(characteristics(shown!)).toEqual(characteristics(own));
    }
  });

  it("offers every priced unit on its own and no unpriced one (Sir Hekhtur comes with Canis Rex)", () => {
    const linked = new Set([...fx.catalogues.values()].flatMap((c) => children(c, "entryLinks")).map((l) => str(l, "targetId")));
    for (const [entryId, { factionId, unitId }] of fx.entries) {
      const priced = (dataset.units.getInFaction(unitId, factionId)!.raw.points ?? []).length > 0;
      expect({ unit: `${factionId}/${unitId}`, offered: linked.has(entryId) }).toEqual({ unit: `${factionId}/${unitId}`, offered: priced });
    }
  });

  it("prints a model's statline under its storm-shield loadout name on each storm-shield choice", () => {
    let checked = 0;
    for (const { unitId, node } of fx.entries.values()) {
      const models = children(node, "selectionEntryGroups").filter((g) => g.name === "Models").flatMap((g) => [...children(g, "selectionEntries"), ...children(g, "selectionEntryGroups").flatMap((s) => children(s, "selectionEntries"))]);
      for (const model of models) {
        const own = children(model, "profiles").find((p) => p.typeName === "Unit");
        for (const choice of children(model, "selectionEntryGroups").flatMap((g) => children(g, "selectionEntries"))) {
          const shield = children(choice, "entryLinks").some((l) => /^storm shield$/i.test(String(l.name)));
          const lines = children(choice, "profiles").filter((p) => p.typeName === "Unit");
          if (!shield || !own) {
            expect(lines, `${unitId} ${String(choice.name)}`).toEqual([]);
            continue;
          }
          const name = `${String(model.name).replace(/ \(no wargear\)$/, "")} w/ Storm Shield`;
          expect(lines.map((p) => p.name), `${unitId} ${String(choice.name)}`).toEqual([name]);
          expect(characteristics(lines[0])).toEqual(characteristics(own));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});
