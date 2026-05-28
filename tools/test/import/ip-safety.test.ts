import { describe, it, expect } from "vitest";
import { importRoster } from "../../src/import/import-roster.js";

/**
 * Regression guard for the project's IP rule: the importer must never carry
 * reproduced rules/ability prose into its output. We feed a payload whose
 * `rules[].description` and ability `$text` fields contain unmistakable canary
 * strings, then assert none survive into the serialized roster.
 */
const CANARIES = [
  "CANARY_RULE_DESCRIPTION_SHOULD_NOT_APPEAR",
  "CANARY_ABILITY_TEXT_SHOULD_NOT_APPEAR",
  "CANARY_PROFILE_CHARACTERISTIC_TEXT",
];

const payloadWithProse = {
  name: "Prose Test",
  generatedBy: "List Forge",
  roster: {
    name: "Prose Test",
    costs: [{ name: "pts", value: 90 }],
    forces: [
      {
        id: "f1",
        name: "Army Roster",
        selections: [
          {
            id: "u-crowe",
            name: "Castellan Crowe",
            type: "model",
            number: 1,
            categories: [{ name: "Faction: Grey Knights" }, { name: "Character" }],
            costs: [{ name: "pts", value: 90 }],
            rules: [
              { id: "r1", name: "Deep Strike", description: CANARIES[0], hidden: false },
            ],
            profiles: [
              {
                id: "p1",
                name: "Some Ability",
                typeName: "Abilities",
                characteristics: [
                  { name: "Description", $text: CANARIES[1] },
                ],
              },
              {
                id: "p2",
                name: "Storm bolter",
                typeName: "Ranged Weapons",
                characteristics: [{ name: "Keywords", $text: CANARIES[2] }],
              },
            ],
            selections: [
              {
                id: "w1",
                name: "Storm bolter",
                type: "upgrade",
                number: 1,
                categories: [{ name: "Ranged Weapon" }],
                rules: [{ id: "r2", name: "Rapid Fire", description: CANARIES[0] }],
              },
            ],
          },
        ],
      },
    ],
  },
};

describe("IP safety", () => {
  it("never emits reproduced rules or ability prose", () => {
    const roster = importRoster(payloadWithProse);
    const serialized = JSON.stringify(roster);
    for (const canary of CANARIES) {
      expect(serialized).not.toContain(canary);
    }
  });

  it("still resolves the unit despite the prose-laden payload", () => {
    const roster = importRoster(payloadWithProse);
    expect(roster.units[0]?.ref.id).toBe("castellan-crowe");
  });
});
