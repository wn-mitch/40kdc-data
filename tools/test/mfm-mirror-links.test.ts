import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MfmDump } from "../src/mfm/loader.js";
import { runMirror } from "../src/mfm/mirror/mirror.js";

// Fabricated names and wording only. Faction keywords are real so they route to real repo dirs.
const loc = (en: Record<string, unknown>) => ({ localisations: { en } });
const pub = (id: string, fk: string, extra: Record<string, unknown> = {}) => ({
  id, factionKeywordId: fk, isCombatPatrol: false, isLegends: false, isCoreRules: false, ...extra, ...loc({ name: id }),
});
const mfm = (id: string) => [{ namespace: "mfm", id }];
const gv = { edition: "11th", dataslate: "launch" };
const rec = (ability_id: string, ability_type: string, extra: Record<string, unknown> = {}) => ({
  ability_id, name: ability_id, authored_by: "40kdc-community", game_version: gv, unit_ids: [], ability_type,
  effect: { type: "no-effect" }, scope: { duration: "permanent" }, ...extra,
});
const part = (id: string, owner: Record<string, string | null>, name: string) => ({
  id, ...owner, displayOrder: 1, ruleContainerId: null, type: "text", ...loc({ textContent: `${name} text.` }),
});

function dump(): MfmDump {
  return new MfmDump({
    data: {
      faction_keyword: [{ id: "fk-nec", parentFactionKeywordId: null, ...loc({ name: "Necrons" }) }],
      publication: [pub("Codex Nec", "fk-nec"), pub("Patrol Nec", "fk-nec", { isCombatPatrol: true }), pub("Legends Nec", "fk-nec", { isLegends: true })],
      datasheet: [
        { id: "ds-old", publicationId: "Legends Nec", isLegends: true, allegianceAbilityGroupId: null, ...loc({ name: "Old Walker" }) },
        // A patrol datasheet the dump carries that prints no ability at all.
        { id: "ds-bare", publicationId: "Patrol Nec", isLegends: false, allegianceAbilityGroupId: null, ...loc({ name: "Bare Walker" }) },
      ],
      datasheet_ability: [{ id: "ab-old", abilityType: "datasheet", armyRuleId: null, detachmentRuleId: null, ...loc({ name: "Old Gears", rules: "Legends text." }) }],
      datasheet_datasheet_ability: [{ id: "l1", datasheetId: "ds-old", datasheetAbilityId: "ab-old", ...loc({}) }],
      army_rule: [
        { id: "ar-2", publicationId: "Codex Nec", displayOrder: 2, ...loc({ name: "Second Law" }) },
        { id: "ar-1", publicationId: "Codex Nec", displayOrder: 1, ...loc({ name: "First Law" }) },
        { id: "ar-p", publicationId: "Patrol Nec", displayOrder: 1, ...loc({ name: "Patrol Law" }) },
      ],
      detachment: [
        { id: "det-a", publicationId: "Codex Nec", ...loc({ name: "Tomb Host" }) },
        { id: "det-p", publicationId: "Patrol Nec", ...loc({ name: "Tomb Patrol" }) },
      ],
      detachment_rule: [
        { id: "dr-a", detachmentId: "det-a", displayOrder: 1, ...loc({ name: "Host Rule" }) },
        { id: "dr-p", detachmentId: "det-p", displayOrder: 1, ...loc({ name: "Patrol Rule" }) },
      ],
      rule_container_component: [
        part("c1", { armyRuleId: "ar-1", detachmentRuleId: null }, "First Law"),
        part("c2", { armyRuleId: "ar-2", detachmentRuleId: null }, "Second Law"),
        part("c3", { armyRuleId: "ar-p", detachmentRuleId: null }, "Patrol Law"),
        part("c4", { armyRuleId: null, detachmentRuleId: "dr-a" }, "Host Rule"),
        part("c5", { armyRuleId: null, detachmentRuleId: "dr-p" }, "Patrol Rule"),
      ],
      stratagem: [
        { id: "st-2", detachmentId: "det-a", publicationId: "Codex Nec", displayOrder: 2, ...loc({ name: "Late Plan", whenRules: "Any phase." }) },
        { id: "st-1", detachmentId: "det-a", publicationId: "Codex Nec", displayOrder: 1, ...loc({ name: "Early Plan", whenRules: "Any phase." }) },
      ],
      enhancement: [],
    } as never,
  });
}

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function repo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "mirror-links-"));
  roots.push(root);
  const put = (rel: string, v: unknown) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), `${JSON.stringify(v, null, 2)}\n`);
  };
  put("data/core/necrons/units.json", [
    { id: "bare-walker", name: "Bare Walker", ability_ids: ["host-rule-necrons"], external_refs: mfm("ds-bare") },
    { id: "lost-walker", name: "Lost Walker", ability_ids: ["host-rule-necrons"], external_refs: mfm("ds-gone") },
  ]);
  put("data/core/necrons/factions.json", [{ id: "necrons", name: "Necrons", faction_rule_ids: ["stale-law"] }]);
  put("data/core/necrons/detachments.json", [
    // A stale single link and a roster missing a printed stratagem.
    { id: "tomb-host", name: "Tomb Host", detachment_rule_id: "stale-rule", stratagem_ids: ["late-plan-tomb-host-necrons"], external_refs: mfm("det-a") },
    { id: "tomb-patrol", name: "Tomb Patrol", external_refs: mfm("det-p") },
  ]);
  put("data/core/necrons/stratagems.json", [
    { id: "early-plan-tomb-host-necrons", name: "Early Plan", ability_id: null, detachment_id: "tomb-host", external_refs: mfm("st-1") },
    { id: "late-plan-tomb-host-necrons", name: "Late Plan", ability_id: null, detachment_id: "tomb-host", external_refs: mfm("st-2") },
  ]);
  put("data/enrichment/_core/abilities.json", []);
  put("data/enrichment/necrons/abilities.json", [
    rec("stale-law", "faction"),
    rec("stale-rule", "detachment", { detachment_id: "tomb-host" }),
    rec("old-gears-necrons", "unit"),
  ]);
  return root;
}
const read = (root: string, rel: string) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));

describe("mfm:mirror links rules and rosters to what the dump prints", () => {
  it("replaces stale faction, detachment and roster links with the dump's, in display order", async () => {
    const root = repo();
    const { files } = await runMirror(dump(), { root, validate: false, outside: false });
    for (const f of files) {
      mkdirSync(path.dirname(f.abs), { recursive: true });
      writeFileSync(f.abs, f.after);
    }
    expect(read(root, "data/core/necrons/factions.json")[0].faction_rule_ids).toEqual(["first-law-necrons", "second-law-necrons"]);
    const [host, patrol] = read(root, "data/core/necrons/detachments.json");
    expect(host).toMatchObject({
      detachment_rule_id: "host-rule-necrons",
      detachment_rule_ids: ["host-rule-necrons"],
      stratagem_ids: ["early-plan-tomb-host-necrons", "late-plan-tomb-host-necrons"],
    });
    // A Combat Patrol's army rules apply only when that patrol is played: they ride its detachment.
    expect(patrol.detachment_rule_ids).toEqual(["patrol-rule-necrons", "patrol-law-necrons"]);
  });

  it("empties a unit whose dump datasheet prints nothing, and keeps a unit with no dump datasheet", async () => {
    const { plan } = await runMirror(dump(), { root: repo(), validate: false, outside: false });
    expect(plan.units.find((u) => u.unitId === "bare-walker")?.after).toEqual([]);
    expect(plan.units.find((u) => u.unitId === "lost-walker")?.after).toEqual(["host-rule-necrons"]);
  });

  it("removes a record only a Legends book prints, and does not stub it back", async () => {
    const root = repo();
    const { plan } = await runMirror(dump(), { root, validate: false, outside: false });
    expect(plan.records.find((d) => d.oldId === "old-gears-necrons")).toMatchObject({ newId: null, reason: "legends-only" });
    expect(plan.stubs.map((s) => s.id)).not.toContain("old-gears-necrons");
  });
});
