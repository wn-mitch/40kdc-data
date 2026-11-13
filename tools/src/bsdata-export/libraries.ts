/**
 * Library catalogues that keep the catalogue link graph acyclic.
 *
 * Armies that take each other's units as allies (Chaos Space Marines, Chaos
 * Daemons and Chaos Knights; Imperial Knights, Adeptus Mechanicus and Agents
 * of the Imperium) would link each other's catalogues in a cycle, and
 * NewRecruit refuses to load a catalogue on a link cycle. BSData splits those
 * armies the same way: each catalogue on a cycle keeps its army (root entry
 * links) and moves what other catalogues reference (categories and shared
 * entries) into a `library` catalogue. A catalogue that took units from the
 * army links its library instead; one that imports the army's root entries (a
 * chapter) links both.
 */
import type { IdAllocator } from "./ids.js";
import type { BsNode } from "./source.js";

export interface CatalogueDocument {
  readonly file: string;
  readonly document: BsNode;
}

const LIBRARY_CONTENT = ["categoryEntries", "sharedSelectionEntries", "sharedSelectionEntryGroups", "sharedProfiles", "sharedRules", "sharedInfoGroups"] as const;

function catalogueOf(doc: CatalogueDocument): BsNode | undefined {
  return (doc.document as { catalogue?: BsNode }).catalogue;
}

function links(catalogue: BsNode): BsNode[] {
  return (catalogue.catalogueLinks as BsNode[] | undefined) ?? [];
}

/** Catalogue ids on a link cycle: strongly connected components of more than one catalogue, or a self-link. */
export function cyclicCatalogues(docs: readonly CatalogueDocument[]): Set<string> {
  const edges = new Map<string, string[]>();
  for (const doc of docs) {
    const catalogue = catalogueOf(doc);
    if (catalogue) edges.set(String(catalogue.id), links(catalogue).map((l) => String(l.targetId)));
  }
  // Tarjan's algorithm.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out = new Set<string>();
  let next = 0;
  const visit = (v: string): void => {
    index.set(v, next);
    low.set(v, next);
    next += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!edges.has(w)) continue;
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) !== index.get(v)) return;
    const component: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      component.push(w);
    } while (w !== v);
    if (component.length > 1 || (edges.get(v) ?? []).includes(v)) for (const c of component) out.add(c);
  };
  for (const v of edges.keys()) if (!index.has(v)) visit(v);
  return out;
}

/** `docs` with every catalogue on a link cycle split into its army and a library; throws if a cycle remains. */
export function splitCyclicCatalogues(docs: readonly CatalogueDocument[], ids: IdAllocator): CatalogueDocument[] {
  const cyclic = cyclicCatalogues(docs);
  if (cyclic.size === 0) return [...docs];
  const libraryOf = new Map<string, { id: string; name: string }>();
  const libraries: CatalogueDocument[] = [];
  for (const doc of docs) {
    const catalogue = catalogueOf(doc);
    if (!catalogue || !cyclic.has(String(catalogue.id))) continue;
    const name = `${String(catalogue.name)} Library`;
    const id = ids.id(`library:${String(catalogue.id)}`);
    libraryOf.set(String(catalogue.id), { id, name });
    const content = Object.fromEntries(LIBRARY_CONTENT.filter((k) => catalogue[k] !== undefined).map((k) => [k, catalogue[k]]));
    const { catalogueLinks: _links, entryLinks: _entries, ...header } = Object.fromEntries(
      Object.entries(catalogue).filter(([k]) => !(LIBRARY_CONTENT as readonly string[]).includes(k)),
    ) as BsNode;
    libraries.push({
      file: doc.file.replace(/\.json$/, " Library.json"),
      document: { catalogue: { ...header, name, id, library: true, ...content } },
    });
  }
  const out = docs.map((doc): CatalogueDocument => {
    const catalogue = catalogueOf(doc);
    if (!catalogue) return doc;
    const rewritten: BsNode[] = [];
    const own = libraryOf.get(String(catalogue.id));
    if (own) rewritten.push({ name: own.name, id: ids.id(`library-link:${String(catalogue.id)}`), importRootEntries: false, targetId: own.id, type: "catalogue" });
    for (const link of links(catalogue)) {
      const library = libraryOf.get(String(link.targetId));
      if (!library) {
        rewritten.push(link);
        continue;
      }
      // An army that imports the target's root entries still links the army itself.
      if (link.importRootEntries === true) rewritten.push(link);
      rewritten.push({ ...link, name: library.name, id: link.importRootEntries === true ? ids.id(`library-link:${String(link.id)}`) : link.id, targetId: library.id, importRootEntries: false });
    }
    const army: BsNode = { ...catalogue };
    if (rewritten.length > 0) army.catalogueLinks = rewritten;
    if (own) for (const key of LIBRARY_CONTENT) delete army[key];
    return { file: doc.file, document: { catalogue: army } };
  });
  const result = [...out, ...libraries];
  const remaining = cyclicCatalogues(result);
  if (remaining.size > 0) throw new Error(`bsdata export: catalogue links still cycle through ${[...remaining].join(", ")}`);
  return result;
}
