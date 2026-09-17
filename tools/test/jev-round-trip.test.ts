import { describe, expect, it } from "vitest";
import {
  evaluateLeg,
  legOneQuestions,
  legTwoQuestions,
  localise,
  type LegEvidence,
} from "../src/jev-round-trip.js";
import type { CachedResponse } from "../src/jev-orks-experiment.js";

function response(answers: Record<string, unknown>): CachedResponse {
  return {
    request_hash: "h",
    repeat: 0,
    model: "fixture",
    answers,
    usage: { input_tokens: 1, output_tokens: 1 },
    latency_ms: 1,
  };
}

function leg(answers: Record<string, unknown>, defect = "no-material-difference"): LegEvidence {
  return evaluateLeg(response({ ...answers, primary_defect: { type: "choice", choice: defect } }));
}

const ALL_TRUE = {
  every_effect_represented: { type: "noul", noul: 0.95 },
  every_condition_represented: { type: "noul", noul: 0.95 },
  every_quantity_preserved: { type: "noul", noul: 0.95 },
  randomness_preserved: { type: "noul", noul: 0.95 },
  recipient_preserved: { type: "noul", noul: 0.95 },
  adds_nothing: { type: "noul", noul: 0.95 },
};

describe("JEV round trip", () => {
  it("treats a confident false as a failed proposition, not a pass", () => {
    expect(leg(ALL_TRUE).passed).toBe(true);
    const confidentFalse = leg({ ...ALL_TRUE, randomness_preserved: { type: "noul", noul: 0.06 } });
    expect(confidentFalse.passed).toBe(false);
    expect(confidentFalse.refuted_propositions).toEqual(["randomness_preserved"]);
    expect(confidentFalse.unresolved_propositions).toEqual([]);
  });

  it("treats a mid-band answer as unresolved rather than as fidelity or as a fault", () => {
    // The extraction experiment's central lesson: an ambiguous answer is not
    // evidence of fidelity. Only a confident true counts.
    const ambiguous = leg({ ...ALL_TRUE, every_quantity_preserved: { type: "noul", noul: 0.62 } });
    expect(ambiguous.passed).toBe(false);
    expect(ambiguous.unresolved_propositions).toEqual(["every_quantity_preserved"]);
    expect(ambiguous.refuted_propositions).toEqual([]);
    // Unproven is not a fault: attributing it to the authoring leg is how every
    // adjudicated-clean record in the labelled set acquired a fault verdict.
    expect(localise(ambiguous, leg(ALL_TRUE))).toBe("unresolved");
  });

  it("localises a fault to the leg whose ground truth was violated", () => {
    const pass = leg(ALL_TRUE);
    const fail = leg({ ...ALL_TRUE, every_quantity_preserved: { type: "noul", noul: 0.05 } });
    expect(localise(pass, pass)).toBe("clean");
    expect(localise(fail, pass)).toBe("authoring");
    expect(localise(pass, fail)).toBe("describer");
    // Both legs refuted is still authoring: the record is wrong first, so the
    // prose's failure is not independent evidence.
    expect(localise(fail, fail)).toBe("authoring");
  });

  it("does not fault a leg whose propositions all pass and which merely names a defect", () => {
    // Five adjudicated-clean records in the labelled set name a defect with
    // nothing refuted, so the diagnosis alone cannot decide the verdict.
    const contradictory = leg(ALL_TRUE, "flattened-randomness");
    expect(contradictory.passed).toBe(true);
    expect(localise(contradictory, leg(ALL_TRUE))).toBe("clean");
    expect(contradictory.primary_defect).toBe("flattened-randomness");
  });

  it("asks atomic source-literal propositions rather than a holistic rubric", () => {
    // Leg questions name a concrete thing to look for and admit a confident
    // no. Pinning the shape keeps a future edit from reintroducing the
    // compound "everything is perfect" phrasing that flagged known-clean rows.
    for (const questions of [legOneQuestions(), legTwoQuestions()]) {
      const nouls = Object.values(questions).filter(
        (question) => (question as { type: string }).type === "noul",
      );
      expect(nouls.length).toBeGreaterThanOrEqual(5);
      expect(questions).toHaveProperty("primary_defect");
    }
  });
});
