/**
 * The export carries no rules text: every description is the describer's
 * render of a dataset ability, and (where the private MFM dump is present) no
 * description reproduces a whole rule text from it.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Dataset } from "../src/data/dataset.js";
import { buildExport } from "../src/bsdata-export/export.js";
import { walk, type BsNode } from "../src/bsdata-export/source.js";
import { DEFAULT_DUMP_PATH } from "../src/mfm/loader.js";

const dataset = Dataset.embedded();
let texts: { where: string; text: string }[];

beforeAll(() => {
  texts = [];
  for (const doc of buildExport({ version: "1.5.1", dataset })) {
    const kind = Object.keys(doc.document)[0];
    for (const { node, kind: nodeKind } of walk(Object.values(doc.document)[0] as BsNode, kind)) {
      if (nodeKind === "rule" && typeof node.description === "string") texts.push({ where: `${doc.file} rule ${node.name}`, text: node.description });
      if (nodeKind === "characteristic" && node.name === "Description") texts.push({ where: `${doc.file} ability ${node.typeId}`, text: String(node.$text ?? "") });
    }
  }
}, 120_000);

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9+"]+/g, " ")
    .trim();

describe("BSData export ability text", () => {
  it("takes every description from the describer", () => {
    const rendered = new Set<string>();
    for (const faction of dataset.factions.all) for (const ability of dataset.abilities.byFaction(faction.id)) rendered.add(ability.describe());
    for (const ability of dataset.abilities.all) rendered.add(ability.describe());
    expect(texts.length).toBeGreaterThan(4000);
    expect(texts.filter((t) => !rendered.has(t.text)).slice(0, 5)).toEqual([]);
  });

  it.skipIf(!existsSync(DEFAULT_DUMP_PATH))("reproduces no whole rule text from the MFM dump", () => {
    const rules = new Set<string>();
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        const normalized = normalize(value);
        if (normalized.split(" ").length >= 20) rules.add(normalized);
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(readFileSync(DEFAULT_DUMP_PATH, "utf8")));
    expect(rules.size).toBeGreaterThan(1000);
    expect(texts.filter((t) => rules.has(normalize(t.text))).map((t) => t.where).slice(0, 5)).toEqual([]);
  }, 300_000);
});
