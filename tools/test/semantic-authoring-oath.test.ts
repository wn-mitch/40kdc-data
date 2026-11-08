import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

type Node = Record<string, any>;
const PARENT = "example-covenant";
const BINDING = { ability: PARENT, subject: "this-unit" };
const DOMAINS = { ...BINDING, domains: ["deed", "quality"] };

function leaves(items: [string, Record<string, unknown>][]): CompileLeaf[] {
  return items.map(([family_id, parameters], index) => ({
    family_id, parameters, family_version: currentFamilyVersion(family_id), role: familyRole(family_id, currentFamilyVersion(family_id)),
    start_byte: index * 10, end_byte: index * 10 + 5, fragment: "EXAMPLE",
  }));
}

function example(amount = 4, duration?: string): CompileLeaf[] {
  return leaves([
    ["turn-start", { turn: "player-turn" }],
    ["oath-fulfilled", { ability: PARENT }],
    ["oath-determine", BINDING],
    ["oath-selection-history", DOMAINS],
    ["oath-duplicate-result", DOMAINS],
    ["oath-exhaustion", DOMAINS],
    ["oath-quality-persistence", { ability: PARENT, recipient_ability: "example-initiates", owner: "friendly", ...(duration ? { duration } : {}) }],
    ["oath-deed-reward", { ...BINDING, applies_to: "additional" }],
    ["instead", {}],
    ["resource-gain", { pool: "command-point", amount }],
    ["oath-reward-selection", { method: "any" }],
  ]);
}

function mechanics(input = example()): Node {
  const result = compileLeaves(input);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}
const policy = (result: Node, aspect: string): Node => result.effect.steps.find((step: Node) => step.modifier?.aspect === aspect);

describe("compositional Oath procedure policies", () => {
  it("repeats the parent procedure only at the controller turn start after fulfilment", () => {
    const result = mechanics();
    expect(result.trigger).toBeNull();
    expect(result.effect.steps[0]).toEqual({
      type: "ability-part",
      trigger: { event: "turn-started", condition: { type: "player-turn-is", parameters: { turn: "your-turn" } } },
      effect: {
        type: "conditional", condition: { type: "oath-state", parameters: { ability: PARENT, state: "fulfilled" } },
        effect: { type: "ability-activate", target: "this-unit", modifier: { ability: PARENT, procedure: "oath" } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("additional-oath");
    expect(JSON.stringify(result)).not.toContain("stance-select");
  });

  it("preserves selection history, duplicate replacement rather than reroll, and BOTH-domain exhaustion", () => {
    const result = mechanics();
    expect(policy(result, "selection")).toEqual({
      type: "oath-modifier", target: "this-unit",
      modifier: { ability: PARENT, aspect: "selection", domains: ["deed", "quality"], exclude_previously_selected: true, duplicate_roll: "choose-unselected", stop_when: "all-domains-exhausted" },
    });
    const differentDomains = example().map((leaf) => leaf.family_id === "oath-exhaustion" ? { ...leaf, parameters: { ...leaf.parameters, domains: ["quality"] } } : leaf);
    const selections = mechanics(differentDomains).effect.steps.filter((step: Node) => step.modifier?.aspect === "selection");
    expect(selections).toHaveLength(2);
    expect(selections[0].modifier.stop_when).toBeUndefined();
    expect(selections[1].modifier.domains).toEqual(["quality"]);
  });

  it("binds a separate duplicate replacement connective without consuming the reward replacement", () => {
    const input = example();
    const duplicateInstead: CompileLeaf = { ...input[8]!, start_byte: 45, end_byte: 49 };
    const result = mechanics([...input.slice(0, 5), duplicateInstead, ...input.slice(5)]);
    expect(policy(result, "selection").modifier.duplicate_roll).toBe("choose-unselected");
    expect(policy(result, "deed-reward").modifier.operation).toBe("replace");
    expect(result.effect.steps[0].effect.effect.modifier.procedure).toBe("oath");
  });

  it("keeps fulfilled qualities independent of the activation gate and does not invent a lifetime", () => {
    const retained = policy(mechanics(), "quality-persistence");
    expect(retained).toEqual({
      type: "oath-modifier", target: { owner: "friendly", level: "model", has_ability: ["example-initiates"] },
      modifier: { ability: PARENT, aspect: "quality-persistence", from: "fulfilled" },
    });
    expect(policy(mechanics(example(7, "turn")), "quality-persistence").modifier.duration).toBe("turn");
  });

  it("nests the supplied replacement reward at additional-Deed completion, regardless of selection method", () => {
    const result = mechanics(example(7));
    expect(policy(result, "deed-reward")).toEqual({
      type: "oath-modifier", target: "this-unit",
      modifier: { ability: PARENT, aspect: "deed-reward", applies_to: "additional", operation: "replace", selection_method: "any", effect: { type: "cp-gain", target: "this-model", modifier: { amount: 7 } } },
    });
    expect(result.effect.steps.some((step: Node) => step.type === "cp-gain")).toBe(false);
    const randomOnly = example().map((leaf) => leaf.family_id === "oath-reward-selection" ? { ...leaf, parameters: { method: "random" } } : leaf);
    expect(policy(mechanics(randomOnly), "deed-reward").modifier.selection_method).toBe("random");
  });

  it("compiles a different reward through the existing effect compiler without a CP recipe", () => {
    const input = example().map((leaf) => leaf.family_id === "resource-gain"
      ? { ...leaf, parameters: { pool: "example-token-pool", amount: 3 } } : leaf);
    expect(policy(mechanics(input), "deed-reward").modifier.effect).toEqual({
      type: "resource-gain", target: "this-model", modifier: { pool: "example-token-pool", amount: 3 },
    });
  });

  it("validates through the actual closed DSL schema", () => {
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    expect(validate(mechanics().effect), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(mechanics(example(7, "turn")).effect), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ type: "ability-activate", target: "this-unit", modifier: { ability: PARENT, procedure: "oath", option: "invented" } })).toBe(false);
    expect(validate({ type: "oath-modifier", target: "this-unit", modifier: { ability: PARENT, aspect: "selection", domains: ["deed"] } })).toBe(false);
  });

  it.each(["instead", "resource-gain", "oath-reward-selection"])("refuses to guess a missing reward component: %s", (missing) => {
    const result = compileLeaves(example().filter((leaf) => leaf.family_id !== missing));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("Oath deed reward");
  });

  it("rejects duplicate policies, duplicate domains, unknown parameters, and orphan reward qualifiers", () => {
    const input = example();
    expect(compileLeaves([...input, { ...input[3]!, start_byte: 200 }]).ok).toBe(false);
    expect(compileLeaves(leaves([["oath-reward-selection", { method: "any" }]])).ok).toBe(false);
    expect(() => normalizeFingerprintParameters("oath-exhaustion", { ...DOMAINS, domains: ["deed", "deed"] })).toThrow(/twice/);
    expect(() => normalizeFingerprintParameters("oath-determine", { ...BINDING, option: "invented" })).toThrow(/exactly/);
  });
});
