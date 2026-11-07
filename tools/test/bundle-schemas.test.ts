import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { bundle } from "../src/bundle-schemas.js";
import { findSchemaFiles, SCHEMAS_ROOT } from "../src/schema-loader.js";

/** Collect every `$ref` string anywhere in a JSON value. */
function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") out.push(value);
      else collectRefs(value, out);
    }
  }
  return out;
}

describe("bundle-schemas", () => {
  const bundled = bundle();

  it("is fully self-contained — every $ref is a local pointer", () => {
    const refs = collectRefs(bundled);
    expect(refs.length).toBeGreaterThan(0);
    const external = refs.filter((r) => !r.startsWith("#"));
    expect(external).toEqual([]);
  });

  it("hoists every definition flat into a single top-level $defs", () => {
    const defs = bundled.$defs as Record<string, unknown>;
    // shared defs from common
    expect(defs["entity-id"]).toBeDefined();
    expect(defs["stat-value"]).toBeDefined();
    // entity schemas keyed by file stem
    expect(defs["unit"]).toBeDefined();
    expect(defs["faction"]).toBeDefined();
    expect(defs["effect"]).toBeDefined();
    // local sub-definitions hoisted flat (not nested under their parent)
    expect(defs["effect-node"]).toBeDefined();
    expect(defs["condition-node"]).toBeDefined();
    expect(defs["zone-shape"]).toBeDefined();
  });

  it("compiles in Ajv with all internal refs resolving", () => {
    const ajv = new Ajv({ strict: false, validateSchema: false });
    addFormats(ajv);
    // addSchema throws if any internal $ref fails to resolve.
    expect(() => ajv.addSchema(bundled, "bundled")).not.toThrow();
    expect(ajv.getSchema("bundled#/$defs/unit")).toBeDefined();
  });

  it("keeps every if/then/else in the validation bundle and none in the codegen bundle", () => {
    const count = (node: unknown): number =>
      Array.isArray(node)
        ? node.reduce((n: number, item) => n + count(item), 0)
        : node && typeof node === "object"
          ? Object.entries(node).reduce((n, [key, value]) => n + (key === "if" ? 1 : 0) + count(value), 0)
          : 0;
    const files = findSchemaFiles(SCHEMAS_ROOT).filter((f) => !f.endsWith("roster.schema.json"));
    const source = files.reduce((n, f) => n + count(JSON.parse(readFileSync(f, "utf-8"))), 0);
    expect(source).toBeGreaterThan(0);
    expect(count(bundle(true))).toBe(source);
    expect(count(bundled)).toBe(0);
  });

  it("rewrites the effect alias to the hoisted, flat effect-node", () => {
    const effect = (bundled.$defs as Record<string, any>).effect;
    expect(effect.$ref).toBe("#/$defs/effect-node");
    expect(effect.$defs).toBeUndefined();
  });
});
