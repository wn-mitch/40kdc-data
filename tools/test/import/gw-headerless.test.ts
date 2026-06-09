/**
 * Headerless plain-text adapter tests.
 *
 * The adapter is the lenient fallback for bullet-bearing plain text that no
 * framed adapter claims: the GW 40K app export (faction/detachment as bare
 * preamble lines, ALL-CAPS sections, `◦` child wargear), the `##` markdown
 * dialect, and the NewRecruit copy-text dialect. These pin the parse (preamble
 * capture, model groups, child wargear, enhancements) and its disjointness from
 * the framed text matchers.
 */
import { describe, it, expect } from "vitest";
import { Dataset } from "../../src/data/dataset.js";
import { importRoster, tryImportRoster } from "../../src/import/import-roster.js";
import { gwHeaderlessAdapter } from "../../src/import/gw-headerless.js";
import { gwAdapter } from "../../src/import/gw.js";
import { listForgeTextAdapter } from "../../src/import/listforge-text.js";
import { newRecruitSimpleAdapter } from "../../src/import/newrecruit-simple.js";

const ds = Dataset.embedded();

// GW app export (world-eaters dialect): `(N Points)`, bare faction/detachment
// preamble, ALL-CAPS sections, `◦` child wargear, single-model characters.
const GW_APP = `Ding dong (1995 Points)

World Eaters
Berzerker Warband
Strike Force (2,000 Points)

CHARACTERS

Khârn the Betrayer (100 Points)
  • Warlord
  • 1x Gorechild
  • 1x Plasma pistol

Master of Executions (95 Points)
  • 1x Axe of dismemberment
  • Enhancements: Berzerker Glaive

BATTLELINE

Khorne Berzerkers (180 Points)
  • 1x Khorne Berzerker Champion
     ◦ 1x Chainblade
  • 9x Khorne Berzerker
     ◦ 8x Bolt pistol
     ◦ 7x Chainblade

Exported with App Version: v1.48.0 (1), Data Version: v750
`;

// Markdown `##` fixture dialect: `(N pts)`, `• Nx Model: wargear`.
const MD_FIXTURE = `Test Army - Space Marines - Gladius Task Force (300 pts)

## Battleline (200 pts)
Intercessor Squad (200 pts)
  • 4x Intercessor: Bolt rifle
  • Intercessor Sergeant: Bolt rifle
`;

// NewRecruit text dialect WITH the ListForge `name - faction - detachment
// (N Points)` first line — listForgeTextAdapter claims this, so headerless must
// defer (used only for the disjointness assertion below).
const NR_TEXT = `all gas no breaks - Chaos Daemons - Daemonic Incursion (1995 Points)

Character:
Bloodmaster (65 pts)
  • Blade of blood
`;

// Same `Title:` + deeper-`•` children body, but a bare (1-part) title line, so
// it lacks the ListForge header and headerless does claim it. Exercises the
// nested model-group counting (a count-less bullet with children is a model).
const NR_TEXT_BARE = `Daemon Incursion (1995 Points)

Character:
Bloodmaster (65 pts)
  • Blade of blood

Battleline:
Bloodletters (110 pts)
  • Bloodreaper
    • Hellblade
  • Instrument of Chaos
  • 9x Bloodletter
    • 9x Hellblade
`;

describe("gwHeaderlessAdapter.matches", () => {
  it("accepts the GW app export", () => {
    expect(gwHeaderlessAdapter.matches(GW_APP)).toBe(true);
  });

  it("accepts the markdown `##` dialect", () => {
    expect(gwHeaderlessAdapter.matches(MD_FIXTURE)).toBe(true);
  });

  it("declines the framed GW export (belongs to gwAdapter)", () => {
    expect(
      gwHeaderlessAdapter.matches(
        "+ FACTION KEYWORD: X\n\nU (1 pts)\n• 1x W\n",
      ),
    ).toBe(false);
  });

  it("declines the ListForge-text header (belongs to listForgeTextAdapter)", () => {
    // NR_TEXT carries the `name - faction - detachment (N Points)` first line,
    // which listForgeTextAdapter claims; we must defer to keep matchers disjoint.
    expect(gwHeaderlessAdapter.matches(NR_TEXT)).toBe(false);
    expect(listForgeTextAdapter.matches(NR_TEXT)).toBe(true);
  });

  it("declines bullet-less text and non-strings", () => {
    expect(gwHeaderlessAdapter.matches("U (100 pts)\n")).toBe(false);
    expect(gwHeaderlessAdapter.matches({ roster: {} })).toBe(false);
  });

  it("stays disjoint from the other text matchers on the GW app sample", () => {
    expect(gwAdapter.matches(GW_APP)).toBe(false);
    expect(newRecruitSimpleAdapter.matches(GW_APP)).toBe(false);
    expect(listForgeTextAdapter.matches(GW_APP)).toBe(false);
  });
});

describe("gwHeaderlessAdapter.parse", () => {
  it("parses the GW app export with preamble faction/detachment", () => {
    const p = gwHeaderlessAdapter.parse(GW_APP);
    expect(p.name).toBe("Ding dong");
    // Faction / detachment are read from the bare preamble lines.
    expect(p.faction_raw_name).toBe("World Eaters");
    expect(p.detachment_raw_names).toEqual(["Berzerker Warband"]);
    expect(p.units).toHaveLength(3);

    const kharn = p.units[0];
    expect(kharn.raw_name).toBe("Khârn the Betrayer");
    expect(kharn.is_warlord).toBe(true);
    expect(kharn.is_character).toBe(true); // CHARACTERS section
    expect(kharn.model_count).toBe(1);
    expect(kharn.wargear.some((w) => w.raw_name === "Gorechild")).toBe(true);

    const moe = p.units[1];
    expect(moe.enhancement_raw_name).toBe("Berzerker Glaive");

    const zerks = p.units[2];
    expect(zerks.model_count).toBe(10); // 1 champion + 9
    const bolt = zerks.wargear.find((w) => w.raw_name === "Bolt pistol");
    expect(bolt?.count).toBe(8); // squad-wide `◦` child total
  });

  it("counts colon-wargear model groups in the markdown dialect", () => {
    const p = gwHeaderlessAdapter.parse(MD_FIXTURE);
    expect(p.units).toHaveLength(1);
    const squad = p.units[0];
    expect(squad.raw_name).toBe("Intercessor Squad");
    expect(squad.model_count).toBe(5); // 4 + 1
    const bolt = squad.wargear.find((w) => w.raw_name === "Bolt rifle");
    expect(bolt?.count).toBe(5);
  });

  it("counts nested model groups in the `Title:`-section dialect", () => {
    const p = gwHeaderlessAdapter.parse(NR_TEXT_BARE);
    expect(p.units).toHaveLength(2);
    expect(p.units[0].model_count).toBe(1);
    expect(p.units[0].wargear.some((w) => w.raw_name === "Blade of blood")).toBe(
      true,
    );
    expect(p.units[1].model_count).toBe(10); // Bloodreaper + 9 Bloodletter
    expect(p.units[1].wargear.some((w) => w.raw_name === "Hellblade")).toBe(true);
  });
});

describe("gwHeaderlessAdapter via tryImportRoster", () => {
  it("auto-detects the GW app export and resolves against the dataset", () => {
    const result = tryImportRoster(GW_APP, { dataset: ds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("gw");
    // Preamble capture lets resolve scope faction + detachment.
    expect(result.roster.faction_id).toBe("world-eaters");
    expect(result.roster.detachments.map((d) => d.ref.id)).toEqual([
      "berzerker-warband",
    ]);
    expect(result.roster.units.length).toBe(3);
    const zerks = result.roster.units.find(
      (u) => u.ref.id === "khorne-berzerkers",
    );
    expect(zerks?.model_count).toBe(10);
  });

  it("resolves the GW app units even via importRoster directly", () => {
    const roster = importRoster(GW_APP, { dataset: ds });
    expect(roster.faction_id).toBe("world-eaters");
    expect(roster.units.some((u) => u.ref.id === "kharn-the-betrayer")).toBe(true);
  });
});
