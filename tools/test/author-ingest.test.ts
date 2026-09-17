import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRawTextIndex,
  ingestFaction,
  ingestSnapshot,
  mergeRawTextRecords,
  projectPhaseMappings,
  projectRawTextRecords,
  type IngestRecord,
  type RawTextRecord,
  type SnapshotManifest,
} from "../src/author-ingest.js";
import { reconcileFaction } from "../src/author-reconcile.js";

const rec = (over: Partial<IngestRecord> & { name: string }): IngestRecord => ({
  faction: "orks",
  raw_text: "GW TEXT — must not leak into the repo",
  ...over,
});

const raw = (ability_id: string, unit_ids: string[], over: Partial<RawTextRecord> = {}): RawTextRecord => ({
  ability_id,
  name: ability_id,
  faction_id: "orks",
  detachment_id: null,
  unit_ids,
  ability_type: "unit",
  game_version: { edition: "11th", dataslate: "launch" },
  source: { kind: "json", ref: "old", phases: null },
  raw_text: `old ${ability_id}`,
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

  it("fills missing detachment ownership without replacing authored mechanics", () => {
    const existing = [
      {
        ability_id: "try-dat-button-dread-mob",
        name: "Try Dat Button!",
        ability_type: "detachment",
        effect: { type: "roll-modifier", target: "unit", modifier: { roll: "hit", operation: "add", value: 1 } },
        scope: { range: "unit", duration: "phase" },
        unit_ids: [],
        game_version: { edition: "11th", dataslate: "codex-orks" },
      },
    ];
    const r = ingestFaction(
      "orks",
      [rec({
        name: "Try Dat Button!",
        ability_id: "try-dat-button-dread-mob",
        ability_type: "detachment",
        detachment_id: "dread-mob",
        unit_ids: [],
      })],
      existing,
      [],
    );
    const ability = r.abilities.find((entry) => entry.ability_id === "try-dat-button-dread-mob")!;
    expect(ability.detachment_id).toBe("dread-mob");
    expect(ability.effect).toEqual(existing[0].effect);
  });

  it("replaces a prior author-input entry for the same id (idempotent re-run)", () => {
    const prior = [{ faction: "orks", ability_id: "waaagh-energy", name: "Waaagh! Energy", unit_ids: [], target: null, scope: null, faction_id: null, ability_type: null, resolved: false, reason: "stale" }];
    const r = ingestFaction("orks", [rec({ name: "Waaagh! Energy", unit_ids: ["weirdboy"] })], [], prior);
    const entries = r.authorInput.filter((e) => e.ability_id === "waaagh-energy");
    expect(entries).toHaveLength(1);
    expect(entries[0].resolved).toBe(true);
  });
});

describe("ingestSnapshot", () => {
  it("removes a stale covered owner while retaining an uncovered shared owner", () => {
    const result = ingestSnapshot({
      records: [{ ...rec({ name: "Current Rule", ability_id: "current-rule", unit_ids: ["covered"], game_version: { edition: "11th", dataslate: "codex-orks" } }) }],
      replace_scope: { faction_id: "orks", game_version: { edition: "11th", dataslate: "codex-orks" }, unit_ids: ["covered"], detachment_ids: ["covered-detachment"] },
    }, [
      { ability_id: "stale-rule", name: "Stale", unit_ids: ["covered"], effect: { type: "stat-modifier", modifier: {} } },
      { ability_id: "shared-rule", name: "Shared", unit_ids: ["covered", "uncovered"], effect: { type: "stat-modifier", modifier: {} } },
    ], [
      { faction: "orks", ability_id: "stale-rule", name: "Stale", unit_ids: ["covered"], target: null, scope: null, faction_id: "orks", ability_type: "unit", resolved: false },
      { faction: "orks", ability_id: "shared-rule", name: "Shared", unit_ids: ["covered", "uncovered"], target: null, scope: null, faction_id: "orks", ability_type: "unit", resolved: false },
    ]);
    expect(result.abilities.map((ability) => ability.ability_id)).toEqual(["shared-rule", "current-rule"]);
    expect(result.abilities[0].unit_ids).toEqual(["uncovered"]);
    expect(result.authorInput.map((entry) => entry.ability_id)).toEqual(["shared-rule", "current-rule"]);
    expect(result.authorInput.find((entry) => entry.ability_id === "shared-rule")?.unit_ids).toEqual(["uncovered"]);
  });


  it("normalizes raw-store metadata after replacing an existing ability", () => {
    const result = ingestSnapshot({
      records: [rec({
        name: "Current Name",
        ability_id: "current",
        ability_type: "unit",
        unit_ids: ["covered"],
        game_version: { edition: "11th", dataslate: "codex-orks" },
      })],
      replace_scope: {
        faction_id: "orks",
        game_version: { edition: "11th", dataslate: "codex-orks" },
        unit_ids: ["covered"],
        detachment_ids: ["old-detachment"],
      },
    }, [{
      ability_id: "current",
      name: "Old Name",
      ability_type: "detachment",
      detachment_id: "old-detachment",
      unit_ids: ["covered"],
      game_version: { edition: "11th", dataslate: "launch" },
      effect: { type: "stat-modifier", modifier: {} },
    }], []);
    expect(result.rawText[0]).toMatchObject({
      name: "Current Name",
      faction_id: "orks",
      detachment_id: null,
      unit_ids: ["covered"],
      ability_type: "unit",
      game_version: { edition: "11th", dataslate: "codex-orks" },
    });
    expect(result.authorInput[0]).toMatchObject({
      name: "Current Name",
      faction_id: "orks",
      unit_ids: ["covered"],
      ability_type: "unit",
    });
  });
  it("replaces mappings for incoming, deleted, and orphaned abilities", () => {
    const manifest: SnapshotManifest = {
      records: [
        rec({ name: "Current", ability_id: "current", phases: ["Movement", "SHOOTING"] }),
        rec({ name: "Phase-less", ability_id: "phase-less", phases: [] }),
        rec({ name: "Omitted", ability_id: "omitted" }),
      ],
      replace_scope: {
        faction_id: "orks",
        game_version: { edition: "11th", dataslate: "codex-orks" },
        unit_ids: ["covered"],
        detachment_ids: ["covered-detachment"],
      },
    };
    const projected = projectPhaseMappings([
      { source_id: "current", source_type: "ability", phases: ["fight"] },
      { source_id: "phase-less", source_type: "ability", phases: ["fight"] },
      { source_id: "omitted", source_type: "ability", phases: ["command"] },
      { source_id: "stale", source_type: "ability", phases: ["charge"] },
      { source_id: "orphan", source_type: "ability", phases: ["command"] },
      { source_id: "other", source_type: "stratagem", phases: ["shooting"] },
    ], manifest, ["stale"], new Set(["current", "phase-less", "omitted"]));
    expect(projected).toEqual([
      { source_id: "other", source_type: "stratagem", phases: ["shooting"] },
      {
        source_id: "current",
        source_type: "ability",
        phases: ["movement", "shooting"],
        game_version: { edition: "11th", dataslate: "codex-orks" },
        authored_by: "40kdc-community",
      },
    ]);
  });

  it("rejects non-canonical phase names", () => {
    const manifest: SnapshotManifest = {
      records: [rec({ name: "Invalid", ability_id: "invalid", phases: ["__proto__"] })],
      replace_scope: {
        faction_id: "orks",
        game_version: { edition: "11th", dataslate: "codex-orks" },
        unit_ids: [],
        detachment_ids: [],
      },
    };
    expect(() => projectPhaseMappings([], manifest, [])).toThrow(/invalid phase/);
  });

  it("replaces raw-store ownership while preserving uncovered owners and source holdovers", () => {
    const manifest: SnapshotManifest = {
      records: [
        rec({ name: "Current", ability_id: "current", unit_ids: ["covered"], game_version: { edition: "11th", dataslate: "codex-orks" } }),
        rec({ name: "Holdover", ability_id: "holdover", unit_ids: ["covered"], raw_text: "", game_version: { edition: "11th", dataslate: "codex-orks" } }),
      ],
      replace_scope: {
        faction_id: "orks",
        game_version: { edition: "11th", dataslate: "codex-orks" },
        unit_ids: ["covered"],
        detachment_ids: ["covered-detachment"],
      },
    };
    const incoming = raw("current", ["covered"], {
      name: "Current",
      game_version: { edition: "11th", dataslate: "codex-orks" },
      raw_text: "current prose",
    });
    const projected = projectRawTextRecords([
      raw("stale", ["covered"]),
      raw("shared", ["covered", "uncovered"]),
      raw("current", ["covered"]),
      raw("holdover", ["covered", "uncovered"]),
      raw("old-detachment", [], { detachment_id: "covered-detachment", ability_type: "detachment" }),
      raw("legacy-covered-detachment", [], { ability_type: "stratagem" }),
    ], [incoming], manifest);
    expect(projected.map((entry) => entry.ability_id)).toEqual(["shared", "current", "holdover"]);
    expect(projected.find((entry) => entry.ability_id === "shared")?.unit_ids).toEqual(["uncovered"]);
    expect(projected.find((entry) => entry.ability_id === "current")?.raw_text).toBe("current prose");
    expect(projected.find((entry) => entry.ability_id === "holdover")).toMatchObject({
      unit_ids: ["uncovered", "covered"],
      game_version: { edition: "11th", dataslate: "codex-orks" },
      raw_text: "old holdover",
    });
  });
});

describe("reconcileFaction", () => {
  it("snapshot-scopes detachment entities while retaining additive unit links", () => {
    const oldVersion = { edition: "11th", dataslate: "pre-launch-provisional" };
    const currentVersion = { edition: "11th", dataslate: "codex-orks" };
    const core = {
      units: [{ id: "dakkajet", game_version: currentVersion, ability_ids: ["curated"] }],
      stratagems: [{
        id: "strafe",
        name: "Strafe",
        detachment_id: "flyboyz",
        game_version: currentVersion,
        ability_id: "stale-link",
      }],
      enhancements: [{
        id: "legacy-upgrade",
        name: "Legacy Upgrade",
        detachment_id: "retired-detachment",
        game_version: currentVersion,
        ability_id: "legacy-upgrade",
      },
      {
        id: "wrong-type-upgrade",
        name: "Wrong Type Upgrade",
        detachment_id: "retired-detachment",
        game_version: currentVersion,
        ability_id: "current-unit-rule",
      },
      {
        id: "wrong-detachment-upgrade",
        name: "Legacy Upgrade",
        detachment_id: "other-detachment",
        game_version: currentVersion,
        ability_id: "legacy-upgrade",
      },
      ],
      detachments: [
        {
          id: "flyboyz",
          game_version: currentVersion,
          detachment_rule_id: "old-rule",
          detachment_rule_ids: ["old-rule"],
        },
        {
          id: "dread-mob",
          game_version: currentVersion,
        },
      ],
    };
    const abilities = [
      {
        ability_id: "old-rule",
        name: "Old Rule",
        ability_type: "detachment",
        detachment_id: "flyboyz",
        game_version: oldVersion,
      },
      {
        ability_id: "skyborne-loons-flyboyz",
        name: "Skyborne Loons",
        ability_type: "detachment",
        detachment_id: "flyboyz",
        game_version: currentVersion,
      },
      {
        ability_id: "old-strafe",
        name: "Strafe",
        ability_type: "stratagem",
        detachment_id: "flyboyz",
        game_version: oldVersion,
      },
      {
        ability_id: "strafe-flyboyz",
        name: "Strafe",
        ability_type: "stratagem",
        detachment_id: "flyboyz",
        game_version: currentVersion,
      },
      {
        ability_id: "try-dat-button-dread-mob",
        name: "Try Dat Button!",
        ability_type: "detachment",
        detachment_id: "dread-mob",
        game_version: oldVersion,
      },
      {
        ability_id: "legacy-upgrade",
        name: "Legacy Upgrade",
        ability_type: "enhancement",
        detachment_id: "retired-detachment",
        game_version: oldVersion,
      },
      {
        ability_id: "old-unit-rule",
        name: "Old Unit Rule",
        ability_type: "unit",
        unit_ids: ["dakkajet"],
        game_version: oldVersion,
      },
      {
        ability_id: "current-unit-rule",
        name: "Current Unit Rule",
        ability_type: "unit",
        unit_ids: ["dakkajet"],
        game_version: currentVersion,
      },
    ];

    const report = reconcileFaction("orks", core, abilities, true);

    expect(core.units[0].ability_ids).toEqual(["curated", "old-unit-rule", "current-unit-rule"]);
    expect(core.stratagems[0].ability_id).toBe("strafe-flyboyz");
    expect(core.detachments[0].detachment_rule_id).toBe("skyborne-loons-flyboyz");
    expect(core.detachments[0].detachment_rule_ids).toEqual(["skyborne-loons-flyboyz"]);
    expect(core.detachments[1].detachment_rule_id).toBe("try-dat-button-dread-mob");
    expect(core.detachments[1].detachment_rule_ids).toEqual(["try-dat-button-dread-mob"]);
    expect(report.enhancements.alreadyLinked).toBe(1);
    expect(report.enhancements.orphanCore).toEqual([
      "wrong-type-upgrade",
      "wrong-detachment-upgrade",
    ]);
    expect(report.detachments.multiRule).toEqual([]);
    expect(report.missingCoreEntities).toEqual([]);
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

describe("buildRawTextIndex", () => {
  it("retains same-id records under their owning factions", () => {
    const store = mkdtempSync(join(tmpdir(), "40kdc-abilities-"));
    try {
      writeFileSync(
        join(store, "orks.json"),
        JSON.stringify([raw("shared-rule", [], { raw_text: "Fabricated Orks rule." })]),
      );
      writeFileSync(
        join(store, "tau-empire.json"),
        JSON.stringify([
          {
            ...raw("shared-rule", [], { raw_text: "Fabricated T'au rule." }),
            faction_id: "tau-empire",
          },
        ]),
      );

      expect(buildRawTextIndex(store)).toMatchObject({
        orks: {
          "shared-rule": { faction: "orks", raw_text: "Fabricated Orks rule." },
        },
        "tau-empire": {
          "shared-rule": {
            faction: "tau-empire",
            raw_text: "Fabricated T'au rule.",
          },
        },
      });
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});
