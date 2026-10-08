import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, validateFamilySource } from "../src/round5c/contracts.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const MELEE_SCOPE: [string, string, Record<string, unknown>] = ["Your unit's melee attacks can have", "weapon-property-scope", { subject: "this-unit", weapon_type: "melee" }];

describe("wave-9 weapon-ability keywords", () => {
  it("accepts Close-quarters, Cleave N and a slash-pair Anti target at the current version", () => {
    expect(normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Close-quarters" }, 2)).toEqual({ keyword: "Close-quarters" });
    expect(normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Cleave 2" }, 2)).toEqual({ keyword: "Cleave 2" });
    expect(normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Anti-Monster/Vehicle 4+" }, 2)).toEqual({ keyword: "Anti-Monster/Vehicle 4+" });
    expect(normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Anti-Non-Vehicle 4+" }, 2)).toEqual({ keyword: "Anti-Non-Vehicle 4+" });
  });

  it("keeps the new forms out of the earlier version, and rejects malformed values", () => {
    expect(() => normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Cleave 1" }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Cleave 0" }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Cleave 10" }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Anti-Monster/ 4+" }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Anti-Monster/Vehicle 7+" }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Cleave 1", threshold: 2 }, 2)).toThrow();
    expect(() => normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Not A Keyword" }, 2)).toThrow();
  });

  it("gives weapon-ability-grant the same keywords at its current version", () => {
    const version = currentFamilyVersion("weapon-ability-grant");
    expect(normalizeFingerprintParameters("weapon-ability-grant", { subject: "this-unit", keyword: "Cleave 1", weapon_type: "melee" }, version))
      .toEqual({ subject: "this-unit", keyword: "Cleave 1", weapon_type: "melee" });
    expect(() => normalizeFingerprintParameters("weapon-ability-grant", { subject: "this-unit", keyword: "Cleave 1", weapon_type: "melee" }, version - 1)).toThrow();
  });

  it("accepts a bold-marked Anti keyword whose printed span carries the bold markers", () => {
    expect(() => validateFamilySource("weapon-ability-keyword", { keyword: "Anti-Non-Vehicle 4+" }, "[ANTI-**non-**VEHICLE 4+]")).not.toThrow();
    expect(() => validateFamilySource("weapon-ability-keyword", { keyword: "Anti-Vehicle 4+" }, "[ANTI-**non-**VEHICLE 4+]")).toThrow();
  });

  it("compiles a Cleave N grant under a melee scope", () => {
    const text = "Your unit's melee attacks can have: [CLEAVE 1].";
    const result = compileLeaves(placed(text, MELEE_SCOPE, ["CLEAVE 1", "weapon-ability-keyword", { keyword: "Cleave 1" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain("Cleave 1");
  });
});

describe("weapon-property-scope with a target qualifier", () => {
  const text = "Friendly ALPHA units' attacks have [LETHAL HITS: CHARACTER/MONSTER].";
  const leaves = () => placed(text,
    ["Friendly ALPHA units'", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
    ["attacks", "weapon-property-scope", { subject: "antecedent", weapon_type: "all" }],
    ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
    ["CHARACTER/MONSTER", "unit-filter", { side: "any", any_keywords: ["CHARACTER", "MONSTER"] }]);

  it("folds the qualifier into a defender gate on the keyword's attacks", () => {
    const result = compileLeaves(leaves(), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain('"subject":"defender","any_of":["CHARACTER","MONSTER"]');
    expect(json).toContain("Lethal Hits");
  });

  it("refuses a qualifier after a run of two keywords, rather than gating both on it", () => {
    const two = "Friendly ALPHA units' attacks have [LETHAL HITS] and [SUSTAINED HITS 1: CHARACTER].";
    const result = compileLeaves(placed(two,
      ["Friendly ALPHA units'", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["attacks", "weapon-property-scope", { subject: "antecedent", weapon_type: "all" }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["SUSTAINED HITS 1", "weapon-ability-keyword", { keyword: "Sustained Hits 1" }],
      ["CHARACTER", "unit-filter", { side: "any", any_keywords: ["CHARACTER"] }]), two);
    expect(result.ok).toBe(false);
  });

  it("does not fold a qualifier whose separator is not a colon", () => {
    const comma = "Friendly ALPHA units' attacks have [LETHAL HITS], CHARACTER/MONSTER.";
    const result = compileLeaves(placed(comma,
      ["Friendly ALPHA units'", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
      ["attacks", "weapon-property-scope", { subject: "antecedent", weapon_type: "all" }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["CHARACTER/MONSTER", "unit-filter", { side: "any", any_keywords: ["CHARACTER", "MONSTER"] }]), comma);
    expect(result.ok).toBe(false);
  });
});

describe("a keyword or a stat adjustment as a choice", () => {
  const text = "Your unit's melee attacks can have: [CLEAVE 1].\nOr: +1 AP.";
  const choice = () => placed(text,
    MELEE_SCOPE,
    ["CLEAVE 1", "weapon-ability-keyword", { keyword: "Cleave 1" }],
    ["Or:", "instead", { choice: true }],
    ["+1 AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }]);

  it("compiles to a choice between the keyword grant and the stat adjustment", () => {
    const result = compileLeaves(choice(), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain('"type":"choice"');
    expect(json).toContain("Cleave 1");
    expect(json).toContain('"AP"');
  });

  it("refuses a choice whose keyword run has two keywords", () => {
    const two = "Your unit's melee attacks can have: [CLEAVE 1] and [PRECISION].\nOr: +1 AP.";
    const result = compileLeaves(placed(two,
      MELEE_SCOPE,
      ["CLEAVE 1", "weapon-ability-keyword", { keyword: "Cleave 1" }],
      ["PRECISION", "weapon-ability-keyword", { keyword: "Precision" }],
      ["Or:", "instead", { choice: true }],
      ["+1 AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }]), two);
    expect(result.ok).toBe(false);
  });
});

describe("wave-9 keyword shapes compile", () => {
  it("compiles a value-less Close-quarters keyword under a scope", () => {
    const text = "Your unit's melee attacks can have: [CLOSE-QUARTERS].";
    const result = compileLeaves(placed(text, MELEE_SCOPE, ["CLOSE-QUARTERS", "weapon-ability-keyword", { keyword: "Close-quarters" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain("Close-quarters");
  });

  it("compiles a Cleave N grant on the unit's own melee attacks, and refuses a Cleave 0 keyword", () => {
    const text = "This unit's melee attacks have [Cleave 1].";
    const grant = compileLeaves(placed(text,
      ["This unit's melee attacks have [Cleave 1]", "weapon-ability-grant", { subject: "this-unit", keyword: "Cleave 1", weapon_type: "melee" }]), text);
    expect(grant.ok ? [] : grant.errors).toEqual([]);
    expect(JSON.stringify(grant.ok ? grant.mechanics : {})).toContain("Cleave 1");
    expect(() => normalizeFingerprintParameters("weapon-ability-keyword", { keyword: "Cleave 0" }, 2)).toThrow();
  });

  it("compiles a keyword-or-grant choice: [CLEAVE 1] or the +1 increment of an existing Cleave", () => {
    const text = "Your unit's melee attacks can have: [CLEAVE 1].\nOr: If that attack already has [CLEAVE], increase that [CLEAVE] by 1 (e.g. [CLEAVE 1] becomes [CLEAVE 2]).";
    const result = compileLeaves(placed(text,
      MELEE_SCOPE,
      ["CLEAVE 1", "weapon-ability-keyword", { keyword: "Cleave 1" }],
      ["Or:", "instead", { choice: true }],
      ["If that attack already has [CLEAVE], increase that [CLEAVE] by 1 (e.g. [CLEAVE 1] becomes [CLEAVE 2]).", "weapon-ability-grant", { subject: "this-unit", weapon_type: "melee", keyword: "Cleave 1", if_present: "increment" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain('"type":"choice"');
    expect(json).toContain('"if_present":"increment"');
  });

  it("compiles printed [Blast 1] as the keyword Blast", () => {
    const text = "Your unit's melee attacks can have: [BLAST 1].";
    const result = compileLeaves(placed(text, MELEE_SCOPE, ["BLAST 1", "weapon-ability-keyword", { keyword: "Blast" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain("Blast");
  });

  it("refuses a printed Blast rating other than 1, rather than authoring it as plain Blast", () => {
    const text = "Your unit's melee attacks can have: [BLAST 2].";
    const leaves = placed(text, MELEE_SCOPE, ["BLAST 2", "weapon-ability-keyword", { keyword: "Blast" }]);
    const result = compileLeaves(leaves, text);
    expect(result.ok).toBe(false);
    expect(() => validateFamilySource("weapon-ability-keyword", { keyword: "Blast" }, "BLAST 2")).toThrow();
    expect(() => validateFamilySource("weapon-ability-keyword", { keyword: "Blast" }, "[Blast 10]")).toThrow();
    expect(() => validateFamilySource("weapon-ability-keyword", { keyword: "Blast" }, "[Blast 1]")).not.toThrow();
    expect(() => validateFamilySource("weapon-ability-keyword", { keyword: "Blast" }, "Blast")).not.toThrow();
  });
});

describe("wave-9 Anti target shapes compile", () => {
  it("compiles a slash-pair Anti keyword under a melee scope", () => {
    const text = "Your unit's melee attacks can have: [ANTI-MONSTER/VEHICLE 4+].";
    const result = compileLeaves(placed(text, MELEE_SCOPE, ["ANTI-MONSTER/VEHICLE 4+", "weapon-ability-keyword", { keyword: "Anti-Monster/Vehicle 4+" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain("Anti-Monster/Vehicle 4+");
  });

  it("compiles a negated Anti target, and its printed bold markers bind to the same keyword", () => {
    const text = "Your unit's melee attacks can have: [ANTI-**non-**VEHICLE 4+].";
    const result = compileLeaves(placed(text, MELEE_SCOPE, ["ANTI-**non-**VEHICLE 4+", "weapon-ability-keyword", { keyword: "Anti-Non-Vehicle 4+" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(() => validateFamilySource("weapon-ability-keyword", { keyword: "Anti-Non-Vehicle 4+" }, "ANTI-**non-**VEHICLE 4+")).not.toThrow();
  });
});

describe("wave-9 Cleave records with a named weapon or a stat beside the keyword", () => {
  it("compiles a Cleave N grant on one named weapon (the bold weapon name is its weapon_name)", () => {
    const text = "This unit's Maulerfiend Fists have [Cleave 2].";
    const result = compileLeaves(placed(text,
      ["This unit's Maulerfiend Fists have [Cleave 2]", "weapon-ability-grant", { subject: "this-unit", keyword: "Cleave 2", weapon_name: "Maulerfiend Fists" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(JSON.stringify(result.ok ? result.mechanics : {})).toContain("Cleave 2");
  });

  it("compiles a stat adjustment and a Cleave keyword listed under one melee scope, without a choice", () => {
    const text = "Your unit's melee attacks have:\n+1 AP.\n[CLEAVE 1].";
    const result = compileLeaves(placed(text,
      ["Your unit's melee attacks have:", "weapon-property-scope", { subject: "this-unit", weapon_type: "melee" }],
      ["+1 AP", "characteristic-modifier", { characteristics: ["AP"], operation: "improve", value: 1 }],
      ["CLEAVE 1", "weapon-ability-keyword", { keyword: "Cleave 1" }]), text);
    expect(result.ok ? [] : result.errors).toEqual([]);
    const json = JSON.stringify(result.ok ? result.mechanics : {});
    expect(json).toContain("Cleave 1");
    expect(json).not.toContain('"type":"choice"');
  });
});
