import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";

let offset = 0;
function leaf(role: string, familyId: string, parameters: Record<string, unknown>, familyVersion = currentFamilyVersion(familyId)): CompileLeaf {
  offset += 10;
  return { role, family_id: familyId, family_version: familyVersion, parameters, start_byte: offset };
}

function refused(leaves: CompileLeaf[]): string {
  const result = compileLeaves(leaves);
  if (result.ok) throw new Error("expected a refusal");
  return result.errors.join("; ");
}

// semantic-authoring-move-end-nearest
{
/**
 * Move-end nearest (move-end-nearest, move-end-waiver), the waiver's alternative legal end, the
 * bonus move's feasibility proviso (move-must-end on a move-distance), and the permission bound to
 * the unit a move ends nearest. Every leaf is fabricated wording; each case pins one binding or one
 * refusal.
 */


const bonus = (moves: string[] = ["pile-in", "consolidation"]) => leaf("EFFECT", "move-distance", { subject: "this-unit", move_types: moves, bonus: 3 }, 1);
const waiver = () => leaf("RESTRICTION", "move-end-waiver", { rule: "closest-enemy-model" });
const nearest = () => leaf("RESTRICTION", "move-end-nearest", { to: "following-filter" });
const enemyFilter = (extra: Record<string, unknown> = {}) => leaf("CONDITION", "unit-filter", { side: "enemy", ...extra });
const makeMove = () => leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: "D6" });
const permitEngaged = () => leaf("EFFECT", "eligibility-permission", { subject: "this-unit", activity: "move", allow: true, despite: ["engaged"], engaged_with_move_end: true });
const mustEnd = (match = "any", polarity = "must") => leaf("RESTRICTION", "move-must-end", { match, polarity });
const engaged = () => leaf("CONDITION", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false });

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return JSON.stringify(result.mechanics);
}

describe("move-end-nearest and move-end-waiver families", () => {
  it("are version 1 and refuse any parameter they do not name", () => {
    expect(currentFamilyVersion("move-end-nearest")).toBe(3);
    expect(currentFamilyVersion("move-end-waiver")).toBe(1);
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "closest-objective" }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("move-end-nearest", { to: "following-filter", per: "unit" }, 1)).toThrow();
    expect(() => normalizeFingerprintParameters("move-end-waiver", { rule: "closest-enemy-unit" }, 1)).toThrow();
  });

  it("makes engaged_with_move_end a version 3 permission that needs despite engaged", () => {
    const current = currentFamilyVersion("eligibility-permission");
    const ok = normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "move", allow: true, despite: ["engaged"], engaged_with_move_end: true }, current);
    expect(ok.engaged_with_move_end).toBe(true);
    expect(() => normalizeFingerprintParameters("eligibility-permission", { subject: "this-unit", activity: "move", allow: true, despite: ["battle-shocked"], engaged_with_move_end: true }, current)).toThrow(/despite to include engaged/u);
  });
});

describe("move-end nearest on a make-move (3670 shape)", () => {
  it("folds the following enemy filter into the nearest end and binds the engaged permission to it", () => {
    const text = compiled([makeMove(), nearest(), enemyFilter({ excluded_keywords: ["AIRCRAFT"] }), permitEngaged()]);
    expect(text).toContain('"ends_nearest":{"of":{"owner":"enemy","none_of":["AIRCRAFT"]}}');
    expect(text).toContain('"engaged_with":"nearest-move-end"');
    expect(text).not.toContain('"waives"');
  });

  it("refuses a nearest end with no unit-filter right after it", () => {
    expect(refused([makeMove(), nearest(), permitEngaged()])).toMatch(/needs a unit-filter right after it/u);
  });

  it("refuses a nearest end with no move before it", () => {
    expect(refused([nearest(), enemyFilter()])).toMatch(/no move to attach to/u);
  });

  it("refuses an engaged permission bound to a nearest end when the ability has none", () => {
    expect(refused([makeMove(), permitEngaged()])).toMatch(/no move-end nearest/u);
  });

  it("refuses a second nearest end on the same move", () => {
    expect(refused([makeMove(), nearest(), enemyFilter(), nearest(), enemyFilter({ side: "friendly" })])).toMatch(/second one has no DSL form/u);
  });
});

describe("waiver with the nearest end on a bonus move (978 shape)", () => {
  it("attaches the nearest end, with the waiver, as its own move-modifier on the bonus's moves", () => {
    const text = compiled([bonus(), waiver(), nearest(), enemyFilter()]);
    // The bonus stays ungated: a move-modifier with the distance and no end rule.
    expect(text).toContain('{"type":"move-modifier","target":"this-unit","modifier":{"applies_to_moves":["pile-in","consolidation"],"distance_bonus":3}}');
    // The waiver is its own move-modifier on the same moves, legal either way.
    expect(text).toContain('{"type":"move-modifier","target":"this-unit","modifier":{"applies_to_moves":["pile-in","consolidation"],"ends_nearest":{"of":{"owner":"enemy"},"waives":"closest-enemy-model"}}}');
  });

  it("without a waiver, the nearest end is a plain requirement with no waives field", () => {
    const text = compiled([bonus(["consolidation"]), nearest(), enemyFilter()]);
    expect(text).toContain('"ends_nearest":{"of":{"owner":"enemy"}}');
    expect(text).not.toContain("waives");
  });

  it("refuses a waiver with no nearest end in its sentence", () => {
    expect(refused([bonus(), waiver()])).toMatch(/needs a move-end nearest/u);
  });

  it("refuses a waiver whose sentence has a nearest end but no move", () => {
    expect(refused([waiver(), nearest(), enemyFilter()])).toMatch(/no move to attach to/u);
  });
});

describe("move-must-end on a bonus move (feasibility proviso, 5746 shape)", () => {
  it("puts the end condition on the bonus node, which the bonus is available only with", () => {
    const text = compiled([bonus(["consolidation"]), mustEnd(), engaged()]);
    expect(text).toContain('{"type":"move-modifier","target":"this-unit","modifier":{"applies_to_moves":["consolidation"],"distance_bonus":3,"ends_when":');
    expect(text).toContain('"ends_when":{"type":"matches","parameters":{"filter":{"state":"engaged"}}}');
    expect(text).not.toContain('"type":"move"');
  });

  it("refuses a cannot restriction after a bonus move, which has no DSL form", () => {
    expect(refused([bonus(["consolidation"]), mustEnd("all", "cannot"), engaged()])).toMatch(/after a move bonus has no DSL form/u);
  });

  it("keeps the no-move refusal when there is neither a make-move nor a bonus in the sentence", () => {
    expect(refused([mustEnd(), engaged()])).toMatch(/has no move before it/u);
  });
});

describe("a move-end's clause gate (6294 shape)", () => {
  const righteous = () => leaf("CONDITION", "rule-active", { rule: "righteous" });

  it("gates the end rule with the clause's condition and leaves the bonus ungated", () => {
    const text = compiled([bonus(), righteous(), waiver(), nearest(), enemyFilter()]);
    // The bonus is not inside the condition: it is a plain move-modifier at the top level.
    expect(text).toMatch(/^\{"effect":\{"type":"sequence","steps":\[\{"type":"move-modifier","target":"this-unit","modifier":\{"applies_to_moves":\["pile-in","consolidation"\],"distance_bonus":3\}\},/u);
    // The waiver's node is the one the condition wraps.
    expect(text).toMatch(/\{"type":"conditional","condition":\{"type":"rule-active","parameters":\{"rule":"righteous"\}\},"effect":\{"type":"move-modifier","target":"this-unit","modifier":\{"applies_to_moves":\["pile-in","consolidation"\],"ends_nearest"/u);
  });
});

describe("the 978 leaf sequence: a move-ended trigger on the bonus's moves", () => {
  const trigger = () => leaf("EVENT", "event", { kind: "move-ended", move_types: ["pile-in", "consolidation"], subject: "antecedent" }, 18);
  const leading = () => leaf("CONDITION", "leading-unit", { subject: "this-model", attachment: "leading" }, 6);

  it("compiles the bonus with its trigger, and the waiver's end rule as a second effect of that trigger", () => {
    const result = compileLeaves([leading(), trigger(), bonus(["pile-in", "consolidation"]), waiver(), nearest(), enemyFilter()]);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const text = JSON.stringify(result.mechanics);
    expect(text).toContain('"event":"move-ended"');
    expect(text).toContain('"distance_bonus":3');
    expect(text).toContain('"waives":"closest-enemy-model"');
  });
});
}

// semantic-authoring-move-scoped-end
{
/**
 * move-must-end version 3 (move_types) and the trigger-move end restriction: "…, and cannot end
 * that move within Engagement Range of them" after a move-ended trigger with no make-move. Every
 * leaf is fabricated wording. Each case pins one binding or one refusal.
 */


const trigger = (moves?: string[]) => leaf("EVENT", "event", { kind: "move-ended", ...(moves ? { move_types: moves } : {}) });
const through = (passthrough: unknown = "models") => leaf("EFFECT", "move-through", { subject: "this-model", passthrough });
const permit = () => leaf("EFFECT", "eligibility-permission", { subject: "this-model", activity: "move", allow: true, despite: ["engaged"] });
const cannotEnd = (match = "all") => leaf("RESTRICTION", "move-must-end", { match, polarity: "cannot" });
const engaged = (extra: Record<string, unknown> = {}) => leaf("CONDITION", "unit-state", { states: ["engaged"], subject: "this-unit", negated: false, ...extra });

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics;
}

describe("move-must-end version 3 (move_types)", () => {
  it("is the current version, takes move_types, and refuses an unknown or empty list", () => {
    expect(currentFamilyVersion("move-must-end")).toBe(4);
    const canonical = normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "cannot", move_types: ["advance", "normal"] }, 3);
    expect(canonical.move_types).toEqual(["normal", "advance"]);
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", move_types: ["pile-in"] }, 3)).toThrow();
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", move_types: [] }, 3)).toThrow();
    expect(() => normalizeFingerprintParameters("move-must-end", { match: "all", move_types: ["normal", "normal"] }, 3)).toThrow();
  });

  it("keeps version 2 leaves exactly as they were", () => {
    const v2 = normalizeFingerprintParameters("move-must-end", { match: "all", polarity: "cannot" }, 2);
    expect(v2).toEqual({ match: "all", polarity: "cannot" });
  });
});

describe("trigger-move end restriction (no_end_in_engagement)", () => {
  it("compiles a trigger's move-ended restriction with the trigger's move kinds and the bound unit", () => {
    const mechanics = compiled([
      trigger(["normal", "advance", "fall-back"]), through(), permit(), cannotEnd(), engaged(),
    ]);
    expect(JSON.stringify(mechanics)).toContain(JSON.stringify({
      type: "move-modifier", target: "this-model",
      modifier: { no_end_in_engagement: true, applies_to_moves: ["normal", "advance", "fall-back"] },
    }));
    expect(JSON.stringify(mechanics)).not.toContain("ends_when");
  });

  it("omits applies_to_moves when the trigger names no move kinds (every move)", () => {
    const mechanics = compiled([trigger(), through(), permit(), cannotEnd(), engaged()]);
    expect(JSON.stringify(mechanics)).toContain('"modifier":{"no_end_in_engagement":true}');
  });

  it("binds the unit from the move permission when no move-through precedes it", () => {
    const mechanics = compiled([trigger(["advance"]), permit(), cannotEnd(), engaged()]);
    expect(JSON.stringify(mechanics)).toContain('"target":"this-model","modifier":{"no_end_in_engagement":true,"applies_to_moves":["advance"]}');
  });

  it("carries a typed excluded passthrough and still ends on every enemy unit (excluded set resolved)", () => {
    const passthrough = { kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] };
    const mechanics = compiled([trigger(["normal"]), through(passthrough), permit(), cannotEnd(), engaged()]);
    const text = JSON.stringify(mechanics);
    expect(text).toContain(JSON.stringify({ kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] }));
    expect(text).toContain('"no_end_in_engagement":true');
  });

  it("narrows to the restriction's own move kinds, a subset of the trigger's", () => {
    const mechanics = compiled([
      trigger(["normal", "advance", "charge"]), through(), permit(),
      leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal", "advance"] }), engaged(),
    ]);
    expect(JSON.stringify(mechanics)).toContain('"modifier":{"no_end_in_engagement":true,"applies_to_moves":["normal","advance"]}');
  });

  it("keeps the restriction's move kinds when the trigger names none", () => {
    const mechanics = compiled([
      trigger(), through(), permit(),
      leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal", "advance", "fall-back"] }), engaged(),
    ]);
    expect(JSON.stringify(mechanics)).toContain('"applies_to_moves":["normal","advance","fall-back"]');
  });

  it("refuses a restriction that names a move kind the trigger does not name", () => {
    const errors = refused([
      trigger(["normal", "advance"]), through(), permit(),
      leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal", "charge"] }), engaged(),
    ]);
    expect(errors).toMatch(/does not name/u);
  });

  it("refuses a move_types list on a restriction that follows a make-move, rather than dropping it", () => {
    const errors = refused([
      leaf("EFFECT", "make-move", { subject: "this-unit", move_type: "normal", distance: 6 }, 2),
      leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "cannot", move_types: ["normal"] }), engaged(),
    ]);
    expect(errors).toMatch(/move types/u);
  });

  it("refuses a must restriction with no move before it (the deployment-zone form stays refused)", () => {
    const errors = refused([trigger(), through(), permit(), leaf("RESTRICTION", "move-must-end", { match: "all", polarity: "must" }), engaged()]);
    expect(errors).toMatch(/has no move before it/u);
  });

  it("refuses a restriction with no condition, or with more than one", () => {
    expect(refused([trigger(), through(), permit(), cannotEnd()])).toMatch(/exactly one condition/u);
    expect(refused([trigger(), through(), permit(), cannotEnd(), engaged(), engaged()])).toMatch(/exactly one condition/u);
  });

  it("refuses a negated engaged condition under cannot (a double negative)", () => {
    expect(refused([trigger(), through(), permit(), cannotEnd(), engaged({ negated: true })])).toMatch(/negated/u);
  });

  it("refuses a with or at qualifier, which narrows the referent", () => {
    expect(refused([trigger(), through(), permit(), cannotEnd(), engaged({ with: "this-unit" })])).toMatch(/qualifier/u);
    expect(refused([trigger(), through(), permit(), cannotEnd(), engaged({ at: "turn-start" })])).toMatch(/qualifier/u);
  });

  it("refuses a condition other than engaged with this unit", () => {
    expect(refused([trigger(), through(), permit(), cannotEnd(), leaf("CONDITION", "unit-state", { states: ["battle-shocked"], subject: "this-unit", negated: false })])).toMatch(/covers only "engaged"/u);
  });

  it("refuses when no move-ended trigger precedes the restriction", () => {
    expect(refused([through(), permit(), cannotEnd(), engaged()])).toMatch(/no move-ended trigger/u);
  });

  it("refuses when no move-through or move permission binds the unit", () => {
    expect(refused([trigger(), cannotEnd(), engaged()])).toMatch(/to bind its unit/u);
  });
});

describe("trigger-move end restriction, binding by the source text", () => {
  // Byte offsets come from the sentence text, so the stop between the move and the restriction is real.
  function withText(sentence: string, separator: string) {
    const text = `${sentence}${separator}cannot end that move within Engagement Range of them.`;
    const at = (phrase: string) => text.indexOf(phrase);
    const restriction = at("cannot end that move");
    const condition = at("within Engagement Range");
    const leaves: CompileLeaf[] = [
      { role: "EVENT", family_id: "event", family_version: currentFamilyVersion("event"), parameters: { kind: "move-ended" }, start_byte: 0, end_byte: 0 },
      { role: "EFFECT", family_id: "move-through", family_version: currentFamilyVersion("move-through"), parameters: { subject: "this-model", passthrough: "models" }, start_byte: 0, end_byte: sentence.length },
      { role: "RESTRICTION", family_id: "move-must-end", family_version: currentFamilyVersion("move-must-end"), parameters: { match: "all", polarity: "cannot" }, start_byte: restriction, end_byte: restriction + "cannot end that move".length },
      { role: "CONDITION", family_id: "unit-state", family_version: currentFamilyVersion("unit-state"), parameters: { states: ["engaged"], subject: "this-unit", negated: false }, start_byte: condition, end_byte: text.length - 1 },
    ];
    return compileLeaves(leaves, text);
  }

  it("binds the move-through in the same sentence, across a comma", () => {
    const result = withText("It can move through models", ", but ");
    expect(result.ok).toBe(true);
  });

  it("refuses to bind across a full stop, since the restriction is then a different sentence", () => {
    const result = withText("It can move through models", ". It ");
    expect(result.ok ? "" : result.errors.join()).toMatch(/to bind its unit/u);
  });
});
}

// semantic-authoring-move-through-typed
{
/**
 * move-through version 2: the passthrough can be a typed models item. Each case pins one way the
 * item must compile (owner, keyword lists, canonical order) or one way it must still be refused.
 */

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");

function authored(factionId: string, abilityId: string): Record<string, unknown> {
  const entries = JSON.parse(readFileSync(join(dataRoot, factionId, "abilities.json"), "utf8")) as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.ability_id === abilityId);
  if (!entry) throw new Error(`Missing ${factionId}/${abilityId}`);
  return entry;
}

let offset = 0;
/** The version that adds the typed item: version 2 is the antecedent subject, so this is the one after it. */
const TYPED = currentFamilyVersion("move-through");

function leaf(familyVersion: number, parameters: Record<string, unknown>): CompileLeaf {
  offset += 10;
  return { role: "EFFECT", family_id: "move-through", family_version: familyVersion, parameters, start_byte: offset };
}

function compiled(leaves: CompileLeaf[]) {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
}

describe("move-through typed passthrough (version 2)", () => {
  it("is the current move-through version, with the string tokens still accepted", () => {
    expect(TYPED).toBeGreaterThanOrEqual(3);
    expect(compiled([leaf(TYPED, { subject: "this-unit", passthrough: "models" })]).mechanics.effect)
      .toEqual({ type: "move-modifier", target: "this-unit", modifier: { passthrough: ["models"] } });
  });

  it("compiles enemy models with no exclusion, as the typed item the DSL carries", () => {
    expect(compiled([leaf(TYPED, { subject: "this-model", passthrough: { kind: "models", owner: "enemy" } })]).mechanics.effect)
      .toEqual({ type: "move-modifier", target: "this-model", modifier: { passthrough: [{ kind: "models", owner: "enemy" }] } });
  });

  it("canonicalizes the keyword lists when the leaf is normalized, and compiles the canonical form", () => {
    const canonical = normalizeFingerprintParameters("move-through", {
      subject: "this-unit", passthrough: { kind: "models", owner: "enemy", excluding: ["vehicle", "MONSTER"] },
    }, TYPED);
    expect(canonical.passthrough).toEqual({ kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] });
    expect(compiled([leaf(TYPED, canonical)]).mechanics.effect).toEqual({
      type: "move-modifier", target: "this-unit",
      modifier: { passthrough: [{ kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] }] },
    });
  });

  it("keeps the move types and the all_of keywords alongside the typed item", () => {
    const canonical = normalizeFingerprintParameters("move-through", {
      subject: "this-unit", passthrough: { kind: "models", all_of: ["walker"] }, applies_to_moves: ["normal", "charge"],
    }, TYPED);
    expect(compiled([leaf(TYPED, canonical)]).mechanics.effect).toEqual({
      type: "move-modifier", target: "this-unit",
      modifier: { passthrough: [{ kind: "models", all_of: ["WALKER"] }], applies_to_moves: ["normal", "charge"] },
    });
  });

  it("carries the excluded keywords in the typed item, and refuses them as a separate unit-filter after it", () => {
    expect(compiled([leaf(TYPED, { subject: "this-unit", passthrough: { kind: "models", excluding: ["MONSTER", "VEHICLE"] } })]).mechanics.effect)
      .toEqual({
        type: "move-modifier", target: "this-unit",
        modifier: { passthrough: [{ kind: "models", excluding: ["MONSTER", "VEHICLE"] }] },
      });
    const separate = compileLeaves([
      leaf(TYPED, { subject: "this-unit", passthrough: "models" }),
      { role: "EFFECT", family_id: "unit-filter", family_version: currentFamilyVersion("unit-filter"), parameters: { side: "any", excluded_keywords: ["MONSTER", "VEHICLE"] }, start_byte: (offset += 10) },
    ]);
    expect(separate.ok).toBe(false);
  });

  // The typed item came with version 3 of move-through; version 2 is the one before it.
  it("refuses the typed item on the version before it, which only takes string tokens", () => {
    expect(() => normalizeFingerprintParameters("move-through", {
      subject: "this-unit", passthrough: { kind: "models", owner: "enemy" },
    }, 2)).toThrow();
  });

  it("refuses a typed item of kind terrain, which this version does not widen", () => {
    expect(() => normalizeFingerprintParameters("move-through", {
      subject: "this-unit", passthrough: { kind: "terrain", height: "up-to-4" },
    }, TYPED)).toThrow(/kind models/u);
  });

  it("refuses an unknown key, an unknown owner, and an empty or malformed keyword list", () => {
    const base = { subject: "this-unit" };
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", height: "over-4" } }, TYPED))
      .toThrow(/unknown key: height/u);
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", owner: "mine" } }, TYPED))
      .toThrow(/owner must be one of/u);
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", excluding: [] } }, TYPED))
      .toThrow(/at least 1 keyword/u);
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", excluding: ["MONSTER", "monster"] } }, TYPED))
      .toThrow(/lists a keyword twice/u);
    expect(() => normalizeFingerprintParameters("move-through", { ...base, passthrough: { kind: "models", excluding: ["not a keyword!"] } }, TYPED))
      .toThrow(/is not a unit keyword/u);
  });

  it("refuses a quoted source passthrough at compile, since it has no listed value yet", () => {
    expect(() => compiled([leaf(TYPED, { subject: "this-unit", passthrough: { source: "enemy models" } })])).toThrow(/quoted source text/u);
  });

  it("renders the typed item in the describer, so the compiled entry lints and reads back", () => {
    const base = authored("adeptus-mechanicus", "control-edict-adeptus-mechanicus");
    const entry = entryWithMechanics(base, compiled([leaf(TYPED, {
      subject: "this-unit", passthrough: { kind: "models", owner: "enemy", excluding: ["MONSTER", "VEHICLE"] },
    })]).mechanics);
    const check = checkEntry(entry);
    expect(check.errors).toEqual([]);
    expect(check.rendered_text).toContain("enemy models (excluding MONSTER and VEHICLE models)");
  });
});
}
