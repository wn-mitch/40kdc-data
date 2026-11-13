import fc from "fast-check";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import type { FormatDescriptor } from "../src/bsdata-export/format.js";
import formatJson from "../src/bsdata-export/format.json" with { type: "json" };
import { CONTAINER_KIND, isNode, type BsNode } from "../src/bsdata-export/source.js";
import { toBattleScribeXml } from "../src/bsdata-export/xml.js";

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
      // An attribute-less empty element parses as "".
      out[key] = (wrapper[item] as unknown[]).map((child) => fromXml(isNode(child) ? child : {}, childKind));
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
