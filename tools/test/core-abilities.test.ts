import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createValidator, SCHEMAS_ROOT } from "../src/schema-loader.js";

const CATALOG = resolve(SCHEMAS_ROOT, "../data/core/unit-keywords.json");
const CATALOG_SCHEMA_ID = "https://40kdc.dev/schemas/core/unit-keyword.schema.json";

type CatalogEntry = {
  id: string;
  name: string;
  required_parameters: string[];
  effect: unknown;
  game_version: unknown;
  overridable_parameters?: Array<{ name: string; default: number | string }>;
};

function catalog(): CatalogEntry[] {
  return JSON.parse(readFileSync(CATALOG, "utf8")) as CatalogEntry[];
}

/** Every enrichment ability file in the corpus; `_core` is production data. */
function enrichmentAbilityFiles(): string[] {
  const root = resolve(SCHEMAS_ROOT, "../data/enrichment");
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith("_") && entry.name !== "_core") continue;
        visit(join(dir, entry.name));
      } else if (entry.name === "abilities.json") {
        files.push(join(dir, entry.name));
      }
    }
  };
  visit(root);
  return files.sort();
}

describe("core ability catalog", () => {
  it("validates every entry against its schema", () => {
    const validate = createValidator().getSchema(CATALOG_SCHEMA_ID);
    expect(validate).toBeDefined();
    const failures = catalog()
      .filter((entry) => !validate!(entry))
      .map((entry) => entry.id);
    expect(failures).toEqual([]);
  });

  it("encodes the mechanic for every core ability", () => {
    // Closed as of the hover encoding: `take-to-the-skies` became a move type
    // and `waives_distance_penalty` expresses "do not subtract 2\" from the
    // maximum distance". Every catalog entry now carries a mechanic, so a null
    // effect is a regression rather than a known gap.
    const uncoded = catalog()
      .filter((entry) => entry.effect === null)
      .map((entry) => entry.id);
    expect(uncoded).toEqual([]);
  });

  it("declares a parameter wherever the effect references one", () => {
    // A catalog entry expresses a value-agnostic mechanic by naming a declared
    // parameter in the modifier. If a name is referenced but not declared, the
    // reference site has no way to supply it.
    for (const entry of catalog()) {
      const blob = JSON.stringify(entry.effect);
      if (blob === "null") continue;
      const declared = new Set([
        ...entry.required_parameters,
        ...(entry.overridable_parameters ?? []).map((parameter) => parameter.name),
      ]);
      for (const name of ["value", "distance"]) {
        // The parameter appears as a string VALUE; `"value"` as a bare key is
        // an ordinary numeric modifier field and must not count.
        if (!new RegExp(`:\\s*"${name}"`).test(blob)) continue;
        expect(declared.has(name), `${entry.id} references ${name} but does not declare it`).toBe(true);
      }
    }
  });

  it("records deep strike's distance as overridable rather than absent", () => {
    // Deep Strike takes no argument in the rulebook, but six factions ship a
    // variant that overrides the 8\" default, so the distance is a real
    // parameter and a variants-only model would make them unrepresentable.
    const deepStrike = catalog().find((entry) => entry.id === "deep-strike")!;
    expect(deepStrike.required_parameters).toEqual([]);
    expect(deepStrike.overridable_parameters).toEqual([
      { name: "distance", default: 8, unit: "inches" },
    ]);
  });

  it("encodes per-target-keyword deep strike distances canonically", () => {
    // Death Approaches sets up more than 6\" from AFFLICTED enemy units and
    // more than 8\" from every other enemy unit. The prior record used the
    // non-canonical `distance_constraints` key and recorded 9\" for the
    // fallback, contradicting the source text.
    const deathGuard = JSON.parse(readFileSync(
      resolve(SCHEMAS_ROOT, "../data/enrichment/death-guard/abilities.json"),
      "utf8",
    )) as Array<{ ability_id: string; effect: unknown }>;
    const record = deathGuard.find((entry) => entry.ability_id === "death-approaches")!;
    const modifier = (record.effect as {
      effect: { modifier: { min_distance: Array<{ keyword?: string; distance: number }> } };
    }).effect.modifier;
    expect(modifier.min_distance).toEqual([
      { keyword: "AFFLICTED", distance: 6 },
      { distance: 8 },
    ]);
    expect(JSON.stringify(record.effect)).not.toContain("distance_constraints");
  });

  it("uses one spelling for the deep strike distance override", () => {
    // The 6"-instead-of-8" variant appeared twelve times in six encodings,
    // including a whole English sentence inside a string, and several records
    // dropped the distance entirely. `min_distance` is canonical; the others
    // were all renames of the same concept. Scoped to `deep-strike` modifiers,
    // because `range` and `placement_*` are legitimate keys on other effects.
    const LEGACY_SPELLINGS = [
      "min_distance_from_enemy",
      "distance_constraints",
      "placement_restriction",
      "range",
      "replaces_default",
    ];
    const offenders: string[] = [];
    for (const file of enrichmentAbilityFiles()) {
      for (const record of JSON.parse(readFileSync(file, "utf8")) as Array<{
        ability_id: string;
        effect: unknown;
      }>) {
        const stack: unknown[] = [record.effect];
        while (stack.length) {
          const node = stack.pop();
          if (Array.isArray(node)) {
            stack.push(...node);
            continue;
          }
          if (node === null || typeof node !== "object") continue;
          const asRecord = node as Record<string, unknown>;
          if (asRecord.type === "deep-strike" && asRecord.modifier) {
            for (const key of Object.keys(asRecord.modifier as Record<string, unknown>)) {
              if (LEGACY_SPELLINGS.includes(key)) offenders.push(`${record.ability_id}: ${key}`);
            }
          }
          stack.push(...Object.values(asRecord));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
