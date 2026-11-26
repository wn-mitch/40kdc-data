/**
 * Points-value audit: what each datasheet's stats, weapons and abilities are worth in points, and
 * which units GW prices above or below that.
 *
 * Measuring a faction runs the damage hill climb for every unit against every reference target
 * (about a minute a faction), so measurements are cached in `_private/points-value/features.json`,
 * keyed by a fingerprint of the data bundle and the measuring code, and factions run in parallel
 * child processes. The fit and report rerun from the cache in seconds.
 *
 * Usage (from tools/):
 *   npm run audit:points-value                      # measure what's missing, write data/_audit/points-value.{md,json}
 *   npm run audit:points-value -- --refresh         # re-measure every faction
 *   npm run audit:points-value -- --workers 6       # parallel factions (default: CPUs − 2)
 *   npm run audit:points-value -- --price my-unit.json   # price a custom datasheet against the fit
 *
 * A custom datasheet file is `{ "unit": <Unit record>, "weapons": [<Weapon records>] }`. The unit
 * names its `faction_id`, and may list any of that faction's (or core) ability ids and existing
 * weapon ids; new weapons go in `weapons`. Without `points` it is priced but not judged.
 */
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset } from "./data/dataset.js";
import { RAW_DATA } from "./data/bundle.generated.js";
import type { Unit, Weapon } from "./generated.js";
import { DEFAULT_TARGET_IDS, datasheetConfig, factionFeatures, pricedUnits, type UnitFeatures } from "./points-value/features.js";
import { chooseBestLoadouts, loadoutCandidates, type CandidateSet } from "./points-value/best-loadouts.js";
import { resolveFactionContext } from "./stack-damage/factions.js";
import { buildReport, nearestUnits, priceUnit, renderMarkdown, type PointsValueReport } from "./points-value/report.js";
import { DURABILITY_TWEAKS, WEAPON_TWEAKS } from "./points-value/marginal.js";
import { chooseAura } from "./points-value/fit.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SRC, "../..");
const CACHE = join(ROOT, "_private/points-value/features.json");
const OUT_DIR = join(ROOT, "data/_audit");
/** The best default loadouts List Builder and Salvo start a unit with. */
const BEST_LOADOUTS = join(ROOT, "examples/_shared/best-loadouts.json");
/** What a measurement depends on: the data bundle and the engine, scoring and measuring code. */
const FINGERPRINTED = ["cruncher", "stack-damage", "abilities-resolver", "data", "points-value/features.ts", "points-value/marginal.ts", "points-value/best-loadouts.ts"];

interface Cache {
  fingerprint: string;
  targetIds: string[];
  factions: Record<string, Measured>;
}

interface Measured {
  units: UnitFeatures[];
  loadouts: CandidateSet;
}

function fingerprint(): string {
  const hash = createHash("sha256");
  const walk = (path: string): string[] => statSync(path).isDirectory()
    ? readdirSync(path).sort().flatMap((entry) => walk(join(path, entry)))
    : [path];
  for (const file of FINGERPRINTED.flatMap((entry) => walk(join(SRC, entry))).filter((file) => !file.endsWith(".test.ts"))) {
    hash.update(relative(SRC, file));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

function readCache(print: string): Cache {
  if (existsSync(CACHE)) {
    const cache = JSON.parse(readFileSync(CACHE, "utf8")) as Cache;
    if (cache.fingerprint === print && cache.targetIds.join() === DEFAULT_TARGET_IDS.join()) return cache;
    console.log("[cache] data or measuring code changed; re-measuring every faction");
  }
  return { fingerprint: print, targetIds: [...DEFAULT_TARGET_IDS], factions: {} };
}

function writeCache(cache: Cache): void {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

/** Measures each of `factionIds` in a child process, at most `workers` at once, recording each as it lands. */
async function measure(factionIds: readonly string[], workers: number, record: (factionId: string, measured: Measured) => void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "points-value-"));
  let next = 0;
  const one = (factionId: string) => new Promise<void>((resolveRun, reject) => {
    const output = join(dir, `${factionId}.json`);
    const started = Date.now();
    const child = fork(process.argv[1], ["--child", factionId, output], { execArgv: process.execArgv, stdio: ["ignore", "ignore", "inherit", "ipc"] });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`measuring ${factionId} exited with code ${code}`));
      record(factionId, JSON.parse(readFileSync(output, "utf8")) as Measured);
      console.log(`[measured] ${factionId} in ${Math.round((Date.now() - started) / 1000)}s`);
      resolveRun();
    });
  });
  try {
    await Promise.all(Array.from({ length: Math.min(workers, factionIds.length) }, async () => {
      while (next < factionIds.length) await one(factionIds[next++]);
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function priceCustom(path: string, units: UnitFeatures[], report: PointsValueReport): void {
  const file = JSON.parse(readFileSync(resolve(ROOT, path), "utf8")) as { unit: Unit; weapons?: Weapon[] };
  const unit = { ...file.unit, game_version: file.unit.game_version ?? { edition: "11th", dataslate: "custom" } } as Unit;
  const weapons = (file.weapons ?? []).map((weapon) => ({ faction_id: unit.faction_id, ...weapon, game_version: weapon.game_version ?? unit.game_version }) as Weapon);
  const ds = new Dataset({ ...RAW_DATA, units: [...RAW_DATA.units, unit], weapons: [...RAW_DATA.weapons, ...weapons] });
  const [features] = factionFeatures(ds, unit.faction_id, { targetIds: DEFAULT_TARGET_IDS, unitIds: [unit.id] });
  const titanic = new Set(units.filter((unit) => unit.keywords.includes("Titanic")).map((unit) => unit.unitId));
  const priced = priceUnit(report.model, features, undefined, chooseAura(report.model, features, titanic));
  const band = report.crossValidation.mae;
  const lines = [
    `${features.unitName} (${features.modelCount} models${features.attachedTo ? `, attached to ${features.attachedTo}` : ""})`,
    `  Fair price: ${Math.round(priced.predicted)} pts (typical error ±${Math.round(band)})${features.points !== null ? `; you priced it at ${features.points}` : ""}`,
    `  Stat line, weapons and chassis: ${Math.round(priced.statPrice)} pts`,
    `  Abilities add: ${Math.round(priced.abilities.total)} (offense ${Math.round(priced.abilities.offense)}, durability ${Math.round(priced.abilities.durability)}, auras ${Math.round(priced.abilities.aura)}${priced.auraNeighbour ? ` on ${priced.auraNeighbour}` : ""}, utility ${Math.round(priced.abilities.utility)}, resources ${Math.round(priced.abilities.resources)})`,
    `  What one more of each would cost:`,
    ...[...DURABILITY_TWEAKS, ...WEAPON_TWEAKS].filter((tweak) => tweak.id in priced.tweaks).map((tweak) => `    ${tweak.label}: ${Math.round(priced.tweaks[tweak.id])} pts`),
    ...Object.keys(priced.tweaks).filter((id) => id.startsWith("drop:")).map((id) => `    Its ${id.slice(5)} is worth: ${Math.round(-priced.tweaks[id])} pts`),
    `  Nearest real datasheets:`,
    ...nearestUnits(units, features).map((near) => `    ${near.unitName} (${near.factionId}): ${near.points} pts`),
  ];
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const ds = Dataset.embedded();
  if (process.argv[2] === "--child") {
    const [, , , factionId, output] = process.argv;
    const measured: Measured = {
      units: factionFeatures(ds, factionId, { targetIds: DEFAULT_TARGET_IDS }),
      loadouts: loadoutCandidates(ds, factionId, DEFAULT_TARGET_IDS, datasheetConfig(ds, factionId)),
    };
    writeFileSync(output, JSON.stringify(measured));
    return;
  }
  const print = fingerprint();
  const cache = process.argv.includes("--refresh") ? { fingerprint: print, targetIds: [...DEFAULT_TARGET_IDS], factions: {} } : readCache(print);
  const wanted = (arg("--factions")?.split(",") ?? ds.factions.all.map((faction) => faction.id))
    .filter((id) => pricedUnits(ds, resolveFactionContext(ds, id)).length > 0);
  const missing = wanted.filter((id) => !cache.factions[id]);
  const workers = Number(arg("--workers") ?? Math.max(1, cpus().length - 2));
  if (missing.length > 0) {
    console.log(`[measure] ${missing.length} factions with ${workers} workers`);
    await measure(missing, workers, (factionId, measured) => {
      cache.factions[factionId] = measured;
      writeCache(cache);
    });
  }
  const units = wanted.flatMap((id) => cache.factions[id].units);
  const report = buildReport(units);
  const price = arg("--price");
  if (price) return priceCustom(price, units, report);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "points-value.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, "points-value.md"), renderMarkdown(report));
  const best = chooseBestLoadouts(report.model, Object.fromEntries(wanted.map((id) => [id, cache.factions[id].loadouts])));
  writeFileSync(BEST_LOADOUTS, `${JSON.stringify({
    $comment: "Generated by npm run audit:points-value. Per faction, unit and squad size, the legal loadout worth the most points under the audit's price list, where it beats the out-of-the-box one.",
    loadouts: best,
  }, null, 2)}\n`);
  const sizes = Object.values(best).reduce((sum, units) => sum + Object.values(units).reduce((n, bySize) => n + Object.keys(bySize).length, 0), 0);
  const cv = report.crossValidation;
  console.log(`[fit] ${report.units} units, held-out MAE ${cv.mae.toFixed(1)} pts, R² ${cv.r2.toFixed(2)}`);
  console.log(`[write] data/_audit/points-value.md, data/_audit/points-value.json, examples/_shared/best-loadouts.json (${sizes} unit sizes)`);
}

await main();
