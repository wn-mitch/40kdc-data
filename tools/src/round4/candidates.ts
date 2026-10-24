import type {
  AtomCandidate,
  AtomEvidence,
  CandidateAbilityResult,
  FrozenAbility,
  GeneratorChannel,
  JsonValue,
  RelationQuestion,
  SemanticFamily,
} from "./contracts.js";
import { hashJson } from "./hash.js";
import { buildSpanLattice, utf8Span } from "./spans.js";
export interface CandidateSeed {
  family: SemanticFamily;
  role: string;
  meaning: string;
  value: JsonValue;
  participant?: string | null;
  arguments?: Record<string, string | number | boolean | null>;
  start: number;
  end: number;
  channel: GeneratorChannel;
  rank?: number;
}

const WORDS: Array<{
  pattern: RegExp;
  family: SemanticFamily;
  role: string;
  meaning: string;
  value: JsonValue;
  channel: GeneratorChannel;
}> = [
  { pattern: /\b(?:this|that|your|enemy|friendly|selected|attacking|bearer's) (?:unit|model|attack)\b/gi, family: "participant-reference", role: "participant", meaning: "local participant reference", value: "local-reference", channel: "antecedent-scan" },
  { pattern: /\b(?:all|one or more|up to \d+|one|each) (?:friendly |enemy )?(?:units?|models?|attacks?|weapons?)\b/gi, family: "participant-reference", role: "collection", meaning: "participant collection", value: "source-named-collection", channel: "local-context" },
  { pattern: /\b(?:Move|Attacks?|Strength|Damage|Armour Penetration|Objective Control|Leadership|Ballistic Skill|Weapon Skill) characteristic\b/gi, family: "property", role: "characteristic", meaning: "named characteristic", value: "characteristic", channel: "closed-lexicon" },
  { pattern: /\b(?:Hit|Wound|Saving|Charge|Advance|Battle[-‐‑–— ]?shock|Leadership) rolls?\b/gi, family: "property", role: "roll", meaning: "named roll property", value: "roll", channel: "closed-lexicon" },
  { pattern: /\b(?:add|improve|subtract|worsen|double|reduce|ignore|re-roll|reroll|gain|discard|remove|select|set back up|set up|move|suffers?|substitute|replace)\b/gi, family: "operation", role: "verb", meaning: "source operation", value: "source-verb", channel: "morphological-alias" },
  { pattern: /\bautomatically succeed\b/gi, family: "operation", role: "automatic-result", meaning: "automatic successful result", value: "automatic-success", channel: "normalization-alias" },
  { pattern: /\b(?:at the start of|at the end of|after|before|when|each time|just after|while)\b/gi, family: "event", role: "timing", meaning: "source timing event", value: "timing-event", channel: "closed-lexicon" },
  { pattern: /\b(?:if|unless|excluding|cannot|only if|provided|must|not eligible|is not|has not)\b/gi, family: "predicate", role: "guard", meaning: "source predicate", value: "guard", channel: "closed-lexicon" },
  { pattern: /\buntil (?:the start|the end|.+? has finished)[^,.;:]*/gi, family: "duration", role: "expiry", meaning: "explicit duration", value: "source-duration", channel: "regex" },
  { pattern: /\b(?:once per (?:turn|phase|battle|battle round)|one .* per phase|can only .* once per (?:turn|phase|battle|battle round))\b/gi, family: "usage-frequency", role: "limit", meaning: "explicit usage frequency", value: "source-frequency", channel: "regex" },
  { pattern: /\b(?:within|more than|up to|closer to|as close as possible|passes over or through)\b[^,.;:]*/gi, family: "spatial-relation", role: "relation", meaning: "spatial relation", value: "source-spatial", channel: "regex" },
  { pattern: /\b(?:CP|Miracle dice|dice pool|marker)\b/gi, family: "resource-action", role: "resource", meaning: "named consumable or stateful resource", value: "source-resource", channel: "registry-lookup" },
  { pattern: /\b(?:roll|re-roll|reroll|substitute|unmodified dice roll|not rolled)\b/gi, family: "dice-operation", role: "dice-action", meaning: "dice operation", value: "source-dice-operation", channel: "closed-lexicon" },
  { pattern: /\b(?:each time|for each|each model|each unit|all remaining)\b/gi, family: "iteration", role: "iterator", meaning: "iterate source collection", value: "source-iteration", channel: "closed-lexicon" },
  { pattern: /\b(?:select one of|either|any or all|one or more|up to \d+)\b/gi, family: "choice", role: "choice", meaning: "bounded choice", value: "source-choice", channel: "closed-lexicon" },
  { pattern: /\b(?:then|after|before|once .* made|if it does|when doing so)\b/gi, family: "sequence", role: "ordering", meaning: "ordered step relation", value: "source-sequence", channel: "closed-lexicon" },
  { pattern: /\b(?:ability|Stratagem|Deep Strike|Lone Operative|Heroic Intervention|Righteous|suppressed|snared)\b/gi, family: "rule-reference", role: "named-rule", meaning: "named rule or local state reference", value: "source-rule-reference", channel: "registry-lookup" },
];

const NUMERIC_PATTERN = /(?<![A-Za-z0-9])(?:\d+D\d+|D\d+|\d+\+|\d+"|\d+CP|\d+)(?![A-Za-z0-9])/gi;
const CONNECTIVE_PATTERN = /\b(?:and\/or|and|or|instead|otherwise|in addition)\b/gi;

function candidateKey(seed: CandidateSeed): string {
  return hashJson({
    family: seed.family,
    role: seed.role,
    meaning: seed.meaning,
    value: seed.value,
    participant: seed.participant ?? null,
    arguments: seed.arguments ?? {},
  });
}

export function collapseCandidateSeeds(source: string, seeds: CandidateSeed[]): AtomCandidate[] {
  const grouped = new Map<string, { seed: CandidateSeed; evidence: AtomEvidence[]; bestRank: number }>();
  for (const seed of seeds) {
    const key = candidateKey(seed);
    const evidence: AtomEvidence = { span: utf8Span(source, seed.start, seed.end), channel: seed.channel };
    const current = grouped.get(key);
    if (current) {
      if (!current.evidence.some((item) => item.span.start === evidence.span.start && item.span.end === evidence.span.end && item.channel === evidence.channel)) {
        current.evidence.push(evidence);
      }
      current.bestRank = Math.min(current.bestRank, seed.rank ?? 1);
    } else grouped.set(key, { seed, evidence: [evidence], bestRank: seed.rank ?? 1 });
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, { seed, evidence, bestRank }], index) => ({
      id: `a${String(index + 1).padStart(3, "0")}-${key.slice(0, 8)}`,
      family: seed.family,
      rank: bestRank,
      role: seed.role,
      meaning: seed.meaning,
      value: seed.value,
      participant: seed.participant ?? null,
      arguments: seed.arguments ?? {},
      evidence: evidence.sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end || left.channel.localeCompare(right.channel)),
    }));
}

function pushMatches(source: string, seeds: CandidateSeed[]): void {
  for (const rule of WORDS) {
    for (const match of source.matchAll(rule.pattern)) {
      seeds.push({ ...rule, start: match.index, end: match.index + match[0].length });
    }
  }
  for (const match of source.matchAll(NUMERIC_PATTERN)) {
    const token = match[0];
    const lower = token.toLowerCase();
    const base = { start: match.index, end: match.index + token.length, channel: "regex" as const };
    if (/^\d*d\d+$/i.test(token)) {
      seeds.push({ ...base, family: "magnitude-expression", role: "dice-expression", meaning: "dice expression", value: token.toUpperCase(), rank: 1 });
      seeds.push({ ...base, family: "dice-operation", role: "roll-cardinality", meaning: "roll a dice expression", value: token.toUpperCase(), rank: 2 });
    } else if (lower.endsWith('"')) {
      seeds.push({ ...base, family: "magnitude-expression", role: "distance", meaning: "distance in inches", value: Number(token.slice(0, -1)), rank: 1 });
      seeds.push({ ...base, family: "spatial-relation", role: "distance-argument", meaning: "spatial threshold", value: Number(token.slice(0, -1)), rank: 2 });
    } else if (lower.endsWith("cp")) {
      seeds.push({ ...base, family: "magnitude-expression", role: "resource-amount", meaning: "command point amount", value: Number(token.slice(0, -2)), rank: 1 });
      seeds.push({ ...base, family: "resource-action", role: "resource-amount", meaning: "command point quantity", value: Number(token.slice(0, -2)), rank: 2 });
    } else if (lower.endsWith("+")) {
      seeds.push({ ...base, family: "magnitude-expression", role: "threshold", meaning: "inclusive success threshold", value: Number(token.slice(0, -1)), rank: 1 });
      seeds.push({ ...base, family: "dice-operation", role: "per-die-success", meaning: "per-die threshold test", value: Number(token.slice(0, -1)), rank: 2 });
    } else {
      const value = Number(token);
      for (const [rank, role] of ["fixed-value", "cardinality", "modifier", "threshold"].entries()) {
        seeds.push({ ...base, family: "magnitude-expression", role, meaning: `numeric ${role}`, value, rank: rank + 1 });
      }
    }
  }
  for (const match of source.matchAll(CONNECTIVE_PATTERN)) {
    const base = { start: match.index, end: match.index + match[0].length, channel: "closed-lexicon" as const };
    if (/instead/i.test(match[0])) {
      seeds.push({ ...base, family: "sequence", role: "replacement", meaning: "replacement branch", value: "replacement", rank: 1 });
      seeds.push({ ...base, family: "choice", role: "coexistence", meaning: "coexisting alternative", value: "coexistence", rank: 2 });
    } else if (/\bor\b/i.test(match[0])) {
      seeds.push({ ...base, family: "choice", role: "disjunction", meaning: "logical disjunction", value: "disjunction", rank: 1 });
      seeds.push({ ...base, family: "choice", role: "deliberate-choice", meaning: "controller choice", value: "choice", rank: 2 });
    } else {
      seeds.push({ ...base, family: "sequence", role: "coexistence", meaning: "coexisting ordered clauses", value: "coexistence", rank: 1 });
    }
  }
}

function contextFor(source: string, startByte: number, endByte: number): string {
  const bytes = Buffer.from(source, "utf8");
  return bytes.subarray(Math.max(0, startByte - 100), Math.min(bytes.length, endByte + 100)).toString("utf8");
}

function questionOptions(candidates: AtomCandidate[]): RelationQuestion["options"] {
  return [
    ...candidates.slice(0, 8).map((candidate) => ({
      id: candidate.id,
      label: candidate.meaning,
      description: `${candidate.family}/${candidate.role}: ${JSON.stringify(candidate.value)}`,
      kind: "candidate" as const,
      atom_id: candidate.id,
    })),
    { id: "none", label: "None", description: "The source explicitly states that none of these apply.", kind: "none" as const },
    { id: "unknown", label: "Unknown", description: "The local source context does not determine this relation.", kind: "unknown" as const },
  ];
}

export function buildQuestions(record: FrozenAbility, candidates: AtomCandidate[]): RelationQuestion[] {
  const source = record.source_text;
  const groups = new Map<string, AtomCandidate[]>();
  for (const candidate of candidates) {
    const first = candidate.evidence[0];
    if (!first) continue;
    const key = `${first.span.start}:${first.span.end}:${candidate.family}`;
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }
  const questions: RelationQuestion[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const span = group[0]!.evidence[0]!.span;
    questions.push({
      id: `q-atom-${hashJson({ key, ids: group.map((item) => item.id) }).slice(0, 12)}`,
      identity: { faction_id: record.faction_id, ability_id: record.ability_id },
      type: "argument-filling",
      source_span: span,
      source_context: contextFor(source, span.start, span.end),
      prompt: `Which local semantic interpretation is stated by the marked source expression for ${group[0]!.family}?`,
      subject_atom_ids: group.map((item) => item.id),
      options: questionOptions(group),
    });
  }

  const relationPatterns: Array<{ pattern: RegExp; type: RelationQuestion["type"]; prompt: string; families: SemanticFamily[] }> = [
    { pattern: /\b(?:that|those|it|its|this) (?:unit|model|attack|roll|use|result)?\b/gi, type: "antecedent", prompt: "What previously introduced local participant does this reference denote?", families: ["participant-reference"] },
    { pattern: /\buntil\b[^,.;:]*/gi, type: "duration-scope", prompt: "Which local operation or state has this explicit duration?", families: ["operation", "event", "rule-reference"] },
    { pattern: /\bif\b[^,.;:]*/gi, type: "attachment", prompt: "Which immediately local consequence is guarded by this condition?", families: ["operation", "sequence"] },
    { pattern: /\b(?:if passed|if failed|otherwise)\b/gi, type: "branch-kind", prompt: "What branch kind does this local clause introduce?", families: ["predicate", "sequence"] },
    { pattern: /\b(?:and\/or|or)\b/gi, type: "choice-vs-disjunction", prompt: "Is this expression a controller choice or a logical disjunction?", families: ["choice"] },
    { pattern: /\binstead\b/gi, type: "replacement-vs-coexistence", prompt: "Does this clause replace the default effect or coexist with it?", families: ["choice", "sequence"] },
    { pattern: /\b(?:for each|each time|each model|each unit)\b/gi, type: "iterator-collection", prompt: "Which locally named collection is iterated?", families: ["participant-reference", "iteration"] },
  ];
  for (const relation of relationPatterns) {
    for (const match of source.matchAll(relation.pattern)) {
      const span = utf8Span(source, match.index, match.index + match[0].length);
      const relevant = candidates.filter((candidate) => relation.families.includes(candidate.family) && candidate.evidence.some((item) => Math.abs(item.span.start - span.start) <= 180));
      questions.push({
        id: `q-rel-${hashJson({ type: relation.type, span, relevant: relevant.map((item) => item.id) }).slice(0, 12)}`,
        identity: { faction_id: record.faction_id, ability_id: record.ability_id },
        type: relation.type,
        source_span: span,
        source_context: contextFor(source, span.start, span.end),
        prompt: relation.prompt,
        subject_atom_ids: relevant.map((item) => item.id),
        options: questionOptions(relevant),
      });
    }
  }
  return questions.sort((left, right) => left.source_span.start - right.source_span.start || left.id.localeCompare(right.id));
}

export function generateCandidates(record: FrozenAbility): CandidateAbilityResult {
  const seeds: CandidateSeed[] = [];
  pushMatches(record.source_text, seeds);
  const candidates = collapseCandidateSeeds(record.source_text, seeds);
  return {
    faction_id: record.faction_id,
    ability_id: record.ability_id,
    source_hash: record.source_hash,
    lattice: buildSpanLattice(record),
    candidates,
    questions: buildQuestions(record, candidates),
  };
}
