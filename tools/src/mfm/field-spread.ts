/**
 * The value spread of one MFM dump source path, as recorded on each
 * `unmapped_mfm_fields` entry. Paths use the mapping-file form:
 * `data.<table>.<field>[.<segment>|.*]…` or a root path such as
 * `metadata.data_version`. The spread never quotes string values, so prose
 * stays in the dump; booleans and numbers with few distinct values list them.
 */

const MAX_LISTED = 6;

/** Collect the values a path reaches in `rows`, expanding `*` over object values. */
function collect(rows: readonly unknown[], segments: readonly string[]): unknown[] {
  let current: unknown[] = [...rows];
  for (const seg of segments) {
    const next: unknown[] = [];
    for (const value of current) {
      if (value === null || typeof value !== "object") {
        next.push(undefined);
        continue;
      }
      if (seg === "*") next.push(...Object.values(value as Record<string, unknown>));
      else next.push((value as Record<string, unknown>)[seg]);
    }
    current = next;
  }
  return current;
}

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** The deterministic spread summary for `source` in a parsed dump, or null when the path names no table. */
export function fieldSpread(dump: unknown, source: string): string | null {
  const root = dump as { metadata?: Record<string, unknown>; data?: Record<string, unknown> };
  const parts = source.split(".");
  let values: unknown[];
  let rows: number;
  if (parts[0] === "data") {
    const table = root.data?.[parts[1]];
    if (!Array.isArray(table)) return null;
    rows = table.length;
    values = collect(table, parts.slice(2));
  } else {
    rows = 1;
    values = collect([root], parts);
  }
  const present = values.filter((v) => v !== undefined && v !== null);
  const nulls = values.length - present.length;
  const types = [...new Set(present.map(typeOf))].sort();
  const head = `${rows} rows, ${values.length} values (${nulls} null/absent)`;
  if (present.length === 0) return `${head}`;
  const type = types.join("|");
  if (types.length === 1 && (type === "boolean" || type === "number")) {
    const counts = new Map<string, number>();
    for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const entries = [...counts].sort(([a], [b]) => (type === "number" ? Number(a) - Number(b) : a.localeCompare(b)));
    if (entries.length <= MAX_LISTED) return `${head}: ${type} ${entries.map(([v, n]) => `${v}×${n}`).join(", ")}`;
    const nums = present as number[];
    return `${head}: number, ${entries.length} distinct, ${Math.min(...nums)}..${Math.max(...nums)}`;
  }
  if (types.length === 1 && type === "string") {
    return `${head}: string, ${new Set(present).size} distinct`;
  }
  return `${head}: ${type}`;
}
