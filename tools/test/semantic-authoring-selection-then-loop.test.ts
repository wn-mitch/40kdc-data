import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/semantic-authoring/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "../src/semantic-authoring/contracts.js";
import { createValidator } from "../src/schema-loader.js";

type Item = [string, string, Record<string, unknown>];
type Node = Record<string, any>;

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

const run = (text: string, ...items: Item[]) => compileLeaves(placed(text, ...items), text, { abilityId: "fabricated-watch-pact", name: "Watch Pact" });

const TEXT = "At the start of your Shooting phase you can select units from your army to become Watchers. "
  + "During your Shooting phase, for each Watcher unit from your army that is eligible to shoot, select one enemy unit that is visible to be marked as their Quarry unit until the end of the phase. "
  + "Until the end of the phase, each time a model from your army makes an attack that targets a Quarry unit, improve the Ballistic Skill characteristic of that attack by 1.";
const HEAD: Item[] = [
  ["At the start of your Shooting phase", "event", { kind: "phase-start", phase: "shooting", turn: "your" }],
  ["you can", "optional-use", { who: "you" }],
  ["select units", "select-unit", { scope: "friendly", distance: "any", visible: false, at_least: true }],
  ["from your army", "unit-owner", { owner: "friendly" }],
  ["to become Watchers", "apply-mark", { subject: "selected-unit", tag: "observer" }],
];
const LOOP: Item[] = [
  ["During your Shooting phase", "phase-window", { phase: "shooting", turn: "your" }],
  ["for each", "for-each-unit-select", {}],
  ["Watcher unit from your army", "unit-filter", { side: "friendly", designated: "observer" }],
  ["is eligible to shoot", "eligible", { subject: "antecedent", to: "shoot" }],
  ["select one enemy unit", "select-unit", { scope: "enemy", distance: "any", visible: false }],
];
const VISIBLE: Item = ["is visible", "visible", { subject: "antecedent", to: "recipient", negated: false }];
const MARK: Item[] = [
  ["to be marked as their Quarry unit", "apply-mark", { subject: "selected-unit", tag: "spotted", by: "recipient" }],
  ["until the end of the phase", "duration", { endpoint: "end-of-phase" }],
];
const ATTACKS: Item[] = [
  ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
  ["model", "unit-filter", { side: "friendly", level: "model" }],
  ["from your army", "unit-owner", { owner: "friendly" }],
  ["makes an attack", "attack", { direction: "makes", unit: "friendly-unit", attack_type: "any" }],
  ["that targets a Quarry unit", "unit-mark", { mark: "spotted", subject: "target", negated: false }],
  ["improve the Ballistic Skill characteristic of that attack by 1", "characteristic-modifier", { subject: "attack", characteristics: ["BS"], operation: "improve", value: 1, weapon_type: "all" }],
];

describe("a selection, then a loop in a later sentence of the same moment", () => {
  it("compiles the selection as the record and the loop, with its own selection per pass, as a later part", () => {
    const result = run(TEXT, ...HEAD, ...LOOP, VISIBLE, ...MARK, ...ATTACKS);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const effect = result.mechanics.effect as Node;
    expect(result.mechanics.trigger).toMatchObject({ event: "phase-started", optional: true });
    expect(effect.type).toBe("sequence");
    const [watchers, part] = effect.steps as Node[];
    expect(watchers).toMatchObject({ type: "select-units", selector: { filter: { owner: "friendly" }, count: { min: 1 } }, effect: { type: "designate", modifier: { tag: "observer" } } });
    expect(part).toMatchObject({ type: "ability-part", duration: "phase" });
    // The loop wraps only its own sentence's selection; the attacks of the later sentence run once, after it.
    const [loop, attacks] = (part.effect.effect as Node).steps as Node[];
    expect(loop).toMatchObject({ type: "for-each-unit", selector: { filter: { designated: "observer" } }, effect: { type: "select-units", selector: { filter: { owner: "enemy" }, eligibility: { parameters: { filter: { visible: { to: "recipient" } } } } } } });
    expect(JSON.stringify(loop)).toContain('"tag":"spotted","by":"recipient"');
    expect(attacks).toMatchObject({ type: "conditional", effect: { type: "stat-modifier", modifier: { stat: "BS", value: 1 } } });
    // The attacks read the tag the selection applies, in the same spelling.
    expect(JSON.stringify(attacks)).toContain('"designated":"spotted"');
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/enrichment/ability-dsl/effect.schema.json");
    expect(validate?.(effect), JSON.stringify(validate?.errors)).toBe(true);
  });

  it("refuses a per-pass unit selection that never reads the pass's unit", () => {
    const result = run(TEXT, ...HEAD, ...LOOP, ...MARK, ...ATTACKS);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("the compiler binds only one of them");
  });
});
