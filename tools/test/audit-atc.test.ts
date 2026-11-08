import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditAtcCorpus, findRegressions, renderMarkdown, type AtcAuditReport } from "../src/audit-atc.js";

function report(overrides: Partial<AtcAuditReport["headline"]> = {}): AtcAuditReport {
  return {
    generatedFrom: "test",
    corpus: [],
    headline: {
      lists: 10,
      parse_failures: 1,
      lists_with_violations: 2,
      violating_units: 3,
      warnings_by_code: { "weapon-unresolved": 5 },
      violations_by_code: { "exceeds-max": 3 },
      grouping_by_outcome: {
        grouped: 4,
        "unit-unresolved": 1,
        "wargear-unresolved": 2,
        "single-model": 2,
        "no-recorded-defaults": 0,
        "solver-null": 1,
      },
      composition_drift_units: 2,
      ...overrides,
    },
    parse_failures: [],
    violations: [],
    unresolved_names: {},
    solver_null_units: [],
    composition_drift: [],
  };
}

describe("findRegressions", () => {
  it("returns nothing when counts are unchanged", () => {
    expect(findRegressions(report(), report())).toEqual([]);
  });

  it("treats decreases and disappearances as improvements", () => {
    const fresh = report({
      parse_failures: 0,
      violating_units: 0,
      warnings_by_code: {},
      violations_by_code: {},
      composition_drift_units: 0,
    });
    expect(findRegressions(report(), fresh)).toEqual([]);
  });

  it("flags scalar increases", () => {
    const fresh = report({ parse_failures: 2 });
    expect(findRegressions(report(), fresh)).toEqual(["parse_failures: 1 → 2"]);
  });

  it("flags per-code increases and newly-appearing codes", () => {
    const fresh = report({
      warnings_by_code: { "weapon-unresolved": 6, "loadout-illegal": 1 },
    });
    expect(findRegressions(report(), fresh)).toEqual([
      "warnings.weapon-unresolved: 5 → 6",
      "warnings.loadout-illegal: 0 → 1",
    ]);
  });

  it("never flags growth in the grouped bucket", () => {
    const fresh = report({
      grouping_by_outcome: {
        grouped: 9,
        "unit-unresolved": 1,
        "wargear-unresolved": 2,
        "single-model": 2,
        "no-recorded-defaults": 0,
        "solver-null": 1,
      },
    });
    expect(findRegressions(report(), fresh)).toEqual([]);
  });

  it("flags growth in a failure bucket", () => {
    const fresh = report({
      grouping_by_outcome: {
        grouped: 4,
        "unit-unresolved": 1,
        "wargear-unresolved": 2,
        "single-model": 2,
        "no-recorded-defaults": 0,
        "solver-null": 2,
      },
    });
    expect(findRegressions(report(), fresh)).toEqual(["grouping.solver-null: 1 → 2"]);
  });
});

describe("the ATC audit report", () => {
  it("never quotes the player or team names a list carries", () => {
    const root = mkdtempSync(join(tmpdir(), "atc-audit-"));
    const dir = join(root, "examples/atc-viewer/src/data");
    mkdirSync(dir, { recursive: true });
    const lists = [
      "Player Name: Zebulon Quillfeather\nnot a list format anyone reads",
      "Team Name: The Quillfeather Irregulars\nCHARACTERS\nZebulonhead (90 points)",
      "+ PLAYER NAME: Zebulon Quillfeather\n+ FACTION KEYWORD: Quillfeather Host\n+ DETACHMENT: Player Name: Zebulon Quillfeather",
    ];
    const teams = [{ name: "The Quillfeather Irregulars", players: lists.map((armyListText) => ({ name: "Zebulon Quillfeather", faction: "Orks", armyListText })) }];
    for (const file of ["atc-2026.json", "atc-5s.json"]) writeFileSync(join(dir, file), JSON.stringify({ teams }));
    const report = auditAtcCorpus({ rootDir: root });
    expect(report.headline.lists).toBe(6);
    expect(`${JSON.stringify(report)}\n${renderMarkdown(report)}`).not.toMatch(/Quillfeather|Zebulon/);
  });
});
