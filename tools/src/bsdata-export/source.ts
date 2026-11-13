/**
 * Reads a BSData wh40k-11e checkout (JSON game system and catalogues) for the
 * exporter's id extraction and alignment checks. Nothing here reads rule text:
 * callers take names, ids, types and structure only.
 */
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

export type BsNode = { [key: string]: unknown };

export interface BsDocument {
  /** File name, e.g. `Necrons.json`. */
  readonly file: string;
  /** `gameSystem` or `catalogue`. */
  readonly kind: "gameSystem" | "catalogue";
  readonly root: BsNode;
}

/** The repo faction each BSData faction catalogue file corresponds to. */
export const FACTION_CATALOGUE_FILES: Readonly<Record<string, string>> = {
  "adepta-sororitas": "Imperium - Adepta Sororitas.json",
  "adeptus-astartes": "Imperium - Space Marines.json",
  "adeptus-custodes": "Imperium - Adeptus Custodes.json",
  "adeptus-mechanicus": "Imperium - Adeptus Mechanicus.json",
  aeldari: "Aeldari - Craftworlds.json",
  "agents-of-the-imperium": "Imperium - Agents of the Imperium.json",
  "astra-militarum": "Imperium - Astra Militarum.json",
  "black-templars": "Imperium - Black Templars.json",
  "blood-angels": "Imperium - Blood Angels.json",
  "chaos-daemons": "Chaos - Chaos Daemons.json",
  "chaos-knights": "Chaos - Chaos Knights.json",
  "chaos-space-marines": "Chaos - Chaos Space Marines.json",
  "dark-angels": "Imperium - Dark Angels.json",
  "death-guard": "Chaos - Death Guard.json",
  deathwatch: "Imperium - Deathwatch.json",
  drukhari: "Aeldari - Drukhari.json",
  "emperors-children": "Chaos - Emperor's Children.json",
  "genestealer-cults": "Genestealer Cults.json",
  "grey-knights": "Imperium - Grey Knights.json",
  "imperial-fists": "Imperium - Imperial Fists.json",
  "imperial-knights": "Imperium - Imperial Knights.json",
  "iron-hands": "Imperium - Iron Hands.json",
  "leagues-of-votann": "Leagues of Votann.json",
  necrons: "Necrons.json",
  orks: "Orks.json",
  "raven-guard": "Imperium - Raven Guard.json",
  salamanders: "Imperium - Salamanders.json",
  "space-wolves": "Imperium - Space Wolves.json",
  "tau-empire": "T'au Empire.json",
  "thousand-sons": "Chaos - Thousand Sons.json",
  tyranids: "Tyranids.json",
  ultramarines: "Imperium - Ultramarines.json",
  "white-scars": "Imperium - White Scars.json",
  "world-eaters": "Chaos - World Eaters.json",
};

export const GAME_SYSTEM_FILE = "Warhammer 40,000.json";

/** Array keys whose items are nodes, and the node kind each holds. */
export const CONTAINER_KIND: Readonly<Record<string, string>> = {
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
  displayCosts: "cost",
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

export function isNode(value: unknown): value is BsNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function children(node: BsNode, key: string): BsNode[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
}

export function str(node: BsNode, key: string): string | undefined {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
}

/** Parses one BSData JSON document. */
export function parseDocument(file: string, text: string): BsDocument {
  const parsed: unknown = JSON.parse(text);
  if (!isNode(parsed)) throw new Error(`${file}: not a JSON object`);
  const kind = Object.keys(parsed)[0];
  if ((kind !== "gameSystem" && kind !== "catalogue") || !isNode(parsed[kind])) {
    throw new Error(`${file}: root is neither gameSystem nor catalogue`);
  }
  return { file, kind, root: parsed[kind] };
}

/** Loads every `.json` document in a BSData checkout directory. */
export function loadBsdataDir(dir: string): BsDocument[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => parseDocument(file, readFileSync(path.join(dir, file), "utf8")));
}

export interface NodeVisit {
  readonly node: BsNode;
  readonly kind: string;
  /** Ancestor nodes, outermost first (the document root included). */
  readonly ancestors: readonly BsNode[];
}

/** Depth-first walk over every node beneath `root`, in document order. */
export function* walk(root: BsNode, rootKind: string): Generator<NodeVisit> {
  const stack: { node: BsNode; kind: string; ancestors: BsNode[] }[] = [
    { node: root, kind: rootKind, ancestors: [] },
  ];
  while (stack.length > 0) {
    const current = stack.pop()!;
    yield current;
    const next: { node: BsNode; kind: string; ancestors: BsNode[] }[] = [];
    for (const [key, value] of Object.entries(current.node)) {
      const kind = CONTAINER_KIND[key];
      if (!kind || !Array.isArray(value)) continue;
      for (const item of value) {
        if (isNode(item)) next.push({ node: item, kind, ancestors: [...current.ancestors, current.node] });
      }
    }
    for (let i = next.length - 1; i >= 0; i -= 1) stack.push(next[i]);
  }
}

/** A catalogue plus every catalogue its links reach, the catalogue itself first. */
export function catalogueClosure(documents: readonly BsDocument[], file: string): BsDocument[] {
  const byId = new Map(documents.map((doc) => [str(doc.root, "id"), doc]));
  const start = documents.find((doc) => doc.file === file);
  if (!start) throw new Error(`BSData checkout has no ${file}`);
  const seen = new Set<BsDocument>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const doc = queue.shift()!;
    for (const link of children(doc.root, "catalogueLinks")) {
      const target = byId.get(str(link, "targetId"));
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...seen];
}
