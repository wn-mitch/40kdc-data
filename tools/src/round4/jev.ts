import {
  TypeSafeClient,
  choice,
  type EntryType,
  type JsonValue,
  type Questions,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import type { CandidateAbilityResult, RelationQuestion } from "./contracts.js";
import { hashJson } from "./hash.js";

const MODEL = "jev-latest";
const INPUT_PRICE_PER_MILLION_USD = 0.042;

export interface JevAnswer {
  question_id: string;
  selected: string;
  probabilities: Record<string, number>;
  confidence: number;
  type: "choice";
}

export interface JevRequestResult {
  request_hash: string;
  mode: "solo" | "batch";
  representative: boolean;
  question_ids: string[];
  model: string;
  answers: JevAnswer[];
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  cost_usd: number;
  cost_kind: "derived";
}

export interface RawJevResults {
  model_requested: typeof MODEL;
  input_price_per_million_usd: number;
  representative_identities: string[];
  stable_question_types: string[];
  unstable_question_types: string[];
  requests: JevRequestResult[];
}

function keyOf(result: CandidateAbilityResult): string {
  return `${result.faction_id}/${result.ability_id}`;
}

function representativeKeys(
  results: Array<CandidateAbilityResult & { primary_stratum?: string }>,
): string[] {
  const seenStrata = new Set<string>();
  const keys: string[] = [];
  for (const result of results) {
    const stratum = result.primary_stratum;
    if (!stratum || stratum === "trusted-anchor" || seenStrata.has(stratum)) continue;
    seenStrata.add(stratum);
    keys.push(keyOf(result));
  }
  if (seenStrata.size !== 8) throw new Error(`Expected eight representative strata, received ${seenStrata.size}`);
  const coveredTypes = new Set(
    results.filter((result) => keys.includes(keyOf(result))).flatMap((result) => result.questions.map((question) => question.type)),
  );
  const allTypes = [...new Set(results.flatMap((result) => result.questions.map((question) => question.type)))].sort();
  for (const type of allTypes) {
    if (coveredTypes.has(type)) continue;
    const supplement = results.find((result) => result.questions.some((question) => question.type === type));
    if (!supplement) throw new Error(`No representative question exists for ${type}`);
    const key = keyOf(supplement);
    if (!keys.includes(key)) keys.push(key);
    supplement.questions.forEach((question) => coveredTypes.add(question.type));
  }
  return keys;
}

function noOverlap(left: RelationQuestion, right: RelationQuestion): boolean {
  const spansOverlap = left.source_span.start < right.source_span.end && right.source_span.start < left.source_span.end;
  if (spansOverlap || left.type === right.type) return false;
  const leftAtoms = new Set(left.subject_atom_ids);
  return !right.subject_atom_ids.some((id) => leftAtoms.has(id));
}

function batches(
  questions: RelationQuestion[],
  eligible: (question: RelationQuestion) => boolean,
): RelationQuestion[][] {
  const pending = questions.filter(eligible);
  const result: RelationQuestion[][] = [];
  while (pending.length) {
    const batch = [pending.shift() as RelationQuestion];
    for (let index = 0; index < pending.length && batch.length < 4;) {
      const candidate = pending[index] as RelationQuestion;
      if (batch.every((item) => noOverlap(item, candidate))) {
        batch.push(candidate);
        pending.splice(index, 1);
      } else {
        index += 1;
      }
    }
    result.push(batch);
  }
  return result;
}
function comparisonBatches(questions: RelationQuestion[]): RelationQuestion[][] {
  return questions.map((target) => {
    const group = [target];
    for (const candidate of questions) {
      if (candidate.id === target.id || group.length >= 4) continue;
      if (group.every((item) => noOverlap(item, candidate))) group.push(candidate);
    }
    if (group.length < 2) throw new Error(`Cannot form a non-overlapping comparison batch for ${target.id}`);
    return group;
  });
}

function questionState(question: RelationQuestion): Record<string, JsonValue> {
  return {
    identity: {
      faction_id: question.identity.faction_id,
      ability_id: question.identity.ability_id,
    },
    source_context: question.source_context,
    marked_span: {
      start: question.source_span.start,
      end: question.source_span.end,
    },
    relation_type: question.type,
    subject_atom_ids: question.subject_atom_ids,
    instruction: "Judge only the marked local semantic distinction. Do not interpret or generate the whole ability.",
  };
}

function buildRequest(group: RelationQuestion[]): {
  state: EntryType;
  questions: Questions;
  model: string;
} {
  const states: Record<string, JsonValue> = {};
  const questions: Questions = {};
  for (const question of group) {
    states[question.id] = questionState(question);
    const criteria = Object.fromEntries(question.options.map((option) => [option.id, {
      label: option.label,
      description: option.description,
      kind: option.kind,
    }]));
    questions[question.id] = choice(question.prompt, criteria);
  }
  return { state: states, questions, model: MODEL };
}

async function ask(
  client: TypeSafeClient,
  group: RelationQuestion[],
  mode: JevRequestResult["mode"],
  representative: boolean,
): Promise<JevRequestResult> {
  const request = buildRequest(group);
  const request_hash = hashJson({ version: 1, request });
  const started = performance.now();
  const result: SystemOneResult<Questions> = await client.systemOne(request, {
    timeout: 120_000,
    retry: { maxRetries: 0 },
  });
  const answers: JevAnswer[] = group.map((question) => {
    const answer = result.answers[question.id];
    if (!answer || answer.type !== "choice") throw new Error(`Missing choice answer for ${question.id}`);
    return {
      question_id: question.id,
      selected: answer.choice,
      probabilities: { ...answer.probabilities },
      confidence: answer.confidence,
      type: "choice",
    };
  });
  return {
    request_hash,
    mode,
    representative,
    question_ids: group.map((question) => question.id),
    model: result.model,
    answers,
    usage: result.usage,
    latency_ms: Math.round(performance.now() - started),
    cost_usd: (result.usage.input_tokens / 1_000_000) * INPUT_PRICE_PER_MILLION_USD,
    cost_kind: "derived",
  };
}

function stability(
  representativeQuestions: RelationQuestion[],
  solo: JevRequestResult[],
  batch: JevRequestResult[],
): { stable: string[]; unstable: string[] } {
  const soloAnswers = new Map(solo.flatMap((request) => request.answers.map((answer) => [answer.question_id, answer] as const)));
  const batchAnswers = new Map(batch.flatMap((request) => {
    const targetId = request.question_ids[0];
    const answer = request.answers.find((item) => item.question_id === targetId);
    return targetId && answer ? [[targetId, answer] as const] : [];
  }));
  const observations = new Map<string, boolean[]>();
  for (const question of representativeQuestions) {
    const alone = soloAnswers.get(question.id);
    const grouped = batchAnswers.get(question.id);
    if (!alone || !grouped) continue;
    const delta = Math.abs((alone.probabilities[alone.selected] ?? 0) - (grouped.probabilities[alone.selected] ?? 0));
    const okay = alone.selected === grouped.selected && delta < 0.05;
    const rows = observations.get(question.type);
    if (rows) rows.push(okay);
    else observations.set(question.type, [okay]);
  }
  const stable = [...observations].filter(([, rows]) => rows.length > 0 && rows.every(Boolean)).map(([type]) => type).sort();
  const unstable = [...observations].filter(([, rows]) => !rows.every(Boolean)).map(([type]) => type).sort();
  return { stable, unstable };
}

export async function runJev(results: Array<CandidateAbilityResult & { primary_stratum?: string }>): Promise<RawJevResults> {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is required for the Jev arm");
  const client = new TypeSafeClient({ logLevel: "off", retry: { maxRetries: 0 }, timeout: 120_000 });
  const representative_identities = representativeKeys(results);
  if (representative_identities.length < 8) throw new Error(`Representative subset is incomplete: ${representative_identities.length}`);
  const representativeSet = new Set(representative_identities);
  const representativeQuestions = results.filter((result) => representativeSet.has(keyOf(result))).flatMap((result) => result.questions);
  const soloRequests: JevRequestResult[] = [];
  for (const question of representativeQuestions) soloRequests.push(await ask(client, [question], "solo", true));
  const batchRequests: JevRequestResult[] = [];
  for (const group of comparisonBatches(representativeQuestions)) {
    batchRequests.push(await ask(client, group, "batch", true));
  }
  const { stable, unstable } = stability(representativeQuestions, soloRequests, batchRequests);
  const stableSet = new Set(stable);
  const remaining = results
    .filter((result) => !representativeSet.has(keyOf(result)))
    .flatMap((result) => result.questions);
  const remainingRequests: JevRequestResult[] = [];
  for (const group of batches(remaining, (question) => stableSet.has(question.type))) {
    remainingRequests.push(await ask(client, group, group.length > 1 ? "batch" : "solo", false));
  }
  for (const question of remaining.filter((item) => !stableSet.has(item.type))) {
    remainingRequests.push(await ask(client, [question], "solo", false));
  }
  return {
    model_requested: MODEL,
    input_price_per_million_usd: INPUT_PRICE_PER_MILLION_USD,
    representative_identities,
    stable_question_types: stable,
    unstable_question_types: unstable,
    requests: [...soloRequests, ...batchRequests, ...remainingRequests],
  };
}
