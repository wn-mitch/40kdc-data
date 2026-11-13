/**
 * Serializes a BSData JSON document (`{gameSystem: {...}}` or `{catalogue: {...}}`)
 * to BattleScribe XML.
 *
 * The JSON form mirrors the XML one to one: an object is an element, a scalar
 * property is an attribute, an array property is a wrapper element holding one
 * child element per item, and `$text` is the element's text. `description`,
 * `readme` and `comment` are string properties in JSON but child elements in
 * XML. Keys in `omitKeys` (constructs BattleScribe's schema lacks) are dropped
 * with everything beneath them.
 */

/** Child element name for each array wrapper. */
const ITEM_ELEMENT: Readonly<Record<string, string>> = {
  alias: "alias",
  associationLinks: "associationLink",
  associations: "association",
  catalogueLinks: "catalogueLink",
  categoryEntries: "categoryEntry",
  categoryLinks: "categoryLink",
  characteristics: "characteristic",
  characteristicTypes: "characteristicType",
  conditionGroups: "conditionGroup",
  conditions: "condition",
  constraints: "constraint",
  costs: "cost",
  costTypes: "costType",
  displayCosts: "displayCost",
  entryLinks: "entryLink",
  forceEntries: "forceEntry",
  infoGroups: "infoGroup",
  infoLinks: "infoLink",
  localConditionGroups: "localConditionGroup",
  modifierGroups: "modifierGroup",
  modifiers: "modifier",
  profiles: "profile",
  profileTypes: "profileType",
  publications: "publication",
  repeats: "repeat",
  rules: "rule",
  selectionEntries: "selectionEntry",
  selectionEntryGroups: "selectionEntryGroup",
  sharedAssociations: "association",
  sharedInfoGroups: "infoGroup",
  sharedProfiles: "profile",
  sharedRules: "rule",
  sharedSelectionEntries: "selectionEntry",
  sharedSelectionEntryGroups: "selectionEntryGroup",
};

/** String properties written as child elements rather than attributes. */
const ELEMENT_STRINGS = new Set(["description", "readme", "comment"]);

/**
 * Child element order. BattleScribe's schema fixes the sequence of child
 * elements; this follows the order its own catalogues used (comment and
 * description first, logic before content, costs last, shared definitions after
 * the root's own lists).
 */
const CHILD_ORDER = [
  "comment",
  "readme",
  "description",
  "alias",
  "catalogueLinks",
  "publications",
  "costTypes",
  "profileTypes",
  "characteristicTypes",
  "categoryEntries",
  "forceEntries",
  "repeats",
  "conditions",
  "conditionGroups",
  "localConditionGroups",
  "modifiers",
  "modifierGroups",
  "constraints",
  "associations",
  "associationLinks",
  "profiles",
  "characteristics",
  "rules",
  "infoGroups",
  "infoLinks",
  "categoryLinks",
  "selectionEntries",
  "selectionEntryGroups",
  "entryLinks",
  "costs",
  "displayCosts",
  "sharedSelectionEntries",
  "sharedSelectionEntryGroups",
  "sharedRules",
  "sharedProfiles",
  "sharedInfoGroups",
  "sharedAssociations",
] as const;

function childRank(key: string): number {
  const rank = (CHILD_ORDER as readonly string[]).indexOf(key);
  if (rank < 0) throw new Error(`bsdata xml: no element order for "${key}"`);
  return rank;
}

/** Document roots and the file extension BattleScribe expects for each. */
export const ROOT_EXTENSION: Readonly<Record<string, string>> = {
  gameSystem: ".gst",
  catalogue: ".cat",
};

export interface XmlOptions {
  /** Keys dropped with their subtree. */
  readonly omitKeys?: ReadonlySet<string>;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
}

function scalarText(value: Json): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(`bsdata xml: expected a scalar, got ${JSON.stringify(value)}`);
}

function element(name: string, node: { [key: string]: Json }, depth: number, options: XmlOptions): string {
  const indent = "  ".repeat(depth);
  const attrs: string[] = [];
  const children: string[] = [];
  let text: string | null = null;
  const isChild = ([key, value]: [string, Json]): boolean => Array.isArray(value) || ELEMENT_STRINGS.has(key);
  const all = Object.entries(node);
  const entries = [
    ...all.filter((entry) => !isChild(entry)),
    ...all.filter(isChild).sort(([a], [b]) => childRank(a) - childRank(b)),
  ];
  for (const [key, value] of entries) {
    if (options.omitKeys?.has(key) || value === null || value === undefined) continue;
    if (key === "$text") {
      text = scalarText(value);
    } else if (Array.isArray(value)) {
      const item = ITEM_ELEMENT[key];
      if (!item) throw new Error(`bsdata xml: no element name for array "${key}"`);
      if (value.length === 0) continue;
      const items = value.map((child) =>
        typeof child === "object" && child !== null && !Array.isArray(child)
          ? element(item, child, depth + 2, options)
          : `${"  ".repeat(depth + 2)}<${item}>${escapeText(scalarText(child))}</${item}>`,
      );
      children.push(`${indent}  <${key}>\n${items.join("\n")}\n${indent}  </${key}>`);
    } else if (typeof value === "object") {
      throw new Error(`bsdata xml: unexpected object under "${key}"`);
    } else if (ELEMENT_STRINGS.has(key)) {
      children.push(`${indent}  <${key}>${escapeText(scalarText(value))}</${key}>`);
    } else {
      attrs.push(` ${key}="${escapeAttr(scalarText(value))}"`);
    }
  }
  const open = `${indent}<${name}${attrs.join("")}`;
  if (text !== null && children.length === 0) return `${open}>${escapeText(text)}</${name}>`;
  if (children.length === 0 && text === null) return `${open}/>`;
  const body = text === null ? children : [...children, `${indent}  ${escapeText(text)}`];
  return `${open}>\n${body.join("\n")}\n${indent}</${name}>`;
}

/** Renders a `{gameSystem}` or `{catalogue}` document as an XML string. */
export function toBattleScribeXml(document: { [key: string]: Json }, options: XmlOptions = {}): string {
  const roots = Object.keys(document);
  if (roots.length !== 1 || !(roots[0] in ROOT_EXTENSION)) {
    throw new Error(`bsdata xml: document root must be gameSystem or catalogue, got ${roots.join(",")}`);
  }
  const root = roots[0];
  const node = document[root];
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new Error("bsdata xml: document root is not an object");
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${element(root, node, 0, options)}\n`;
}
