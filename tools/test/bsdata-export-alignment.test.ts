/**
 * Alignment between the export and the BSData wh40k-11e checkout it replaces.
 * Runs only where `_private/bsdata-wh40k-11e` exists (it is not distributed).
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { evaluatePoints, UnsupportedLogic, type EvalContext } from "../src/bsdata-export/evaluate.js";
import { buildExport } from "../src/bsdata-export/export.js";
import { extractIds, FORMAT_PATH, IDS_PATH, matchKey } from "../src/bsdata-export/extract-ids.js";
import { deriveFormat } from "../src/bsdata-export/format.js";
import { BSDATA_IDS } from "../src/bsdata-export/ids.js";
import { stableJson } from "../src/bsdata-export/json.js";
import { children, loadBsdataDir, str, walk, type BsDocument, type BsNode } from "../src/bsdata-export/source.js";

const CHECKOUT = path.resolve(__dirname, "..", "..", "_private", "bsdata-wh40k-11e");
const dataset = Dataset.embedded();

/** A characteristic text's shape: digits become 9, dice expressions D, so `12"` and `24"` agree. */
function textShape(text: string): string {
  return text
    .trim()
    .replace(/\d+(\.\d+)?/g, "9")
    .replace(/9?D9(\+9)?/g, "D");
}

interface Indexed {
  readonly kind: string;
  readonly node: BsNode;
}

function indexById(roots: readonly { kind: string; root: BsNode }[]): Map<string, Indexed[]> {
  const out = new Map<string, Indexed[]>();
  for (const { kind, root } of roots) {
    for (const visit of walk(root, kind)) {
      const id = str(visit.node, "id");
      if (!id) continue;
      out.set(id, [...(out.get(id) ?? []), { kind: visit.kind, node: visit.node }]);
    }
  }
  return out;
}

const DEFINITION_KINDS = new Set(["selectionEntry", "categoryEntry", "costType", "profileType", "characteristicType", "forceEntry", "catalogue", "gameSystem"]);

describe.skipIf(!existsSync(CHECKOUT))("BSData export alignment with the wh40k-11e checkout", () => {
  let bsdata: BsDocument[];
  let ours: { kind: string; root: BsNode }[];
  let bsdataById: Map<string, Indexed[]>;
  let shapes: Map<string, Set<string>>;

  beforeAll(() => {
    bsdata = loadBsdataDir(CHECKOUT);
    ours = buildExport({ version: "1.5.1", dataset }).map((d) => ({ kind: Object.keys(d.document)[0], root: Object.values(d.document)[0] as BsNode }));
    bsdataById = indexById(bsdata.map((d) => ({ kind: d.kind, root: d.root })));
    shapes = new Map();
    for (const doc of bsdata) {
      for (const { node, kind } of walk(doc.root, doc.kind)) {
        if (kind !== "characteristic") continue;
        const name = String(node.name);
        const set = shapes.get(name) ?? new Set<string>();
        set.add(textShape(String(node.$text ?? "")));
        shapes.set(name, set);
      }
    }
  }, 300_000);

  it("keeps the committed id map and format descriptor current with the checkout", () => {
    expect(readFileSync(FORMAT_PATH, "utf8")).toBe(stableJson(deriveFormat(bsdata.map((d) => [d.kind, d.root] as const))));
    expect(readFileSync(IDS_PATH, "utf8")).toBe(stableJson(extractIds(bsdata, dataset)));
  });

  it("writes every characteristic in a text shape BSData uses for it", () => {
    const characteristics = ours.flatMap(({ kind, root }) => [...walk(root, kind)].filter((v) => v.kind === "characteristic").map((v) => v.node));
    fc.assert(
      fc.property(fc.constantFrom(...characteristics), (c) => {
        const name = String(c.name);
        // Keywords and ability descriptions are free text.
        fc.pre(name !== "Keywords" && name !== "Description");
        expect({ name, text: c.$text, known: shapes.get(name)?.has(textShape(String(c.$text ?? ""))) }).toEqual({ name, text: c.$text, known: true });
      }),
      { numRuns: 3000 },
    );
  });

  it("reuses a BSData id only for the same kind of definition with the same name", () => {
    const reused = ours
      .flatMap(({ kind, root }) => [...walk(root, kind)])
      .filter((v) => DEFINITION_KINDS.has(v.kind) && bsdataById.has(str(v.node, "id")!));
    expect(reused.length).toBeGreaterThan(4000);
    fc.assert(
      fc.property(fc.constantFrom(...reused), ({ node, kind }) => {
        const theirs = bsdataById.get(str(node, "id")!)!.filter((t) => DEFINITION_KINDS.has(t.kind));
        const names = theirs.map((t) => matchKey(String(t.node.name)));
        expect({ id: node.id, kind, name: matchKey(String(node.name)) }).toEqual({
          id: node.id,
          kind: theirs.find((t) => t.kind === kind)?.kind ?? theirs[0]?.kind,
          name: names.find((n) => n === matchKey(String(node.name))) ?? names[0],
        });
      }),
      { numRuns: 3000 },
    );
  });

  it("gives Unit and weapon profiles BSData's characteristic schema", () => {
    const types = new Map(
      children(bsdata.find((d) => d.kind === "gameSystem")!.root, "profileTypes").map((t) => [
        str(t, "id")!,
        children(t, "characteristicTypes").map((c) => `${c.name}:${c.id}`),
      ]),
    );
    for (const { kind, root } of ours) {
      for (const { node, kind: nodeKind } of walk(root, kind)) {
        if (nodeKind !== "profile") continue;
        const expected = types.get(str(node, "typeId")!);
        expect(expected, `${node.name} ${node.typeName}`).toBeDefined();
        const actual = children(node, "characteristics").map((c) => `${c.name}:${c.typeId}`);
        // Weapon profiles carry the skill column for their kind only, as BSData's do.
        expect(actual).toEqual(expected!.filter((col) => actual.includes(col)));
        expect(actual.length).toBe(expected!.length);
      }
    }
  });

  it("prices at least 95% of matched units as BSData does at their smallest size", () => {
    const oursById = indexById(ours);
    let compared = 0;
    let agreed = 0;
    for (const [factionId, units] of Object.entries(BSDATA_IDS.units)) {
      for (const [unitId, bsId] of Object.entries(units)) {
        const mine = oursById.get(bsId)?.find((e) => e.kind === "selectionEntry")?.node;
        const theirs = bsdataById.get(bsId)?.find((e) => e.kind === "selectionEntry")?.node;
        const unit = dataset.units.byFaction(factionId).find((u) => u.id === unitId);
        if (!mine || !theirs || !unit) continue;
        const ctx: EvalContext = {
          modelCount: unit.raw.model_count?.min ?? 1,
          earlierCopies: 0,
          primaryCatalogueId: "",
          selected: new Set(),
          modelScopes: new Set(children(theirs, "selectionEntryGroups").map((g) => str(g, "id")!)),
        };
        try {
          const pts = BSDATA_IDS.system.costTypes.pts;
          compared += 1;
          if (evaluatePoints(mine, pts, ctx) === evaluatePoints(theirs, pts, ctx)) agreed += 1;
        } catch (error) {
          if (!(error instanceof UnsupportedLogic)) throw error;
          compared -= 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(900);
    expect(agreed / compared).toBeGreaterThanOrEqual(0.95);
  });
});
