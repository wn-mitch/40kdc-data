import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { createValidator } from "../src/schema-loader.js";
import { DESIGNATION_IDS } from "../src/translate/designations.js";

/**
 * Re-designation (compile-redesignate.ts): a persistent designation whose trailing sentence selects
 * a replacement when the designated unit is destroyed. Wording is fabricated; each sentence is one
 * fragment letter, which is how the compiler finds sentence breaks without source text.
 */

const ajv = createValidator();
const effectOk = ajv.getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;

function leaf(role: string, familyId: string, parameters: Record<string, unknown>, fragment: string, version = 1): CompileLeaf {
  return { role, family_id: familyId, family_version: version, parameters, start_byte: 0, fragment };
}

const select = (fragment: string, extra: Record<string, unknown> = {}) =>
  leaf("EVENT", "select-unit", { scope: "enemy", distance: "any", visible: false, ...extra }, fragment, 4);
const open = (fragment: string, timing: string, designation = "quarry", beneficiary = "this-model") =>
  leaf("EFFECT", "persistent-designation-open", { designation, scope: "enemy-unit", timing, beneficiary }, fragment);
const destroyed = (fragment: string) => leaf("EVENT", "event", { kind: "unit-destroyed" }, fragment, 18);
const attack = (fragment: string) => leaf("EVENT", "attack", { direction: "makes", unit: "this-model", attack_type: "melee" }, fragment, 6);
const designatedFilter = (fragment: string, tag = "quarry") => leaf("CONDITION", "designated-filter", { subject: "event-object", tag }, fragment, 1);
const reroll = (fragment: string, roll: string) => leaf("EFFECT", "reroll", { roll, subset: "all", weapon_type: "all" }, fragment, 5);

/** The 2130 shape: establish in A, a melee attack re-roll in B, the replacement in C. */
function redesignate(tail: CompileLeaf[] = [destroyed("C"), select("C"), open("C", "on-unit-destroyed")]): CompileLeaf[] {
  return [
    select("A"),
    open("A", "start-of-first-battle-round"),
    attack("B"),
    designatedFilter("B"),
    reroll("B", "hit"),
    reroll("B", "wound"),
    ...tail,
  ];
}

const effectOf = (leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics.effect as Record<string, any>;
};
const errorsOf = (leaves: CompileLeaf[]): string[] => {
  const result = compileLeaves(leaves);
  return result.ok ? [] : result.errors;
};

describe("Round 5C re-designation: replacement tail", () => {
  it("compiles the re-designation to a replace-on-destroyed selection that validates", () => {
    const effect = effectOf(redesignate());
    expect(effect).toMatchObject({
      type: "persistent-designation",
      designation: "quarry",
      select: { scope: "enemy-unit", count: 1, timing: "start-of-first-battle-round", selection_policy: "replace-on-destroyed", bind_as: "quarry-selection" },
      consumer: { relation: "attacks-selected-unit", beneficiary: "bearer", reference: { selection_var: "quarry-selection" } },
      lifecycle: {
        replace: { event: "on-unit-destroyed", reference: { selection_var: "quarry-selection" }, optional: false },
        exclusivity: "one-active-per-bearer-unit",
        expiry: "battle-end",
      },
      duration: "battle",
    });
    expect(effectOk(effect)).toBe(true);
    expect(effectOk.errors).toBeNull();
  });

  it("makes the replacement optional when its trigger's sentence says you may", () => {
    const effect = effectOf(redesignate([destroyed("C"), leaf("RESTRICTION", "optional-use", { who: "you" }, "C"), select("C"), open("C", "on-unit-destroyed")]));
    expect(effect.lifecycle.replace.optional).toBe(true);
    expect(effectOk(effect)).toBe(true);
  });

  it("makes the replacement optional when its selection is up to one", () => {
    const effect = effectOf(redesignate([destroyed("C"), select("C", { count: 1, up_to: true }), open("C", "on-unit-destroyed")]));
    expect(effect.lifecycle.replace.optional).toBe(true);
    expect(effect.select.selection_policy).toBe("replace-on-destroyed");
    expect(effectOk(effect)).toBe(true);
  });

  it("compiles a replacement with no selection of its own, using the origin's selection", () => {
    const effect = effectOf(redesignate([destroyed("C"), leaf("RESTRICTION", "optional-use", { who: "you" }, "C"), open("C", "on-unit-destroyed")]));
    expect(effect.lifecycle.replace.optional).toBe(true);
    expect(JSON.stringify(effect)).not.toContain("select-units");
    expect(effectOk(effect)).toBe(true);
  });

  it("keeps a standalone destruction-timed selection as it was", () => {
    const effect = effectOf([
      destroyed("A"), select("A"), open("A", "on-unit-destroyed", "unbridled-ardour-slayer"),
      reroll("B", "hit"),
    ]);
    expect(effect.select).toEqual({ scope: "enemy-unit", count: 1, timing: "on-unit-destroyed", selection_policy: "one-time" });
    expect(effect.lifecycle).toBeUndefined();
  });

  it("refuses a trailing sentence with no unit-destroyed trigger", () => {
    expect(errorsOf(redesignate([select("C"), open("C", "on-unit-destroyed")]))).toEqual(
      ["persistent-designation-open needs exactly one sentence after it, its own effect."],
    );
  });

  it("refuses a replacement trigger that carries a parameter besides its kind", () => {
    const errors = errorsOf(redesignate([{ ...destroyed("C"), parameters: { kind: "unit-destroyed", subject: "this-unit" } }, select("C"), open("C", "on-unit-destroyed")]));
    expect(errors.join(" ")).toMatch(/one trigger/u);
  });

  it("refuses a replacement that names another designation than the one it replaces", () => {
    const errors = errorsOf([
      select("A"), open("A", "start-of-first-battle-round"), attack("B"), designatedFilter("B"), reroll("B", "hit"),
      destroyed("C"), select("C"), open("C", "on-unit-destroyed", "prey"),
    ]);
    expect(errors.join(" ")).toMatch(/same designation, scope and beneficiary/u);
  });

  it("refuses a second replacement for one designation", () => {
    const errors = errorsOf([...redesignate(), destroyed("D"), select("D"), open("D", "on-unit-destroyed")]);
    expect(errors.join(" ")).toMatch(/only one on-unit-destroyed selection/u);
  });

  it("refuses a replacement selection of two units", () => {
    expect(errorsOf(redesignate([destroyed("C"), select("C", { count: 2 }), open("C", "on-unit-destroyed")])).join(" ")).toMatch(/selects one unit/u);
  });

  it("refuses a replacement that carries a re-roll", () => {
    expect(errorsOf(redesignate([destroyed("C"), reroll("C", "wound"), select("C"), open("C", "on-unit-destroyed")])).join(" ")).toMatch(/takes only its trigger/u);
  });

  it("refuses a replacement selection that filters beyond the enemy side", () => {
    expect(errorsOf(redesignate([destroyed("C"), select("C", { filter: { keywords: ["Monster"] } }), open("C", "on-unit-destroyed")])).join(" ")).toMatch(/only filter by the enemy side/u);
  });

  it("refuses a replacement selection with a visibility requirement", () => {
    expect(errorsOf(redesignate([destroyed("C"), select("C", { visible: true }), open("C", "on-unit-destroyed")])).join(" ")).toMatch(/visibility/u);
  });

  it("refuses a replacement selection whose unit-filter carries a keyword", () => {
    const filtered = leaf("CONDITION", "unit-filter", { side: "enemy", keywords: ["Monster"] }, "C");
    expect(errorsOf(redesignate([destroyed("C"), select("C"), filtered, open("C", "on-unit-destroyed")])).join(" ")).toMatch(/only filter by the enemy side/u);
  });

  it("refuses a replacement selection with a distance other than any", () => {
    expect(errorsOf(redesignate([destroyed("C"), select("C", { distance: "within-range" }), open("C", "on-unit-destroyed")])).join(" ")).toMatch(/distance/u);
  });

  it("refuses an establishment that selects more than one unit", () => {
    const errors = errorsOf([select("A", { count: 2 }), open("A", "start-of-first-battle-round"), attack("B"), reroll("B", "hit")]);
    expect(errors.join(" ")).toMatch(/one unit/u);
  });
});

describe("Round 5C re-designation: optional establishment", () => {
  it("wraps an establishment declined by 'you can' in an optional part, not the ability", () => {
    const result = compileLeaves([
      leaf("RESTRICTION", "optional-use", { who: "you" }, "A"),
      select("A"),
      open("A", "start-of-first-battle-round", "mark"),
      attack("B"),
      reroll("B", "wound"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.behavior).not.toBe("activated");
    expect(result.mechanics.effect).toMatchObject({ type: "ability-part", optional: true, effect: { type: "persistent-designation", designation: "mark" } });
    expect(JSON.stringify(result.mechanics.effect)).not.toContain("select-units");
    expect(effectOk(result.mechanics.effect)).toBe(true);
  });

  it("wraps an establishment that selects up to one, with no second selection around it", () => {
    const result = compileLeaves([
      select("A", { count: 1, up_to: true }),
      leaf("CONDITION", "unit-filter", { side: "enemy" }, "A"),
      open("A", "start-of-first-battle-round", "hunted"),
      attack("B"),
      reroll("B", "wound"),
      destroyed("C"),
      select("C", { count: 1, up_to: true }),
      open("C", "on-unit-destroyed", "hunted"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.effect).toMatchObject({ type: "ability-part", optional: true, effect: { type: "persistent-designation", lifecycle: { replace: { optional: true } } } });
    expect(JSON.stringify(result.mechanics.effect)).not.toContain("select-units");
    expect(effectOk(result.mechanics.effect)).toBe(true);
  });
});

describe("Round 5C re-designation: start timing", () => {
  it("takes 'at the start of the first battle round' as the designation's timing, not a second trigger or gate", () => {
    const result = compileLeaves([
      leaf("EVENT", "turn-start", { turn: "battle-round" }, "A", 1),
      leaf("CONDITION", "battle-round", { min: 1, max: 1 }, "A", 2),
      select("A"), open("A", "start-of-first-battle-round"), attack("B"), reroll("B", "wound"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.trigger).toBeNull();
    expect(result.mechanics.effect).toMatchObject({ type: "persistent-designation", select: { timing: "start-of-first-battle-round" } });
  });

  it("takes 'at the start of the battle' the same way, as the designation's timing", () => {
    const result = compileLeaves([
      leaf("EVENT", "event", { kind: "battle-started" }, "A", 18), select("A"), open("A", "start-of-first-battle-round", "hated-foe"), attack("B"), reroll("B", "wound"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.trigger).toBeNull();
    expect(result.mechanics.effect).toMatchObject({ type: "persistent-designation", designation: "hated-foe" });
  });

  it("keeps a battle-round gate that is not round one as the ability's gate, not the designation's timing", () => {
    const result = compileLeaves([
      leaf("CONDITION", "battle-round", { min: 2 }, "A", 2),
      select("A"), open("A", "start-of-first-battle-round"), attack("B"), reroll("B", "wound"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.effect).toMatchObject({ type: "conditional", condition: { type: "battle-round", parameters: { min: 2 } }, effect: { type: "persistent-designation" } });
    expect(effectOk(result.mechanics.effect)).toBe(true);
  });
});

describe("Round 5C re-designation: weapon-scope consumer", () => {
  it("reads a subject-less designated filter in a weapon-property scope as the target", () => {
    const result = compileLeaves([
      select("A", { count: 1, up_to: true }),
      leaf("CONDITION", "unit-filter", { side: "enemy" }, "A"),
      open("A", "start-of-first-battle-round", "quarry", "this-unit"),
      leaf("CONDITION", "weapon-property-scope", { subject: "this-unit", weapon_type: "all" }, "B"),
      leaf("CONDITION", "designated-filter", { tag: "quarry" }, "B"),
      leaf("EFFECT", "weapon-ability-keyword", { keyword: "Devastating Wounds" }, "B"),
      leaf("EFFECT", "weapon-ability-keyword", { keyword: "Precision" }, "B"),
      destroyed("C"), select("C"), leaf("CONDITION", "unit-filter", { side: "enemy" }, "C"), open("C", "on-unit-destroyed", "quarry", "this-unit"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mechanics.effect).toMatchObject({ type: "ability-part", optional: true, effect: { type: "persistent-designation", lifecycle: { replace: { optional: false } } } });
    expect(JSON.stringify(result.mechanics.effect)).toContain('"subject":"defender"');
    expect(effectOk(result.mechanics.effect)).toBe(true);
  });
});

describe("Round 5C re-designation: beneficiary this-unit (2146 shape)", () => {
  it("compiles a unit-held designation whose attacks and replacement name the unit", () => {
    const origin = leaf("EFFECT", "persistent-designation-open", { designation: "prey", scope: "enemy-unit", timing: "start-of-first-battle-round", beneficiary: "this-unit" }, "A");
    const replacement = leaf("EFFECT", "persistent-designation-open", { designation: "prey", scope: "enemy-unit", timing: "on-unit-destroyed", beneficiary: "this-unit" }, "C");
    const effect = effectOf([
      select("A"), origin,
      leaf("EVENT", "attack", { direction: "makes", unit: "this-unit", attack_type: "melee" }, "B", 6),
      designatedFilter("B", "prey"), reroll("B", "wound"),
      destroyed("C"), select("C"), replacement,
    ]);
    expect(effect).toMatchObject({ type: "persistent-designation", designation: "prey", consumer: { beneficiary: "unit" }, lifecycle: { replace: { optional: false } } });
    expect(effectOk(effect)).toBe(true);
  });
});

describe("Round 5C re-designation: names and registry", () => {
  it("spells a registered designation in its registry id on the opener and on the consumer's condition", () => {
    const effect = effectOf([
      select("A"), open("A", "start-of-first-battle-round", "hated foe"), attack("B"), designatedFilter("B", "hated foe"), reroll("B", "wound"),
    ]);
    expect(effect.designation).toBe("hated-foe");
    expect(JSON.stringify(effect.consumer)).toContain('"tag":"hated-foe"');
    expect(JSON.stringify(effect.consumer)).not.toContain("hated foe");
  });

  it("keeps an unregistered designation name as written", () => {
    const effect = effectOf([select("A"), open("A", "start-of-first-battle-round", "Quarry Mark"), attack("B"), reroll("B", "wound")]);
    expect(effect.designation).toBe("Quarry Mark");
  });

  it("registers mark as a designation id", () => {
    expect(DESIGNATION_IDS.has("mark")).toBe(true);
    expect(DESIGNATION_IDS.has("marked")).toBe(true);
  });
});
