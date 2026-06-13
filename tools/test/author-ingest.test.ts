import { describe, expect, it } from "vitest";
import { ingestFaction, mergeRawTextRecords, type IngestRecord, type RawTextRecord } from "../src/author-ingest.js";

const rec = (over: Partial<IngestRecord> & { name: string }): IngestRecord => ({
  faction: "orks",
  raw_text: "GW TEXT — must not leak into the repo",
  ...over,
});

describe("ingestFaction", () => {
  it("seeds a stub, a resolved author-input entry, and a raw-text record", () => {
    const r = ingestFaction("orks", [rec({ name: "Waaagh! Energy", unit_ids: ["weirdboy"] })], [], []);

    expect(r.created).toBe(1);
    const stub = r.abilities.find((a) => a.ability_id === "waaagh-energy");
    expect(stub).toBeDefined();
    expect(stub.unit_ids).toEqual(["weirdboy"]);
    expect(stub.effect).toEqual({ type: "stat-modifier", target: "unit", modifier: {} });

    const input = r.authorInput.find((e) => e.ability_id === "waaagh-energy")!;
    expect(input.resolved).toBe(true);
    expect(input.src?.description).toBe("GW TEXT — must not leak into the repo");

    expect(r.rawText).toHaveLength(1);
    expect(r.rawText[0]).toMatchObject({ ability_id: "waaagh-energy", faction_id: "orks" });
    expect(r.rawText[0].raw_text).toContain("GW TEXT");

    // IP guard: raw text must NEVER appear in committed enrichment data.
    expect(JSON.stringify(r.abilities)).not.toContain("GW TEXT");
    for (const a of r.abilities) expect(a).not.toHaveProperty("description");
  });

  it("merges two units sharing an ability into one stub (no duplicate id)", () => {
    const r = ingestFaction(
      "orks",
      [
        rec({ name: "Deep Strike", unit_ids: ["trygon"] }),
        rec({ name: "Deep Strike", unit_ids: ["mucolid-spores"] }),
      ],
      [],
      [],
    );
    expect(r.created).toBe(1);
    expect(r.mergedUnits).toBe(1);
    const ds = r.abilities.filter((a) => a.ability_id === "deep-strike");
    expect(ds).toHaveLength(1);
    expect(ds[0].unit_ids).toEqual(["trygon", "mucolid-spores"]);
  });

  it("leaves a record with empty raw_text unresolved (seeded, skipped by propose)", () => {
    const r = ingestFaction("orks", [rec({ name: "Mystery Power", raw_text: "   " })], [], []);
    expect(r.created).toBe(1); // stub still seeded
    expect(r.rawText).toHaveLength(0); // nothing to store
    const input = r.authorInput.find((e) => e.ability_id === "mystery-power")!;
    expect(input.resolved).toBe(false);
    expect(input.src).toBeUndefined();
    expect(r.unresolved).toContainEqual({ ability_id: "mystery-power", name: "Mystery Power", reason: "no raw_text provided" });
  });

  it("honors ability_type, behavior, and faction_id on the seeded stub", () => {
    const r = ingestFaction(
      "orks",
      [rec({ name: "Waaagh", ability_type: "faction", behavior: "aura", faction_id: "orks", unit_ids: [] })],
      [],
      [],
    );
    const stub = r.abilities.find((a) => a.ability_id === "waaagh")!;
    expect(stub.ability_type).toBe("faction");
    expect(stub.behavior).toBe("aura");
    expect(stub.faction_id).toBe("orks");
  });

  it("carries detachment_id into the raw-text record as a top-level field", () => {
    const r = ingestFaction(
      "adeptus-custodes",
      [rec({ faction: "adeptus-custodes", name: "March of the Honoured Dead", ability_type: "detachment", detachment_id: "might-of-the-moritoi", unit_ids: [] })],
      [],
      [],
    );
    expect(r.rawText[0].detachment_id).toBe("might-of-the-moritoi");
    expect(r.rawText[0].unit_ids).toEqual([]);
  });

  it("merges into an authored (non-stub) entry additively and flags it for review", () => {
    const existing = [
      {
        ability_id: "deep-strike",
        name: "Deep Strike",
        ability_type: "core",
        effect: { type: "deep-strike", target: "unit", modifier: {} },
        scope: { range: "unit", duration: "permanent" },
        unit_ids: ["curated-unit"],
        game_version: { edition: "11th", dataslate: "x" },
      },
    ];
    // deep-strike's effect is a PARAMETERLESS leaf → not an empty-modifier stub.
    const r = ingestFaction("orks", [rec({ name: "Deep Strike", unit_ids: ["trygon"] })], existing, []);
    expect(r.mergedIntoAuthored).toContainEqual({ ability_id: "deep-strike", unit_id: "trygon" });
    const ds = r.abilities.find((a) => a.ability_id === "deep-strike")!;
    expect(ds.unit_ids).toEqual(["curated-unit", "trygon"]); // additive
    expect(ds.effect.type).toBe("deep-strike"); // untouched
  });

  it("replaces a prior author-input entry for the same id (idempotent re-run)", () => {
    const prior = [{ faction: "orks", ability_id: "waaagh-energy", name: "Waaagh! Energy", unit_ids: [], target: null, scope: null, faction_id: null, ability_type: null, resolved: false, reason: "stale" }];
    const r = ingestFaction("orks", [rec({ name: "Waaagh! Energy", unit_ids: ["weirdboy"] })], [], prior);
    const entries = r.authorInput.filter((e) => e.ability_id === "waaagh-energy");
    expect(entries).toHaveLength(1);
    expect(entries[0].resolved).toBe(true);
  });
});

describe("mergeRawTextRecords (non-destructive store writes)", () => {
  const rt = (id: string, text: string): RawTextRecord => ({
    ability_id: id, name: id, faction_id: "orks", detachment_id: null, unit_ids: [], ability_type: "unit",
    game_version: { edition: "11th", dataslate: "x" }, source: { kind: "json", ref: "", phases: null }, raw_text: text,
  });

  it("preserves every existing entry and appends new abilities", () => {
    const out = mergeRawTextRecords([rt("a", "AAA"), rt("b", "BBB")], [rt("c", "CCC")]);
    expect(out.map((r) => r.ability_id)).toEqual(["a", "b", "c"]);
    expect(out.find((r) => r.ability_id === "a")!.raw_text).toBe("AAA"); // untouched
    expect(out.find((r) => r.ability_id === "b")!.raw_text).toBe("BBB"); // untouched
  });

  it("updates an existing ability_id in place without dropping or duplicating others", () => {
    const out = mergeRawTextRecords([rt("a", "old"), rt("b", "BBB")], [rt("a", "new")]);
    expect(out.map((r) => r.ability_id)).toEqual(["a", "b"]); // no duplicate, b preserved
    expect(out.find((r) => r.ability_id === "a")!.raw_text).toBe("new");
  });

  it("never deletes: incoming empty leaves the store intact", () => {
    const existing = [rt("a", "AAA"), rt("b", "BBB")];
    expect(mergeRawTextRecords(existing, [])).toEqual(existing);
  });
});
