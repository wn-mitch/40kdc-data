/**
 * Writes the BSData-compatible export.
 *
 *   npx tsx src/bsdata-export/cli.ts --out <dir>
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExport, writeExport } from "./export.js";

function main(): void {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf("--out");
  if (outFlag < 0 || !args[outFlag + 1]) throw new Error("usage: cli.ts --out <dir>");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(path.join(here, "..", "..", "package.json"), "utf8")) as { version: string };
  const written = writeExport(buildExport({ version: pkg.version }), path.resolve(args[outFlag + 1]));
  console.log(`wrote ${written.length} files to ${args[outFlag + 1]}`);
}

main();
