import fc from "fast-check";
import { XMLParser } from "fast-xml-parser";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { loadBattleScribeSchema, projectElement, SCHEMA_PATH, type ProjectedElement } from "../src/bsdata-export/battlescribe-schema.js";
import { evaluatePoints, type EvalContext } from "../src/bsdata-export/evaluate.js";
import { buildExport, type ExportedDocument } from "../src/bsdata-export/export.js";
import { BSDATA_IDS } from "../src/bsdata-export/ids.js";
import type { FormatDescriptor } from "../src/bsdata-export/format.js";
import formatJson from "../src/bsdata-export/format.json" with { type: "json" };
import { children, CONTAINER_KIND, isNode, type BsNode } from "../src/bsdata-export/source.js";
import { toBattleScribeSchemaXml, toBattleScribeXml } from "../src/bsdata-export/xml.js";

const FORMAT = formatJson as unknown as FormatDescriptor;
const ELEMENT_STRINGS = new Set(["description", "readme", "comment"]);

/** Characters XML text and attributes must carry through escaping, including markup and quotes. */
const text = fc.string({ unit: fc.constantFrom("a", "Z", "0", " ", "&", "<", ">", '"', "'", "é", "’", "+", '"', "-"), maxLength: 12 });

function scalar(type: string): fc.Arbitrary<string | number | boolean> {
  const first = type.split("|")[0];
  if (first === "number") return fc.integer({ min: -5, max: 3000 });
  if (first === "boolean") return fc.boolean();
  return text;
}

/** Arbitrary BSData nodes of `kind`, drawn from the keys and types BSData uses for that kind. */
function nodeOf(kind: string, depth: number): fc.Arbitrary<BsNode> {
  const spec = FORMAT[kind];
  const fields: Record<string, fc.Arbitrary<unknown>> = {};
  for (const [key, type] of Object.entries(spec.types)) {
    if (key === "$text" || type === "array<string>") continue;
    if (type.startsWith("array<")) {
      const childKind = CONTAINER_KIND[key];
      if (!childKind || depth >= 2 || !FORMAT[childKind]) continue;
      fields[key] = fc.array(fc.constant(childKind).chain((k) => nodeOf(k, depth + 1)), { minLength: 1, maxLength: depth === 0 ? 2 : 1 });
    } else {
      fields[key] = scalar(type);
    }
  }
  const arrays = Object.keys(fields).filter((key) => spec.types[key].startsWith("array<"));
  const scalars = Object.fromEntries(Object.entries(fields).filter(([key]) => !arrays.includes(key)));
  const base = fc
    .tuple(fc.record(scalars, { requiredKeys: [] }), fc.subarray(arrays, { maxLength: Math.min(arrays.length, depth === 0 ? 3 : 2) }))
    .chain(([node, picked]) => fc.record(Object.fromEntries(picked.map((key) => [key, fields[key]]))).map((lists) => ({ ...node, ...lists })));
  return kind === "characteristic" ? fc.tuple(base, text).map(([node, t]) => ({ ...node, $text: t })) : base;
}

/** The parsed XML element back in JSON form, every scalar as a string. */
function fromXml(element: Record<string, unknown>, kind: string): BsNode {
  const out: BsNode = {};
  for (const [key, value] of Object.entries(element)) {
    const childKind = CONTAINER_KIND[key];
    if (childKind) {
      const wrapper = value as Record<string, unknown>;
      const item = Object.keys(wrapper).find((k) => k !== "#text")!;
      // An attribute-less element parses as its text: "" when empty.
      out[key] = (wrapper[item] as unknown[]).map((child) => fromXml(isNode(child) ? child : child === "" ? {} : { "#text": child }, childKind));
    } else if (key === "#text") {
      // Indentation between child elements is not content.
      const hasChildren = Object.keys(element).some((k) => CONTAINER_KIND[k] !== undefined || ELEMENT_STRINGS.has(k));
      if (!hasChildren) out.$text = String(value);
    } else {
      out[key] = String(value);
    }
  }
  if (kind === "characteristic" && out.$text === undefined) out.$text = "";
  return out;
}

function stringified(node: BsNode): BsNode {
  const out: BsNode = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = Array.isArray(value) ? value.map((v) => (isNode(v) ? stringified(v) : String(v))) : String(value);
  }
  return out;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (_name, jpath, _isLeaf, isAttribute) => {
    if (isAttribute) return false;
    const parts = String(jpath).split(".");
    return parts.length >= 2 && CONTAINER_KIND[parts[parts.length - 2]] !== undefined;
  },
});

describe("BattleScribe XML serialization", () => {
  it("round-trips any BSData-shaped catalogue through XML", () => {
    fc.assert(
      fc.property(nodeOf("catalogue", 0), (catalogue) => {
        const parsed = parser.parse(toBattleScribeXml({ catalogue } as never)) as { catalogue: Record<string, unknown> };
        expect(fromXml(parsed.catalogue, "catalogue")).toEqual(stringified(catalogue));
      }),
      { numRuns: 150 },
    );
  });

  it("writes description, readme and comment as child elements and scalars as attributes", () => {
    const xml = toBattleScribeXml({
      catalogue: { name: "A & B", id: "1-2-3-4", readme: "x < y", sharedRules: [{ name: "R", id: "5-6-7-8", description: "d", hidden: false }] },
    } as never);
    expect(xml).toContain('<catalogue name="A &amp; B" id="1-2-3-4">');
    expect(xml).toContain("<readme>x &lt; y</readme>");
    expect(xml).toMatch(/<rule name="R" id="5-6-7-8" hidden="false">\s*<description>d<\/description>\s*<\/rule>/);
    for (const key of ELEMENT_STRINGS) expect(xml).not.toContain(` ${key}="`);
  });

  it("orders child elements by the schema sequence regardless of JSON key order", () => {
    const xml = toBattleScribeXml({
      catalogue: {
        name: "C",
        id: "1-1-1-1",
        sharedSelectionEntries: [
          {
            name: "E",
            id: "2-2-2-2",
            import: true,
            type: "unit",
            costs: [{ name: "pts", typeId: "3-3-3-3", value: 5 }],
            categoryLinks: [{ name: "K", id: "4-4-4-4", targetId: "5-5-5-5" }],
            constraints: [{ id: "6-6-6-6", field: "selections", scope: "parent", shared: true, type: "max", value: 1 }],
            profiles: [{ name: "P", id: "7-7-7-7", hidden: false, typeId: "8-8-8-8", typeName: "Unit", characteristics: [{ name: "M", $text: '6"', typeId: "9-9-9-9" }] }],
          },
        ],
        categoryEntries: [{ name: "K", id: "5-5-5-5" }],
      },
    } as never);
    const order = ["<categoryEntries>", "<sharedSelectionEntries>", "<constraints>", "<profiles>", "<categoryLinks>", "<costs>"].map((tag) => xml.indexOf(tag));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(xml).toContain('<characteristic name="M" typeId="9-9-9-9">6"</characteristic>');
  });

  it("omits the constructs BattleScribe has no element for", () => {
    const xml = toBattleScribeXml(
      { catalogue: { name: "C", id: "1-1-1-1", sharedSelectionEntries: [{ name: "E", id: "2-2-2-2", import: true, type: "unit", associations: [{ name: "Leading", id: "3-3-3-3", childId: "unit", max: 1, min: 0, scope: "force" }] }] } } as never,
      { omitKeys: new Set(["associations"]) },
    );
    expect(xml).not.toContain("association");
  });
});

describe("BattleScribe 2.03 schema projection", () => {
  const schema = loadBattleScribeSchema();
  let documents: ExportedDocument[];
  beforeAll(() => {
    documents = buildExport({ version: "1.5.1", dataset: Dataset.embedded() });
  }, 120_000);

  const hasXmllint = spawnSync("xmllint", ["--version"]).status === 0;
  // CI must run the schema check; locally it needs libxml2's xmllint.
  it.skipIf(!hasXmllint && !process.env.CI)("writes every document valid against BattleScribe's schema", () => {
    expect(hasXmllint, "xmllint is required in CI").toBe(true);
    const dir = mkdtempSync(path.join(tmpdir(), "bsdata-xsd-"));
    try {
      const xsd = readFileSync(SCHEMA_PATH, "utf8");
      writeFileSync(path.join(dir, "catalogue.xsd"), xsd);
      writeFileSync(path.join(dir, "gamesystem.xsd"), xsd.replaceAll("http://www.battlescribe.net/schema/catalogueSchema", "http://www.battlescribe.net/schema/gameSystemSchema"));
      const failures: string[] = [];
      documents.forEach((doc, index) => {
        const root = Object.keys(doc.document)[0];
        const file = path.join(dir, `${index}.xml`);
        writeFileSync(file, toBattleScribeSchemaXml(doc.document, schema));
        const result = spawnSync("xmllint", ["--noout", "--schema", path.join(dir, root === "gameSystem" ? "gamesystem.xsd" : "catalogue.xsd"), file], { encoding: "utf8" });
        if (result.status !== 0) failures.push(`${doc.file}: ${result.stderr.split("\n").slice(0, 3).join(" | ")}`);
      });
      expect(failures).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it("prices every unit in BattleScribe at its first copy's points", () => {
    const pts = BSDATA_IDS.system.costTypes.pts;
    const units = documents.slice(1).flatMap((doc) =>
      children(Object.values(doc.document)[0] as BsNode, "sharedSelectionEntries").filter((e) => e.type === "unit" || e.type === "model"),
    );
    expect(units.length).toBeGreaterThan(900);
    fc.assert(
      fc.property(fc.constantFrom(...units), fc.integer({ min: 1, max: 20 }), (entry, models) => {
        const projected = toJson(projectElement(schema, "selectionEntry", "SelectionEntry", entry));
        const ctx: EvalContext = { modelCount: models, earlierCopies: 0, primaryCatalogueId: "", selected: new Set() };
        expect(evaluatePoints(projected, pts, { ...ctx, earlierCopies: 2 })).toBe(evaluatePoints(entry, pts, ctx));
      }),
      { numRuns: 1000 },
    );
  });

  it("drops only the NewRecruit-only constructs and rejects anything else outside the schema", () => {
    const entry: BsNode = {
      name: "E",
      id: "1-1-1-1",
      hidden: false,
      import: true,
      type: "unit",
      constraints: [
        { id: "2-2-2-2", type: "max", value: 1, field: "selections", scope: "parent", shared: true },
        { id: "3-3-3-3", type: "max", value: 1, field: "associations", scope: "self", shared: true, childId: "4-4-4-4", childName: "Leader" },
      ],
      modifiers: [
        { type: "set", field: "hidden", value: true, conditions: [{ type: "atLeast", value: 1, field: "selections", scope: "force", childId: "5-5-5-5", childName: "D", shared: true }] },
        { type: "set", field: "pts", value: 9, conditionGroups: [{ type: "and", localConditionGroups: [{ type: "atLeast", value: 1 }] }] },
      ],
      associations: [{ name: "Leading", id: "6-6-6-6" }],
    };
    const projected = toJson(projectElement(schema, "selectionEntry", "SelectionEntry", entry));
    expect(children(projected, "constraints").map((c) => c.id)).toEqual(["2-2-2-2"]);
    expect(children(projected, "modifiers")).toHaveLength(1);
    expect(children(children(projected, "modifiers")[0], "conditions")[0].childName).toBeUndefined();
    expect(projected.associations).toBeUndefined();
    expect(() => projectElement(schema, "selectionEntry", "SelectionEntry", { ...entry, invented: 1 })).toThrow(/does not allow "invented"/);
  });
});

/** A projected element back in BSData JSON form. */
function toJson(el: ProjectedElement): BsNode {
  const out: BsNode = Object.fromEntries(el.attributes);
  if (el.text !== undefined) out.$text = el.text;
  for (const child of el.children) out[child.name] = "value" in child ? child.value : child.items.map(toJson);
  return out;
}
