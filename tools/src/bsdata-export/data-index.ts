/**
 * BattleScribe's hosted data repo: an `index.bsi` (a zip holding `index.xml`,
 * the data index) beside one zipped data file per game system and catalogue
 * (`.gstz`, `.catz`). BattleScribe reads the index from its URL and fetches
 * each file at its `filePath`, relative to the index; on update it re-reads the
 * index at `indexUrl` and fetches files whose revision rose.
 *
 * File names are made URL- and release-asset-safe (GitHub renames spaces and
 * drops some characters in asset names); the zipped entry keeps the BSData
 * file name.
 */
import { strToU8, zipSync } from "fflate";
import { BATTLESCRIBE_VERSION } from "./nodes.js";

export const DATA_INDEX_XMLNS = "http://www.battlescribe.net/schema/dataIndexSchema";

export interface IndexedFile {
  /** The data file's own name, e.g. `Necrons.cat`. */
  readonly name: string;
  readonly kind: "gamesystem" | "catalogue";
  readonly id: string;
  readonly dataName: string;
  readonly revision: number;
  readonly xml: string;
}

/** A file name safe as a URL path segment and a GitHub release asset name. */
export function hostedName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The zipped file name BattleScribe fetches for `file`. */
export function zippedName(file: IndexedFile): string {
  return `${hostedName(file.name)}z`;
}

export function dataIndexXml(name: string, indexUrl: string, files: readonly IndexedFile[]): string {
  const entries = files.map(
    (f) =>
      `    <dataIndexEntry filePath="${escapeAttr(zippedName(f))}" dataType="${f.kind}" dataId="${escapeAttr(f.id)}" dataName="${escapeAttr(f.dataName)}" dataBattleScribeVersion="${BATTLESCRIBE_VERSION}" dataRevision="${f.revision}"/>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<dataIndex battleScribeVersion="${BATTLESCRIBE_VERSION}" name="${escapeAttr(name)}" indexUrl="${escapeAttr(indexUrl)}" xmlns="${DATA_INDEX_XMLNS}">`,
    "  <dataIndexEntries>",
    ...entries,
    "  </dataIndexEntries>",
    "</dataIndex>",
    "",
  ].join("\n");
}

/** Every hosted file (`index.bsi` and the zipped data files) by name. Zip timestamps are fixed so builds are reproducible. */
export function hostedDataRepo(name: string, indexUrl: string, files: readonly IndexedFile[]): Map<string, Uint8Array> {
  const mtime = new Date("2000-01-01T00:00:00Z");
  const out = new Map<string, Uint8Array>();
  out.set("index.bsi", zipSync({ "index.xml": [strToU8(dataIndexXml(name, indexUrl, files)), { mtime }] }));
  for (const f of files) out.set(zippedName(f), zipSync({ [f.name]: [strToU8(f.xml), { mtime }] }));
  return out;
}
