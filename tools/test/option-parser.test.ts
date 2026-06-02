import { describe, it, expect } from "vitest";

import { parseOption } from "../src/converters/option-parser.js";

/** Convenience: assert a parse succeeded and return the option. */
function ok(desc: string) {
  const r = parseOption(desc);
  expect(r.ok, `expected parse ok for: ${desc}`).toBe(true);
  if (r.ok !== true) throw new Error("unreachable");
  return r.option;
}

describe("parseOption — skips", () => {
  it.each([null, "", "None", "* These options cannot be taken on the same model.", "This weapon cannot be replaced."])(
    "skips non-option %p",
    (desc) => {
      expect(parseOption(desc as string).ok).toBe("skip");
    },
  );
});

describe("parseOption — Khorne Berzerkers (the dogfood case)", () => {
  it("champion bolt pistol → plasma pistol (max 1)", () => {
    const o = ok("The Khorne Berzerker Champion's bolt pistol can be replaced with 1 plasma pistol.");
    expect(o.kind).toBe("swap");
    expect(o.constraint).toEqual({ model_name: "Khorne Berzerker Champion", max_count: 1 });
    expect(o.replaces).toEqual(["bolt pistol"]);
    expect(o.replacement).toEqual(["plasma pistol"]);
  });

  it("ratio bolt pistol → plasma pistol (per 5)", () => {
    const o = ok("For every 5 models in this unit, 1 Khorne Berzerker's bolt pistol can be replaced with 1 plasma pistol.");
    expect(o.constraint.per_n_models).toBe(5);
    expect(o.replaces).toEqual(["bolt pistol"]);
    expect(o.replacement).toEqual(["plasma pistol"]);
  });

  it("ratio chainblade → Khornate eviscerator (per 5)", () => {
    const o = ok("For every 5 models in this unit, 1 Khorne Berzerker's chainblade can be replaced with 1 Khornate eviscerator.");
    expect(o.constraint.per_n_models).toBe(5);
    expect(o.replaces).toEqual(["chainblade"]);
    expect(o.replacement).toEqual(["Khornate eviscerator"]);
  });

  it("icon of Khorne add-on (no replaces)", () => {
    const o = ok("1 model can be equipped with 1 icon of Khorne.");
    expect(o.kind).toBe("addon");
    expect(o.constraint.max_count).toBe(1);
    expect(o.replaces).toEqual([]);
    expect(o.replacement).toEqual(["icon of Khorne"]);
  });
});

describe("parseOption — verb voices and shapes", () => {
  it("active voice: '1 model can replace its X with Y'", () => {
    const o = ok("1 model can replace its melta rifle with 1 multi-melta.");
    expect(o.kind).toBe("swap");
    expect(o.constraint.max_count).toBe(1);
    expect(o.replaces).toEqual(["melta rifle"]);
    expect(o.replacement).toEqual(["multi-melta"]);
  });

  it("any number, 'have their X and Z replaced with A and B'", () => {
    const o = ok("Any number of Boyz can each have their slugga and choppa replaced with 1 shoota and 1 close combat weapon.");
    expect(o.constraint.any_number).toBe(true);
    expect(o.replaces).toEqual(["slugga", "choppa"]);
    expect(o.replacement).toEqual(["shoota", "close combat weapon"]);
  });

  it("up to N", () => {
    const o = ok("Up to 2 Noise Marines can each replace their sonic blaster with 1 blastmaster.");
    expect(o.constraint.max_count).toBe(2);
    expect(o.replaces).toEqual(["sonic blaster"]);
    expect(o.replacement).toEqual(["blastmaster"]);
  });

  it("choice: 'one of the following' → replacement_choice", () => {
    const o = ok("The Boss Nob's big choppa can be replaced with one of the following:1 power klaw1 kombi-weapon");
    expect(o.replacement_choice).toEqual([["power klaw"], ["kombi-weapon"]]);
    expect(o.replacement).toBeUndefined();
  });

  it("equipped-with colon variant", () => {
    const o = ok("This model can be equipped with:1 lobba");
    expect(o.kind).toBe("addon");
    expect(o.replacement).toEqual(["lobba"]);
  });

  it("single-alternative 'one of the following' collapses to a flat replacement", () => {
    const o = ok("This model's gun can be replaced with one of the following:1 plasma gun");
    expect(o.replacement).toEqual(["plasma gun"]);
    expect(o.replacement_choice).toBeUndefined();
  });

  it("strips footnote markers from names", () => {
    const o = ok("Up to 2 models can each replace their sonic blaster with 1 blastmaster*");
    expect(o.replacement).toEqual(["blastmaster"]);
  });
});
