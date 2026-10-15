import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters, validateFingerprint } from "../src/round5c/contracts.js";
import { getAbilityCoverage } from "../src/round5c/coverage.js";
import { initializeWorkbench, insertSpan } from "../src/round5c/db.js";
import { hashJson } from "../src/round4/hash.js";

// Fabricated wording and parameters only; no GW rule prose in this file.

type DatabaseSync = DatabaseType;
const DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync as { new(path: string): DatabaseType };

type Part = [string, string, Record<string, unknown>];

/** Leaves on their own wording in `text`, in order, with their parameters normalized as the reviewed family normalizes them. */
function placed(text: string, parts: Part[]): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return parts.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the fixture text after byte ${from}.`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return {
      role: familyRole(family, version), family_id: family, family_version: version, start_byte: start, end_byte: from,
      parameters: normalizeFingerprintParameters(family, parameters, version), fragment: "RAW_TEXT",
    };
  });
}

function compile(text: string, parts: Part[]) {
  return compileLeaves(placed(text, parts), text, {});
}

function mechanicsOf(text: string, parts: Part[]): Record<string, any> {
  const result = compile(text, parts);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

function errorsOf(text: string, parts: Part[]): string {
  const result = compile(text, parts);
  return result.ok ? "" : result.errors.join(" | ");
}

const ATTACK_TARGETED: Part = ["When a bolt targets a squad", "event", { kind: "targets-selected", action_kind: "attack" }];
const VEIL_TO_TARGET: Part = ["the squad gains the veil", "rule-state", { subject: "target", direction: "granted", rule_kind: "core-rule", rule: "benefit-of-cover" }];
const PER_ATTACK: Part = ["against that bolt", "duration", { endpoint: "end-of-attack-sequence" }];
const SHOOTING_OPPONENT = { phase: "shooting", turn: "opponent" };

// SS5: a grant or stat change whose subject is the attack's target. The subject is a reviewed binding to the defender.
describe("Attack-target recipients on grant and stat families", () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["invulnerable-save", { subject: "target", threshold: 4 }, { subject: "this-unit", threshold: 4 }],
    ["keyword-grant", { subject: "target", keywords: ["FLY"] }, { subject: "this-unit", keywords: ["FLY"] }],
    ["characteristic-modifier", { subject: "target", characteristics: ["T"], operation: "subtract", value: 1 }, { subject: "this-unit", characteristics: ["T"], operation: "subtract", value: 1 }],
  ];

  it.each(cases)("%s accepts subject target at its current version and refuses it at the previous one", (family, targeted, own) => {
    const current = currentFamilyVersion(family);
    expect(normalizeFingerprintParameters(family, targeted, current).subject).toBe("target");
    expect(normalizeFingerprintParameters(family, own, current - 1).subject).toBe("this-unit");
    expect(() => normalizeFingerprintParameters(family, targeted, current - 1)).toThrow(/subject must be one of/);
  });

  it("names the defender in the DSL for each family", () => {
    const save = mechanicsOf("When a bolt targets a squad, the squad gains a 4+ ward save.", [
      ATTACK_TARGETED, ["the squad gains a 4+ ward save", "invulnerable-save", { subject: "target", threshold: 4 }],
    ]);
    expect(save.effect).toMatchObject({ type: "invulnerable-save", target: "defender", modifier: { invuln_sv: 4 } });
    const keywords = mechanicsOf("When a bolt targets a squad, the squad gains Fly.", [
      ATTACK_TARGETED, ["the squad gains Fly", "keyword-grant", { subject: "target", keywords: ["FLY"] }],
    ]);
    expect(keywords.effect).toMatchObject({ type: "keyword-grant", target: "defender", modifier: { keywords: ["FLY"] } });
    const stat = mechanicsOf("When a bolt targets a squad, the squad has -1 T.", [
      ATTACK_TARGETED, ["the squad has -1 T", "characteristic-modifier", { subject: "target", characteristics: ["T"], operation: "subtract", value: 1 }],
    ]);
    expect(stat.effect).toMatchObject({ type: "stat-modifier", target: "defender" });
  });

  // A Stratagem's antecedent unit must come from an earlier leaf; with none, the compiler refuses instead of binding the record's own unit.
  it("keeps the antecedent refusal when a Stratagem has no earlier leaf that selects a unit", () => {
    const text = "In your Shooting phase, the squad has a 4+ ward save.";
    expect(errorsOf(text, [
      ["In your Shooting phase", "use-window", { your_phases: ["shooting"], opponent_phases: [], either_phases: [] }],
      ["the squad has a 4+ ward save", "invulnerable-save", { subject: "antecedent", threshold: 4 }],
    ])).toMatch(/^invulnerable-save at byte \d+ points back to an earlier unit/);
  });
});

// SS2 and SS2b: a per-attack duration inside a phase window folds into the phase.
describe("Per-attack durations inside a phase window", () => {
  // Printed phase end plus a per-attack duration on the allocated model's grant.
  const ALLOCATED = "Until the end of the phase, each time a dart is allocated to a grunt model, that model gains the veil against that dart.";
  const allocatedParts = (extra: Part[] = []): Part[] => [
    ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
    ["each time a dart is allocated", "event", { kind: "damage-allocated" }],
    ["that model gains the veil", "core-ability-grant", { subject: "antecedent", ability: "benefit-of-cover" }],
    ["against that dart", "duration", { endpoint: "end-of-attack-sequence" }],
    ...extra,
  ];

  it("bounds the entry to the phase and ends each attack's grant at its attack sequence", () => {
    const mechanics = mechanicsOf(ALLOCATED, allocatedParts());
    expect(mechanics.scope).toEqual({ duration: "phase" });
    expect(mechanics.trigger).toBeNull();
    expect(mechanics.effect).toMatchObject({
      type: "ability-part", trigger: { event: "damage-allocated" }, duration: "attack-sequence",
      effect: { type: "ability-grant", target: "event-object", modifier: { ability: "benefit-of-cover" } },
    });
  });

  // The phase comes from the trigger window, which prints no duration (the Start of a phase window).
  it("takes the phase from the trigger window when no duration is printed", () => {
    const text = "Start of your opponent's Shooting phase, when a bolt targets a squad, the squad gains the veil against that bolt.";
    const mechanics = mechanicsOf(text, [
      ["Start of your opponent's Shooting phase", "phase-window", SHOOTING_OPPONENT],
      ["when a bolt targets a squad", "event", { kind: "targets-selected", action_kind: "attack" }],
      ["the squad gains the veil", "rule-state", { subject: "target", direction: "granted", rule_kind: "core-rule", rule: "benefit-of-cover" }],
      PER_ATTACK,
    ]);
    expect(mechanics.scope).toEqual({ duration: "phase" });
    expect(mechanics.effect.type).toBe("conditional");
    expect(mechanics.effect.effect).toMatchObject({ type: "ability-part", trigger: { event: "targets-selected" }, duration: "attack-sequence" });
  });

  it("refuses a per-attack duration beside a printed end of this unit's shooting", () => {
    expect(errorsOf(ALLOCATED.replace("against that dart.", "against that dart until this unit has shot."), [
      ...allocatedParts(),
      ["until this unit has shot", "duration", { endpoint: "this-unit-has-shot" }],
    ])).toBe("Conflicting durations.");
  });

  // A turn-long window cannot bound the fold, so the combination is refused rather than given a turn scope.
  it("refuses a per-attack duration inside a turn-long window", () => {
    const text = "In your turn, when a bolt targets a squad, the squad gains the veil against that bolt.";
    expect(errorsOf(text, [
      ["In your turn", "phase-window", { turn: "your" }],
      ["when a bolt targets a squad", "event", { kind: "targets-selected", action_kind: "attack" }],
      VEIL_TO_TARGET,
      PER_ATTACK,
    ]))
      .toBe("Conflicting durations.");
  });

  // A phase window with no attack moment leaves nothing to end the per-attack grant, so it is refused.
  it("refuses a per-attack duration in a phase window with no attack moment", () => {
    const text = "Start of your opponent's Shooting phase, the squad gains the veil against that bolt.";
    expect(errorsOf(text, [
      ["Start of your opponent's Shooting phase", "phase-window", SHOOTING_OPPONENT],
      VEIL_TO_TARGET,
      PER_ATTACK,
    ])).toBe("Conflicting durations.");
  });

  // Regression guard: a use window is not a fold source, so its entry keeps the attack sequence as its scope.
  it("keeps a per-attack duration under a use window as the attack sequence", () => {
    const text = "In your opponent's Shooting phase, when a bolt targets a squad, the squad gains the veil against that bolt.";
    const mechanics = mechanicsOf(text, [
      ["In your opponent's Shooting phase", "use-window", { your_phases: [], opponent_phases: ["shooting"], either_phases: [] }],
      ["when a bolt targets a squad", "event", { kind: "targets-selected", action_kind: "attack" }],
      VEIL_TO_TARGET,
      PER_ATTACK,
    ]);
    expect(mechanics.scope).toEqual({ duration: "attack-sequence" });
    expect(mechanics.effect.type).toBe("rule-state");
  });

  it("keeps a printed phase duration alone as the phase", () => {
    const text = "Until the end of the phase, your unit gains the veil.";
    const mechanics = mechanicsOf(text, [
      ["Until the end of the phase", "duration", { endpoint: "end-of-phase" }],
      ["your unit gains the veil", "rule-state", { subject: "this-unit", direction: "granted", rule_kind: "core-rule", rule: "benefit-of-cover" }],
    ]);
    expect(mechanics.scope).toEqual({ duration: "phase" });
    expect(mechanics.effect.type).toBe("rule-state");
  });

  it("keeps a per-attack duration alone as the attack sequence", () => {
    const mechanics = mechanicsOf("When a bolt targets a squad, the squad gains the veil against that bolt.", [ATTACK_TARGETED, VEIL_TO_TARGET, PER_ATTACK]);
    expect(mechanics.scope).toEqual({ duration: "attack-sequence" });
    expect(mechanics.effect.type).toBe("rule-state");
  });
});

// SS1a and SS4: authoring fixtures with fabricated wording laid out like the reviewed records.
describe("Authoring fixtures for per-attack cover", () => {
  it("compiles per-attack cover to a hidden target with the attack-sequence duration", () => {
    const text = "When a bolt targets a squad that is not clearly seen by the caster because of this unit, the squad gains the veil against that bolt.";
    const mechanics = mechanicsOf(text, [
      ATTACK_TARGETED,
      ["that is not clearly seen by the caster because of this unit", "visible", { subject: "defender", to: "attacker", fully: true, blocked_by: "this-unit", negated: true }],
      VEIL_TO_TARGET,
      PER_ATTACK,
    ]);
    expect(mechanics.scope).toEqual({ duration: "attack-sequence" });
    expect(mechanics.trigger).toMatchObject({ event: "targets-selected" });
    expect(mechanics.effect).toMatchObject({ type: "conditional", condition: { operator: "not" }, effect: { type: "rule-state", target: "defender" } });
  });

  it("compiles the allocated model's veil and ward save to the attack-sequence duration", () => {
    const text = "Each time a dart is allocated to a CONSTRUCT model from your army, if that model is not clearly seen by every model in the caster unit because of this guardian model, that model gains the veil and a 5+ ward save against that dart.";
    const mechanics = mechanicsOf(text, [
      ["Each time a dart is allocated", "event", { kind: "damage-allocated" }],
      ["CONSTRUCT model", "unit-filter", { side: "friendly", keywords: ["CONSTRUCT"], level: "model" }],
      ["from your army", "unit-owner", { owner: "friendly" }],
      ["that model is not clearly seen by every model", "visible", { subject: "defender", to: "attacker", fully: true, blocked_by: "this-model", negated: true }],
      ["that model gains the veil", "core-ability-grant", { subject: "antecedent", ability: "benefit-of-cover" }],
      ["a 5+ ward save", "invulnerable-save", { subject: "antecedent", threshold: 5 }],
      ["against that dart", "duration", { endpoint: "end-of-attack-sequence" }],
    ]);
    expect(mechanics.scope).toEqual({ duration: "attack-sequence" });
    expect(mechanics.trigger).toMatchObject({ event: "damage-allocated", object: { level: "model", all_of: ["CONSTRUCT"] } });
    expect(JSON.stringify(mechanics.effect)).toMatch(/"type":"ability-grant","target":"event-object"/);
    expect(JSON.stringify(mechanics.effect)).toMatch(/"type":"invulnerable-save","target":"event-object"/);
  });

  // Without its duration leaf the grant's "against that bolt" run is uncovered, so the record is incomplete.
  it("leaves the record incomplete when the per-attack duration is not authored", () => {
    const db = new DatabaseSync(":memory:");
    try {
      initializeWorkbench(db);
      const text = "When a bolt targets a squad that is not clearly seen by the caster because of this unit, the squad gains the veil against that bolt.";
      const sourceHash = hashJson({ text });
      const abilityId = Number(db.prepare(`
        INSERT INTO abilities (faction_id, ability_id, source_hash, source_text, source_type, source_kind, name, metadata_json, fragments_json, current)
        VALUES ('fixture', 'grant-to-attack-target-fixture', ?, ?, 'unit', 'fixture', 'Fixture', '{}', ?, 1)
      `).run(sourceHash, text, JSON.stringify([{ fragment: "RAW_TEXT", start_byte: 0, end_byte: Buffer.byteLength(text, "utf8"), text }])).lastInsertRowid);
      db.prepare(`INSERT INTO annotation_batches (id, operation, reviewer, created_at) VALUES ('human-review', 'review', 'reviewer', '2026-01-01T00:00:00.000Z')`).run();
      const bytes = Buffer.from(text, "utf8");
      const place = (wording: string, family: string, parameters: Record<string, unknown>) => {
        const start = bytes.indexOf(Buffer.from(wording, "utf8"));
        const end = start + Buffer.byteLength(wording, "utf8");
        const span = insertSpan(db, abilityId, "RAW_TEXT", start, end, wording);
        const fingerprint = validateFingerprint(db, family, parameters, currentFamilyVersion(family), wording);
        db.prepare(`INSERT INTO annotations (span_id, fingerprint_id, status, origin, authority_kind, confirmed_by, batch_id, supersedes_id, created_at)
          VALUES (?, ?, 'active', 'manual', 'human', 'reviewer', 'human-review', NULL, '2026-01-01T00:00:00.000Z')`).run(span, fingerprint);
      };
      place("When a bolt targets a squad", "event", { kind: "targets-selected", action_kind: "attack" });
      place("that is not clearly seen by the caster because of this unit", "visible", { subject: "defender", to: "attacker", fully: true, blocked_by: "this-unit", negated: true });
      place("the squad gains the veil", "rule-state", { subject: "target", direction: "granted", rule_kind: "core-rule", rule: "benefit-of-cover" });

      const coverage = getAbilityCoverage(db, abilityId);
      expect(coverage.uncovered.map((interval) => interval.text)).toContain("against that bolt");
      expect(coverage.leaf_fraction).toBeLessThan(1);

      place("against that bolt", "duration", { endpoint: "end-of-attack-sequence" });
      const complete = getAbilityCoverage(db, abilityId);
      expect(complete.uncovered.map((interval) => interval.text)).not.toContain("against that bolt");
    } finally {
      db.close();
    }
  });
});
