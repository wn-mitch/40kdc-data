import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileLeaves } from "../src/round5c/compile.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { mergeStackedFilters } from "../src/round5c/compile-unit-filters.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/round5c/contracts.js";
import { coreCheckErrors } from "../src/round5c/core-checks.js";
import { checkEntry, entryWithMechanics } from "../src/round5c/entries.js";

// Fabricated wording and records only; no GW rule prose.

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>, fragment?: string, version = currentFamilyVersion(family_id)): CompileLeaf {
  at += 10;
  return {
    role: familyRole(family_id, version), family_id, family_version: version, start_byte: at,
    parameters: normalizeFingerprintParameters(family_id, parameters, version), ...(fragment ? { fragment } : {}),
  };
}
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
function compiled(leaves: CompileLeaf[]): Record<string, unknown> {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}
const errors = (leaves: CompileLeaf[]) => {
  const result = compileLeaves(leaves);
  return result.ok ? [] : result.errors;
};
const first = (tree: unknown, type: string) => nodes(tree, (node) => node.type === type)[0];
const heal = () => leaf("regain-wounds", { subject: "this-unit", amount: "1" });

describe("targeting-restriction by and target", () => {
  const restriction = { may: "must-target", kind: "attack", weapon_type: "all" };

  it("names the unit that targets and the unit targeted, the anaphor bound to the selection", () => {
    const tree = compiled([
      leaf("select-unit", { scope: "enemy", distance: "any", visible: false }),
      leaf("targeting-restriction", { ...restriction, by: "this-unit", target: "antecedent" }),
    ]);
    expect(first(tree, "targeting")).toEqual({ type: "targeting", target: "this-unit", modifier: { by: "this-unit", may: "must-target", kind: "attack", target: "selected-unit" } });
  });

  it("puts a passive restriction on the unit targeted, with no attacker named", () => {
    const tree = compiled([leaf("targeting-restriction", { may: "cannot-target", kind: "shoot", weapon_type: "ranged", target: "this-unit" })]);
    expect(first(tree, "targeting")).toEqual({ type: "targeting", target: "this-unit", modifier: { may: "cannot-target", kind: "shoot", weapon_type: "ranged", target: "this-unit" } });
  });

  it("lowers every enemy unit as an owner filter on either side", () => {
    const tree = compiled([leaf("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", by: "enemy-units", target: "this-unit" })]);
    expect(first(tree, "targeting")).toMatchObject({ target: { owner: "enemy" }, modifier: { by: { owner: "enemy" }, target: "this-unit" } });
  });

  it("names one Stratagem, or every Stratagem but the Core ones", () => {
    const fire = compiled([leaf("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", by: "enemy-units", target: "this-unit", stratagem: "fire-overwatch" })]);
    expect(first(fire, "targeting")).toMatchObject({ modifier: { by: { owner: "enemy" }, target: "this-unit", kind: "stratagem", stratagem: "fire-overwatch" } });
    const core = compiled([leaf("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", target: "this-model", except: "core-stratagems" })]);
    expect(first(core, "targeting")).toMatchObject({ target: "this-model", modifier: { target: "this-model", except: "core-stratagems" } });
    expect(() => normalize("targeting-restriction", { may: "cannot-target", kind: "attack", weapon_type: "all", target: "this-unit", stratagem: "fire-overwatch" })).toThrow(/kind stratagem only/u);
    expect(() => normalize("targeting-restriction", { may: "must-target", kind: "stratagem", weapon_type: "all", target: "this-unit", except: "core-stratagems" })).toThrow(/cannot-target/u);
    expect(() => normalize("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", subject: "this-unit", stratagem: "fire-overwatch" })).toThrow(/not subject/u);
    expect(() => normalize("targeting-restriction", { may: "cannot-target", kind: "stratagem", weapon_type: "all", target: "this-unit", stratagem: "Fire Overwatch" })).toThrow(/kebab-case/u);
  });

  it("keeps a subject leaf exactly as the previous version read it", () => {
    const tree = compiled([leaf("targeting-restriction", { ...restriction, subject: "this-unit" })]);
    expect(first(tree, "targeting")).toEqual({ type: "targeting", target: "this-unit", modifier: { may: "must-target", kind: "attack" } });
    expect(currentFamilyVersion("targeting-restriction")).toBeGreaterThan(2);
    expect(normalizeFingerprintParameters("targeting-restriction", { ...restriction, subject: "this-unit" }, currentFamilyVersion("targeting-restriction") - 1))
      .toEqual(normalize("targeting-restriction", { ...restriction, subject: "this-unit" }));
  });

  it("refuses a leaf that mixes the readings, an attacker with no target, or one unit on both sides", () => {
    expect(() => normalize("targeting-restriction", { ...restriction, subject: "this-unit", target: "antecedent" })).toThrow(/either subject/u);
    expect(() => normalize("targeting-restriction", { ...restriction, by: "this-unit" })).toThrow(/needs a target/u);
    expect(() => normalize("targeting-restriction", { ...restriction, by: "this-unit", target: "this-unit" })).toThrow(/same unit/u);
    expect(() => normalize("targeting-restriction", { ...restriction })).toThrow();
  });

  it("refuses an anaphor with nothing for it to point back to in a Stratagem", () => {
    expect(errors([
      leaf("use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"),
      leaf("targeting-restriction", { ...restriction, by: "this-unit", target: "antecedent" }, "EFFECT"),
    ]).join()).toMatch(/points back/u);
  });
});

describe("stacked unit-filters", () => {
  const friendly = (extra: Record<string, unknown>) => leaf("unit-filter", { side: "friendly", ...extra }, "TARGET");
  const owner = () => leaf("unit-owner", { owner: "friendly" }, "TARGET");

  it("merges a keyword filter and an excluding filter, keeping \"from your army\" after them", () => {
    const merged = mergeStackedFilters([friendly({ keywords: ["ALPHA"] }), owner(), friendly({ excluded_keywords: ["BETA"] })]);
    expect(merged.map((item) => item.family_id)).toEqual(["unit-filter", "unit-owner"]);
    expect(merged[0]!.parameters).toEqual({ side: "friendly", keywords: ["ALPHA"], excluded_keywords: ["BETA"] });
  });

  it("compiles a Stratagem target written as two filters", () => {
    const result = compileLeaves([
      leaf("use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }, "WHEN"),
      leaf("stratagem-target", { count: "one" }, "TARGET"), friendly({ keywords: ["ALPHA"] }), owner(), friendly({ excluded_keywords: ["BETA"] }),
      leaf("regain-wounds", { subject: "this-unit", amount: "1" }, "EFFECT"),
    ]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(JSON.stringify(result.core)).toContain("ALPHA");
    expect(JSON.stringify(result.core)).toContain("BETA");
  });

  it("leaves filters of different sides, of models and units, or with two any-of lists apart", () => {
    const enemy = leaf("unit-filter", { side: "enemy" }, "TARGET");
    expect(mergeStackedFilters([enemy, friendly({ keywords: ["ALPHA"] })])).toHaveLength(2);
    expect(mergeStackedFilters([friendly({ keywords: ["ALPHA"], level: "model" }), friendly({ excluded_keywords: ["BETA"] })])).toHaveLength(2);
    expect(mergeStackedFilters([friendly({ any_keywords: ["ALPHA", "GAMMA"] }), friendly({ any_keywords: ["BETA", "DELTA"] })])).toHaveLength(2);
    // A "from your army" of another side between them keeps them apart too.
    expect(mergeStackedFilters([friendly({ keywords: ["ALPHA"] }), leaf("unit-owner", { owner: "enemy" }, "TARGET"), friendly({ excluded_keywords: ["BETA"] })])).toHaveLength(3);
  });

  it("refuses a merged filter that requires and excludes one keyword", () => {
    expect(() => mergeStackedFilters([friendly({ keywords: ["ALPHA"] }), friendly({ excluded_keywords: ["ALPHA"] })])).toThrow(/require and exclude/u);
  });
});

describe("selected to charge", () => {
  it("lowers to the DSL's declare-charge", () => {
    const tree = compiled([leaf("event", { kind: "selected", to: "charge" }), heal()]);
    expect(tree.trigger).toEqual({ event: "selected", filter: { to: "declare-charge" } });
  });
});

describe("implied CHARACTER on enhancements", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture(nonCharacter: boolean | null): string {
    const base = mkdtempSync(join(tmpdir(), "round5c-extensions-4-"));
    roots.push(base);
    const data = join(base, "data");
    mkdirSync(join(data, "core", "alpha"), { recursive: true });
    // Fabricated fixture record only.
    writeFileSync(join(data, "core", "alpha", "enhancements.json"), JSON.stringify([
      { id: "gun", keyword_restrictions: ["Alpha", "Titanic"], external_refs: [{ namespace: "mfm", id: "m-1" }] },
    ]));
    if (nonCharacter !== null) {
      mkdirSync(join(base, "_private"));
      writeFileSync(join(base, "_private", "dump.json"), JSON.stringify({ data: { enhancement: [{ id: "m-1", isEquipableByNonCharacterUnit: nonCharacter }] } }));
    }
    return data;
  }
  const check = (data: string) => coreCheckErrors(data, "gun", [{ kind: "bearer-eligibility", parameters: { keywords: ["ALPHA", "CHARACTER", "TITANIC"], match: "all", excluded_keywords: [] } }]);

  it("accepts CHARACTER the core record leaves out when the dump keeps the enhancement from non-Characters", () => {
    expect(check(fixture(false))).toEqual([]);
  });

  it("still refuses CHARACTER when the dump lets non-Characters take it, or there is no dump", () => {
    expect(check(fixture(true))).toHaveLength(1);
    expect(check(fixture(null))).toHaveLength(1);
  });
});

describe("detachment tags", () => {
  const enrichment = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
  const authored = (factionId: string, abilityId: string) => (JSON.parse(readFileSync(join(enrichment, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
    .find((item) => item.ability_id === abilityId)!;

  it("lowers the tag a detachment carries as the army rule's tag, which the DSL schema accepts", () => {
    const tree = compiled([leaf("army-construction", { rule: "detachment-tag-exclusive", with_keywords: ["ALPHA"] })]);
    expect(first(tree, "army-rule")).toEqual({ type: "army-rule", target: "this-unit", modifier: { rule: "detachment-tag-exclusive", tag: "ALPHA" } });
    const result = compileLeaves([leaf("army-construction", { rule: "detachment-tag-exclusive", with_keywords: ["ALPHA"] })]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(checkEntry(entryWithMechanics(authored("aeldari", "dance-of-distortion-aeldari"), result.mechanics)).errors).toEqual([]);
  });

  it("refuses a tag leaf that names no tag", () => {
    expect(errors([leaf("army-construction", { rule: "detachment-tag-exclusive" })]).join()).toMatch(/exactly one tag/u);
  });
});
