import type Ajv from "ajv";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { glob } from "glob";
import { resolve, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");

export interface ValidationError {
  file: string;
  index: number;
  errors: Array<{ path: string; message: string }>;
}

export interface ValidationResult {
  totalFiles: number;
  totalItems: number;
  passed: number;
  failed: number;
  errors: ValidationError[];
}

const FORBIDDEN_TRACKED_PATHS = [
  /^_audit\/reauthor-input\//,
  /^core\/[^/]+\/_wargear-options\.unparsed\.json$/,
  /^_audit\/blessings-of-khorne-three-way\.md$/,
  /^_audit\/proposed\/REVIEW-DETAIL\.md$/,
];

const PROHIBITED_SOURCE_KEYS = new Set([
  "raw_text",
  "effectRules",
  "targetRules",
  "whenRules",
  "restrictionRules",
  "original_rule",
  "source_text",
]);

function containsProhibitedSourceKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProhibitedSourceKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      PROHIBITED_SOURCE_KEYS.has(key) || containsProhibitedSourceKey(child),
  );
}

function trackedDataFiles(root: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "-z", "--", "data"], {
      cwd: resolve(root, ".."),
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .map((file) => file.replace(/^data\//, ""))
      .filter((file) => existsSync(resolve(root, file)));
  } catch {
    return [];
  }
}

/** Enforce the public dataset boundary without attempting prose heuristics. */
export async function validatePublicSourceBoundary(
  root = DATA_ROOT,
  trackedFiles = trackedDataFiles(root),
): Promise<ValidationResult> {
  const forbiddenFiles = trackedFiles
    .filter((file) =>
      FORBIDDEN_TRACKED_PATHS.some((pattern) => pattern.test(file)),
    )
    .map((file) => resolve(root, file));
  const runtimeFiles = await glob("{core,enrichment}/**/*.json", {
    cwd: root,
    absolute: true,
    ignore: ["**/_*", "**/_*/**"],
  });
  const rawTextFiles = runtimeFiles.filter((file) =>
    containsProhibitedSourceKey(JSON.parse(readFileSync(file, "utf8"))),
  );
  const violations = [...new Set([...forbiddenFiles, ...rawTextFiles])].sort();
  return {
    totalFiles: runtimeFiles.length,
    totalItems: 0,
    passed: runtimeFiles.length - rawTextFiles.length,
    failed: violations.length,
    errors: violations.map((file) => ({
      file,
      index: -1,
      errors: [
        {
          path: relative(root, file),
          message:
            "raw source input must live under _private/ or in the private source store",
        },
      ],
    })),
  };
}

/**
 * Map from data file base-name prefix to schema $id.
 */
const SCHEMA_MAP: Record<string, string> = {
  factions: "https://40kdc.dev/schemas/core/faction.schema.json",
  units: "https://40kdc.dev/schemas/core/unit.schema.json",
  "target-profiles":
    "https://40kdc.dev/schemas/core/target-profile.schema.json",
  weapons: "https://40kdc.dev/schemas/core/weapon.schema.json",
  "weapon-keywords":
    "https://40kdc.dev/schemas/core/weapon-keyword.schema.json",
  "unit-keywords": "https://40kdc.dev/schemas/core/unit-keyword.schema.json",
  "game-versions": "https://40kdc.dev/schemas/core/game-version.schema.json",
  "game-modes": "https://40kdc.dev/schemas/core/game-mode.schema.json",
  detachments: "https://40kdc.dev/schemas/core/detachment.schema.json",
  allies: "https://40kdc.dev/schemas/core/allied-rule.schema.json",
  enhancements: "https://40kdc.dev/schemas/core/enhancement.schema.json",
  stratagems: "https://40kdc.dev/schemas/core/stratagem.schema.json",
  "wargear-options":
    "https://40kdc.dev/schemas/core/wargear-option.schema.json",
  wargear: "https://40kdc.dev/schemas/core/wargear.schema.json",
  "leader-attachments":
    "https://40kdc.dev/schemas/core/leader-attachment.schema.json",
  "unit-compositions":
    "https://40kdc.dev/schemas/core/unit-composition.schema.json",
  "force-dispositions":
    "https://40kdc.dev/schemas/core/force-disposition.schema.json",
  "deployment-patterns":
    "https://40kdc.dev/schemas/core/deployment-pattern.schema.json",
  "mission-matchups":
    "https://40kdc.dev/schemas/core/mission-matchup.schema.json",
  missions: "https://40kdc.dev/schemas/core/mission.schema.json",
  "mission-cards": "https://40kdc.dev/schemas/core/secondary-card.schema.json",
  "terrain-templates":
    "https://40kdc.dev/schemas/core/terrain-template.schema.json",
  "terrain-layouts":
    "https://40kdc.dev/schemas/core/terrain-layout.schema.json",
  "hull-shapes": "https://40kdc.dev/schemas/core/hull-shape.schema.json",
  "phase-mappings":
    "https://40kdc.dev/schemas/enrichment/phase-mapping.schema.json",
  "interaction-flags":
    "https://40kdc.dev/schemas/enrichment/interaction-flag.schema.json",
  abilities:
    "https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json",
  "resource-pools":
    "https://40kdc.dev/schemas/enrichment/resource-pool.schema.json",
};

/**
 * Determine which schema $id to use for a given data file path.
 * Convention: the file's base name starts with a SCHEMA_MAP prefix (real data is
 * `<prefix>.json`; test fixtures are `<prefix>-good.json` / `<prefix>-bad.json`).
 * Prefixes are tried longest-first so `wargear-options.json` resolves to the
 * wargear-option schema rather than the shorter `wargear` key (distinct entities).
 */
const SCHEMA_PREFIXES = Object.keys(SCHEMA_MAP).sort(
  (a, b) => b.length - a.length,
);
function resolveSchemaId(filePath: string): string | null {
  const base = basename(filePath);
  for (const prefix of SCHEMA_PREFIXES) {
    if (base.startsWith(prefix)) return SCHEMA_MAP[prefix];
  }
  return null;
}

/**
 * Validate all data files matching the given glob pattern.
 * Each data file is expected to be a JSON array; each element is validated individually.
 */
export async function validateFiles(
  ajv: Ajv,
  pattern: string,
  cwd?: string,
): Promise<ValidationResult> {
  const root = cwd ?? DATA_ROOT;
  const files = await glob(pattern, { cwd: root, absolute: true });

  const result: ValidationResult = {
    totalFiles: files.length,
    totalItems: 0,
    passed: 0,
    failed: 0,
    errors: [],
  };

  for (const file of files) {
    // Underscore-prefixed files are private/scratch artifacts, not dataset
    // entities. Public-source validation rejects known raw-input paths.
    if (basename(file).startsWith("_")) continue;
    const schemaId = resolveSchemaId(file);
    if (!schemaId) {
      result.errors.push({
        file,
        index: -1,
        errors: [
          {
            path: "",
            message: `No schema mapping found for file: ${basename(file)}`,
          },
        ],
      });
      result.failed++;
      continue;
    }

    const validate = ajv.getSchema(schemaId);
    if (!validate) {
      result.errors.push({
        file,
        index: -1,
        errors: [{ path: "", message: `Schema not found: ${schemaId}` }],
      });
      result.failed++;
      continue;
    }

    let data: unknown;
    try {
      const raw = readFileSync(file, "utf-8");
      data = JSON.parse(raw);
    } catch (err) {
      result.errors.push({
        file,
        index: -1,
        errors: [
          {
            path: "",
            message: `Failed to parse JSON: ${(err as Error).message}`,
          },
        ],
      });
      result.failed++;
      continue;
    }

    if (!Array.isArray(data)) {
      result.errors.push({
        file,
        index: -1,
        errors: [{ path: "", message: "Data file must be a JSON array" }],
      });
      result.failed++;
      continue;
    }

    for (let i = 0; i < data.length; i++) {
      result.totalItems++;
      const valid = validate(data[i]);
      if (valid) {
        result.passed++;
      } else {
        result.failed++;
        result.errors.push({
          file,
          index: i,
          errors: (validate.errors ?? []).map((e) => ({
            path: e.instancePath || "/",
            message: e.message ?? "Unknown validation error",
          })),
        });
      }
    }
  }

  return result;
}
