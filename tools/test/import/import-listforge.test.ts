import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { importListForge } from "../../src/import/import-roster.js";
import { createValidator } from "../../src/schema-loader.js";

const ROSTER_SCHEMA_ID = "https://40kdc.dev/schemas/core/roster.schema.json";

const fixtureText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)), "utf8");

describe("importListForge (end-to-end)", () => {
  it("decodes a gzipped URL payload and emits a schema-valid roster", () => {
    const b64 = gzipSync(Buffer.from(fixtureText("gk-banishers.payload.json"), "utf8")).toString("base64");
    const url = `https://yourapp.example/#/listforge/${b64}`;

    const roster = importListForge(url);

    const validate = createValidator().getSchema(ROSTER_SCHEMA_ID)!;
    const ok = validate(roster);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });

  it("produces diagnostics tallies consistent with the units", () => {
    const roster = importListForge(fixtureText("gk-banishers.payload.json"));
    const d = roster.diagnostics;
    const resolvedUnits = roster.units.filter((u) => u.ref.resolved).length;
    const weapons = roster.units.flatMap((u) => u.wargear);
    expect(d.resolved_units).toBe(resolvedUnits);
    expect(d.unresolved_units).toBe(roster.units.length - resolvedUnits);
    expect(d.resolved_weapons + d.unresolved_weapons).toBe(weapons.length);
  });
});
