import type { DatabaseSync } from "node:sqlite";

import { LEAF_ROLES, REVIEWED_FAMILY_REGISTRY, normalizeFingerprintParameters, type LeafRole, type SemanticFamilyDefinition } from "./contracts.js";
import { choices, freeText, numeric, prefillFromSource, type Property } from "./leaf-prefill.js";
import { getCurrentCoverage, type CoverageView } from "./coverage.js";
import { untiledRuns } from "./leaves.js";
import type { PilotAbility } from "./pilot-sample.js";
import {
  askChoice, askYesNo, buildTypeSafeClient, clip, enumCriteria, JevBudget, JEV_MODEL, NONE_OF_THESE,
  type JevClient, type JevRequestLog,
} from "./jev-core.js";

export { buildTypeSafeClient, type JevClient } from "./jev-core.js";

/**
 * Jev v1: for each span, (a) which leaf role, from the active roles plus "none of these";
 * (b) within that role, which family, again with "none of these"; (c) for the chosen family, one
 * closed-enum parameter per remaining un-prefilled property, as its own choice (or yes/no)
 * question. Free-text and array-of-enum properties are left to `prefillFromSource` or, failing
 * that, to human review — this pilot doesn't attempt a multi-select flow (no such question type
 * exists in the SDK) or open-ended text generation. See `jev-v2.ts` for the segmentation-narrowed
 * follow-up arm.
 */

export type JevProposerOptions = {
  /** Below this, an answer counts as unanswered rather than a leaf decision. */
  confidenceFloor?: number;
  /** Stop issuing new requests once cumulative cost reaches this many dollars. */
  spendCapUsd?: number;
  /** Per-request timeout, forwarded to `systemOne`. */
  timeoutMs?: number;
};

const DEFAULT_OPTIONS: Required<JevProposerOptions> = { confidenceFloor: 0.6, spendCapUsd: 2, timeoutMs: 60_000 };

export type JevSpanProposal = {
  ability_version_id: number;
  faction_id: string;
  ability_id: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  text: string;
  status: "proposed" | "partial" | "unanswered" | "skipped-budget";
  role: LeafRole | null;
  role_confidence: number | null;
  family_id: string | null;
  family_version: number | null;
  family_confidence: number | null;
  parameters: Record<string, unknown>;
  /** Property names the pipeline could not resolve (array-of-enum, low confidence, or no prefill). */
  unresolved_parameters: string[];
  requests: number;
};

export type JevProposerResult = {
  model: string;
  confidence_floor: number;
  spend_cap_usd: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_latency_ms: number;
  requests: number;
  budget_exhausted: boolean;
  proposals: JevSpanProposal[];
  log: JevRequestLog[];
};

export type Span = { ability_version_id: number; faction_id: string; ability_id: string; fragment: string; start_byte: number; end_byte: number; text: string };

/** Every untiled span for the abilities in a pilot sample. */
export function pilotSpans(db: DatabaseSync, sample: readonly PilotAbility[], view: CoverageView = {}): Span[] {
  const coverage = getCurrentCoverage(db, { ...view, abilityVersionIds: new Set(sample.map((ability) => ability.ability_version_id)) });
  const spans: Span[] = [];
  for (const ability of sample) {
    const view = coverage.get(ability.ability_version_id);
    if (!view) continue;
    for (const run of untiledRuns(view)) {
      spans.push({
        ability_version_id: ability.ability_version_id, faction_id: ability.faction_id, ability_id: ability.ability_id,
        fragment: run.fragment, start_byte: run.start_byte, end_byte: run.end_byte, text: run.text,
      });
    }
  }
  return spans;
}

function activeFamilies(): SemanticFamilyDefinition[] {
  return REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated);
}

async function proposeSpan(
  client: JevClient, span: Span, families: readonly SemanticFamilyDefinition[], budget: JevBudget, opts: Required<JevProposerOptions>,
): Promise<JevSpanProposal> {
  const spanKey = `${span.ability_id}:${span.start_byte}-${span.end_byte}`;
  const base: JevSpanProposal = {
    ability_version_id: span.ability_version_id, faction_id: span.faction_id, ability_id: span.ability_id,
    fragment: span.fragment, start_byte: span.start_byte, end_byte: span.end_byte, text: span.text,
    status: "unanswered", role: null, role_confidence: null, family_id: null, family_version: null, family_confidence: null,
    parameters: {}, unresolved_parameters: [], requests: 0,
  };
  if (budget.exhausted()) return { ...base, status: "skipped-budget" };

  const state = { source_text: span.text, instruction: "Judge only the marked local span of a Warhammer 40,000 ability's rules text." };
  const roleAnswer = await askChoice(client, opts.timeoutMs, budget, spanKey, "role", state,
    "Which kind of DSL leaf does this span express?", enumCriteria(LEAF_ROLES));
  base.requests += 1;
  // Record what was asked and answered regardless of confidence — useful for review — but only
  // treat it as a decision (and proceed to the next question) once it clears the floor.
  if (roleAnswer && roleAnswer.selected !== NONE_OF_THESE) {
    base.role = roleAnswer.selected as LeafRole;
    base.role_confidence = roleAnswer.confidence;
  }
  if (!roleAnswer || roleAnswer.selected === NONE_OF_THESE || roleAnswer.confidence < opts.confidenceFloor) return base;
  const role = roleAnswer.selected as LeafRole;
  if (budget.exhausted()) return { ...base, status: "skipped-budget" };

  const inRole = families.filter((family) => family.role === role);
  if (inRole.length === 0) return base;
  const familyAnswer = await askChoice(client, opts.timeoutMs, budget, spanKey, "family", state,
    `Which ${role.toLowerCase()} family does this span express?`,
    enumCriteria(inRole.map((family) => family.id), (id) => clip(inRole.find((family) => family.id === id)!.description)));
  base.requests += 1;
  if (familyAnswer && familyAnswer.selected !== NONE_OF_THESE) {
    const attempted = inRole.find((item) => item.id === familyAnswer.selected);
    if (attempted) { base.family_id = attempted.id; base.family_version = attempted.version; base.family_confidence = familyAnswer.confidence; }
  }
  if (!familyAnswer || familyAnswer.selected === NONE_OF_THESE || familyAnswer.confidence < opts.confidenceFloor) return base;
  const family = inRole.find((item) => item.id === familyAnswer.selected)!;

  const properties = (family.parameterSchema as { properties?: Record<string, Property> }).properties ?? {};
  const parameters: Record<string, unknown> = { ...prefillFromSource(family, span.text) };
  const unresolved: string[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (Object.hasOwn(parameters, name)) continue;
    if (budget.exhausted()) { unresolved.push(name); continue; }
    const options = choices(property);
    if (property.type === "boolean") {
      const answer = await askYesNo(client, opts.timeoutMs, budget, spanKey, state, `Does "${family.label}"'s "${name}" parameter hold for this span?`);
      base.requests += 1;
      if (answer && answer.confidence >= opts.confidenceFloor) parameters[name] = answer.value;
      else unresolved.push(name);
    } else if (options.length > 0) {
      const answer = await askChoice(client, opts.timeoutMs, budget, spanKey, "parameter", state,
        `What is "${family.label}"'s "${name}" parameter for this span?`, enumCriteria(options));
      base.requests += 1;
      if (answer && answer.selected !== NONE_OF_THESE && answer.confidence >= opts.confidenceFloor) parameters[name] = answer.selected;
      else unresolved.push(name);
    } else if (freeText(property) || numeric(property)) {
      // Free text and numeric parameters are prefill-or-review only — no question asked.
      unresolved.push(name);
    } else {
      // An array-of-enum (multi-select) or another shape this pilot doesn't attempt.
      unresolved.push(name);
    }
  }

  base.parameters = parameters;
  base.unresolved_parameters = unresolved;
  try {
    normalizeFingerprintParameters(family.id, parameters, family.version);
    // "proposed" needs every *required* parameter resolved — an unresolved optional one (a
    // `count` cap, say) still validates and shouldn't downgrade an otherwise-complete leaf.
    const required = new Set((family.parameterSchema as { required?: string[] }).required ?? []);
    base.status = unresolved.some((name) => required.has(name)) ? "partial" : "proposed";
  } catch {
    base.status = "partial";
  }
  return base;
}

/** Run the Jev proposer over every untiled span for a pilot sample, honoring the spend cap. */
export async function runJevProposer(client: JevClient, spans: readonly Span[], options: JevProposerOptions = {}): Promise<JevProposerResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const budget = new JevBudget(opts.spendCapUsd);
  const families = activeFamilies();
  const proposals: JevSpanProposal[] = [];
  let budgetExhausted = false;
  for (const span of spans) {
    if (budget.exhausted()) { budgetExhausted = true; proposals.push(await proposeSpan(client, span, families, budget, opts)); continue; }
    proposals.push(await proposeSpan(client, span, families, budget, opts));
  }
  return {
    model: JEV_MODEL, confidence_floor: opts.confidenceFloor, spend_cap_usd: opts.spendCapUsd,
    total_cost_usd: budget.totalCostUsd, total_input_tokens: budget.totalInputTokens, total_output_tokens: budget.totalOutputTokens,
    total_latency_ms: budget.totalLatencyMs, requests: budget.requests, budget_exhausted: budgetExhausted || budget.exhausted(),
    proposals, log: budget.log,
  };
}
