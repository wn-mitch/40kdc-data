/**
 * Writes the BSData-compatible export.
 *
 *   npx tsx src/bsdata-export/cli.ts --out <dir> [--index-url <url>]
 *   npx tsx src/bsdata-export/cli.ts --repo <dir>
 *
 * `--repo` writes only the committed data repo (`json/`, `xml/`) and removes
 * files there the export no longer writes.
 * `--index-url` is where `index.bsi` will be hosted; BattleScribe checks it
 * for updates. It defaults to the `bsdata-latest` release of the package's
 * repository.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExport, writeDataRepo, writeExport } from "./export.js";

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

function main(): void {
  const args = process.argv.slice(2);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(path.join(here, "..", "..", "package.json"), "utf8")) as { version: string; repository: { url: string } };
  const repoDir = flag(args, "--repo");
  if (repoDir) {
    const written = writeDataRepo(buildExport({ version: pkg.version }), path.resolve(repoDir));
    console.log(`wrote ${written.length} files to ${repoDir}`);
    return;
  }
  const out = flag(args, "--out");
  if (!out) throw new Error("usage: cli.ts --out <dir> [--index-url <url>] | --repo <dir>");
  const repo = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository.url)?.[1];
  const indexUrl = flag(args, "--index-url") ?? (repo ? `https://github.com/${repo}/releases/download/bsdata-latest/index.bsi` : undefined);
  if (!indexUrl) throw new Error("no --index-url and no GitHub repository in package.json");
  const written = writeExport(buildExport({ version: pkg.version }), path.resolve(out), { indexUrl });
  console.log(`wrote ${written.length} files to ${out}`);
}

main();
