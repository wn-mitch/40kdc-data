import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole } from "../src/semantic-authoring/contracts.js";

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

/** A standing effect, then the same family "instead" from a later moment until the end of the battle. */
function laterReplacement(family: string, standing: Record<string, unknown>, replacing: Record<string, unknown>, turn = "any-turn") {
  const text = "This model has the first protection. At the start of any turn, if this model has lost wounds, until the end of the battle, it has the second protection instead.";
  return compileLeaves(placed(text,
    ["This model has the first protection", family, standing],
    ["At the start of any turn", "turn-start", { turn }],
    ["this model has lost wounds", "wounds-state", { subject: "this-model", kind: "lost", negated: false }],
    ["until the end of the battle", "duration", { endpoint: "end-of-battle" }],
    ["it has the second protection", family, replacing],
    ["instead", "instead", {}]), text);
}

const REFUSAL = "\"Instead\" under a later moment replaces a standing effect only while that moment's part lasts; that has no DSL reading yet.";
const fnp = (threshold: number, against = "all") => ({ subject: "this-model", threshold, against });

describe("an instead under a later moment over a best-wins effect", () => {
  it("keeps the standing Feel No Pain ungated and grants the better one from the moment for the battle", () => {
    const result = laterReplacement("feel-no-pain", fnp(5), fnp(4));
    if (!result.ok) throw new Error(result.errors.join("; "));
    const steps = (result.mechanics.effect as { steps: Array<Record<string, any>> }).steps;
    // The standing 5+ holds with no gate: a model that lost wounds before any turn started keeps it.
    expect(steps[0]).toEqual({ type: "feel-no-pain", target: "this-model", modifier: { threshold: 5 } });
    expect(steps[1]!.type).toBe("ability-part");
    // "Any turn": the start of either player's turn, with no whose-turn gate.
    expect(steps[1]!.trigger).toEqual({ event: "turn-started" });
    expect(steps[1]!.duration).toBe("battle");
    expect(steps[1]!.effect).toEqual({
      type: "conditional",
      condition: { type: "wounds", parameters: { subject: "this-model", lost: true } },
      effect: { type: "feel-no-pain", target: "this-model", modifier: { threshold: 4 } },
    });
  });

  it("reads an equal threshold the same way, and an invulnerable save too", () => {
    expect(laterReplacement("feel-no-pain", fnp(5), fnp(5)).ok).toBe(true);
    const invulnerable = laterReplacement("invulnerable-save", { subject: "this-model", threshold: 5 }, { subject: "this-model", threshold: 4 });
    expect(invulnerable.ok ? JSON.stringify(invulnerable.mechanics) : invulnerable.errors).toContain('"invuln_sv":4');
  });

  it("refuses a worse threshold, a different Feel No Pain kind or another subject", () => {
    for (const result of [
      laterReplacement("feel-no-pain", fnp(4), fnp(5)),
      laterReplacement("feel-no-pain", fnp(5, "mortal"), fnp(4)),
      laterReplacement("feel-no-pain", fnp(5), { ...fnp(4), subject: "this-unit" }),
      laterReplacement("invulnerable-save", { subject: "this-model", threshold: 4 }, { subject: "this-model", threshold: 5 }),
    ]) expect(result.ok ? [] : result.errors).toContain(REFUSAL);
  });

  it("still gates a your-turn start on whose turn it is", () => {
    const result = laterReplacement("feel-no-pain", fnp(5), fnp(4), "player-turn");
    if (!result.ok) throw new Error(result.errors.join("; "));
    const steps = (result.mechanics.effect as { steps: Array<Record<string, any>> }).steps;
    expect(steps[1]!.trigger).toEqual({ event: "turn-started", condition: { type: "player-turn-is", parameters: { turn: "your-turn" } } });
  });
});
