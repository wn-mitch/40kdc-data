/**
 * The export's allied keyword caps (`ally-keyword-caps.ts`) and Faction keyword
 * replacement (`allies.ts`) against the package's allied checks.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { allyPlans, type AllyPlan } from "../src/bsdata-export/allies.js";
import { unitKeywords } from "../src/bsdata-export/ally-keyword-caps.js";
import { evaluateConstraint, type EvalContext } from "../src/bsdata-export/evaluate.js";
import { bsName } from "../src/bsdata-export/export.js";
import { mintId } from "../src/bsdata-export/ids.js";
import { children, str, type BsNode } from "../src/bsdata-export/source.js";
import { allyKeywordLimitViolations } from "../src/data/roster-allies.js";
import type { UnitView } from "../src/data/entities.js";
import { battleSizeId, dataset, detachmentOption, FACTIONS, loadExportFixture, type ExportFixture, type Size } from "./bsdata-export-fixture.js";

let fx: ExportFixture;
let plans: AllyPlan[];
beforeAll(() => {
  fx = loadExportFixture();
  plans = allyPlans(dataset, FACTIONS);
});

const SIZES: readonly Size[] = ["incursion", "strike-force"];

function entryId(unit: UnitView): string {
  const found = [...fx.entries].find(([, e]) => e.factionId === unit.raw.faction_id && e.unitId === unit.id);
  if (!found) throw new Error(`no entry for ${unit.raw.faction_id}/${unit.id}`);
  return found[0];
}

/** The rule's link to `unit` in the host catalogue, and its categories of the rule. */
function offerOf(plan: AllyPlan, unit: UnitView): { link: BsNode; categoryIds: string[] } {
  const prefix = bsName(`Allies: ${plan.rule.label ?? plan.rule.name}`);
  const link = children(fx.catalogues.get(plan.host)!, "entryLinks").find(
    (l) => str(l, "targetId") === entryId(unit) && children(l, "categoryLinks").some((c) => c.name === prefix),
  );
  if (!link) throw new Error(`${plan.host} does not offer ${unit.id} through ${plan.rule.id}`);
  const categoryIds = children(link, "categoryLinks")
    .filter((c) => String(c.name).startsWith(`${prefix}: `))
    .map((c) => str(c, "targetId")!);
  return { link, categoryIds };
}

/** The keywords of `rule`'s caps the export finds over their maximum for `members` at `size`. */
function exportedOver(plan: AllyPlan, members: readonly UnitView[], size: Size): string[] {
  const counts = new Map<string, number>();
  for (const unit of members) for (const id of offerOf(plan, unit).categoryIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ctx: EvalContext = { modelCount: 1, earlierCopies: 0, primaryCatalogueId: str(fx.catalogues.get(plan.host)!, "id")!, selected: new Set([battleSizeId(fx, size)]), counts: { force: counts } };
  const prefix = bsName(`Allies: ${plan.rule.label ?? plan.rule.name}: `);
  // The rule's own cap categories: two rules in one army can share a label.
  const own = new Set((plan.rule.keyword_limits ?? []).map((l) => mintId(`ally:${plan.host}/${plan.rule.id}:keyword-category:${l.keyword}`)));
  return children(fx.catalogues.get(plan.host)!, "categoryEntries")
    .filter((c) => own.has(str(c, "id")!))
    .flatMap((category) =>
      children(category, "constraints").flatMap((constraint) => {
        const max = evaluateConstraint(category, str(constraint, "id")!, "", ctx);
        return max >= 0 && (counts.get(str(category, "id")!) ?? 0) > max ? [String(category.name).slice(prefix.length)] : [];
      }),
    );
}

function packageVerdict(plan: AllyPlan, members: readonly UnitView[], size: Size): { exceeded: string[]; exclusive: boolean } {
  const violations = allyKeywordLimitViolations(plan.rule, members.map((u) => unitKeywords(u.raw)), size);
  return {
    exceeded: violations.filter((v) => v.code === "ally-keyword-limit-exceeded").map((v) => v.id.slice(plan.rule.id.length + 1)).sort(),
    exclusive: violations.some((v) => v.code === "ally-keyword-limits-exclusive"),
  };
}

function unitIn(plan: AllyPlan, id: string): UnitView {
  const unit = plan.units.find((u) => u.id === id);
  if (!unit) throw new Error(`${plan.rule.id} has no ${id}`);
  return unit;
}

function planFor(ruleId: string, host: string): AllyPlan {
  const plan = plans.find((p) => p.rule.id === ruleId && p.host === host);
  if (!plan) throw new Error(`no plan ${ruleId} in ${host}`);
  return plan;
}

describe("BSData export allied pools", () => {
  it("offers each army the pools Dataset.alliesFor gives it, less the ones whose datasheets are its own picks", () => {
    const rootOf = (f: string): string => dataset.factions.get(f)?.raw.parent_faction_id ?? f;
    const everyDetachment = [...new Set(dataset.alliedRules.all.flatMap((r) => r.detachment_ids ?? []))];
    let offered = 0;
    for (const host of FACTIONS) {
      const exported = plans.filter((p) => p.host === host).map((p) => p.rule.id).sort();
      const expected = dataset
        .alliesFor(host, everyDetachment)
        // A pool of the army's own family is ordinary picks there unless it is exclusive.
        .filter((rule) => rule.exclusive || !rule.source_faction_id || rootOf(rule.source_faction_id) !== rootOf(host))
        .filter((rule) => dataset.allyUnitsFor(rule.id).some((u) => rule.exclusive || rootOf(u.raw.faction_id) !== rootOf(host)))
        .map((rule) => rule.id)
        .sort();
      expect(exported, host).toEqual(expected);
      offered += exported.length;
    }
    expect(offered).toBeGreaterThan(20);
  });

  it("keeps a host-gated pool out of an army its keyword gate alone would admit", () => {
    const gated = dataset.alliedRules.all.filter((r) => (r.host_faction_ids ?? []).length > 0);
    expect(gated.length).toBeGreaterThan(0);
    for (const rule of gated) {
      const keywordOnly = FACTIONS.filter((f) => {
        const kws = new Set((dataset.factions.get(f)?.raw.keywords ?? []).map((k) => k.toLowerCase()));
        const gate = rule.army_keywords_any ?? [];
        return !rule.host_faction_ids!.includes(f) && (gate.length === 0 || gate.some((k) => kws.has(k.toLowerCase())));
      });
      for (const host of keywordOnly) expect(plans.some((p) => p.rule.id === rule.id && p.host === host), `${rule.id} in ${host}`).toBe(false);
    }
  });
});

describe("BSData export allied keyword caps", () => {
  it("rejects an included list exactly when the package's allied keyword checks do", () => {
    const capped = plans.filter((p) => (p.rule.keyword_limits ?? []).length > 0);
    expect(capped.some((p) => p.rule.keyword_limits_exclusive)).toBe(true);
    expect(capped.some((p) => (p.rule.keyword_limits ?? []).some((l) => (l.exemptions ?? []).length > 0))).toBe(true);
    fc.assert(
      fc.property(fc.nat(), fc.constantFrom(...SIZES), fc.array(fc.nat(), { maxLength: 9 }), (planPick, size, picks) => {
        const plan = capped[planPick % capped.length];
        const members = picks.map((p) => plan.units[p % plan.units.length]);
        const verdict = packageVerdict(plan, members, size);
        const over = exportedOver(plan, members, size);
        const label = `${plan.rule.id} in ${plan.host} at ${size}: ${members.map((u) => u.id).join(", ")}`;
        expect(over.length > 0, label).toBe(verdict.exclusive || verdict.exceeded.length > 0);
        // Without alternatives, the export flags the same keywords.
        if (!plan.rule.keyword_limits_exclusive) expect(over.sort(), label).toEqual(verdict.exceeded);
      }),
      { numRuns: 2000 },
    );
  });

  it("counts one Retinue unit as exempt per donor, at most once per receiver", () => {
    const plan = planFor("agents-of-the-imperium-allies", "adeptus-custodes");
    const inquisitor = unitIn(plan, "inquisitor");
    const agents = unitIn(plan, "inquisitorial-agents");
    const navigator = unitIn(plan, "navigator");
    const voidsmen = unitIn(plan, "voidsmen-at-arms");
    const kill = unitIn(plan, "deathwatch-kill-team");
    // Strike force Retinue cap 2: two Inquisitors exempt two Agents.
    expect(exportedOver(plan, [inquisitor, inquisitor, agents, agents, kill, kill], "strike-force")).toEqual([]);
    // A third Agents unit has no donor left.
    expect(exportedOver(plan, [inquisitor, inquisitor, agents, agents, agents, kill, kill], "strike-force")).toEqual(["Retinue"]);
    // A donor without a receiver exempts nothing.
    expect(exportedOver(plan, [inquisitor, kill, kill, kill], "strike-force")).toEqual(["Retinue"]);
    // The two exemptions add up: a Navigator frees a Voidsmen unit, an Inquisitor an Agents unit.
    expect(exportedOver(plan, [inquisitor, navigator, agents, voidsmen, kill, kill], "strike-force")).toEqual([]);
    // Incursion: Retinue 1, one Character.
    expect(exportedOver(plan, [inquisitor, agents, kill], "incursion")).toEqual([]);
    expect(exportedOver(plan, [inquisitor, agents, kill, kill], "incursion")).toEqual(["Retinue"]);
    // Over the Character cap, both Inquisitors still exempt an Agents unit: only Character is over.
    const overCharacters = [kill, agents, inquisitor, inquisitor, agents];
    expect(exportedOver(plan, overCharacters, "incursion")).toEqual(["Character"]);
    expect(packageVerdict(plan, overCharacters, "incursion").exceeded).toEqual(["Character"]);
  });

  it("allows only one of an exclusive rule's limited keywords", () => {
    const plan = planFor("imperial-knights-allies", "adeptus-custodes");
    const armiger = plan.units.find((u) => unitKeywords(u.raw).has("armiger"))!;
    const titanic = plan.units.find((u) => unitKeywords(u.raw).has("titanic"))!;
    expect(exportedOver(plan, [armiger, armiger, armiger], "strike-force")).toEqual([]);
    expect(exportedOver(plan, [titanic], "strike-force")).toEqual([]);
    expect(exportedOver(plan, [titanic, armiger], "strike-force").sort()).toEqual(["Armiger", "Titanic"]);
    expect(packageVerdict(plan, [titanic, armiger], "strike-force").exclusive).toBe(true);
  });
});

describe("BSData export Faction keyword replacement", () => {
  it("gives a Renegades unit the army's Faction categories in place of its own while a gating detachment is selected", () => {
    const plan = planFor("chaos-space-marines-renegades", "chaos-space-marines");
    expect(plan.units.map((u) => u.id).sort()).toEqual(["khorne-berzerkers", "noise-marines", "plague-marines", "rubric-marines"]);
    const category = (name: string): string => str(children(fx.gst, "categoryEntries").find((c) => c.name === bsName(name))!, "id")!;
    const gating = new Set((plan.rule.detachment_ids ?? []).map((d) => str(detachmentOption(fx, dataset.detachments.getAny(d)!), "id")!));
    for (const unit of plan.units) {
      const { link } = offerOf(plan, unit);
      const swaps = children(link, "modifiers").filter((m) => m.field === "category");
      const own = unit.raw.faction_keywords ?? [];
      expect(own.length, unit.id).toBeGreaterThan(0);
      expect(swaps.filter((m) => m.type === "remove").map((m) => m.value).sort(), unit.id).toEqual(own.map((k) => category(`Faction: ${k}`)).sort());
      expect(swaps.filter((m) => m.type === "add").map((m) => m.value).sort(), unit.id).toEqual(["Chaos", "Heretic Astartes"].map((k) => category(`Faction: ${k}`)).sort());
      for (const swap of swaps) {
        const groups = children(swap, "conditionGroups");
        expect(groups.length, unit.id).toBe(1);
        expect(groups[0].type).toBe("or");
        expect(new Set(children(groups[0], "conditions").map((c) => str(c, "childId")))).toEqual(gating);
        expect(children(groups[0], "conditions").every((c) => c.type === "atLeast" && c.value === 1)).toBe(true);
      }
    }
  });

  it("swaps no Faction categories for a rule that keeps them", () => {
    for (const plan of plans.filter((p) => !p.rule.replaces_faction_keywords && p.host !== "chaos-space-marines")) {
      for (const unit of plan.units.slice(0, 3)) {
        const offer = (() => {
          try {
            return offerOf(plan, unit);
          } catch {
            return undefined; // Already on the army's list: no allied link of its own.
          }
        })();
        if (offer) expect(children(offer.link, "modifiers").filter((m) => m.field === "category" && m.type === "remove"), `${plan.rule.id} ${unit.id}`).toEqual([]);
      }
    }
  });
});
