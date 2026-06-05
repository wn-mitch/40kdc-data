/**
 * ListForge plain-text adapter unit tests.
 *
 * ListForge's copy-paste export: a `name - faction - detachment (N Points)`
 * first line, mixed-case role sections ending with `:`, units as
 * `Name (N pts)` headers, and indented `•` bullets for model groups, wargear,
 * the `E: <name>` enhancement annotation, and the bare `Warlord` marker.
 * These tests pin the parse and the disjointness from the other text matchers.
 */
import { describe, it, expect } from "vitest";
import { Dataset } from "../../src/data/dataset.js";
import { tryImportRoster } from "../../src/import/import-roster.js";
import { listForgeTextAdapter } from "../../src/import/listforge-text.js";
import { gwAdapter } from "../../src/import/gw.js";
import { newRecruitSimpleAdapter } from "../../src/import/newrecruit-simple.js";

const ds = Dataset.embedded();

// Condensed from the reference Chaos Daemons export.
const SAMPLE = `all gas no breaks - Chaos Daemons - Daemonic Incursion (1995 Points)


Epic Hero:
Rotigus (250 pts)
  • Gnarlrod
  • Streams of brackish filth


Character:
Great Unclean One (295 pts)
  • Putrid vomit
  • Bileblade
  • Bilesword
  • E: The Endless Gift
  • Warlord

Bloodmaster (65 pts)
  • Blade of blood


Battleline:
Bloodletters (110 pts)
  • Bloodreaper
    • Hellblade
  • Instrument of Chaos
  • Daemonic Icon
  • 9x Bloodletter
    • 9x Hellblade


Beast:
Flesh Hounds (75 pts)
  • Gore Hound
    • Burning maw
    • Collar of Khorne
    • Gore-drenched fangs
  • 4x Flesh Hound
    • 4x Collar of Khorne
    • 4x Gore-drenched fangs
`;

describe("listForgeTextAdapter.matches", () => {
  it("recognises the ListForge text export", () => {
    expect(listForgeTextAdapter.matches(SAMPLE)).toBe(true);
  });

  it("rejects non-string payloads and other text formats", () => {
    expect(listForgeTextAdapter.matches({ roster: {} })).toBe(false);
    // newrecruit-simple first line ends `- [N pts]`, not `(N Points)`.
    expect(
      listForgeTextAdapter.matches(
        "Chaos - Chaos Knights - List - [2000 pts]\n\n# ++ Army Roster ++ [2000 pts]\nUnit [5 pts]:\n• 1x Model: Gun",
      ),
    ).toBe(false);
    // A GW export's first non-blank line is the `++++` fence.
    expect(
      listForgeTextAdapter.matches(
        "++++\n+ FACTION KEYWORD: Chaos - Chaos Knights\n++++\nUnit (5 pts)\n• 1x Gun",
      ),
    ).toBe(false);
  });

  it("requires bullets and refuses WTC `N with` bodies", () => {
    const noBullets = "name - Faction - Detachment (1000 Points)\nUnit (50 pts)";
    expect(listForgeTextAdapter.matches(noBullets)).toBe(false);
    const withLines =
      "name - Faction - Detachment (1000 Points)\nUnit (50 pts)\n  • Gun\n1 with Sword";
    expect(listForgeTextAdapter.matches(withLines)).toBe(false);
  });

  it("stays disjoint from the other text matchers on its own sample", () => {
    expect(gwAdapter.matches(SAMPLE)).toBe(false);
    expect(newRecruitSimpleAdapter.matches(SAMPLE)).toBe(false);
  });
});

describe("listForgeTextAdapter via tryImportRoster", () => {
  it("auto-detects the format and resolves against the dataset", () => {
    const result = tryImportRoster(SAMPLE, { dataset: ds });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe("listforge-text");
      expect(result.roster.faction_id).toBe("chaos-daemons");
    }
  });
});

describe("listForgeTextAdapter.parse", () => {
  const parsed = listForgeTextAdapter.parse(SAMPLE);

  it("reads name, faction, detachment, and points from the first line", () => {
    expect(parsed.name).toBe("all gas no breaks");
    expect(parsed.faction_raw_name).toBe("Chaos Daemons");
    expect(parsed.detachment_raw_name).toBe("Daemonic Incursion");
    expect(parsed.total_reported).toBe(1995);
    // ListForge reports only the army total — it doubles as the limit.
    expect(parsed.declared_limit).toBe(1995);
  });

  it("captures units in declaration order", () => {
    expect(parsed.units.map((u) => u.raw_name)).toEqual([
      "Rotigus",
      "Great Unclean One",
      "Bloodmaster",
      "Bloodletters",
      "Flesh Hounds",
    ]);
  });

  it("flags characters from the Epic Hero / Character sections", () => {
    const flags = Object.fromEntries(
      parsed.units.map((u) => [u.raw_name, u.is_character]),
    );
    expect(flags["Rotigus"]).toBe(true);
    expect(flags["Great Unclean One"]).toBe(true);
    expect(flags["Bloodmaster"]).toBe(true);
    expect(flags["Bloodletters"]).toBe(false);
    expect(flags["Flesh Hounds"]).toBe(false);
  });

  it("reads the E: enhancement annotation without claiming points for it", () => {
    const guo = parsed.units.find((u) => u.raw_name === "Great Unclean One")!;
    expect(guo.enhancement_raw_name).toBe("The Endless Gift");
    expect(guo.enhancement_points).toBeNull();
    expect(guo.points).toBe(295); // displayed points stay as-is
    expect(guo.is_warlord).toBe(true);
  });

  it("derives model counts from bulleted model groups", () => {
    const bloodletters = parsed.units.find((u) => u.raw_name === "Bloodletters")!;
    expect(bloodletters.model_count).toBe(10); // Bloodreaper + 9x Bloodletter
    const hounds = parsed.units.find((u) => u.raw_name === "Flesh Hounds")!;
    expect(hounds.model_count).toBe(5); // Gore Hound + 4x Flesh Hound
    const rotigus = parsed.units.find((u) => u.raw_name === "Rotigus")!;
    expect(rotigus.model_count).toBe(1); // wargear-only bullets
  });

  it("aggregates squad-wide wargear from child bullets and leaf bullets", () => {
    const bloodletters = parsed.units.find((u) => u.raw_name === "Bloodletters")!;
    const gear = Object.fromEntries(
      bloodletters.wargear.map((w) => [w.raw_name, w.count]),
    );
    expect(gear["Hellblade"]).toBe(10); // 1 (Bloodreaper's) + 9 (squad line)
    expect(gear["Instrument of Chaos"]).toBe(1);
    expect(gear["Daemonic Icon"]).toBe(1);
  });

  it("sums total_computed from unit points", () => {
    expect(parsed.total_computed).toBe(250 + 295 + 65 + 110 + 75);
  });

  it("does not leak any prose fields", () => {
    const json = JSON.stringify(parsed);
    expect(json.includes("description")).toBe(false);
    expect(json.includes("rules")).toBe(false);
  });
});
