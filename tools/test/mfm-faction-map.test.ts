import { describe, it, expect } from "vitest";
import { repoDirForFactionName, repoDirs } from "../src/mfm/faction-map.js";

/**
 * faction-map resolves MFM faction-keyword names to repo data/core/ dirs.
 * repoDirs() reads the committed dir tree, so these run in CI without the dump.
 */
describe("repoDirForFactionName", () => {
  it("resolves names that slug straight to their dir", () => {
    expect(repoDirForFactionName("Adepta Sororitas")).toBe("adepta-sororitas");
    expect(repoDirForFactionName("Necrons")).toBe("necrons");
    expect(repoDirForFactionName("Agents of the Imperium")).toBe("agents-of-the-imperium");
  });

  it("strips apostrophes via nameToId (T'au Empire → tau-empire)", () => {
    expect(repoDirForFactionName("T’au Empire")).toBe("tau-empire");
    expect(repoDirForFactionName("Emperor’s Children")).toBe("emperors-children");
  });

  it("maps aggregate/sub-faction keywords to their parent dir", () => {
    expect(repoDirForFactionName("Asuryani")).toBe("aeldari");
    expect(repoDirForFactionName("Harlequins")).toBe("aeldari");
    expect(repoDirForFactionName("Ynnari")).toBe("aeldari");
    expect(repoDirForFactionName("Heretic Astartes")).toBe("chaos-space-marines");
    expect(repoDirForFactionName("Legiones Daemonica")).toBe("chaos-daemons");
    expect(repoDirForFactionName("Blood Legions")).toBe("chaos-daemons");
  });

  it("maps the titan legion keywords to their own dirs", () => {
    expect(repoDirForFactionName("Adeptus Titanicus")).toBe("adeptus-titanicus");
    expect(repoDirForFactionName("Titanicus Traitoris")).toBe("titanicus-traitoris");
  });

  it("returns null for undefined / unmappable names", () => {
    expect(repoDirForFactionName(undefined)).toBeNull();
    expect(repoDirForFactionName("")).toBeNull();
  });

  it("only resolves to dirs that actually exist on disk", () => {
    const dirs = repoDirs();
    expect(dirs.has("adeptus-astartes")).toBe(true);
    expect(dirs.has("_example")).toBe(false); // underscore dirs excluded
  });
});
