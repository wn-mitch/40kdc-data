import { CompileError } from "./compile-error.js";

type Node = Record<string, unknown>;

/** The roll_var a Dark Pact moment binds its Leadership test as (roll-total dark-pact-test). */
export const DARK_PACT_TEST = "dark-pact-test";

function readsDarkPactTest(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(readsDarkPactTest);
  if (node === null || typeof node !== "object") return false;
  const record = node as Node;
  if (record.type === "roll-total" && (record.parameters as Node | undefined)?.roll_var === DARK_PACT_TEST) return true;
  return Object.values(record).some(readsDarkPactTest);
}

/**
 * "Each time the bearer's unit makes a Dark Pact and does not fail the resulting Leadership test, if
 * the result of that test was 8 or more": the moment binds that test (binds_roll_variable) for the
 * roll-total that reads it. A dark-pact-test read with no single Dark Pact test moment to bind it refuses.
 */
export function bindDarkPactTest(mechanics: { effect: unknown; trigger?: unknown }): void {
  if (!readsDarkPactTest(mechanics.effect) && !readsDarkPactTest(mechanics.trigger)) return;
  const trigger = mechanics.trigger as Node | null | undefined;
  const filter = trigger !== null && typeof trigger === "object" && !Array.isArray(trigger) ? trigger.filter as Node | undefined : undefined;
  if (trigger === null || trigger === undefined || Array.isArray(trigger) || trigger.event !== "after-roll" || filter?.roll !== "dark-pact") {
    throw new CompileError("The result of a Dark Pact's Leadership test is read only after a Dark Pact moment with that test's outcome (event used dark-pact, passed).");
  }
  trigger.binds_roll_variable = DARK_PACT_TEST;
}
