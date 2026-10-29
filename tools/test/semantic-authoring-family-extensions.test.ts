import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileLeaves } from "../src/semantic-authoring/compile.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { coreCheckErrors } from "../src/semantic-authoring/core-checks.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>): CompileLeaf {
  const family_version = currentFamilyVersion(family_id);
  at += 10;
  return { role: familyRole(family_id, family_version), family_id, family_version, parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: at };
}
const normalize = (family: string, parameters: Record<string, unknown>) => normalizeFingerprintParameters(family, parameters, currentFamilyVersion(family));

/** Every node in a compiled tree that satisfies a test. */
function nodes(tree: unknown, test: (node: Record<string, unknown>) => boolean): Array<Record<string, unknown>> {
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, test));
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  return [...(test(node) ? [node] : []), ...Object.values(node).flatMap((value) => nodes(value, test))];
}
function compiled(leaves: CompileLeaf[]): Record<string, unknown> {
  const result = compileLeaves(leaves);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as Record<string, unknown>;
}

const heal = () => leaf("regain-wounds", { subject: "this-unit", amount: "1" });
const selectEnemy = () => leaf("select-unit", { scope: "enemy", distance: "any", visible: false });
const enemyEndsMove = () => leaf("event", { kind: "move-ended", owner: "enemy", move_types: ["normal"] });

const first = (tree: unknown, type: string) => nodes(tree, (node) => node.type === type)[0];
const target = () => ({ ...leaf("stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["INFANTRY"], match: "all", excluded_keywords: [] }), fragment: "TARGET" });

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Semantic authoring family extensions", () => {
  it("keeps every earlier leaf of an extended family, which moves across unchanged", () => {
    // One table for every widened family across the first three rounds.
    for (const [family, parameters] of [
      ["bearer-eligibility", { keywords: ["CAPTAIN"], match: "all", excluded_keywords: [] }],
      ["unit-position", { kind: "within", inches: 6, of: "this-unit", subject: "selected-unit", negated: false }],
      ["leading-unit", { subject: "this-model", attachment: "leading" }],
      ["event", { kind: "move-ended", owner: "enemy" }],
      ["roll-modifier", { roll: "charge", operation: "add", value: 1 }],
      ["rule-state", { subject: "this-unit", direction: "suppressed", rule_kind: "core-rule", rule: "benefit-of-cover" }],
      ["characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }],
      ["make-move", { subject: "this-unit", move_type: "normal", distance: 6 }],
      ["make-move", { subject: "this-unit", move_type: "normal", distance: "D6" }],
      ["characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_type: "melee" }],
      ["unit-activity", { activities: ["advanced-this-turn"], subject: "this-unit", negated: false }],
      ["select-unit", { scope: "enemy", distance: "within", inches: 12, visible: true }],
      ["battle-round", { min: 3 }],
      ["event", { kind: "step-started", step: "battle-shock" }],
      ["weapon-ability-grant", { subject: "this-unit", keyword: "Lethal Hits", weapon_type: "all" }],
      ["feel-no-pain", { subject: "this-unit", threshold: 5, against: "all" }],
      ["core-ability-grant", { subject: "this-unit", ability: "scouts", value: 6 }],
      ["invulnerable-save", { subject: "this-model", threshold: 4 }],
      ["ability-record-grant", { subject: "this-unit", ability: "some-ability" }],
      ["event", { kind: "unit-destroyed" }],
      ["mortal-wounds", { recipient: "target", count: "D3" }],
      ["set-up", { subject: "this-unit", to: "battlefield", from: "strategic-reserves" }],
      ["characteristic-set", { subject: "this-model", characteristic: "M", value: 7 }],
    ] as const) {
      const version = currentFamilyVersion(family);
      expect(normalizeFingerprintParameters(family, parameters, version - 1), family).toEqual(normalizeFingerprintParameters(family, parameters, version));
      expect(mapToLatest(family, version - 1, parameters), family).toEqual({ family, version, parameters: normalizeFingerprintParameters(family, parameters, version) });
    }
  });

  it("reads 'every keyword plus one of these' bearers and checks them against core groups", () => {
    const eligible = normalize("bearer-eligibility", { keywords: ["Adeptus Astartes"], any_keywords: ["MOUNTED", "INFANTRY"], match: "all", excluded_keywords: [] });
    expect(eligible).toEqual({ keywords: ["ADEPTUS ASTARTES"], any_keywords: ["INFANTRY", "MOUNTED"], match: "all", excluded_keywords: [] });
    // One-of keywords add to keywords all must have; with match any the reading is contradictory.
    expect(() => normalize("bearer-eligibility", { keywords: ["ADEPTUS ASTARTES"], any_keywords: ["INFANTRY", "MOUNTED"], match: "any", excluded_keywords: [] })).toThrow(/match must be all/u);
    expect(() => normalize("bearer-eligibility", { keywords: ["INFANTRY"], any_keywords: ["INFANTRY", "MOUNTED"], match: "all", excluded_keywords: [] })).toThrow(/both as required and as one of several/u);
    expect(() => normalize("bearer-eligibility", { keywords: ["ADEPTUS ASTARTES"], any_keywords: ["INFANTRY"], match: "all", excluded_keywords: [] })).toThrow(/at least 2/u);

    const root = mkdtempSync(join(tmpdir(), "semantic-authoring-extensions-"));
    roots.push(root);
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    // Fabricated fixture records only.
    writeFileSync(join(root, "core", "alpha", "enhancements.json"), JSON.stringify([
      { id: "split", keyword_restriction_groups: [["Adeptus Astartes", "Infantry"], ["Adeptus Astartes", "Mounted"]] },
      { id: "single", keyword_restriction_groups: [["Adeptus Astartes", "Infantry"]] },
      { id: "other", keyword_restriction_groups: [["Adeptus Astartes", "Infantry"], ["Adeptus Astartes", "Fly"]] },
    ]));
    const check = (abilityId: string) => coreCheckErrors(root, abilityId, [{ kind: "bearer-eligibility", parameters: eligible }]);
    expect(check("split")).toEqual([]);
    expect(check("single")[0]).toMatch(/ADEPTUS ASTARTES \+ \(INFANTRY or MOUNTED\), but core requires/u);
    expect(check("other")).toHaveLength(1);
  });

  it("measures a distance to any friendly unit with the named keywords, other than the subject when it says so", () => {
    const near = (extra: Record<string, unknown>) => leaf("unit-position", { kind: "within", inches: 6, subject: "this-model", negated: false, of: "matching-unit", of_keywords: ["harvester"], of_side: "friendly", ...extra });
    const ordinary = nodes(compiled([near({}), heal()]), (node) => node.type === "matches")[0]!;
    expect(ordinary.parameters).toEqual({ subject: "this-model", filter: { within: { of: { owner: "friendly", all_of: ["HARVESTER"] }, range: { inches: 6 } } } });
    const other = nodes(compiled([near({ of_other: true }), heal()]), (node) => node.type === "matches")[0]!;
    expect(other.parameters).toEqual({ subject: "this-model", filter: { within: { of: { owner: "friendly", all_of: ["HARVESTER"], excluding: "this-model" }, range: { inches: 6 } } } });
    // The filter belongs only to a measured distance to matching units.
    expect(() => normalize("unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "this-unit", of_keywords: ["HARVESTER"] })).toThrow(/only describes of: matching-unit/u);
    expect(() => normalize("unit-position", { kind: "objective-range", controlled_by: "any", subject: "this-unit", negated: false, of: "matching-unit", of_keywords: ["HARVESTER"], of_side: "friendly" })).toThrow();
    expect(() => normalize("unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "matching-unit", of_keywords: ["HARVESTER"] })).toThrow(/of_side/u);
  });

  it("reads attached in any role as part of an attached unit, for the model or the unit", () => {
    const attached = (subject: string) => nodes(compiled([leaf("leading-unit", { subject, attachment: "any" }), heal()]), (node) => node.type === "attachment")[0];
    expect(attached("this-model")).toEqual({ type: "attachment", parameters: { role: "attached", subject: "this-model" } });
    expect(attached("this-unit")!.parameters).toEqual({ role: "attached", subject: "this-unit" });
    // Leading still means leading.
    expect(nodes(compiled([leaf("leading-unit", { subject: "this-model", attachment: "leading" }), heal()]), (node) => node.type === "attachment")[0]!.parameters)
      .toMatchObject({ role: "leading" });
  });

  it("names whose moment an event is, binding 'that unit' to the unit an earlier leaf introduced", () => {
    const moves = (subject: string) => leaf("event", { kind: "move-ended", move_types: ["normal"], subject });
    const trigger = (leaves: CompileLeaf[]) => compiled(leaves).trigger as Record<string, unknown>;
    expect(trigger([selectEnemy(), moves("antecedent"), heal()]).subject).toBe("selected-unit");
    // This unit is the default subject, so it is not written.
    expect(trigger([moves("this-unit"), heal()]).subject).toBeUndefined();
    expect(trigger([moves("this-model"), heal()]).subject).toBe("this-model");
    // Only a unit's own moment has a subject, and subject and owner never both say whose it is.
    expect(() => normalize("event", { kind: "phase-start", phase: "command", turn: "your", subject: "this-unit" })).toThrow();
    expect(() => normalize("event", { kind: "move-ended", owner: "enemy", subject: "antecedent" })).toThrow(/not both/u);
  });

  it("applies one roll change to each listed roll together", () => {
    const both = compiled([leaf("roll-modifier", { rolls: ["charge", "advance"], operation: "add", value: 1 })]);
    const steps = nodes(both, (node) => node.type === "roll-modifier").map((node) => (node.modifier as Record<string, unknown>).roll);
    expect(steps.sort()).toEqual(["advance", "charge"]);
    expect(nodes(both, (node) => node.type === "sequence")).toHaveLength(1);
    expect(() => normalize("roll-modifier", { roll: "hit", rolls: ["charge", "advance"], operation: "add", value: 1 })).toThrow(/not both/u);
    expect(() => normalize("roll-modifier", { operation: "add", value: 1 })).toThrow(/a roll or rolls/u);
    // Each listed roll must be one the single-roll leaf accepts.
    expect(() => normalize("roll-modifier", { rolls: ["charge", "psychic"], operation: "add", value: 1 })).toThrow();
  });

  it("denies cover to a selected unit or the attack's target as a suppressed core rule", () => {
    const denied = (subject: string, leaves: CompileLeaf[] = []) => nodes(compiled([...leaves, leaf("rule-state", { subject, direction: "suppressed", rule_kind: "core-rule", rule: "benefit-of-cover" })]), (node) => node.type === "rule-state")[0];
    expect(denied("antecedent", [selectEnemy()])).toMatchObject({ target: "selected-unit", modifier: { direction: "suppressed", rule: "benefit-of-cover" } });
    expect(denied("target")).toMatchObject({ target: "defender" });
  });

  it("changes a characteristic by a dice amount, a weapon's Range, or the triggering unit's models", () => {
    const stat = (parameters: Record<string, unknown>, leaves: CompileLeaf[] = []) => nodes(compiled([...leaves, leaf("characteristic-modifier", parameters)]), (node) => node.type === "stat-modifier")[0];
    expect(stat({ subject: "this-unit", characteristics: ["A"], operation: "add", value: "d3", weapon_type: "melee" })).toMatchObject({ modifier: { stat: "A", value: "D3", weapons: { type: "melee" } } });
    expect(stat({ subject: "this-unit", characteristics: ["Range"], operation: "add", value: 6, weapon_type: "ranged" })).toMatchObject({ modifier: { stat: "Range", value: 6, weapons: { type: "ranged" } } });
    // Range is a weapon characteristic: it needs a reviewed weapon scope before it compiles.
    expect(compileLeaves([leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["Range"], operation: "add", value: 6 })]))
      .toMatchObject({ ok: false, errors: [expect.stringMatching(/weapon scope/u)] });
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["M"], operation: "add", value: "D7", weapon_type: "all" })).toThrow(/dice amount/u);
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["Range"], operation: "add", value: 6, weapon_type: "all" })).not.toThrow();
    expect(stat({ subject: "antecedent", characteristics: ["M"], operation: "subtract", value: 2, weapon_type: "all" }, [enemyEndsMove()])).toMatchObject({ target: "event-subject" });
  });

  it("lets the triggering unit make a move", () => {
    const move = nodes(compiled([enemyEndsMove(), leaf("make-move", { subject: "antecedent", move_type: "normal", distance: 6 })]), (node) => node.type === "move")[0];
    expect(move).toMatchObject({ target: "event-subject", modifier: { move_type: "normal", distance: 6 } });
  });
});

describe("Semantic authoring family extensions, second round", () => {
  it("binds 'that unit' in grants, Feel No Pain, healing and returned models to a Stratagem's target, or to a selected unit", () => {
    for (const [family, parameters] of [
      ["weapon-ability-grant", { keyword: "Lethal Hits", weapon_type: "melee" }],
      ["keyword-grant", { keywords: ["FLY"] }],
      ["feel-no-pain", { threshold: 5, against: "all" }],
      ["regain-wounds", { amount: "D3" }],
      ["return-models", { count: "1" }],
    ] as const) {
      const tree = compiled([target(), leaf(family, { subject: "antecedent", ...parameters })]);
      expect(JSON.stringify(tree), family).not.toContain("antecedent");
      // A selected unit is a plain DSL unit-ref: these families' subjects lower as any unit-ref, so they name it.
      const selected = compileLeaves([leaf("select-unit", { scope: "enemy", distance: "any", visible: false }), leaf(family, { subject: "antecedent", ...parameters })]);
      expect(JSON.stringify(selected), family).toContain('"target":"selected-unit"');
    }
    // unit-has-ability names a selected unit, so its antecedent binds there.
    const has = nodes(compiled([leaf("select-unit", { scope: "enemy", distance: "any", visible: false }), leaf("unit-has-ability", { subject: "antecedent", ability: "lone-operative", negated: true }), heal()]),
      (node) => node.type === "matches" && (node.parameters as Record<string, any> | undefined)?.filter?.has_ability !== undefined)[0];
    expect(has).toMatchObject({ parameters: { subject: "selected-unit", filter: { has_ability: ["lone-operative"] } } });
  });

  it("changes Desperate Escape and Hazardous tests, and limits a weapon roll change to melee or ranged", () => {
    expect(first(compiled([leaf("roll-modifier", { roll: "desperate-escape", operation: "subtract", value: 1 })]), "roll-modifier")).toMatchObject({ modifier: { roll: "desperate-escape", operation: "subtract", value: 1 } });
    const melee = first(compiled([leaf("roll-modifier", { roll: "wound", operation: "subtract", value: 1, weapon_type: "melee" })]), "roll-modifier");
    expect(melee!.modifier).toEqual({ roll: "wound", operation: "subtract", value: 1, weapons: { type: "melee" } });
    // all limits nothing, so it is not written.
    expect(first(compiled([leaf("roll-modifier", { roll: "hit", operation: "add", value: 1, weapon_type: "all" })]), "roll-modifier")!.modifier).not.toHaveProperty("weapon_type");
    expect(() => normalize("roll-modifier", { roll: "charge", operation: "add", value: 1, weapon_type: "melee" })).toThrow(/Hit, Wound or Damage/u);
    expect(() => normalize("roll-modifier", { roll: "deadly-demise", operation: "add", value: 1, weapon_type: "melee" })).toThrow();
    expect(() => normalize("roll-modifier", { roll: "deadly-demise-d3", operation: "add", value: 1 })).toThrow();
  });

  it("moves a dice amount plus a number, and refuses a malformed one", () => {
    expect(first(compiled([leaf("make-move", { subject: "this-unit", move_type: "normal", distance: "d3+3" })]), "move")!.modifier).toEqual({ move_type: "normal", distance: "D3+3" });
    expect(() => normalize("make-move", { subject: "this-unit", move_type: "normal", distance: "D4+1" })).toThrow(/dice amount/u);
  });

  it("limits a characteristic change to weapons with one ability, only with a weapon scope", () => {
    const stat = first(compiled([leaf("characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_type: "ranged", weapon_keyword: "Torrent" })]), "stat-modifier");
    expect(stat!.modifier).toEqual({ stat: "S", operation: "add", value: 1, weapons: { type: "ranged", keyword: { keyword_id: "torrent" } } });
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_keyword: "Torrent" })).toThrow(/weapon_type/u);
    expect(() => normalize("characteristic-modifier", { subject: "this-unit", characteristics: ["S"], operation: "add", value: 1, weapon_type: "all", weapon_keyword: "Flamer" })).toThrow();
  });

  it("reads a declared charge this phase and a Fall Back this turn as history", () => {
    const happened = (activities: string[]) => nodes(compiled([leaf("unit-activity", { activities, subject: "this-unit", negated: false }), heal()]), (node) => node.type === "happened").map((node) => node.parameters);
    expect(happened(["declared-charge-this-phase"])).toEqual([{ event: "targets-selected", filter: { kind: "charge" }, window: "phase" }]);
    expect(happened(["fell-back-this-turn", "advanced-this-turn"])).toHaveLength(2);
    expect(normalize("unit-activity", { activities: ["fell-back-this-turn", "advanced-this-turn"], subject: "this-unit", negated: false }).activities).toEqual(["advanced-this-turn", "fell-back-this-turn"]);
    expect(() => normalize("unit-activity", { activities: ["fell-back-this-turn", "fell-back-this-turn"], subject: "this-unit", negated: false })).toThrow(/twice/u);
  });

  it("measures wholly within, only for a within distance", () => {
    const within = nodes(compiled([leaf("unit-position", { kind: "within", inches: 6, subject: "this-unit", negated: false, of: "matching-unit", of_keywords: ["HARVESTER"], of_side: "friendly", wholly: true }), heal()]),
      (node) => node.type === "matches" && (node.parameters as Record<string, any> | undefined)?.filter?.within !== undefined)[0];
    expect(within!.parameters).toMatchObject({ filter: { within: { wholly: true, range: { inches: 6 } } } });
    expect(() => normalize("unit-position", { kind: "beyond", inches: 6, subject: "this-unit", negated: false, of: "this-model", wholly: true })).toThrow(/within distance/u);
  });

  it("measures a distance to any unit of a side, with no keywords", () => {
    const near = leaf("unit-position", { kind: "within", inches: 3, subject: "this-unit", negated: false, of: "matching-unit", of_side: "enemy" });
    expect(near.parameters).not.toHaveProperty("of_keywords");
    expect(nodes(compiled([near, heal()]), (node) => node.type === "matches" && (node.parameters as Record<string, any> | undefined)?.filter?.within !== undefined)[0]!.parameters)
      .toMatchObject({ filter: { within: { of: { owner: "enemy" }, range: { inches: 3 } } } });
    expect(() => normalize("unit-position", { kind: "within", inches: 3, subject: "this-unit", negated: false, of: "matching-unit" })).toThrow(/of_side/u);
  });

  it("selects several units, exactly or up to a number, and refuses a dice count", () => {
    const select = (parameters: Record<string, unknown>) => leaf("select-unit", { scope: "friendly", distance: "any", visible: false, ...parameters });
    const selector = (parameters: Record<string, unknown>) => first(compiled([select(parameters), leaf("keyword-grant", { subject: "this-unit", keywords: ["FLY"] })]), "select-units")!.selector;
    expect(selector({ count: 2, up_to: true })).toMatchObject({ count: { min: 0, max: 2 } });
    expect(selector({ count: 3 })).toMatchObject({ count: { min: 3, max: 3 } });
    expect(selector({})).toMatchObject({ count: { min: 1, max: 1 } });
    expect(selector({ count: 2, up_to: true })).not.toHaveProperty("max_count");
    expect(() => normalize("select-unit", { distance: "any", visible: false, count: "D3" })).toThrow(/dice count/u);
    expect(() => normalize("select-unit", { distance: "any", visible: false, up_to: true })).toThrow(/needs a count/u);
    expect(() => normalize("select-unit", { distance: "any", visible: false, count: 1 })).toThrow(/by default/u);
  });

  it("names the unit a Leader is attached to", () => {
    const attached = first(compiled([leaf("leading-unit", { subject: "this-model", attachment: "leading", attached_to_keywords: ["dominion squad"] }), heal()]), "attachment");
    expect(attached).toEqual({ type: "attachment", parameters: { subject: "this-model", role: "leading", with: { all_of: ["DOMINION SQUAD"] } } });
  });

  it("holds any one of several battle rounds", () => {
    const rounds = nodes(compiled([leaf("battle-round", { rounds: [5, 1, 3] }), heal()]), (node) => node.type === "battle-round").map((node) => node.parameters);
    expect(rounds).toEqual([{ min: 1, max: 1 }, { min: 3, max: 3 }, { min: 5, max: 5 }]);
    expect(() => normalize("battle-round", { rounds: [1, 3], min: 1 })).toThrow(/not both/u);
    expect(() => normalize("battle-round", { rounds: [1, 6] })).toThrow();
  });

  it("names whose step, whose Stratagem, and who failed which roll", () => {
    const trigger = (parameters: Record<string, unknown>, leaves: CompileLeaf[] = []) => compiled([...leaves, leaf("event", parameters), heal()]).trigger as Record<string, unknown>;
    expect(trigger({ kind: "step-started", step: "battle-shock", turn: "opponent" })).toEqual({ event: "step-started", filter: { step: "battle-shock" }, condition: { type: "player-turn-is", parameters: { turn: "opponent-turn" } } });
    expect(trigger({ kind: "step-started", step: "battle-shock", turn: "either" })).not.toHaveProperty("condition");
    expect(trigger({ kind: "used", activity: "stratagem", owner: "enemy" })).toEqual({ event: "used", filter: { kind: "stratagem" }, subject: { owner: "enemy" } });
    const failed = trigger({ kind: "after-roll", roll: "battle-shock", result: "failure", subject: "antecedent" }, [leaf("select-unit", { scope: "enemy", distance: "any", visible: false })]);
    expect(failed).toEqual({ event: "after-roll", filter: { roll: "battle-shock", result: "failure" }, subject: "selected-unit" });
    expect(() => normalize("event", { kind: "used", activity: "stratagem", result: "failure" })).toThrow(/after-roll only/u);
    expect(() => normalize("event", { kind: "phase-start", phase: "command", turn: "your", owner: "enemy" })).toThrow();
  });

  it("matches a keyword printed with a curly apostrophe against one with a straight apostrophe", () => {
    const root = mkdtempSync(join(tmpdir(), "semantic-authoring-extensions-2-"));
    roots.push(root);
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    // Fabricated fixture record only.
    writeFileSync(join(root, "core", "alpha", "enhancements.json"), JSON.stringify([{ id: "curly", keyword_restriction_groups: [["Emperor’s Children", "Infantry"]] }]));
    const check = (keywords: string[]) => coreCheckErrors(root, "curly", [{ kind: "bearer-eligibility", parameters: { keywords, match: "all", excluded_keywords: [] } }]);
    expect(check(["EMPEROR'S CHILDREN", "INFANTRY"])).toEqual([]);
    expect(check(["EMPEROR'S CHILDREN", "MOUNTED"])).toHaveLength(1);
  });

  it("accepts a keyword that starts with an apostrophe in every keyword-bearing family", () => {
    expect(normalize("unit-filter", { side: "friendly", keywords: ["'ALPHAMOB"] })).toMatchObject({ keywords: ["'ALPHAMOB"] });
    expect(normalize("bearer-eligibility", { keywords: ["'ALPHAMOB"], match: "all", excluded_keywords: [] })).toMatchObject({ keywords: ["'ALPHAMOB"] });
    expect(normalize("unit-keyword", { keywords: ["'ALPHAMOB"], subject: "target", negated: false })).toMatchObject({ keywords: ["'ALPHAMOB"] });
    expect(() => normalize("unit-filter", { side: "friendly", keywords: ["''ALPHAMOB"] })).toThrow();
    expect(() => normalize("unit-filter", { side: "friendly", keywords: ["ALPHAMOB'"] })).toThrow();
    expect(() => normalize("unit-filter", { side: "friendly", keywords: ["'ALPHAMOB", "ALPHAMOB"] })).toThrow(/both with and without/u);
  });

  it("matches a leading-apostrophe keyword against a core record printed with a curly apostrophe", () => {
    const root = mkdtempSync(join(tmpdir(), "semantic-authoring-extensions-2-"));
    roots.push(root);
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    // Fabricated fixture record only.
    writeFileSync(join(root, "core", "alpha", "enhancements.json"), JSON.stringify([{ id: "leading", keyword_restriction_groups: [["’Alphamob", "Infantry"]] }]));
    const check = (keywords: string[]) => coreCheckErrors(root, "leading", [{ kind: "bearer-eligibility", parameters: { keywords, match: "all", excluded_keywords: [] } }]);
    expect(check(["'ALPHAMOB", "INFANTRY"])).toEqual([]);
    expect(check(["ALPHAMOB", "INFANTRY"])).toHaveLength(1);
  });

  it("matches a keyword printed with a non-breaking hyphen against one with an ASCII hyphen", () => {
    const root = mkdtempSync(join(tmpdir(), "semantic-authoring-extensions-2-"));
    roots.push(root);
    mkdirSync(join(root, "core", "alpha"), { recursive: true });
    // Fabricated fixture record only.
    writeFileSync(join(root, "core", "alpha", "enhancements.json"), JSON.stringify([{ id: "dashed", keyword_restriction_groups: [["Alpha\u2011Captain in Heavy Armour"]] }]));
    const check = (keywords: string[]) => coreCheckErrors(root, "dashed", [{ kind: "bearer-eligibility", parameters: { keywords, match: "all", excluded_keywords: [] } }]);
    expect(check(["ALPHA-CAPTAIN IN HEAVY ARMOUR"])).toEqual([]);
    expect(check(["ALPHA-CAPTAIN"])).toHaveLength(1);
  });
});
