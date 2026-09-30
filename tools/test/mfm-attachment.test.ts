import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DUMP_PATH, MfmDump } from "../src/mfm/loader.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import { runAttachmentRoles } from "../src/mfm/attachment.js";

/**
 * Attachment keyword-eligibility derivation. `eligible_bodyguard_keywords` is the
 * "any unit with ALL these keywords qualifies" form (e.g. an Inquisitor leading any
 * IMPERIUM BATTLELINE INFANTRY unit), sourced from datasheet_bodyguard_group_keyword.
 * It is additive to the explicit eligible_bodyguard_ids the schema requires, and the
 * label order follows GW's canonical dump-edge order (not sorted). The only leaders
 * carrying keyword edges in the dump are the four agents-of-the-imperium Inquisitors,
 * so this pins the applied end-state (dump-guarded: the reconcile that produced it is
 * skipped when the dump is absent, but the committed data is always assertable).
 */
interface LeaderAttachment {
  leader_id: string;
  eligible_bodyguard_ids: string[];
  eligible_bodyguard_keywords?: string[];
}

function agentsRecords(): LeaderAttachment[] {
  return JSON.parse(
    fs.readFileSync(path.join(CORE_DIR, "agents-of-the-imperium", "leader-attachments.json"), "utf8"),
  );
}

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("attachment keyword eligibility (applied end-state)", () => {
  const byLeader = new Map(agentsRecords().map((r) => [r.leader_id, r]));

  it("carries keyword eligibility for every Inquisitor in GW-canonical order", () => {
    for (const id of ["inquisitor", "inquisitor-coteaz", "inquisitor-draxus", "inquisitor-greyfax"]) {
      const rec = byLeader.get(id);
      expect(rec, `expected a record for ${id}`).toBeTruthy();
      // Order is NOT alphabetical — it follows the dump edge order (Imperium, Battleline, Infantry).
      expect(rec?.eligible_bodyguard_keywords).toEqual(["Imperium", "Battleline", "Infantry"]);
    }
  });

  it("only attaches keywords to records that also carry explicit bodyguard ids", () => {
    for (const rec of agentsRecords()) {
      if (rec.eligible_bodyguard_keywords) {
        expect(rec.eligible_bodyguard_ids.length).toBeGreaterThan(0);
      }
    }
  });

  it("omits the field entirely on non-keyword leaders (never an empty array)", () => {
    const withoutKeywords = agentsRecords().filter((r) => !r.eligible_bodyguard_keywords);
    expect(withoutKeywords.length).toBeGreaterThan(0);
    for (const rec of withoutKeywords) expect("eligible_bodyguard_keywords" in rec).toBe(false);
  });
});

describe("attachment roster-condition projection", () => {
  it("keeps opposite roster requirements and their distinct roles separate", () => {
    const dump = new MfmDump({
      data: {
        faction_keyword: [
          { id: "f", localisations: { en: { name: "Adeptus Astartes" } } },
        ],
        publication: [{ id: "p", factionKeywordId: "f" }],
        datasheet: [
          { id: "character", publicationId: "p", isLegends: false, localisations: { en: { name: "Captain" } } },
          { id: "bodyguard", publicationId: "p", isLegends: false, localisations: { en: { name: "Intercessor Squad" } } },
          { id: "roster-gate", publicationId: "p", isLegends: false, localisations: { en: { name: "Chaplain" } } },
        ],
        datasheet_bodyguard_group: [
          { id: "without", datasheetId: "character", bodyguardType: "leader" },
          { id: "with", datasheetId: "character", bodyguardType: "support" },
        ],
        datasheet_bodyguard_group_datasheet: [
          { datasheetBodyguardGroupId: "without", datasheetId: "bodyguard" },
          { datasheetBodyguardGroupId: "with", datasheetId: "bodyguard" },
        ],
        datasheet_bodyguard_group_keyword: [],
        datasheet_bodyguard_group_excluded_roster_datasheet: [
          { datasheetBodyguardGroupId: "without", datasheetId: "roster-gate" },
        ],
        datasheet_bodyguard_group_required_roster_datasheet: [
          { datasheetBodyguardGroupId: "with", datasheetId: "roster-gate" },
        ],
      },
    });
    const report = runAttachmentRoles(dump, "adeptus-astartes");
    const staged = report.staged.find((file) =>
      file.path.endsWith("/adeptus-astartes/leader-attachments.json"),
    );
    const records = staged?.value as Array<{
      leader_id: string;
      eligible_bodyguard_ids: string[];
      conditional_groups?: unknown[];
    }>;
    expect(records.find((record) => record.leader_id === "captain")).toMatchObject({
      eligible_bodyguard_ids: [],
      conditional_groups: [
        {
          role: "leader",
          eligible_bodyguard_ids: ["intercessor-squad"],
          excluded_roster_unit_ids: ["chaplain"],
        },
        {
          role: "support",
          eligible_bodyguard_ids: ["intercessor-squad"],
          required_roster_unit_ids: ["chaplain"],
        },
      ],
    });
  });
});
