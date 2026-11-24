import { CompileError, closed, type CompileLeaf } from "./compile-fragments.js";

type Node = Record<string, unknown>;

/** The area-select picks a region-extend with area selected reads: the areas, and the spend that pays for all of them. */
type Selection = { territories: string[]; all_with?: CompileLeaf };

/**
 * Folds the area-select leaves of an ability into the region-extend with area selected after them:
 * "Select No Man's Land or your opponent's deployment zone, or spend one Flux token and select both.
 * … the selected areas … are within your army's Shadow of Chaos." A select one is required; a
 * select all of the same areas is the alternative the resource-spend right before it pays for.
 * The folded leaves leave the list; the region-extend carries them as `selection`.
 */
export function foldAreaSelections(input: readonly CompileLeaf[]): CompileLeaf[] {
  const selects = input.filter((leaf) => leaf.family_id === "area-select");
  const readers = input.filter((leaf) => leaf.family_id === "region-extend" && leaf.parameters.area === "selected");
  if (selects.length === 0 && readers.length === 0) return [...input];
  if (readers.length !== 1) throw new CompileError(`An ability's area-select leaves feed one region-extend with area selected; it has ${readers.length}.`);
  const reader = readers[0]!;
  const at = input.indexOf(reader);
  if (selects.some((leaf) => input.indexOf(leaf) > at)) throw new CompileError("An area-select comes after the region-extend that reads it.");
  const one = selects.filter((leaf) => leaf.parameters.select === "one");
  const all = selects.filter((leaf) => leaf.parameters.select === "all");
  if (one.length !== 1 || all.length > 1) throw new CompileError("A region-extend with area selected reads one select one and at most one select all.");
  const territories = one[0]!.parameters.territories as string[];
  const removed = new Set<CompileLeaf>(selects);
  const selection: Selection = { territories: [...territories] };
  if (all.length === 1) {
    const both = all[0]!.parameters.territories as string[];
    if (both.length !== territories.length || both.some((territory) => !territories.includes(territory))) {
      throw new CompileError("A select all lists the same areas as the select one it is the alternative to.");
    }
    const spend = input[input.indexOf(all[0]!) - 1];
    if (spend?.family_id !== "resource-spend") throw new CompileError("A select all is the alternative a resource-spend right before it pays for; none does.");
    selection.all_with = spend;
    removed.add(spend);
  }
  return input.filter((leaf) => !removed.has(leaf)).map((leaf) => leaf === reader ? { ...leaf, parameters: { ...leaf.parameters, selection } } : leaf);
}

/** The region-extend single effect over one area. */
function extension(leaf: CompileLeaf, area: Node): Node {
  return {
    type: "region-extend", target: { owner: "friendly" },
    modifier: { region: { region_id: closed(leaf, "region_id"), owner_faction: closed(leaf, "owner_faction") }, area },
  };
}

/**
 * A region-extend leaf as DSL. A selected area becomes a choice: one option per area, plus, when a
 * spend pays for all of them, an option that spends and extends the region over every area.
 */
export function regionExtendEffect(leaf: CompileLeaf, lower: (leaf: CompileLeaf) => Node): Node {
  const area = String(closed(leaf, "area"));
  if (area === "territory") return extension(leaf, { territory: closed(leaf, "territory") });
  if (area === "objective-range") {
    const objective: Node = {};
    if (leaf.parameters.objective_tag !== undefined) objective.designated = closed(leaf, "objective_tag");
    if (leaf.parameters.controlled_by !== undefined) objective.controlled_by = "friendly";
    return extension(leaf, { objective_range: { objective, inches: closed(leaf, "inches") } });
  }
  const selection = leaf.parameters.selection as Selection | undefined;
  if (selection === undefined) throw new CompileError("region-extend with area selected needs the area-select leaves before it.");
  const options: Node[] = selection.territories.map((territory) => extension(leaf, { territory }));
  if (selection.all_with !== undefined) {
    options.push({ type: "sequence", steps: [lower(selection.all_with), extension(leaf, { territories: [...selection.territories] })] });
  }
  return { type: "choice", options };
}
