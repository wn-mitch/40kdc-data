import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { type AbilityOwner, type AbilityRow, DumpProse, type StratagemFields } from "../src/mfm/dump-prose.js";
import { openWorkbench } from "../src/round5c/db.js";
import { loadDumpSourceRecords } from "../src/round5c/dump-source.js";
import { loadSourceRecords, refreshSources } from "../src/round5c/source.js";

// Fabricated names, ids and prose only.
const roots: string[] = [];
const savedFixture = process.env.ROUND5C_SOURCE_FIXTURE;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (savedFixture === undefined) delete process.env.ROUND5C_SOURCE_FIXTURE;
  else process.env.ROUND5C_SOURCE_FIXTURE = savedFixture;
});

function dataRoot(files: Record<string, unknown[]>): string {
  const root = mkdtempSync(join(tmpdir(), "round5c-dump-source-"));
  roots.push(root);
  for (const [path, records] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(records));
  }
  return root;
}

const mfm = (id: string) => [{ namespace: "mfm", id }];
const datasheet = (id: string, name = id): AbilityOwner => ({ kind: "datasheet", id, name, slug: id });
const detachment = (id: string, slug: string): AbilityOwner => ({ kind: "detachment", id, name: slug, slug });

let serial = 0;
function row(faction: string, owner: AbilityOwner, name: string, fields: { kind?: AbilityRow["kind"]; text?: string; stratagem?: StratagemFields; combatPatrol?: boolean; datasheetIds?: string[] } = {}): AbilityRow {
  serial += 1;
  const rowId = `row-${serial}`;
  return {
    key: rowId, kind: fields.kind ?? "datasheet-ability", table: "datasheet_ability", rowId, ref: `dump.json#${rowId}`, faction,
    publication: { id: "pub", name: fields.combatPatrol ? "Combat Patrol: Fixture" : "Codex: Fixture", combatPatrol: fields.combatPatrol ?? false, legends: false },
    owner, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/gu, "-"), ...(fields.text ? { text: fields.text } : {}),
    ...(fields.stratagem ? { stratagem: fields.stratagem } : {}), ...(fields.datasheetIds ? { datasheetIds: fields.datasheetIds } : {}), legends: false, sharedWith: [],
  };
}

describe("Round 5C source prose from the dump", () => {
  it("reads each ability only from the rows its own owners print", () => {
    const root = dataRoot({
      "enrichment/alpha/abilities.json": [
        { ability_id: "grim-resolve", name: "Grim Resolve", ability_type: "unit", unit_ids: ["warden"] },
        { ability_id: "banner", name: "Banner", ability_type: "unit", unit_ids: ["warden", "patrol-warden"] },
        { ability_id: "oath", name: "Oath", ability_type: "unit", unit_ids: ["templar"] },
        { ability_id: "war-cry", name: "War Cry", ability_type: "faction" },
        { ability_id: "stalwart", name: "Stalwart", ability_type: "core" },
        { ability_id: "unprinted", name: "Unprinted", ability_type: "unit", unit_ids: ["warden"] },
      ],
      "core/alpha/units.json": [
        { id: "warden", external_refs: mfm("ds-warden"), ability_ids: ["grim-resolve", "banner", "stalwart"] },
        { id: "patrol-warden", external_refs: mfm("ds-patrol") },
        { id: "templar", external_refs: mfm("ds-templar") },
      ],
    });
    const prose = new DumpProse({ rows: [
      row("alpha", datasheet("ds-warden", "warden"), "Grim Resolve", { text: "Own resolve text." }),
      // Another faction prints the same name with other words; it is never this ability's prose.
      row("beta", datasheet("ds-beta", "warden"), "Grim Resolve", { text: "Foreign resolve text." }),
      row("alpha", datasheet("ds-warden", "warden"), "Banner", { text: "Codex banner text." }),
      row("alpha", datasheet("ds-patrol", "patrol-warden"), "Banner", { text: "Patrol banner text.", combatPatrol: true }),
      // A supplement's datasheet prints under the supplement's faction while the repo files it under its parent.
      row("gamma", datasheet("ds-templar", "templar"), "Oath", { text: "Supplement oath text." }),
      row("alpha", { kind: "army" }, "War Cry", { kind: "army-rule", text: "Codex war cry." }),
      row("alpha", { kind: "army" }, "War Cry", { kind: "army-rule", text: "Patrol war cry.", combatPatrol: true }),
      row("_core", { kind: "core" }, "Stalwart", { kind: "core-ability", text: "Core stalwart text.", datasheetIds: ["ds-warden"] }),
      // The core rules print the same name twice; the unit's own datasheet decides which.
      row("_core", { kind: "core" }, "Stalwart", { kind: "core-ability", text: "Other stalwart text.", datasheetIds: ["ds-other"] }),
    ], unowned: [] });

    const loaded = loadDumpSourceRecords({ dataRoot: root, prose, dumpPath: "fixture" });
    const text = Object.fromEntries(loaded.records.map((record) => [record.abilityId, record.text]));
    expect(text).toEqual({
      "grim-resolve": "Own resolve text.",
      oath: "Supplement oath text.",
      "war-cry": "Codex war cry.",
      stalwart: "Core stalwart text.",
    });
    // One ability id printing two texts on two datasheets is two records to be (D10), not a pick.
    expect(loaded.conflicts).toEqual([expect.objectContaining({ factionId: "alpha", abilityId: "banner", sourceHashes: [expect.any(String), expect.any(String)] })]);
    expect(loaded.skipped).toEqual([expect.objectContaining({ abilityId: "unprinted", reason: "missing-prose" })]);
    const resolve = loaded.records.find((record) => record.abilityId === "grim-resolve")!;
    expect(resolve).toMatchObject({ sourceKind: "mfm", sourceType: "unit", name: "Grim Resolve", fragments: [{ fragment: "RAW_TEXT", start_byte: 0 }] });
    expect(resolve.metadata.source).toMatchObject({ kind: "mfm", refs: [expect.stringMatching(/^dump\.json#row-/u)] });
  });

  it("reads a core stratagem record with no enrichment record, fragment by fragment, from its own detachment", () => {
    const root = dataRoot({
      "core/alpha/detachments.json": [{ id: "iron-host", detachment_rule_id: "iron-will", external_refs: mfm("det-iron") }, { id: "ash-host", external_refs: mfm("det-ash") }],
      "core/alpha/stratagems.json": [{ id: "hold-fast-iron-host", ability_id: "hold-fast-iron-host", detachment_id: "iron-host" }],
      "core/stratagems.json": [{ id: "second-wind", detachment_id: null }],
    });
    // The dump spells the detachment differently from the repo id; the mfm pin still finds it.
    const prose = new DumpProse({ rows: [
      row("alpha", detachment("det-iron", "the-iron-host"), "Hold Fast", { kind: "stratagem", stratagem: { when: "Your turn.", target: "One unit.", effect: "It holds.", secondaryEffect: "It also rallies." } }),
      row("alpha", detachment("det-ash", "ash-host"), "Hold Fast", { kind: "stratagem", stratagem: { when: "Their turn.", target: "One unit.", effect: "It burns." } }),
      row("alpha", detachment("det-iron", "the-iron-host"), "Iron Will", { kind: "detachment-rule", text: "Iron will text." }),
      row("_core", { kind: "core" }, "Second Wind", { kind: "stratagem", stratagem: { when: "Any phase.", effect: "Breathe." } }),
    ], unowned: [] });

    const loaded = loadDumpSourceRecords({ dataRoot: root, prose, dumpPath: "fixture" });
    expect(loaded.conflicts).toEqual([]);
    const hold = loaded.records.find((record) => record.abilityId === "hold-fast-iron-host")!;
    expect(hold.text).toBe("Your turn.\nOne unit.\nIt holds.\nIt also rallies.");
    expect(hold.fragments.map((fragment) => fragment.fragment)).toEqual(["WHEN", "TARGET", "EFFECT"]);
    expect(hold.fragments[2]!.text).toBe("It holds.\nIt also rallies.");
    expect(loaded.records.find((record) => record.abilityId === "iron-will")).toMatchObject({ factionId: "alpha", text: "Iron will text.", sourceType: "detachment" });
    expect(loaded.records.find((record) => record.abilityId === "second-wind")).toMatchObject({ factionId: "_core", text: "Any phase.\nBreathe." });
  });

  it("refreshes the workbench from the dump by default and from a fixture directory when one is named", () => {
    const root = dataRoot({
      "enrichment/alpha/abilities.json": [{ ability_id: "war-cry", name: "War Cry", ability_type: "faction" }],
    });
    const prose = new DumpProse({ rows: [row("alpha", { kind: "army" }, "War Cry", { kind: "army-rule", text: "Codex war cry." })], unowned: [] });
    const db = openWorkbench(":memory:");
    try {
      expect(refreshSources(db, { dataRoot: root, prose, dumpPath: "fixture" })).toMatchObject({ origin: "dump:fixture", loaded: 1, inserted: 1 });
      expect(db.prepare("SELECT ability_id, source_kind, source_text FROM abilities WHERE current = 1").get()).toEqual({ ability_id: "war-cry", source_kind: "mfm", source_text: "Codex war cry." });
    } finally {
      db.close();
    }
    const fixture = dataRoot({ "alpha.json": [{ ability_id: "war-cry", raw_text: "Fixture war cry." }] });
    process.env.ROUND5C_SOURCE_FIXTURE = fixture;
    expect(loadSourceRecords()).toMatchObject({ origin: fixture, records: [expect.objectContaining({ factionId: "alpha", text: "Fixture war cry." })] });
  });
});
