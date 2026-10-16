import { describe, it, expect } from "vitest";
import { createValidator } from "../src/schema-loader.js";
import {
  validateFiles,
  validatePublicSourceBoundary,
} from "../src/validate.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const EXAMPLE_DATA_DIR = resolve(__dirname, "../../data");

describe("validate", () => {
  it("validates valid core example data without errors", async () => {
    const ajv = createValidator();
    const result = await validateFiles(ajv, "core/**/*.json", EXAMPLE_DATA_DIR, createValidator({ allErrors: false }));
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(0);
  });

  it("validates valid enrichment example data without errors", async () => {
    const ajv = createValidator();
    const result = await validateFiles(
      ajv,
      "enrichment/**/*.json",
      EXAMPLE_DATA_DIR,
      createValidator({ allErrors: false }),
    );
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(0);
  });

  it("rejects public raw-source paths and raw_text fields", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "40kdc-source-boundary-"));
    try {
      mkdirSync(resolve(root, "core", "fixture"), { recursive: true });
      mkdirSync(resolve(root, "_audit", "reauthor-input"), { recursive: true });
      writeFileSync(
        resolve(root, "core", "fixture", "units.json"),
        JSON.stringify([
          { id: "fixture", raw_text: "fabricated source input" },
        ]),
      );
      writeFileSync(
        resolve(root, "_audit", "reauthor-input", "fixture.json"),
        "[]",
      );

      const result = await validatePublicSourceBoundary(root, [
        "_audit/reauthor-input/fixture.json",
        "core/fixture/units.json",
      ]);
      expect(result.failed).toBe(2);
      expect(
        result.errors.map((error) => error.errors[0]?.path).sort(),
      ).toEqual([
        "_audit/reauthor-input/fixture.json",
        "core/fixture/units.json",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates valid fixture files without errors", async () => {
    const ajv = createValidator();
    const result = await validateFiles(ajv, "valid/**/*.json", FIXTURES_DIR);
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(0);
  });

  it("rejects invalid fixture files", async () => {
    const ajv = createValidator();
    const result = await validateFiles(ajv, "invalid/**/*.json", FIXTURES_DIR);
    expect(result.failed).toBeGreaterThan(0);
  });

  it("retains every invalid record and independent diagnostics after a fast validity failure", async () => {
    const result = await validateFiles(
      createValidator(),
      "invalid/factions-bad.json",
      FIXTURES_DIR,
      createValidator({ allErrors: false }),
    );
    expect(result.errors.map((record) => record.index)).toEqual([0, 1, 2]);
    expect(result.errors[0]!.errors.map((issue) => issue.path)).toEqual(expect.arrayContaining(["/", "/id"]));
    expect(result.errors[2]!.errors.map((issue) => issue.path)).toContain("/game_version/edition");
  });
});
