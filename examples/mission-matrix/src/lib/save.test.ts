/** The intelligent cloud-save auto-name across its degradation cases. */
import { describe, expect, it } from "vitest";
import { autoSaveName } from "./save.js";

// Fixed local-noon date so the "Mon D" suffix is deterministic regardless of
// the runner's timezone.
const NOW = new Date(2026, 5, 13, 12, 0, 0); // 2026-06-13

describe("autoSaveName", () => {
  it("falls back to a dated generic name before a matchup is picked", () => {
    expect(
      autoSaveName({
        dispYou: null,
        dispOpp: null,
        missionYouName: null,
        missionOppName: null,
        totalYou: 0,
        totalOpp: 0,
        round: 1,
        now: NOW,
      }),
    ).toBe("Mission Matrix game · Jun 13");
  });

  it("uses matchup labels + scoreline even without mission names", () => {
    const name = autoSaveName({
      dispYou: "take-and-hold",
      dispOpp: "purge-the-foe",
      missionYouName: null,
      missionOppName: null,
      totalYou: 12,
      totalOpp: 9,
      round: 2,
      now: NOW,
    });
    expect(name).toBe("Take and Hold vs Purge the Foe · 12–9 (BR2) · Jun 13");
    expect(name).not.toContain("—"); // no mission segment when names are absent
  });

  it("includes both mission names when present", () => {
    const name = autoSaveName({
      dispYou: "take-and-hold",
      dispOpp: "purge-the-foe",
      missionYouName: "Linchpin",
      missionOppName: "Scorched Earth",
      totalYou: 45,
      totalOpp: 32,
      round: 3,
      now: NOW,
    });
    expect(name).toBe(
      "Take and Hold vs Purge the Foe — Linchpin/Scorched Earth · 45–32 (BR3) · Jun 13",
    );
  });

  it("stays within the worker's 200-char name cap", () => {
    const name = autoSaveName({
      dispYou: "priority-assets",
      dispOpp: "reconnaissance",
      missionYouName: "A".repeat(60),
      missionOppName: "B".repeat(60),
      totalYou: 100,
      totalOpp: 100,
      round: 5,
      now: NOW,
    });
    expect(name.length).toBeLessThanOrEqual(200);
  });
});
