import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";

/*
 * Fabricated wording. A standing rule whose leaf span holds its own full stop, then a bold heading
 * and a second rule with its own duration, gated on one option of another record.
 */

const TEXT = [
  "Friendly ALPHA units have **Fights First.**",
  "**Favoured Drill**",
  "**Drill One**",
  "**Additional Effect:** Until the end of the turn, your unit has +1 M.",
].join("\r");

type Piece = [phrase: string, family: string, parameters: Record<string, unknown>];

const STANDING: Piece[] = [
  ["Friendly ALPHA units", "unit-filter", { side: "friendly", keywords: ["ALPHA"] }],
  ["have **Fights First.**", "core-ability-grant", { subject: "antecedent", ability: "fights-first" }],
];
const GATE: Piece = ["Drill One", "rule-active", { rule: { ability_id: "fabricated-drills", option_id: "drill-one" } }];
const DURATION: Piece = ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }];
const BONUS: Piece = ["your unit has +1 M", "characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 1 }];

function leavesIn(text: string, pieces: Piece[]): CompileLeaf[] {
  let cursor = 0;
  return pieces.map(([phrase, family_id, parameters]) => {
    const at = text.indexOf(phrase, cursor);
    if (at < 0) throw new Error(`Missing ${phrase}`);
    cursor = at + phrase.length;
    const start_byte = Buffer.byteLength(text.slice(0, at));
    const family_version = currentFamilyVersion(family_id);
    return {
      role: familyRole(family_id, family_version), family_id, family_version,
      parameters: normalizeFingerprintParameters(family_id, parameters, family_version),
      start_byte, end_byte: start_byte + Buffer.byteLength(phrase), fragment: "RAW_TEXT",
    };
  });
}

type Node = Record<string, unknown>;
function compiled(pieces: Piece[], text = TEXT): Node {
  const result = compileLeaves(leavesIn(text, pieces), text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Node;
}

describe("A leaf whose span ends in its own full stop", () => {
  it("closes its sentence at the line break, so the next block's condition does not gate it", () => {
    const mechanics = compiled([...STANDING, GATE, DURATION, BONUS]);
    const [grant, gated] = (mechanics.effect as Node).steps as Node[];
    expect(grant!.type).toBe("ability-grant");
    expect(gated!.type).toBe("conditional");
    expect(JSON.stringify(gated)).toContain("\"option_id\":\"drill-one\"");
  });
});

describe("One duration printed after an earlier sentence's effect", () => {
  it("lasts only for its own sentence's effects", () => {
    const mechanics = compiled([...STANDING, GATE, DURATION, BONUS]);
    expect((mechanics.scope as Node).duration).toBe("permanent");
    const [grant, gated] = (mechanics.effect as Node).steps as Node[];
    expect(JSON.stringify(grant)).not.toContain("turn");
    expect(JSON.stringify(gated)).toContain("\"turn\"");
  });

  it("still wraps the whole record when it is printed first", () => {
    const text = "Until the end of the turn, Friendly ALPHA units have **Fights First.**\rYour unit has +1 M.";
    const mechanics = compiled([DURATION, ...STANDING, ["Your unit has +1 M", "characteristic-modifier", BONUS[2]]], text);
    expect((mechanics.scope as Node).duration).toBe("turn");
  });
});
