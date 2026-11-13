/**
 * BattleScribe roster files (`.ros` XML, `.rosz` zipped XML) imported through the
 * NewRecruit JSON adapter. NewRecruit's JSON export is the BattleScribe roster
 * tree with each plural container element (`selections`, `categories`, `costs`,
 * `forces`) as an array of its children and attributes as properties, so a
 * `.ros` document lowers to that shape and imports the same way.
 */
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { Dataset } from "../data/dataset.js";
import { newRecruitJsonAdapter } from "./newrecruit-json.js";
import { resolve } from "./resolve.js";
import type { ImportOptions, ImportResult } from "./import-roster.js";

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

/** Attributes the adapter reads as numbers. */
const NUMERIC_ATTRIBUTES = new Set(["number", "value"]);

function tagOf(node: XmlNode): string | undefined {
  return Object.keys(node).find((k) => k !== ":@" && k !== "#text");
}

/** True when `tag` is the plural of `child` (`selections`/`selection`, `categories`/`category`). */
function isContainerOf(tag: string, child: string): boolean {
  return tag === `${child}s` || (tag.endsWith("ies") && child.endsWith("y") && tag.slice(0, -3) === child.slice(0, -1));
}

function lower(node: XmlNode): unknown {
  const tag = tagOf(node)!;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((node[":@"] as Record<string, string> | undefined) ?? {})) {
    out[k] = NUMERIC_ATTRIBUTES.has(k) && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
  }
  const children = (node[tag] as XmlNode[]) ?? [];
  const text = children.filter((c) => "#text" in c).map((c) => String(c["#text"])).join("");
  if (text !== "") out.$text = text;
  for (const child of children) {
    const childTag = tagOf(child);
    if (childTag === undefined) continue;
    const grand = ((child[childTag] as XmlNode[]) ?? []).filter((g) => tagOf(g) !== undefined);
    if (grand.length > 0 && grand.every((g) => isContainerOf(childTag, tagOf(g)!))) out[childTag] = grand.map(lower);
    // An empty plural element (`<selections/>`) is an empty container.
    else if (grand.length === 0 && child[":@"] === undefined && childTag.endsWith("s") && ((child[childTag] as XmlNode[]) ?? []).length === 0) out[childTag] = [];
    else out[childTag] = lower(child);
  }
  return out;
}

/** A `.ros` document as the NewRecruit JSON roster tree (`{roster: {...}}`); throws when it has no `<roster>` root. */
export function rosToJson(xml: string): { roster: XmlNode } {
  const root = (parser.parse(xml) as XmlNode[]).find((n) => tagOf(n) === "roster");
  if (!root) throw new Error("battlescribe: document has no <roster> element");
  return { roster: lower(root) as XmlNode };
}

/** The `.ros` text inside a `.rosz` archive; throws when the archive holds none. */
export function unzipRosz(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const name = Object.keys(entries).find((n) => n.toLowerCase().endsWith(".ros")) ?? Object.keys(entries)[0];
  if (name === undefined) throw new Error("battlescribe: .rosz archive is empty");
  return new TextDecoder().decode(entries[name]);
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** True when `bytes` start with a zip header (a `.rosz`). */
export function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Import a BattleScribe roster: `.ros` XML text, or the bytes of a `.ros` or
 * `.rosz` file. The result reports the `newrecruit-json` format, whose adapter
 * reads the tree.
 */
export function importBattleScribe(input: string | Uint8Array, opts: ImportOptions = {}): ImportResult {
  let json: unknown;
  try {
    const xml = typeof input === "string" ? input : isZip(input) ? unzipRosz(input) : new TextDecoder().decode(input);
    json = rosToJson(xml);
  } catch (err) {
    return { ok: false, reason: "decode-failed", message: (err as Error).message, trials: [] };
  }
  if (!newRecruitJsonAdapter.matches(json)) {
    return { ok: false, reason: "no-adapter-matched", message: "battlescribe: roster has no forces or no rosterSchema namespace", trials: [{ id: "newrecruit-json", matched: false }] };
  }
  try {
    const roster = resolve(newRecruitJsonAdapter.parse(json), opts.dataset ?? Dataset.embedded(), "newrecruit-json");
    return { ok: true, roster, format: "newrecruit-json" };
  } catch (err) {
    const message = (err as Error).message;
    return { ok: false, reason: "parse-failed", message, trials: [{ id: "newrecruit-json", matched: true, reason: message }] };
  }
}
