import Ajv from "ajv";
import addFormats from "ajv-formats";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Resolve the schema tree across both layouts:
 *  - in-repo / dev: schemas live in the sibling top-level `schemas/` dir
 *    (`../../schemas` from `dist/` or `src/`) — always the live source.
 *  - packaged: once published, schemas are copied into the package root, so
 *    `<pkg>/schemas` sits one level above the compiled file in `dist/`
 *    (`../schemas`). When installed, the repo path resolves outside the
 *    package and doesn't exist, so this branch is taken.
 * Repo path wins when present so dev runs never read a stale `copy:schemas`
 * artifact; the packaged copy is the fallback for installed consumers.
 */
function resolveSchemasRoot(): string {
  const repo = resolve(__dirname, "../../schemas");
  const packaged = resolve(__dirname, "../schemas");
  return existsSync(repo) ? repo : packaged;
}

export const SCHEMAS_ROOT = resolveSchemasRoot();

/**
 * Recursively find all .schema.json files under a directory.
 */
export function findSchemaFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findSchemaFiles(full));
    } else if (entry.endsWith(".schema.json")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Create and configure an AJV instance with all project schemas loaded.
 * Schemas are registered by their $id so $ref resolution works across files.
 */
export function createValidator(options: { allErrors?: boolean } = {}): Ajv {
  const ajv = new Ajv({
    strict: false,
    allErrors: options.allErrors ?? true,
    validateSchema: false,
  });
  addFormats(ajv);

  const schemaFiles = findSchemaFiles(SCHEMAS_ROOT);
  const schemas = schemaFiles.map((file) => {
    const raw = readFileSync(file, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  });

  // Register all schemas by $id
  for (const schema of schemas) {
    const id = schema["$id"] as string | undefined;
    if (id) {
      ajv.addSchema(schema, id);
    }
  }

  return ajv;
}

/**
 * Return the list of all loaded schema $id values.
 */
export function listSchemaIds(): string[] {
  const schemaFiles = findSchemaFiles(SCHEMAS_ROOT);
  const ids: string[] = [];
  for (const file of schemaFiles) {
    const raw = readFileSync(file, "utf-8");
    const schema = JSON.parse(raw) as Record<string, unknown>;
    if (schema["$id"]) {
      ids.push(schema["$id"] as string);
    }
  }
  return ids;
}
