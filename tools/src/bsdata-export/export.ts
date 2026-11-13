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
import { loadBattleScribeSchema } from "./battlescribe-schema.js";
import { hostedDataRepo, type IndexedFile } from "./data-index.js";
import { ROOT_EXTENSION, toBattleScribeSchemaXml } from "./xml.js";

/** The data repo's name in BattleScribe's data index. */
export const DATA_INDEX_NAME = "Warhammer 40,000 11th Edition (40kdc-data)";

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

/**
 * Writes under `outDir`: `json/<file>` (NewRecruit), `xml/<name>.gst|.cat`
 * (BattleScribe), and `battlescribe/` — the hosted data repo BattleScribe adds
 * by the URL of its `index.bsi` (see `data-index.ts`), served at `indexUrl`.
 */
export function writeExport(documents: readonly ExportedDocument[], outDir: string, options: { readonly indexUrl: string }): string[] {
  const written: string[] = [];
  const schema = loadBattleScribeSchema();
  for (const dir of ["json", "xml", "battlescribe"]) mkdirSync(path.join(outDir, dir), { recursive: true });
  const indexed: IndexedFile[] = [];
  for (const { file, document } of documents) {
    const jsonPath = path.join(outDir, "json", file);
    writeFileSync(jsonPath, bsdataJson(document));
    const root = Object.keys(document)[0];
    const node = document[root] as BsNode;
    const name = `${path.basename(file, ".json")}${ROOT_EXTENSION[root]}`;
    const xml = toBattleScribeSchemaXml(document, schema);
    const xmlPath = path.join(outDir, "xml", name);
    writeFileSync(xmlPath, xml);
    written.push(jsonPath, xmlPath);
    indexed.push({ name, kind: root === "gameSystem" ? "gamesystem" : "catalogue", id: String(node.id), dataName: String(node.name), revision: Number(node.revision), xml });
  }
  for (const [name, bytes] of hostedDataRepo(DATA_INDEX_NAME, options.indexUrl, indexed)) {
    const hostedPath = path.join(outDir, "battlescribe", name);
    writeFileSync(hostedPath, bytes);
    written.push(hostedPath);
  }
  return written;
}
