import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_DUMP_PATH, loadDump } from "../src/mfm/loader.js";
import { CORE_DIR } from "../src/mfm/repo-files.js";
import {
  parseBaseSize,
  parseNominalOval,
  parseDumpBaseSize,
  parseBareOval,
  parseBareBaseSizeList,
  bareListConsistent,
  bareListAttributionProblem,
  BARE_LIST_ATTRIBUTIONS,
  parseLabelledBaseSizes,
  baseSizeEqual,
  baseSizesWithinRounding,
  baseSizeDecision,
  baseSizeLabelMatches,
  runBaseSizes,
} from "../src/mfm/base-sizes.js";
import type { BaseSizeReport } from "../src/mfm/base-sizes.js";

/**
 * MFM base-size reconcile. The parsers, the label ladder, and the reconcile
 * decision are the load-bearing pieces: together they decide which dump strings
 * may become a model's base. They must never fabricate one from a category, a
 * bare list, or a name coincidence, and they must never keep a stale authored
 * value the dump contradicts — except inside the dump's own oval rounding slack,
 * which is why the decision is pinned directly rather than only through the data.
 */

interface RawRecord {
  id?: string;
  unit_id?: string;
  base_size_mm?: Record<string, unknown>;
  models?: { name: string; base_size_mm?: Record<string, unknown> }[];
}

/** The repo-side record a reconcile would have written (unit or composition). */
function readRecord(file: string, id: string): RawRecord | undefined {
  const rows = JSON.parse(fs.readFileSync(path.join(CORE_DIR, file), "utf8")) as RawRecord[];
  return rows.find((r) => r.id === id || r.unit_id === id);
}

describe("parseBaseSize (closed set)", () => {
  it("parses a clean round diameter, including a decimal", () => {
    expect(parseBaseSize("40mm")).toEqual({ shape: "round", diameter: 40 });
    expect(parseBaseSize("28.5mm")).toEqual({ shape: "round", diameter: 28.5 });
  });

  it("parses an oval with and without the 'Oval Base' suffix and spacing", () => {
    expect(parseBaseSize("120 x 92mm Oval Base")).toEqual({ shape: "oval", width: 120, length: 92 });
    expect(parseBaseSize("75x42mm")).toEqual({ shape: "oval", width: 75, length: 42 });
    expect(parseBaseSize("60x35.5mm Oval Base")).toEqual({ shape: "oval", width: 60, length: 35.5 });
  });

  it("skips categories, per-model/multi strings, and ambiguous ovals", () => {
    for (const raw of [
      "Hull",
      "Large Flying Base",
      "Small Flying Base",
      "Unique",
      "None",
      "25mm, 28.5mm", // comma multi
      "Sword Brother: 40mm\nInitiates: 32mm", // per-model
      "105mm oval", // nominal oval, resolved by parseNominalOval instead
      "150mm Oval Base", // nominal oval
      "",
      null,
      undefined,
    ]) {
      expect(parseBaseSize(raw)).toBeNull();
    }
  });
});

describe("parseNominalOval (the dump's shorthand for the two nominal ovals)", () => {
  it("resolves both spellings to the guide's dimensions", () => {
    expect(parseNominalOval("105mm oval")).toEqual({ shape: "oval", width: 105, length: 70 });
    expect(parseNominalOval("105mm Oval Base")).toEqual({ shape: "oval", width: 105, length: 70 });
    expect(parseNominalOval("150mm Oval Base")).toEqual({ shape: "oval", width: 150, length: 95 });
  });

  it("stays null for every other single-number string", () => {
    for (const raw of ["160mm", "150mm", "105mm", "Hull", "40mm", "", null, undefined]) {
      expect(parseNominalOval(raw)).toBeNull();
    }
  });
});

describe("parseDumpBaseSize (everything the dump can express in millimetres)", () => {
  it("takes a clean round/oval first and falls back to a nominal oval", () => {
    expect(parseDumpBaseSize("40mm")).toEqual({ shape: "round", diameter: 40 });
    expect(parseDumpBaseSize("120 x 92mm Oval Base")).toEqual({ shape: "oval", width: 120, length: 92 });
    expect(parseDumpBaseSize("105mm oval")).toEqual({ shape: "oval", width: 105, length: 70 });
  });

  it("reads the bare 75mm and 120mm shorthand as the ovals GW makes, and other bare sizes as round", () => {
    expect(parseBareOval("75mm")).toEqual({ shape: "oval", width: 75, length: 42 });
    expect(parseDumpBaseSize("120mm")).toEqual({ shape: "oval", width: 120, length: 92 });
    expect(parseDumpBaseSize("75mm")).toEqual({ shape: "oval", width: 75, length: 42 });
    for (const raw of ["40mm", "150mm", "130mm", "28.5mm"]) expect(parseBareOval(raw), raw).toBeNull();
    expect(parseDumpBaseSize("150mm")).toEqual({ shape: "round", diameter: 150 });
  });

  it("stays null for categories and bare lists", () => {
    expect(parseDumpBaseSize("Hull")).toBeNull();
    expect(parseDumpBaseSize("None")).toBeNull();
    expect(parseDumpBaseSize("32mm, 40mm")).toBeNull();
    expect(parseDumpBaseSize(null)).toBeNull();
  });
});

describe("bare lists (sorted sizes, no model attribution)", () => {
  const r = (diameter: number) => ({ shape: "round" as const, diameter });
  it("parses a comma list of sizes and nothing else", () => {
    expect(parseBareBaseSizeList("28.5mm, 32mm, 40mm")).toEqual([r(28.5), r(32), r(40)]);
    expect(parseBareBaseSizeList("60mm, 60x35.5mm Oval Base")).toEqual([r(60), { shape: "oval", width: 60, length: 35.5 }]);
    for (const raw of ["40mm", "Blessed Blade: 28.5mm", "32mm, Hull", "Proctor-Vigilant, Vigilants: 28.5mm", "", null]) {
      expect(parseBareBaseSizeList(raw), String(raw)).toBeNull();
    }
  });

  it("is consistent only when the authored bases are exactly the listed sizes", () => {
    const list = [r(28.5), r(32), r(40)];
    expect(bareListConsistent([r(40), r(32), r(28.5)], list)).toBe(true);
    // Every model on 40mm: no model carries the listed 28.5mm or 32mm.
    expect(bareListConsistent([r(40), r(40), r(40)], list)).toBe(false);
    // An unlisted size is wrong even while other models are still empty.
    expect(bareListConsistent([r(50), undefined, undefined], list)).toBe(false);
    // Empty models are no evidence that a listed size is missing.
    expect(bareListConsistent([r(40), undefined, undefined], list)).toBe(true);
    // The app's 1 mm oval rounding still counts as listed.
    expect(bareListConsistent([{ shape: "oval", width: 75, length: 42 }, r(32)], [r(32), { shape: "oval", width: 74, length: 42 }])).toBe(true);
  });
});

describe("reviewed bare-list attributions", () => {
  const crusader = { list: "28.5mm, 32mm, 40mm", unit: "32mm", models: { "Sword Brother": "40mm", Initiate: "32mm", Neophyte: "28.5mm" } };
  const names = ["Sword Brother", "Initiate", "Neophyte"];
  it("holds only for the reviewed label, every model, and exactly the listed sizes", () => {
    expect(bareListAttributionProblem(crusader, "28.5mm, 32mm, 40mm", names)).toBeNull();
    expect(bareListAttributionProblem(crusader, "28.5mm, 32mm, 50mm", names)).toMatch(/now prints/u);
    expect(bareListAttributionProblem(crusader, "28.5mm, 32mm, 40mm", [...names, "Sergeant"])).toMatch(/no base for Sergeant/u);
    expect(bareListAttributionProblem(crusader, "28.5mm, 32mm, 40mm", names.slice(0, 2))).toMatch(/no composition model named Neophyte/u);
    expect(bareListAttributionProblem({ ...crusader, models: { ...crusader.models, Neophyte: "32mm" } }, "28.5mm, 32mm, 40mm", names)).toMatch(/exactly the listed/u);
    expect(bareListAttributionProblem({ ...crusader, unit: "50mm" }, "28.5mm, 32mm, 40mm", names)).toMatch(/unit base/u);
  });

  it("every committed entry is internally consistent", () => {
    for (const [key, entry] of Object.entries(BARE_LIST_ATTRIBUTIONS)) {
      expect(bareListAttributionProblem(entry, entry.list, Object.keys(entry.models)), key).toBeNull();
    }
  });
});

describe("parseLabelledBaseSizes (per-model dump strings)", () => {
  it("splits one line per model, keeping every label on the line", () => {
    expect(parseLabelledBaseSizes("Sword Brother: 40mm\nInitiates: 32mm")).toEqual([
      { labels: ["Sword Brother"], base: { shape: "round", diameter: 40 }, otherModels: false },
      { labels: ["Initiates"], base: { shape: "round", diameter: 32 }, otherModels: false },
    ]);
    expect(parseLabelledBaseSizes("Kill Team Sergeant, Deathwatch Veterans: 32mm")).toEqual([
      { labels: ["Kill Team Sergeant", "Deathwatch Veterans"], base: { shape: "round", diameter: 32 }, otherModels: false },
    ]);
    // The LAST colon separates the size, so a unit-name prefix survives as a label.
    expect(parseLabelledBaseSizes("The Silent King: Szarekh: 100mm")).toEqual([
      { labels: ["The Silent King", "Szarekh"], base: { shape: "round", diameter: 100 }, otherModels: false },
    ]);
  });

  it("flags the catch-all 'Other models' line", () => {
    const parsed = parseLabelledBaseSizes("Kill Team Infiltrators with bolt sniper rifles: 40mm\nOther models: 32mm");
    expect(parsed).toHaveLength(2);
    expect(parsed![1]).toEqual({ labels: ["Other models"], base: { shape: "round", diameter: 32 }, otherModels: true });
  });

  it("returns null for anything that is not a fully labelled list", () => {
    for (const raw of ["32mm", "Hull", "32mm, 40mm", "Ratlings: 25mm\nHull", "", null, undefined]) {
      expect(parseLabelledBaseSizes(raw)).toBeNull();
    }
  });
});

describe("baseSizeEqual (dimensional, ignores draft)", () => {
  it("compares round by diameter and oval by width+length", () => {
    expect(baseSizeEqual({ shape: "round", diameter: 40, draft: true }, { shape: "round", diameter: 40 })).toBe(true);
    expect(baseSizeEqual({ shape: "round", diameter: 40 }, { shape: "round", diameter: 32 })).toBe(false);
    expect(baseSizeEqual({ shape: "oval", width: 120, length: 92 }, { shape: "oval", width: 120, length: 92 })).toBe(true);
    expect(baseSizeEqual({ shape: "oval", width: 120, length: 92 }, { shape: "oval", width: 120, length: 90 })).toBe(false);
    expect(baseSizeEqual({ shape: "round", diameter: 40 }, { shape: "oval", width: 40, length: 40 })).toBe(false);
    expect(baseSizeEqual(undefined, { shape: "round", diameter: 40 })).toBe(false);
  });
});

describe("baseSizesWithinRounding (the dump's oval rounding slack)", () => {
  it("accepts a 1 mm difference on the same shape", () => {
    expect(baseSizesWithinRounding({ shape: "oval", width: 75, length: 42 }, { shape: "oval", width: 74, length: 42 })).toBe(true);
    expect(baseSizesWithinRounding({ shape: "oval", width: 60, length: 35.5 }, { shape: "oval", width: 60, length: 35 })).toBe(true);
    expect(baseSizesWithinRounding({ shape: "round", diameter: 40 }, { shape: "round", diameter: 41 })).toBe(true);
  });

  it("rejects a larger difference or a different shape", () => {
    expect(baseSizesWithinRounding({ shape: "round", diameter: 40 }, { shape: "round", diameter: 50 })).toBe(false);
    expect(baseSizesWithinRounding({ shape: "round", diameter: 40 }, { shape: "oval", width: 40, length: 40 })).toBe(false);
    expect(baseSizesWithinRounding({ shape: "oval", width: 105, length: 70 }, { shape: "oval", width: 105, length: 68 })).toBe(false);
    expect(baseSizesWithinRounding(undefined, { shape: "round", diameter: 40 })).toBe(false);
  });
});

describe("baseSizeDecision (the reconcile policy)", () => {
  it("fills an empty slot and de-drafts a provisional one", () => {
    expect(baseSizeDecision(undefined, { shape: "round", diameter: 40 })).toBe("fill");
    expect(baseSizeDecision(null, { shape: "round", diameter: 40 })).toBe("fill");
    expect(baseSizeDecision({ shape: "round", diameter: 40, draft: true }, { shape: "round", diameter: 40 })).toBe("dedraft");
    expect(baseSizeDecision({ shape: "round", diameter: 40 }, { shape: "round", diameter: 40 })).toBe("confirm");
  });

  it("corrects a hand-authored value the dump contradicts — the dump is authoritative", () => {
    // The pre-change policy surfaced this case instead of writing it, which left
    // the Nightbringer on a 40mm base while the MFM said 90mm.
    expect(baseSizeDecision({ shape: "round", diameter: 40 }, { shape: "round", diameter: 90 })).toBe("correct");
    expect(baseSizeDecision({ shape: "flying-base", size: "large", draft: true }, { shape: "oval", width: 105, length: 70 })).toBe("correct");
  });

  it("keeps an authored value only inside the dump's rounding slack", () => {
    expect(baseSizeDecision({ shape: "oval", width: 75, length: 42 }, { shape: "oval", width: 74, length: 42 })).toBe("rounding-kept");
  });
});

describe("baseSizeLabelMatches (dump label → repo model name)", () => {
  it("matches across plural, qualifier, and equipment-suffix drift", () => {
    for (const [label, model] of [
      ["E-COG", "E-COG with Autoch-pattern Bolt Pistol"],
      ["Ratlings", "Ratling Sniper"],
      ["Deathwatch Veterans", "Deathwatch Veteran with Power Sword"],
      ["Wolfquad", "Atalan Wolfquad"],
      ["Nodebeast", "Neurogaunt Nodebeast"],
      ["Saint Celestine", "Celestine"],
      ["Hunting Wolves", "Hunting Wolf"],
      ["Brôkhyr Iron-master", "Brôkhyr Iron-master"],
      ["The Enforcer", "The Enforcer"],
    ]) {
      expect(baseSizeLabelMatches(label, model), `${label} ~ ${model}`).toBe(true);
    }
  });

  it("refuses near-misses, the dump's own typo, and equipment names", () => {
    for (const [label, model] of [
      ["Kill Team Sergeant", "Watch Sergeant"],
      ["Heavy Weapons Squad", "Heavy Weapons Gunner"],
      ["Mindwhich", "Mindwitch"],
      ["Transuranic Arquebus", "Skitarii Ranger"],
      // Longer than the model name: must not claim the base model, or the dump's
      // "Other models" line would have nothing left to fill.
      ["Kill Team Infiltrators with bolt sniper rifles", "Kill Team Infiltrator"],
    ]) {
      expect(baseSizeLabelMatches(label, model), `${label} !~ ${model}`).toBe(false);
    }
  });
});

describe.skipIf(!fs.existsSync(DEFAULT_DUMP_PATH))("base-size reconcile over the real dump", () => {
  // Load the dump lazily in beforeAll — never in the describe body, which Vitest
  // executes at collection time regardless of skipIf, before the guard applies.
  let report: BaseSizeReport;
  beforeAll(() => {
    report = runBaseSizes(loadDump());
  });

  it("is idempotent after apply — nothing left to fill, correct, or stage", () => {
    expect(report.filled).toEqual([]);
    expect(report.corrected).toEqual([]);
    expect(report.dedrafted).toEqual([]);
    expect(report.listDrafted).toEqual([]);
    expect(report.attributionRefused).toEqual([]);
    expect(report.attributionUnused).toEqual([]);
    expect(report.staged).toEqual([]);
    expect(report.confirmed.units).toBeGreaterThan(700);
  });

  it("carries the dump's base at unit and model level where the guide was wrong", () => {
    // The C'tan Shard of the Nightbringer shipped on the guide's 40mm base; the MFM says 90mm.
    expect(readRecord("necrons/units.json", "ctan-shard-of-the-nightbringer")?.base_size_mm).toEqual({
      shape: "round",
      diameter: 90,
    });
    expect(readRecord("necrons/unit-compositions.json", "ctan-shard-of-the-nightbringer")?.models?.map((m) => m.base_size_mm)).toEqual([
      { shape: "round", diameter: 90 },
    ]);
  });

  it("keeps exactly the authored values inside the dump's own rounding slack", () => {
    const kept = report.roundingKept.map((c) => `${c.dir}/${c.unit}${c.model ? ` :: ${c.model}` : ""}`).sort();
    expect(kept).toEqual([
      "aeldari/yvraine",
      "aeldari/yvraine :: Yvraine",
      "astra-militarum/attilan-rough-riders",
      "astra-militarum/attilan-rough-riders :: Rough Rider",
      "astra-militarum/attilan-rough-riders :: Rough Rider Sergeant",
    ]);
    // 75x42 is the true Yvraine base; the dump rounds it to 74x42.
    expect(readRecord("aeldari/units.json", "yvraine")?.base_size_mm).toEqual({ shape: "oval", width: 75, length: 42 });
    expect(readRecord("astra-militarum/units.json", "attilan-rough-riders")?.base_size_mm).toEqual({
      shape: "oval",
      width: 60,
      length: 35.5,
    });
  });

  it("never attributes a bare list by position", () => {
    // "32mm, 40mm" does not follow the repo's model order (Nob, Boy); the reviewed entry, not position, puts the Nob on 40mm.
    expect(readRecord("orks/unit-compositions.json", "boyz")?.models?.map((m) => [m.name, m.base_size_mm])).toEqual([
      ["Nob", { shape: "round", diameter: 40 }],
      ["Boy", { shape: "round", diameter: 32 }],
    ]);
    // A category carries no dimensions at all.
    expect(report.unresolved.find((u) => u.unit === "gunwagon")).toMatchObject({ form: "category", raw: "None" });
  });

  it("attributes a bare list through its reviewed entry and decodes the Ork oval shorthand", () => {
    // "28.5mm, 32mm, 40mm" is sorted by size; the datasheet lists the Sword Brother first, so position alone reverses it.
    const crusader = readRecord("adeptus-astartes/unit-compositions.json", "crusader-squad")?.models ?? [];
    expect(Object.fromEntries(crusader.map((m) => [m.name, m.base_size_mm]))).toEqual({
      "Sword Brother": { shape: "round", diameter: 40 },
      Initiate: { shape: "round", diameter: 32 },
      Neophyte: { shape: "round", diameter: 28.5 },
    });
    expect(readRecord("adeptus-astartes/units.json", "crusader-squad")?.base_size_mm).toEqual({ shape: "round", diameter: 32 });
    expect(report.listAttributed).toContain("adeptus-astartes/crusader-squad");
    expect(readRecord("orks/units.json", "deffkoptas")?.base_size_mm).toEqual({ shape: "oval", width: 75, length: 42 });
    expect(readRecord("orks/units.json", "blitza-bommer")?.base_size_mm).toEqual({ shape: "oval", width: 120, length: 92 });
  });

  it("reports a model whose labels disagree instead of picking one", () => {
    // "Neurogaunts: 25mm" and "Nodebeast: 28.5mm" both resolve to Neurogaunt
    // Nodebeast, so the pass has no basis to prefer either.
    expect(report.labelConflicts.map((c) => `${c.dir}/${c.unit} :: ${c.model}`)).toContain(
      "tyranids/neurogaunts :: Neurogaunt Nodebeast",
    );
    // Equipment names are never model names.
    expect(report.labelUnmatched.some((l) => l.label === "Transuranic Arquebus")).toBe(true);
  });
});
