/**
 * prose — read ability prose from the private MFM dump (`_private/dump.json`).
 *
 *   npm run prose -- get <faction> <ability_id>       the text, its dump ref, and the rows it came from
 *   npm run prose -- grep <regex> [--faction <f>]     ability ids whose text matches (case-insensitive)
 *   npm run prose -- export [--out <dir>] [--faction <f>]
 *        writes `<faction>.json` (entry arrays) and `index.json` (`{schema_version, factions}`)
 *        to `_private/prose/` for tools that cannot import TypeScript (the dsl-campaign graph,
 *        the embeddings harness).
 *
 * Output goes to stdout or to a directory under `_private/` or outside the repo; the CLI refuses
 * any other path inside the repo, so GW prose never lands in a tracked file.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { assembleStoreSource } from "./store-source.js";
import { loadRepoProse, type ProseEntry, type RepoProse } from "./record-prose.js";
import { readJsonArray, REPO_ROOT } from "./repo-files.js";

export const DEFAULT_EXPORT_DIR = path.join(REPO_ROOT, "_private", "prose");

/** Throw unless `dir` is under the repo's `_private/` or outside the repo. */
export function assertPrivateOutDir(dir: string, repoRoot: string = REPO_ROOT): void {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(dir));
  const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (inside && rel.split(path.sep)[0] !== "_private") {
    throw new Error(`Refusing to write dump prose to ${dir}: inside the repo, prose may only go under _private/.`);
  }
}

/** Write the export: one entry array per faction plus an index, all store-shaped. */
export function exportProse(repo: RepoProse, outDir: string, factions: readonly string[] = repo.factions()): { factions: number; entries: number } {
  assertPrivateOutDir(outDir, repo.repoRoot);
  fs.mkdirSync(outDir, { recursive: true });
  const index = repo.index(factions);
  let entries = 0;
  for (const [faction, byId] of Object.entries(index)) {
    const list = Object.values(byId);
    entries += list.length;
    fs.writeFileSync(path.join(outDir, `${faction}.json`), `${JSON.stringify(list, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify({ schema_version: 1, source: "mfm-dump", factions: index }, null, 2)}\n`);
  return { factions: factions.length, entries };
}

/** Ability ids (per faction) whose assembled prose matches `pattern`. */
export function grepProse(repo: RepoProse, pattern: RegExp, factions: readonly string[] = repo.factions()): { faction: string; ability_id: string; line: string }[] {
  const hits: { faction: string; ability_id: string; line: string }[] = [];
  for (const faction of factions) {
    for (const entry of repo.faction(faction).values()) {
      const text = assembleStoreSource(entry as unknown as Record<string, unknown>)?.text ?? "";
      const line = text.split("\n").find((l) => pattern.test(l));
      if (line !== undefined) hits.push({ faction, ability_id: entry.ability_id, line });
    }
  }
  return hits;
}

function main(argv: string[]): number {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const positional = argv.filter((a, i) => !a.startsWith("--") && !["--faction", "--out", "--dump"].includes(argv[i - 1] ?? ""));
  const [command, ...rest] = positional;
  const repo = loadRepoProse({ dumpPath: flag("--dump") });
  const factions = flag("--faction") ? [flag("--faction")!] : undefined;
  switch (command) {
    case "get": {
      const [faction, id] = rest;
      if (!faction || !id) break;
      const record = readJsonArray<{ ability_id?: string }>(path.join(repo.repoRoot, "data", "enrichment", faction, "abilities.json")).find((r) => r.ability_id === id);
      if (!record) {
        console.error(`No ability ${faction}/${id} in data/enrichment.`);
        return 1;
      }
      const got = repo.forRecord(faction, record);
      if (got.status === "missing") {
        console.error(`The dump prints no prose for ${faction}/${id}.`);
        return 1;
      }
      if (got.status === "ambiguous") {
        console.log(`AMBIGUOUS: ${got.variants.length} different texts for ${faction}/${id}`);
        got.variants.forEach((v, i) => console.log(`--- variant ${i + 1} (${v.rows.map((r) => `${r.faction} ${r.owner.kind === "datasheet" ? r.owner.name : r.owner.kind} ${r.ref}`).join("; ")})\n${v.text ?? ""}`));
        return 2;
      }
      const entry: ProseEntry = got.entry;
      console.log(`${faction}/${id}  ${entry.source.ref}`);
      console.log(assembleStoreSource(entry as unknown as Record<string, unknown>)?.text ?? "");
      return 0;
    }
    case "grep": {
      const [pattern] = rest;
      if (!pattern) break;
      for (const h of grepProse(repo, new RegExp(pattern, "i"), factions)) console.log(`${h.faction}/${h.ability_id}\t${h.line}`);
      return 0;
    }
    case "export": {
      const out = path.resolve(flag("--out") ?? DEFAULT_EXPORT_DIR);
      const { factions: n, entries } = exportProse(repo, out, factions);
      console.log(`Exported ${entries} entries for ${n} factions → ${out}`);
      return 0;
    }
  }
  console.error("Usage: prose get <faction> <ability_id> | grep <regex> [--faction f] | export [--out dir] [--faction f]  [--dump path]");
  return 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
