/**
 * Typed builders for hand-made MFM dump fixtures.
 *
 * Focused tests author only the columns the code under test reads. These
 * helpers keep table names, column names and column value types checked
 * against the generated dump contract while letting a fixture omit columns.
 */
import { MfmDump, type MfmMetadata, type MfmRow, type MfmTableMap, type MfmTableName } from "../src/mfm/loader.js";

/** Recursively optional, preserving array element and null/primitive types. */
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * A fixture row of table `N` that may omit any column. An unobserved table's row type is
 * `never` (it has no contract columns), so its rows are records shaped by the reader under test.
 */
export type PartialRow<N extends MfmTableName> = [MfmRow<N>] extends [never]
  ? Record<string, unknown>
  : DeepPartial<MfmRow<N>>;

/** Fixture tables: any subset of tables, each row any subset of its columns. */
export type PartialTables = { [N in MfmTableName]?: PartialRow<N>[] };

/**
 * Builds an `MfmDump` from partial tables, taking the same init shape as the
 * `MfmDump` constructor. Omitted columns read as `undefined` at runtime.
 */
export function partialDump(init: { metadata?: Partial<MfmMetadata>; data: PartialTables }): MfmDump {
  // Fixtures deliberately omit unread columns; the loader never validates rows.
  const data = init.data as unknown as Partial<MfmTableMap>;
  return new MfmDump({ metadata: init.metadata, data });
}

/**
 * Types a fixture row of table `N` as a full row for APIs that take rows
 * directly. Omitted columns are `undefined` at runtime.
 */
export function partialRow<N extends MfmTableName>(_table: N, row: PartialRow<N>): MfmRow<N> {
  return row as unknown as MfmRow<N>;
}
