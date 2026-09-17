/**
 * JEV round trip: GW source text → authored DSL → describeAbility → prose.
 *
 * Two legs, each graded against its own upstream node, because the two legs
 * have different ground truth and a single fidelity score cannot say which one
 * broke:
 *
 *   leg 1  source text IS ground truth, the DSL record is the candidate.
 *          A failure here is an AUTHORING defect (or a bad source — see the
 *          provenance gate below).
 *
 *   leg 2  the DSL record IS ground truth, the rendered prose is the candidate.
 *          A failure here is a DESCRIBER defect: the record is right and the
 *          rendering misstates it.
 *
 * Localisation is then just the pair of verdicts:
 *
 *      leg1 fail              → authoring
 *      leg1 pass, leg2 fail   → describer
 *      both fail              → authoring (the record is already wrong, so the
 *                               prose is graded against a bad ground truth)
 *      both pass              → clean
 *
 * Why questions rather than embeddings: an embedding scores two prose samples'
 * similarity, which moves with paraphrase — measured at only −0.43 correlation
 * with actual fact errors, and it cannot attribute a fault to a leg. A
 * calibrated proposition can. It is also cheaper: two packets per ability,
 * against embedding every pair plus hand-built comparators.
 *
 * Independence caveat, stated because it bounds the result: for the shipped
 * corpus the DSL was authored by a different pipeline than JEV, so grading it
 * is a genuine external check. For the few candidates JEV itself constructed,
 * leg 1 is self-graded and agreement there is weaker evidence.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TypeSafeClient, choice, noul, type Questions } from "@typesafe-ai/sdk";
import { describeAbility } from "./translate/effect.js";
import {
  ask,
  buildCohortStates,
  estimatedCost,
  type AnyRecord,
  type CachedResponse,
  type CostLedger,
  type JsonObject,
} from "./jev-orks-experiment.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const PRIVATE_ROOT = join(REPO, "_private", "jev-orks");
const ORK_ABILITIES = join(REPO, "data", "enrichment", "orks", "abilities.json");
const DEFAULT_BUDGET_USD = 5;

/**
 * How the record differs from the source. Asked only when leg 1 fails, so the
 * report can name the mechanism instead of just flagging the rule.
 */
const AUTHORING_DEFECT_KINDS = {
  "omitted-effect": null,
  "omitted-condition": null,
  "omitted-quantity": null,
  "flattened-randomness": null,
  "wrong-recipient": null,
  "invented-effect": null,
  "no-material-difference": null,
} as const;

const DESCRIBER_DEFECT_KINDS = {
  placeholder: null,
  "wrong-recipient": null,
  "weapon-context-misuse": null,
  "omitted-effect": null,
  "omitted-quantity": null,
  "invented-effect": null,
  "no-material-difference": null,
} as const;

/**
 * Literal propositions, not interpretive ones. Round 2 of the extraction
 * experiment showed interpretive questions sit in the ambiguous band while
 * source-literal propositions settle, so every question here names a concrete
 * thing to look for and admits a confident "no".
 */
export function legOneQuestions(): Questions {
  return {
    every_effect_represented: noul(
      "Does the record represent every operative effect the source states?",
    ),
    every_condition_represented: noul(
      "Does the record represent every condition, restriction, and eligibility gate the source states?",
    ),
    every_quantity_preserved: noul(
      "Does the record preserve every numeric quantity and die expression the source states "
      + "(distances, counts, thresholds, D3, D6, D3+3)?",
    ),
    randomness_preserved: noul(
      "Does the record preserve the source's die rolls and result bands as conditional or "
      + "table structure, rather than collapsing them into unconditional effects?",
    ),
    recipient_preserved: noul(
      "Does the record apply each effect to the same recipient the source names — bearer, "
      + "bearer's unit, a selected unit, or the enemy being attacked?",
    ),
    adds_nothing: noul(
      "Does the record avoid asserting effects, conditions, quantities, or recipients the source does not state?",
    ),
    primary_defect: choice("If the record differs from the source, what is the primary difference?", {
      ...AUTHORING_DEFECT_KINDS,
    }),
  };
}

export function legTwoQuestions(): Questions {
  return {
    prose_states_every_effect: noul(
      "Does the prose state every effect the record contains?",
    ),
    prose_states_every_quantity: noul(
      "Does the prose state every numeric quantity and die expression the record contains?",
    ),
    prose_recipient_matches: noul(
      "Does the prose apply each effect to the same recipient the record specifies?",
    ),
    prose_respects_scope_kind: noul(
      "Does the prose avoid describing a unit-level or model-level rule as if it modified "
      + "weapons or attacks?",
    ),
    prose_is_substantive: noul(
      "Does the prose express the record's actual effects, rather than emitting a generic "
      + "placeholder such as 'modify the unit's characteristics'?",
    ),
    prose_adds_nothing: noul(
      "Does the prose avoid asserting effects, conditions, or quantities the record does not contain?",
    ),
    primary_defect: choice("If the prose differs from the record, what is the primary difference?", {
      ...DESCRIBER_DEFECT_KINDS,
    }),
  };
}

export type LegEvidence = {
  passed: boolean;
  answers: Record<string, unknown>;
  failed_propositions: string[];
  primary_defect: string | null;
};

/** A leg passes only when every proposition is confident and true. */
export function evaluateLeg(response: CachedResponse, threshold = 0.8): LegEvidence {
  const answers = response.answers as Record<string, unknown>;
  const failed: string[] = [];
  for (const [questionId, raw] of Object.entries(answers)) {
    const answer = raw as AnyRecord;
    if (answer?.type !== "noul") continue;
    const probability = Number(answer.noul);
    // `noul` is the probability of TRUE. A confident false is a failure.
    if (!(probability >= threshold)) failed.push(questionId);
  }
  const defectAnswer = (answers.primary_defect ?? {}) as AnyRecord;
  const primaryDefect = typeof defectAnswer.choice === "string" ? defectAnswer.choice : null;
  return {
    passed: failed.length === 0,
    answers,
    failed_propositions: failed,
    primary_defect: primaryDefect,
  };
}

export type Verdict = "clean" | "authoring" | "describer" | "both-wrong";

export type JevRoundTripRow = {
  ability_id: string;
  name: string;
  verdict: Verdict;
  leg1: LegEvidence;
  leg2: LegEvidence;
  source_text: string;
  rendered_text: string;
};

function faulted(leg: LegEvidence): boolean {
  const named = leg.primary_defect !== null && leg.primary_defect !== "no-material-difference";
  return !leg.passed || named;
}

export function localise(leg1: LegEvidence, leg2: LegEvidence): Verdict {
  const one = faulted(leg1);
  const two = faulted(leg2);
  if (!one && !two) return "clean";
  if (one && two) return "both-wrong";
  return one ? "authoring" : "describer";
}

export async function jevRoundTrip(options: {
  abilityIds?: readonly string[];
  live?: boolean;
  budgetUsd?: number;
  threshold?: number;
} = {}): Promise<{
  rows: JevRoundTripRow[];
  summary: AnyRecord;
  ledger: CostLedger;
}> {
  const abilities = JSON.parse(readFileSync(ORK_ABILITIES, "utf8")) as AnyRecord[];
  const corpus = JSON.parse(
    readFileSync(join(PRIVATE_ROOT, "source-corpus.json"), "utf8"),
  ) as { orks?: Record<string, string> };
  const withSource = new Set(Object.keys(corpus.orks ?? {}));
  const wanted = options.abilityIds;
  const targetIds = abilities
    .map((ability) => String(ability.ability_id))
    .filter((id) => withSource.has(id))
    .filter((id) => !wanted || wanted.includes(id));

  const states = buildCohortStates({ abilityIds: targetIds });
  const byId = new Map(abilities.map((ability) => [String(ability.ability_id), ability]));

  const ledger: CostLedger = {
    budget_usd: options.budgetUsd ?? DEFAULT_BUDGET_USD,
    input_tokens: 0,
    output_tokens: 0,
    observed_cost_usd: 0,
  };
  const client = options.live
    ? new TypeSafeClient({ logLevel: "off", retry: { maxRetries: 0 }, timeout: 120_000 })
    : null;

  const rows: JevRoundTripRow[] = [];
  for (const abilityId of targetIds) {
    const state = states[abilityId];
    const record = byId.get(abilityId);
    if (!state || !record) continue;
    const rendered = describeAbility(record as Parameters<typeof describeAbility>[0]);
    const mechanics = {
      effect: (record.effect ?? null) as JsonObject | null,
      scope: (record.scope ?? null) as JsonObject | null,
      trigger: (record.trigger ?? null) as JsonObject | null,
      applies_to: (record.applies_to ?? null) as JsonObject | null,
    };

    // leg 1 — source text is ground truth, the record is the candidate.
    const leg1Response = await ask(
      client,
      {
        source_text: state.source_text,
        candidate_record: mechanics as unknown as JsonObject,
        candidate_rendered_text: rendered,
      },
      legOneQuestions(),
      ledger,
      PRIVATE_ROOT,
      0,
      options.live ?? false,
    );
    // leg 2 — the record is ground truth, the prose is the candidate.
    const leg2Response = await ask(
      client,
      {
        ground_truth_record: mechanics as unknown as JsonObject,
        candidate_rendered_text: rendered,
      },
      legTwoQuestions(),
      ledger,
      PRIVATE_ROOT,
      0,
      options.live ?? false,
    );

    const threshold = options.threshold ?? 0.8;
    const leg1 = evaluateLeg(leg1Response, threshold);
    const leg2 = evaluateLeg(leg2Response, threshold);
    rows.push({
      ability_id: abilityId,
      name: String(record.name),
      verdict: localise(leg1, leg2),
      leg1,
      leg2,
      source_text: state.source_text,
      rendered_text: rendered,
    });
  }

  const byVerdict = (verdict: Verdict): JevRoundTripRow[] =>
    rows.filter((row) => row.verdict === verdict);
  const defectCounts = (pick: (row: JevRoundTripRow) => LegEvidence): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const defect = pick(row).primary_defect;
      if (defect && defect !== "no-material-difference") {
        counts[defect] = (counts[defect] ?? 0) + 1;
      }
    }
    return counts;
  };

  const summary = {
    abilities: rows.length,
    verdicts: {
      clean: byVerdict("clean").length,
      authoring: byVerdict("authoring").length,
      describer: byVerdict("describer").length,
      both_wrong: byVerdict("both-wrong").length,
    },
    authoring_defect_kinds: defectCounts((row) => row.leg1),
    describer_defect_kinds: defectCounts((row) => row.leg2),
    threshold: options.threshold ?? 0.8,
    cost_usd: estimatedCost(ledger.input_tokens),
  };

  mkdirSync(PRIVATE_ROOT, { recursive: true });
  writeFileSync(
    join(PRIVATE_ROOT, "jev-round-trip.json"),
    JSON.stringify({ summary, rows }, null, 2),
  );
  return { rows, summary, ledger };
}

const isMain = process.argv[1]?.endsWith("jev-round-trip.ts") ?? false;
if (isMain) {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const idsFile = value("--ids-file");
  const abilityIds = idsFile
    ? (JSON.parse(readFileSync(idsFile, "utf8")) as string[])
    : undefined;
  jevRoundTrip({
    abilityIds,
    live: argv.includes("--live"),
    budgetUsd: value("--budget") ? Number(value("--budget")) : undefined,
  })
    .then(({ rows, summary }) => {
      console.log(JSON.stringify(summary, null, 2));
      const limit = value("--limit") ? Number(value("--limit")) : 30;
      console.log(`\nworst rows:`);
      for (const row of rows.filter((candidate) => candidate.verdict !== "clean").slice(0, limit)) {
        console.log([
          row.ability_id.padEnd(44),
          row.verdict.padEnd(12),
          `leg1=${row.leg1.passed ? "pass" : "FAIL"}`,
          `leg2=${row.leg2.passed ? "pass" : "FAIL"}`,
          `defect=${row.leg1.primary_defect ?? row.leg2.primary_defect ?? "-"}`,
          row.leg1.failed_propositions.length ? `[${row.leg1.failed_propositions.join(",")}]` : "",
        ].join("  "));
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
