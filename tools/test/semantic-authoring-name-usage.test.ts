import { describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { designationIdFor } from "../src/semantic-authoring/compile-wrappers.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

// Fabricated wording only. A use limit printed in a record's name limits the whole rule.

const NAME = "Fabricated Rite (Once per battle round, per unit)";
const LIMIT = "Once per battle round, per unit";

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>): CompileLeaf {
  const family_version = currentFamilyVersion(family_id);
  at += 10;
  return { role: familyRole(family_id, family_version), family_id, family_version, parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: at };
}

function nameLimit(frequency: string, per: string): CompileLeaf {
  const start = Buffer.byteLength(NAME.slice(0, NAME.indexOf(LIMIT)), "utf8");
  return { ...leaf("usage-limit", { frequency, per }), fragment: "NAME", start_byte: start, end_byte: start + Buffer.byteLength(LIMIT, "utf8"), exact_text: LIMIT };
}

const heal = () => leaf("regain-wounds", { subject: "this-unit", amount: "1" });

describe("A use limit printed in the record's name", () => {
  it("becomes the record's use limit and leaves the rule itself unchanged", () => {
    const bare = compileLeaves([heal()]);
    const named = compileLeaves([nameLimit("once-per-battle-round", "unit"), heal()], undefined, { name: NAME });
    expect(bare.ok && named.ok).toBe(true);
    if (!bare.ok || !named.ok) return;
    expect(bare.mechanics.usage).toBeUndefined();
    expect(named.mechanics.usage).toEqual({ frequency: "once-per-battle-round", per: "unit" });
    expect(named.mechanics.effect).toEqual(bare.mechanics.effect);
    expect(named.signature).toContain("NAME RESTRICTION(usage-limit)");
  });

  it("lowers a once-per-battle name limit as the body's own limit would", () => {
    const named = compileLeaves([nameLimit("once-per-battle", "army"), heal()], undefined, { name: NAME });
    expect(named.ok && named.mechanics.usage).toEqual({ frequency: "n-per-battle", count: 1, per: "army" });
  });

  it("accepts a rule that repeats the same limit and refuses one that prints a different limit", () => {
    const same = compileLeaves([nameLimit("once-per-battle-round", "unit"), leaf("usage-limit", { frequency: "once-per-battle-round", per: "unit" }), heal()], undefined, { name: NAME });
    expect(same.ok && same.mechanics.usage).toEqual({ frequency: "once-per-battle-round", per: "unit" });
    const different = compileLeaves([nameLimit("once-per-battle-round", "unit"), leaf("usage-limit", { frequency: "once-per-battle", per: "army" }), heal()], undefined, { name: NAME });
    expect(different.ok).toBe(false);
    expect(!different.ok && different.errors.join(" ")).toMatch(/different use limits/u);
  });

  it("refuses a name limit with no rule to limit", () => {
    const alone = compileLeaves([nameLimit("once-per-battle-round", "unit")], undefined, { name: NAME });
    expect(alone.ok).toBe(false);
    expect(!alone.ok && alone.errors.join(" ")).toMatch(/needs the rule it limits/u);
  });

  it("names a designation after the rule, not after its printed use limit", () => {
    expect(designationIdFor("Quarry (Once per battle, per unit)")).toBe("quarry");
    expect(designationIdFor("Quarry (one per army)")).toBe("quarry");
    // Any other parenthetical is part of the name.
    expect(() => designationIdFor("Quarry (Upgrade)")).toThrow(/quarry-upgrade-target/u);
  });
});
