import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";
import { lintCanonical } from "../src/author-batch.js";
import { checkReferentialIntegrity } from "../src/integrity.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";

// Read the faction file, not the globally deduplicated ability index.
// Several reviewed identifiers are shared across factions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const root = resolve(import.meta.dirname, "../..");
const abilities: Json[] = JSON.parse(readFileSync(join(root, "data/enrichment/grey-knights/abilities.json"), "utf8"));
const units: Json[] = JSON.parse(readFileSync(join(root, "data/core/grey-knights/units.json"), "utf8"));
const detachments: Json[] = JSON.parse(readFileSync(join(root, "data/core/grey-knights/detachments.json"), "utf8"));
const ability = (id: string): Json => {
  const found = abilities.filter((a) => a.ability_id === id);
  expect(found).toHaveLength(1);
  return found[0];
};
const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json")!;
function nodes(value: Json): Json[] {
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(nodes)];
}
function modifiers(id: string, type: string): Json[] {
  return nodes(ability(id).effect).filter((n) => n.type === type).map((n) => n.modifier);
}

describe("Grey Knights canonical fidelity", () => {
  for (const id of [
    "dauntless-champions-grey-knights",
    "attuned-onslaught-grey-knights",
    "blessing-of-the-omnissiah-grey-knights",
    "guardians-of-the-machine-grey-knights",
    "techmarine-grey-knights",
    "force-edge-grey-knights",
    "champion-of-the-order-of-purifiers-grey-knights",
    "might-of-titan-grey-knights",
    "warrior-strategist-grey-knights",
    "surge-of-wrath-grey-knights",
    "sanctuary-grey-knights",
    "hammer-aflame-grey-knights",
    "personal-teleporters-grey-knights",
    "indomitable-spirit-grey-knights",
    "righteous-persecution-grey-knights",
    "sanctity-of-purpose-grey-knights",
    "sanctifying-ritual-grey-knights",
    "guidance-of-the-ancients-grey-knights",
    "litanies-of-sanctity-grey-knights",
    "channelled-force-grey-knights",
    "hallowed-ground-grey-knights",
    "fury-of-titan-grey-knights",
    "searing-soulflame-grey-knights",
  ]) {
    it(`${id}: valid canonical structure`, () => {
      const a = ability(id);
      expect(validate(a), JSON.stringify(validate.errors)).toBe(true);
      expect(lintCanonical(a.effect)).toEqual({ canonical: true, issues: [] });
      expect(a.community_notes).toBeUndefined();
    });
  }
  it("accounts for all 25, removes only the obsolete active ability and its references", () => {
    expect(abilities.some((a) => a.ability_id === "wisdom-of-the-ancients-adeptus-astartes")).toBe(false);
    expect(units.every((u) => !(u.ability_ids ?? []).includes("wisdom-of-the-ancients-adeptus-astartes"))).toBe(true);
    expect(ability("prescient-redeployment-grey-knights")).toBeDefined();
  });
  it("Prescient Redeployment uses Gate's prior-window record, not current eligibility", () => {
    const a = ability("prescient-redeployment-grey-knights");
    expect(validate(a), JSON.stringify(validate.errors)).toBe(true);
    expect(a.trigger).toMatchObject({
      event: "phase-started",
      optional: true,
      condition: {
        operator: "and",
        operands: expect.arrayContaining([
          expect.objectContaining({ type: "phase-is", parameters: { phase: "movement" } }),
          expect.objectContaining({ type: "player-turn-is", parameters: { turn: "your-turn" } }),
          expect.objectContaining({ type: "battle-round", parameters: { min: 2 } }),
          expect.objectContaining({
            type: "resource",
            parameters: {
              pool: "ability-selections",
              below_max: true,
              source_ability: { ability_id: "gate-of-infinity-grey-knights", owner: "friendly" },
              at: "opponent-previous-turn-end",
            },
          }),
        ]),
      },
    });
    expect(a.effect.selector).toMatchObject({
      filter: { owner: "friendly", all_of: ["GREY KNIGHTS"] },
      count: { min: 1, max: 1 },
    });
    expect(a.effect.selector.eligibility.operands).toEqual(expect.arrayContaining([
      { type: "matches", parameters: { filter: { state: "on-battlefield" } } },
      {
        type: "eligible",
        parameters: {
          subject: "selected-unit",
          to: "be-selected",
          source_ability: { ability_id: "gate-of-infinity-grey-knights", owner: "friendly" },
          at: "opponent-previous-turn-end",
        },
      },
    ]));
    expect(JSON.stringify(a)).not.toContain("[APPROX]");
  });
  it("Paladin eligibility is evaluated on member MODELS, never Attached-unit keywords", () => {
    const e = ability("attuned-onslaught-grey-knights").effect;
    expect(e.type).toBe("for-each-unit");
    expect(e.selector).toMatchObject({ filter: { owner: "friendly", member_of: "this-unit", all_of: ["PALADIN SQUAD"], level: "model" } });
    expect(e.effect).toMatchObject({ target: "selected-unit", modifier: { stat: "D", value: 1, weapons: { type: "melee" } } });
    expect(ability("attuned-onslaught-grey-knights").trigger).toEqual({ event: "move-ended", filter: { move_types: ["charge"] } });
  });
  it("Might modifies both of this MODEL's melee characteristics and consumes model usage", () => {
    const a = ability("might-of-titan-grey-knights");
    expect(a.effect.steps.map((e: Json) => [e.target, e.modifier.stat, e.modifier.value, e.modifier.weapons?.type])).toEqual([["this-model", "A", 3, "melee"], ["this-model", "S", 3, "melee"]]);
    expect(a.usage).toEqual({ frequency: "n-per-battle", count: 1, per: "model" });
    expect(a.trigger.optional).toBe(true);
  });
  it("repair selection shares a per-target counter across bearers and binds BOTH effects", () => {
    const e = ability("blessing-of-the-omnissiah-grey-knights").effect.effect;
    expect(e.selector).toMatchObject({
      filter: { owner: "friendly", all_of: ["GREY KNIGHTS", "VEHICLE"], level: "model", within: { range: { inches: 3 }, of: "this-model" } },
      count: { min: 0, max: 1 },
      limit: { count: 1, period: "turn" },
    });
    expect(e.effect.steps.map((s: Json) => s.type)).toEqual(["heal", "roll-modifier"]);
    expect(e.effect.steps.every((s: Json) => s.target === "selected-unit")).toBe(true);
  });
  it("cost reductions and both repeated-use directions are explicit permissions", () => {
    const a = ability("warrior-strategist-grey-knights");
    expect(a.usage).toEqual({ frequency: "once-per-battle-round", per: "army" });
    expect(a.effect).toMatchObject({ type: "cost-modifier", modifier: { of: "stratagem", operation: "decrease", amount: 1, applies_to: "the-triggering-use" } });
    expect(modifiers("guardians-of-the-machine-grey-knights", "cost-modifier")[0]).toMatchObject({ of: "stratagem", operation: "decrease", amount: 1, id: "heroic-intervention" });
    // Both directions: this unit again, and a different friendly unit, each named to Heroic Intervention.
    const steps = ability("guardians-of-the-machine-grey-knights").effect.steps.filter((s: Json) => s.type === "permission");
    expect(steps.map((s: Json) => s.target)).toEqual(["this-unit", { owner: "friendly", excluding: "this-unit" }]);
    for (const step of steps) {
      expect(step.modifier).toMatchObject({ activity: "use-stratagem", allow: true, despite: ["stratagem-used-this-phase"], stratagem: "heroic-intervention" });
    }
    expect(JSON.stringify(ability("guardians-of-the-machine-grey-knights"))).not.toContain("overwatch");
    expect(JSON.stringify([a, ability("guardians-of-the-machine-grey-knights")])).not.toMatch(/cp-refund|stratagem-cost-modifier/);
  });
  it("Grand Master and Dreadknight each reference the Warrior Strategist their datasheet prints", () => {
    // The two datasheets print different Warrior Strategist text, so each has its own record (D10).
    for (const [id, rule] of [["grand-master", "warrior-strategist-grey-knights"], ["grand-master-in-nemesis-dreadknight", "warrior-strategist-grand-master-in-nemesis-dreadknight-grey-knights"]]) {
      expect(units.find((u) => u.id === id).ability_ids).toContain(rule);
      expect(ability(rule).unit_ids).toContain(id);
    }
    for (const d of detachments.filter((d) => d.detachment_rule_id)) {
      expect(abilities.some((a) => a.ability_id === d.detachment_rule_id)).toBe(true);
    }
  });
  it("Sanctuary is not accidentally conditional on leading, or a generic ranged modifier", () => {
    const a = ability("sanctuary-grey-knights");
    expect(nodes(a.effect).some((n) => n.type === "attachment")).toBe(false);
    expect(modifiers("sanctuary-grey-knights", "ability-grant")[0].ability).toBe("stealth");
    expect(modifiers("sanctuary-grey-knights", "roll-modifier")[0].weapons).toEqual({ type: "melee" });
  });
  it("Hammer covers every face once, without a second gate or fabricated zero damage", () => {
    const table = nodes(ability("hammer-aflame-grey-knights")).find((n) => n.type === "dice-table");
    expect(table.outcomes.flatMap((o: Json) => o.results)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(table.outcomes.map((o: Json) => o.effect.modifier?.count ?? o.effect.type)).toEqual(["no-effect", 1, "D3", "D3+3"]);
  });
  it("the teleport's eligibility retains each historical gate", () => {
    const a = ability("personal-teleporters-grey-knights");
    expect(a.trigger.condition.operands).toEqual(expect.arrayContaining([
      { operator: "not", operands: [{ type: "matches", parameters: { filter: { state: "engaged" } } }] },
      { operator: "not", operands: [{ type: "happened", parameters: { event: "move-ended", filter: { move_types: ["ingress"] }, window: "turn" } }] },
    ]));
  });
  it("a declined teleport move does NOT prohibit charging", () => {
    const a = ability("personal-teleporters-grey-knights");
    const noCharge = (n: Json) => n.type === "permission" && n.modifier?.activity === "declare-charge" && n.modifier?.allow === false;
    expect(nodes(a.effect).some((n) => n.type === "move" && n.modifier?.move_type === "normal")).toBe(true);
    // The prohibition applies only once the unit has made the teleport move: it must sit under a condition,
    // never as a bare sibling of the optional move.
    expect(nodes(a.effect).some((n) => n.type === "conditional" && nodes(n.effect).some(noCharge))).toBe(true);
    expect(a.trigger.optional).toBe(true);
    expect(a.scope.duration).toBe("turn");
  });
  it("Leadership uses an actual test against CURRENT Leadership, not a hard-coded 6", () => {
    const e = ability("channelled-force-grey-knights").effect;
    expect(e).toMatchObject({ type: "dice-gated", dice: "2D6", threshold: "leadership", comparison: "gte", test: { kind: "leadership", subject: "event-subject" } });
    expect(e.on_success.type).toBe("choice");
    expect(e.on_success.options).toHaveLength(2);
    // The weapons belong to the unit selected to fight: the trigger's subject, or this unit when the trigger is this unit's own.
    const subject = ability("channelled-force-grey-knights").trigger.subject;
    const own = subject == null || subject === "this-unit";
    for (const option of e.on_success.options) {
      expect(option).toMatchObject({
        type: "weapon-ability-grant",
        target: own ? "this-unit" : "event-subject",
        modifier: { weapons: { type: "melee", keyword: { keyword_id: "psychic" } } },
      });
    }
  });
  it("full rerolls are any-result, and the objective upgrade is mutually exclusive", () => {
    for (const m of modifiers("surge-of-wrath-grey-knights", "re-roll")) {
      expect(m.result_scope).toBe("any-result");
      expect(m.subset).toBeUndefined();
    }
    const e = ability("sanctity-of-purpose-grey-knights").effect;
    expect(e.steps).toHaveLength(2);
    expect(e.steps[0].condition).toEqual({ operator: "not", operands: [e.steps[1].condition] });
    expect(e.steps[1].condition.operator).toBeUndefined();
    expect(e.steps[0].effect.modifier).toEqual({ roll: "wound", subset: "ones" });
    expect(e.steps[1].effect.modifier.result_scope).toBe("any-result");
  });
  it("post-shooting selections bind the just-finished attack sequence, not earlier hits", () => {
    for (const id of ["righteous-persecution-grey-knights", "guidance-of-the-ancients-grey-knights"]) {
      const a = ability(id);
      expect(a.trigger.event).toBe("attacks-resolved");
      expect(typeof a.trigger.binds_event_variable).toBe("string");
      const hit = nodes(a.effect).find((n) => n.type === "happened" && n.parameters?.filter?.roll === "hit");
      expect(hit.parameters).toMatchObject({ event: "after-roll", filter: { result: "success", by: { event_var: a.trigger.binds_event_variable } }, window: "event" });
    }
    expect(ability("guidance-of-the-ancients-grey-knights").effect.applies.attacker_filter).toEqual({ level: "model", all_of: ["GREY KNIGHTS"] });
  });
  it("the pinning reaction distinguishes the selecting Purgation unit from its target", () => {
    const a = ability("searing-soulflame-grey-knights");
    expect(a.trigger).toMatchObject({ event: "targets-selected", filter: { kind: "ability" }, subject: { owner: "enemy" }, source_ability: { ability_id: "righteous-persecution-grey-knights", owner: "friendly", keywords: ["PURGATION SQUAD"] } });
    expect(a.effect).toMatchObject({ type: "test", target: "event-object", modifier: { test: "battle-shock", modifier: -1 } });
    expect(units.find((u) => u.id === "purgation-squad").ability_ids).toContain("righteous-persecution-grey-knights");
  });
  it("regional production is continuous/snapshotted as appropriate, independent of attack gates", () => {
    const m = ability("hallowed-ground-grey-knights").effect.modifier;
    expect(m.producer.additive_extensions[0]).toMatchObject({
      kind: "unit-proximity",
      filter: { owner: "friendly", all_of: ["PURIFIER SQUAD", "GREY-KNIGHTS"] },
      range: { inches: 6 },
    });
    expect(m.consumer.attack_condition.operator).toBe("or");
    expect(m.consumer.qualified_condition.operator).toBe("or");
    expect(m.producer.phase_extensions.map((e: Json) => e.condition.parameters.proportion)).toEqual([
      { comparison: "gte", fraction: 0.5 }, { comparison: "gte", fraction: 0.5 },
    ]);
    for (const extension of m.producer.phase_extensions) {
      expect(extension.trigger).toEqual({ event: "phase-started" });
      expect(extension.duration).toBe("phase");
      expect(extension.evaluation).toBe("snapshot-once");
    }
    expect(JSON.stringify(m.producer)).not.toContain("start-of-turn");
    expect(nodes(m).some((n) => n.type === "controls")).toBe(true);
  });
  it.each(["blessing-of-the-omnissiah-grey-knights", "righteous-persecution-grey-knights", "guidance-of-the-ancients-grey-knights", "hallowed-ground-grey-knights"])("%s does not silently flatten unresolved bindings into a damage buff", (id) => {
    const a = ability(id);
    // Test the typed wrapper independently of outer event/phase guards.
    const effect = id === "blessing-of-the-omnissiah-grey-knights" ? a.effect.effect : a.effect;
    const result = effectToBuffs(effect, { kind: "ability", abilityId: id, abilityKind: "unit" }, { phase: "shooting", attackerStationary: false });
    expect(result.applied).toEqual([]);
    // A unit selection is a lever whose eligibility the player vouches for; this one changes no
    // attack, so it offers no lever either.
    expect(result.activatable).toEqual([]);
  });
});

describe("new fidelity grammar rejects misleading alternatives", () => {
  const invalid = (id: string, mutate: (a: Json) => void): void => {
    const a = structuredClone(ability(id)); mutate(a);
    expect(validate(a), JSON.stringify(a)).toBe(false);
  };
  it("rejects fixed 6 or reversed comparison on an actual Leadership test", () => {
    invalid("channelled-force-grey-knights", (a) => { a.effect.threshold = 6; });
    invalid("channelled-force-grey-knights", (a) => { a.effect.comparison = "lte"; });
  });
  it("rejects reduction without an amount", () => invalid("warrior-strategist-grey-knights", (a) => { delete a.effect.modifier.amount; }));
  it("rejects a generic repeated-Stratagem permission without its named restriction", () => invalid("guardians-of-the-machine-grey-knights", (a) => { delete a.effect.steps[2].modifier.stratagem; }));
  it("rejects an unbound source-ability selection event", () => invalid("searing-soulflame-grey-knights", (a) => { delete a.trigger.source_ability; }));
  it("rejects a source-ability filter on an unrelated event", () => invalid("searing-soulflame-grey-knights", (a) => { a.trigger.event = "selected"; a.trigger.filter = { to: "fight" }; }));
  it("rejects invented keys inside the closed source-ability filter", () => invalid("searing-soulflame-grey-knights", (a) => { a.trigger.source_ability.pinned = true; }));
  it("accepts contact range and rejects missing range on unit-region production", () => {
    const contact = structuredClone(ability("hallowed-ground-grey-knights"));
    contact.effect.modifier.producer.additive_extensions[0].range = { inches: 0 };
    expect(validate(contact)).toBe(true);
    invalid("hallowed-ground-grey-knights", (a) => { delete a.effect.modifier.producer.additive_extensions[0].range; });
  });
  it("rejects individual attacker filters on a target-only designation", () => invalid("guidance-of-the-ancients-grey-knights", (a) => { a.effect.applies.to = "target"; }));
  it("rejects fake extra outcomes in no-effect", () => invalid("hammer-aflame-grey-knights", (a) => { a.effect.effect.outcomes[0].effect.amount = 0; }));
  it("checks source-ability references against the source faction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gk-fidelity-"));
    try {
      mkdirSync(join(dir, "enrichment/grey-knights"), { recursive: true });
      const broken = structuredClone(ability("searing-soulflame-grey-knights"));
      broken.trigger.source_ability.ability_id = "missing-source-ability";
      writeFileSync(join(dir, "enrichment/grey-knights/abilities.json"), JSON.stringify([broken]));
      const result = await checkReferentialIntegrity(dir);
      expect(result.failed).toBeGreaterThan(0);
      expect(JSON.stringify(result.errors)).toContain('source_ability \\"missing-source-ability');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("Grey Knights selection cardinality", () => {
  for (const id of ["hammer-aflame-grey-knights", "righteous-persecution-grey-knights", "litanies-of-sanctity-grey-knights"]) {
    it(`${id} requires exactly one target once activated`, () => {
      const selector = (ability(id).effect as unknown as { selector: Record<string, unknown> }).selector;
      expect(selector).toMatchObject({ count: { min: 1, max: 1 } });
      expect(selector.min_count).toBeUndefined();
    });
  }
});
