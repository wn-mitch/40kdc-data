import chalk from "chalk";
import type { ValidationResult } from "./validate.js";

export type ReporterMode = "pretty" | "json";

export function formatReport(
  result: ValidationResult,
  mode: ReporterMode,
  title = "40kdc Data Validation Report",
  maxDiagnosticsPerRecord = Infinity,
): string {
  if (mode === "json") {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold(title));
  lines.push(chalk.gray("─".repeat(40)));
  lines.push(`Files scanned:  ${result.totalFiles}`);
  lines.push(`Items validated: ${result.totalItems}`);
  lines.push(chalk.green(`Passed: ${result.passed}`));

  if (result.failed > 0) {
    lines.push(chalk.red(`Failed: ${result.failed}`));
    lines.push("");

    for (const err of result.errors) {
      const loc = err.index >= 0 ? `[${err.index}]` : "";
      lines.push(chalk.red(`  ✗ ${err.file}${loc}`));
      for (let i = 0; i < Math.min(err.errors.length, maxDiagnosticsPerRecord); i++) {
        const e = err.errors[i]!;
        lines.push(chalk.yellow(`    ${e.path}: ${e.message}`));
      }
      if (err.errors.length > maxDiagnosticsPerRecord) {
        lines.push(chalk.yellow(`    (${err.errors.length - maxDiagnosticsPerRecord} additional diagnostics omitted for this record)`));
      }
    }
  } else {
    lines.push(chalk.green(`Failed: 0`));
    lines.push("");
    lines.push(chalk.green("All validations passed."));
  }

  lines.push("");
  return lines.join("\n");
}
