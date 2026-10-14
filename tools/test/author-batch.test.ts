import { describe, expect, it } from "vitest";
import { assembleEffect, buildEntry, buildRepairedEntry, canReplaceEffect, conditionNode, lintCanonical, parseClaudeEnvelope, passesGate, type Proposal } from "../src/author-batch.js";
import { createValidator } from "../src/schema-loader.js";

const ABILITY_SCHEMA_ID = "https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json";

/** A minimally-valid original entry to graft repaired effects onto. */
const ORIGINAL = {
  ability_id: "test-ability",
  name: "X",
  authored_by: "40kdc-community",
  game_version: { edition: "11th", dataslate: "pre-launch-provisional" },
  unit_ids: ["test-unit"],
  ability_type: "unit",
  effect: { type: "stat-modifier", target: "this-model", modifier: {} },
  scope: { duration: "phase" },
  community_notes: "stub",
};

describe("parseClaudeEnvelope", () => {
  it("ignores trailing client warnings without truncating braces inside strings", () => {
    const expected = {
      is_error: false,
      structured_output: { message: 'keeps } and "quoted" text' },
    };
    const envelope = `${JSON.stringify(expected)}\nClient.listTools() warning`;
    expect(parseClaudeEnvelope(envelope)).toEqual(expected);
  });
});

describe("conditionNode", () => {
  it("maps known kinds to condition objects and 'none' to null", () => {
    expect(conditionNode("none", null)).toBeNull();
    expect(conditionNode("vs-keyword", "MONSTER")).toEqual({ type: "has-keyword", parameters: { subject: "defender", all_of: ["MONSTER"] } });
    expect(conditionNode("charged", null)).toEqual({
      type: "happened",
      parameters: { event: "move-ended", filter: { move_types: ["charge"] }, window: "turn" },
    });
    expect(conditionNode("stationary", null)).toEqual({
      type: "happened",
      parameters: { event: "move-ended", filter: { move_types: ["remain-stationary"] }, window: "turn" },
    });
    expect(conditionNode("below-half", null)).toEqual({ type: "strength", parameters: { below: "half" } });
    expect(conditionNode("below-starting", null)).toEqual({ type: "strength", parameters: { below: "starting" } });
    for (const kind of ["attached", "leading"]) {
      expect(conditionNode(kind, null)).toEqual({ type: "attachment", parameters: { subject: "this-model", role: "leading" } });
    }
    expect(conditionNode("phase", "shooting")).toEqual({ type: "phase-is", parameters: { phase: "shooting" } });
  });
});

describe("assembleEffect", () => {
  it("builds an unconditional leaf when condition_kind is none", () => {
    const { effect, scope } = assembleEffect({
      effect_type: "roll-modifier", target: "this-unit", modifier: { operation: "add", roll: "hit", value: 1 },
      attack_type: "any", condition_kind: "none", scope_duration: "phase",
    });
    expect(effect).toEqual({ type: "roll-modifier", target: "this-unit", modifier: { operation: "add", roll: "hit", value: 1 } });
    // An aura's range lives in the target filter, so scope carries only the duration.
    expect(scope).toEqual({ duration: "phase" });
  });

  it("passes a filter target through verbatim (an aura's range stays in within)", () => {
    const target = { owner: "friendly", all_of: ["INFANTRY"], within: { range: { inches: 6 } } };
    const { effect } = assembleEffect({
      effect_type: "stat-modifier", target, modifier: { stat: "OC", operation: "add", value: 1 },
      attack_type: "any", condition_kind: "none", scope_duration: "turn",
    });
    expect(effect.target).toEqual(target);
  });

  it("wraps in a conditional when a condition is set", () => {
    const { effect } = assembleEffect({
      effect_type: "re-roll", target: "this-unit", modifier: { roll: "wound", subset: "all-failures" },
      attack_type: "any", condition_kind: "vs-keyword", condition_param: "VEHICLE", scope_duration: "phase",
    });
    expect(effect.type).toBe("conditional");
    expect(effect.condition).toEqual({ type: "has-keyword", parameters: { subject: "defender", all_of: ["VEHICLE"] } });
    expect(effect.effect.type).toBe("re-roll");
  });

  it("injects attack_type into the modifier as weapon_type for weapon-narrowable effects only", () => {
    const form = (effect_type: string, modifier: Record<string, unknown>) =>
      ({ effect_type, target: "this-unit", modifier, attack_type: "melee", condition_kind: "none", scope_duration: "phase" });
    const melee = assembleEffect(form("stat-modifier", { stat: "A", operation: "add", value: 1 }));
    expect(melee.effect.modifier).toEqual({ stat: "A", operation: "add", value: 1, weapon_type: "melee" });
    // The closed modifiers have no attack_type key; the legacy spelling must not leak.
    expect(melee.effect.modifier.attack_type).toBeUndefined();
    for (const t of ["roll-modifier", "re-roll", "roll-result", "weapon-ability-grant"]) {
      expect(assembleEffect(form(t, {})).effect.modifier.weapon_type, t).toBe("melee");
    }
    // ability-grant has no weapon filter — no injection
    const grant = assembleEffect({ ...form("ability-grant", { ability: "x" }), scope_duration: "permanent" });
    expect(grant.effect.modifier).toEqual({ ability: "x" });
  });

  it("forces an empty modifier for parameterless flag effects", () => {
    for (const effect_type of ["end-attack-sequence", "objective-sticky"]) {
      const { effect } = assembleEffect({ effect_type, target: "this-unit", modifier: { junk: 1 }, attack_type: "melee", condition_kind: "none", scope_duration: "permanent" });
      expect(effect.modifier, effect_type).toEqual({});
    }
  });
});

describe("buildEntry", () => {
  it("preserves the original metadata and replaces effect/scope/notes", () => {
    const original = { ability_id: "x", name: "X", authored_by: "40kdc-community", game_version: { edition: "11th", dataslate: "pre-launch-provisional" }, unit_ids: ["u"], ability_type: "unit", effect: { type: "stat-modifier", target: "this-unit", modifier: {} }, community_notes: "stub" };
    const entry = buildEntry(original, { effect_type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5 }, attack_type: "any", condition_kind: "none", scope_duration: "phase" });
    expect(entry.ability_id).toBe("x");
    expect(entry.authored_by).toBe("40kdc-community");
    expect(entry.unit_ids).toEqual(["u"]);
    expect(entry.effect).toEqual({ type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5 } });
    expect(entry.scope).toEqual({ duration: "phase" });
    expect(entry.community_notes).toBe("community-authored from 10e source (provisional 11e); see #21");
  });

  it("labels a non-provisional 11e snapshot as an 11e source", () => {
    const original = {
      ability_id: "x",
      game_version: { edition: "11th", dataslate: "codex-fixture" },
      effect: { type: "ability-grant", target: "this-unit", modifier: { ability: "deep-strike" } },
    };
    const entry = buildEntry(original, {
      effect_type: "ability-grant",
      target: "this-unit",
      modifier: { ability: "deep-strike" },
      attack_type: "any",
      condition_kind: "none",
      scope_duration: "permanent",
    });
    expect(entry.community_notes).toBe("community-authored from 11e source");
  });
});

describe("buildRepairedEntry", () => {
  const nested = {
    type: "conditional",
    condition: { operator: "not", operands: [{ type: "unit-state", parameters: { state: "battle-shocked" } }] },
    effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } },
  };

  it("grafts a pre-formed nested effect tree verbatim and preserves metadata", () => {
    const entry = buildRepairedEntry(ORIGINAL, nested, { duration: "phase" }, "passive");
    expect(entry.ability_id).toBe("test-ability");
    expect(entry.authored_by).toBe("40kdc-community");
    expect(entry.unit_ids).toEqual(["test-unit"]);
    expect(entry.effect).toBe(nested); // no flat-form assembly — the tree is used as-is
    expect(entry.behavior).toBe("passive");
    expect(entry.community_notes).not.toBe("stub");
  });

  it("drops the stub marker once an authored effect replaces the placeholder", () => {
    const stub = { ...ORIGINAL, stub: true, effect: { type: "no-effect" } };
    expect(buildRepairedEntry(stub, nested, { duration: "phase" }, "passive")).not.toHaveProperty("stub");
    expect(buildEntry(stub, { effect_type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5 }, attack_type: "any", condition_kind: "none", scope_duration: "phase" })).not.toHaveProperty("stub");
  });

  it("only sets behavior when it is a valid enum value", () => {
    expect(buildRepairedEntry(ORIGINAL, nested, { duration: "phase" }, "made-up").behavior).toBeUndefined();
    expect(buildRepairedEntry(ORIGINAL, nested, { duration: "phase" }, undefined).behavior).toBeUndefined();
  });

  it("grafts and removes ability-level repair fields explicitly", () => {
    const original = {
      ...ORIGINAL,
      trigger: { event: "move-ended", subject: { owner: "enemy" } },
      usage: { frequency: "once-per-turn", per: "unit" },
    };
    const entry = buildRepairedEntry(
      original,
      nested,
      { duration: "phase" },
      "reactive",
      {
        trigger: { event: "selected", filter: { to: "shoot" } },
        usage: null,
        applies_to: { required_keywords: ["WARBOSS"] },
      },
    );
    expect(entry.trigger).toEqual({ event: "selected", filter: { to: "shoot" } });
    expect(entry.usage).toBeUndefined();
    expect(entry.applies_to).toEqual({ required_keywords: ["WARBOSS"] });
  });
});

describe("buildRepairedEntry → AJV gate", () => {
  const ajv = createValidator();
  const validate = (x: unknown): boolean => !!ajv.getSchema(ABILITY_SCHEMA_ID)!(x);

  it("accepts a faithful nested tree (compound condition + leaf)", () => {
    const entry = buildRepairedEntry(ORIGINAL, {
      type: "conditional",
      condition: { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "command" } }, { type: "has-keyword", parameters: { all_of: ["INFANTRY"] } }] },
      effect: { type: "ability-grant", target: "this-model", modifier: { ability: "temple-relics-black-templars" } },
    }, { duration: "turn" }, "passive");
    expect(validate(entry)).toBe(true);
  });

  it("rejects an invented condition type — the loose LLM envelope can't smuggle bad enums past AJV", () => {
    const entry = buildRepairedEntry(ORIGINAL, {
      type: "conditional",
      condition: { type: "when-the-stars-align" },
      effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } },
    }, { duration: "phase" });
    expect(validate(entry)).toBe(false);
  });
  it("rejects rerolls carrying both result-selection forms", () => {
    const entry = buildRepairedEntry(ORIGINAL, {
      type: "re-roll",
      target: "this-model",
      modifier: { roll: "advance", subset: "all-failures", result_scope: "any-result" },
    }, { duration: "phase" });
    expect(validate(entry)).toBe(false);
  });

  // Every single effect's modifier is closed, so the schema gate — not the lint — is what
  // stops an invented or legacy modifier key from reaching the cruncher.
  const leaf = (effect: Record<string, unknown>): boolean => validate(buildRepairedEntry(ORIGINAL, effect, { duration: "phase" }));

  it("requires exactly one re-roll result selection, spelled canonically", () => {
    expect(leaf({ type: "re-roll", target: "this-model", modifier: { roll: "advance", result_scope: "any-result" } })).toBe(true);
    expect(leaf({ type: "re-roll", target: "this-model", modifier: { roll: "hit", subset: "ones" } })).toBe(true);
    expect(leaf({ type: "re-roll", target: "this-model", modifier: { roll: "advance", result_scope: "all-results" } })).toBe(false);
    expect(leaf({ type: "re-roll", target: "this-model", modifier: { roll: "advance" } })).toBe(false);
    // The obsolete max_rerolls spelling of count
    expect(leaf({ type: "re-roll", target: "this-model", modifier: { roll: "hit", result_scope: "any-result", max_rerolls: 1 } })).toBe(false);
  });

  it("rejects invented modifier keys on cruncher-interpreted leaves (the silent-over-apply trap)", () => {
    expect(leaf({ type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 2 } })).toBe(true);
    expect(leaf({ type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 2, model_filter: "not-character" } })).toBe(false);
  });

  it("rejects out-of-vocabulary stat, weapon_type, and the legacy attack_type key", () => {
    expect(leaf({ type: "stat-modifier", target: "this-model", modifier: { stat: "Move", operation: "subtract", value: 2 } })).toBe(false);
    expect(leaf({ type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1, weapon_type: "arco-flail" } })).toBe(false);
    expect(leaf({ type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1, attack_type: "melee" } })).toBe(false);
  });

  it("rejects legacy effect targets and a legacy type", () => {
    for (const target of ["self", "bearer", "unit", "friendly-within-aura"]) {
      expect(leaf({ type: "stat-modifier", target, modifier: { stat: "A", operation: "add", value: 1 } }), target).toBe(false);
    }
    expect(leaf({ type: "fight-first", target: "this-unit" })).toBe(false);
    expect(leaf({ type: "ability-grant", target: "this-unit", modifier: { ability: "fights-first" } })).toBe(true);
  });

  it("accepts positive reroll counts and rejects non-positive or fractional counts", () => {
    for (const [count, valid] of [[1, true], [0, false], [-1, false], [1.5, false]] as const) {
      const entry = buildRepairedEntry(ORIGINAL, {
        type: "re-roll",
        target: "this-model",
        modifier: { roll: "hit", result_scope: "any-result", count },
      }, { duration: "phase" });
      expect(validate(entry), `count=${count}`).toBe(valid);
    }
  });
});


describe("lintCanonical", () => {
  it("accepts canonical leaves nested under wrappers", () => {
    const eff = {
      type: "conditional",
      condition: { type: "has-keyword", parameters: { all_of: ["WAR DOG"] } },
      effect: { type: "sequence", steps: [
        { type: "stat-modifier", target: "this-unit", modifier: { stat: "T", operation: "add", value: 1 } },
        { type: "weapon-ability-grant", target: "this-unit", modifier: { abilities: ["Lethal Hits"], weapon_type: "melee" } },
      ] },
    };
    expect(lintCanonical(eff)).toEqual({ canonical: true, issues: [] });
  });

  it("rejects non-canonical conditions beneath every nested wrapper shape", () => {
    // A condition param placed beside `parameters` is invisible to AJV and to the cruncher;
    // the lint must find it however deeply a wrapper nests it.
    const invalidLeaf = {
      type: "conditional",
      condition: { type: "has-keyword", all_of: ["INFANTRY"] },
      effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "add", value: 1 } },
    };
    const wrappers = [
      { name: "aura", effect: { type: "aura", modifier: { effect: invalidLeaf } } },
      { name: "risk reward", effect: { type: "risk-reward", reward: invalidLeaf } },
      { name: "risk failure", effect: { type: "risk-reward", risk: { on_fail: invalidLeaf } } },
      { name: "resource action", effect: { type: "resource-action-menu", actions: [{ effect: invalidLeaf }] } },
      { name: "region default", effect: { type: "named-region-state", modifier: { consumer: { default_branch: { effect: invalidLeaf } } } } },
      { name: "region qualified", effect: { type: "named-region-state", modifier: { consumer: { qualified_branch: { effect: invalidLeaf } } } } },
      { name: "region qualified condition", effect: { type: "named-region-state", modifier: { consumer: { qualified_condition: invalidLeaf.condition } } } },
      { name: "select-units eligibility", effect: { type: "select-units", selector: { owner: "friendly", count: 1, eligibility: invalidLeaf.condition }, effect: invalidLeaf.effect } },
    ];
    for (const wrapper of wrappers) {
      const result = lintCanonical(wrapper.effect);
      expect(result.canonical, wrapper.name).toBe(false);
      expect(result.issues.join(), wrapper.name).toContain('"all_of" must live under "parameters"');
    }
  });

  it("rejects non-canonical conditions beneath action eligibility", () => {
    const result = lintCanonical({
      type: "resource-action-menu",
      actions: [{
        eligibility: { requires: [{ type: "has-keyword", all_of: ["FABRICATED"] }] },
        effect: { type: "no-effect" },
      }],
    });
    expect(result.canonical).toBe(false);
    expect(result.issues.join()).toContain("parameters");
  });

  it("rejects condition params placed top-level instead of under `parameters` (cruncher can't read them)", () => {
    const bad = lintCanonical({ type: "conditional", condition: { type: "has-keyword", all_of: ["TECH-PRIEST"] }, effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } } });
    expect(bad.canonical).toBe(false);
    expect(bad.issues.join()).toContain("parameters");
    const good = lintCanonical({ type: "conditional", condition: { type: "has-keyword", parameters: { all_of: ["TECH-PRIEST"] } }, effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } } });
    expect(good.canonical).toBe(true);
    // Negation is the `not` operator, never a flag beside `parameters`.
    const flagged = lintCanonical({ type: "conditional", condition: { type: "has-keyword", negated: true, parameters: { all_of: ["TECH-PRIEST"] } }, effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } } });
    expect(flagged.issues.join()).toContain("operator");
  });

  it("rejects non-canonical phase condition values", () => {
    const effect = (phase: string) => ({
      type: "conditional",
      condition: { type: "phase-is", parameters: { phase } },
      effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } },
    });
    expect(lintCanonical(effect("command")).canonical).toBe(true);
    const bad = lintCanonical(effect("Shooting"));
    expect(bad.canonical).toBe(false);
    expect(bad.issues.join()).toContain("unknown phase");
  });

  it("rejects non-canonical player-turn condition values", () => {
    const effect = (turn: unknown) => ({
      type: "conditional",
      condition: { type: "player-turn-is", parameters: { turn } },
      effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } },
    });
    expect(lintCanonical(effect("your-turn")).canonical).toBe(true);
    // The legacy spellings the data used to mix are no longer accepted.
    expect(lintCanonical(effect("your")).canonical).toBe(false);
    const bad = lintCanonical(effect(1));
    expect(bad.canonical).toBe(false);
    expect(bad.issues.join()).toContain("unknown turn");
  });

  it("rejects a keyword condition that is not one uppercase unit keyword", () => {
    const effect = (list: "all_of" | "any_of", keywords: string[]) => ({
      type: "conditional",
      condition: { type: "has-keyword", parameters: { subject: "defender", [list]: keywords } },
      effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "A", operation: "add", value: 1 } },
    });
    expect(lintCanonical(effect("all_of", ["VEHICLE"])).canonical).toBe(true);
    expect(lintCanonical(effect("any_of", ["MONSTER", "VEHICLE"])).canonical).toBe(true);
    // The old extraction's capital A, datasheet spelling, and two keywords joined into one —
    // in either list, and even beside a good keyword.
    for (const list of ["all_of", "any_of"] as const) {
      for (const bad of ["A", "Vehicle", "ORKS WALKER"]) {
        expect(lintCanonical(effect(list, ["MONSTER", bad])).issues.join()).toContain(`"${bad}" is not a unit keyword`);
      }
    }
  });

  it("recurses compound-condition operands for stray top-level params", () => {
    const bad = lintCanonical({ type: "conditional", condition: { operator: "and", operands: [{ type: "phase-is", parameters: { phase: "command" } }, { type: "happened", event: "destroyed", object: { owner: "friendly" }, window: "turn" }] }, effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "S", operation: "add", value: 1 } } });
    expect(bad.canonical).toBe(false);
  });
});

describe("passesGate", () => {
  const base: Proposal = {
    ability_id: "a",
    name: "A",
    faction: "f",
    schema_valid: true,
    final_faithful: true,
    confidence: "high",
    complex: false,
    verdict: { faithful: true, severity: "ok", issue: "" },
  };
  it("passes a schema-valid, faithful, high-confidence, non-complex proposal", () => {
    expect(passesGate(base, { minConfidence: "medium", includeComplex: false })).toBe(true);
  });
  it("rejects schema-invalid or unfaithful proposals", () => {
    expect(passesGate({ ...base, schema_valid: false }, { minConfidence: "medium", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, final_faithful: false }, { minConfidence: "medium", includeComplex: false })).toBe(false);
  });

  it("requires an explicit faithful, ok verifier verdict even when the saved summary says faithful", () => {
    expect(passesGate({ ...base, verdict: null }, { minConfidence: "medium", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, verdict: { faithful: true, severity: "minor", issue: "scope" } }, { minConfidence: "medium", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, verdict: { faithful: false, severity: "ok", issue: "condition" } }, { minConfidence: "medium", includeComplex: false })).toBe(false);
  });
  it("rejects low confidence always, and medium when min-confidence is high", () => {
    expect(passesGate({ ...base, confidence: "low" }, { minConfidence: "medium", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, confidence: "medium" }, { minConfidence: "high", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, confidence: "medium" }, { minConfidence: "medium", includeComplex: false })).toBe(true);
  });
  it("gates complex unless explicitly included", () => {
    expect(passesGate({ ...base, complex: true }, { minConfidence: "medium", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, complex: true }, { minConfidence: "medium", includeComplex: true })).toBe(true);
  });
  it("lets a repaired+faithful+canonical proposal through even when complex (the tree expresses it)", () => {
    const repaired: Proposal = { ...base, complex: true, repaired: true, canonical: true };
    expect(passesGate(repaired, { minConfidence: "medium", includeComplex: false })).toBe(true);
  });
  it("still blocks a repaired proposal that is unfaithful, low-confidence, non-canonical, or unencodable", () => {
    expect(passesGate({ ...base, repaired: true, canonical: true, final_faithful: false }, { minConfidence: "medium", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, repaired: true, canonical: true, confidence: "low" }, { minConfidence: "medium", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, repaired: true, canonical: false }, { minConfidence: "medium", includeComplex: false })).toBe(false);
    expect(passesGate({ ...base, repaired: true, canonical: true, unencodable: true }, { minConfidence: "medium", includeComplex: false })).toBe(false);
  });
});

describe("canReplaceEffect", () => {
  const proposal: Proposal = {
    ability_id: "a",
    name: "A",
    faction: "f",
    schema_valid: true,
    final_faithful: true,
    confidence: "high",
    verdict: { faithful: true, severity: "ok", issue: "" },
  };
  const gateOptions = { minConfidence: "medium" as const, includeComplex: false };
  const authored = { effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "A", operation: "add", value: 1 } } };
  it("fills a stub by default but protects an authored effect", () => {
    expect(canReplaceEffect(proposal, { stub: true, effect: { type: "no-effect" } }, { ...gateOptions, reauthor: false })).toBe(true);
    // Older data's empty-modifier placeholder is still a stub.
    expect(canReplaceEffect(proposal, { effect: { type: "stat-modifier", modifier: {} } }, { ...gateOptions, reauthor: false })).toBe(true);
    expect(canReplaceEffect(proposal, authored, { ...gateOptions, reauthor: false })).toBe(false);
    // An authored no-effect (an army-selection rule, say) is not a stub.
    expect(canReplaceEffect(proposal, { effect: { type: "no-effect" } }, { ...gateOptions, reauthor: false })).toBe(false);
  });

  it("replaces an authored effect only when --reauthor is explicit", () => {
    expect(canReplaceEffect(proposal, authored, { ...gateOptions, reauthor: true })).toBe(true);
  });
});
