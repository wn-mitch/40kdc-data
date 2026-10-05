import { describe, expect, it } from "vitest";

import { compileLeaves, leafFragment } from "../src/round5c/compile.js";
import type { CompileLeaf } from "../src/round5c/compile-fragments.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";
import { ANTECEDENT_KEYS, antecedentVersion } from "../src/round5c/antecedent-families.js";
import { mapToLatest } from "../src/round5c/family-versions.js";

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

describe("Round 5C anaphoric subjects", () => {
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
      // The antecedent version may have been widened again since (family-extensions.ts); its predecessor never takes it.
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
