import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MfmDump } from "../src/mfm/loader.js";
import { mirrorIds } from "../src/mfm/mirror/ids.js";
import { runMirror, type MirrorResult } from "../src/mfm/mirror/mirror.js";

// Fabricated names and wording only. Faction keywords are real so the supplement → parent
// roster mapping (Blood Angels → Adeptus Astartes) applies.
const loc = (en: Record<string, unknown>) => ({ localisations: { en } });
const pub = (id: string, fk: string | null, extra: Record<string, unknown> = {}) => ({
  id, factionKeywordId: fk, isCombatPatrol: false, isLegends: false, isCoreRules: false, ...extra, ...loc({ name: id }),
});
const ds = (id: string, publicationId: string, name: string) => ({ id, publicationId, isLegends: false, allegianceAbilityGroupId: null, ...loc({ name }) });
const ability = (id: string, name: string, rules: string, abilityType = "datasheet") => ({ id, abilityType, armyRuleId: null, detachmentRuleId: null, ...loc({ name, rules }) });
const link = (datasheetId: string, datasheetAbilityId: string) => ({ id: `${datasheetId}>${datasheetAbilityId}`, datasheetId, datasheetAbilityId, ...loc({}) });

function fixtureDump(): MfmDump {
  const data = {
    faction_keyword: [
      { id: "fk-sm", parentFactionKeywordId: null, ...loc({ name: "Adeptus Astartes" }) },
      { id: "fk-ba", parentFactionKeywordId: "fk-sm", ...loc({ name: "Blood Angels" }) },
      { id: "fk-nec", parentFactionKeywordId: null, ...loc({ name: "Necrons" }) },
    ],
    publication: [
      pub("Codex SM", "fk-sm"),
      pub("Combat Patrol: Iron Vanguard", "fk-sm", { isCombatPatrol: true }),
      pub("Supplement BA", "fk-ba"),
      pub("Codex Nec", "fk-nec"),
      pub("Core", null, { isCoreRules: true }),
    ],
    datasheet: [
      ds("ds-warden", "Codex SM", "Warden Squad"),
      ds("ds-warden-cp", "Combat Patrol: Iron Vanguard", "Warden Squad"),
      ds("ds-ba", "Supplement BA", "Crimson Guard"),
      ds("ds-nec", "Codex Nec", "Tomb Walker"),
    ],
    datasheet_ability: [
      ability("ab-grudge", "Grudge Engine", "Codex engine text."),
      ability("ab-grudge-cp", "Grudge Engine", "Patrol engine text."),
      ability("ab-watch-faction", "Deep Watch", "A faction rule that shares a core name."),
      ability("ab-watch-core", "Deep Watch", "Core datasheet text.", "core"),
      ability("ab-fnp5", "Feel No Pain 5+", "Core FNP text.", "core"),
      ability("ab-fnp6", "Feel No Pain 6+", "Core FNP text.", "core"),
      ability("ab-crimson", "Crimson Oath", "Supplement oath text."),
      ability("ab-metal", "Living Metal", "Necron metal text."),
    ],
    datasheet_datasheet_ability: [
      link("ds-warden", "ab-grudge"),
      link("ds-warden-cp", "ab-grudge-cp"),
      link("ds-warden", "ab-watch-faction"),
      link("ds-warden", "ab-watch-core"),
      link("ds-nec", "ab-watch-core"),
      link("ds-warden", "ab-fnp5"),
      link("ds-ba", "ab-fnp6"),
      link("ds-ba", "ab-crimson"),
      link("ds-nec", "ab-metal"),
    ],
    army_rule: [{ id: "ar-sm", publicationId: "Codex SM", ...loc({ name: "Warden Oath" }) }],
    rule_container_component: [
      { id: "c1", armyRuleId: "ar-sm", detachmentRuleId: null, ruleContainerId: null, displayOrder: 1, type: "text", ...loc({ textContent: "Oath text." }) },
    ],
    detachment: [{ id: "det-a", publicationId: "Codex SM", ...loc({ name: "Iron Host" }) }],
    detachment_rule: [],
    stratagem: [{ id: "st-1", detachmentId: "det-a", publicationId: "Codex SM", ...loc({ name: "Hold Fast", whenRules: "Any phase." }) }],
    enhancement: [{ id: "en-1", detachmentId: "det-a", publicationId: "Codex SM", ...loc({ name: "Star Lantern", rules: "Lantern text." }) }],
  };
  return new MfmDump({ data: data as never });
}

const gv = { edition: "11th", dataslate: "launch" };
const mfm = (id: string) => [{ namespace: "mfm", id }];
const rec = (ability_id: string, ability_type: string, extra: Record<string, unknown> = {}) => ({
  ability_id, name: ability_id, authored_by: "40kdc-community", game_version: gv, unit_ids: [], ability_type,
  effect: { type: "no-effect" }, scope: { duration: "permanent" }, ...extra,
});

function fixtureRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "mirror-test-"));
  const put = (rel: string, v: unknown) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), `${JSON.stringify(v, null, 2)}\n`);
  };
  put("data/core/adeptus-astartes/units.json", [
    { id: "warden-squad", name: "Warden Squad", ability_ids: ["grudge-engine", "deep-watch", "feel-no-pain-5-plus", "living-metal", "lost-rule"], external_refs: mfm("ds-warden") },
    { id: "warden-squad-patrol", name: "Warden Squad", ability_ids: ["grudge-engine"], external_refs: mfm("ds-warden-cp") },
    { id: "crimson-guard", name: "Crimson Guard", ability_ids: ["crimson-oath", "feel-no-pain-6"], external_refs: mfm("ds-ba") },
  ]);
  put("data/core/adeptus-astartes/factions.json", [{ id: "adeptus-astartes", name: "Adeptus Astartes", faction_rule_ids: ["warden-oath", "lost-rule"] }]);
  put("data/core/adeptus-astartes/detachments.json", [
    { id: "iron-host", name: "Iron Host", stratagem_ids: ["hold-fast-iron-host"], enhancement_ids: ["star-lantern-iron-host"], external_refs: mfm("det-a") },
  ]);
  put("data/core/adeptus-astartes/stratagems.json", [{ id: "hold-fast-iron-host", name: "HOLD FAST", ability_id: "hold-fast-iron-host", detachment_id: "iron-host", external_refs: mfm("st-1") }]);
  put("data/core/adeptus-astartes/enhancements.json", [{ id: "star-lantern-iron-host", name: "Star Lantern", ability_id: null, detachment_id: "iron-host", external_refs: mfm("en-1") }]);
  put("data/core/blood-angels/factions.json", [{ id: "blood-angels", name: "Blood Angels", faction_rule_ids: [] }]);
  put("data/core/necrons/units.json", [{ id: "tomb-walker", name: "Tomb Walker", ability_ids: ["living-metal", "deep-watch"], external_refs: mfm("ds-nec") }]);
  put("data/core/necrons/factions.json", [{ id: "necrons", name: "Necrons", faction_rule_ids: [] }]);
  put("data/enrichment/_core/abilities.json", []);
  put("data/enrichment/adeptus-astartes/abilities.json", [
    rec("grudge-engine", "unit", {
      unit_ids: ["warden-squad", "warden-squad-patrol"],
      effect: { type: "sequence", steps: [{ type: "ability-grant", modifier: { ability: "warden-oath" } }, { type: "ability-grant", modifier: { ability: "lost-rule" } }] },
    }),
    rec("deep-watch", "unit", { unit_ids: ["warden-squad"] }),
    rec("feel-no-pain-5-plus", "core", { unit_ids: ["warden-squad"], effect: { type: "feel-no-pain", target: "this-unit", modifier: { threshold: 5 } } }),
    rec("feel-no-pain-6", "core", { unit_ids: ["crimson-guard"] }),
    rec("living-metal", "unit", { unit_ids: ["warden-squad"] }),
    rec("lost-rule", "faction"),
    rec("warden-oath", "faction"),
    rec("crimson-oath", "unit", { unit_ids: ["crimson-guard"] }),
    rec("hold-fast-iron-host", "stratagem", { detachment_id: "iron-host" }),
  ]);
  put("data/enrichment/adeptus-astartes/phase-mappings.json", [
    { source_id: "lost-rule", source_type: "ability", phases: ["command"], game_version: gv, authored_by: "40kdc-community" },
    { source_id: "grudge-engine", source_type: "ability", phases: ["shooting"], game_version: gv, authored_by: "40kdc-community" },
  ]);
  put("data/enrichment/necrons/abilities.json", [rec("living-metal", "unit", { faction_id: "necrons", unit_ids: ["tomb-walker"] })]);
  return root;
}

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

async function mirror(root?: string): Promise<{ root: string; result: MirrorResult }> {
  const r = root ?? fixtureRepo();
  if (!root) roots.push(r);
  return { root: r, result: await runMirror(fixtureDump(), { root: r, validate: false, outside: false }) };
}

function apply(result: MirrorResult): void {
  for (const f of result.files) {
    mkdirSync(path.dirname(f.abs), { recursive: true });
    writeFileSync(f.abs, f.after);
  }
}

const idOf = (r: MirrorResult, dir: string, old: string) => r.plan.records.find((d) => d.dir === dir && d.oldId === old)?.newId;
const read = (root: string, rel: string) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const unit = (root: string, dir: string, id: string) => {
  const u = (read(root, `data/core/${dir}/units.json`) as { id: string; ability_ids: (string | { id: string; value: unknown })[] }[]).find((x) => x.id === id)!;
  return { ...u, ids: u.ability_ids.map((r) => (typeof r === "string" ? r : r.id)) };
};

describe("mfm:mirror", () => {
  it("is a no-op on a second run over the same dump", async () => {
    const { root, result } = await mirror();
    expect(result.files.length).toBeGreaterThan(0);
    apply(result);
    const again = await runMirror(fixtureDump(), { root, validate: false, outside: false });
    expect(again.files.map((f) => f.rel)).toEqual([]);
    expect(again.plan.stubs).toEqual([]);
    expect(again.plan.records.every((d) => d.newId === d.oldId)).toBe(true);
  });

  it("keeps a faction rule that shares a core rule's name apart from the core rule", async () => {
    const { root, result } = await mirror();
    expect(idOf(result, "adeptus-astartes", "deep-watch")).toBe("deep-watch-adeptus-astartes");
    // The core rule is its own bare-id record in _core; the Necron unit prints only the core one.
    expect(result.plan.stubs.map((s) => s.id)).toContain("deep-watch");
    apply(result);
    expect(unit(root, "adeptus-astartes", "warden-squad").ids).toEqual(expect.arrayContaining(["deep-watch-adeptus-astartes", "deep-watch"]));
    expect(unit(root, "necrons", "tomb-walker").ability_ids).toEqual(["living-metal-necrons", "deep-watch"]);
  });

  it("folds rated core copies into one _core record", async () => {
    const { root, result } = await mirror();
    expect(idOf(result, "adeptus-astartes", "feel-no-pain-5-plus")).toBe("feel-no-pain");
    expect(idOf(result, "adeptus-astartes", "feel-no-pain-6")).toBe("feel-no-pain");
    expect(result.plan.records.filter((d) => d.newId === "feel-no-pain" && d.survivor)).toHaveLength(1);
    const ratings = result.plan.units.find((u) => u.unitId === "crimson-guard")!.ratings;
    expect(ratings).toEqual({ "feel-no-pain": "6+" });
    apply(result);
    const core = (read(root, "data/enrichment/_core/abilities.json") as { ability_id: string; effect: unknown; faction_id?: unknown }[]).filter((r) => r.ability_id === "feel-no-pain");
    expect(core).toHaveLength(1);
    // The folded copy's hard-coded 5 becomes the unit's printed rating; a core record names no faction.
    expect(core[0]!.effect).toEqual({ type: "feel-no-pain", target: "this-unit", modifier: { threshold: { rating: true } } });
    expect(core[0]!).not.toHaveProperty("faction_id");
    expect(unit(root, "adeptus-astartes", "warden-squad").ability_ids).toContainEqual({ id: "feel-no-pain", value: 5 });
    expect((read(root, "data/enrichment/adeptus-astartes/abilities.json") as { ability_id: string }[]).some((r) => r.ability_id.startsWith("feel-no-pain"))).toBe(false);
  });

  it("gives a Combat Patrol variant its own record and points the patrol unit at it", async () => {
    const { root, result } = await mirror();
    expect(idOf(result, "adeptus-astartes", "grudge-engine")).toBe("grudge-engine-adeptus-astartes");
    expect(result.plan.stubs.map((s) => s.id)).toContain("grudge-engine-iron-vanguard-adeptus-astartes");
    apply(result);
    expect(unit(root, "adeptus-astartes", "warden-squad-patrol").ability_ids).toEqual(["grudge-engine-iron-vanguard-adeptus-astartes"]);
    expect(unit(root, "adeptus-astartes", "warden-squad").ability_ids).toContain("grudge-engine-adeptus-astartes");
    expect(unit(root, "adeptus-astartes", "warden-squad").ability_ids).not.toContain("grudge-engine-iron-vanguard-adeptus-astartes");
  });

  it("moves a supplement ability to the supplement's faction and suffix", async () => {
    const { root, result } = await mirror();
    expect(idOf(result, "adeptus-astartes", "crimson-oath")).toBe("crimson-oath-blood-angels");
    const created = result.files.find((f) => f.rel === "data/enrichment/blood-angels/abilities.json");
    expect(created?.exists).toBe(false);
    apply(result);
    const aa = read(root, "data/enrichment/adeptus-astartes/abilities.json") as { faction_id?: string }[];
    expect(aa.every((r) => r.faction_id === "adeptus-astartes")).toBe(true);
    expect((read(root, "data/enrichment/blood-angels/abilities.json") as { ability_id: string; faction_id: string }[]).map((r) => [r.ability_id, r.faction_id])).toEqual([["crimson-oath-blood-angels", "blood-angels"]]);
    expect((read(root, "data/enrichment/adeptus-astartes/abilities.json") as { ability_id: string }[]).map((r) => r.ability_id)).not.toContain("crimson-oath-blood-angels");
    expect(unit(root, "adeptus-astartes", "crimson-guard").ability_ids).toEqual(["crimson-oath-blood-angels", { id: "feel-no-pain", value: 6 }]);
  });

  it("removes a record absent from the dump and cascades to every reference", async () => {
    const { root, result } = await mirror();
    expect(result.plan.records.find((d) => d.oldId === "lost-rule")).toMatchObject({ newId: null, reason: "not-in-dump" });
    const copied = result.plan.records.find((d) => d.dir === "adeptus-astartes" && d.oldId === "living-metal");
    expect(copied).toMatchObject({ newId: null, reason: "foreign-faction-only" });
    // The grant that names it cannot be deleted without changing the rule: it is reported, not silently kept.
    expect(result.undecided).toContainEqual(expect.objectContaining({ kind: "dangling-ref", detail: expect.stringContaining("lost-rule") }));
    apply(result);
    expect(unit(root, "adeptus-astartes", "warden-squad").ids).not.toEqual(expect.arrayContaining(["lost-rule"]));
    expect(unit(root, "adeptus-astartes", "warden-squad").ids.some((id) => id.startsWith("living-metal"))).toBe(false);
    expect(read(root, "data/core/adeptus-astartes/factions.json")[0].faction_rule_ids).toEqual(["warden-oath-adeptus-astartes"]);
    const mappings = read(root, "data/enrichment/adeptus-astartes/phase-mappings.json") as { source_id: string }[];
    expect(mappings.map((m) => m.source_id)).toEqual(["grudge-engine-adeptus-astartes"]);
    const grudge = (read(root, "data/enrichment/adeptus-astartes/abilities.json") as { ability_id: string; effect: { steps: { modifier: { ability: string } }[] } }[]).find((r) => r.ability_id === "grudge-engine-adeptus-astartes")!;
    expect(grudge.effect.steps[0]!.modifier.ability).toBe("warden-oath-adeptus-astartes");
  });

  it("renames stratagem and enhancement entities with their ability and seeds the missing ability", async () => {
    const { root, result } = await mirror();
    apply(result);
    expect(read(root, "data/core/adeptus-astartes/stratagems.json")[0]).toMatchObject({ id: "hold-fast-iron-host-adeptus-astartes", ability_id: "hold-fast-iron-host-adeptus-astartes" });
    expect(read(root, "data/core/adeptus-astartes/enhancements.json")[0]).toMatchObject({ id: "star-lantern-iron-host-adeptus-astartes", ability_id: "star-lantern-iron-host-adeptus-astartes" });
    expect(read(root, "data/core/adeptus-astartes/detachments.json")[0]).toMatchObject({
      stratagem_ids: ["hold-fast-iron-host-adeptus-astartes"],
      enhancement_ids: ["star-lantern-iron-host-adeptus-astartes"],
    });
    const stub = (read(root, "data/enrichment/adeptus-astartes/abilities.json") as Record<string, unknown>[]).find((r) => r.ability_id === "star-lantern-iron-host-adeptus-astartes");
    expect(stub).toMatchObject({ stub: true, ability_type: "enhancement", effect: { type: "no-effect" }, detachment_id: "iron-host" });
  });

  it("never renames one old id to two new ids", async () => {
    const { result } = await mirror();
    expect(result.oneToMany).toEqual([]);
    // The record printed by both the codex and the patrol datasheet keeps one id; the other variant is a new record.
    const grudge = result.plan.records.filter((d) => d.oldId === "grudge-engine");
    expect(grudge).toHaveLength(1);
    expect(result.undecided).toContainEqual(expect.objectContaining({ kind: "variant-span", where: "adeptus-astartes/grudge-engine" }));
    const keys = result.plan.records.map((d) => `${d.dir}/${d.oldId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("holds back rewrites in a skipped dir and converges on a later full run", async () => {
    const fresh = fixtureRepo();
    roots.push(fresh);
    mkdirSync(path.join(fresh, "crates", "wh40kdc", "tests"), { recursive: true });
    writeFileSync(path.join(fresh, "crates", "wh40kdc", "tests", "a.rs"), 'let id = "warden-oath";\n');
    const first = await runMirror(fixtureDump(), { root: fresh, validate: false, skipDirs: ["crates"] });
    expect(first.files.some((f) => f.rel.startsWith("crates/"))).toBe(false);
    expect(first.pending).toEqual([{ file: "crates/wh40kdc/tests/a.rs", old: "warden-oath", new: "warden-oath-adeptus-astartes", location: "1" }]);
    apply(first);
    const history = first.plan.history();
    const second = await runMirror(fixtureDump(), { root: fresh, validate: false, history });
    expect(second.files.map((f) => f.rel)).toEqual(["crates/wh40kdc/tests/a.rs"]);
    apply(second);
    expect(readFileSync(path.join(fresh, "crates", "wh40kdc", "tests", "a.rs"), "utf8")).toBe('let id = "warden-oath-adeptus-astartes";\n');
    const third = await runMirror(fixtureDump(), { root: fresh, validate: false, history });
    expect(third.files).toEqual([]);
  });

  it("answers the mirrored id of a dump row for ingest tools", () => {
    const ids = mirrorIds(fixtureDump());
    expect(ids.idOf("stratagem", "st-1")).toBe("hold-fast-iron-host-adeptus-astartes");
    expect(ids.idOf("enhancement", "en-1")).toBe("star-lantern-iron-host-adeptus-astartes");
    expect(ids.idOf("datasheet_ability", "ab-watch-core")).toBe("deep-watch");
    expect(ids.idOf("datasheet_ability", "ab-grudge-cp")).toBe("grudge-engine-iron-vanguard-adeptus-astartes");
    expect(ids.idOf("datasheet_ability", "ab-crimson", "adeptus-astartes")).toBeUndefined();
    expect(ids.idOf("datasheet_ability", "ab-crimson", "blood-angels")).toBe("crimson-oath-blood-angels");
  });
});

// Rule and roster links: a second fabricated Necrons dump and repo.
const part = (id: string, owner: Record<string, string | null>, name: string) => ({
  id, ...owner, displayOrder: 1, ruleContainerId: null, type: "text", ...loc({ textContent: `${name} text.` }),
});

function linksDump(): MfmDump {
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

function linksRepo(): string {
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

describe("mfm:mirror links rules and rosters to what the dump prints", () => {
  it("replaces stale faction, detachment and roster links with the dump's, in display order", async () => {
    const root = linksRepo();
    const { files } = await runMirror(linksDump(), { root, validate: false, outside: false });
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
    const { plan } = await runMirror(linksDump(), { root: linksRepo(), validate: false, outside: false });
    expect(plan.units.find((u) => u.unitId === "bare-walker")?.after).toEqual([]);
    expect(plan.units.find((u) => u.unitId === "lost-walker")?.after).toEqual(["host-rule-necrons"]);
  });

  it("removes a record only a Legends book prints, and does not stub it back", async () => {
    const root = linksRepo();
    const { plan } = await runMirror(linksDump(), { root, validate: false, outside: false });
    expect(plan.records.find((d) => d.oldId === "old-gears-necrons")).toMatchObject({ newId: null, reason: "legends-only" });
    expect(plan.stubs.map((s) => s.id)).not.toContain("old-gears-necrons");
  });
});
