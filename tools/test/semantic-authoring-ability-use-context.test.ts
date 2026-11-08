import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { abilityUseCondition, foldAbilityUseContext } from "../src/semantic-authoring/compile-ability-use.js";
import { createValidator } from "../src/schema-loader.js";

type Node = Record<string, any>;

/** Fabricated labels deliberately contain no source rule prose. */
function example() {
  const rows: Array<[string, Record<string, unknown>]> = [
    ["unit-filter", { side: "friendly", level: "model" }],
    ["event", { kind: "used", activity: "ability", ability_keyword: "TEST-LINK", bind_as: "test-use" }],
    ["ability-use-history", { event_var: "test-use", owner: "friendly", level: "model", actor: "other", ability: "same", window: "turn", negated: true }],
    ["optional-use", { who: "you" }],
    ["select-unit", { scope: "friendly", distance: "any", visible: false, count: 4, up_to: true }],
    ["unit-filter", { side: "friendly", level: "model", keywords: ["TEST-RECIPIENT"] }],
    ["instead", {}],
    ["unit-position", { subject: "selected-unit", kind: "within", of: "event-subject", inches: 8, negated: false }],
    ["unit-position", { subject: "selected-unit", kind: "within", of: "event-subject", inches: 11, negated: false }],
    ["army-state", { owner: "friendly", state: "honoured" }],
    ["designated-filter", { subject: "selected-unit", tag: "bondsman-affected", negated: true }],
    ["duration", { endpoint: "start-of-next-command-phase" }],
    ["ability-selection-override", { event_var: "test-use" }],
  ];
  let offset = 0;
  const leaves = rows.map(([family, parameters]): CompileLeaf => {
    const version = currentFamilyVersion(family);
    const leaf = { family_id: family, family_version: version, role: familyRole(family, version), parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: offset, end_byte: offset + 4, fragment: "RAW_TEXT" };
    offset += 5;
    return leaf;
  });
  return { leaves, text: rows.map(() => "test").join(" ") };
}

function nodes(value: unknown, type: string): Node[] {
  if (Array.isArray(value)) return value.flatMap((item) => nodes(item, type));
  if (value === null || typeof value !== "object") return [];
  const node = value as Node;
  return [...(node.type === type ? [node] : []), ...Object.values(node).flatMap((item) => nodes(item, type))];
}

function compiled(): Node {
  const { leaves, text } = example();
  const result = compileLeaves(leaves, text);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

describe("context-bound ability selection replacement", () => {
  it("uses a single optional trigger and modifies the exact original use without an extra activation", () => {
    const result = compiled();
    expect(result.behavior).toBe("reactive");
    expect(result.trigger).toMatchObject({ event: "used", subject: { owner: "friendly", level: "model" }, filter: { kind: "ability", ability_keyword: "TEST-LINK" }, binds_event_variable: "test-use", optional: true });
    expect(nodes(result, "select-units")).toHaveLength(0);
    expect(nodes(result, "ability-activate")).toHaveLength(0);
    expect(nodes(result, "ability-grant")).toHaveLength(0);
    for (const node of nodes(result, "ability-modifier")) {
      expect(node.target).toEqual({ event_var: "test-use" });
      expect(node.modifier).toMatchObject({ ability: { event: "used", event_var: "test-use" }, aspect: "selection", operation: "set", recipient_duration: "until-next-command-phase" });
    }
  });

  it("keeps the retired context fingerprint while current authoring uses the widened event primitive", () => {
    const historical = { owner: "friendly", level: "model", keyword: "TEST-LINK", bind_as: "test-use" };
    expect(normalizeFingerprintParameters("ability-use-context", historical, 1)).toEqual(historical);
    expect(() => currentFamilyVersion("ability-use-context")).toThrow(/0 current versions/u);

    const version = currentFamilyVersion("event");
    const active = { kind: "used", activity: "ability", ability_keyword: "TEST-LINK", bind_as: "test-use" };
    expect(normalizeFingerprintParameters("event", active, version)).toEqual(active);
    // event@33 added ability_keyword; event@32 is the version before it.
    expect(() => normalizeFingerprintParameters("event", active, 32)).toThrow();
  });

  it("keeps ability identity and actor identity independent in the history guard", () => {
    /** The first operand of a compound condition node. */
    const firstOperand = (node: Record<string, unknown>): { parameters: Record<string, unknown> } => {
      if (!Array.isArray(node.operands)) throw new Error("condition has no operands");
      return node.operands[0];
    };
    const { leaves } = example();
    const history = leaves.find((leaf) => leaf.family_id === "ability-use-history")!;
    const sameAbilityOtherActor = abilityUseCondition(history)!;
    expect(sameAbilityOtherActor).toEqual({ operator: "not", operands: [{ type: "happened", parameters: { event: "used", subject: { owner: "friendly", level: "model", excluding: { event_var: "test-use" } }, filter: { kind: "ability", same_rule_as: { event_var: "test-use" } }, window: "turn" } }] });
    const sameActor = abilityUseCondition({ ...history, parameters: { ...history.parameters, actor: "same" } })!;
    expect(firstOperand(sameActor).parameters.subject).toEqual({ event_var: "test-use" });
    const anyAbility = abilityUseCondition({ ...history, parameters: { ...history.parameters, ability: "any" } })!;
    expect(firstOperand(anyAbility).parameters.filter).toEqual({ kind: "ability" });
    const anyActor = abilityUseCondition({ ...history, parameters: { ...history.parameters, actor: "any" } })!;
    expect(firstOperand(anyActor).parameters.subject).toEqual({ owner: "friendly", level: "model" });
    expect(nodes(compiled(), "happened")).toContainEqual(firstOperand(sameAbilityOtherActor));
  });

  it("retains up-to-zero cardinality, exact origin, any-applier exclusion, alternative army reach and recipient lifetime", () => {
    const result = compiled();
    const modifiers = nodes(result, "ability-modifier");
    expect(modifiers).toHaveLength(2);
    expect(modifiers.map((node) => node.modifier.selection.filter.within.range)).toEqual([{ inches: 8 }, { inches: 11 }]);
    for (const node of modifiers) {
      expect(node.modifier.selection).toEqual({ filter: { owner: "friendly", level: "model", all_of: ["TEST-RECIPIENT"], not_designated: "bondsman-affected", within: { range: node.modifier.selection.filter.within.range, of: { event_var: "test-use" } } }, count: { min: 0, max: 4 } });
    }
    const rangeBranches = nodes(result, "conditional").filter((node) => node.effect.type === "ability-modifier");
    expect(rangeBranches.map((node) => node.condition)).toEqual([
      { operator: "not", operands: [{ type: "army-state", parameters: { owner: "friendly", state: "honoured" } }] },
      { type: "army-state", parameters: { owner: "friendly", state: "honoured" } },
    ]);
    expect(result.scope.duration).toBe("resolution");
  });

  it("is deterministic and passes the actual effect schema", () => {
    const result = compiled();
    expect(compiled()).toEqual(result);
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json")!;
    expect(validate(result.effect), JSON.stringify(validate.errors)).toBe(true);
  });

  it("folds an ownership qualifier into the ordinary use participant, refusing contradictory or unrelated owners", () => {
    const { leaves } = example();
    const actor = leaves[0]!;
    const event = leaves[1]!;
    const owner: CompileLeaf = { ...event, family_id: "unit-owner", family_version: 1, role: "CONDITION",
      start_byte: actor.end_byte!, end_byte: event.start_byte, parameters: { owner: "friendly" } };
    const result = compileLeaves([actor, owner, event, ...leaves.slice(2)]);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.mechanics.trigger).toMatchObject({ event: "used", subject: { owner: "friendly", level: "model" } });

    const contradictory = compileLeaves([actor, { ...owner, parameters: { owner: "enemy" } }, event, ...leaves.slice(2)]);
    expect(contradictory.ok ? "" : contradictory.errors.join("; ")).toMatch(/actor|owner/u);
    expect(() => foldAbilityUseContext([...leaves, { ...owner, start_byte: 100, end_byte: 103 }])).toThrow(/triggering actor/u);
  });

  it("refuses unbound identity, actor mismatches, missing recipients, missing lifetime and unmatched alternative range", () => {
    const { leaves } = example();
    expect(() => foldAbilityUseContext(leaves.map((leaf) => leaf.family_id === "ability-selection-override" ? { ...leaf, parameters: { event_var: "another-use" } } : leaf))).toThrow(/unbound/u);
    expect(() => foldAbilityUseContext(leaves.map((leaf) => leaf.family_id === "ability-use-history" ? { ...leaf, parameters: { ...leaf.parameters, event_var: "another-use" } } : leaf))).toThrow(/unbound/u);
    expect(() => foldAbilityUseContext(leaves.map((leaf) => leaf.family_id === "ability-use-history"
      ? { ...leaf, parameters: { ...leaf.parameters, actor: "same", owner: "enemy" } } : leaf))).toThrow(/owner and level/u);
    const filters = leaves.filter((leaf) => leaf.family_id === "unit-filter");
    expect(() => foldAbilityUseContext(leaves.filter((leaf) => leaf !== filters[0]))).toThrow(/actor/u);
    expect(() => foldAbilityUseContext(leaves.filter((leaf) => leaf !== filters[1]))).toThrow(/recipient/u);
    expect(() => foldAbilityUseContext(leaves.filter((leaf) => leaf.family_id !== "duration"))).toThrow(/exactly one/u);
    expect(() => foldAbilityUseContext(leaves.filter((leaf) => leaf.family_id !== "army-state"))).toThrow(/alternative contextual reach/u);
    expect(() => foldAbilityUseContext(leaves.map((leaf) => leaf.family_id === "instead" ? { ...leaf, parameters: { choice: true } } : leaf))).toThrow(/cannot consume/u);
  });
});
