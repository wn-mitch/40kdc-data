import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

type Item = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Item[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters: normalizeFingerprintParameters(family, parameters, version), start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

const TEXT = "Until the end of the phase, ranged weapons equipped by models in a Guided unit have the [LETHAL HITS] ability while targeting their Quarry unit.";

describe("a Guided condition on the models a unit-filter names", () => {
  it("gates the grant on each friendly model's unit being Guided, not on the bearer's unit", () => {
    const result = compileLeaves(placed(TEXT,
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["models", "unit-filter", { side: "friendly", level: "model" }],
      ["in a Guided unit", "guided", { subject: "antecedent" }],
      ["have the", "weapon-ability-grant", { subject: "antecedent", weapon_type: "ranged" }],
      ["LETHAL HITS", "weapon-ability-keyword", { keyword: "Lethal Hits" }],
      ["while targeting their Quarry unit", "designated-filter", { subject: "defender", tag: "spotted", by: "this-unit" }],
    ), TEXT, { abilityId: "fabricated-quarry-pact", name: "Quarry Pact" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    const text = JSON.stringify(result.mechanics.effect);
    expect(text).toContain('"type":"guided","parameters":{"subject":"recipient"}');
    expect(text).toContain('"type":"weapon-ability-grant","target":{"owner":"friendly","level":"model"}');
    expect(text).not.toContain('"target":"this-unit"');
  });
});
