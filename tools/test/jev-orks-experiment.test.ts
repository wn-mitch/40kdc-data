import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  DEFAULT_CORPUS,
  INITIAL_COHORT,
  JEV_REFINEMENT_LEDGER,
  RANDOM_COHORT_2,
} from "../src/jev-orks-experiment.js";
import {
  claimsFromResponse,
  constructCandidate,
  decompositionEvidence,
  confidentAnswers,
  estimatedCost,
  extractionQuestions,
  genericDecompositionQuestions,
  genericRefinementQuestions,
  leafSettled,
  orkSlice,
  orkSliceCount,
  orkSlicePool,
  SLICE_SIZE,
  readSlots,
  registeredFamilies,
  slotEvidence,
  slotOf,
  verificationPassed,
  type AbilityState,
  type CandidateClaim,
  type CohortAbilityId,
  type CachedResponse,
} from "../src/jev-orks-experiment.js";

const CURRENT = {
  ability_id: "fixture",
  name: "Fixture",
  authored_by: "40kdc-community",
  game_version: { edition: "11th", dataslate: "codex-orks" },
  version: "2025-q3",
  effect: { type: "ability-grant", target: "unit", modifier: { grant_type: "old" } },
  scope: { range: "self", duration: "battle" },
  unit_ids: [],
  ability_type: "unit",
  behavior: "passive",
  faction_id: "orks",
};

const STATE: AbilityState = {
  ability: { source_id: "waaagh-banner", name: "Waaagh! Banner", faction: "orks", kind: "unit" },
  hierarchy: { container_type: null, components: [] },
  entity_context: { unit_ids: ["fixture"], detachment_id: null },
  literal_candidates: { integers: [1], dice: [], distances_inches: [], named_keywords: [] },
  source_text: "This unit has plus one to charge rolls.",
};

function claim(
  abilityId: CohortAbilityId,
  questionId: string,
  value: string | number,
  probability = 0.99,
): CandidateClaim {
  return {
    id: questionId,
    ability_id: abilityId,
    question_id: questionId,
    predicate: `jev.${questionId}`,
    value,
    probability,
    selected: true,
    source_digest: "a".repeat(64),
    state: "proposed",
  };
}

function claims(abilityId: CohortAbilityId, values: Record<string, string | number>, probability = 0.99): CandidateClaim[] {
  return Object.entries(values).map(([questionId, value], index) => ({
    id: `claim-${index}`,
    ability_id: abilityId,
    question_id: questionId,
    predicate: `jev.${questionId}`,
    value,
    probability,
    selected: true,
    source_digest: "a".repeat(64),
    state: "proposed",
  }));
}


describe("JEV Ork experiment", () => {
  it("records a distinct second random cohort and validated refinement ledger", () => {
    expect(RANDOM_COHORT_2).toHaveLength(15);
    expect(new Set(RANDOM_COHORT_2).size).toBe(15);
    expect(RANDOM_COHORT_2.some((abilityId) => INITIAL_COHORT.includes(
      abilityId as (typeof INITIAL_COHORT)[number],
    ))).toBe(false);
    expect(JEV_REFINEMENT_LEDGER.length).toBeGreaterThan(0);
    expect(JEV_REFINEMENT_LEDGER.every((entry) => entry.replacements.length > 0)).toBe(true);
  });

  it("plans unseen decomposition from source features and broad answers only", () => {
    const questions = genericDecompositionQuestions(STATE, {
      primary_effect: "stat-modifier",
      has_trigger: 0,
      has_condition: 0,
      has_target_selection: 0,
    });
    const required = Object.keys(questions);
    expect(required).toEqual(expect.arrayContaining([
      "semantic_subject",
      "semantic_duration",
      "effect_stat",
      "effect_operation",
      "integer_1",
    ]));
    const complete = claims(
      "follow-me-ladz-war-horde",
      Object.fromEntries(required.map((questionId) => [questionId, 1])),
    );
    expect(decompositionEvidence("follow-me-ladz-war-horde", complete, required)).toMatchObject({
      status: "closed",
      required_leaves: required.length,
      unresolved: [],
    });
    complete.pop();
    expect(decompositionEvidence("follow-me-ladz-war-horde", complete, required)).toMatchObject({
      status: "open",
      unresolved: [required.at(-1)],
    });
  });

  it("refines a forced choice into one proposition per option", () => {
    const initial = genericDecompositionQuestions(STATE, {
      primary_effect: "stat-modifier",
      has_trigger: 0,
      has_condition: 0,
      has_target_selection: 0,
    });
    const refinement = genericRefinementQuestions(initial, ["semantic_subject"], 1);
    const ids = Object.keys(refinement);
    expect(ids).toContain("refine_1__semantic_subject__this_model");
    expect(ids).toContain("refine_1__semantic_subject__selected_unit");
    expect(ids.some((id) => id.endsWith("_other"))).toBe(false);
    expect(ids.every((id) => (refinement[id] as { type: string }).type === "noul")).toBe(true);
    expect(ids).toHaveLength(Object.keys(
      (initial.semantic_subject as unknown as { criteria: Record<string, unknown> }).criteria,
    ).length - 1);
    expect(JSON.stringify(refinement)).not.toContain("waaagh");
  });

  it("treats absent and mid-band leaves as unsettled but confident negatives as answers", () => {
    expect(leafSettled(0.91)).toBe(true);
    expect(leafSettled(0.09)).toBe(true);
    expect(leafSettled(0.5)).toBe(false);
    expect(leafSettled(0.79)).toBe(false);

    const required = Object.keys(genericDecompositionQuestions(STATE, {
      primary_effect: "stat-modifier",
      has_trigger: 0,
      has_condition: 0,
      has_target_selection: 0,
    }));
    const answered = claims(
      "follow-me-ladz-war-horde",
      Object.fromEntries(required.map((questionId) => [questionId, 1])),
    );
    answered[0].probability = 0.05;
    expect(decompositionEvidence("follow-me-ladz-war-horde", answered, required)).toMatchObject({
      status: "closed",
      unresolved: [],
    });
    answered[0].probability = 0.5;
    expect(decompositionEvidence("follow-me-ladz-war-horde", answered, required)).toMatchObject({
      status: "open",
      unresolved: [required[0]],
    });
    answered.pop();
    expect(decompositionEvidence("follow-me-ladz-war-horde", answered, required)).toMatchObject({
      status: "open",
      unresolved: [required[0], required.at(-1)],
    });
  });

  it("closes a slot once its propositions determine it, ignoring inert siblings", () => {
    const required = [
      "semantic_duration",
      "refine_1__semantic_duration__phase",
      "refine_1__semantic_duration__turn",
    ];
    expect(required.map(slotOf)).toEqual([
      "semantic_duration",
      "semantic_duration",
      "semantic_duration",
    ]);

    // One option settled true resolves the slot even while a sibling sits in
    // the ambiguous band: the sibling cannot change the record.
    const determined = claims("squig-mine", {
      semantic_duration: "phase",
      refine_1__semantic_duration__phase: 1,
      refine_1__semantic_duration__turn: 1,
    });
    determined[1].probability = 0.96;
    determined[2].probability = 0.55;
    expect(decompositionEvidence("squig-mine", determined, required)).toMatchObject({
      status: "closed",
      unresolved_slots: [],
    });

    // Every positive proposition confidently false resolves an absence-bearing
    // slot as absent, rather than leaving it open forever.
    const absent = claims("squig-mine", {
      semantic_duration: "phase",
      refine_1__semantic_duration__phase: 1,
      refine_1__semantic_duration__turn: 1,
    });
    for (const claim of absent) claim.probability = 0.04;
    expect(decompositionEvidence("squig-mine", absent, required)).toMatchObject({
      status: "closed",
      unresolved_slots: [],
    });
    expect(slotEvidence(absent, required)[0].status).toBe("absent");

    // A slot that demands a value reports an ontology obligation instead.
    const subjectRequired = ["semantic_subject", "refine_1__semantic_subject__attack"];
    const unmet = claims("squig-mine", { semantic_subject: "other", refine_1__semantic_subject__attack: 1 });
    for (const claim of unmet) claim.probability = 0.04;
    expect(decompositionEvidence("squig-mine", unmet, subjectRequired)).toMatchObject({
      status: "open",
      unresolved_slots: ["semantic_subject"],
    });
  });

  it("derives controller choice from clause structure instead of asking it", () => {
    const alternatives = claims("squig-mine", {
      semantic_structure: "alternatives",
      refine_1__semantic_structure__alternatives: 1,
    });
    alternatives[1].probability = 0.95;
    expect(decompositionEvidence("squig-mine", alternatives, ["semantic_structure", "refine_1__semantic_structure__alternatives"]))
      .toMatchObject({ status: "closed", derived: { controller_choice_present: true } });

    const bands = claims("boom-bomb", {
      semantic_structure: "dice-result-bands",
      refine_1__semantic_structure__dice_result_bands: 1,
    });
    bands[1].probability = 0.95;
    expect(decompositionEvidence("boom-bomb", bands, ["semantic_structure", "refine_1__semantic_structure__dice_result_bands"]))
      .toMatchObject({ derived: { controller_choice_present: false } });

    // The direct (unrefined) determination carries its value, not just its id.
    const direct = claims("boom-bomb", { semantic_structure: "dice-result-bands" });
    direct[0].probability = 0.93;
    expect(decompositionEvidence("boom-bomb", direct, ["semantic_structure"]))
      .toMatchObject({ derived: { controller_choice_present: false } });

    const unknown = claims("boom-bomb", { semantic_structure: "selection-then-effect" });
    unknown[0].probability = 0.93;
    expect(decompositionEvidence("boom-bomb", unknown, ["semantic_structure"]))
      .toMatchObject({ derived: { controller_choice_present: null } });
  });

  it.skipIf(!existsSync(DEFAULT_CORPUS))("cuts deterministic, disjoint, exhaustive slices from the Ork corpus", () => {
    const pool = orkSlicePool();
    const count = orkSliceCount();
    expect(pool).toEqual(orkSlicePool());
    expect(count).toBe(Math.ceil(pool.length / SLICE_SIZE));

    const slices = Array.from({ length: count }, (_, index) => orkSlice(index + 1));
    const seen = new Set<string>();
    for (const slice of slices) {
      for (const abilityId of slice) {
        expect(seen.has(abilityId)).toBe(false);
        seen.add(abilityId);
      }
    }
    expect([...seen].sort()).toEqual([...pool].sort());
    for (const slice of slices.slice(0, -1)) expect(slice).toHaveLength(SLICE_SIZE);
    expect(slices.at(-1)!.length).toBeLessThanOrEqual(SLICE_SIZE);

    for (const abilityId of pool) {
      expect(INITIAL_COHORT as readonly string[]).not.toContain(abilityId);
      expect(RANDOM_COHORT_2 as readonly string[]).not.toContain(abilityId);
    }
  });

  it("gates generation on confident broad answers only", () => {
    const response = {
      request_hash: "h",
      repeat: 0,
      model: "m",
      answers: {
        primary_effect: { type: "choice", choice: "stat-modifier", probabilities: { "stat-modifier": 0.9 } },
        has_trigger: { type: "noul", noul: 0.51 },
        has_condition: { type: "noul", noul: 0.95 },
        has_target_selection: { type: "noul", noul: 0.99 },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
      latency_ms: 1,
    } as unknown as CachedResponse;
    expect(Object.keys(confidentAnswers(response))).toEqual([
      "primary_effect",
      "has_condition",
      "has_target_selection",
    ]);
    const gated = genericDecompositionQuestions(STATE, confidentAnswers(response));
    expect("trigger_event" in gated).toBe(false);
    expect(gated).toHaveProperty("condition_relation");
    expect(gated).toHaveProperty("selection_owner");
  });
  it("prices observed input tokens using the published Jev rate", () => {
    expect(estimatedCost(1_000_000)).toBe(0.042);
    expect(estimatedCost(2_000_000)).toBe(0.084);
  });

  it("builds one batched question packet with generic and family-specific decisions", () => {
    const questions = extractionQuestions("waaagh-banner");
    expect(Object.keys(questions)).toEqual(expect.arrayContaining([
      "composition",
      "primary_effect",
      "likely_ontology_gap",
      "roll_kind",
      "operation",
      "value_is_one",
    ]));
  });

  it("turns complete Jev answers into source-bound proposed claims", () => {
    const response = {
      request_hash: "request",
      repeat: 0,
      model: "jev-latest",
      answers: {
        composition: {
          type: "choice",
          choice: "leaf",
          confidence: 0.9,
          probabilities: { leaf: 0.95, other: 0.05 },
        },
        value_is_one: { type: "noul", noul: 0.98 },
        has_usage_limit: { type: "noul", noul: 0.12 },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
      latency_ms: 1,
    };
    const result = claimsFromResponse("waaagh-banner", STATE, response);
    expect(result.map((claim) => [claim.question_id, claim.value, claim.probability])).toEqual([
      ["composition", "leaf", 0.95],
      ["value_is_one", 1, 0.98],
      ["has_usage_limit", 0, 0.88],
    ]);
    expect(new Set(result.map((claim) => claim.source_digest))).toHaveLength(1);
  });

  it("constructs a charge modifier only when every required semantic decision agrees", () => {
    const complete = claims("waaagh-banner", {
      composition: "leaf",
      primary_effect: "roll-modifier",
      roll_kind: "charge",
      operation: "add",
      value_is_one: 1,
      affects_unit: 1,
    });
    const result = constructCandidate("waaagh-banner", CURRENT, complete);
    expect(result.status).toBe("constructed");
    expect(result.candidate?.effect).toEqual({
      type: "roll-modifier",
      target: "unit",
      modifier: { roll: "charge", operation: "add", value: 1 },
    });
    expect(result.consumed_claim_ids).toHaveLength(complete.length);
  });

  it("fails closed when a required semantic decision disagrees", () => {
    const incomplete = claims("waaagh-banner", {
      composition: "leaf",
      primary_effect: "roll-modifier",
      roll_kind: "hit",
      operation: "add",
      value_is_one: 1,
      affects_unit: 1,
    });
    const result = constructCandidate("waaagh-banner", CURRENT, incomplete);
    expect(result.status).toBe("incomplete");
    expect(result.candidate).toBeUndefined();
    expect(result.findings).toEqual(["roll_kind: expected charge, received hit"]);
  });

  it("constructs a fully scoped targeted mortal-wound ability from supported claims", () => {
    const complete = claims("bomb-squig", {
      activates_after_normal_move: 1,
      selects_one_visible_enemy_within_twelve: 1,
      succeeds_on_three_plus: 1,
      deals_d3_mortal_wounds: 1,
      consumes_bomb_squig_token: 1,
    });
    const result = constructCandidate("bomb-squig", CURRENT, complete);
    expect(result.status).toBe("constructed");
    expect(result.candidate).toMatchObject({
      effect: {
        type: "conditional",
        effect: {
          type: "sequence",
          steps: [
            {
              type: "select-units",
              selector: {
                owner: "enemy",
                count: 1,
                range_inches: 12,
                visibility_required: true,
              },
              effect: {
                type: "dice-gated",
                threshold: 3,
                on_success: {
                  type: "mortal-wounds",
                  modifier: { count: "D3" },
                },
              },
            },
            {
              type: "resource-spend",
              modifier: { resource: "bomb-squig-token", amount: 1 },
            },
          ],
        },
      },
    });
  });

  it("accepts only a confident aggregate with no confident defect or denial", () => {
    const response: CachedResponse = {
      request_hash: "verification",
      repeat: 0,
      model: "jev-latest",
      answers: {
        candidate_supported: { type: "noul", noul: 0.92 },
        missing_effect: { type: "noul", noul: 0.1 },
        missing_condition: { type: "noul", noul: 0.2 },
        missing_timing_or_usage: { type: "noul", noul: 0.1 },
        introduced_mechanic: { type: "noul", noul: 0.1 },
        preserves_effects: { type: "noul", noul: 0.7 },
        preserves_recipients: { type: "noul", noul: 0.55 },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
      latency_ms: 1,
    };
    // An unconfident preservation proposition is "don't know", not a defect.
    expect(verificationPassed(response)).toBe(true);
    response.answers.preserves_recipients = { type: "noul", noul: 0.12 };
    expect(verificationPassed(response)).toBe(false);
    response.answers.preserves_recipients = { type: "noul", noul: 0.55 };
    response.answers.missing_condition = { type: "noul", noul: 0.85 };
    expect(verificationPassed(response)).toBe(false);
    response.answers.missing_condition = { type: "noul", noul: 0.2 };
    response.answers.candidate_supported = { type: "noul", noul: 0.64 };
    expect(verificationPassed(response)).toBe(false);
  });

  it("classifies unregistered families without emitting a candidate", () => {
    const result = constructCandidate("wild-ride", CURRENT, claims("wild-ride", {
      composition: "dice-count-choice",
      primary_effect: "stat-modifier",
      likely_ontology_gap: 1,
    }));
    expect(result).toMatchObject({
      status: "incomplete",
      findings: ["unsupported family: composition=dice-count-choice; primary_effect=stat-modifier; ontology_gap=1"],
    });
    expect(result.candidate).toBeUndefined();
  });

  it("matches a registered family by its composition and primary effect pair", () => {
    expect(registeredFamilies()).toEqual([
      "conditional/keyword-grant",
      "conditional/mortal-wounds",
      "conditional/roll-modifier",
      "conditional/stat-modifier",
      "leaf/keyword-grant",
      "leaf/mortal-wounds",
      "leaf/roll-modifier",
      "leaf/stat-modifier",
      "selection/keyword-grant",
      "selection/mortal-wounds",
      "selection/roll-modifier",
      "selection/stat-modifier",
    ]);
  });

  it("constructs a registered family from its settled slots", () => {
    const result = constructCandidate("wild-ride", CURRENT, claims("wild-ride", {
      composition: "conditional",
      primary_effect: "stat-modifier",
      effect_stat: "A",
      effect_operation: "add",
      recipient: "this-unit",
      integer_2: "modifier-value",
      semantic_timing: "phase-start",
    }), { ...STATE, literal_candidates: { ...STATE.literal_candidates, integers: [1, 2] } });
    expect(result.status).toBe("constructed");
    expect(result.candidate?.effect).toEqual({
      type: "conditional",
      // The phase-start timing slot is the only condition source the source names.
      condition: { type: "timing-is", parameters: { timing: "start-of-phase" } },
      effect: { type: "stat-modifier", target: "unit", modifier: { stat: "A", operation: "add", value: 2 } },
    });
  });

  it("refuses to flatten a rule the classifier calls multi-effect", () => {
    const result = constructCandidate("wild-ride", CURRENT, claims("wild-ride", {
      composition: "conditional",
      primary_effect: "stat-modifier",
      effect_stat: "A",
      effect_operation: "add",
      recipient: "this-unit",
      integer_2: "modifier-value",
      has_multiple_effects: 1,
    }), { ...STATE, literal_candidates: { ...STATE.literal_candidates, integers: [1, 2] } });
    expect(result.status).toBe("incomplete");
    expect(result.candidate).toBeUndefined();
    expect(result.findings).toContain(
      "has_multiple_effects: the source states several effects and this family composes one",
    );
  });

  it("gates mortal wounds behind the die the source tests on", () => {
    const result = constructCandidate("wild-ride", CURRENT, claims("wild-ride", {
      composition: "conditional",
      primary_effect: "mortal-wounds",
      mortal_wound_resolution: "dice",
      recipient: "attacking-enemy",
      dice_d6: "test-roll",
      integer_3: "threshold",
      dice_d3: "effect-amount",
      semantic_timing: "phase-end",
    }), {
      ...STATE,
      literal_candidates: { integers: [3], dice: ["D6", "D3"], distances_inches: [], named_keywords: [] },
    });
    expect(result.status).toBe("constructed");
    expect(result.candidate?.effect).toMatchObject({
      effect: {
        type: "dice-gated",
        dice: "D6",
        threshold: 3,
        on_success: { type: "mortal-wounds", target: "target", modifier: { count: "D3" } },
      },
    });
  });

  it("reads a leading option when no proposition settles, and reports its support", () => {
    const reading = readSlots([
      ...claims("wild-ride", { recipient: "this-unit" }, 0.31),
      claim("wild-ride", "refine_1__recipient__this_unit", 1, 0.62),
      claim("wild-ride", "refine_1__recipient__selected_unit", 0, 0.88),
    ]).get("recipient");
    expect(reading?.options).toEqual(["this-unit"]);
    expect(reading?.evidence).toBe("selected");
    expect(reading?.probability).toBe(0.62);
  });

  it("leaves a slot undetermined when even its leading option is below a coin flip", () => {
    const reading = readSlots([
      ...claims("wild-ride", { recipient: "this-unit" }, 0.31),
      claim("wild-ride", "refine_1__recipient__this_unit", 1, 0.31),
    ]).get("recipient");
    expect(reading?.options).toEqual([]);
    expect(reading?.evidence).toBe("undetermined");
  });

  it("treats an unsettled proposition as an answer rather than a blocker", () => {
    const result = constructCandidate("wild-ride", CURRENT, claims("wild-ride", {
      composition: "conditional",
      primary_effect: "stat-modifier",
      effect_stat: "A",
      effect_operation: "add",
      recipient: "this-unit",
      integer_2: "modifier-value",
      semantic_timing: "phase-end",
      turn_is_your: 0,
    }), { ...STATE, literal_candidates: { ...STATE.literal_candidates, integers: [1, 2] } });
    expect(result.status).toBe("constructed");
    expect(result.findings ?? []).toEqual([]);
  });

  it("routes partial families into parameter-complete recursive question packets", () => {
    expect(Object.keys(extractionQuestions("waaagh"))).toEqual(expect.arrayContaining([
      "activation_once_per_battle",
      "activation_creates_named_state",
      "state_expiry_is_end_of_next_turn",
      "shoot_permission_requires_active_waaagh",
      "charge_permission_requires_active_waaagh",
    ]));
    expect(Object.keys(extractionQuestions("enhanced-runt-maw-madcap-meks"))).toEqual(expect.arrayContaining([
      "target_must_be_hit_by_those_attacks",
      "applies_named_infestation_state",
      "state_persists_on_selected_enemy",
      "selection_mandatory_when_target_exists",
    ]));
    expect(Object.keys(extractionQuestions("competitive-streak-kult-of-speed"))).toEqual(expect.arrayContaining([
      "eligibility_is_named_model",
      "effect_sentence_subject_is_this_unit",
      "effect_grants_charge_roll_reroll",
      "effect_has_no_stated_subset_or_usage_limit",
    ]));
    expect(Object.keys(extractionQuestions("wild-ride"))).toEqual(expect.arrayContaining([
      "controller_may_ignore_any_subset",
      "affects_move_characteristic",
      "affects_advance_rolls",
      "charge_rolls_explicitly_listed",
      "permission_held_by_this_unit",
    ]));
  });

  it("reports semantic closure only when every required leaf is confident", () => {
    const complete = claims("competitive-streak-kult-of-speed", {
      eligibility_is_named_model: 1,
      eligible_model_is_deffkilla_wartrike: 1,
      effect_sentence_subject_is_this_unit: 1,
      effect_grants_charge_roll_reroll: 1,
      effect_has_no_stated_subset_or_usage_limit: 1,
      effect_has_no_trigger_or_expiry: 1,
    });
    expect(decompositionEvidence("competitive-streak-kult-of-speed", complete)).toMatchObject({
      status: "closed",
      required_leaves: 6,
      unresolved: [],
    });
    complete[0].probability = 0.79;
    expect(decompositionEvidence("competitive-streak-kult-of-speed", complete)).toMatchObject({
      status: "open",
      unresolved: ["eligibility_is_named_model"],
    });
  });
});
