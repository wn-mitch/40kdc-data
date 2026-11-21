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

/** BSData's own name and id for the library split from an army, where BSData has that library. */
const BSDATA_LIBRARIES: Readonly<Record<string, { readonly name: string; readonly id: string }>> = {
  "Imperium - Imperial Knights": { name: "Imperium - Imperial Knights - Library", id: "1b6d-dc06-5db9-c7d1" },
  // BSData keeps both Titan Legions in one library.
  "Imperium - Adeptus Titanicus": { name: "Library - Titans", id: "7481-280e-b55e-7867" },
  "Chaos - Titanicus Traitoris": { name: "Library - Titans", id: "7481-280e-b55e-7867" },
};

/** The name of the library split from the army catalogue named `armyName`. */
export function libraryNameFor(armyName: string): string {
  return BSDATA_LIBRARIES[armyName]?.name ?? `${armyName} Library`;
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
    const known = BSDATA_LIBRARIES[String(catalogue.name)];
    const name = libraryNameFor(String(catalogue.name));
    // Armies that share a BSData library (the Titan Legions) put their content in the one library.
    const shared = known ? libraries.find((l) => catalogueOf(l)?.name === known.name) : undefined;
    if (shared) {
      const library = catalogueOf(shared)!;
      libraryOf.set(String(catalogue.id), { id: String(library.id), name });
      for (const key of LIBRARY_CONTENT) {
        const merged = [...((library[key] as BsNode[] | undefined) ?? []), ...((catalogue[key] as BsNode[] | undefined) ?? [])];
        if (merged.length > 0) library[key] = merged;
      }
      continue;
    }
    const id = ids.id(`library:${String(catalogue.id)}`, known?.id);
    libraryOf.set(String(catalogue.id), { id, name });
    const content = Object.fromEntries(LIBRARY_CONTENT.filter((k) => catalogue[k] !== undefined).map((k) => [k, [...(catalogue[k] as BsNode[])]]));
    const { catalogueLinks: _links, entryLinks: _entries, ...header } = Object.fromEntries(
      Object.entries(catalogue).filter(([k]) => !(LIBRARY_CONTENT as readonly string[]).includes(k)),
    ) as BsNode;
    libraries.push({
      file: known ? `${known.name}.json` : doc.file.replace(/\.json$/, " Library.json"),
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
    // Two armies' libraries can be one shared library: link it once.
    const seen = new Set<string>();
    const unique = rewritten.filter((l) => {
      const key = `${String(l.targetId)}|${String(l.importRootEntries)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length > 0) army.catalogueLinks = unique;
    if (own) for (const key of LIBRARY_CONTENT) delete army[key];
    return { file: doc.file, document: { catalogue: army } };
  });
  const result = [...out, ...libraries];
  const remaining = cyclicCatalogues(result);
  if (remaining.size > 0) throw new Error(`bsdata export: catalogue links still cycle through ${[...remaining].join(", ")}`);
  return result;
}

/**
 * BSData libraries the export has no content for, as BSData names them and with the armies BSData
 * links them from (by file name). Tools that look for BSData's files by name find each one; 40kdc keeps what BSData
 * holds there (shared Aeldari, Astra Militarum and Tyranid units, Heresy Legends, unaligned
 * fortifications) in the army catalogues, so each library is empty.
 */
const BSDATA_LIBRARY_SHELLS: readonly { readonly name: string; readonly id: string; readonly linkedBy: readonly string[] }[] = [
  { name: "Aeldari - Aeldari Library", id: "dfcf-1214-b57-2205", linkedBy: ["Aeldari - Craftworlds", "Aeldari - Drukhari"] },
  { name: "Imperium - Astra Militarum - Library", id: "5a44-f048-114b-e3ff", linkedBy: ["Genestealer Cults", "Imperium - Astra Militarum"] },
  { name: "Library - Tyranids", id: "374d-45f0-5832-001e", linkedBy: ["Genestealer Cults", "Tyranids"] },
  {
    name: "Library - Astartes Heresy Legends",
    id: "ac3b-689c-4ad4-70cb",
    linkedBy: ["Chaos - Chaos Space Marines", "Chaos - Death Guard", "Chaos - Emperor's Children", "Chaos - Thousand Sons", "Chaos - World Eaters", "Imperium - Space Marines"],
  },
  {
    name: "Unaligned Forces",
    id: "581a-46b9-5b86-44b7",
    linkedBy: [
      "Chaos - Death Guard", "Chaos - Emperor's Children", "Chaos - Thousand Sons", "Chaos - World Eaters", "Genestealer Cults",
      "Imperium - Agents of the Imperium", "Imperium - Astra Militarum", "Imperium - Grey Knights", "Imperium - Imperial Knights",
      "Leagues of Votann", "Necrons", "Orks", "T'au Empire", "Tyranids",
    ],
  },
];

/** `docs` with BSData's content-free libraries added (`BSDATA_LIBRARY_SHELLS`), each linked from the army files BSData links it from. */
export function withBsdataLibraryShells(docs: readonly CatalogueDocument[], ids: IdAllocator): CatalogueDocument[] {
  const template = docs.map(catalogueOf).find((c) => c !== undefined);
  if (!template) return [...docs];
  const header = Object.fromEntries(
    ["battleScribeVersion", "gameSystemId", "gameSystemRevision", "revision", "type", "xmlns"].filter((k) => template[k] !== undefined).map((k) => [k, template[k]]),
  );
  const shells = BSDATA_LIBRARY_SHELLS.map((shell) => ({ ...shell, id: ids.id(`library-shell:${shell.name}`, shell.id) }));
  const out = docs.map((doc): CatalogueDocument => {
    const catalogue = catalogueOf(doc);
    if (!catalogue) return doc;
    const added = shells
      .filter((shell) => shell.linkedBy.includes(doc.file.replace(/\.json$/, "")))
      .map((shell) => ({ name: shell.name, id: ids.id(`library-shell-link:${String(catalogue.id)}:${shell.id}`), importRootEntries: false, targetId: shell.id, type: "catalogue" }));
    return added.length === 0 ? doc : { file: doc.file, document: { catalogue: { ...catalogue, catalogueLinks: [...links(catalogue), ...added] } } };
  });
  const library = (shell: (typeof shells)[number]): CatalogueDocument => ({
    file: `${shell.name}.json`,
    document: { catalogue: { name: shell.name, id: shell.id, ...header, library: true } },
  });
  return [...out, ...shells.map(library)];
}
