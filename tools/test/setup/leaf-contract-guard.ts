import { vi } from "vitest";

import { contractProblem, exempt } from "../leaf-contract.js";

// Every leaf a test compiles is one a reviewer could store (test/leaf-contract.ts); otherwise a test can pass on a
// leaf no record ever carries. Build leaves with placed() (semantic-authoring-connective-fixture.ts), which normalizes.
vi.mock("../../src/semantic-authoring/compile.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/semantic-authoring/compile.js")>();
  return {
    ...original,
    compileLeaves: (...args: Parameters<typeof original.compileLeaves>) => {
      const [leaves] = args;
      if (!exempt(leaves)) {
        for (const leaf of leaves) {
          const problem = contractProblem(leaf);
          if (problem) throw new Error(`Test leaf ${leaf.family_id}@${leaf.family_version} ${JSON.stringify(leaf.parameters)}: ${problem}`);
        }
      }
      return original.compileLeaves(...args);
    },
  };
});
