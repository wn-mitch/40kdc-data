import { describe, expect, it } from "vitest";
import {
  authorManifest,
  projectInventory,
  reconciliationReport,
  validateInventory,
  type CodexInventory,
} from "../src/import-codex-core.js";

type Current = Parameters<typeof projectInventory>[1];
const version = { edition: "11th", dataslate: "codex-orks" };
const source = { id: "source-01", path: "source-images/source-01.png", page: 1, sha256: "a".repeat(64) };

function fields(names: readonly string[]) {
  return Object.fromEntries(names.map((name) => [name, { status: "exact", source_ref: source.id, evidence_region: name }])) as Record<string, { status: "exact"; source_ref: string; evidence_region: string }>;
}

function inventory(): CodexInventory {
  return {
    faction_id: "orks",
    game_version: version,
    source_revision: 1,
    sources: [source],
    coverage: { unit_ids: ["covered"], detachment_ids: ["detachment"] },
    reviews: [
      { kind: "unit", id: "covered", source_refs: [source.id], fields: fields(["profile", "invulnerable_save", "weapons", "core_labels", "army_rules", "named_abilities", "wargear_options", "composition", "default_equipment", "transport_capacity", "keywords", "attachment_role", "eligible_bodyguards", "points", "base_size"]) },
      { kind: "detachment", id: "detachment", source_refs: [source.id], fields: fields(["metadata", "detachment_rule", "enhancements", "stratagems"]) },
      { kind: "faction", id: "orks", source_refs: [source.id], fields: fields(["army_rule"]) },
    ],
    entities: {
      factions: [{ id: "orks", game_version: version }],
      units: [{ id: "covered", weapon_ids: ["new-weapon"], ability_ids: ["new-rule"], game_version: version }],
      weapons: [{ id: "new-weapon", game_version: version }],
      unit_compositions: [{ unit_id: "covered", models: [{ name: "Covered", default_weapon_ids: ["new-weapon"] }], game_version: version }],
      wargear: [],
      wargear_options: [{ unit_id: "covered", id: "new-option", game_version: version }],
      leader_attachments: [],
      detachments: [{
        id: "detachment",
        detachment_rule_ids: ["detachment-rule"],
        enhancement_ids: ["new-enhancement"],
        stratagem_ids: ["new-stratagem"],
        game_version: version,
      }],
      enhancements: [{ id: "new-enhancement", detachment_id: "detachment", ability_id: "new-enhancement-rule", game_version: version }],
      stratagems: [{ id: "new-stratagem", detachment_id: "detachment", ability_id: "new-stratagem-rule", game_version: version }],
    },
    abilities: [
      { ability_id: "new-rule", source_kind: "image", raw_text: "Private source prose" },
      { ability_id: "detachment-rule", source_kind: "image", raw_text: "Private source prose" },
      { ability_id: "new-enhancement-rule", source_kind: "image", raw_text: "Private source prose" },
      { ability_id: "new-stratagem-rule", source_kind: "image", raw_text: "Private source prose" },
    ],
    retire: {},
  };
}

function current(): Current {
  return {
    factions: [{ id: "orks", game_version: version }],
    units: [
      { id: "covered", weapon_ids: ["old-weapon"], ability_ids: ["old-rule"], game_version: { edition: "11th", dataslate: "launch" } },
      { id: "uncovered", weapon_ids: ["uncovered-weapon"], ability_ids: ["uncovered-rule"], game_version: version },
    ],
    weapons: [{ id: "old-weapon", game_version: version }, { id: "uncovered-weapon", game_version: version }],
    unit_compositions: [
      { unit_id: "covered", models: [{ name: "Old", default_weapon_ids: ["old-weapon"] }], game_version: version },
      { unit_id: "uncovered", models: [{ name: "Uncovered", default_weapon_ids: ["uncovered-weapon"] }], game_version: version },
    ],
    wargear: [],
    wargear_options: [{ unit_id: "covered", id: "old-option", game_version: version }, { unit_id: "uncovered", id: "uncovered-option", game_version: version }],
    leader_attachments: [{ leader_id: "covered", bodyguard_unit_ids: ["uncovered"], game_version: version }],
    detachments: [{ id: "detachment", game_version: { edition: "11th", dataslate: "launch" } }, { id: "uncovered-detachment", game_version: version }],
    enhancements: [{ id: "old-enhancement", detachment_id: "detachment", game_version: version }, { id: "uncovered-enhancement", detachment_id: "uncovered-detachment", game_version: version }],
    stratagems: [{ id: "old-stratagem", detachment_id: "detachment", game_version: version }, { id: "uncovered-stratagem", detachment_id: "uncovered-detachment", game_version: version }],
  };
}

describe("Codex inventory validation", () => {
  it("rejects a review that omits a required source field", () => {
    const malformed = inventory();
    delete malformed.reviews[0].fields.default_equipment;
    expect(() => validateInventory(malformed)).toThrow(/omits required field: default_equipment/);
  });

  it("rejects incompatible duplicate source entities", () => {
    const malformed = inventory();
    malformed.entities.weapons.push({ id: "new-weapon", game_version: { edition: "11th", dataslate: "launch" } });
    expect(() => validateInventory(malformed)).toThrow(/conflicting duplicate ids/);
  });

  it("rejects covered detachment entities outside the reviewed roster", () => {
    const malformed = inventory();
    malformed.entities.stratagems.push({
      id: "old-stratagem",
      detachment_id: "detachment",
      ability_id: "old-stratagem-rule",
      game_version: version,
    });
    malformed.abilities.push({ ability_id: "old-stratagem-rule", source_kind: "image", raw_text: "Private source prose" });
    expect(() => validateInventory(malformed)).toThrow(/stratagem roster mismatch/);
  });

  it("rejects covered detachment entities without a resolvable ability", () => {
    const malformed = inventory();
    malformed.entities.stratagems[0].ability_id = "missing-stratagem-rule";
    expect(() => validateInventory(malformed)).toThrow(/unresolved stratagem ability/);
  });

  it("emits only source records and an explicit replacement scope for authoring", () => {
    const manifest = authorManifest(inventory());
    expect(manifest.replace_scope).toEqual({ faction_id: "orks", game_version: version, unit_ids: ["covered"], detachment_ids: ["detachment"] });
    expect(manifest.records).toHaveLength(4);
  });
});

describe("Codex snapshot projection", () => {
  it("replaces every exactly reviewed composite record", () => {
    const projected = projectInventory(inventory(), current());
    expect(projected.units.map((unit) => unit.id)).toEqual(["uncovered", "covered"]);
    expect(projected.units.find((unit) => unit.id === "covered")?.weapon_ids).toEqual(["new-weapon"]);
    expect(projected.unit_compositions.map((row) => row.unit_id)).toEqual(["uncovered", "covered"]);
    expect(projected.wargear_options.map((row) => row.id)).toEqual(["uncovered-option", "new-option"]);
    expect(projected.enhancements.map((row) => row.id)).toEqual(["uncovered-enhancement", "new-enhancement"]);
    expect(projected.stratagems.map((row) => row.id)).toEqual(["uncovered-stratagem", "new-stratagem"]);
    expect(projected.leader_attachments).toEqual([]);
  });


  it("preserves current attachment eligibility when the source field is blocked", () => {
    const sourceInventory = inventory();
    sourceInventory.reviews[0].fields.eligible_bodyguards.status = "blocked-source";
    sourceInventory.entities.leader_attachments = [{
      leader_id: "covered",
      bodyguard_unit_ids: ["guessed"],
      game_version: version,
    }];
    const projected = projectInventory(sourceInventory, current());
    expect(projected.leader_attachments).toEqual(current().leader_attachments);
  });

  it("preserves current detachment rosters when their source fields are blocked", () => {
    const sourceInventory = inventory();
    sourceInventory.reviews[1].fields.enhancements.status = "blocked-source";
    sourceInventory.reviews[1].fields.stratagems.status = "blocked-source";
    const projected = projectInventory(sourceInventory, current());
    expect(projected.enhancements).toEqual(current().enhancements);
    expect(projected.stratagems).toEqual(current().stratagems);
    const detachment = projected.detachments.find((row) => row.id === "detachment");
    expect(detachment).toMatchObject({ id: "detachment", detachment_rule_ids: ["detachment-rule"], game_version: version });
    expect(detachment?.enhancement_ids).toBeUndefined();
    expect(detachment?.stratagem_ids).toBeUndefined();
  });

  it("clears blocked roster fields for a new detachment with no current state", () => {
    const sourceInventory = inventory();
    sourceInventory.reviews[1].fields.enhancements.status = "blocked-source";
    sourceInventory.reviews[1].fields.stratagems.status = "blocked-source";
    const currentState = current();
    currentState.detachments = currentState.detachments.filter((row) => row.id !== "detachment");
    currentState.enhancements = currentState.enhancements.filter((row) => row.detachment_id !== "detachment");
    currentState.stratagems = currentState.stratagems.filter((row) => row.detachment_id !== "detachment");
    const projected = projectInventory(sourceInventory, currentState);
    const detachment = projected.detachments.find((row) => row.id === "detachment");
    expect(detachment?.enhancement_ids).toBeUndefined();
    expect(detachment?.stratagem_ids).toBeUndefined();
    expect(projected.enhancements).toEqual(currentState.enhancements);
    expect(projected.stratagems).toEqual(currentState.stratagems);
  });
  it("refuses retirement while any projected record still references the id", () => {
    const sourceInventory = inventory();
    sourceInventory.entities.units[0].weapon_ids = ["retired-weapon"];
    sourceInventory.entities.weapons = [{ id: "retired-weapon", game_version: version }];
    sourceInventory.entities.unit_compositions[0].models[0].default_weapon_ids = ["retired-weapon"];
    sourceInventory.retire = { weapons: ["retired-weapon"] };
    expect(() => projectInventory(sourceInventory, current())).toThrow(/cannot retire weapons:retired-weapon/);
  });

  it("reports all five reconciliation buckets and blocks source gaps explicitly", () => {
    const sourceInventory = inventory();
    sourceInventory.reviews[0].fields.eligible_bodyguards.status = "blocked-source";
    const report = reconciliationReport(sourceInventory, current());
    expect(Object.keys(report.buckets)).toEqual(["current", "update", "missing-repository", "repository-only", "blocked-source"]);
    expect(report.buckets["blocked-source"]).toContainEqual({ kind: "unit", id: "covered", field: "eligible_bodyguards" });
    expect(report.buckets.update).toContainEqual({ entity: "units", id: "covered" });
    expect(report.buckets["repository-only"]).toContainEqual({ entity: "units", id: "uncovered" });
  });
});
