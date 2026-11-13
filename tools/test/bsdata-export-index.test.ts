/**
 * The hosted BattleScribe data repo: `index.bsi` names every data file by a
 * path that exists beside it, with the id, name and revision inside that file.
 */
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import fc from "fast-check";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { DATA_INDEX_XMLNS, hostedName } from "../src/bsdata-export/data-index.js";
import { buildExport, DATA_INDEX_NAME, writeExport } from "../src/bsdata-export/export.js";

const INDEX_URL = "https://example.invalid/data/index.bsi";
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bsdata-index-"));
  writeExport(buildExport({ version: "1.5.1", dataset: Dataset.embedded() }), dir, { indexUrl: INDEX_URL });
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", isArray: (name) => name === "dataIndexEntry" });

describe("BattleScribe hosted data repo", () => {
  it("indexes every data file at a path beside the index, with that file's id, name and revision", () => {
    const hosted = path.join(dir, "battlescribe");
    const index = unzipSync(readFileSync(path.join(hosted, "index.bsi")));
    expect(Object.keys(index)).toEqual(["index.xml"]);
    const parsed = parser.parse(strFromU8(index["index.xml"])) as {
      dataIndex: { name: string; indexUrl: string; xmlns: string; dataIndexEntries: { dataIndexEntry: Record<string, string>[] } };
    };
    expect(parsed.dataIndex).toMatchObject({ name: DATA_INDEX_NAME, indexUrl: INDEX_URL, xmlns: DATA_INDEX_XMLNS });
    const entries = parsed.dataIndex.dataIndexEntries.dataIndexEntry;
    const xmlFiles = readdirSync(path.join(dir, "xml"));
    expect(entries).toHaveLength(xmlFiles.length);
    expect(new Set(readdirSync(hosted))).toEqual(new Set(["index.bsi", ...entries.map((e) => e.filePath)]));
    for (const entry of entries) {
      const zipped = unzipSync(readFileSync(path.join(hosted, entry.filePath)));
      const [name] = Object.keys(zipped);
      expect(Object.keys(zipped)).toHaveLength(1);
      const xml = strFromU8(zipped[name]);
      expect(xml).toBe(readFileSync(path.join(dir, "xml", name), "utf8"));
      const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(xml) as Record<string, Record<string, string>>;
      const root = doc.gameSystem ?? doc.catalogue;
      expect({ file: name, id: entry.dataId, name: entry.dataName, revision: entry.dataRevision, type: entry.dataType }).toEqual({
        file: name,
        id: root.id,
        name: root.name,
        revision: root.revision,
        type: name.endsWith(".gst") ? "gamesystem" : "catalogue",
      });
    }
  });

  it("names hosted files with URL- and release-asset-safe characters only", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (name) => {
        expect(hostedName(name)).toMatch(/^[A-Za-z0-9._-]*$/);
        expect(hostedName(name)).not.toContain("--");
      }),
    );
  });
});
