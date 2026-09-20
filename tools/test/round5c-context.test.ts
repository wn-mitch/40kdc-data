import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createAbilityContextResolver } from "../src/round5c/context.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeJson(root: string, path: string, value: unknown): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, JSON.stringify(value));
}

describe("Round 5C tracked ability context", () => {
  it("joins only faction-scoped tracked ownership and explicit budgets", () => {
    const root = mkdtempSync(join(tmpdir(), "round5c-context-"));
    temporaryRoots.push(root);
    writeJson(root, "data/core/fixture/units.json", [{
      id: "mortifiers",
      name: "Mortifiers",
      role: "battleline",
      ability_ids: ["anchorite-sarcophagus"],
      wargear_budgets: [{ items: ["anchorite-sarcophagus"], count: 1, per_models: 0 }],
    }]);
    writeJson(root, "data/core/fixture/wargear.json", [{ id: "anchorite-sarcophagus", name: "Anchorite sarcophagus" }]);
    writeJson(root, "data/core/fixture/wargear-options.json", [{
      id: "mortifiers-anchorite-option",
      replacement: ["anchorite-sarcophagus"],
      model_constraint: { any_number: true },
    }]);
    writeJson(root, "data/enrichment/fixture/abilities.json", [{
      ability_id: "anchorite-sarcophagus",
      unit_ids: ["mortifiers"],
      effect: { type: "resource-action" },
      scope: { range: "bearer" },
      game_version: { edition: "11th" },
    }]);
    writeJson(root, "data/core/other/units.json", [{
      id: "mortifiers",
      name: "Wrong faction",
      ability_ids: ["anchorite-sarcophagus"],
    }]);

    const resolveContext = createAbilityContextResolver(root);
    expect(resolveContext("fixture", "anchorite-sarcophagus")).toEqual({
      owners: [{ unit_id: "mortifiers", name: "Mortifiers", role: "battleline" }],
      wargear: {
        id: "anchorite-sarcophagus",
        name: "Anchorite sarcophagus",
        options: [{ id: "mortifiers-anchorite-option", model_constraint: { any_number: true } }],
      },
      selection_budgets: [{ unit_id: "mortifiers", count: 1, per_models: 0 }],
      existing_dsl: {
        provenance: "existing-community-authored-dsl",
        effect: { type: "resource-action" },
        scope: { range: "bearer" },
        game_version: { edition: "11th" },
      },
    });
  });

  it("returns stable empty context when tracked faction files are absent", () => {
    const root = mkdtempSync(join(tmpdir(), "round5c-context-"));
    temporaryRoots.push(root);

    expect(createAbilityContextResolver(root)("missing", "ability")).toEqual({
      owners: [],
      wargear: null,
      selection_budgets: [],
      existing_dsl: null,
    });
  });
});
