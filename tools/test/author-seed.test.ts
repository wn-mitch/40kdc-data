import { describe, expect, it } from "vitest";
import { kebab, seedFaction } from "../src/author-seed.js";
import type { ArchiveIndex } from "../src/author-input.js";

// Fake archive: a "Land Raider" datasheet carrying two abilities, and a C'tan
// that resolves to no datasheet (the selectable-power-pool case).
const archive: ArchiveIndex = {
  factionCode: (k) => (k === "necrons" ? "NEC" : undefined),
  datasheetsFor: (unitName, code) =>
    unitName.toLowerCase() === "land raider" && code === "NEC" ? ["ds-lr"] : [],
  ruleFor: () => undefined,
  abilitiesFor: (dsId) =>
    dsId === "ds-lr"
      ? [
          ["Explodes", { src_type: "Other", parameter: "D6", phases: null, description: "GW TEXT — must not leak" }],
          ["Assault Ramp", { src_type: "Other", parameter: null, phases: ["Charge"], description: "GW TEXT — must not leak" }],
        ]
      : [],
  factionRuleFor: () => undefined,
};

describe("kebab", () => {
  it("slugs names to the entity-id pattern", () => {
    expect(kebab("Feel No Pain 5+")).toBe("feel-no-pain-5");
    expect(kebab("An'ggrath the Unbound")).toBe("anggrath-the-unbound");
    expect(kebab("Explodes")).toBe("explodes");
  });
});

describe("seedFaction", () => {
  it("creates a marked no-effect stub per datasheet ability, with no source text", () => {
    const r = seedFaction("necrons", archive, [{ id: "land-raider", name: "Land Raider" }], []);
    expect(r.created).toBe(2);
    const explodes = r.abilities.find((a) => a.ability_id === "explodes");
    expect(explodes).toBeDefined();
    expect(explodes.unit_ids).toEqual(["land-raider"]);
    expect(explodes.effect).toEqual({ type: "no-effect" });
    expect(explodes.stub).toBe(true);
    expect(explodes.scope).toEqual({ duration: "permanent" });
    // IP guard: the archive description must never be written to the repo.
    expect(JSON.stringify(r.abilities)).not.toContain("GW TEXT");
    for (const a of r.abilities) expect(a).not.toHaveProperty("description");
  });

  it("merges two units sharing an ability into one stub's unit_ids", () => {
    const r = seedFaction(
      "necrons",
      archive,
      [
        { id: "land-raider", name: "Land Raider" },
        { id: "land-raider-2", name: "Land Raider" },
      ],
      [],
    );
    expect(r.created).toBe(2); // explodes + assault-ramp, created once
    expect(r.merged).toBe(2); // second unit merged into each
    const explodes = r.abilities.find((a) => a.ability_id === "explodes");
    expect(explodes.unit_ids).toEqual(["land-raider", "land-raider-2"]);
  });

  it("merges into an existing core ability rather than duplicating", () => {
    const existing = [
      {
        ability_id: "explodes",
        name: "Explodes",
        ability_type: "core",
        effect: { type: "deadly-demise", target: "unit", modifier: { value: "D6" } },
        unit_ids: ["some-other-unit"],
      },
    ];
    const r = seedFaction("necrons", archive, [{ id: "land-raider", name: "Land Raider" }], existing);
    expect(r.merged).toBe(1);
    const explodes = r.abilities.find((a) => a.ability_id === "explodes");
    expect(explodes.unit_ids).toEqual(["some-other-unit", "land-raider"]);
    // assault-ramp had no collision → newly created
    expect(r.created).toBe(1);
  });

  it("merges into an authored non-core ability additively and flags it for review", () => {
    const existing = [
      {
        ability_id: "explodes",
        name: "Explodes",
        ability_type: "unit",
        effect: { type: "mortal-wounds", target: "defender", modifier: { value: 3 } },
        unit_ids: ["curated-unit"],
      },
    ];
    const r = seedFaction("necrons", archive, [{ id: "land-raider", name: "Land Raider" }], existing);
    expect(r.mergedIntoAuthored).toContainEqual({ ability_id: "explodes", unit_id: "land-raider" });
    const explodes = r.abilities.find((a) => a.ability_id === "explodes");
    expect(explodes.unit_ids).toEqual(["curated-unit", "land-raider"]); // additive
    expect(explodes.effect.type).toBe("mortal-wounds"); // effect untouched
  });

  it("reports unresolved when the unit has no datasheet (selectable-pool / mismatch)", () => {
    const r = seedFaction(
      "necrons",
      archive,
      [{ id: "ctan-shard-of-the-nightbringer", name: "C'tan Shard of the Nightbringer" }],
      [],
    );
    expect(r.created).toBe(0);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toMatch(/no matching datasheet/);
  });
});
