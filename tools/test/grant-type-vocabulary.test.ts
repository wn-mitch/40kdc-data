import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditGrantTypes, frozenVocabulary, schemaEffectTypes } from "../src/audit-grant-types.js";
import { createValidator, SCHEMAS_ROOT } from "../src/schema-loader.js";

const ABILITY_SCHEMA_ID = "https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json";
const DATA_ROOT = resolve(SCHEMAS_ROOT, "../data");

function ability(grantType: string): Record<string, unknown> {
  return {
    ability_id: "fixture",
    name: "Fixture",
    authored_by: "40kdc-community",
    game_version: { edition: "11th", dataslate: "codex-orks" },
    version: "2025-q3",
    effect: {
      type: "ability-grant",
      target: "unit",
      modifier: { grant_type: grantType },
    },
    scope: { range: "self", duration: "battle" },
    unit_ids: [],
    ability_type: "unit",
    behavior: "passive",
    faction_id: "orks",
  };
}

describe("grant_type vocabulary", () => {
  it("rejects a grant_type that is not in the frozen vocabulary", () => {
    const validate = createValidator().getSchema(ABILITY_SCHEMA_ID);
    expect(validate).toBeDefined();
    expect(validate!(ability("no-such-grant-type-exists"))).toBe(false);
  });

  it("accepts a grant_type that is in the frozen vocabulary", () => {
    const validate = createValidator().getSchema(ABILITY_SCHEMA_ID);
    expect(validate!(ability("place-into-strategic-reserves"))).toBe(true);
  });

  it("covers every grant_type the corpus actually uses", async () => {
    // The enum was generated from this audit. If a value is used but missing
    // from the vocabulary, every record carrying it now fails validation — so
    // this asserts the freeze was complete rather than merely plausible.
    const audit = await auditGrantTypes();
    const validate = createValidator().getSchema(ABILITY_SCHEMA_ID);
    const missing = audit.classifications
      .filter((entry) => !validate!(ability(entry.grant_type)))
      .map((entry) => entry.grant_type);
    expect(missing).toEqual([]);
  });

  it("validates every enrichment ability record in the corpus", async () => {
    const validate = createValidator().getSchema(ABILITY_SCHEMA_ID);
    expect(validate).toBeDefined();
    const files: string[] = [];
    for await (const file of glob("enrichment/**/abilities.json", { cwd: DATA_ROOT })) {
      files.push(join(DATA_ROOT, file));
    }
    const failures: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const record of JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[]) {
        checked += 1;
        if (!validate!(record)) failures.push(`${file}:${record.ability_id}`);
      }
    }
    expect(files.length).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(3000);
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("classifies grant types against effects the schema already declares", async () => {
    const audit = await auditGrantTypes();
    const effectTypes = new Set(schemaEffectTypes());
    const exact = audit.classifications.filter((entry) => entry.verdict === "names-existing-effect");
    // These are strings that stand in for a typed effect that already exists.
    expect(exact.length).toBeGreaterThan(0);
    for (const entry of exact) {
      expect(effectTypes.has(entry.matches_effect_type!)).toBe(true);
    }
    expect(frozenVocabulary(audit).length).toBe(audit.distinct_grant_types);
  });
});
