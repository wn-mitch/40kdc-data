import { describe, expect, it } from "vitest";

import { AmbiguousProseError, DumpProse, enumerateAbilityRows } from "../src/mfm/dump-prose.js";
import { MfmDump } from "../src/mfm/loader.js";

// Fabricated names and wording only.
const loc = (en: Record<string, unknown>) => ({ localisations: { en } });
const pub = (id: string, fk: string | null, extra: Record<string, unknown> = {}) => ({
  id, factionKeywordId: fk, isCombatPatrol: false, isLegends: false, isCoreRules: false, ...extra, ...loc({ name: id }),
});
const comp = (id: string, owner: Record<string, string>, displayOrder: number, type: string, en: Record<string, unknown>) => ({
  id, armyRuleId: null, detachmentRuleId: null, ruleContainerId: null, ...owner, displayOrder, type, ...loc(en),
});
const ability = (id: string, name: string, rules: string, extra: Record<string, unknown> = {}) => ({
  id, abilityType: "datasheet", armyRuleId: null, detachmentRuleId: null, ...extra, ...loc({ name, rules }),
});
const link = (datasheetId: string, datasheetAbilityId: string) => ({ id: `${datasheetId}>${datasheetAbilityId}`, datasheetId, datasheetAbilityId, ...loc({}) });

function fixture(): MfmDump {
  const data = {
    faction_keyword: [
      { id: "fk-a", parentFactionKeywordId: null, ...loc({ name: "Warden Host" }) },
      { id: "fk-b", parentFactionKeywordId: null, ...loc({ name: "Ember Court" }) },
      { id: "fk-c", parentFactionKeywordId: "fk-a", ...loc({ name: "Night Wardens" }) },
      { id: "fk-t", parentFactionKeywordId: null, ...loc({ name: "Adeptus Titanicus" }) },
    ],
    publication: [
      pub("Codex A", "fk-a"),
      pub("Codex B", "fk-b"),
      pub("Patrol A", "fk-a", { isCombatPatrol: true }),
      pub("Supplement C", "fk-c"),
      pub("Titans", "fk-t"),
      pub("Core", null, { isCoreRules: true }),
    ],
    datasheet: [
      { id: "ds-a", publicationId: "Codex A", isLegends: false, allegianceAbilityGroupId: null, ...loc({ name: "Iron Wagon" }) },
      { id: "ds-b", publicationId: "Codex B", isLegends: false, allegianceAbilityGroupId: null, ...loc({ name: "Iron Wagon" }) },
      { id: "ds-c", publicationId: "Supplement C", isLegends: false, allegianceAbilityGroupId: null, ...loc({ name: "Night Squad" }) },
      { id: "ds-t", publicationId: "Titans", isLegends: false, allegianceAbilityGroupId: null, ...loc({ name: "Walking Tower" }) },
    ],
    datasheet_ability: [
      ability("ab-shared", "Ram Plating", "Shared text."),
      ability("ab-a", "Grudge Engine", "Warden wagon text."),
      ability("ab-b", "Grudge Engine", "Ember wagon text."),
      ability("ab-orphan", "Lost Rule", "Retired text."),
      ability("ab-core", "Deep Watch", "Core datasheet text.", { abilityType: "core" }),
      ability("ab-stub", "Warden Oath (Aura)", "-", { abilityType: "faction", armyRuleId: "ar-a" }),
      ability("ab-c", "Night Oath", "Supplement text."),
      ability("ab-t", "Tower Stride", "Titan text."),
    ],
    datasheet_datasheet_ability: [
      link("ds-a", "ab-shared"), link("ds-b", "ab-shared"), link("ds-a", "ab-a"), link("ds-b", "ab-b"),
      link("ds-a", "ab-core"), link("ds-a", "ab-stub"), link("ds-c", "ab-c"), link("ds-t", "ab-t"),
    ],
    army_rule: [
      { id: "ar-a", publicationId: "Codex A", ...loc({ name: "Warden Oath" }) },
      { id: "ar-a-cp", publicationId: "Patrol A", ...loc({ name: "Warden Oath" }) },
    ],
    rule_container_component: [
      comp("c1", { armyRuleId: "ar-a" }, 1, "text", { textContent: "Pick a stance." }),
      comp("c2", { armyRuleId: "ar-a" }, 2, "header", { textContent: "Iron Stance" }),
      comp("c3", { armyRuleId: "ar-a" }, 3, "text", { textContent: "Iron text." }),
      comp("c4", { armyRuleId: "ar-a" }, 4, "header", { textContent: "Swift Stance" }),
      comp("c5", { armyRuleId: "ar-a" }, 5, "text", { textContent: "Swift text." }),
      comp("c6", { armyRuleId: "ar-a" }, 6, "image", { altText: "In round one, the range is 3 inches." }),
      comp("c7", { armyRuleId: "ar-a" }, 7, "loreAccordion", { textContent: "Flavour." }),
      comp("p1", { armyRuleId: "ar-a-cp" }, 1, "text", { textContent: "Patrol stance text." }),
      comp("d1", { detachmentRuleId: "dr-1" }, 1, "header", { textContent: "Iron Vigil Doctrine" }),
      comp("d2", { detachmentRuleId: "dr-1" }, 2, "text", { textContent: "Pick one:\n■ <b>Watchful [1CP]</b>\nWatch text." }),
      comp("k1", { ruleContainerId: "rc-1" }, 1, "text", { textContent: "Core rule text." }),
    ],
    detachment: [{ id: "det-a", publicationId: "Codex A", ...loc({ name: "Iron Vigil" }) }],
    detachment_rule: [{ id: "dr-1", detachmentId: "det-a", displayOrder: 1, ...loc({ name: "Iron Vigil Doctrine" }) }],
    stratagem: [
      { id: "st-1", detachmentId: "det-a", publicationId: "Codex A", ...loc({ name: "Hold Fast", whenRules: "Any phase.", effectRules: "Hold <b>fast</b>." }) },
      { id: "st-core", detachmentId: null, publicationId: "Core", ...loc({ name: "Counterstrike", whenRules: "Fight phase." }) },
    ],
    enhancement: [{ id: "en-1", detachmentId: "det-a", publicationId: "Codex A", ...loc({ name: "Star Lantern", rules: "Lantern text." }) }],
    rule_section: [{ id: "sec-1", publicationId: "Core", ...loc({ name: "Abilities" }) }],
    rule_container: [
      { id: "rc-1", containerType: "standard", ruleSectionId: "sec-1", stratagemId: null, ...loc({ title: "Deep Watch" }) },
      { id: "rc-intro", containerType: "introduction", ruleSectionId: "sec-1", stratagemId: null, ...loc({ title: "Abilities" }) },
    ],
  };
  return new MfmDump({ data: data as never });
}

const prose = () => DumpProse.fromDump(fixture());

describe("dump prose rows", () => {
  it("files a row once per (faction, owner) that prints it, by the printing publication", () => {
    const { rows } = enumerateAbilityRows(fixture());
    const ram = rows.filter((r) => r.rowId === "ab-shared");
    expect(ram.map((r) => [r.faction, r.owner.kind === "datasheet" && r.owner.id])).toEqual([["ember-court", "ds-b"], ["warden-host", "ds-a"]]);
    expect(ram.map((r) => r.sharedWith)).toEqual([["warden-host"], ["ember-court"]]);
    // A supplement is its own faction even where the repo has no dir for it yet.
    expect(rows.find((r) => r.rowId === "ab-c")?.faction).toBe("night-wardens");
  });

  it("reports rows nothing links, and rows of unmodelled factions, instead of returning them", () => {
    const set = enumerateAbilityRows(fixture());
    expect(set.rows.some((r) => r.rowId === "ab-orphan" || r.rowId === "ab-t")).toBe(false);
    expect(set.unowned.map((u) => [u.rowId, u.reason])).toEqual([["ab-orphan", "no-owner"], ["ab-t", "unmapped-publication"]]);
    expect(prose().elsewhere("lost-rule")).toEqual([]);
  });

  it("keeps image altText in a rule's prose and emits header sections as their own rows", () => {
    const rule = prose().rows.find((r) => r.rowId === "ar-a" && r.kind === "army-rule")!;
    expect(rule.text).toBe("Pick a stance.\n**Iron Stance**\nIron text.\n**Swift Stance**\nSwift text.\nIn round one, the range is 3 inches.");
    const sections = prose().rows.filter((r) => r.kind === "rule-section" && r.parent?.rowId === "ar-a");
    expect(sections.map((s) => [s.rowId, s.slug, s.text])).toEqual([
      ["c2", "iron-stance", "Iron text."],
      ["c4", "swift-stance", "Swift text.\nIn round one, the range is 3 inches."],
    ]);
  });

  it("does not emit a section or menu option named like its own rule", () => {
    const rows = prose().rows.filter((r) => r.faction === "warden-host" && r.owner.kind === "detachment");
    expect(rows.filter((r) => r.kind === "rule-section")).toEqual([]);
    expect(rows.filter((r) => r.kind === "menu-option").map((r) => [r.slug, r.text])).toEqual([["watchful", "**Watchful [1CP]**\nWatch text."]]);
  });

  it("is deterministic: keys unique, order stable", () => {
    const a = enumerateAbilityRows(fixture());
    const b = enumerateAbilityRows(fixture());
    expect(a).toEqual(b);
    expect(new Set(a.rows.map((r) => r.key)).size).toBe(a.rows.length);
  });
});

describe("dump prose lookup", () => {
  it("returns a datasheet ability only for the faction whose datasheet prints it", () => {
    const p = prose();
    expect(p.lookup({ faction: "warden-host", owner: { kind: "unit", id: "iron-wagon" }, ability: "grudge-engine" })?.ref).toBe("dump.json#ab-a");
    expect(p.lookup({ faction: "ember-court", owner: { kind: "unit", id: "iron-wagon" }, ability: "grudge-engine" })?.ref).toBe("dump.json#ab-b");
    // Night Squad prints no Grudge Engine: the same name elsewhere is never a fallback.
    expect(p.lookup({ faction: "night-wardens", owner: { kind: "unit", id: "night-squad" }, ability: "grudge-engine" })).toBeNull();
    // Pinned datasheet ids win over the slug.
    expect(p.lookup({ faction: "ember-court", owner: { kind: "unit", id: "renamed", datasheetIds: ["ds-b"] }, ability: "grudge-engine" })?.ref).toBe("dump.json#ab-b");
  });

  it("resolves a unit's core ability to the one _core row", () => {
    const hit = prose().lookup({ faction: "warden-host", owner: { kind: "unit", id: "iron-wagon" }, ability: "deep-watch" });
    expect(hit?.rows.map((r) => [r.faction, r.kind, r.rowId])).toEqual([["_core", "core-ability", "ab-core"]]);
  });

  it("gives a datasheet stub the prose of the army rule it points at", () => {
    const hit = prose().lookup({ faction: "warden-host", owner: { kind: "unit", id: "iron-wagon" }, ability: "warden-oath-aura" });
    expect(hit?.rows[0]?.textFrom).toEqual({ table: "army_rule", rowId: "ar-a" });
    expect(hit?.text).toContain("Swift text.");
  });

  it("lists codex and Combat Patrol texts of one rule as variants and refuses to pick", () => {
    const p = prose();
    const q = { faction: "warden-host", owner: { kind: "army" as const }, ability: "warden-oath", kinds: ["army-rule" as const] };
    expect(p.variants(q).map((v) => v.rows.map((r) => r.rowId))).toEqual([["ar-a"], ["ar-a-cp"]]);
    expect(() => p.lookup(q)).toThrow(AmbiguousProseError);
    expect(() => p.lookup(q)).toThrow(/dump\.json#ar-a\b[\s\S]*dump\.json#ar-a-cp/);
    expect(p.lookup({ ...q, combatPatrol: false })?.ref).toBe("dump.json#ar-a");
    expect(p.lookup({ ...q, combatPatrol: true })?.ref).toBe("dump.json#ar-a-cp");
  });

  it("finds a header sub-rule under its army owner", () => {
    expect(prose().lookup({ faction: "warden-host", owner: { kind: "army" }, ability: "swift-stance" })?.ref).toBe("dump.json#c4");
  });

  it("matches repo spellings: detachment suffix, hyphenation, owner suffix", () => {
    const p = prose();
    expect(p.lookup({ faction: "warden-host", owner: { kind: "detachment", id: "iron-vigil" }, ability: "hold-fast-iron-vigil", kinds: ["stratagem"] })?.text).toBe("WHEN: Any phase.\nEFFECT: Hold **fast**.");
    expect(p.lookup({ faction: "_core", owner: { kind: "core" }, ability: "counter-strike" })?.ref).toBe("dump.json#st-core");
    expect(p.lookup({ faction: "warden-host", owner: { kind: "unit", id: "iron-wagon" }, ability: "grudge-engine-patrol-a" })?.ref).toBe("dump.json#ab-a");
    // The enhancement is the detachment's, not the unit's.
    expect(p.lookup({ faction: "warden-host", owner: { kind: "unit", id: "iron-wagon" }, ability: "star-lantern" })).toBeNull();
    expect(p.lookup({ faction: "warden-host", owner: { kind: "detachment", id: "iron-vigil" }, ability: "star-lantern-iron-vigil" })?.ref).toBe("dump.json#en-1");
  });

  it("reads core rules from the Core Rules publication, skipping section introductions", () => {
    const core = prose().rows.filter((r) => r.kind === "core-rule");
    expect(core.map((r) => [r.rowId, r.text])).toEqual([["rc-1", "Core rule text."]]);
  });
});
