/**
 * Library catalogues (`libraries.ts`): the export's catalogue links never form a
 * cycle, which NewRecruit refuses to load.
 */
import { describe, expect, it } from "vitest";
import { buildExport } from "../src/bsdata-export/export.js";
import { IdAllocator } from "../src/bsdata-export/ids.js";
import { cyclicCatalogues, splitCyclicCatalogues, type CatalogueDocument } from "../src/bsdata-export/libraries.js";
import { children, str, type BsNode } from "../src/bsdata-export/source.js";
import { dataset } from "./bsdata-export-fixture.js";

const cat = (id: string, links: [string, boolean][], extra: BsNode = {}): CatalogueDocument => ({
  file: `${id}.json`,
  document: {
    catalogue: {
      id,
      name: id,
      library: false,
      catalogueLinks: links.map(([targetId, importRootEntries], i) => ({ id: `${id}-l${i}`, name: targetId, targetId, importRootEntries, type: "catalogue" })),
      entryLinks: [{ id: `${id}-root`, targetId: `${id}-unit` }],
      categoryEntries: [{ id: `${id}-cat`, name: "Keyword" }],
      sharedSelectionEntries: [{ id: `${id}-unit`, name: "Unit", type: "unit" }],
      ...extra,
    },
  },
});
const rootOf = (doc: CatalogueDocument): BsNode => (doc.document as { catalogue: BsNode }).catalogue;
const targets = (docs: CatalogueDocument[], file: string): string[] => children(rootOf(docs.find((d) => d.file === file)!), "catalogueLinks").map((l) => str(l, "targetId")!);

describe("library catalogues", () => {
  it("splits two armies that ally each other, and keeps a chapter importing one of them", () => {
    // A and B take each other's units; C imports A's root entries; D only takes A's units.
    const docs = [cat("a", [["b", false]]), cat("b", [["a", false]]), cat("c", [["a", true]]), cat("d", [["a", false]])];
    expect([...cyclicCatalogues(docs)].sort()).toEqual(["a", "b"]);
    const out = splitCyclicCatalogues(docs, new IdAllocator());
    expect(cyclicCatalogues(out).size).toBe(0);
    const libA = rootOf(out.find((d) => d.file === "a Library.json")!);
    const libB = rootOf(out.find((d) => d.file === "b Library.json")!);
    expect([libA.library, libB.library]).toEqual([true, true]);
    // The library holds what other catalogues reference; the army keeps its root links.
    expect(children(libA, "sharedSelectionEntries").map((e) => e.id)).toEqual(["a-unit"]);
    expect(children(libA, "categoryEntries").map((e) => e.id)).toEqual(["a-cat"]);
    const armyA = rootOf(out.find((d) => d.file === "a.json")!);
    expect(children(armyA, "sharedSelectionEntries")).toEqual([]);
    expect(children(armyA, "entryLinks").map((e) => e.id)).toEqual(["a-root"]);
    expect(targets(out, "a.json")).toEqual([str(libA, "id"), str(libB, "id")]);
    expect(targets(out, "b.json")).toEqual([str(libB, "id"), str(libA, "id")]);
    expect(targets(out, "c.json")).toEqual(["a", str(libA, "id")]);
    expect(targets(out, "d.json")).toEqual([str(libA, "id")]);
    expect(children(libA, "catalogueLinks")).toEqual([]);
  });

  it("leaves an acyclic set untouched", () => {
    const docs = [cat("a", [["b", false]]), cat("b", [])];
    expect(splitCyclicCatalogues(docs, new IdAllocator())).toEqual(docs);
  });

  it("exports a catalogue link graph without cycles", () => {
    const documents = buildExport({ version: "1.5.1", dataset });
    expect(cyclicCatalogues(documents.slice(1)).size).toBe(0);
    // Without the split the allied armies would cycle.
    expect(documents.slice(1).some((d) => rootOf(d).library === true)).toBe(true);
  }, 120_000);

  it("puts both Titan Legions in BSData's one Titans library, linked once from each catalogue", () => {
    const documents = buildExport({ version: "1.5.1", dataset });
    const titans = rootOf(documents.find((d) => d.file === "Library - Titans.json")!);
    expect(str(titans, "id")).toBe("7481-280e-b55e-7867");
    const names = new Set(children(titans, "sharedSelectionEntries").map((e) => String(e.name)));
    for (const faction of ["adeptus-titanicus", "titanicus-traitoris"]) {
      for (const unit of dataset.units.byFaction(faction)) expect(names.has(unit.name), `${faction} ${unit.id}`).toBe(true);
    }
    for (const doc of documents.slice(1)) {
      const toTitans = children(rootOf(doc), "catalogueLinks").filter((l) => str(l, "targetId") === str(titans, "id") && l.importRootEntries !== true);
      expect(toTitans.length, doc.file).toBeLessThanOrEqual(1);
    }
    expect(documents.some((d) => /Titanicus.* Library\.json$/.test(d.file))).toBe(false);
  }, 120_000);

  it("writes BSData's libraries the export has no content for, empty and linked from the armies BSData links them from", () => {
    const documents = buildExport({ version: "1.5.1", dataset });
    const shells = { "Aeldari - Aeldari Library": "Aeldari - Craftworlds", "Library - Tyranids": "Tyranids", "Unaligned Forces": "Necrons" };
    for (const [name, linker] of Object.entries(shells)) {
      const shell = rootOf(documents.find((d) => d.file === `${name}.json`)!);
      expect(shell.library, name).toBe(true);
      expect(["sharedSelectionEntries", "entryLinks", "categoryEntries", "sharedRules"].some((k) => children(shell, k).length > 0), name).toBe(false);
      expect(targets(documents.slice(1) as CatalogueDocument[], `${linker}.json`), `${linker} -> ${name}`).toContain(str(shell, "id"));
    }
  }, 120_000);
});
