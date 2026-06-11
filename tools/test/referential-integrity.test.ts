import { describe, it, expect } from "vitest";
import { checkReferentialIntegrity, FACTION_HOME_KEYWORD } from "../src/integrity.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures");
const REAL_DATA = resolve(__dirname, "../../data");

describe("referential integrity", () => {
  it("passes on the real dataset (no dangling ability_ids, no foreign faction_keywords)", async () => {
    const result = await checkReferentialIntegrity(REAL_DATA);
    if (result.failed > 0) {
      // Surface the offending units to make regressions actionable.
      const detail = result.errors
        .flatMap((e) => e.errors.map((x) => x.message))
        .join("\n");
      throw new Error(`referential integrity failed:\n${detail}`);
    }
    expect(result.failed).toBe(0);
    expect(result.totalItems).toBeGreaterThan(0);
  });

  it("flags a dangling ability_id and a foreign faction_keyword", async () => {
    const result = await checkReferentialIntegrity(resolve(FIXTURES, "integrity-bad"));
    // Only the contaminated unit fails; the clean one passes.
    expect(result.failed).toBe(1);
    expect(result.passed).toBe(1);

    const messages = result.errors.flatMap((e) => e.errors.map((x) => x.message));
    expect(messages.some((m) => m.includes('ability_id "sorcerous-support"'))).toBe(true);
    expect(messages.some((m) => m.includes('faction_keyword "Emperor’s Children"'))).toBe(true);
    // The legal "World Eaters" keyword on the same unit must NOT be flagged.
    expect(messages.some((m) => m.includes('faction_keyword "World Eaters"'))).toBe(false);
  });

  it("passes a clean single-unit fixture", async () => {
    const result = await checkReferentialIntegrity(resolve(FIXTURES, "integrity-good"));
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(1);
  });

  it("registers the chaos cult factions with bare-legion home keywords", () => {
    expect(FACTION_HOME_KEYWORD["world-eaters"]).toBe("World Eaters");
    expect(FACTION_HOME_KEYWORD["chaos-space-marines"]).toBe("Heretic Astartes");
  });
});
