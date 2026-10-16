import * as path from "node:path";
import { effectToBuffs } from "../cruncher/from-dsl.js";
import { describeAbility } from "../translate/effect.js";
import { describeCondition, type Condition } from "../translate/condition.js";
import { conditionLeadIn, describeSelectionEligibility } from "../translate/condition-leadin.js";
import { describeTrigger } from "../translate/trigger.js";
import type { Node } from "./vocab-cutover-types.js";

/** Fixture call migration is separate from DSL semantics and never runs on dataset records. */
export function migrateFixtureCall(row: Node, file: string): void {
  if (path.basename(file) !== "phase4-cruncher.json" || row.fn !== "usageGated") return;
  const input = row.input as Node;
  row.fn = "effectToBuffs";
  row.input = {
    effect: input.effect,
    source: { kind: "ability", abilityId: "fixture-usage", abilityKind: input.abilityType },
    ctx: {},
    perspective: "attacker",
    activation: { usage: input.usage },
  };
}

/** Regenerate expected values by exercising the public translation/cruncher interfaces. */
export function renderFixture(value: unknown, file: string): unknown {
  const name = path.basename(file);
  if (name === "condition-trigger-phrases.json") {
    const fixture = value as { conditions: Array<{ input: Condition; describe: string; lead_in: string; eligibility: string }>; triggers: Array<{ input: Parameters<typeof describeTrigger>[0]; text: string }> };
    for (const row of fixture.conditions) {
      row.describe = describeCondition(row.input);
      row.lead_in = conditionLeadIn(row.input);
      row.eligibility = describeSelectionEligibility(row.input);
    }
    for (const row of fixture.triggers) row.text = describeTrigger(row.input);
  } else if (name === "phase4-shapes.json") {
    for (const row of value as Array<{ fn: string; input: unknown; output: string }>) {
      if (row.fn === "ability") row.output = describeAbility(row.input as Parameters<typeof describeAbility>[0]);
      else if (row.fn === "condition") row.output = describeCondition(row.input as Condition);
      else if (row.fn === "trigger") row.output = describeTrigger(row.input as Parameters<typeof describeTrigger>[0]);
      else throw new Error(`Unknown shape fixture function ${row.fn}`);
    }
  } else if (name === "phase4-cruncher.json") {
    for (const row of value as Array<{ fn: string; input: Node; output: unknown }>) {
      if (row.fn !== "effectToBuffs") throw new Error(`Unknown cruncher fixture function ${row.fn}`);
      const input = row.input;
      const result = effectToBuffs(input.effect, input.source as Parameters<typeof effectToBuffs>[1], input.ctx as Parameters<typeof effectToBuffs>[2], input.perspective as Parameters<typeof effectToBuffs>[3], input.activation as Parameters<typeof effectToBuffs>[4]);
      row.output = { ...result, unsupported: result.unsupported.map((entry) => entry.reason) };
    }
  } else throw new Error(`No fixture renderer for ${file}`);
  return value;
}
