import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileLeaves, leafFragment } from "../src/semantic-authoring/compile.js";
import { bindAntecedents, postfixFilter } from "../src/semantic-authoring/compile-antecedent.js";
import type { CompileLeaf } from "../src/semantic-authoring/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/semantic-authoring/contracts.js";
import { ANTECEDENT_KEYS, antecedentVersion } from "../src/semantic-authoring/antecedent-families.js";
import { mapToLatest } from "../src/semantic-authoring/family-versions.js";
import { checkEntry, entryWithMechanics } from "../src/semantic-authoring/entries.js";
import { expectCompiled } from "./semantic-authoring-connective-fixture.js";

let at = 0;
function leaf(family_id: string, parameters: Record<string, unknown>): CompileLeaf {
  const family_version = currentFamilyVersion(family_id);
  at += 10;
  return { role: familyRole(family_id, family_version), family_id, family_version, parameters: normalizeFingerprintParameters(family_id, parameters, family_version), start_byte: at };
}

const selectEnemy = () => leaf("select-unit", { scope: "enemy", distance: "any", visible: false });
const enemyFallsBack = () => leaf("event", { kind: "move-ended", owner: "enemy", move_types: ["fall-back"] });
const engaged = (subject: string) => leaf("unit-state", { states: ["engaged"], subject, negated: false });
const mortal = (recipient: string) => leaf("mortal-wounds", { recipient, count: "D3" });

describe("Semantic authoring anaphoric subjects", () => {
  it("binds 'that enemy unit' after a selection to the selected unit, exactly as naming it would", () => {
    const pointing = compileLeaves([selectEnemy(), mortal("antecedent")]);
    expect(pointing.ok).toBe(true);
    // A mortal-wounds recipient names a selected unit as that-unit.
    expect(pointing).toEqual(compileLeaves([selectEnemy(), mortal("that-unit")]));
  });

  it("binds it after a triggering event to the event's unit", () => {
    const pointing = compileLeaves([enemyFallsBack(), engaged("antecedent"), mortal("this-unit")]);
    expect(pointing.ok).toBe(true);
    expect(pointing).toEqual(compileLeaves([enemyFallsBack(), engaged("event-subject"), mortal("this-unit")]));
    expect(JSON.stringify(pointing)).not.toContain("antecedent");
  });

  it("prefers an earlier selection over an earlier event", () => {
    expect(compileLeaves([enemyFallsBack(), selectEnemy(), engaged("antecedent"), mortal("this-unit")]))
      .toEqual(compileLeaves([enemyFallsBack(), selectEnemy(), engaged("selected-unit"), mortal("this-unit")]));
  });

  it("refuses a Stratagem's anaphor nothing earlier introduces, or one its family cannot name", () => {
    const inEffect = (item: CompileLeaf): CompileLeaf => ({ ...item, fragment: "EFFECT" });
    expect(compileLeaves([inEffect(engaged("antecedent")), inEffect(mortal("this-unit"))]))
      .toMatchObject({ ok: false, errors: [expect.stringMatching(/no earlier leaf selects a unit, targets a Stratagem or names a unit's moment/u)] });
    // A selection after the anaphor does not count.
    expect(compileLeaves([inEffect(mortal("antecedent")), inEffect(selectEnemy())])).toMatchObject({ ok: false });
    // An apply-mark subject lowers as any unit-ref, so it also names a triggering unit.
    expect(JSON.stringify(compileLeaves([enemyFallsBack(), leaf("apply-mark", { subject: "antecedent", tag: "suppressed" })]))).toContain('"type":"designate","target":"event-subject"');
  });

  it("binds a Stratagem's 'that unit' to its target, which its effects name as this unit", () => {
    const target = () => ({ ...leaf("stratagem-target", { count: "one", side: "your-army", selects: "unit", keywords: ["INFANTRY"], match: "all", excluded_keywords: [] }), fragment: "TARGET" });
    const advance = (subject: string) => ({ ...leaf("characteristic-modifier", { subject, characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }), fragment: "EFFECT" });
    const pointing = compileLeaves([target(), advance("antecedent")]);
    expect(pointing.ok).toBe(true);
    expect(pointing).toEqual(compileLeaves([target(), advance("this-unit")]));
    // Families that only name the ability's own unit can point back to the target, and nothing else.
    const permission = (subject: string) => ({ ...leaf("eligibility-permission", { subject, activity: "shoot", allow: true }), fragment: "EFFECT" });
    expect(compileLeaves([target(), permission("antecedent")])).toEqual(compileLeaves([target(), permission("this-unit")]));
    // A selected unit is a plain DSL unit-ref, which the permission's subject (lowered as any unit-ref) takes.
    expect(JSON.stringify(compileLeaves([selectEnemy(), permission("antecedent")]))).toContain('"target":"selected-unit"');
    // A key that names only the ability's own unit still refuses it.
    const restriction = () => ({ ...leaf("targeting-restriction", { subject: "antecedent", may: "cannot-target", kind: "shoot", weapon_type: "all" }), fragment: "EFFECT" });
    expect(compileLeaves([selectEnemy(), restriction()]))
      .toMatchObject({ ok: false, errors: [expect.stringMatching(/selected-unit, which its subject cannot name/u)] });
    // A selection inside the Stratagem still comes first: "select one enemy unit … that enemy unit".
    expect(compileLeaves([target(), selectEnemy(), mortal("antecedent")])).toEqual(compileLeaves([target(), selectEnemy(), mortal("that-unit")]));
  });

  it("binds to a triggering event only when its moment names a unit", () => {
    const phaseStarts = () => leaf("event", { kind: "phase-start", phase: "command", turn: "your" });
    // A phase boundary introduces no unit: in a Stratagem nothing binds; elsewhere it is the record's own unit.
    expect(compileLeaves([{ ...phaseStarts(), fragment: "WHEN" }, { ...engaged("antecedent"), fragment: "EFFECT" }, { ...mortal("this-unit"), fragment: "EFFECT" }]))
      .toMatchObject({ ok: false, errors: [expect.stringMatching(/names a unit's moment/u)] });
    expect(compileLeaves([phaseStarts(), engaged("antecedent"), mortal("this-unit")]))
      .toEqual(compileLeaves([phaseStarts(), engaged("this-unit"), mortal("this-unit")]));
    // A unit's moment after it still binds.
    expect(compileLeaves([phaseStarts(), enemyFallsBack(), engaged("antecedent"), mortal("this-unit")]))
      .toEqual(compileLeaves([phaseStarts(), enemyFallsBack(), engaged("event-subject"), mortal("this-unit")]));
    // A Stratagem's target outranks the triggering unit.
    const target = () => ({ ...leaf("stratagem-target", { count: "one" }), fragment: "TARGET" });
    expect(compileLeaves([enemyFallsBack(), target(), engaged("antecedent"), mortal("this-unit")]))
      .toEqual(compileLeaves([enemyFallsBack(), target(), engaged("this-unit"), mortal("this-unit")]));
  });

  it("binds an anaphor nothing introduces outside a Stratagem to the record's own unit, or its model", () => {
    const setUp = (subject: string) => leaf("set-up", { subject, to: "battlefield", min_enemy_distance: 9 });
    expect(compileLeaves([setUp("antecedent")])).toEqual(compileLeaves([setUp("this-unit")]));
    // A record whose leaves only ever name this model points back to the model.
    const save = leaf("invulnerable-save", { subject: "this-model", threshold: 4 });
    expect(compileLeaves([save, setUp("antecedent")])).toEqual(compileLeaves([save, setUp("this-model")]));
    const mark = (subject: string) => leaf("apply-mark", { subject, tag: "suppressed" });
    expect(compileLeaves([save, mark("antecedent")])).toEqual(compileLeaves([save, mark("this-model")]));
    // A leaf naming this unit anywhere in the record makes the unit the referent.
    const unitSave = leaf("invulnerable-save", { subject: "this-unit", threshold: 5 });
    expect(compileLeaves([save, unitSave, mark("antecedent")])).toEqual(compileLeaves([save, unitSave, mark("this-unit")]));
  });

  it("previews an anaphor as text-free, since only the record says who it is", () => {
    expect(leafFragment(engaged("antecedent"))).toMatchObject({ kind: "implicit", note: expect.stringMatching(/^No separate text: points back/u) });
  });

  it("accepts antecedent only from the new version, which every earlier leaf still fits", () => {
    const old = { states: ["engaged"], subject: "selected-unit", negated: false };
    expect(currentFamilyVersion("unit-state")).toBeGreaterThanOrEqual(6);
    expect(normalizeFingerprintParameters("unit-state", old, 5)).toEqual(old);
    expect(mapToLatest("unit-state", 5, old)).toEqual({ family: "unit-state", version: currentFamilyVersion("unit-state"), parameters: old });
    expect(() => normalizeFingerprintParameters("unit-state", { ...old, subject: "antecedent" }, 5)).toThrow(/subject must be one of/u);
    expect(normalizeFingerprintParameters("unit-state", { ...old, subject: "antecedent" }, 6)).toEqual({ ...old, subject: "antecedent" });
    // Both ends of one leaf can point back, and each stays its own value.
    expect(normalizeFingerprintParameters("unit-state", { ...old, subject: "antecedent", with: "antecedent" }, 6))
      .toEqual({ ...old, subject: "antecedent", with: "antecedent" });
    // A key that is not a unit-ref never takes it.
    expect(() => normalizeFingerprintParameters("unit-state", { ...old, states: ["antecedent"] }, 6)).toThrow();
    // anyOf subjects (a value or quoted source) take it too.
    expect(normalizeFingerprintParameters("apply-mark", { subject: "antecedent", tag: "suppressed" }, currentFamilyVersion("apply-mark")).subject).toBe("antecedent");
  });

  it("gives every listed family one current version whose listed keys accept antecedent", () => {
    for (const [id, keys] of Object.entries(ANTECEDENT_KEYS)) {
      const versions = REVIEWED_FAMILY_REGISTRY.filter((family) => family.id === id);
      const current = versions.filter((family) => !family.deprecated);
      expect(current, id).toHaveLength(1);
      expect(Math.max(...versions.map((family) => family.version)), id).toBe(current[0]!.version);
      // The antecedent version may have been widened again since (families/); its predecessor never takes it.
      const first = antecedentVersion(id)!;
      expect(current[0]!.version, id).toBeGreaterThanOrEqual(first);
      const previous = versions.find((family) => family.version === first - 1)!;
      expect(previous.deprecated, id).toBe(true);
      for (const key of keys) {
        expect(JSON.stringify((current[0]!.parameterSchema.properties as Record<string, unknown>)[key]), `${id}.${key}`).toContain("antecedent");
        expect(JSON.stringify((previous.parameterSchema.properties as Record<string, unknown>)[key]), `${id}.${key}`).not.toContain("antecedent");
      }
    }
  });
});

/** Leaves placed on fabricated wording in order, each spanning its phrase; the wording is the text the claim gate reads. */
function placedIn(text: string, ...items: Array<[string, CompileLeaf["family_id"], Record<string, unknown>, string?]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family_id, parameters, fragment = "RAW_TEXT"]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const family_version = currentFamilyVersion(family_id);
    return { role: familyRole(family_id, family_version), family_id, family_version, parameters, start_byte: start, end_byte: from, fragment };
  });
}

describe("Semantic authoring a filter after a characteristic change, and a later roll that points back", () => {
  // Fabricated wording of the 6690 shape: a Move change, its recipient filter and owner, then a roll
  // change joined by "and" (not a linking verb), so the Move change takes the filter.
  const moveText = "Gain Move 2 for friendly FOO WALKER units from your army and add 1 to bonus rolls made for such units.";
  const move = ["Gain Move 2 for", "characteristic-modifier", { subject: "antecedent", characteristics: ["M"], operation: "add", value: 2, weapon_type: "all" }] as const;
  const filter = ["friendly FOO WALKER units", "unit-filter", { side: "friendly", keywords: ["FOO", "WALKER"] }] as const;
  const owner = ["from your army", "unit-owner", { owner: "friendly" }] as const;
  const roll = ["bonus rolls", "roll-modifier", { subject: "antecedent", operation: "add", value: 1, rolls: ["advance", "charge"] }] as const;
  const moveLeaves = (text: string) => placedIn(text, [...move], [...filter], [...owner], [...roll]);

  it("gives the filter to the Move change when only 'and add' joins the roll to it", () => {
    const list = moveLeaves(moveText);
    expect(postfixFilter(list, 0, moveText)).toBe(true);
    const bound = bindAntecedents(list, undefined, moveText);
    expect(bound[0]!.parameters.subject).toBe("filtered-units");
  });

  it("gives the roll the Move change's filter, not this unit", () => {
    const result = compileLeaves(moveLeaves(moveText), moveText);
    expectCompiled(result);
    const flat = (node: Record<string, any>): Array<Record<string, any>> => node.type === "sequence" ? node.steps.flatMap(flat) : [node];
    const changes = flat(result.mechanics.effect as Record<string, any>);
    expect(changes.map((change) => change.type)).toEqual(["stat-modifier", "roll-modifier", "roll-modifier"]);
    expect(changes[0]!.target).toEqual({ owner: "friendly", all_of: ["FOO", "WALKER"] });
    expect(changes.map((change) => change.target)).toEqual([changes[0]!.target, changes[0]!.target, changes[0]!.target]);
  });

  it("keeps the filter with the linking verb's effect, so the Move change points back with no unit", () => {
    const haveText = "Gain Move 2 for friendly FOO units have bonus rolls.";
    const list = placedIn(haveText, [...move], ["friendly FOO units", "unit-filter", { side: "friendly", keywords: ["FOO"] }], ["bonus rolls", "roll-modifier", { subject: "antecedent", operation: "add", value: 1, rolls: ["advance"] }]);
    expect(postfixFilter(list, 0, haveText)).toBe(false);
    // The roll binds the filter through bareFilter (the Move change is not in its way).
    const bound = bindAntecedents(list.slice(1), undefined, haveText);
    expect(bound[1]!.parameters.subject).toBe("filtered-units");
  });

  it("refuses the Move change when a linking verb gives the filter to the roll after it", () => {
    const haveText = "Gain Move 2 for friendly FOO units have bonus rolls.";
    const list = placedIn(haveText, [...move], ["friendly FOO units", "unit-filter", { side: "friendly", keywords: ["FOO"] }], ["bonus rolls", "roll-modifier", { subject: "antecedent", operation: "add", value: 1, rolls: ["advance"] }]);
    expect(() => bindAntecedents(list, undefined, haveText)).toThrow("belongs to a later effect and no earlier leaf names it");
  });

  it("keeps an aura's claim of a filter as it was (the change is not refused)", () => {
    const auraText = "Gain Move 2 for friendly FOO units within 6\" of this unit.";
    const list = placedIn(auraText, [...move], ["friendly FOO units", "unit-filter", { side: "friendly", keywords: ["FOO"] }], ["within 6\" of this unit", "aura-range", { side: "friendly", distance: "within", range: 6 }]);
    expect(postfixFilter(list, 0, auraText)).toBe(false);
    expect(bindAntecedents(list, undefined, auraText)[0]!.parameters.subject).toBe("this-unit");
  });
});

describe("Semantic authoring act-after-move that points back to the units a filter or a selection named", () => {
  // Fabricated wording of the 3711 and 6821 shapes.
  const filterText = "Friendly FOO BAR units from your army are eligible to shoot and declare a charge in a turn in which they Fell Back.";
  const filtered = (subject: string) => placedIn(filterText,
    ["Friendly FOO BAR units", "unit-filter", { side: "friendly", keywords: ["FOO", "BAR"] }],
    ["from your army", "unit-owner", { owner: "friendly" }],
    ["are eligible to shoot and declare a charge in a turn in which they Fell Back", "act-after-move", { subject, moves: ["fall-back"], acts: ["shoot", "charge"] }]);

  it("gives every unit the filter names the permissions, exactly as a filtered recipient would", () => {
    const result = compileLeaves(filtered("antecedent"), filterText);
    expect(result.ok).toBe(true);
    const steps = (result as any).mechanics.effect.steps as Array<Record<string, any>>;
    expect(steps.map((step) => step.modifier)).toEqual([
      { activity: "shoot", allow: true, after: ["fall-back"] },
      { activity: "declare-charge", allow: true, after: ["fall-back"] },
    ]);
    for (const step of steps) expect(step.target).toEqual({ owner: "friendly", all_of: ["FOO", "BAR"] });
  });

  it("keeps a subject that is not an antecedent as the record's own unit, ignoring the filter", () => {
    const result = compileLeaves(filtered("this-unit"), filterText);
    expect(JSON.stringify(result)).not.toContain('"owner":"friendly"');
  });

  it("names a menu option's selected unit instead of the bearer's", () => {
    const text = "You can select one friendly FOO unit; that unit is eligible to shoot in a turn in which it Fell Back.";
    const list = (subject: string) => placedIn(text,
      ["select one", "select-unit", { distance: "any", visible: false }],
      ["friendly FOO unit", "unit-filter", { side: "friendly", keywords: ["FOO"] }],
      ["that unit is eligible to shoot in a turn in which it Fell Back", "act-after-move", { subject, moves: ["fall-back"], acts: ["shoot"] }]);
    const effect = (subject: string) => (compileLeaves(list(subject), text) as any).mechanics.effect;
    expect(effect("antecedent").effect).toMatchObject({ type: "permission", target: "selected-unit" });
    expect(effect("this-unit").effect).toMatchObject({ type: "permission", target: "this-unit" });
  });

  it("refuses a Stratagem effect that points back to no unit at all", () => {
    const only = placedIn("are eligible to shoot after falling back", ["are eligible to shoot after falling back", "act-after-move", { subject: "antecedent", moves: ["fall-back"], acts: ["shoot"] }, "EFFECT"]);
    expect(compileLeaves(only, "are eligible to shoot after falling back")).toMatchObject({ ok: false, errors: [expect.stringMatching(/no earlier leaf selects a unit/u)] });
  });
});

/** A registered designation, so a designate-target compiles (compile-wrappers.ts designationIdFor). */
const FIXTURE_RULE_NAME = "A Trap Well Laid";

const dataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/enrichment");
const base = (): Record<string, unknown> => (JSON.parse(readFileSync(join(dataRoot, "adeptus-mechanicus", "abilities.json"), "utf8")) as Array<Record<string, unknown>>)
  .find((entry) => entry.ability_id === "control-edict-adeptus-mechanicus")!;

/** The compiled entry validates against the ability schema and renders. */
function checked(list: CompileLeaf[], text: string): string {
  const result = compileLeaves(list, text, { name: FIXTURE_RULE_NAME });
  if (!result.ok) throw new Error(result.errors.join("; "));
  const check = checkEntry(entryWithMechanics(base(), result.mechanics));
  expect(check.errors).toEqual([]);
  return check.rendered_text!;
}

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

function effectOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = compileLeaves(list, text, { name: FIXTURE_RULE_NAME });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return (result.mechanics as unknown as Record<string, any>).effect;
}

const ALPHA = { owner: "friendly", all_of: ["ALPHA"] };
const friendlyAlpha = (wording: string): [string, string, Record<string, unknown>] => [wording, "unit-filter", { side: "friendly", keywords: ["ALPHA"] }];

describe("Semantic authoring antecedent slots: \"that unit\" after an earlier filter", () => {
  it("moves each filtered unit that meets its own condition", () => {
    const text = "If a friendly ALPHA unit is within range of an objective marker, that unit can make a Normal move of up to 3\".";
    const effect = effectOf(placed(text,
      friendlyAlpha("friendly ALPHA unit"),
      ["is within range of an objective marker", "unit-position", { kind: "objective-range", controlled_by: "any", subject: "antecedent", negated: false }],
      ["that unit can make a Normal move of up to 3\"", "make-move", { subject: "antecedent", move_type: "normal", distance: 3 }]), text);
    expect(effect.type).toBe("conditional");
    expect(JSON.stringify(effect.condition)).toContain('"recipient"');
    expect(effect.effect).toMatchObject({ type: "move", target: ALPHA });
  });

  it("makes each filtered unit take its own test, and marks the filtered units", () => {
    const text = "If an enemy unit is within 6\" of this model, that unit must take a Battle-shock test. If an enemy unit is within 3\" of this model, that unit is Afflicted.";
    const effect = effectOf(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "antecedent", negated: false }],
      ["that unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is within 3\" of this model", "unit-position", { kind: "within", inches: 3, of: "this-model", subject: "antecedent", negated: false }],
      ["that unit is Afflicted", "apply-mark", { subject: "antecedent", tag: "afflicted" }]), text);
    const text_ = JSON.stringify(effect);
    expect(checked(placed(text,
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is within 6\" of this model", "unit-position", { kind: "within", inches: 6, of: "this-model", subject: "antecedent", negated: false }],
      ["that unit must take a Battle-shock test", "test", { target: "antecedent", test: "battle-shock" }],
      ["enemy unit", "unit-filter", { side: "enemy" }],
      ["is within 3\" of this model", "unit-position", { kind: "within", inches: 3, of: "this-model", subject: "antecedent", negated: false }],
      ["that unit is Afflicted", "apply-mark", { subject: "antecedent", tag: "afflicted" }]), text)).toMatch(/Battle-shock test/iu);
    expect(text_).not.toContain("filtered-units");
    expect(text_).toContain('"type":"test","target":{"owner":"enemy"}');
    expect(text_).toContain('"type":"designate","target":{"owner":"enemy"}');
  });

  it("names the filtered unit as the destroyer of a unit-destroyed moment", () => {
    const text = "Each time a friendly ALPHA unit destroys an enemy unit, that unit can make a Normal move of up to 3\".";
    const result = compileLeaves(placed(text,
      friendlyAlpha("friendly ALPHA unit"),
      ["destroys an enemy unit", "event", { kind: "unit-destroyed", by: "antecedent" }],
      ["that unit can make a Normal move of up to 3\"", "make-move", { subject: "antecedent", move_type: "normal", distance: 3 }]), text, { name: FIXTURE_RULE_NAME });
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    const mechanics = result.mechanics as unknown as Record<string, any>;
    expect(mechanics.trigger.subject).toEqual(ALPHA);
    expect(JSON.stringify(mechanics)).not.toContain("filtered-units");
  });

  it("lets in-region test each filtered unit", () => {
    expect(normalizeFingerprintParameters("in-region", { subject: "antecedent", region_kind: "terrain-area", terrain_tag: "ruins" }, currentFamilyVersion("in-region")))
      .toMatchObject({ subject: "antecedent" });
    const text = "If a friendly ALPHA unit is within a ruins terrain area, that unit can make a Normal move of up to 3\".";
    const effect = effectOf(placed(text,
      friendlyAlpha("friendly ALPHA unit"),
      ["is within a ruins terrain area", "in-region", { subject: "antecedent", region_kind: "terrain-area", terrain_tag: "ruins" }],
      ["that unit can make a Normal move of up to 3\"", "make-move", { subject: "antecedent", move_type: "normal", distance: 3 }]), text);
    expect(effect.condition).toMatchObject({ type: "in-region", parameters: { subject: "recipient" } });
    expect(effect.effect).toMatchObject({ type: "move", target: ALPHA });
  });

  it("lets a filter's units move through models and be set up in Strategic Reserves", () => {
    const text = "Friendly ALPHA units can be placed into Strategic Reserves.";
    const effect = effectOf(placed(text,
      friendlyAlpha("Friendly ALPHA units"),
      ["can be placed into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves" }]), text);
    expect(effect).toMatchObject({ type: "set-up", target: ALPHA });
    expect(checked(placed(text,
      friendlyAlpha("Friendly ALPHA units"),
      ["can be placed into Strategic Reserves", "set-up", { subject: "antecedent", to: "strategic-reserves" }]), text)).toMatch(/ALPHA/u);
  });
});

describe("Semantic authoring attackers named by an earlier unit", () => {
  it("lets an enemy unit make the attack, narrowed by a filter right before it", () => {
    const bare = "Each time an enemy model makes an attack, subtract 1 from the Hit roll.";
    expect(effectOf(placed(bare,
      ["Each time an enemy model makes an attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "any" }],
      ["subtract 1 from the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }]), bare))
      .toMatchObject({ type: "roll-modifier", target: { owner: "enemy" } });
    const filtered = "Each time an enemy MONSTER model makes an attack, subtract 1 from the Hit roll.";
    expect(effectOf(placed(filtered,
      ["enemy MONSTER model", "unit-filter", { side: "enemy", keywords: ["MONSTER"], level: "model" }],
      ["makes an attack", "attack", { direction: "makes", unit: "enemy-unit", attack_type: "any" }],
      ["subtract 1 from the Hit roll", "roll-modifier", { roll: "hit", operation: "subtract", value: 1 }]), filtered))
      .toMatchObject({ type: "roll-modifier", target: { owner: "enemy", all_of: ["MONSTER"], level: "model" } });
  });

  it("binds \"a model in that unit makes an attack\" to the aura's recipient, not this unit", () => {
    const text = "While a friendly ALPHA unit is within 6\" of this model, each time a model in that unit makes an attack, re-roll a Hit roll of 1.";
    const effect = effectOf(placed(text,
      friendlyAlpha("friendly ALPHA unit"),
      ["is within 6\" of this model", "aura-range", { inches: 6, of: "this-model" }],
      ["each time a model in that unit makes an attack", "attack", { direction: "makes", unit: "that-unit", attack_type: "any" }],
      ["re-roll a Hit roll of 1", "reroll", { roll: "hit", subset: "ones", weapon_type: "all" }]), text);
    expect(effect.type).toBe("aura");
    expect(JSON.stringify(effect.modifier.effect)).toContain('"target":"recipient"');
    expect(JSON.stringify(effect.modifier.effect)).not.toContain('"target":"this-unit"');
  });

  it("gates the attack on a condition between the attacker's filter and the attack", () => {
    const text = "Each time a friendly model that made a Charge move this turn makes an attack, add 1 to the Hit roll.";
    const effect = effectOf(placed(text,
      ["friendly model", "unit-filter", { side: "friendly", level: "model" }],
      ["that made a Charge move this turn", "unit-activity", { activities: ["charged-this-turn"], subject: "antecedent", negated: false }],
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["add 1 to the Hit roll", "roll-modifier", { roll: "hit", operation: "add", value: 1 }]), text);
    expect(effect.type).toBe("conditional");
    expect(JSON.stringify(effect.condition)).toContain('"subject":"attacker"');
    expect(effect.effect).toMatchObject({ type: "roll-modifier", target: { owner: "friendly", level: "model" } });
  });

  it("reads the filter after \"an attack made by a\" as the attacker, not the target", () => {
    const text = "Each time an attack made by a friendly ALPHA model is resolved, add 1 to the Wound roll.";
    const effect = effectOf(placed(text,
      ["Each time an attack made by a", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["add 1 to the Wound roll", "roll-modifier", { roll: "wound", operation: "add", value: 1 }]), text);
    expect(effect).toMatchObject({ type: "roll-modifier", target: { owner: "friendly", all_of: ["ALPHA"], level: "model" } });
  });
});

/** The key paths at which a compiled tree holds a node that passes `test`. */
function pathsWhere(root: unknown, test: (node: Record<string, any>) => boolean, path = "$", out: string[] = []): string[] {
  if (Array.isArray(root)) root.forEach((item, index) => pathsWhere(item, test, `${path}[${index}]`, out));
  else if (root !== null && typeof root === "object") {
    if (test(root as Record<string, any>)) out.push(path);
    for (const [key, value] of Object.entries(root)) pathsWhere(value, test, `${path}.${key}`, out);
  }
  return out;
}
const attackerGate = (node: Record<string, any>) => node.type === "happened" && node.parameters?.subject === "attacker";

describe("Semantic authoring attacker gates on a designation are checked per attack", () => {
  // "In your Shooting phase ... select one enemy unit ..., each time a friendly ALPHA model that
  // disembarked from this TRANSPORT this turn makes an attack that targets that enemy unit": the
  // designation's effect is the attack's re-roll, gated on the attacker's disembark.
  const SHOT = "In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks. Until the end of the phase, each time a friendly ALPHA model that disembarked from this TRANSPORT this turn makes an attack that targets that enemy unit, you can re-roll the Wound roll.";
  const SHOT_LEAVES: Array<[string, string, Record<string, unknown>]> = [
    ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
    ["after this model has shot", "event", { kind: "after-shooting" }],
    ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
    ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
    ["that disembarked from this TRANSPORT this turn", "unit-activity", { activities: ["disembarked-from-this-transport-this-turn"], subject: "antecedent", negated: false }],
    ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
    ["that targets that enemy unit", "target-is-selected", {}],
    ["you can re-roll the Wound roll", "reroll", { roll: "wound", subset: "all", weapon_type: "all" }],
  ];
  const swap = (from: string, to: [string, string, Record<string, unknown>]) =>
    SHOT_LEAVES.map((leaf) => (leaf[0] === from ? to : leaf));
  const compiled = (text: string, leaves: Array<[string, string, Record<string, unknown>]>): Record<string, any> => {
    const result = compileLeaves(placed(text, ...leaves), text, { name: FIXTURE_RULE_NAME });
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.mechanics as unknown as Record<string, any>;
  };

  it("checks the attacker's disembark gate on each attack, inside the designation", () => {
    const mechanics = compiled(SHOT, SHOT_LEAVES);
    expect(pathsWhere(mechanics.effect.condition, attackerGate)).toEqual([]);
    const applies = mechanics.effect.effect.applies.effect;
    expect(applies).toMatchObject({ type: "conditional", condition: { type: "happened", parameters: { subject: "attacker" } } });
    expect(applies.effect).toMatchObject({ type: "re-roll", modifier: { roll: "wound" } });
    checked(placed(SHOT, ...SHOT_LEAVES), SHOT);
  });

  it("keeps the attack type gate beside the attacker gate for a psychic attack", () => {
    const text = SHOT.replace("makes an attack", "makes a Psychic Attack");
    const leaves = swap("makes an attack", ["makes a Psychic Attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "psychic" }]);
    const mechanics = compiled(text, leaves);
    expect(pathsWhere(mechanics.effect.condition, attackerGate)).toEqual([]);
    expect(mechanics.effect.effect.applies.effect).toMatchObject({
      type: "conditional",
      condition: { operator: "and", operands: [{ type: "happened", parameters: { subject: "attacker" } }, { type: "attack-is", parameters: { attack_type: "psychic" } }] },
    });
  });

  it("keeps the usage limit at the top level while the attacker gate moves into the designation", () => {
    const text = "In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks. Until the end of the turn, each time a friendly ALPHA model that disembarked from this TRANSPORT this turn makes an attack that targets that enemy unit, improve the Armour Penetration characteristic of that attack by 1. The same enemy unit can only be affected by this ability once per turn.";
    const leaves: Array<[string, string, Record<string, unknown>]> = [
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["after this model has shot", "event", { kind: "after-shooting" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["Until the end of the turn", "duration", { endpoint: "end-of-turn" }],
      ["friendly ALPHA model", "unit-filter", { side: "friendly", keywords: ["ALPHA"], level: "model" }],
      ["that disembarked from this TRANSPORT this turn", "unit-activity", { activities: ["disembarked-from-this-transport-this-turn"], subject: "antecedent", negated: false }],
      ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
      ["that targets that enemy unit", "target-is-selected", {}],
      ["improve the Armour Penetration characteristic of that attack by 1", "characteristic-modifier", { subject: "attack", characteristics: ["AP"], operation: "improve", value: 1, weapon_type: "all" }],
      ["once per turn", "usage-limit", { frequency: "once-per-turn", per: "unit" }],
    ];
    const mechanics = compiled(text, leaves);
    expect(mechanics.usage).toEqual({ frequency: "once-per-turn", per: "unit" });
    expect(pathsWhere(mechanics.effect.condition, attackerGate)).toEqual([]);
    expect(mechanics.effect.effect.applies.effect.condition).toMatchObject({ type: "happened", parameters: { subject: "attacker" } });
  });

  it("refuses the disembark gate when the attack verb has no attack leaf", () => {
    const leaves = SHOT_LEAVES.filter((leaf) => leaf[0] !== "makes an attack");
    expect(() => compiled(SHOT, leaves)).toThrow(/needs a select-unit or attack right before it|selected unit needs an attack leaf/);
  });

  it("refuses the disembark wording written as one attacks-resolved event (no attack leaf)", () => {
    // Record shape: the event spans "a model that disembarked ... makes an attack"; the target and the re-roll follow it.
    const text = "In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks. Until the end of the phase, each time a model that disembarked from this TRANSPORT this turn makes an attack that targets that enemy unit, you can re-roll the Hit roll.";
    const leaves: Array<[string, string, Record<string, unknown>]> = [
      ["In your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
      ["after this model has shot", "event", { kind: "after-shooting" }],
      ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
      ["hit by one or more of those attacks", "hit-by-attacks", { subject: "selected-unit" }],
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["a model that disembarked from this TRANSPORT this turn makes an attack", "event", { kind: "attacks-resolved" }],
      ["that targets that enemy unit", "target-is-selected", {}],
      ["you can re-roll the Hit roll", "reroll", { roll: "hit", subset: "all", weapon_type: "all" }],
    ];
    expect(() => compiled(text, leaves)).toThrow(/needs an attack leaf/);
  });

  it("compiles the attacks-resolved rewrite as a unit-filter, a unit-activity and an attack", () => {
    const text = SHOT.replace("a friendly ALPHA model", "a model");
    const leaves = SHOT_LEAVES.map((leaf): [string, string, Record<string, unknown>] => leaf[0] === "friendly ALPHA model" ? ["a model", "unit-filter", { side: "friendly", level: "model" }] : leaf);
    const mechanics = compiled(text, leaves);
    expect(pathsWhere(mechanics.effect.condition, attackerGate)).toEqual([]);
    expect(mechanics.effect.effect.applies.effect.condition).toMatchObject({ type: "happened", parameters: { subject: "attacker" } });
  });
});
