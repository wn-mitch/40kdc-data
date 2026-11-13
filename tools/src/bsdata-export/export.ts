/**
 * Builds the whole BSData-compatible data repo from the dataset: one game
 * system plus one catalogue per faction, as JSON documents named like the
 * BSData wh40k-11e files they replace, and writes them as JSON (NewRecruit)
 * and BattleScribe XML (`.gst`/`.cat`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { Dataset } from "../data/dataset.js";
import { buildCatalogues } from "./catalogue.js";
import { IdAllocator } from "./ids.js";
import { bsdataJson } from "./json.js";
import type { BsNode } from "./source.js";
import { FACTION_CATALOGUE_FILES, GAME_SYSTEM_FILE } from "./source.js";
import { buildGameSystem, systemRefs } from "./system.js";
import { ROOT_EXTENSION, toBattleScribeXml } from "./xml.js";

/** NewRecruit-only constructs BattleScribe 2.03's schema has no element for. */
export const BATTLESCRIBE_OMIT = new Set(["associations", "localConditionGroups"]);

export interface ExportedDocument {
  /** BSData file name, e.g. `Necrons.json`. */
  readonly file: string;
  readonly document: BsNode;
}

/** `1.5.1` → 10501: a revision that rises with every package release. */
export function revisionFor(version: string): number {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`bsdata export: version ${version} is not semver`);
  const [, major, minor, patch] = match.map(Number);
  if (minor > 99 || patch > 99) throw new Error(`bsdata export: version ${version} does not fit the revision scheme`);
  return major * 10000 + minor * 100 + patch;
}

export function buildExport(options: { readonly version: string; readonly dataset?: Dataset }): ExportedDocument[] {
  const dataset = options.dataset ?? Dataset.embedded();
  const ids = new IdAllocator();
  const revision = revisionFor(options.version);
  const factions = Object.keys(FACTION_CATALOGUE_FILES).filter((f) => dataset.factions.get(f));
  const refs = systemRefs({ ids, dataset });
  const legends = factions.some((f) => dataset.units.byFaction(f).some((u) => u.raw.is_legend === true));
  const readme = `Generated from @alpaca-software/40kdc-data ${options.version}. Stat lines and points are numerical facts; ability descriptions are 40kdc's own plain-English summaries, not rules text.`;
  // Catalogues first: they claim the BSData ids for units and categories the system file links to.
  const catalogues = buildCatalogues({ ids, dataset, refs, revision, factions });
  const system = buildGameSystem({ ids, dataset, revision, readme, legends }, refs);
  return [{ file: GAME_SYSTEM_FILE, document: system }, ...catalogues.map((c) => ({ file: c.file, document: c.document }))];
}

/** Writes `json/<file>` and `xml/<name>.gst|.cat` for every document under `outDir`. */
export function writeExport(documents: readonly ExportedDocument[], outDir: string): string[] {
  const written: string[] = [];
  mkdirSync(path.join(outDir, "json"), { recursive: true });
  mkdirSync(path.join(outDir, "xml"), { recursive: true });
  for (const { file, document } of documents) {
    const jsonPath = path.join(outDir, "json", file);
    writeFileSync(jsonPath, bsdataJson(document));
    const root = Object.keys(document)[0];
    const xmlPath = path.join(outDir, "xml", `${path.basename(file, ".json")}${ROOT_EXTENSION[root]}`);
    writeFileSync(xmlPath, toBattleScribeXml(document as never, { omitKeys: BATTLESCRIBE_OMIT }));
    written.push(jsonPath, xmlPath);
  }
  return written;
}
