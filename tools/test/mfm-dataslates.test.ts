import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DATASLATE_BY_DATA_VERSION, gameVersionForDataVersion } from "../src/mfm/dataslate.js";
import { changedKeys, weaponReason } from "../src/mfm/dataslates/evidence.js";
import {
  abilityVerified,
  detachmentRuleIds,
  detachmentVerified,
  stampAction,
  stratagemStructureMatches,
  weaponMatchesMinted,
  type ApprovedEntry,
  type FreshSource,
} from "../src/mfm/dataslates/verdict.js";
import { MfmDump } from "../src/mfm/loader.js";
import { entryWithMechanics } from "../src/semantic-authoring/entries.js";

const NOW = { edition: "11th", dataslate: "mfm-963" };
const ENTRIES = [{ edition: "11th", dataslate: "mfm-963" }];

describe("dump dataslate mapping", () => {
  it("names the game-versions entry of a mapped dump", () => {
    expect(gameVersionForDataVersion(963, ENTRIES)).toEqual(NOW);
    expect(DATASLATE_BY_DATA_VERSION[963]).toBe("mfm-963");
  });

  it("throws for an unknown, absent, or unregistered data_version instead of defaulting", () => {
    expect(() => gameVersionForDataVersion(964, ENTRIES)).toThrow("data_version 964 has no dataslate");
    expect(() => gameVersionForDataVersion(undefined, ENTRIES)).toThrow("no integer metadata.data_version");
    expect(() => gameVersionForDataVersion(963, [])).toThrow("missing from game-versions.json");
  });

  it("is registered in the real game-versions.json", () => {
    expect(gameVersionForDataVersion(963)).toEqual(NOW);
  });
});

describe("stamp actions", () => {
  it("promotes verified records and demotes only dump-confirmed claims that fail", () => {
    expect(stampAction({ edition: "11th", dataslate: "launch" }, true, NOW)).toEqual({ action: "promote", next: NOW });
    expect(stampAction({ edition: "11th", dataslate: "pre-launch-provisional" }, true, NOW)).toEqual({ action: "promote", next: NOW });
    expect(stampAction(NOW, true, NOW)).toEqual({ action: "kept" });
    for (const claimed of ["launch", "codex-orks", "mfm-963"]) {
      expect(stampAction({ edition: "11th", dataslate: claimed }, false, NOW)).toEqual({
        action: "demote",
        next: { edition: "11th", dataslate: "pre-launch-provisional" },
      });
    }
    expect(stampAction({ edition: "11th", dataslate: "pre-launch-provisional" }, false, NOW)).toEqual({ action: "untouched" });
    expect(stampAction({ edition: "10th", dataslate: "2025-q3" }, false, NOW)).toEqual({ action: "untouched" });
    expect(stampAction(undefined, true, NOW)).toEqual({ action: "untouched" });
  });
});

/** One dump weapon with a ranged and a melee profile (BS null on the melee one). */
function weaponDump(): MfmDump {
  const profile = (id: string, order: number, type: string, range: string, ap: string) => ({
    id,
    wargearItemId: "item",
    displayOrder: order,
    type,
    range,
    attacks: "2",
    strength: "4",
    armourPenetration: ap,
    damage: "D3",
    ballisticSkill: type === "melee" ? null : "3+",
    weaponSkill: type === "melee" ? "3+" : null,
    localisations: { en: { name: `fixture ${id}` } },
  });
  return new MfmDump({
    metadata: { data_version: 963 },
    data: {
      wargear_item: [{ id: "item", wargearType: "weapon", localisations: { en: { name: "Fixture Gun" } } }],
      wargear_item_profile: [profile("shot", 1, "ranged", '24"', "-1"), profile("bash", 2, "melee", "Melee", "0")],
      wargear_item_profile_wargear_ability: [{ wargearItemProfileId: "shot", wargearAbilityId: "lethal" }],
      wargear_ability: [{ id: "lethal", localisations: { en: { name: "Lethal Hits" } } }],
    } as never,
  });
}

function weaponRecord(apOfShot: number): Record<string, unknown> {
  return {
    id: "fixture-gun",
    name: "Fixture Gun",
    type: "ranged",
    external_refs: [{ namespace: "mfm", id: "item" }],
    // Stored in the other order, with an explicit null skill: neither decides equality.
    profiles: [
      { name: "bash", range: "Melee", stats: { A: 2, S: 4, AP: 0, D: "D3", WS: 3, BS: null } },
      { name: "shot", range: 24, stats: { A: 2, BS: 3, S: 4, AP: apOfShot, D: "D3" }, keywords: [{ keyword_id: "lethal-hits" }] },
    ],
    game_version: { edition: "11th", dataslate: "launch" },
  };
}

describe("weapon verification", () => {
  it("verifies a weapon equal to its re-minted dump item and demotes one a single stat off", () => {
    const dump = weaponDump();
    expect(weaponReason(dump, weaponRecord(-1), NOW, weaponMatchesMinted)).toBe("verified");
    const off = weaponReason(dump, weaponRecord(-2), NOW, weaponMatchesMinted);
    expect(off).toBe("differs");
    expect(stampAction({ edition: "11th", dataslate: "launch" }, off === "verified", NOW).action).toBe("demote");
  });

  it("does not verify a weapon without a live dump ref", () => {
    const dump = weaponDump();
    expect(weaponReason(dump, { ...weaponRecord(-1), external_refs: [] }, NOW, weaponMatchesMinted)).toBe("no-ref");
    expect(weaponReason(dump, { ...weaponRecord(-1), external_refs: [{ namespace: "mfm", id: "gone" }] }, NOW, weaponMatchesMinted)).toBe("dangling-ref");
  });

  it("treats a lost keyword as a difference", () => {
    const record = weaponRecord(-1);
    const shot = (record.profiles as Array<Record<string, unknown>>)[1]!;
    delete shot.keywords;
    expect(weaponReason(weaponDump(), record, NOW, weaponMatchesMinted)).toBe("differs");
  });
});

describe("ability verification", () => {
  const mechanics = {
    effect: { type: "stat-modifier", target: "this-model", modifier: { stat: "M", operation: "add", value: 1 } },
    scope: { duration: "permanent" },
    behavior: "passive",
    trigger: null,
    usage: null,
    applies_to: null,
  };
  const base = { ability_id: "fixture", name: "Fixture", authored_by: "40kdc-community", ability_type: "unit", game_version: { edition: "11th", dataslate: "launch" } };
  const fresh: FreshSource = { digest: "d1", sourceHash: "s1", matchHash: "m1" };
  const entry: ApprovedEntry = { inputsCurrent: true, sourceHash: "s1", matchHash: "m1", mechanics };
  const published = { ...entryWithMechanics(base, mechanics as never), source_digest: "d1" };
  const verify = (record: Record<string, unknown>, entries: ApprovedEntry[] = [entry], source: FreshSource | null = fresh) =>
    abilityVerified(record, source, entries, entryWithMechanics as never);

  it("verifies a record published from a current approved entry over the dump's prose", () => {
    expect(verify(published)).toBe(true);
  });

  it("never verifies a stub, even one carrying the current digest and an approved entry", () => {
    expect(verify({ ...published, stub: true })).toBe(false);
  });

  it("fails on a stale digest, a moved source, stale leaves, unpublished mechanics, or no prose", () => {
    expect(verify({ ...published, source_digest: "d0" })).toBe(false);
    expect(verify(published, [{ ...entry, sourceHash: "s0" }])).toBe(false);
    expect(verify(published, [{ ...entry, inputsCurrent: false }])).toBe(false);
    expect(verify({ ...published, behavior: "reactive" })).toBe(false);
    expect(verify(published, [])).toBe(false);
    expect(verify(published, [entry], null)).toBe(false);
  });
});

describe("detachment and stratagem verification", () => {
  it("keeps a detachment provisional while any one of its rules is unverified", () => {
    const record = { detachment_rule_id: "rule-a", detachment_rule_ids: ["rule-a", "rule-b"] };
    expect(detachmentRuleIds(record)).toEqual(["rule-a", "rule-b"]);
    expect(detachmentVerified(true, detachmentRuleIds(record), (id) => id === "rule-a")).toBe(false);
    expect(detachmentVerified(true, detachmentRuleIds(record), () => true)).toBe(true);
    expect(detachmentVerified(false, detachmentRuleIds(record), () => true)).toBe(false);
    expect(detachmentVerified(true, [], () => true)).toBe(false);
  });

  it("matches stratagem structure field by field against the dump", () => {
    const dump = { cp_cost: 1, player_turn: "either", type: null, category: "detachment", phases_review: ["fight", "shooting"] };
    const record = { cp_cost: 1, player_turn: "either", type: "battle-tactic", category: "detachment", phases: ["shooting", "fight"] };
    expect(stratagemStructureMatches(record, dump)).toBe(true);
    expect(stratagemStructureMatches({ ...record, cp_cost: 2 }, dump)).toBe(false);
    expect(stratagemStructureMatches({ ...record, phases: ["shooting"] }, dump)).toBe(false);
    expect(stratagemStructureMatches({ ...record, type: "epic-deed" }, { ...dump, type: "battle-tactic" })).toBe(false);
    expect(stratagemStructureMatches({ ...record, phases: [] }, { ...dump, phases_review: null })).toBe(true);
  });
});

describe("pass projections", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("reports the keys a staged projection changes, ignoring game_version", () => {
    const directory = mkdtempSync(join(tmpdir(), "dataslates-"));
    directories.push(directory);
    const file = join(directory, "unit-compositions.json");
    const stamp = { edition: "11th", dataslate: "launch" };
    writeFileSync(file, JSON.stringify([{ unit_id: "a", models: [1], game_version: stamp }, { unit_id: "b", models: [1], game_version: stamp }, { unit_id: "c", models: [1] }]));
    const staged = [{ path: file, value: [{ unit_id: "a", models: [1], game_version: NOW }, { unit_id: "b", models: [2], game_version: stamp }, { unit_id: "d", models: [1] }] }];
    const unitId = (record: Record<string, unknown>) => String(record.unit_id);
    expect([...changedKeys(staged, file, unitId)].sort()).toEqual(["b", "c", "d"]);
    expect(changedKeys([], file, unitId).size).toBe(0);
  });
});
