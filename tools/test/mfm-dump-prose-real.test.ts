import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { AmbiguousProseError, type DumpProse, loadDumpProse, plainBlock, type ProseQuery } from "../src/mfm/dump-prose.js";
import { DEFAULT_DUMP_PATH, loadDump, type MfmDump } from "../src/mfm/loader.js";
import { REPO_ROOT } from "../src/mfm/repo-files.js";

// Pins dump-prose against the real (gitignored) dump. Asserts row ids and structure, never GW prose.
const COVERAGE = path.join(REPO_ROOT, "_private", "phase4", "mfm-coverage.json");

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("dump prose over the real dump", () => {
  let prose: DumpProse;
  let dump: MfmDump;
  beforeAll(() => {
    dump = loadDump();
    prose = loadDumpProse();
  });
  const refs = (q: ProseQuery): string[] | null => prose.lookup(q)?.rows.map((r) => r.rowId) ?? null;
  const unit = (faction: string, id: string, ability: string): ProseQuery => ({ faction, owner: { kind: "unit", id }, ability });

  it("gives each Chaos legion's Rhino and Helbrute only the abilities its own datasheet prints", () => {
    // Meet Any Challenge is the World Eaters Rhino's; Sorcerous Support the Thousand Sons'.
    const wagon = refs(unit("world-eaters", "chaos-rhino", "meet-any-challenge-world-eaters"));
    expect(wagon).toHaveLength(1);
    expect(wagon?.[0]).toMatch(/^75ce5f78/);
    expect(refs(unit("thousand-sons", "chaos-rhino", "meet-any-challenge-world-eaters"))).toBeNull();
    expect(refs(unit("death-guard", "chaos-rhino", "meet-any-challenge-world-eaters"))).toBeNull();
    expect(refs(unit("thousand-sons", "chaos-rhino", "sorcerous-support-thousand-sons"))?.[0]).toMatch(/^12fdfa99/);
    expect(refs(unit("emperors-children", "chaos-rhino", "sorcerous-support-thousand-sons"))).toBeNull();
    expect(refs(unit("world-eaters", "helbrute", "frenzy"))?.[0]).toMatch(/^ae69f232/);
    expect(refs(unit("thousand-sons", "helbrute", "frenzy"))).toBeNull();
    expect(refs(unit("death-guard", "helbrute", "diseased-malice-death-guard"))?.[0]).toMatch(/^bf2dd24a/);
    expect(refs(unit("chaos-space-marines", "helbrute", "diseased-malice-death-guard"))).toBeNull();
  });

  it.skipIf(!fs.existsSync(COVERAGE))("returns none of the 109 foreign-faction texts the global name index returned", () => {
    const coverage = JSON.parse(fs.readFileSync(COVERAGE, "utf8")) as {
      records_detail: { faction: string; ability_id: string; status: string; owners?: string[]; dump_prose_current?: { row_faction?: string; ref?: string } }[];
    };
    const foreign = coverage.records_detail.filter((r) => r.status === "foreign-only" && r.dump_prose_current?.row_faction === "foreign");
    expect(foreign).toHaveLength(109);
    let checked = 0;
    for (const r of foreign) {
      const wrong = r.dump_prose_current!.ref!.replace("dump.json#", "");
      for (const owner of r.owners ?? [`faction ${r.faction}/${r.faction}`]) {
        const [kind, where] = owner.split(" ") as [string, string];
        const [faction, id] = where.split("/") as [string, string];
        const q: ProseQuery = kind === "unit" ? unit(faction, id, r.ability_id) : { faction, owner: { kind: "army" }, ability: r.ability_id };
        const got = prose.variants(q).flatMap((v) => v.rows.map((x) => x.rowId));
        expect(got, `${r.faction} ${r.ability_id} via ${owner}`).not.toContain(wrong);
        checked++;
      }
      // The row is still enumerated, under the factions whose datasheets print it.
      const home = prose.rows.filter((x) => x.rowId === wrong);
      expect(home.length, wrong).toBeGreaterThan(0);
      expect(home.every((x) => x.faction !== r.faction), wrong).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(109);
  });

  it("includes Nurgle's Gift's per-round image altText in the codex rule, and keeps the Combat Patrol rule as a second variant", () => {
    const q: ProseQuery = { faction: "death-guard", owner: { kind: "army" }, ability: "nurgles-gift", kinds: ["army-rule"] };
    const variants = prose.variants(q);
    expect(variants.map((v) => v.rows.map((r) => `${r.rowId.slice(0, 8)}:${r.publication?.combatPatrol}`)).sort()).toEqual([["13ae6c92:true"], ["59635a2a:false"]]);
    expect(() => prose.lookup(q)).toThrow(AmbiguousProseError);
    const codex = prose.lookup({ ...q, combatPatrol: false })!;
    const alt = (id: string) => plainBlock(dump.byId("rule_container_component").get(id)!.localisations.en!.altText)!;
    const rounds = ["07ba02bd-b918-4eae-a4e1-06bfd0ef8789", "c42a7ed0-29d8-4b69-82b2-9b35579ec62d", "a2229e18-f3c5-4a92-a6d0-a918efeddb23"].map(alt);
    const at = rounds.map((t) => codex.text!.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The repo's stub id resolves through the datasheet stub to the same codex text.
    expect(prose.lookup({ ...q, ability: "nurgles-gift-death-guard", kinds: undefined, combatPatrol: false })?.text).toBe(codex.text);
  });

  it("emits Battle Focus's battle-size image altText", () => {
    const rule = prose.rows.find((r) => r.rowId.startsWith("9b1c52a7") && r.kind === "army-rule")!;
    expect(rule.text).toContain(findAlt("eedb7574"));
  });

  it("finds the header sub-rules of an army rule (Fortify Takeover, Hostile Acquisition)", () => {
    for (const ability of ["fortify-takeover", "hostile-acquisition"]) {
      const hit = prose.lookup({ faction: "leagues-of-votann", owner: { kind: "army" }, ability, combatPatrol: false })!;
      expect(hit.rows.map((r) => [r.kind, r.parent?.rowId.slice(0, 8)])).toEqual([["rule-section", "a23f8bdf"]]);
      expect(hit.text).toBeTruthy();
    }
  });

  it("finds Counteroffensive under the repo's counter-offensive spelling", () => {
    const hit = prose.lookup({ faction: "_core", owner: { kind: "core" }, ability: "counteroffensive" })!;
    expect(hit.rows.map((r) => [r.kind, r.name, r.slug])).toEqual([["stratagem", "Counteroffensive", "counteroffensive"]]);
    expect(hit.ref).toBe("dump.json#33bd61f7-4741-4c27-a8d8-2e13b20ca121");
  });

  it("does not return a dump row no datasheet or detachment links", () => {
    const orphan = "4059d207"; // an Orks datasheet ability linked to nothing
    expect(prose.rows.some((r) => r.rowId.startsWith(orphan))).toBe(false);
    expect(prose.unowned.find((u) => u.rowId.startsWith(orphan))?.reason).toBe("no-owner");
    expect(prose.lookup({ faction: "orks", owner: { kind: "army" }, ability: "drive-by-dakka" })).toBeNull();
  });

  it("files supplements and the Deathwatch index under their own factions", () => {
    const factionOf = new Map<string, Set<string>>();
    for (const r of prose.rows) if (r.publication) factionOf.set(r.publication.name, (factionOf.get(r.publication.name) ?? new Set()).add(r.faction));
    expect([...factionOf.get("Index: Deathwatch")!]).toEqual(["deathwatch"]);
    expect([...factionOf.get("Codex Supplement: Dark Angels")!]).toEqual(["dark-angels"]);
    expect([...factionOf.get("Codex Supplement: Space Wolves")!]).toEqual(["space-wolves"]);
    expect([...factionOf.get("Codex Supplement: Black Templars")!]).toEqual(["black-templars"]);
    expect([...factionOf.get("Codex Supplement: Blood Angels")!]).toEqual(["blood-angels"]);
    expect([...factionOf.get("Codex: Space Marines")!]).toEqual(["adeptus-astartes"]);
  });

  it("keeps per-datasheet variants apart: each datasheet gets its own text", () => {
    // Codex Khorne Berzerkers and the Frenzied Reavers Combat Patrol Berzerkers print different Icon of Khorne texts.
    const codex = prose.lookup(unit("world-eaters", "khorne-berzerkers", "icon-of-khorne"))!;
    const patrol = prose.lookup(unit("world-eaters", "frenzied-reavers-khorne-berzerkers", "icon-of-khorne"))!;
    expect(codex.rows[0]!.publication?.combatPatrol).toBe(false);
    expect(patrol.rows[0]!.publication?.combatPatrol).toBe(true);
    expect(codex.text).not.toBe(patrol.text);
  });

  function findAlt(prefix: string): string {
    return plainBlock(dump.table("rule_container_component").find((c) => c.id.startsWith(prefix))!.localisations.en!.altText)!;
  }
});
