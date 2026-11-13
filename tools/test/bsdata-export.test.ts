import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import {
  detachmentCapForBattleSize,
  enhancementLimitForBattleSize,
  pointsLimitForBattleSize,
  unitLimitForBattleSize,
} from "../src/data/battle-sizes.js";
import { hostUnitPoints } from "../src/data/pricing.js";
import type { AlliedRule } from "../src/generated.js";
import { evaluateConstraint, evaluateField, evaluatePoints, type EvalContext } from "../src/bsdata-export/evaluate.js";
import { allyPlans } from "../src/bsdata-export/allies.js";
import { buildExport, type ExportedDocument } from "../src/bsdata-export/export.js";
import { formatViolations, type FormatDescriptor } from "../src/bsdata-export/format.js";
import formatJson from "../src/bsdata-export/format.json" with { type: "json" };
import { BSDATA_ID_PATTERN, BSDATA_IDS } from "../src/bsdata-export/ids.js";
import { bsdataJson } from "../src/bsdata-export/json.js";
import { children, str, walk, type BsNode } from "../src/bsdata-export/source.js";
import { homeFactionOf, isEpicHero } from "../src/bsdata-export/unit.js";
import { modelCounts } from "../src/bsdata-export/wargear.js";

const FORMAT = formatJson as unknown as FormatDescriptor;
const dataset = Dataset.embedded();
let documents: ExportedDocument[];
let roots: Map<string, BsNode>;
let gst: BsNode;
const PTS = BSDATA_IDS.system.costTypes.pts;

interface ExportedUnit {
  readonly factionId: string;
  readonly unitId: string;
  readonly entry: BsNode;
  readonly catalogueId: string;
}
let units: ExportedUnit[];

function rootOf(doc: ExportedDocument): BsNode {
  return Object.values(doc.document)[0] as BsNode;
}

function catalogueOf(factionId: string): BsNode {
  return rootOf(documents.find((d) => d.file === BSDATA_IDS.catalogues[factionId].file)!);
}

function battleSizeId(size: "incursion" | "strike-force"): string {
  const group = children(children(gst, "sharedSelectionEntries").find((e) => e.name === "Battle Size")!, "selectionEntryGroups")[0];
  return str(children(group, "selectionEntries").find((o) => String(o.name).includes(size === "incursion" ? "Incursion" : "Strike Force"))!, "id")!;
}

function ctxFor(entry: ExportedUnit, extra: Partial<EvalContext> = {}): EvalContext {
  return {
    modelCount: 1,
    earlierCopies: 0,
    primaryCatalogueId: entry.catalogueId,
    selected: new Set([battleSizeId("strike-force")]),
    ...extra,
  };
}

beforeAll(() => {
  documents = buildExport({ version: "1.5.1", dataset });
  // Round-trip through the written form so the checks read what ships.
  roots = new Map(documents.map((d) => [d.file, rootOf({ ...d, document: JSON.parse(bsdataJson(d.document)) as BsNode })]));
  documents = documents.map((d) => ({ ...d, document: { [Object.keys(d.document)[0]]: roots.get(d.file)! } }));
  gst = rootOf(documents[0]);
  units = [];
  for (const [factionId, { file }] of Object.entries(BSDATA_IDS.catalogues)) {
    const catalogue = roots.get(file);
    if (!catalogue) continue;
    for (const entry of children(catalogue, "sharedSelectionEntries")) {
      const type = str(entry, "type");
      if (type !== "unit" && type !== "model") continue;
      const view = dataset.units.byFaction(factionId).find((u) => (u.raw.is_legend ? `${u.name} [Legends]` : u.name) === entry.name);
      if (!view) continue;
      const home = homeFactionOf(dataset, view.raw);
      units.push({ factionId, unitId: view.id, entry, catalogueId: str(catalogueOf(home), "id")! });
    }
  }
}, 120_000);

describe("BSData export format", () => {
  it("writes the game system and one catalogue per faction", () => {
    expect(documents[0].file).toBe("Warhammer 40,000.json");
    expect(new Set(documents.slice(1).map((d) => d.file))).toEqual(
      new Set(Object.values(BSDATA_IDS.catalogues).map((c) => c.file)),
    );
    expect(units.length).toBe(dataset.factions.all.reduce((sum, f) => sum + dataset.units.byFaction(f.id).length, 0));
  });

  it("matches the BSData node format on every node", () => {
    const violations = documents.flatMap((d) => formatViolations(Object.keys(d.document)[0], rootOf(d), FORMAT));
    expect(violations.slice(0, 10)).toEqual([]);
  });

  it("reports any departure from the format", () => {
    const necrons = catalogueOf("necrons");
    const nodes = [...walk(necrons, "catalogue")].filter((v) => v.kind !== "catalogue");
    fc.assert(
      fc.property(
        fc.nat({ max: nodes.length - 1 }),
        fc.constantFrom("unknown-key", "drop-required", "null", "empty-array", "wrong-type", "reorder"),
        (index, mutation) => {
          const { node, kind } = nodes[index];
          const copy: BsNode = structuredClone(necrons);
          const target = [...walk(copy, "catalogue")].filter((v) => v.kind !== "catalogue")[index].node;
          const spec = FORMAT[kind];
          const required = spec.count > 1 ? spec.required : [];
          const scalarKey = Object.keys(node).find((k) => !Array.isArray(node[k]) && k !== "name" && k !== "id");
          switch (mutation) {
            case "unknown-key":
              target.notAKey = true;
              break;
            case "drop-required":
              fc.pre(required.length > 0);
              delete target[required[0]];
              break;
            case "null":
              fc.pre(scalarKey !== undefined);
              target[scalarKey!] = null;
              break;
            case "empty-array":
              target.constraints = [];
              fc.pre(spec.types.constraints !== undefined);
              break;
            case "wrong-type":
              fc.pre(scalarKey !== undefined);
              target[scalarKey!] = { nested: true };
              break;
            case "reorder": {
              const keys = Object.keys(target);
              fc.pre(keys.length > 2 && keys[0] === "name");
              const name = target.name;
              delete target.name;
              target.name = name;
              break;
            }
          }
          expect(formatViolations("catalogue", copy, FORMAT).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("gives every definition a unique BSData-form id", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const doc of documents) {
      for (const { node, kind } of walk(rootOf(doc), Object.keys(doc.document)[0])) {
        const id = str(node, "id");
        if (!id || kind === "gameSystem") continue;
        if (!["selectionEntry", "selectionEntryGroup", "categoryEntry", "catalogue", "rule", "profile", "forceEntry", "costType", "profileType", "characteristicType"].includes(kind)) continue;
        // `nr-base-size` is BSData's own id for the Unit profile's Base column.
        if (!BSDATA_ID_PATTERN.test(id) && id !== "nr-base-size") duplicates.push(`${doc.file}: ${kind} ${id} is not in BSData's id form`);
        if (seen.has(id)) duplicates.push(`${doc.file}: ${kind} ${id} also in ${seen.get(id)}`);
        seen.set(id, doc.file);
      }
    }
    expect(duplicates.slice(0, 10)).toEqual([]);
  });

  it("resolves every reference within the catalogue, its links and the game system", () => {
    const definitions = (root: BsNode): Set<string> => {
      const ids = new Set<string>();
      for (const { node, kind } of walk(root, "catalogue")) {
        if (["selectionEntry", "selectionEntryGroup", "categoryEntry", "profileType", "characteristicType", "costType", "forceEntry", "rule"].includes(kind)) {
          ids.add(str(node, "id")!);
        }
      }
      return ids;
    };
    const gstIds = definitions(gst);
    const byId = new Map([...roots.values()].map((r) => [str(r, "id")!, r]));
    const sentinels = new Set(["model", "unit", "any", "self", "parent", "force", "roster", "primary-catalogue", "ancestor", "selections", "forces", "associations", "hidden", "category"]);
    // Constraint ids of each entry, which a link to the entry may modify.
    const entryConstraints = new Map<string, Set<string>>();
    for (const r of roots.values()) {
      for (const { node, kind } of walk(r, "catalogue")) {
        if (kind === "selectionEntry") entryConstraints.set(str(node, "id")!, new Set(children(node, "constraints").map((c) => str(c, "id")!)));
      }
    }
    const problems: string[] = [];
    for (const doc of documents.slice(1)) {
      const root = rootOf(doc);
      const visible = new Set([...gstIds, ...definitions(root), str(root, "id")!]);
      for (const link of children(root, "catalogueLinks")) {
        const target = byId.get(str(link, "targetId")!);
        if (!target) problems.push(`${doc.file}: catalogue link to ${str(link, "targetId")}`);
        else for (const id of definitions(target)) visible.add(id);
        if (target) visible.add(str(target, "id")!);
      }
      for (const { node, kind, ancestors } of walk(root, "catalogue")) {
        const refs: [string, string | undefined][] = [
          ["targetId", kind === "catalogueLink" ? undefined : str(node, "targetId")],
          ["typeId", str(node, "typeId")],
          ["childId", str(node, "childId")],
        ];
        if (kind === "modifier") refs.push(["field", str(node, "field")]);
        if (kind === "condition" || kind === "constraint") refs.push(["scope", str(node, "scope")]);
        for (const [key, ref] of refs) {
          if (!ref || sentinels.has(ref) || visible.has(ref)) continue;
          if (key === "field" && ancestors.some((a) => children(a, "constraints").some((c) => str(c, "id") === ref))) continue;
          if (key === "field" && ancestors.some((a) => children(a, "forceEntries").some((f) => children(f, "constraints").some((c) => str(c, "id") === ref)))) continue;
          if (key === "field" && (ref === "name" || ref === "error")) continue;
          if (key === "field" && ancestors.some((a) => entryConstraints.get(str(a, "targetId") ?? "")?.has(ref))) continue;
          if (key === "scope" && ancestors.some((a) => str(a, "id") === ref)) continue;
          // A primary-catalogue condition names a catalogue, which any army can be built from.
          if (key === "childId" && str(node, "scope") === "primary-catalogue" && byId.has(ref)) continue;
          problems.push(`${doc.file}: ${kind}.${key} ${ref}`);
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });
});

describe("BSData export rules agree with the package", () => {
  it("prices every unit as hostUnitPoints does at any size and army copy", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.integer({ min: 1, max: 5 }), (pick, sizePick, ordinal) => {
        const unit = units[pick % units.length];
        const view = dataset.units.byFaction(unit.factionId).find((u) => u.id === unit.unitId)!;
        const counts = modelCounts(view.raw);
        const n = counts[sizePick % counts.length];
        const home = dataset.factions.get(homeFactionOf(dataset, view.raw))!.raw;
        const expected = hostUnitPoints(view.raw, n, ordinal, home);
        const actual = evaluatePoints(unit.entry, PTS, ctxFor(unit, { modelCount: n, earlierCopies: ordinal - 1 }));
        expect({ unit: unit.unitId, n, ordinal, points: actual }).toEqual({ unit: unit.unitId, n, ordinal, points: expected });
      }),
      { numRuns: 2000 },
    );
  });

  it("prices detachment-specific tables while that detachment is selected", () => {
    const priced = units.filter((u) => {
      const raw = dataset.units.byFaction(u.factionId).find((v) => v.id === u.unitId)!.raw;
      return (raw.detachment_pricing ?? []).length > 0;
    });
    expect(priced.length).toBeGreaterThan(0);
    for (const unit of priced) {
      const view = dataset.units.byFaction(unit.factionId).find((u) => u.id === unit.unitId)!;
      for (const tier of view.raw.detachment_pricing ?? []) {
        const catalogue = catalogueOf(unit.factionId);
        const option = children(catalogue, "sharedSelectionEntries").find((e) => e.name === dataset.detachments.getAny(tier.detachment_id)?.name);
        if (!option) continue;
        const n = tier.models;
        const expected = hostUnitPoints(view.raw, n, tier.unit_count_min ?? 1, null, [tier.detachment_id]);
        const selected = new Set([battleSizeId("strike-force"), str(option, "id")!]);
        expect(evaluatePoints(unit.entry, PTS, ctxFor(unit, { modelCount: n, earlierCopies: (tier.unit_count_min ?? 1) - 1, selected }))).toBe(expected);
      }
    }
  });

  it("bounds every wargear item as Dataset.loadoutOf does at every squad size", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (pick, sizePick) => {
        const unit = units[pick % units.length];
        const view = dataset.units.byFaction(unit.factionId).find((u) => u.id === unit.unitId)!;
        const counts = modelCounts(view.raw);
        const n = counts[sizePick % counts.length];
        const bounds = dataset.loadoutOf(view.raw).bounds(n);
        fc.pre(bounds !== null);
        const links = [
          ...children(unit.entry, "entryLinks"),
          ...children(unit.entry, "selectionEntryGroups").filter((g) => g.name !== "Enhancements").flatMap((g) => children(g, "entryLinks")),
        ].filter((l) => l.name !== "Warlord");
        const ctx = ctxFor(unit, { modelCount: n });
        const entryId = str(unit.entry, "id")!;
        const itemName = (id: string): string =>
          (dataset.weapons.byFaction(view.raw.faction_id).find((w) => w.id === id)?.name ?? dataset.weapons.getAny(id)?.name ?? dataset.wargear.getAny(id)?.name ?? "").toLowerCase();
        for (const link of links) {
          const matches = [...bounds!.keys()].filter((id) => itemName(id) === String(link.name).toLowerCase());
          if (matches.length !== 1) continue;
          const bound = bounds!.get(matches[0])!;
          const [min, max] = children(link, "constraints");
          expect({ item: matches[0], n, bounds: [evaluateConstraint(link, str(min, "id")!, entryId, ctx), evaluateConstraint(link, str(max, "id")!, entryId, ctx)] }).toEqual({
            item: matches[0],
            n,
            bounds: [bound.min, bound.max],
          });
        }
        // Every item the unit can carry at this size has a link.
        const linked = new Set(links.map((l) => String(l.name).toLowerCase()));
        for (const [id, bound] of bounds!) if (bound.max > 0) expect(linked.has(itemName(id)), `${unit.unitId} ${id}`).toBe(true);
      }),
      { numRuns: 1500 },
    );
  });

  it("limits datasheets per battle size as roster validation does", () => {
    fc.assert(
      fc.property(fc.nat(), fc.constantFrom("incursion" as const, "strike-force" as const), (pick, size) => {
        const unit = units[pick % units.length];
        const raw = dataset.units.byFaction(unit.factionId).find((u) => u.id === unit.unitId)!.raw;
        const limit = children(unit.entry, "constraints").find((c) => str(c, "field") === "selections")!;
        const keywords = new Set(raw.keywords ?? []);
        const doubled = raw.role === "battleline" || raw.role === "dedicated-transport" || keywords.has("Battleline") || keywords.has("Dedicated Transport");
        const expected = isEpicHero(raw) ? 1 : unitLimitForBattleSize(size)! * (doubled ? 2 : 1);
        const ctx = ctxFor(unit, { selected: new Set([battleSizeId(size)]) });
        expect(evaluateConstraint(unit.entry, str(limit, "id")!, str(unit.entry, "id")!, ctx)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("sets the army's points, detachment-point and enhancement limits per battle size", () => {
    const roster = children(gst, "forceEntries").find((f) => f.name === "Army Roster")!;
    const costTypes = BSDATA_IDS.system.costTypes;
    for (const size of ["incursion", "strike-force"] as const) {
      const ctx: EvalContext = { modelCount: 1, earlierCopies: 0, primaryCatalogueId: "", selected: new Set([battleSizeId(size)]) };
      const value = (field: string): number => {
        const c = children(roster, "constraints").find((x) => str(x, "field") === field)!;
        return evaluateField(roster, "", str(c, "id")!, Number(c.value), ctx);
      };
      expect([value(costTypes.pts), value(costTypes["Detachment Points"]), value(costTypes.Enhancements)]).toEqual([
        pointsLimitForBattleSize(size),
        detachmentCapForBattleSize(size),
        enhancementLimitForBattleSize(size),
      ]);
    }
  });

  it("lets each leader lead exactly the bodyguards the dataset allows", () => {
    const leaders = units.filter((u) => children(u.entry, "associations").length > 0);
    expect(leaders.length).toBeGreaterThan(100);
    for (const leader of leaders) {
      const view = dataset.units.byFaction(leader.factionId).find((u) => u.id === leader.unitId)!;
      const categories = new Map<string, string>();
      for (const root of roots.values()) for (const c of children(root, "categoryEntries")) categories.set(str(c, "id")!, String(c.name));
      const led = children(children(leader.entry, "associations")[0], "conditionGroups")
        .flatMap((g) => children(g, "conditions"))
        .map((c) => categories.get(str(c, "childId")!));
      expect(new Set(led)).toEqual(new Set(dataset.bodyguardsAttachableFrom(view.id, view.factionId).map((b) => b.name)));
    }
  });

  it("costs each detachment its Detachment Points and grants its Force Dispositions", () => {
    const dispositions = new Map(children(gst, "categoryEntries").map((c) => [str(c, "id")!, String(c.name)]));
    let checked = 0;
    for (const faction of dataset.factions.all) {
      for (const detachment of dataset.detachments.byFaction(faction.id)) {
        const root = dataset.factions.get(faction.id)!.raw.parent_faction_id ?? faction.id;
        const option = children(catalogueOf(root), "sharedSelectionEntries").find(
          (e) => e.name === detachment.name && children(e, "costs").some((c) => str(c, "typeId") === BSDATA_IDS.system.costTypes["Detachment Points"]),
        );
        expect(option, detachment.id).toBeDefined();
        const dp = children(option!, "costs").find((c) => str(c, "typeId") === BSDATA_IDS.system.costTypes["Detachment Points"])!;
        expect(dp.value).toBe(detachment.detachment_points ?? 0);
        const granted = children(option!, "categoryLinks")
          .filter((l) => dispositions.has(str(l, "targetId")!))
          .map((l) => dispositions.get(str(l, "targetId")!));
        expect(new Set(granted)).toEqual(new Set((detachment.force_dispositions ?? []).map((d) => dataset.forceDispositions.get(d)!.name)));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });
});

describe("BSData export allied rules agree with the package", () => {
  const hostCatalogueId = (host: string): string => str(catalogueOf(host), "id")!;
  const plansFor = () =>
    allyPlans(dataset, Object.keys(BSDATA_IDS.catalogues)).flatMap((plan) =>
      plan.units.filter((u) => homeFactionOf(dataset, u.raw) !== plan.host).map((unit) => ({ plan, unit })),
    );

  it("prices an allied unit as hostUnitPoints does inside the host army", () => {
    const pairs = plansFor();
    expect(pairs.length).toBeGreaterThan(200);
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.integer({ min: 1, max: 3 }), (pick, sizePick, ordinal) => {
        const { plan, unit } = pairs[pick % pairs.length];
        const entry = units.find((u) => u.factionId === unit.raw.faction_id && u.unitId === unit.id)!;
        const counts = modelCounts(unit.raw);
        const n = counts[sizePick % counts.length];
        const host = dataset.factions.get(plan.host)!.raw;
        const actual = evaluatePoints(entry.entry, PTS, ctxFor(entry, { modelCount: n, earlierCopies: ordinal - 1, primaryCatalogueId: hostCatalogueId(plan.host) }));
        expect({ host: plan.host, unit: unit.id, n, ordinal, points: actual }).toEqual({ host: plan.host, unit: unit.id, n, ordinal, points: hostUnitPoints(unit.raw, n, ordinal, host) });
      }),
      { numRuns: 1500 },
    );
  });

  it("offers each allied unit once in its host army, hidden until a rule offering it is open", () => {
    const offers = new Map<string, { host: string; unit: (typeof units)[number]; rules: AlliedRule[] }>();
    for (const { plan, unit } of plansFor()) {
      const entry = units.find((u) => u.factionId === unit.raw.faction_id && u.unitId === unit.id)!;
      const key = `${plan.host}|${unit.raw.faction_id}/${unit.id}`;
      const offer = offers.get(key) ?? { host: plan.host, unit: entry, rules: [] };
      offer.rules.push(plan.rule);
      offers.set(key, offer);
    }
    const optionId = (detachmentId: string): string => {
      const detachment = dataset.detachments.getAny(detachmentId)!;
      const root = dataset.factions.get(detachment.faction_id)!.raw.parent_faction_id ?? detachment.faction_id;
      return str(children(catalogueOf(root), "sharedSelectionEntries").find((e) => e.name === detachment.name && children(e, "costs").some((c) => str(c, "typeId") === BSDATA_IDS.system.costTypes["Detachment Points"]))!, "id")!;
    };
    for (const { host, unit, rules } of offers.values()) {
      const links = children(catalogueOf(host), "entryLinks").filter((l) => str(l, "targetId") === str(unit.entry, "id") && children(l, "categoryLinks").some((c) => String(c.name).startsWith("Allies:")));
      expect(links.length, `${host} ${unit.unitId}`).toBe(1);
      const ctx = ctxFor(unit, { primaryCatalogueId: str(catalogueOf(host), "id")! });
      const hidden = (selected: string[]): number => evaluateField(links[0], str(unit.entry, "id")!, "hidden", 0, { ...ctx, selected: new Set([...ctx.selected, ...selected]) });
      const gated = rules.every((r) => (r.detachment_ids ?? []).length > 0);
      expect(hidden([]), `${host} ${unit.unitId} closed`).toBe(gated ? 1 : 0);
      for (const rule of rules) for (const d of rule.detachment_ids ?? []) expect(hidden([optionId(d)]), `${host} ${unit.unitId} via ${d}`).toBe(0);
    }
  });

  it("caps each allied rule's points per battle size and locks Warlord and Enhancements in the host army", () => {
    const plans = allyPlans(dataset, Object.keys(BSDATA_IDS.catalogues));
    for (const plan of plans) {
      const category = children(catalogueOf(plan.host), "categoryEntries").find((c) => c.name === `Allies: ${plan.rule.label ?? plan.rule.name}`)!;
      expect(category, `${plan.host} ${plan.rule.id}`).toBeDefined();
      for (const size of ["incursion", "strike-force"] as const) {
        const cap = (plan.rule.points_limits ?? []).find((p) => p.battle_size === size)?.max_points;
        const constraint = children(category, "constraints").find((c) => str(c, "field") === PTS);
        if (cap === undefined) continue;
        const ctx: EvalContext = { modelCount: 1, earlierCopies: 0, primaryCatalogueId: "", selected: new Set([battleSizeId(size)]) };
        expect(evaluateField(category, "", str(constraint!, "id")!, Number(constraint!.value), ctx)).toBe(cap);
      }
      for (const unit of plan.units) {
        const entry = units.find((u) => u.factionId === unit.raw.faction_id && u.unitId === unit.id)!;
        const ctx = ctxFor(entry, { primaryCatalogueId: hostCatalogueId(plan.host) });
        const warlord = children(entry.entry, "entryLinks").find((l) => l.name === "Warlord");
        if (plan.rule.cannot_be_warlord && warlord) expect(evaluateField(warlord, "", "hidden", 0, ctx), `${unit.id} warlord in ${plan.host}`).toBe(1);
        const enhancements = children(entry.entry, "selectionEntryGroups").find((g) => g.name === "Enhancements");
        if (plan.rule.cannot_take_enhancements && enhancements) expect(evaluateField(enhancements, "", "hidden", 0, ctx), `${unit.id} enhancements in ${plan.host}`).toBe(1);
        for (const abilityId of plan.rule.removes_ability_ids ?? []) {
          const name = dataset.abilities.byFaction(unit.raw.faction_id).find((a) => a.id === abilityId)?.name;
          const shown = children(entry.entry, "profiles").find((p) => p.typeName === "Abilities" && p.name === name);
          if (shown) expect(evaluateField(shown, "", "hidden", 0, ctx), `${unit.id} keeps ${abilityId} in ${plan.host}`).toBe(1);
        }
      }
    }
  });
});
