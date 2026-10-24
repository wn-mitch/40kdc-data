import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MfmDump } from "../src/mfm/loader.js";
import { runMirror } from "../src/mfm/mirror/mirror.js";
import { runReissue } from "../src/mfm/reissue.js";

// Fabricated names and wording only. Faction keywords are real so the chapter → Adeptus Astartes
// roster mapping applies.
const loc = (en: Record<string, unknown>) => ({ localisations: { en } });
const pub = (id: string, fk: string | null, extra: Record<string, unknown> = {}) => ({
  id, factionKeywordId: fk, isCombatPatrol: false, isLegends: false, isCoreRules: false, ...extra, ...loc({ name: id }),
});
const mfm = (id: string) => [{ namespace: "mfm", id }];
const gv = { edition: "11th", dataslate: "launch" };

function dump(extra: Record<string, unknown[]> = {}): MfmDump {
  const data = {
    faction_keyword: [
      { id: "fk-sm", parentFactionKeywordId: null, ...loc({ name: "Adeptus Astartes" }) },
      { id: "fk-um", parentFactionKeywordId: "fk-sm", ...loc({ name: "Ultramarines" }) },
      { id: "fk-nec", parentFactionKeywordId: null, ...loc({ name: "Necrons" }) },
    ],
    publication: [pub("Codex SM", "fk-sm"), pub("Codex Nec", "fk-nec"), pub("Core", null, { isCoreRules: true })],
    datasheet: [],
    datasheet_ability: [],
    datasheet_datasheet_ability: [],
    army_rule: [],
    rule_container_component: [],
    detachment: [
      // The reissued codex prints Iron Host again under a new id; a Necron detachment shares the name.
      { id: "det-new", publicationId: "Codex SM", ...loc({ name: "Iron Host" }) },
      { id: "det-nec", publicationId: "Codex Nec", ...loc({ name: "Iron Host" }) },
    ],
    detachment_rule: [],
    stratagem: [
      { id: "st-new", detachmentId: "det-new", publicationId: "Codex SM", ...loc({ name: "Hold  fast", whenRules: "Any phase." }) },
      { id: "st-fresh", detachmentId: "det-new", publicationId: "Codex SM", ...loc({ name: "Fresh Plan", whenRules: "Any phase." }) },
    ],
    enhancement: [],
    ...extra,
  };
  return new MfmDump({ data: data as never });
}

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function repo(files: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "reissue-test-"));
  roots.push(root);
  for (const [rel, value] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}
const read = (root: string, rel: string) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));

describe("reissued-refs", () => {
  const smFiles = (dir: string) => ({
    [`data/core/${dir}/detachments.json`]: [{ id: "iron-host", name: "Iron Host", external_refs: mfm("det-old") }],
    [`data/core/${dir}/stratagems.json`]: [
      { id: "hold-fast-iron-host", name: "HOLD FAST", detachment_id: "iron-host", external_refs: mfm("st-old") },
      { id: "old-gambit-iron-host", name: "Old Gambit", detachment_id: "iron-host", external_refs: mfm("st-gone") },
    ],
  });

  it("moves every replicated copy of a dead ref to the same-named reissued row, and retires the rest", () => {
    const root = repo({ ...smFiles("adeptus-astartes"), ...smFiles("ultramarines") });
    const report = runReissue(dump(), path.join(root, "data/core"));
    expect(report.moved.map((m) => [m.kind, m.from, m.to, m.dirs])).toEqual([
      ["detachment", "det-old", "det-new", ["adeptus-astartes", "ultramarines"]],
      ["stratagem", "st-old", "st-new", ["adeptus-astartes", "ultramarines"]],
    ]);
    expect(report.retired.map((r) => r.from)).toEqual(["st-gone"]);
    for (const s of report.staged) writeFileSync(s.path, s.text!);
    for (const dir of ["adeptus-astartes", "ultramarines"]) {
      expect(read(root, `data/core/${dir}/detachments.json`)[0].external_refs).toEqual(mfm("det-new"));
      expect(read(root, `data/core/${dir}/stratagems.json`).map((s: { external_refs: unknown }) => s.external_refs)).toEqual([mfm("st-new"), mfm("st-gone")]);
    }
    // A second run finds nothing more to move.
    expect(runReissue(dump(), path.join(root, "data/core")).moved).toEqual([]);
  });

  it("moves nothing when two unreferenced rows fit, or when the only fit is already referenced", () => {
    const twin = { id: "det-twin", publicationId: "Codex SM", ...loc({ name: "Iron Host" }) };
    const ambiguous = runReissue(dump({ detachment: [{ id: "det-new", publicationId: "Codex SM", ...loc({ name: "Iron Host" }) }, twin] }), path.join(repo(smFiles("adeptus-astartes")), "data/core"));
    expect(ambiguous.moved.filter((m) => m.kind === "detachment")).toEqual([]);
    expect(ambiguous.ambiguous.map((a) => a.candidates)).toEqual([["det-new", "det-twin"]]);

    const claimed = repo({
      ...smFiles("adeptus-astartes"),
      "data/core/necrons/detachments.json": [{ id: "iron-host", name: "Iron Host", external_refs: mfm("det-new") }],
    });
    // det-new is already some record's live ref; the Necron row belongs to another faction.
    expect(runReissue(dump(), path.join(claimed, "data/core")).retired.map((r) => r.from)).toContain("det-old");
  });
});

describe("mfm:mirror on a reissued codex", () => {
  const rec = (ability_id: string, ability_type: string, extra: Record<string, unknown> = {}) => ({
    ability_id, name: ability_id, authored_by: "40kdc-community", game_version: gv, unit_ids: [], ability_type,
    effect: { type: "no-effect" }, scope: { duration: "permanent" }, ...extra,
  });

  it("drops a name-followed chapter copy of an entity another dir carries by dump ref, keeping its references", async () => {
    const root = repo({
      "data/core/adeptus-astartes/detachments.json": [{ id: "iron-host", name: "Iron Host", stratagem_ids: ["hold-fast-iron-host"], external_refs: mfm("det-new") }],
      "data/core/adeptus-astartes/stratagems.json": [{ id: "hold-fast-iron-host", name: "HOLD FAST", ability_id: "hold-fast-iron-host", detachment_id: "iron-host", external_refs: mfm("st-new") }],
      "data/core/adeptus-astartes/factions.json": [{ id: "adeptus-astartes", name: "Adeptus Astartes", faction_rule_ids: [] }],
      "data/core/ultramarines/detachments.json": [{ id: "iron-host", name: "Iron Host", stratagem_ids: ["hold-fast-legacy"], external_refs: mfm("det-new") }],
      // A legacy copy with no dump ref and different content, found only through its ability name.
      "data/core/ultramarines/stratagems.json": [{ id: "hold-fast-legacy", name: "HOLD FAST", ability_id: "hold-fast-iron-host", detachment_id: "other-host" }],
      "data/core/ultramarines/factions.json": [{ id: "ultramarines", name: "Ultramarines", faction_rule_ids: [] }],
      "data/enrichment/_core/abilities.json": [],
      "data/enrichment/adeptus-astartes/abilities.json": [rec("hold-fast-iron-host", "stratagem", { detachment_id: "iron-host" })],
    });
    const { plan, files } = await runMirror(dump(), { root, validate: false, outside: false });
    expect(plan.entities.find((e) => e.oldId === "hold-fast-legacy")).toMatchObject({ newId: "hold-fast-iron-host-adeptus-astartes", replica: true });
    for (const f of files) writeFileSync(f.abs, f.after);
    expect(read(root, "data/core/ultramarines/stratagems.json")).toEqual([]);
    expect(read(root, "data/core/ultramarines/detachments.json")[0].stratagem_ids).toEqual(["hold-fast-iron-host-adeptus-astartes"]);
    expect(read(root, "data/core/adeptus-astartes/stratagems.json")[0].id).toBe("hold-fast-iron-host-adeptus-astartes");
  });

  it("keeps a supplement detachment only where the dump offers it, and an everyone-detachment everywhere", async () => {
    const d = dump({
      faction_keyword: [
        { id: "fk-sm", parentFactionKeywordId: null, ...loc({ name: "Adeptus Astartes" }) },
        { id: "fk-um", parentFactionKeywordId: "fk-sm", ...loc({ name: "Ultramarines" }) },
        { id: "fk-if", parentFactionKeywordId: "fk-sm", ...loc({ name: "Imperial Fists" }) },
        { id: "fk-dw", parentFactionKeywordId: "fk-sm", ...loc({ name: "Deathwatch" }) },
      ],
      publication: [pub("Codex SM", "fk-sm"), pub("Supplement IF", "fk-if"), pub("Codex DW", "fk-dw"), pub("Core", null, { isCoreRules: true })],
      detachment: [
        { id: "det-wall", publicationId: "Supplement IF", ...loc({ name: "Stone Wall" }) },
        { id: "det-aid", publicationId: "Codex DW", ...loc({ name: "Watch Aid" }) },
      ],
      detachment_faction_keyword: [
        { id: "a1", detachmentId: "det-wall", factionKeywordId: "fk-if" },
        { id: "a2", detachmentId: "det-aid", factionKeywordId: "fk-sm" },
        { id: "a3", detachmentId: "det-aid", factionKeywordId: "fk-dw" },
      ],
      stratagem: [{ id: "st-wall", detachmentId: "det-wall", publicationId: "Supplement IF", ...loc({ name: "Brace", whenRules: "Any phase." }) }],
    });
    const wall = { id: "stone-wall", name: "Stone Wall", external_refs: mfm("det-wall") };
    const aid = { id: "watch-aid", name: "Watch Aid", external_refs: mfm("det-aid") };
    const brace = { id: "brace-stone-wall-imperial-fists", name: "Brace", ability_id: "brace-stone-wall-imperial-fists", detachment_id: "stone-wall", external_refs: mfm("st-wall") };
    const root = repo({
      "data/core/imperial-fists/detachments.json": [wall],
      "data/core/imperial-fists/stratagems.json": [brace],
      "data/core/imperial-fists/factions.json": [{ id: "imperial-fists", name: "Imperial Fists", faction_rule_ids: [] }],
      "data/core/ultramarines/detachments.json": [wall, aid],
      "data/core/ultramarines/stratagems.json": [brace],
      "data/core/ultramarines/factions.json": [{ id: "ultramarines", name: "Ultramarines", faction_rule_ids: [] }],
      "data/enrichment/_core/abilities.json": [],
      "data/enrichment/imperial-fists/abilities.json": [rec("brace-stone-wall-imperial-fists", "stratagem", { detachment_id: "stone-wall" })],
    });
    const { plan } = await runMirror(d, { root, validate: false, outside: false });
    const kept = (kind: string, dir: string, id: string) => plan.entities.find((e) => e.kind === kind && e.dir === dir && e.oldId === id)?.newId ?? null;
    expect(kept("detachment", "imperial-fists", "stone-wall")).toBe("stone-wall");
    expect(kept("detachment", "ultramarines", "stone-wall")).toBeNull();
    expect(kept("stratagem", "ultramarines", "brace-stone-wall-imperial-fists")).toBeNull();
    expect(kept("stratagem", "imperial-fists", "brace-stone-wall-imperial-fists")).toBe("brace-stone-wall-imperial-fists");
    // Offered to the whole Adeptus Astartes roster, which the chapter replicates.
    expect(kept("detachment", "ultramarines", "watch-aid")).toBe("watch-aid");
  });

  it("leaves a code literal alone on a line marked to keep it", async () => {
    const root = repo({
      "data/core/adeptus-astartes/detachments.json": [{ id: "iron-host", name: "Iron Host", stratagem_ids: ["hold-fast-iron-host"], external_refs: mfm("det-new") }],
      "data/core/adeptus-astartes/stratagems.json": [{ id: "hold-fast-iron-host", name: "HOLD FAST", ability_id: "hold-fast-iron-host", detachment_id: "iron-host", external_refs: mfm("st-new") }],
      "data/core/adeptus-astartes/factions.json": [{ id: "adeptus-astartes", name: "Adeptus Astartes", faction_rule_ids: [] }],
      "data/enrichment/_core/abilities.json": [],
      "data/enrichment/adeptus-astartes/abilities.json": [rec("hold-fast-iron-host", "stratagem", { detachment_id: "iron-host" })],
    });
    // A recorded TS fixture is re-recorded from its source, never rewritten id by id.
    const recorded = path.join(root, "crates/wh40kdc/tests/fixtures/phase4-cruncher.json");
    mkdirSync(path.dirname(recorded), { recursive: true });
    writeFileSync(recorded, JSON.stringify([{ fn: "effectToBuffs", input: { source: { kind: "ability", abilityId: "hold-fast-iron-host" } } }]));
    const file = path.join(root, "tools/test/a.test.ts");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'const a = "hold-fast-iron-host";\nconst b = "hold-fast-iron-host"; // mfm:mirror keep\n');
    const { files } = await runMirror(dump(), { root, validate: false, outside: true });
    expect(files.some((f) => f.rel.endsWith("phase4-cruncher.json"))).toBe(false);
    expect(files.find((f) => f.rel === "tools/test/a.test.ts")?.after).toBe(
      'const a = "hold-fast-iron-host-adeptus-astartes";\nconst b = "hold-fast-iron-host"; // mfm:mirror keep\n',
    );
  });

  it("points a kept stratagem record at a detachment that prints it, not the one it came from", async () => {
    const root = repo({
      "data/core/adeptus-astartes/detachments.json": [
        { id: "iron-host", name: "Iron Host", stratagem_ids: ["hold-fast-iron-host"], external_refs: mfm("det-new") },
      ],
      "data/core/adeptus-astartes/stratagems.json": [{ id: "hold-fast-iron-host", name: "HOLD FAST", ability_id: "hold-fast-iron-host", detachment_id: "iron-host", external_refs: mfm("st-new") }],
      "data/core/adeptus-astartes/factions.json": [{ id: "adeptus-astartes", name: "Adeptus Astartes", faction_rule_ids: [] }],
      "data/enrichment/_core/abilities.json": [],
      // Folded in from a retired detachment: its own detachment_id still names that one.
      "data/enrichment/adeptus-astartes/abilities.json": [rec("hold-fast-iron-host", "stratagem", { detachment_id: "retired-host" })],
    });
    const { files } = await runMirror(dump(), { root, validate: false, outside: false });
    for (const f of files) writeFileSync(f.abs, f.after);
    const [record] = read(root, "data/enrichment/adeptus-astartes/abilities.json") as Array<{ ability_id: string; detachment_id: string }>;
    expect(record).toMatchObject({ ability_id: "hold-fast-iron-host-adeptus-astartes", detachment_id: "iron-host" });
  });

  it("lists a printed rating its record cannot read unrated, and reports it", async () => {
    const core = (id: string, name: string) => ({ id, abilityType: "core", armyRuleId: null, detachmentRuleId: null, ...loc({ name, rules: "Core text." }) });
    const d = dump({
      datasheet: [{ id: "ds-a", publicationId: "Codex SM", isLegends: false, allegianceAbilityGroupId: null, ...loc({ name: "Shade" }) }],
      datasheet_ability: [core("ab-lw", "Lone Watch"), core("ab-lw15", 'Lone Watch 15"')],
      datasheet_datasheet_ability: [{ id: "l1", datasheetId: "ds-a", datasheetAbilityId: "ab-lw15", ...loc({}) }],
    });
    const root = repo({
      "data/core/adeptus-astartes/units.json": [{ id: "shade", name: "Shade", ability_ids: [], external_refs: mfm("ds-a") }],
      "data/core/adeptus-astartes/factions.json": [{ id: "adeptus-astartes", name: "Adeptus Astartes", faction_rule_ids: [] }],
      // The core record fixes its range, so it has no {rating: true} to read the printed 15.
      "data/enrichment/_core/abilities.json": [rec("lone-watch", "core", { effect: { type: "targeting", modifier: { range: { inches: 12 } } } })],
      "data/enrichment/adeptus-astartes/abilities.json": [],
    });
    const { plan, undecided } = await runMirror(d, { root, validate: false, outside: false });
    const shade = plan.units.find((u) => u.unitId === "shade")!;
    expect(shade.after).toEqual(["lone-watch"]);
    expect(shade.unreadRatings).toEqual({ "lone-watch": '15"' });
    expect(undecided).toContainEqual(expect.objectContaining({ kind: "rating-unread", where: "adeptus-astartes/shade" }));
  });
});
