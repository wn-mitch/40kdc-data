import { describe, expect, it } from "vitest";

import { armyFactionId } from "../src/semantic-authoring/compile-army-faction.js";
import { CompileError } from "../src/semantic-authoring/compile-fragments.js";

// Reads the repo's core faction records and units.

describe("army-faction values lower to a faction id", () => {
  it("passes a faction id unchanged", () => {
    expect(armyFactionId("necrons")).toBe("necrons");
  });

  it("lowers a faction keyword to the one faction whose record and units carry it", () => {
    expect(armyFactionId("heretic-astartes")).toBe("chaos-space-marines");
    expect(armyFactionId("Heretic Astartes")).toBe("chaos-space-marines");
    expect(armyFactionId("legiones-daemonica")).toBe("chaos-daemons");
  });

  it("refuses a keyword several faction records carry", () => {
    expect(() => armyFactionId("imperium")).toThrow(CompileError);
    expect(() => armyFactionId("imperium")).toThrow(/several factions/);
  });

  it("refuses an Army Faction with no faction record, which no army's faction id matches", () => {
    // Only Aeldari units carry YNNARI; lowering it to aeldari would make every Aeldari army a Ynnari one.
    expect(() => armyFactionId("ynnari")).toThrow(/no faction record \(only units of aeldari carry it\)/);
  });

  it("refuses a name no faction carries", () => {
    expect(() => armyFactionId("glimmer-host")).toThrow(/names no faction/);
  });
});
