import { describe, expect, it } from "vitest";

import { buildProseIndex, decodeEntities, plainBlock, plainLine, resolveProse } from "../src/mfm/dump-prose.js";
import { MfmDump } from "../src/mfm/loader.js";

// Fabricated names and wording only.
const row = (id: string, fields: Record<string, unknown>, en: Record<string, unknown>) => ({ id, ...fields, localisations: { en } });

function dump() {
  const tables: Record<string, unknown[]> = {
    detachment: [row("det-1", {}, { name: "Warden Host" })],
    enhancement: [row("enh-1", { detachmentId: "det-1" }, { name: "Star Lantern", rules: "The bearer has <b>STEALTH</b>." })],
    datasheet: [row("ds-1", {}, { name: "Warden Squad" }), row("ds-2", {}, { name: "Warden Lord" })],
    datasheet_ability: [
      row("ab-1", {}, { name: "Vigil", rules: "Squad version." }),
      row("ab-2", {}, { name: "Vigil", rules: "Lord version." }),
      row("ab-3", {}, { name: "Oath", rules: "Only one." }),
    ],
    datasheet_datasheet_ability: [
      { id: "l1", datasheetId: "ds-1", datasheetAbilityId: "ab-1" },
      { id: "l2", datasheetId: "ds-2", datasheetAbilityId: "ab-2" },
      { id: "l3", datasheetId: "ds-1", datasheetAbilityId: "ab-3" },
    ],
    datasheet_rule: [], datasheet_sub_ability: [], allegiance_ability: [], wargear_ability: [], wargear_item: [],
  };
  return new MfmDump({ data: tables as never });
}

describe("MFM dump prose", () => {
  it("decodes character references the dump leaves in its text, and keeps bold keywords", () => {
    expect(decodeEntities("unit&#x73; &amp; caf&#233; &nope;")).toBe("units & café &nope;");
    expect(plainLine("Friendly <b>WARDEN</b> units (&#x65;xcluding <b>TITANIC</b> unit&#x73;)")).toBe("Friendly **WARDEN** units (excluding **TITANIC** units)");
    expect(plainBlock("First line.\n\n  Second <b>line</b>.")).toBe("First line.\nSecond **line**.");
  });

  it("resolves a unit ability through the unit it is on before any bare name", () => {
    const index = buildProseIndex(dump());
    expect(resolveProse({ ability_id: "vigil", name: "Vigil", ability_type: "unit", unit_ids: ["warden-lord"] }, index)?.text).toBe("Lord version.");
    expect(resolveProse({ ability_id: "vigil", name: "Vigil", ability_type: "unit", unit_ids: ["warden-squad"] }, index)?.text).toBe("Squad version.");
    // Two units print different text under one name: a bare match is ambiguous, so nothing is guessed.
    expect(resolveProse({ ability_id: "vigil", name: "Vigil", ability_type: "unit", unit_ids: [] }, index)).toBeNull();
    expect(resolveProse({ ability_id: "oath", name: "Oath", ability_type: "unit", unit_ids: [] }, index)?.text).toBe("Only one.");
  });

  it("resolves an enhancement by its detachment-scoped id, never from unit abilities", () => {
    const index = buildProseIndex(dump());
    expect(resolveProse({ ability_id: "star-lantern-warden-host", name: "Star Lantern", ability_type: "enhancement" }, index))
      .toEqual({ text: "The bearer has **STEALTH**.", ref: "dump.json#enh-1" });
    expect(resolveProse({ ability_id: "oath", name: "Oath", ability_type: "enhancement" }, index)).toBeNull();
  });
});
