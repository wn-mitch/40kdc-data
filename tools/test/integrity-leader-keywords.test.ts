import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkLeaderKeywordClauses } from "../src/integrity-leader-keywords.js";
import { keywordEligibility } from "../src/mfm/attachment.js";
import type { ValidationResult } from "../src/validate.js";

// Fabricated names only.

const emptyResult = (): ValidationResult => ({ totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] });
const units = [
  { id: "lancer-squad", keywords: ["Infantry", "Battleline", "Lancer Squad"], faction_keywords: ["Shard Kin"] },
  { id: "warden-squad", keywords: ["Infantry", "Warden Squad"], faction_keywords: ["Shard Kin"] },
  { id: "spire-walker", keywords: ["Vehicle", "Walker"], faction_keywords: ["Shard Kin"] },
];

describe("leader keyword clauses match some unit", () => {
  let root = "";
  afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));
  const fixture = (attachments: unknown[]) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "leader-keywords-"));
    const write = (rel: string, value: unknown) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), JSON.stringify(value));
    };
    write("core/glimmer-host/units.json", units);
    write("core/glimmer-host/leader-attachments.json", attachments);
    return root;
  };

  it("passes a clause one unit meets in full and fails alternatives written as one clause", async () => {
    const result = emptyResult();
    await checkLeaderKeywordClauses(fixture([
      { leader_id: "shard-captain", eligible_bodyguard_ids: ["lancer-squad"], eligible_bodyguard_keywords: ["Shard Kin", "Battleline", "Infantry"] },
      { leader_id: "shard-lord", eligible_bodyguard_ids: ["spire-walker"], eligible_bodyguard_keywords: ["Lancer Squad", "Warden Squad"] },
      { leader_id: "shard-herald", eligible_bodyguard_ids: ["spire-walker"] },
    ]), result);
    expect(result.totalItems).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors.flatMap((entry) => entry.errors.map((error) => error.message)))
      .toEqual([expect.stringContaining('leader "shard-lord": no unit carries all of Lancer Squad, Warden Squad')]);
  });
});

describe("the MFM attachment ingest keeps keyword groups as alternatives", () => {
  it("keeps a single group's keywords as the clause", () => {
    const eligible = new Set<string>();
    expect(keywordEligibility([["Shard Kin", "Battleline", "Infantry"]], units, eligible)).toEqual(["Shard Kin", "Battleline", "Infantry"]);
    expect([...eligible]).toEqual([]);
  });

  it("resolves several groups to the units each one admits, with no clause", () => {
    const eligible = new Set<string>(["spire-walker"]);
    expect(keywordEligibility([["Lancer Squad"], ["Warden Squad"]], units, eligible)).toBeUndefined();
    expect([...eligible].sort()).toEqual(["lancer-squad", "spire-walker", "warden-squad"]);
  });
});
