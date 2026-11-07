import { describe, expect, it } from "vitest";

import type { AbilityRow } from "../src/mfm/dump-prose-rows.js";
import { identityRows, type IdentitySet } from "../src/mfm/mirror/identity.js";

const row = (key: string, text: string): AbilityRow => ({ key, text } as unknown as AbilityRow);
const set = (identities: Record<string, AbilityRow[]>): IdentitySet => ({
  identities: [],
  byId: new Map(Object.entries(identities).map(([id, rows]) => [id, { id, rows } as never])),
  byRowKey: new Map(Object.entries(identities).flatMap(([id, rows]) => rows.map((r) => [r.key, id] as [string, string]))),
  byDumpRow: new Map(),
  undecided: [],
});

describe("identityRows: a record reads the rows of the identity carrying its id", () => {
  const item = row("a", "Item text.");
  const choice = row("b", "Choice text.");
  const ids = set({ "banner-x": [item], "banner-wargear-x": [choice] });
  const all = () => true;

  it("answers each id with its own identity's rows", () => {
    expect(identityRows(ids, "banner-x", [item, choice], all)).toEqual([item]);
    expect(identityRows(ids, "banner-wargear-x", [item, choice], all)).toEqual([choice]);
  });

  it("refuses when another text set aside has no record, or the id is no identity", () => {
    expect(identityRows(ids, "banner-x", [item, choice], (id) => id === "banner-x")).toBeNull();
    expect(identityRows(ids, "banner-other-x", [item, choice], all)).toBeNull();
    expect(identityRows(set({ "banner-x": [item] }), "banner-x", [item, choice], all)).toBeNull();
  });

  it("takes the spelling most rows print when an identity's texts differ only in spacing", () => {
    const spaced = [row("c", "Gain cover. If riled, hits."), row("d", "Gain cover. If riled, hits.")];
    const tight = row("e", "Gain cover.\nIf riled, hits.");
    expect(identityRows(set({ dakka: [tight, ...spaced] }), "dakka", [tight, ...spaced], all)).toEqual(spaced);
  });
});
