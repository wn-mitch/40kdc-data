import { describe, expect, it } from "vitest";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { compileStratagemActivation } from "../src/round5c/compile-stratagem-activation.js";
import { trigger } from "../src/round5c/compile-triggers.js";

function leaf(family_id: string, role: CompileLeaf["role"], parameters: Record<string, unknown>, start_byte: number, fragment = "WHEN"): CompileLeaf {
  return { family_id, family_version: 1, role, parameters, start_byte, end_byte: start_byte + 1, fragment };
}

const window = leaf("use-window", "RESTRICTION", { your_phases: [], opponent_phases: ["shooting"], either_phases: ["fight"] }, 0);

describe("isolated reviewed Stratagem activation", () => {
  it("retains phase alternatives and exact event subject without consuming effects", () => {
    const leaves = [window,
      leaf("unit-filter", "CONDITION", { side: "enemy", keywords: ["VEHICLE"] }, 2),
      leaf("event", "EVENT", { kind: "selected", to: "shoot" }, 4),
      leaf("event", "EVENT", { kind: "model-destroyed" }, 6, "EFFECT"),
      leaf("unreviewed-effect", "EFFECT", {}, 8, "EFFECT"),
    ];
    const before = structuredClone(leaves);
    const result = compileStratagemActivation(leaves);
    expect(result.behavior).toBe("reactive");
    expect(result.trigger).toMatchObject({ event: "selected", subject: { owner: "enemy", all_of: ["VEHICLE"] }, optional: true, condition: { operator: "or" } });
    expect(JSON.stringify(result.trigger)).not.toContain("model-destroyed");
    expect(leaves).toEqual(before);
    expect(result).not.toHaveProperty("effect");
  });

  it("keeps phase availability activated instead of inventing a phase edge", () => {
    const result = compileStratagemActivation([window]);
    expect(result).toMatchObject({ behavior: "activated", trigger: null, availability: { operator: "or" } });
  });

  it("refuses unsupported timing leaves and never promotes TARGET history", () => {
    expect(() => compileStratagemActivation([leaf("event", "EVENT", { kind: "unit-destroyed" }, 0, "TARGET")])).toThrow(/WHEN/);
    expect(() => compileStratagemActivation([window, leaf("unreviewed-effect", "EFFECT", {}, 2)])).toThrow(/cannot consume/);
  });

  it("does not flatten delayed nested events into independent activations", () => {
    const source = "A later B";
    expect(() => compileStratagemActivation([
      leaf("event", "EVENT", { kind: "selected", to: "shoot" }, 0),
      leaf("event", "EVENT", { kind: "phase-end", phase: "shooting", turn: "your" }, 8),
    ], source)).toThrow(/Nested activation/);
  });

  it("requires exact event identity for causal destruction rather than a shared actor", () => {
    const causal = trigger(leaf("event", "EVENT", {
      kind: "attacks-resolved",
      action_kind: "attack",
      bind_as: "fabricated-attacks",
      causes_destruction: {
        unit: { owner: "enemy" },
        model: { owner: "enemy", all_of: ["OFFICER"] },
      },
    }, 0));
    expect(causal).toMatchObject({
      event: "attacks-resolved",
      binds_event_variable: "fabricated-attacks",
      condition: {
        operator: "or",
        operands: [
          { type: "happened", parameters: { filter: { caused_by: { event_var: "fabricated-attacks" } } } },
          { type: "happened", parameters: { filter: { caused_by: { event_var: "fabricated-attacks" } } } },
        ],
      },
    });

    const sameActorOnly = trigger(leaf("event", "EVENT", {
      kind: "attacks-resolved",
      action_kind: "attack",
      bind_as: "fabricated-attacks",
    }, 0));
    expect(sameActorOnly).not.toHaveProperty("condition");
  });

  it("keeps an exact causal source on resource gain with source-relative proximity", () => {
    expect(trigger(leaf("event", "EVENT", {
      kind: "resource-gained",
      pool: "fabricated-pool",
      bind_as: "fabricated-gain",
      caused_by_destruction: {
        unit: { owner: "friendly", all_of: ["SCOUT"], within: { inches: 5, of: "this-model" } },
      },
    }, 0))).toMatchObject({
      event: "resource-gained",
      binds_event_variable: "fabricated-gain",
      condition: {
        type: "happened",
        parameters: {
          event: "destroyed",
          filter: { causes: { event_var: "fabricated-gain" } },
          proximity: { of: "this-model", range: { inches: 5 } },
        },
      },
    });
  });
});
