import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";
import { describeAbility } from "../src/translate/effect.js";
import { lintCanonical } from "../src/author-batch.js";
import { checkReferentialIntegrity } from "../src/integrity.js";
import { effectToBuffs } from "../src/cruncher/from-dsl.js";

// Read the faction file, not the globally deduplicated ability index.
// Several reviewed identifiers are shared across factions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const root = resolve(import.meta.dirname, "../..");
const abilities: Json[] = JSON.parse(readFileSync(join(root, "data/enrichment/grey-knights/abilities.json"), "utf8"));
const astartesAbilities: Json[] = JSON.parse(readFileSync(join(root, "data/enrichment/adeptus-astartes/abilities.json"), "utf8"));
const astartesUnits: Json[] = JSON.parse(readFileSync(join(root, "data/core/adeptus-astartes/units.json"), "utf8"));
const astartesAbility = (id: string): Json => {
  const found = astartesAbilities.filter((a) => a.ability_id === id);
  expect(found).toHaveLength(1);
  return found[0];
};
const units: Json[] = JSON.parse(readFileSync(join(root, "data/core/grey-knights/units.json"), "utf8"));
const detachments: Json[] = JSON.parse(readFileSync(join(root, "data/core/grey-knights/detachments.json"), "utf8"));
const ability = (id: string): Json => {
  const found = abilities.filter((a) => a.ability_id === id);
  expect(found).toHaveLength(1);
  return found[0];
};
const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json")!;
const contracts: Record<string, string[]> = {
  "dauntless-champions-grey-knights": ["selected to fight", "PALADIN SQUAD", "S is less than", "Wound", "melee"],
  "attuned-onslaught-grey-knights": ["Charge move", "PALADIN SQUAD model", "in this model's unit", "Damage", "melee", "end of the turn"],
  "blessing-of-the-omnissiah-grey-knights": ["Command phase", "GREY KNIGHTS VEHICLE model", '3"', "D3 lost wounds", "+1 to Hit", "per turn across your army", "next Command phase"],
  "guardians-of-the-machine-grey-knights": ["enemy unit ends a Charge", '6"', "Engagement Range", "friendly GREY KNIGHTS VEHICLE unit", "Heroic Intervention", "1CP less", "other than the unit", "already been targeted with that Stratagem this phase"],
  "techmarine-grey-knights": ['3"', "friendly", "GREY KNIGHTS VEHICLE unit", "this model gains the Lone Operative"],
  "force-edge-grey-knights": ["not a MONSTER or VEHICLE", "melee weapons", "Armour Penetration"],
  "champion-of-the-order-of-purifiers-grey-knights": ["leading a unit", "Purifying Flame weapons", "Attacks"],
  "might-of-titan-grey-knights": ["start of the Fight phase", "once per battle per model", "Add 3 to the Attacks", "Add 3 to the Strength", "melee weapons equipped by this model", "end of the phase"],
  "warrior-strategist-grey-knights": ["unit is targeted with a Stratagem", "once per battle round per army", "reduce", "that use", "1CP", "to a minimum of 0CP"],
  "surge-of-wrath-grey-knights": ["MONSTER or VEHICLE targets", "Hit roll", "Wound roll", "Damage roll", "this model", "melee"],
  "sanctuary-grey-knights": ["unit gains the Stealth", "attacking unit", "-1 to Hit", "melee"],
  "hammer-aflame-grey-knights": ["selected to fight", "enemy unit", "Engagement Range of this model's unit", "On 1: Nothing", "On 2-3", "On 4-5", "On 6", "D3+3"],
  "personal-teleporters-grey-knights": ["resolves its attacks", "Shooting phase", "your turn", "the unit is unengaged", "ingress move", 'Normal move of up to 6"', "cannot declare a charge", "end of the turn"],
  "indomitable-spirit-grey-knights": ["This model", "eligible to shoot in a turn in which it Fell Back", "declare a charge in a turn in which it Fell Back", "[ASSAULT]", "declare a charge in a turn in which it Advanced"],
  "righteous-persecution-grey-knights": ["during your Shooting phase", "just-finished shooting sequence", "MONSTER", "VEHICLE", "pinned", "Subtract 2", "Move", "-2 to Charge", "start of your next turn"],
  "sanctity-of-purpose-grey-knights": ["Unless the target unit", "objective marker", "re-roll a Wound roll of 1", "you can re-roll the Wound roll"],
  "sanctifying-ritual-grey-knights": ["end of your Command phase", "objective marker you control", "Level of Control", "greater than yours"],
  "guidance-of-the-ancients-grey-knights": ["during your Shooting phase", "just-finished shooting sequence", "friendly GREY KNIGHTS model", "+1 to Hit", "end of the phase"],
  "litanies-of-sanctity-grey-knights": ["start of each phase", "once per battle per model", "GREY KNIGHTS unit", '12"', "that is Battle-shocked", "no longer Battle-shocked"],
  "channelled-force-grey-knights": ["friendly unit is selected to fight", "GREY KNIGHTS", "Leadership test", "current Leadership or higher", "if passed", "select one", "melee weapons with [PSYCHIC]", "[SUSTAINED HITS 1]", "[LETHAL HITS]", "end of the phase"],
  "hallowed-ground-grey-knights": ["deployment zone is always", "start of each phase", "at least half", "opponent's deployment zone", 'within 6"', "PURIFIER SQUAD units", "continuously", "ranged attacks and the target is visible to the attacking model", "GREY KNIGHTS", "Hit rolls of 1", '"PURIFIER SQUAD" or', "wholly within", "instead"],
  "fury-of-titan-grey-knights": ["friendly unit is set up by Deep Strike", "end of the turn", "Hit roll of 1", "Wound roll of 1"],
  "searing-soulflame-grey-knights": ["enemy unit is selected", "Righteous Persecution", "friendly PURGATION SQUAD unit", "must take a Battle-shock test", "-1"],
};
function nodes(value: Json): Json[] {
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(nodes)];
}
function modifiers(id: string, type: string): Json[] {
  return nodes(ability(id).effect).filter((n) => n.type === type).map((n) => n.modifier);
}

describe("Grey Knights fidelity worklist", () => {
  for (const [id, phrases] of Object.entries(contracts)) {
    it(`${id}: valid canonical structure and mechanically diagnostic English`, () => {
      const a = ability(id);
      expect(validate(a), JSON.stringify(validate.errors)).toBe(true);
      expect(lintCanonical(a.effect)).toEqual({ canonical: true, issues: [] });
      const text = describeAbility(a);
      for (const phrase of phrases) expect(text).toContain(phrase);
      expect(text).not.toMatch(/\?|NaN|Once Per Battle Special|Post Attack Debuff|Shoot and Scoot/);
      expect(a.community_notes).toBeUndefined();
    });
  }
  it("accounts for all 25, removes only the obsolete active ability and its references", () => {
    expect(Object.keys(contracts)).toHaveLength(23);
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
              at: "opponents-previous-turn-end",
            },
          }),
        ]),
      },
    });
    expect(a.effect.selector).toMatchObject({ min_count: 1, max_count: 1, keywords: ["GREY KNIGHTS"] });
    expect(a.effect.selector.eligibility.operands).toEqual(expect.arrayContaining([
      { type: "unit-state", parameters: { state: "on-battlefield" } },
      {
        type: "eligible",
        parameters: {
          subject: "selected-unit",
          to: "be-selected",
          source_ability: { ability_id: "gate-of-infinity-grey-knights", owner: "friendly" },
          at: "opponents-previous-turn-end",
        },
      },
    ]));
    expect(JSON.stringify(a)).not.toContain("[APPROX]");
  });
  it("Paladin eligibility is evaluated on member MODELS, never Attached-unit keywords", () => {
    const e = ability("attuned-onslaught-grey-knights").effect;
    expect(e.type).toBe("for-each-unit");
    expect(e.selector).toMatchObject({ target_kind: "model", member_of: "bearer-unit", keywords: ["PALADIN SQUAD"], owner: "friendly" });
    expect(e.effect).toMatchObject({ target: "selected-unit", modifier: { stat: "D", value: 1, weapon_type: "melee" } });
    expect(ability("attuned-onslaught-grey-knights").trigger).toEqual({ event: "move-ended", filter: { move_types: ["charge"] } });
  });
  it("Might modifies both of this MODEL's melee characteristics and consumes model usage", () => {
    const a = ability("might-of-titan-grey-knights");
    expect(a.effect.steps.map((e: Json) => [e.target, e.modifier.stat, e.modifier.value, e.modifier.weapon_type])).toEqual([["this-model", "A", 3, "melee"], ["this-model", "S", 3, "melee"]]);
    expect(a.usage).toEqual({ frequency: "n-per-battle", count: 1, per: "model" });
    expect(a.trigger.optional).toBe(true);
  });
  it("repair selection shares a per-target counter across bearers and binds BOTH effects", () => {
    const e = ability("blessing-of-the-omnissiah-grey-knights").effect.effect;
    expect(e.selector).toMatchObject({ max_count: 1, target_kind: "model", range_inches: 3, keywords: ["GREY KNIGHTS", "VEHICLE"], selection_limit: { count: 1, period: "turn" } });
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
    expect(modifiers("sanctuary-grey-knights", "roll-modifier")[0].weapon_type).toBe("melee");
  });
  it("Hammer covers every face once, without a second gate or fabricated zero damage", () => {
    const table = nodes(ability("hammer-aflame-grey-knights")).find((n) => n.type === "dice-table");
    expect(table.outcomes.flatMap((o: Json) => o.results)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(table.outcomes.map((o: Json) => o.effect.modifier?.count ?? o.effect.type)).toEqual(["no-effect", 1, "D3", "D3+3"]);
  });
  it("the teleport's eligibility negates each gate as a readable clause", () => {
    const a = ability("personal-teleporters-grey-knights");
    expect(a.trigger.condition.operands).toEqual(expect.arrayContaining([
      { operator: "not", operands: [{ type: "unit-state", parameters: { state: "engaged" } }] },
      { operator: "not", operands: [{ type: "happened", parameters: { event: "move-ended", filter: { move_types: ["ingress"] }, window: "turn" } }] },
    ]));
    // A bare "not" in front of a clause ("not the unit made an ingress move") is not English.
    expect(describeAbility(a)).not.toMatch(/\bnot the unit\b/);
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
    expect(e).toMatchObject({ type: "dice-gated", dice: "2D6", threshold: "leadership", comparison: "gte", test: { kind: "leadership", subject: "unit" } });
    expect(e.on_success.type).toBe("choice");
    expect(e.on_success.options).toHaveLength(2);
    // The weapons belong to the unit selected to fight: the trigger's subject, or this unit when the trigger is this unit's own.
    const subject = ability("channelled-force-grey-knights").trigger.subject;
    const own = subject == null || subject === "this-unit";
    for (const option of e.on_success.options) {
      expect(option).toMatchObject({ type: "weapon-ability-grant", target: own ? "this-unit" : "event-subject", modifier: { weapon_type: "melee", weapon_keyword: "Psychic" } });
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
    expect(ability("guidance-of-the-ancients-grey-knights").effect.applies.attacker_keywords).toEqual(["GREY KNIGHTS"]);
  });
  it("the pinning reaction distinguishes the selecting Purgation unit from its target", () => {
    const a = ability("searing-soulflame-grey-knights");
    expect(a.trigger).toMatchObject({ event: "targets-selected", filter: { kind: "ability" }, subject: { owner: "enemy" }, source_ability: { ability_id: "righteous-persecution-grey-knights", owner: "friendly", keywords: ["PURGATION SQUAD"] } });
    expect(a.effect).toMatchObject({ type: "test", target: "event-object", modifier: { test: "battle-shock", modifier: -1 } });
    expect(units.find((u) => u.id === "purgation-squad").ability_ids).toContain("righteous-persecution-grey-knights");
  });
  it("regional production is continuous/snapshotted as appropriate, independent of attack gates", () => {
    const m = ability("hallowed-ground-grey-knights").effect.modifier;
    expect(m.producer.additive_extensions[0]).toMatchObject({ kind: "unit-proximity", radius_inches: 6, activation: { event: "continuous" }, source_gate: { owner: "owner-army", unit_predicate: { keywords: ["PURIFIER SQUAD"] } } });
    expect(m.consumer.attack_condition.operator).toBe("or");
    expect(m.consumer.qualified_condition.operator).toBe("or");
    expect(m.producer.phase_extensions.map((e: Json) => e.control_gate.threshold)).toEqual([
      { comparison: "at-least", fraction: 0.5 }, { comparison: "at-least", fraction: 0.5 },
    ]);
    for (const extension of m.producer.phase_extensions) {
      expect(extension.activation).toMatchObject({ event: "phase-start", evaluation: "snapshot-once" });
      expect(extension.expiry).toEqual({ event: "phase-end" });
    }
    expect(JSON.stringify(m.producer)).not.toContain("start-of-turn");
    expect(nodes(m).some((n) => n.type === "controls")).toBe(false);
  });
  it.each(["blessing-of-the-omnissiah-grey-knights", "righteous-persecution-grey-knights", "guidance-of-the-ancients-grey-knights", "hallowed-ground-grey-knights"])("%s does not silently flatten unresolved bindings into a damage buff", (id) => {
    const a = ability(id);
    // Test the typed wrapper independently of outer event/phase guards.
    const effect = id === "blessing-of-the-omnissiah-grey-knights" ? a.effect.effect : a.effect;
    const result = effectToBuffs(effect, { kind: "ability", abilityId: id, abilityKind: "unit" }, { phase: "shooting", attackerStationary: false });
    expect(result.applied).toEqual([]);
    expect(result.unsupported.some((u) => u.reason.includes("predicates are not resolved"))).toBe(true);
  });
});

describe("new fidelity grammar rejects misleading alternatives", () => {
  const invalid = (id: string, mutate: (a: Json) => void): void => {
    const a = structuredClone(ability(id)); mutate(a);
    expect(validate(a), JSON.stringify(a)).toBe(false);
  };
  it("rejects whole-unit member selection", () => invalid("attuned-onslaught-grey-knights", (a) => { a.effect.selector.target_kind = "unit"; }));
  it("rejects enemy models masquerading as bearer-unit members", () => invalid("attuned-onslaught-grey-knights", (a) => { a.effect.selector.owner = "enemy"; }));
  it("rejects fixed 6 or reversed comparison on an actual Leadership test", () => {
    invalid("channelled-force-grey-knights", (a) => { a.effect.threshold = 6; });
    invalid("channelled-force-grey-knights", (a) => { a.effect.comparison = "lte"; });
  });
  it("rejects reduction without an amount", () => invalid("warrior-strategist-grey-knights", (a) => { delete a.effect.modifier.amount; }));
  it("rejects a generic repeated-Stratagem permission without its named restriction", () => invalid("guardians-of-the-machine-grey-knights", (a) => { delete a.effect.steps[2].modifier.stratagem; }));
  it("rejects an unbound source-ability selection event", () => invalid("searing-soulflame-grey-knights", (a) => { delete a.trigger.source_ability; }));
  it("rejects a source-ability filter on an unrelated event", () => invalid("searing-soulflame-grey-knights", (a) => { a.trigger.event = "selected"; a.trigger.filter = { to: "fight" }; }));
  it("rejects invented keys inside the closed source-ability filter", () => invalid("searing-soulflame-grey-knights", (a) => { a.trigger.source_ability.pinned = true; }));
  it("rejects zero-distance or non-continuous unit-region production", () => {
    invalid("hallowed-ground-grey-knights", (a) => { a.effect.modifier.producer.additive_extensions[0].radius_inches = 0; });
    invalid("hallowed-ground-grey-knights", (a) => { delete a.effect.modifier.producer.additive_extensions[0].activation; });
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
      expect(selector).toMatchObject({ min_count: 1, max_count: 1 });
      expect(selector.count).toBeUndefined();
    });
  }
});
