import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { Dataset } from "../src/data/dataset.js";
import { checkGameModeStamps, gameModeDrift, stampGameModes, type FactionCore } from "../src/game-mode-stamps.js";
import type { ValidationResult } from "../src/validate.js";

// Fabricated identities; no rules text.

const CP = ["combat-patrol"];
const BOTH = ["matched-play", "combat-patrol"];

function fixture(): FactionCore {
  return {
    units: [
      { id: "gloom-warden", weapon_ids: ["fizz-blade", "shared-pistol"] },
      { id: "patrol-warden", game_modes: CP, weapon_ids: ["patrol-lance", "shared-pistol"] },
    ],
    weapons: [
      { id: "fizz-blade" },
      { id: "shared-pistol" },
      { id: "patrol-lance" },
      { id: "patrol-swap" },
      { id: "patrol-default" },
      { id: "stale-blade", game_modes: CP },
      { id: "unused-relic", game_modes: CP },
    ],
    wargearOptions: [
      { id: "warden-swap", unit_id: "gloom-warden", replaces: ["fizz-blade"], replacement: ["stale-blade"] },
      { id: "patrol-option", unit_id: "patrol-warden", replaces: ["patrol-lance"], replacement_choice: [["patrol-swap"]] },
    ],
    compositions: [{ unit_id: "patrol-warden", models: [{ name: "Warden", default_weapon_ids: ["patrol-default"] }] }],
    detachments: [{ id: "gloom-host" }, { id: "patrol-host", game_modes: CP }],
    stratagems: [
      { id: "gloom-trick", detachment_id: "gloom-host" },
      { id: "patrol-trick", detachment_id: "patrol-host" },
      { id: "orphan-trick", detachment_id: "no-such-host", game_modes: CP },
    ],
  };
}

const modes = (records: FactionCore[keyof FactionCore], id: string) => records?.find((record) => record.id === id)?.game_modes;

describe("stampGameModes", () => {
  const core = fixture();
  const changed = stampGameModes(core);

  it("puts a Combat Patrol unit's own weapons, options and default weapons in Combat Patrol only", () => {
    expect(modes(core.weapons, "patrol-lance")).toEqual(CP);
    expect(modes(core.weapons, "patrol-swap")).toEqual(CP);
    expect(modes(core.weapons, "patrol-default")).toEqual(CP);
    expect(modes(core.wargearOptions, "patrol-option")).toEqual(CP);
  });

  it("lists a weapon both modes' units carry in both, in schema order", () => {
    expect(modes(core.weapons, "shared-pistol")).toEqual(BOTH);
  });

  it("leaves a matched-play record without game_modes and clears a stale stamp", () => {
    expect(core.weapons!.find((weapon) => weapon.id === "fizz-blade")).not.toHaveProperty("game_modes");
    // Taken only through a matched-play unit's option ("replacement").
    expect(core.weapons!.find((weapon) => weapon.id === "stale-blade")).not.toHaveProperty("game_modes");
    expect(core.wargearOptions!.find((option) => option.id === "warden-swap")).not.toHaveProperty("game_modes");
  });

  it("puts a stratagem in its detachment's modes", () => {
    expect(modes(core.stratagems, "patrol-trick")).toEqual(CP);
    expect(core.stratagems!.find((stratagem) => stratagem.id === "gloom-trick")).not.toHaveProperty("game_modes");
  });

  it("keeps what an unused record has", () => {
    expect(modes(core.weapons, "unused-relic")).toEqual(CP);
    expect(modes(core.stratagems, "orphan-trick")).toEqual(CP);
  });

  it("reports the collections it changed, and nothing drifts after", () => {
    expect([...changed].sort()).toEqual(["stratagems", "wargearOptions", "weapons"]);
    expect(gameModeDrift(core)).toEqual([]);
    expect(stampGameModes(core).size).toBe(0);
  });

  it("reports each drifting record before stamping", () => {
    expect(gameModeDrift(fixture()).map((drift) => `${drift.collection}:${drift.id}:${drift.derived.join("+")}`).sort()).toEqual([
      "stratagems:patrol-trick:combat-patrol",
      "wargearOptions:patrol-option:combat-patrol",
      "weapons:patrol-default:combat-patrol",
      "weapons:patrol-lance:combat-patrol",
      "weapons:patrol-swap:combat-patrol",
      "weapons:shared-pistol:matched-play+combat-patrol",
      "weapons:stale-blade:matched-play",
    ]);
  });
});

describe("checkGameModeStamps", () => {
  it("fails validation on a stamp that drifts, naming the file and record", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "game-mode-stamps-"));
    try {
      const dir = path.join(root, "core", "gloom");
      fs.mkdirSync(dir, { recursive: true });
      const core = fixture();
      for (const [file, records] of [["units.json", core.units], ["weapons.json", core.weapons], ["detachments.json", core.detachments], ["stratagems.json", core.stratagems]] as const) {
        fs.writeFileSync(path.join(dir, file), JSON.stringify(records));
      }
      const result: ValidationResult = { totalFiles: 0, totalItems: 0, passed: 0, failed: 0, errors: [] };
      checkGameModeStamps(root, result);
      const flagged = result.errors.map((error) => `${path.basename(error.file)}#${error.index}`);
      expect(flagged).toEqual(expect.arrayContaining(["weapons.json#2", "stratagems.json#1"]));
      expect(result.failed).toBe(result.errors.length);
      expect(result.errors[0]!.errors[0]!.message).toMatch(/stamp:game-modes/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("game-mode views list only their own records (embedded dataset)", () => {
  const all = Dataset.embedded().forGameMode("all");
  for (const mode of ["matched-play", "combat-patrol"] as const) {
    const view = all.forGameMode(mode);
    const units = new Set(view.units.all.map((unit) => `${unit.raw.faction_id}::${unit.id}`));
    const detachments = new Set(view.detachments.all.map((detachment) => detachment.id));

    it(`${mode}: every listed stratagem's detachment is listed, and every listed detachment's stratagems are`, () => {
      const listed = new Set(view.stratagems.all.map((stratagem) => stratagem.id));
      // Core Stratagems (Command Re-roll) belong to no detachment.
      expect(view.stratagems.all.filter((stratagem) => stratagem.detachment_id && !detachments.has(stratagem.detachment_id)).map((stratagem) => stratagem.id)).toEqual([]);
      const missing = view.detachments.all.flatMap((detachment) => (detachment.stratagem_ids ?? []).filter((id) => all.stratagems.get(id) && !listed.has(id)));
      expect(missing).toEqual([]);
    });

    it(`${mode}: every listed wargear option's unit is listed`, () => {
      const orphaned = view.wargearOptions.all.filter((option) => !units.has(`${option.faction_id}::${option.unit_id}`));
      expect(orphaned.map((option) => option.id)).toEqual([]);
    });

    it(`${mode}: every weapon a listed unit carries is listed`, () => {
      const missing = view.units.all.flatMap((unit) => (unit.raw.weapon_ids ?? [])
        .filter((id) => all.weapons.getInFaction(id, unit.raw.faction_id) && !view.weapons.getInFaction(id, unit.raw.faction_id)?.raw)
        .map((id) => `${unit.id}:${id}`));
      expect(missing).toEqual([]);
    });

    it(`${mode}: every listed enhancement's detachment is listed`, () => {
      const orphaned = view.enhancements.all.filter((enhancement) => enhancement.detachment_id && !detachments.has(enhancement.detachment_id));
      expect(orphaned.map((enhancement) => enhancement.id)).toEqual([]);
    });
  }

  it("matched-play lists no weapon only Combat Patrol units carry", () => {
    const patrolOnly = all.weapons.all.filter((weapon) => JSON.stringify(weapon.raw.game_modes) === JSON.stringify(CP));
    expect(patrolOnly.length).toBeGreaterThan(0);
    const matched = Dataset.embedded();
    expect(patrolOnly.filter((weapon) => matched.weapons.byFaction(weapon.raw.faction_id ?? "").some((listed) => listed.id === weapon.id && listed.raw === weapon.raw))).toEqual([]);
  });
});
