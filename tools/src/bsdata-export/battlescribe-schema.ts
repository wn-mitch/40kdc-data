/**
 * The BattleScribe 2.03 data file schema (`schema/battlescribe-2.03.xsd`, from
 * WarHub/wham), read into the element sequence and attributes each element
 * allows, and the projection of a BSData JSON document onto it.
 *
 * BSData's JSON (the NewRecruit format) carries constructs BattleScribe's
 * schema lacks. The projection drops exactly those listed in
 * {@link NEWRECRUIT_ONLY} and throws on any other key the schema does not
 * allow, so the XML BattleScribe reads stays valid against its schema.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import type { BsNode } from "./source.js";

export const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema", "battlescribe-2.03.xsd");

interface ElementType {
  /** Child elements in schema sequence order, with their types. */
  readonly children: readonly { readonly name: string; readonly type: string }[];
  readonly attributes: ReadonlySet<string>;
  /** Whether the element carries text content (a simple-content extension). */
  readonly text: boolean;
}

export interface BattleScribeSchema {
  readonly roots: ReadonlyMap<string, string>;
  readonly types: ReadonlyMap<string, ElementType>;
}

/**
 * Keys BSData's JSON uses that BattleScribe 2.03 has no element or attribute
 * for, as `<element>.<key>` (`*` for any element). Leader associations,
 * army-copy pricing (`localConditionGroups`), default amounts and display
 * hints exist only in NewRecruit.
 */
export const NEWRECRUIT_ONLY: ReadonlySet<string> = new Set([
  "*.associations",
  "*.associationLinks",
  "*.sharedAssociations",
  "*.localConditionGroups",
  "*.childName",
  "*.sortIndex",
  "entryLink.defaultAmount",
  "selectionEntry.defaultAmount",
  "catalogue.type",
  "gameSystem.type",
]);

type Ordered = { [tag: string]: Ordered[] } & { ":@"?: Record<string, string> };

function tagOf(node: Ordered): string {
  return Object.keys(node).find((k) => k !== ":@")!;
}

function local(name: string): string {
  return name.replace(/^(xs|tns):/, "");
}

/** Reads the vendored XSD. */
export function loadBattleScribeSchema(xsd: string = readFileSync(SCHEMA_PATH, "utf8")): BattleScribeSchema {
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "" });
  const doc = parser.parse(xsd) as Ordered[];
  const schema = doc.find((n) => tagOf(n) === "xs:schema")!["xs:schema"];
  const complexTypes = new Map<string, Ordered>();
  const groups = new Map<string, Ordered>();
  const attributeGroups = new Map<string, Ordered>();
  const roots = new Map<string, string>();
  for (const node of schema) {
    const tag = tagOf(node);
    const attrs = node[":@"] ?? {};
    if (tag === "xs:complexType") complexTypes.set(attrs.name, node);
    else if (tag === "xs:group") groups.set(attrs.name, node);
    else if (tag === "xs:attributeGroup") attributeGroups.set(attrs.name, node);
    else if (tag === "xs:element") roots.set(attrs.name, local(attrs.type));
  }

  const types = new Map<string, ElementType>();
  const resolve = (name: string): ElementType => {
    const cached = types.get(name);
    if (cached) return cached;
    const children: { name: string; type: string }[] = [];
    const attributes = new Set<string>();
    let text = false;
    const visit = (nodes: Ordered[]): void => {
      for (const node of nodes) {
        const tag = tagOf(node);
        const attrs = node[":@"] ?? {};
        if (tag === "xs:element") children.push({ name: attrs.name, type: local(attrs.type) });
        else if (tag === "xs:attribute") attributes.add(attrs.name);
        else if (tag === "xs:group") visit(groups.get(local(attrs.ref))!["xs:group"]);
        else if (tag === "xs:attributeGroup") visit(attributeGroups.get(local(attrs.ref))!["xs:attributeGroup"]);
        else if (tag === "xs:extension") {
          const base = local(attrs.base);
          if (complexTypes.has(base)) {
            const inherited = resolve(base);
            children.push(...inherited.children);
            for (const a of inherited.attributes) attributes.add(a);
            text ||= inherited.text;
          } else {
            text = true;
          }
          visit(node[tag]);
        } else if (tag === "xs:sequence" || tag === "xs:complexContent" || tag === "xs:simpleContent") visit(node[tag]);
      }
    };
    const definition = complexTypes.get(name);
    if (!definition) throw new Error(`battlescribe schema: no type ${name}`);
    visit(definition["xs:complexType"]);
    const type = { children, attributes, text };
    types.set(name, type);
    return type;
  };
  for (const name of complexTypes.keys()) resolve(name);
  return { roots, types };
}

function dropped(element: string, key: string): boolean {
  return NEWRECRUIT_ONLY.has(`*.${key}`) || NEWRECRUIT_ONLY.has(`${element}.${key}`);
}

function hasLocalConditions(node: BsNode): boolean {
  if (Array.isArray(node.localConditionGroups) && node.localConditionGroups.length > 0) return true;
  return (["conditionGroups"] as const).some((key) => Array.isArray(node[key]) && (node[key] as BsNode[]).some(hasLocalConditions));
}

/**
 * Elements whose meaning depends on a NewRecruit-only construct, dropped whole:
 * a constraint on associations, and a modifier gated on earlier copies of the
 * entry (`localConditionGroups`), which without its gate would always apply.
 * BattleScribe prices every copy of such a unit at the first copy's rate.
 */
function newRecruitOnly(element: string, node: BsNode): boolean {
  if (element === "constraint") return node.field === "associations";
  if (element === "modifier") return hasLocalConditions(node);
  return false;
}

export interface ProjectedElement {
  readonly name: string;
  readonly attributes: readonly [string, string | number | boolean][];
  readonly text?: string;
  /** Child elements in schema order: a string element, or a list element's items. */
  readonly children: readonly ({ readonly name: string; readonly value: string } | { readonly name: string; readonly items: readonly ProjectedElement[] })[];
}

/**
 * Projects a JSON node of schema type `typeName`, written as element `name`,
 * onto the schema: attributes and children the schema allows, in its order.
 */
export function projectElement(schema: BattleScribeSchema, name: string, typeName: string, node: BsNode): ProjectedElement {
  const type = schema.types.get(typeName);
  if (!type) throw new Error(`battlescribe schema: no type ${typeName}`);
  const attributes: [string, string | number | boolean][] = [];
  let text: string | undefined;
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (key === "$text") {
      if (!type.text) throw new Error(`battlescribe schema: ${name} has no text content`);
      text = String(value);
    } else if (type.attributes.has(key)) {
      if (typeof value === "object") throw new Error(`battlescribe schema: ${name}.${key} is not a scalar`);
      attributes.push([key, value as string | number | boolean]);
    } else if (!type.children.some((c) => c.name === key) && !dropped(name, key)) {
      throw new Error(`battlescribe schema: ${name} does not allow "${key}"`);
    }
  }
  const children: ProjectedElement["children"][number][] = [];
  for (const child of type.children) {
    const value = node[child.name];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      children.push({ name: child.name, value: String(value) });
      continue;
    }
    const list = schema.types.get(child.type);
    const item = list?.children[0];
    if (!list || list.children.length !== 1 || !item) throw new Error(`battlescribe schema: ${child.name} is not a list`);
    const items = (value as BsNode[]).filter((v) => !newRecruitOnly(item.name, v)).map((v) => projectElement(schema, item.name, item.type, v));
    if (items.length > 0) children.push({ name: child.name, items });
  }
  return { name, attributes, text, children };
}

/** Projects a `{gameSystem}` or `{catalogue}` document; the root keeps its `xmlns`. */
export function projectDocument(schema: BattleScribeSchema, document: Record<string, unknown>): ProjectedElement {
  const [root] = Object.keys(document);
  const typeName = schema.roots.get(root);
  if (!typeName || Object.keys(document).length !== 1) throw new Error(`battlescribe schema: unknown document root ${Object.keys(document).join(",")}`);
  const { xmlns, ...node } = document[root] as BsNode;
  const projected = projectElement(schema, root, typeName, node);
  return typeof xmlns === "string" ? { ...projected, attributes: [["xmlns", xmlns], ...projected.attributes] } : projected;
}
