import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { factionRawText } from "../src/audit-phrasing.js";
import { loadGwText } from "../src/commands/translate.js";
import { assertPrivateOutDir, exportProse, grepProse } from "../src/mfm/prose-cli.js";
import { dumpRuleText, factionOfDataFile } from "../src/round6/migrate-vocabulary.js";
import { fixtureRepo } from "./prose-fixture.js";

const fx = fixtureRepo();
afterAll(() => fx.cleanup());
const text = (faction: string, id: string, extra: Record<string, unknown> = {}) => {
  const record = { ability_id: id, ...extra };
  const got = fx.repo.forRecord(faction, record as never);
  return got.status === "found" ? got.entry : got.status;
};
const w = (id: string) => fx.repo.faction("warden-host").get(id);

describe("record prose: each record resolves only through its own owner", () => {
  it("gives a unit ability the text its own faction's datasheet prints", () => {
    expect(w("grudge-engine")?.raw_text).toBe("Warden wagon text.");
    expect(fx.repo.faction("ember-court").get("grudge-engine")?.raw_text).toBe("Ember wagon text.");
  });

  it("reads a core ability from the Core Rules, not a datasheet reprint", () => {
    expect(w("deep-watch")?.raw_text).toBe("Core deep watch text.");
    expect(fx.repo.faction("_core").get("deep-watch")?.raw_text).toBe("Core deep watch text.");
  });

  it("reports two datasheets printing different texts as ambiguous, with no text", () => {
    const got = fx.repo.forRecord("warden-host", { ability_id: "twin-guns", ability_type: "unit", unit_ids: ["scout-wagon", "heavy-wagon"] });
    expect(got.status).toBe("ambiguous");
    expect(got.status === "ambiguous" && got.variants.map((v) => v.text).sort()).toEqual(["Heavy guns text.", "Scout guns text."]);
    expect(w("twin-guns")).toBeUndefined();
    // One datasheet alone is unambiguous.
    expect(text("warden-host", "twin-guns", { ability_type: "unit", unit_ids: ["scout-wagon"] })).toMatchObject({ raw_text: "Scout guns text." });
  });

  it("prefers the codex army rule over its Combat Patrol reprint", () => {
    expect(w("warden-oath")?.raw_text).toBe("Codex oath text.");
  });

  it("resolves detachment rules, enhancements (by detachment) and stratagems (by mfm ref) in store shape", () => {
    expect(w("iron-vigil-doctrine")?.raw_text).toBe("Doctrine text.");
    expect(w("star-lantern-iron-vigil")?.raw_text).toBe("Lantern text.");
    expect(w("hold-fast-iron-vigil")).toMatchObject({ when: "Any phase.", target: "One unit.", effect: "Hold **fast**.", source: { kind: "mfm", ref: "dump.json#st-1", edition: "11e" } });
    expect(w("hold-fast-iron-vigil")).not.toHaveProperty("raw_text");
    expect(fx.repo.faction("_core").get("counterstrike")).toMatchObject({ when: "Fight phase.", effect: "Strike back." });
  });

  it("returns missing for an ability no owner prints, never another owner's same-named text", () => {
    expect(w("lost-ability")).toBeUndefined();
    // Grudge Engine is printed by Iron Wagon only; on a unit that does not print it, nothing resolves.
    expect(text("warden-host", "grudge-engine", { ability_type: "unit", unit_ids: ["scout-wagon"] })).toBe("missing");
  });
});

describe("prose CLI", () => {
  it("refuses to export anywhere in the repo outside _private/", () => {
    expect(() => assertPrivateOutDir(join(fx.root, "data", "prose"), fx.root)).toThrow(/_private/);
    expect(() => assertPrivateOutDir(fx.root, fx.root)).toThrow(/_private/);
    expect(() => assertPrivateOutDir(join(fx.root, "_private", "prose"), fx.root)).not.toThrow();
  });

  it("exports store-shaped faction files and a {schema_version, factions} index", () => {
    const out = join(fx.root, "_private", "prose");
    exportProse(fx.repo, out);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
    expect(index.schema_version).toBe(1);
    expect(index.factions["ember-court"]["grudge-engine"].raw_text).toBe("Ember wagon text.");
    const rows = JSON.parse(readFileSync(join(out, "warden-host.json"), "utf8")) as { ability_id: string }[];
    expect(rows.map((r) => r.ability_id).sort()).toEqual(["deep-watch", "grudge-engine", "hold-fast-iron-vigil", "iron-vigil-doctrine", "star-lantern-iron-vigil", "warden-oath"]);
    expect(existsSync(join(out, "_core.json"))).toBe(true);
  });

  it("greps assembled prose per faction", () => {
    expect(grepProse(fx.repo, /wagon text/i).map((h) => `${h.faction}/${h.ability_id}`)).toEqual(["ember-court/grudge-engine", "warden-host/grudge-engine"]);
  });
});

describe("migrate-vocabulary rule text", () => {
  it("keys dump text by faction, so a shared id never borrows another faction's rule", () => {
    const m = dumpRuleText(fx.repo);
    expect(m.get("warden-host/grudge-engine")).toBe("Warden wagon text.");
    expect(m.get("ember-court/grudge-engine")).toBe("Ember wagon text.");
    expect(m.get("warden-host/hold-fast-iron-vigil")).toBe("Any phase.\nOne unit.\nHold **fast**.");
    expect(dumpRuleText(null).size).toBe(0);
  });

  it("reads the faction from core and enrichment paths only", () => {
    expect(factionOfDataFile("data/enrichment/orks/abilities.json")).toBe("orks");
    expect(factionOfDataFile("data/core/orks/stratagems.json")).toBe("orks");
    expect(factionOfDataFile("data/core/stratagems.json")).toBeUndefined();
    expect(factionOfDataFile("tools/test/fixtures/valid/abilities-good.json")).toBeUndefined();
  });
});

describe("switched readers", () => {
  it("audit-phrasing --review reads the faction's own dump text", () => {
    const raw = factionRawText("ember-court", fx.repo);
    expect([...raw]).toEqual([["grudge-engine", "Ember wagon text."]]);
  });

  it("translate --gw reads the abilities file's faction dir from the dump", () => {
    const file = join(fx.root, "data", "enrichment", "warden-host", "abilities.json");
    const gw = loadGwText(file, { gw: true }, (faction) => [...fx.repo.faction(faction).values()]);
    expect(gw.get("grudge-engine")).toBe("Warden wagon text.");
    expect(gw.get("hold-fast-iron-vigil")).toBe("Any phase.\nOne unit.\nHold **fast**.");
  });
});
