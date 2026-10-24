import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glob } from "glob";
import {
  buildReferenceVocabularies,
  collectDanglingAbilityReferences,
  DATA_ROOT,
  formatDanglingRefs,
  normalizeKeyword,
  runDanglingRefsAudit,
  type DanglingReference,
} from "../src/audit-dangling-refs.js";

const KEYWORD_DISPUTE_NOTE =
  'Dangling reference: condition gates on keyword "A", which no unit in the dataset has, so the gate never fires and the effect is dead; the intended keyword is unrecoverable from the encoding.';
const STRATAGEM_DISPUTE_NOTE =
  'Dangling reference: references stratagem id "fire-overwatch-or-heroic", which no stratagem file defines; the intended stratagem is unrecoverable from the encoding.';

/** Create an isolated `data/` root so no test depends on the production tree. */
function setupDataRoot(): string {
  const base = mkdtempSync(join(tmpdir(), "audit-dangling-refs-"));
  const root = join(base, "data");
  for (const sub of [
    "core/alpha",
    "core/beta",
    "core/_example",
    "enrichment/alpha",
    "enrichment/beta",
    "enrichment/_core",
  ]) {
    mkdirSync(join(root, sub), { recursive: true });
  }
  return root;
}

function write(root: string, rel: string, data: unknown): void {
  writeFileSync(join(root, rel), `${JSON.stringify(data, null, 2)}\n`);
}

/** A minimal but realistic core vocabulary covering all four keyword sources. */
function writeCoreVocabulary(root: string): void {
  write(root, "core/alpha/units.json", [
    { id: "alpha-hero", keywords: ["INFANTRY", "Character"], faction_keywords: ["Alpha Legion"] },
  ]);
  write(root, "core/beta/units.json", [
    { id: "beta-brute", keywords: ["MONSTER"], faction_keywords: ["Beta Host"] },
  ]);
  write(root, "core/alpha/factions.json", [
    { id: "alpha", keywords: ["Alpha Faction Label"] },
  ]);
  write(root, "core/unit-keywords.json", [
    { id: "feel-no-pain", name: "Feel No Pain" },
  ]);
  write(root, "core/weapon-keywords.json", [
    { id: "lethal-hits", name: "Lethal Hits" },
  ]);
  write(root, "core/stratagems.json", [{ id: "counteroffensive" }]);
  write(root, "core/alpha/stratagems.json", [{ id: "go-to-ground-alpha" }]);
  // Scratch/example directories must not widen the accepted vocabulary.
  write(root, "core/_example/units.json", [{ id: "x", keywords: ["EXAMPLE ONLY"] }]);
  write(root, "core/_example/stratagems.json", [{ id: "example-only-stratagem" }]);
}

/** A `has-keyword` condition on one keyword; `subject` defaults to the unit with the ability. */
function keywordCondition(subject: string | undefined, keyword: string): unknown {
  return { type: "has-keyword", parameters: { ...(subject ? { subject } : {}), all_of: [keyword] } };
}

/** A realistic `conditional` effect whose gate gates on one keyword. */
function keywordGate(subject: string | undefined, keyword: string): unknown {
  return {
    type: "conditional",
    condition: keywordCondition(subject, keyword),
    effect: { type: "modify-stat", modifier: { stat: "toughness", value: 1 } },
  };
}

describe("normalizeKeyword", () => {
  it("trims, removes all whitespace, and lowercases", () => {
    expect(normalizeKeyword("  Feel No Pain ")).toBe("feelnopain");
    expect(normalizeKeyword("VEHICLE")).toBe("vehicle");
    expect(normalizeKeyword("Adeptus\tAstartes\nGuard")).toBe("adeptusastartesguard");
  });

  it("does not fold punctuation or diacritics", () => {
    expect(normalizeKeyword("Emperor’s Children")).toBe("emperor’schildren");
    expect(normalizeKeyword("Twin-linked")).toBe("twin-linked");
    expect(normalizeKeyword("twinlinked")).not.toBe(normalizeKeyword("twin-linked"));
  });
});

describe("buildReferenceVocabularies", () => {
  let root: string;

  beforeEach(() => {
    root = setupDataRoot();
    writeCoreVocabulary(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("collects normalized keywords from unit, faction, and both catalogs", async () => {
    const { keywords } = await buildReferenceVocabularies(root);
    // unit keywords and faction_keywords
    expect(keywords.has("infantry")).toBe(true);
    expect(keywords.has("character")).toBe(true);
    expect(keywords.has("alphalegion")).toBe(true);
    expect(keywords.has("monster")).toBe(true);
    // faction record keywords
    expect(keywords.has("alphafactionlabel")).toBe(true);
    // unit-keyword catalog ids and names
    expect(keywords.has("feel-no-pain")).toBe(true);
    expect(keywords.has("feelnopain")).toBe(true);
    // weapon-keyword catalog ids and names
    expect(keywords.has("lethal-hits")).toBe(true);
    expect(keywords.has("lethalhits")).toBe(true);
  });

  it("collects stratagem ids from the root and every faction file, exactly", async () => {
    const { stratagems } = await buildReferenceVocabularies(root);
    expect([...stratagems].sort()).toEqual(["counteroffensive", "go-to-ground-alpha"]);
    expect(stratagems.has("Counter-Offensive")).toBe(false);
  });

  it("ignores underscore-prefixed scratch directories", async () => {
    const { keywords, stratagems } = await buildReferenceVocabularies(root);
    expect(keywords.has("exampleonly")).toBe(false);
    expect(stratagems.has("example-only-stratagem")).toBe(false);
  });

  it("skips unreadable and non-array files instead of throwing", async () => {
    writeFileSync(join(root, "core/beta/factions.json"), "{ not json");
    write(root, "core/beta/stratagems.json", { id: "not-an-array" });
    const { keywords, stratagems } = await buildReferenceVocabularies(root);
    expect(keywords.has("infantry")).toBe(true);
    expect(stratagems.has("not-an-array")).toBe(false);
  });
});

describe("collectDanglingAbilityReferences", () => {
  let root: string;

  beforeEach(() => {
    root = setupDataRoot();
    writeCoreVocabulary(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves keywords supplied by any of the four vocabulary sources", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      { ability_id: "unit-label", effect: keywordCondition(undefined, "infantry") },
      { ability_id: "faction-label", effect: keywordCondition("defender", "ALPHA LEGION") },
      { ability_id: "faction-record-label", effect: keywordCondition(undefined, "Alpha Faction Label") },
      { ability_id: "unit-catalog", effect: keywordCondition(undefined, "Feel No Pain") },
      { ability_id: "weapon-catalog", effect: keywordCondition("defender", "lethal-hits") },
    ]);
    expect(await collectDanglingAbilityReferences(root)).toEqual([]);
  });

  it("reports unresolved keyword operands with their exact DSL location", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      { ability_id: "resolved", effect: keywordGate(undefined, "MONSTER") },
      { ability_id: "dangling", effect: keywordGate("defender", "A") },
    ]);
    expect(await collectDanglingAbilityReferences(root)).toEqual([
      {
        kind: "keyword",
        reference_type: "has-keyword",
        source_file: "enrichment/alpha/abilities.json",
        ability_id: "dangling",
        path: "/1/effect/condition/parameters/all_of/0",
        value: "A",
      },
    ]);
  });

  it("finds references nested under every recursive DSL wrapper", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      {
        ability_id: "nested",
        trigger: { event: "phase-started", condition: keywordCondition(undefined, "TRIGGERED") },
        effect: {
          type: "sequence",
          steps: [
            {
              type: "conditional",
              condition: {
                operator: "and",
                operands: [
                  keywordCondition("defender", "OPERAND"),
                  { operator: "not", operands: [keywordCondition(undefined, "DEEP")] },
                ],
              },
              effect: { type: "cost-modifier", modifier: { of: "stratagem", id: "not-a-stratagem", operation: "set", amount: 0 } },
            },
          ],
        },
      },
    ]);
    const findings = await collectDanglingAbilityReferences(root);
    expect(findings.map((finding) => finding.path)).toEqual([
      "/0/effect/steps/0/condition/operands/0/parameters/all_of/0",
      "/0/effect/steps/0/condition/operands/1/operands/0/parameters/all_of/0",
      "/0/effect/steps/0/effect/modifier/id",
      "/0/trigger/condition/parameters/all_of/0",
    ]);
    expect(findings.map((finding) => finding.value)).toEqual([
      "OPERAND",
      "DEEP",
      "not-a-stratagem",
      "TRIGGERED",
    ]);
  });

  it("checks every entry of both has-keyword lists, and no other operand", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      {
        ability_id: "lists",
        effect: {
          type: "conditional",
          condition: {
            type: "has-keyword",
            parameters: { subject: "defender", all_of: ["INFANTRY", "ALL MISSING"], any_of: ["ANY MISSING", "MONSTER"] },
          },
          effect: { type: "modify-stat", modifier: { stat: "toughness", value: 1 } },
        },
      },
      {
        // A keyword the player picks names the ability that picks it, not a keyword.
        ability_id: "chosen",
        effect: { type: "has-keyword", parameters: { subject: "defender", chosen_by: "not-a-keyword" } },
      },
    ]);
    const findings = await collectDanglingAbilityReferences(root);
    expect(findings.map((finding) => [finding.reference_type, finding.path, finding.value])).toEqual([
      ["has-keyword", "/0/effect/condition/parameters/all_of/1", "ALL MISSING"],
      ["has-keyword", "/0/effect/condition/parameters/any_of/0", "ANY MISSING"],
    ]);
  });

  it("checks the keyword lists of unit filters in triggers and predicates", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      {
        ability_id: "filters",
        trigger: {
          event: "targets-selected",
          filter: { kind: "attack" },
          subject: { owner: "enemy", all_of: ["SUBJECT MISSING"], none_of: ["MONSTER"] },
          object: "this-unit",
        },
        effect: {
          type: "conditional",
          condition: {
            type: "within",
            parameters: {
              // A filter nested inside a has-keyword subject is still a filter.
              of: { owner: "friendly", any_of: ["INFANTRY", "OF MISSING"], none_of: ["NONE MISSING"], visible: true },
              range: { inches: 6 },
            },
          },
          effect: { type: "modify-stat", modifier: { stat: "toughness", value: 1 } },
        },
      },
      {
        ability_id: "keyword-subject",
        effect: {
          type: "has-keyword",
          parameters: { subject: { owner: "enemy", all_of: ["SUBJECT FILTER MISSING"] }, all_of: ["MONSTER"] },
        },
      },
    ]);
    const findings = await collectDanglingAbilityReferences(root);
    expect(findings.map((finding) => [finding.ability_id, finding.reference_type, finding.path, finding.value])).toEqual([
      ["filters", "unit-filter", "/0/effect/condition/parameters/of/any_of/1", "OF MISSING"],
      ["filters", "unit-filter", "/0/effect/condition/parameters/of/none_of/0", "NONE MISSING"],
      ["filters", "unit-filter", "/0/trigger/subject/all_of/0", "SUBJECT MISSING"],
      ["keyword-subject", "unit-filter", "/1/effect/parameters/subject/all_of/0", "SUBJECT FILTER MISSING"],
    ]);
  });

  it("treats only supported node types as references", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      {
        ability_id: "lookalikes",
        // A bare `keyword` property with no keyword-condition parent.
        applies_to: { keyword: "NOT A REFERENCE" },
        effect: {
          type: "sequence",
          steps: [
            // A condition type other than has-keyword, even one carrying a keyword list.
            { type: "unit-has-role", parameters: { keyword: "ALSO NOT A REFERENCE", all_of: ["NOR THIS"] } },
            // A legacy keyword condition is the schema's to reject, not a reference.
            { type: "unit-has-keyword", parameters: { keyword: "LEGACY" } },
            // An effect that carries a stratagem string as display text.
            { type: "ability-grant", modifier: { stratagem: "display text only" } },
            // Non-string operands stay out of the report.
            { type: "has-keyword", parameters: { subject: "defender", all_of: [["A"]] } },
            // A dice requirement's any_of holds requirements, not keywords.
            { type: "dice-pool-allocation", options: [{ requirement: { any_of: [{ type: "pair" }, { type: "triple" }] } }] },
            // An object with a keyword list beside a non-filter key is not a unit filter.
            { type: "sequence", steps: [], meta: { all_of: ["NOT A FILTER"], label: "x" } },
            // A designation names a tag, not a keyword.
            { type: "within", parameters: { of: { owner: "enemy", designated: "NOT A KEYWORD" } } },
          ],
        },
      },
    ]);
    expect(await collectDanglingAbilityReferences(root)).toEqual([]);
  });

  it("compares stratagem ids exactly while keyword matching normalizes", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      { ability_id: "exact", effect: { type: "cost-modifier", modifier: { of: "stratagem", id: "counteroffensive", operation: "set", amount: 0 } } },
      { ability_id: "wrong-case", effect: { type: "cost-modifier", modifier: { of: "stratagem", id: "Counter-Offensive", operation: "set", amount: 0 } } },
      { ability_id: "permission", effect: { type: "permission", modifier: { activity: "use-stratagem", allow: true, stratagem: "counter offensive" } } },
      // A manoeuvre's cost names no Stratagem, so its id is not audited as one.
      { ability_id: "manoeuvre", effect: { type: "cost-modifier", modifier: { of: "manoeuvre", id: "not-a-stratagem", operation: "decrease", amount: 1 } } },
    ]);
    const findings = await collectDanglingAbilityReferences(root);
    expect(findings.map((finding) => [finding.ability_id, finding.reference_type, finding.value])).toEqual([
      ["permission", "permission", "counter offensive"],
      ["wrong-case", "cost-modifier", "Counter-Offensive"],
    ]);
    expect(findings.every((finding) => finding.kind === "stratagem")).toBe(true);
  });

  it("audits the shared _core enrichment pool and sorts findings deterministically", async () => {
    write(root, "enrichment/_core/abilities.json", [
      { ability_id: "shared", effect: keywordCondition(undefined, "SHARED MARKER") },
    ]);
    write(root, "enrichment/beta/abilities.json", [
      { ability_id: "zulu", effect: keywordCondition(undefined, "ZULU") },
      { ability_id: "alfa", effect: keywordCondition(undefined, "ALFA") },
    ]);
    write(root, "enrichment/alpha/abilities.json", [
      { ability_id: "mike", effect: keywordCondition(undefined, "MIKE") },
    ]);
    const findings = await collectDanglingAbilityReferences(root);
    expect(findings.map((finding) => [finding.source_file, finding.ability_id])).toEqual([
      ["enrichment/_core/abilities.json", "shared"],
      ["enrichment/alpha/abilities.json", "mike"],
      ["enrichment/beta/abilities.json", "alfa"],
      ["enrichment/beta/abilities.json", "zulu"],
    ]);
    // Repeating the scan yields byte-identical output.
    expect(await collectDanglingAbilityReferences(root)).toEqual(findings);
  });

  it("leaves malformed and non-array ability files to the structural validator", async () => {
    writeFileSync(join(root, "enrichment/alpha/abilities.json"), "[ { broken");
    write(root, "enrichment/beta/abilities.json", { ability_id: "not-an-array" });
    write(root, "enrichment/_core/abilities.json", [
      { ability_id: "readable", effect: keywordCondition(undefined, "MISSING") },
    ]);
    const findings = await collectDanglingAbilityReferences(root);
    expect(findings.map((finding) => finding.ability_id)).toEqual(["readable"]);
  });
});

describe("runDanglingRefsAudit", () => {
  let root: string;
  let previousExitCode: number | string | undefined;

  beforeEach(() => {
    root = setupDataRoot();
    writeCoreVocabulary(root);
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it("prints a clean report and leaves the exit status untouched", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      { ability_id: "resolved", effect: keywordCondition(undefined, "INFANTRY") },
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDanglingRefsAudit(root);
    expect(log.mock.calls.map(([line]) => line)).toContain("No dangling ability references.");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints every diagnostic and fails the process when findings exist", async () => {
    write(root, "enrichment/alpha/abilities.json", [
      { ability_id: "dangling-keyword", effect: keywordGate("defender", "A") },
      {
        ability_id: "dangling-stratagem",
        effect: { type: "cost-modifier", modifier: { of: "stratagem", id: "fire-overwatch-or-heroic", operation: "set", amount: 0 } },
      },
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDanglingRefsAudit(root);
    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("enrichment/alpha/abilities.json");
    expect(output).toContain(
      '  dangling-keyword /0/effect/condition/parameters/all_of/0 keyword (has-keyword) → "A"',
    );
    expect(output).toContain(
      '  dangling-stratagem /1/effect/modifier/id stratagem (cost-modifier) → "fire-overwatch-or-heroic"',
    );
    expect(output).toContain("2 dangling ability reference(s): 1 keyword, 1 stratagem.");
    expect(process.exitCode).toBe(1);
  });
});

describe("formatDanglingRefs", () => {
  it("groups findings by source file and summarizes both reference classes", () => {
    const findings: DanglingReference[] = [
      {
        kind: "keyword",
        reference_type: "has-keyword",
        source_file: "enrichment/alpha/abilities.json",
        ability_id: "one",
        path: "/0/effect/condition/parameters/all_of/0",
        value: "A",
      },
      {
        kind: "stratagem",
        reference_type: "cost-modifier",
        source_file: "enrichment/beta/abilities.json",
        ability_id: "two",
        path: "/3/effect/modifier/stratagem",
        value: "missing-stratagem",
      },
    ];
    const lines = formatDanglingRefs(findings, "/tmp/example/data");
    expect(lines[0]).toBe("40kdc Dangling Ability References");
    expect(lines[1]).toBe("Data root: /tmp/example/data");
    expect(lines).toContain("enrichment/alpha/abilities.json");
    expect(lines).toContain("enrichment/beta/abilities.json");
    expect(lines.at(-1)).toBe("2 dangling ability reference(s): 1 keyword, 1 stratagem.");
  });
});

describe("production dangling-reference disputes", () => {
  it("marks every confirmed defect without changing its dangling operand", async () => {
    const confirmed = (await collectDanglingAbilityReferences()).filter(
      (finding) =>
        (finding.kind === "keyword" && finding.value === "A") ||
        (finding.kind === "stratagem" && finding.value === "fire-overwatch-or-heroic"),
    );
    const keywordFindings = confirmed.filter(
      (finding) => finding.kind === "keyword" && finding.value === "A",
    );
    const stratagemFindings = confirmed.filter(
      (finding) => finding.kind === "stratagem" && finding.value === "fire-overwatch-or-heroic",
    );

    // Every "A" operand has been re-encoded from the rules: fated-hero and oathbound gate on the
    // keyword the player picks (`has-keyword` `chosen_by`), optimised-for-slaughter on the
    // defender's MONSTER or VEHICLE keyword. None may come back, and none may stay marked.
    expect(
      [...new Set(keywordFindings.map((finding) => finding.ability_id))].sort(),
    ).toEqual([]);
    // The legacy `fire-overwatch-or-heroic` cp-refund operand is now a choice of two
    // cost-modifiers naming the real `fire-overwatch` / `heroic-intervention` Stratagems.
    // None may come back, and no ability may keep the stale dispute mark.
    expect(stratagemFindings.map((finding) => `${finding.source_file}:${finding.ability_id}`)).toEqual([]);

    for (const finding of confirmed) {
      const abilities = JSON.parse(
        readFileSync(join(DATA_ROOT, finding.source_file), "utf-8"),
      ) as Array<Record<string, unknown>>;
      const index = Number(finding.path.split("/")[1]);
      const ability = abilities[index];
      const expectedNote =
        finding.kind === "keyword" ? KEYWORD_DISPUTE_NOTE : STRATAGEM_DISPUTE_NOTE;

      expect(ability?.ability_id).toBe(finding.ability_id);
      expect(ability?.disputed).toBe(true);
      expect(ability?.dispute_notes).toBe(expectedNote);
    }

    const marked = new Set<string>();
    for (const sourceFile of await glob("enrichment/*/abilities.json", {
      cwd: DATA_ROOT,
      nodir: true,
    })) {
      const abilities = JSON.parse(readFileSync(join(DATA_ROOT, sourceFile), "utf-8")) as Array<
        Record<string, unknown>
      >;
      for (const ability of abilities) {
        if (
          ability.dispute_notes === KEYWORD_DISPUTE_NOTE ||
          ability.dispute_notes === STRATAGEM_DISPUTE_NOTE
        ) {
          marked.add(`${sourceFile}:${String(ability.ability_id)}`);
        }
      }
    }
    expect(marked).toEqual(
      new Set(confirmed.map((finding) => `${finding.source_file}:${finding.ability_id}`)),
    );
  });
});
