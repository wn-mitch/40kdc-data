import { ROUND4_COHORT } from "../round4/cohort.js";
import {
  REGEX_STRATA,
  SEMANTIC_STRATA,
  type CohortSelection,
  type SemanticStratum,
  type SourceFragment,
} from "./contracts.js";
import { sha256Bytes } from "./hash.js";

export interface SourceRecord {
  faction?: string;
  /** Provenance: `ref` is the dump row, `dump.json#<rowId>`. */
  source?: { ref?: string };
  raw_text?: string;
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
}

export type SourceIndex = Record<string, Record<string, SourceRecord>>;

export interface AssembledSource {
  source_text: string;
  source_fragments: SourceFragment[];
  source_kind: "raw-text" | "structured-stratagem";
}

export interface SourceCandidate {
  faction_id: string;
  ability_id: string;
  record: SourceRecord;
  assembled: AssembledSource;
  source_hash: string;
}

export interface SelectedCandidate extends SourceCandidate {
  selection: CohortSelection;
}

export const STRATUM_SEEDS: Readonly<Record<(typeof REGEX_STRATA)[number], string>> = {
  "dice-random": "round4b/dice-random/v1",
  "attack-combat-modification": "round4b/attack-combat-modification/v1",
  "condition-history-anaphora": "round4b/condition-history-anaphora/v1",
  "menu-choice-resource": "round4b/menu-choice-resource/v1",
  "iteration-duration-spatial": "round4b/iteration-duration-spatial/v1",
};

export const RANDOM_CORPUS_SEED = "round4b/random-corpus-draw/v1";

const FIELDS = ["when", "target", "effect", "restrictions"] as const;
const LABELS: Record<(typeof FIELDS)[number], SourceFragment["label"]> = {
  when: "WHEN",
  target: "TARGET",
  effect: "EFFECT",
  restrictions: "RESTRICTIONS",
};

interface EligibilityRule {
  all?: readonly RegExp[];
  any?: readonly RegExp[];
}

export const STRATUM_ELIGIBILITY: Readonly<Record<(typeof REGEX_STRATA)[number], EligibilityRule>> = {
  "dice-random": {
    any: [/\bD(?:3|6|[1-9]\d?)\b/ui, /\bdice\b/ui, /\broll(?:s|ed|ing)?\b/ui, /\brandom(?:ly)?\b/ui],
  },
  "attack-combat-modification": {
    all: [
      /\b(?:attack|attacks|hit|wound|melee|ranged|weapon|shooting|fight|combat|damage|strength|ballistic skill|weapon skill|critical)\b/ui,
      /\b(?:add|subtract|improve|worsen|modify|re-?roll|increase|reduce|change)\b/ui,
    ],
  },
  "condition-history-anaphora": {
    all: [
      /\b(?:if|unless|while|when|provided that)\b/ui,
      /\b(?:previously|already|this battle|that unit|that model|those units|it|them|they)\b/ui,
    ],
  },
  "menu-choice-resource": {
    all: [
      /\b(?:select|choose|either|one of the following|instead)\b/ui,
      /\b(?:command point|CP|token|resource|Miracle dice|Fate dice|once per battle)\b/ui,
    ],
  },
  "iteration-duration-spatial": {
    all: [
      /\b(?:each|every|for each|for every)\b/ui,
      /\b(?:until|end of|start of|phase|turn|battle round)\b/ui,
      /\b(?:within|wholly within|engagement range|range of)\b/ui,
    ],
  },
};

export function assembleSource(record: SourceRecord): AssembledSource {
  if (typeof record.raw_text === "string" && record.raw_text.length > 0) {
    const end = Buffer.byteLength(record.raw_text, "utf8");
    return {
      source_text: record.raw_text,
      source_fragments: [{ label: "RAW_TEXT", start: 0, end }],
      source_kind: "raw-text",
    };
  }

  const present = FIELDS.filter((field) => typeof record[field] === "string" && record[field]!.length > 0);
  if (present.length === 0) throw new Error("Source record contains neither raw_text nor structured fields");

  const pieces: string[] = [];
  const source_fragments: SourceFragment[] = [];
  let byteCursor = 0;
  for (const field of present) {
    const prefix = `${LABELS[field]}: `;
    const value = record[field]!;
    if (pieces.length > 0) byteCursor += Buffer.byteLength("\n", "utf8");
    pieces.push(`${prefix}${value}`);
    const start = byteCursor + Buffer.byteLength(prefix, "utf8");
    const end = start + Buffer.byteLength(value, "utf8");
    source_fragments.push({ label: LABELS[field], start, end });
    byteCursor = end;
  }
  return { source_text: pieces.join("\n"), source_fragments, source_kind: "structured-stratagem" };
}

function identityKey(faction_id: string, ability_id: string): string {
  return `${faction_id}/${ability_id}`;
}

function orderingHash(seed: string, candidate: SourceCandidate): string {
  return sha256Bytes(`${seed}\0${candidate.faction_id}\0${candidate.ability_id}\0${candidate.source_hash}`);
}

function ordered(seed: string, candidates: readonly SourceCandidate[]): SourceCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftHash = orderingHash(seed, left);
    const rightHash = orderingHash(seed, right);
    if (leftHash < rightHash) return -1;
    if (leftHash > rightHash) return 1;
    const leftIdentity = identityKey(left.faction_id, left.ability_id);
    const rightIdentity = identityKey(right.faction_id, right.ability_id);
    if (leftIdentity < rightIdentity) return -1;
    if (leftIdentity > rightIdentity) return 1;
    return 0;
  });
}

function matches(rule: EligibilityRule, source: string): boolean {
  return (rule.all?.every((regex) => regex.test(source)) ?? true) && (rule.any?.some((regex) => regex.test(source)) ?? true);
}

function excludedRound4Identities(): Set<string> {
  const excluded = new Set(ROUND4_COHORT.map((entry) => identityKey(entry.faction_id, entry.ability_id)));
  if (ROUND4_COHORT.length !== 32 || excluded.size !== 32) {
    throw new Error(`Round 4 exclusion cohort must contain 32 unique identities; received ${excluded.size}`);
  }
  return excluded;
}

export function sourceCandidates(sourceIndex: SourceIndex): SourceCandidate[] {
  const candidates: SourceCandidate[] = [];
  for (const faction_id of Object.keys(sourceIndex).sort()) {
    const faction = sourceIndex[faction_id]!;
    for (const ability_id of Object.keys(faction).sort()) {
      const record = faction[ability_id]!;
      if (record.faction && record.faction !== faction_id) {
        throw new Error(`Ambiguous faction identity for ${identityKey(faction_id, ability_id)}`);
      }
      if (typeof record.raw_text !== "string" || record.raw_text.length === 0) {
        const hasStructuredSource = FIELDS.some((field) => typeof record[field] === "string" && record[field]!.length > 0);
        if (!hasStructuredSource) continue;
      }
      const assembled = assembleSource(record);
      candidates.push({ faction_id, ability_id, record, assembled, source_hash: sha256Bytes(Buffer.from(assembled.source_text, "utf8")) });
    }
  }
  return candidates;
}

export function selectRound4BCohort(sourceIndex: SourceIndex): SelectedCandidate[] {
  const excluded = excludedRound4Identities();
  const candidates = sourceCandidates(sourceIndex).filter((candidate) => !excluded.has(identityKey(candidate.faction_id, candidate.ability_id)));
  const selected = new Set<string>();
  const result: SelectedCandidate[] = [];

  for (const stratum of REGEX_STRATA) {
    const seed = STRATUM_SEEDS[stratum];
    const eligible = ordered(seed, candidates.filter((candidate) => !selected.has(identityKey(candidate.faction_id, candidate.ability_id)) && matches(STRATUM_ELIGIBILITY[stratum], candidate.assembled.source_text)));
    if (eligible.length < 5) throw new Error(`Round 4B stratum ${stratum} requires five eligible source records; received ${eligible.length}`);
    for (const [index, candidate] of eligible.slice(0, 5).entries()) {
      const key = identityKey(candidate.faction_id, candidate.ability_id);
      selected.add(key);
      result.push({
        ...candidate,
        selection: { assigned_stratum: stratum, method: "stratum-sha256", seed, ordering_hash: orderingHash(seed, candidate), rank: index + 1 },
      });
    }
  }

  const random = ordered(RANDOM_CORPUS_SEED, candidates.filter((candidate) => !selected.has(identityKey(candidate.faction_id, candidate.ability_id))));
  if (random.length < 5) throw new Error(`Round 4B random-corpus-draw requires five remaining source records; received ${random.length}`);
  for (const [index, candidate] of random.slice(0, 5).entries()) {
    result.push({
      ...candidate,
      selection: {
        assigned_stratum: "random-corpus-draw",
        method: "random-sha256",
        seed: RANDOM_CORPUS_SEED,
        ordering_hash: orderingHash(RANDOM_CORPUS_SEED, candidate),
        rank: index + 1,
      },
    });
  }

  assertCohortInvariants(result);
  return result;
}

export function assertCohortInvariants(cohort: readonly SelectedCandidate[]): void {
  if (cohort.length !== 30) throw new Error(`Round 4B cohort must contain exactly 30 records; received ${cohort.length}`);
  const identities = new Set<string>();
  const excluded = excludedRound4Identities();
  const counts = new Map<SemanticStratum, number>();
  for (const candidate of cohort) {
    const key = identityKey(candidate.faction_id, candidate.ability_id);
    if (identities.has(key)) throw new Error(`Round 4B cohort contains duplicate identity ${key}`);
    if (excluded.has(key)) throw new Error(`Round 4B cohort overlaps Round 4 identity ${key}`);
    identities.add(key);
    counts.set(candidate.selection.assigned_stratum, (counts.get(candidate.selection.assigned_stratum) ?? 0) + 1);
  }
  for (const stratum of SEMANTIC_STRATA) {
    if (counts.get(stratum) !== 5) throw new Error(`Round 4B stratum ${stratum} must contain exactly five records; received ${counts.get(stratum) ?? 0}`);
  }
}
