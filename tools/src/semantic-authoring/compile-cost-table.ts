import { closed, CompileError, type CompileLeaf } from "./compile-fragments.js";

/**
 * A cost read from a table (resource-spend@4), bound before any role-based pass.
 *
 * "spend the relevant number of Resurgence points shown below based on that unit's Starting
 * Strength" is a resource-spend with amount by-table. The table follows it: each heading is a
 * unit-filter naming datasheets ("Aberrants."), and each row after a heading is a resource-spend
 * with starting_strength ("For 5 models, you must spend 4 Resurgence points."). The headings and
 * rows fold into the by-table spend's `amount_table` (one entry per row, keyed by its heading's
 * datasheets) and are dropped, so the table is one cost, not a spend per row.
 */

type Row = { unit_ids: string[]; starting_strength: number; amount: number };

const isByTable = (leaf: CompileLeaf) => leaf.family_id === "resource-spend" && leaf.parameters.amount === "by-table";
const isRow = (leaf: CompileLeaf) => leaf.family_id === "resource-spend" && leaf.parameters.starting_strength !== undefined;
const isHeading = (leaf: CompileLeaf) => leaf.family_id === "unit-filter" && leaf.parameters.datasheets !== undefined;

export function foldCostTables(leaves: readonly CompileLeaf[]): CompileLeaf[] {
  const spends = leaves.flatMap((leaf, index) => isByTable(leaf) ? [index] : []);
  if (spends.length === 0) {
    const row = leaves.find(isRow);
    if (row) throw new CompileError(`The resource-spend row at byte ${row.start_byte} has no by-table spend before it to belong to.`);
    return [...leaves];
  }
  if (spends.length > 1) throw new CompileError(`A record has ${spends.length} by-table spends; each table follows one spend.`);
  const at = spends[0]!;
  const spend = leaves[at]!;
  const pool = JSON.stringify(closed(spend, "pool"));
  const table: Row[] = [];
  let heading: CompileLeaf | undefined;
  let rowsUnderHeading = 0;
  let end = at + 1;
  for (; end < leaves.length; end += 1) {
    const leaf = leaves[end]!;
    if (isHeading(leaf)) {
      if (heading && rowsUnderHeading === 0) throw new CompileError(`The table heading at byte ${heading.start_byte} has no rows after it.`);
      heading = leaf;
      rowsUnderHeading = 0;
      continue;
    }
    if (!isRow(leaf)) break;
    if (!heading) throw new CompileError(`The resource-spend row at byte ${leaf.start_byte} comes before any table heading naming its datasheets.`);
    if (JSON.stringify(closed(leaf, "pool")) !== pool) throw new CompileError(`The resource-spend row at byte ${leaf.start_byte} spends a different pool from its by-table spend.`);
    const unitIds = closed(heading, "datasheets") as string[];
    const strength = closed(leaf, "starting_strength") as number;
    const amount = closed(leaf, "amount");
    if (!Number.isInteger(amount)) throw new CompileError(`The resource-spend row at byte ${leaf.start_byte} needs a whole-number amount.`);
    if (table.some((row) => row.starting_strength === strength && row.unit_ids.some((id) => unitIds.includes(id)))) {
      throw new CompileError(`The cost table gives a Starting Strength of ${strength} two rows for one datasheet (byte ${leaf.start_byte}).`);
    }
    table.push({ unit_ids: [...unitIds], starting_strength: strength, amount: amount as number });
    rowsUnderHeading += 1;
  }
  if (!heading || rowsUnderHeading === 0) throw new CompileError(`The by-table spend at byte ${spend.start_byte} has no table of headings and rows after it.`);
  const stray = leaves.slice(end).find((leaf) => isRow(leaf) || isHeading(leaf));
  if (stray) throw new CompileError(`The ${stray.family_id} at byte ${stray.start_byte} is apart from the cost table it belongs to.`);
  const folded: CompileLeaf = { ...spend, parameters: { ...spend.parameters, amount_table: table } };
  return [...leaves.slice(0, at), folded, ...leaves.slice(end)];
}
