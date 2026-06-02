import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findSchemaFiles, SCHEMAS_ROOT } from "./schema-loader.js";

/**
 * Flattens the multi-file schema set into a single self-contained
 * draft-2020-12 document, written to crates/wh40kdc/schemas/bundled.schema.json.
 *
 * Why a bespoke flattener rather than a ref-parser bundle: the Rust codegen
 * (typify) wants one document where every type lives in a single flat `$defs`
 * map — it resolves `$ref`s as `#/$defs/<name>` and does NOT traverse nested
 * `$defs` paths. Generic bundlers also anchor a reused subschema to its first-use
 * location (e.g. `#/$defs/faction/properties/id`), yielding junk Rust type names.
 *
 * So this pass hoists EVERY definition — `common.schema.json`'s shared defs, each
 * entity schema (keyed by its filename stem), and every entity's local `$defs` —
 * flat into one top-level `$defs`. All such names are globally unique across the
 * schema set (asserted at build time), so no prefixing is needed and type names
 * track the names authors actually chose.
 *
 * Refs are resolved against each schema's `$id` URL — not its filesystem path —
 * because that is how the refs are authored (e.g. `../defs/common.schema.json`
 * targets the `$id` `.../schemas/defs/...`, while the file lives in `$defs/`).
 */

const COMMON_ID = "https://40kdc.dev/schemas/defs/common.schema.json";

/**
 * Schemas excluded from the codegen bundle (still loaded for AJV validation).
 * The roster schema describes importer *output* — a tool-side artifact, not a
 * dataset entity the Rust crate serves — so it is intentionally kept out of the
 * generated types. Its TS types are hand-authored in `src/import/types.ts`.
 */
const CODEGEN_EXCLUDED_IDS = new Set([
  "https://40kdc.dev/schemas/core/roster.schema.json",
]);
const OUTPUT_PATH = resolve(
  SCHEMAS_ROOT,
  "../crates/wh40kdc/schemas/bundled.schema.json",
);
const BUNDLE_ID = "https://40kdc.dev/schemas/bundled.schema.json";

type JsonObject = Record<string, unknown>;

function stemOfId(id: string): string {
  return basename(new URL(id).pathname).replace(/\.schema\.json$/, "");
}

/**
 * Rewrite a single `$ref` (resolved against the `$id` of the file it appears in)
 * to a flat pointer into the bundle's top-level `$defs`.
 *
 * - any `#/$defs/<name>` pointer (file-local, common, or cross-file into a hoisted
 *   local def) stays `#/$defs/<name>` — every such name is now top-level.
 * - a whole-file ref (`effect.schema.json`) maps to that file's stem: `#/$defs/effect`.
 */
function rewriteRef(ref: string, sourceId: string): string {
  const hashIndex = ref.indexOf("#");
  const filePart = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
  const pointer = hashIndex === -1 ? "" : ref.slice(hashIndex + 1); // e.g. "/$defs/entity-id"

  if (pointer) {
    if (!pointer.startsWith("/$defs/")) {
      throw new Error(
        `unexpected non-$defs JSON pointer in $ref ${JSON.stringify(ref)} (source ${sourceId})`,
      );
    }
    return `#${pointer}`;
  }

  // Whole-file ref: resolve to the target's $id and key by its stem.
  const targetId = filePart ? new URL(filePart, sourceId).href : sourceId;
  return `#/$defs/${stemOfId(targetId)}`;
}

/**
 * Strip JSON Schema conditional applicators (`if`/`then`/`else`) from the codegen
 * bundle. typify cannot model them — they express "field X is required when field
 * Y has value Z", which has no Rust-type representation. The constraints are still
 * enforced at data-validation time by ajv against the real (un-stripped) schemas;
 * dropping them here only makes the affected fields optional in the generated Rust
 * types, which is correct for deserializing any valid document.
 */
function stripConditionals(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripConditionals);
  }
  if (node && typeof node === "object") {
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node as JsonObject)) {
      if (key === "if" || key === "then" || key === "else") continue;
      out[key] = stripConditionals(value);
    }
    // Stripping `if`/`then`/`else` can empty out `allOf` members that existed
    // only to express a conditional (e.g. exactly-one-of cross-field rules). An
    // empty subschema is a no-op constraint, so drop those members; if none
    // remain, drop the `allOf` entirely. Without this the bundle keeps
    // `allOf: [{}, {}]`, which makes typify/json2ts emit a degenerate type and
    // lose the whole entity. The real constraint is still enforced by ajv
    // against the un-stripped source schemas.
    if (Array.isArray(out.allOf)) {
      const kept = (out.allOf as unknown[]).filter(
        (m) =>
          !(
            m &&
            typeof m === "object" &&
            !Array.isArray(m) &&
            Object.keys(m as JsonObject).length === 0
          ),
      );
      if (kept.length === 0) delete out.allOf;
      else out.allOf = kept;
    }
    return out;
  }
  return node;
}

/** Recursively rewrite every `$ref` in `node`, knowing the source schema's `$id`. */
function rewriteRefs(node: unknown, sourceId: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteRefs(item, sourceId));
  }
  if (node && typeof node === "object") {
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(node as JsonObject)) {
      if (key === "$ref" && typeof value === "string") {
        out[key] = rewriteRef(value, sourceId);
      } else {
        out[key] = rewriteRefs(value, sourceId);
      }
    }
    return out;
  }
  return node;
}

export function bundle(): JsonObject {
  const files = findSchemaFiles(SCHEMAS_ROOT).sort();
  const defs: JsonObject = {};

  const place = (name: string, def: unknown, sourceId: string): void => {
    if (name in defs) {
      throw new Error(`definition name collision: ${name} (from ${sourceId})`);
    }
    defs[name] = stripConditionals(rewriteRefs(def, sourceId));
  };

  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as JsonObject;
    const id = raw.$id as string;
    if (!id) throw new Error(`schema missing $id: ${file}`);
    if (CODEGEN_EXCLUDED_IDS.has(id)) continue;
    const { $id: _id, $schema: _schema, $defs: localDefs, ...body } = raw;

    // Hoist this file's local $defs flat to the top level (names are globally
    // unique across the schema set; collisions throw above).
    for (const [name, def] of Object.entries((localDefs ?? {}) as JsonObject)) {
      place(name, def, id);
    }

    // common is purely a $defs bag — it contributes no stem-keyed entity.
    if (id !== COMMON_ID) {
      place(stemOfId(id), body, id);
    }
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: BUNDLE_ID,
    title: "40kdc Bundled Schemas",
    description:
      "Auto-generated by tools/src/bundle-schemas.ts. Single self-contained schema for Rust codegen — do not edit by hand.",
    $defs: defs,
  };
}

function main(): void {
  const result = bundle();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n", "utf-8");
  const count = Object.keys(result.$defs as JsonObject).length;
  console.log(`Bundled ${count} definitions → ${OUTPUT_PATH}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
