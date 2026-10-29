import { describe, expect, it } from "vitest";

import { dumpSlugSets, liveInDir } from "../src/mfm/legends-cull.js";
import { MfmDump } from "../src/mfm/loader.js";

// Fabricated datasheets; faction keywords are real so they route to real repo dirs.
const loc = (name: string) => ({ localisations: { en: { name } } });
function dump(): MfmDump {
  return new MfmDump({
    data: {
      faction_keyword: [
        { id: "fk-sm", parentFactionKeywordId: null, ...loc("Adeptus Astartes") },
        { id: "fk-sw", parentFactionKeywordId: "fk-sm", ...loc("Space Wolves") },
        { id: "fk-gk", parentFactionKeywordId: null, ...loc("Grey Knights") },
      ],
      publication: [
        { id: "p-sm-leg", factionKeywordId: "fk-sm", isLegends: true, isCombatPatrol: false, isCoreRules: false, ...loc("Legends SM") },
        { id: "p-sw", factionKeywordId: "fk-sw", isLegends: false, isCombatPatrol: false, isCoreRules: false, ...loc("Supplement SW") },
        { id: "p-gk", factionKeywordId: "fk-gk", isLegends: false, isCombatPatrol: false, isCoreRules: false, ...loc("Codex GK") },
      ],
      datasheet: [
        { id: "ds-tank-leg", publicationId: "p-sm-leg", isLegends: true, ...loc("Siege Tank") },
        { id: "ds-tank-gk", publicationId: "p-gk", isLegends: false, ...loc("Siege Tank") },
        { id: "ds-walker-sw", publicationId: "p-sw", isLegends: false, ...loc("Old Walker") },
      ],
    } as never,
  });
}

describe("Legends cull liveness", () => {
  const sets = dumpSlugSets(dump());
  it("drops a copy only Legends prints for its dir, even when another faction prints the name", () => {
    expect(liveInDir({ id: "siege-tank", external_refs: [{ namespace: "mfm", id: "ds-tank-leg" }] }, "adeptus-astartes", sets)).toBe(false);
    expect(liveInDir({ id: "siege-tank" }, "grey-knights", sets)).toBe(true);
  });

  it("keeps a supplement's unit filed under its parent roster's dir, by name or by live ref", () => {
    expect(liveInDir({ id: "old-walker" }, "adeptus-astartes", sets)).toBe(true);
    expect(liveInDir({ id: "renamed-walker", external_refs: [{ namespace: "mfm", id: "ds-walker-sw" }] }, "adeptus-astartes", sets)).toBe(true);
  });
});
