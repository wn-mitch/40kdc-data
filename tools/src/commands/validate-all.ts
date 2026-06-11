import { createValidator } from "../schema-loader.js";
import { validateFiles } from "../validate.js";
import { checkReferentialIntegrity } from "../integrity.js";
import { formatReport, type ReporterMode } from "../report.js";
import type { ValidationResult } from "../validate.js";

export async function validateAllCommand(opts: { reporter: string }): Promise<void> {
  const ajv = createValidator();
  const mode = opts.reporter as ReporterMode;

  const coreResult = await validateFiles(ajv, "core/**/*.json");
  const enrichmentResult = await validateFiles(ajv, "enrichment/**/*.json");

  const combined: ValidationResult = {
    totalFiles: coreResult.totalFiles + enrichmentResult.totalFiles,
    totalItems: coreResult.totalItems + enrichmentResult.totalItems,
    passed: coreResult.passed + enrichmentResult.passed,
    failed: coreResult.failed + enrichmentResult.failed,
    errors: [...coreResult.errors, ...enrichmentResult.errors],
  };
  console.log(formatReport(combined, mode));

  // Cross-entity referential integrity (ability-ref resolution, faction_keyword
  // membership) — checks that per-file JSON Schema validation cannot express.
  const integrity = await checkReferentialIntegrity();
  console.log(formatReport(integrity, mode, "40kdc Referential Integrity Report"));

  if (combined.failed > 0 || integrity.failed > 0) {
    process.exit(1);
  }
}
