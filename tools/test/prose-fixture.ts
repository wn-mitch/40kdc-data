/**
 * A fabricated MFM dump and matching repo tree for tests of the dump-prose readers.
 * Names and wording are invented; nothing here is GW text.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { DumpProse } from "../src/mfm/dump-prose.js";
import { MfmDump } from "../src/mfm/loader.js";
import { RepoProse } from "../src/mfm/record-prose.js";

const loc = (en: Record<string, unknown>) => ({ localisations: { en } });
const pub = (id: string, fk: string | null, extra: Record<string, unknown> = {}) => ({
  id, factionKeywordId: fk, isCombatPatrol: false, isLegends: false, isCoreRules: false, ...extra, ...loc({ name: id }),
});
const sheet = (id: string, publicationId: string, name: string) => ({ id, publicationId, isLegends: false, allegianceAbilityGroupId: null, ...loc({ name }) });
const ability = (id: string, name: string, rules: string, extra: Record<string, unknown> = {}) => ({
  id, abilityType: "datasheet", armyRuleId: null, detachmentRuleId: null, ...extra, ...loc({ name, rules }),
});
const link = (datasheetId: string, datasheetAbilityId: string) => ({ id: `${datasheetId}>${datasheetAbilityId}`, datasheetId, datasheetAbilityId, ...loc({}) });
const comp = (id: string, owner: Record<string, string>, displayOrder: number, textContent: string) => ({
  id, armyRuleId: null, detachmentRuleId: null, ruleContainerId: null, ...owner, displayOrder, type: "text", ...loc({ textContent }),
});
const mfm = (id: string) => [{ namespace: "mfm", id }];

export function fixtureDump(): MfmDump {
  const data = {
    faction_keyword: [
      { id: "fk-a", parentFactionKeywordId: null, ...loc({ name: "Warden Host" }) },
      { id: "fk-b", parentFactionKeywordId: null, ...loc({ name: "Ember Court" }) },
    ],
    publication: [pub("Codex A", "fk-a"), pub("Codex B", "fk-b"), pub("Patrol A", "fk-a", { isCombatPatrol: true }), pub("Core", null, { isCoreRules: true })],
    datasheet: [
      sheet("ds-a", "Codex A", "Iron Wagon"),
      sheet("ds-a2", "Codex A", "Scout Wagon"),
      sheet("ds-a3", "Codex A", "Heavy Wagon"),
      sheet("ds-b", "Codex B", "Iron Wagon"),
    ],
    datasheet_ability: [
      ability("ab-a", "Grudge Engine", "Warden wagon text."),
      ability("ab-b", "Grudge Engine", "Ember wagon text."),
      ability("ab-v1", "Twin Guns", "Scout guns text."),
      ability("ab-v2", "Twin Guns", "Heavy guns text."),
      ability("ab-core", "Deep Watch", "Datasheet reprint of deep watch.", { abilityType: "core" }),
    ],
    datasheet_datasheet_ability: [link("ds-a", "ab-a"), link("ds-b", "ab-b"), link("ds-a2", "ab-v1"), link("ds-a3", "ab-v2"), link("ds-a", "ab-core")],
    army_rule: [
      { id: "ar-a", publicationId: "Codex A", ...loc({ name: "Warden Oath" }) },
      { id: "ar-a-cp", publicationId: "Patrol A", ...loc({ name: "Warden Oath" }) },
    ],
    detachment: [{ id: "det-a", publicationId: "Codex A", ...loc({ name: "Iron Vigil" }) }],
    detachment_rule: [{ id: "dr-1", detachmentId: "det-a", displayOrder: 1, ...loc({ name: "Iron Vigil Doctrine" }) }],
    rule_container_component: [
      comp("c1", { armyRuleId: "ar-a" }, 1, "Codex oath text."),
      comp("p1", { armyRuleId: "ar-a-cp" }, 1, "Patrol oath text."),
      comp("d1", { detachmentRuleId: "dr-1" }, 1, "Doctrine text."),
      comp("k1", { ruleContainerId: "rc-1" }, 1, "Core deep watch text."),
    ],
    stratagem: [
      { id: "st-1", detachmentId: "det-a", publicationId: "Codex A", ...loc({ name: "Hold Fast", whenRules: "Any phase.", targetRules: "One unit.", effectRules: "Hold <b>fast</b>." }) },
      { id: "st-core", detachmentId: null, publicationId: "Core", ...loc({ name: "Counterstrike", whenRules: "Fight phase.", targetRules: "One unit.", effectRules: "Strike back." }) },
    ],
    enhancement: [{ id: "en-1", detachmentId: "det-a", publicationId: "Codex A", ...loc({ name: "Star Lantern", rules: "Lantern text." }) }],
    rule_section: [{ id: "sec-1", publicationId: "Core", ...loc({ name: "Abilities" }) }],
    rule_container: [{ id: "rc-1", containerType: "standard", ruleSectionId: "sec-1", stratagemId: null, ...loc({ title: "Deep Watch" }) }],
  };
  return new MfmDump({ data: data as never });
}

const stub = (ability_id: string, ability_type: string, extra: Record<string, unknown> = {}) => ({ ability_id, name: ability_id, ability_type, unit_ids: [], ...extra });

/** The repo files the fixture dump resolves against. */
export const FIXTURE_FILES: Record<string, unknown[]> = {
  "data/core/warden-host/units.json": [
    { id: "iron-wagon", external_refs: mfm("ds-a") },
    { id: "scout-wagon", external_refs: mfm("ds-a2") },
    { id: "heavy-wagon", external_refs: mfm("ds-a3") },
  ],
  "data/core/ember-court/units.json": [{ id: "iron-wagon", external_refs: mfm("ds-b") }],
  "data/core/warden-host/detachments.json": [{ id: "iron-vigil", external_refs: mfm("det-a") }],
  "data/core/warden-host/stratagems.json": [{ id: "hold-fast-iron-vigil", detachment_id: "iron-vigil", external_refs: mfm("st-1") }],
  "data/core/warden-host/enhancements.json": [{ id: "star-lantern-iron-vigil", detachment_id: "iron-vigil" }],
  "data/core/stratagems.json": [{ id: "counterstrike", external_refs: mfm("st-core") }],
  "data/enrichment/warden-host/abilities.json": [
    stub("grudge-engine", "unit", { unit_ids: ["iron-wagon"] }),
    stub("deep-watch", "core", { unit_ids: ["iron-wagon"] }),
    stub("twin-guns", "unit", { unit_ids: ["scout-wagon", "heavy-wagon"] }),
    stub("warden-oath", "faction"),
    stub("iron-vigil-doctrine", "detachment", { detachment_id: "iron-vigil" }),
    stub("hold-fast-iron-vigil", "stratagem", { detachment_id: "iron-vigil" }),
    stub("star-lantern-iron-vigil", "enhancement", { detachment_id: "iron-vigil" }),
    stub("lost-ability", "unit", { unit_ids: ["iron-wagon"] }),
  ],
  "data/enrichment/ember-court/abilities.json": [stub("grudge-engine", "unit", { unit_ids: ["iron-wagon"] })],
  "data/enrichment/_core/abilities.json": [stub("deep-watch", "core"), stub("counterstrike", "stratagem")],
};

/** Write the fixture repo to a temp dir; `cleanup` removes it. */
export function fixtureRepo(): { root: string; repo: RepoProse; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "prose-fixture-"));
  for (const [rel, rows] of Object.entries(FIXTURE_FILES)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify(rows));
  }
  return { root, repo: new RepoProse(DumpProse.fromDump(fixtureDump()), root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
