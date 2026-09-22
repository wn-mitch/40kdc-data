/**
 * Round-trip report: GW source text → authored DSL → describeAbility → prose.
 *
 * What this answers is NOT "do the two prose styles match" — they are
 * deliberately different, and embedding distance alone mostly ranks
 * paraphrase. It answers "did the authored record lose, gain, or move a
 * concrete fact", which is what a mis-categorization actually looks like.
 *
 * Signals, in order of authority:
 *
 *   1. Fact round-trip (exact, high precision). Integers, dice, distances, and
 *      canonical keywords are extracted from BOTH texts with the SAME
 *      extractor and diffed. A fact in the source but not the rendering is a
 *      proven loss; a fact in the rendering but not the source is a proven
 *      fabrication. Numbers and keywords do not get paraphrased, so this
 *      signal has no false positives from prose style.
 *
 *   2. Embedding similarity (coarse triage only). Ranks the residue so a human
 *      can read the worst first. Never a finding on its own.
 *
 * Three buckets, because a raw diff list is mostly noise:
 *
 *   - `divergence`             no declared approximation, no delegation: the
 *                              interesting bucket.
 *   - `declared-approximation` the author already wrote `[APPROX]` in
 *                              community_notes and named what is missing.
 *                              Known gaps, ranked for prioritization.
 *   - `delegated`              templated rules ("always takes the form X") and
 *                              ability-grant records intentionally store a
 *                              parameter instead of re-encoding the rule body.
 *                              A diff here is expected, not a defect.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { hasEmptyModifier } from "./audit-coverage.js";
import { buildReferenceVocabularies } from "./audit-dangling-refs.js";
import { describeAbility } from "./translate/effect.js";
import { buildCohortStates } from "./jev-orks-experiment.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const PRIVATE_ROOT = join(REPO, "_private", "jev-orks");
const ORK_ABILITIES = join(REPO, "data", "enrichment", "orks", "abilities.json");
const OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings";
const EMBED_MODEL = process.env.ROUND_TRIP_EMBED_MODEL ?? "all-minilm";

type AnyRecord = Record<string, unknown>;

export type Facts = {
  integers: number[];
  dice: string[];
  distances: number[];
  keywords: string[];
};

/** Flatten to lowercase alphanumerics — the comparison form used repo-wide. */
export function flatten(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Source rules are printed as numbered lists; those step markers are layout,
 * not gameplay quantities, and would otherwise appear as "lost" integers.
 */
function stepMarkers(source: string): Set<number> {
  return new Set(
    [...source.matchAll(/^\s*(\d+)\s*[.)]/gm)].map((match) => Number(match[1])),
  );
}

/**
 * Boundary-aware keyword match.
 *
 * Matching flattened text with `includes` let short vocabulary terms match
 * inside longer compounds ("beast" inside "beastsnagga"), inflating loses.
 * Matching on a space-separated normalization with alphanumeric boundaries
 * keeps compound keywords intact while still matching "beast" as its own word.
 */
function keywordMatcher(text: string): (keyword: string) => boolean {
  const haystack = text.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cache = new Map<string, boolean>();
  return (keyword: string): boolean => {
    const cached = cache.get(keyword);
    if (cached !== undefined) return cached;
    const needle = keyword.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!needle) return false;
    const found = new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`)
      .test(haystack);
    cache.set(keyword, found);
    return found;
  };
}

/** Extract facts with one extractor so both sides stay comparable. */
export function facts(text: string, vocab: ReadonlySet<string>, steps = new Set<number>()): Facts {
  // Dice and distances carry digits that are already reported as their own
  // facts. Leaving them in the integer set double-counted them and inflated
  // every `lost` total.
  const withoutDice = text.replace(/\b\d*\s*D\d+\b/gi, " ");
  const withoutDistances = withoutDice.replace(/\b\d+\s*(?:"|inches?|inch\b)/gi, " ");
  const integers = [...new Set(
    [...withoutDistances.matchAll(/\b\d+\b/g)]
      .map((match) => Number(match[0]))
      .filter((value) => !steps.has(value)),
  )].sort((a, b) => a - b);
  const dice = [...new Set(
    [...text.toUpperCase().matchAll(/\b\d*D\d+\b/g)].map((match) => match[0]),
  )].sort();
  const distances = [...new Set(
    [...text.matchAll(/\b(\d+)\s*(?:"|inches?|inch\b)/gi)].map((match) => Number(match[1])),
  )].sort((a, b) => a - b);
  const matches = keywordMatcher(text);
  const keywords = [...vocab].filter((keyword) => keyword.length >= 3 && matches(keyword));
  return { integers, dice, distances, keywords };
}

export type FactDiff = {
  missing_integers: number[];
  added_integers: number[];
  missing_dice: string[];
  added_dice: string[];
  missing_distances: number[];
  added_distances: number[];
  missing_keywords: string[];
  added_keywords: string[];
  lost: number;
  invented: number;
};

function diffSets<T>(source: readonly T[], rendered: readonly T[]): { missing: T[]; added: T[] } {
  const renderedSet = new Set(rendered);
  const sourceSet = new Set(source);
  return {
    missing: source.filter((value) => !renderedSet.has(value)),
    added: rendered.filter((value) => !sourceSet.has(value)),
  };
}

export function factDiff(
  sourceText: string,
  renderedText: string,
  vocab: ReadonlySet<string>,
): FactDiff {
  const steps = stepMarkers(sourceText);
  const source = facts(sourceText, vocab, steps);
  const rendered = facts(renderedText, vocab);
  const ints = diffSets(source.integers, rendered.integers);
  const dc = diffSets(source.dice, rendered.dice);
  const dist = diffSets(source.distances, rendered.distances);
  const kw = diffSets(source.keywords, rendered.keywords);
  return {
    missing_integers: ints.missing,
    added_integers: ints.added,
    missing_dice: dc.missing,
    added_dice: dc.added,
    missing_distances: dist.missing,
    added_distances: dist.added,
    missing_keywords: kw.missing,
    added_keywords: kw.added,
    lost: ints.missing.length + dc.missing.length + dist.missing.length + kw.missing.length,
    invented: ints.added.length + dc.added.length + dist.added.length + kw.added.length,
  };
}

const CONTENT_STOP = new Set([
  "the", "and", "that", "this", "with", "from", "for", "are", "was", "its", "can",
  "you", "your", "not", "all", "any", "each", "one", "two", "three", "then", "when",
  "while", "until", "after", "before", "unit", "units", "model", "models", "ability",
  "abilities", "phase", "turn", "roll", "rolls", "make", "makes", "made", "using",
  "use", "used", "has", "have", "had", "may", "must", "into", "onto", "than", "only",
]);

export function contentTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !CONTENT_STOP.has(token)),
  );
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 1 : shared / union;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

async function embed(text: string): Promise<number[] | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(OLLAMA_EMBED_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      });
      if (response.ok) {
        const body = await response.json() as { embedding?: number[] };
        if (body.embedding) return body.embedding;
      }
    } catch {
      // fall through to retry
    }
    await delay(250 * (attempt + 1));
  }
  return null;
}

export type Bucket = "divergence" | "declared-approximation" | "delegated";

/**
 * Defect classes visible from the round trip alone. Each names the mechanism,
 * not just the symptom, so a finding points at the fix.
 */
export type DefectClass =
  | "empty-modifier-stub"
  | "random-table-flattened"
  | "describer-placeholder"
  | "keyword-rendered-as-weapon-ability"
  | "source-is-pointer";

/** Effect types that carry a die roll or a result table. */
const STOCHASTIC_TYPES = new Set(["dice-gated", "dice-table", "auto-result", "roll-modifier", "die-roll"]);

function treeHasType(node: unknown, types: ReadonlySet<string>): boolean {
  if (Array.isArray(node)) return node.some((child) => treeHasType(child, types));
  if (node === null || typeof node !== "object") return false;
  const record = node as AnyRecord;
  if (typeof record.type === "string" && types.has(record.type)) return true;
  return Object.values(record).some((child) => treeHasType(child, types));
}

function hasEmptyModifierNode(node: unknown): boolean {
  return hasEmptyModifier(node);
}

/** Phrases the describer emits when it has no renderer for an effect. */
const PLACEHOLDER_PHRASES = [
  "modify the unit's characteristics",
  "modify the unit’s characteristics",
];

export function defectClasses(
  record: AnyRecord,
  sourceText: string,
  renderedText: string,
): DefectClass[] {
  const found: DefectClass[] = [];
  if (hasEmptyModifierNode(record.effect)) found.push("empty-modifier-stub");

  // A source that states die results but a record with no stochastic node has
  // lost the randomness: the rule becomes strictly better than it is.
  const sourceHasTable = /roll (?:one|two|either one) D\d|on a \d|On a \d|\d\s*[-‑–]\s*\d\s*[,:]/.test(sourceText);
  if (sourceHasTable && !treeHasType(record.effect, STOCHASTIC_TYPES)) {
    found.push("random-table-flattened");
  }

  if (PLACEHOLDER_PHRASES.some((phrase) => renderedText.toLowerCase().includes(phrase))) {
    found.push("describer-placeholder");
  }

  // Lone Operative, Deep Strike etc. are unit-level rules; rendering them as a
  // weapon ability mis-states what they modify.
  if (/weapons? gain \[|weapons? have \[/i.test(renderedText)) {
    const weaponish = /\[(.*?)\]/g;
    const brackets = [...renderedText.matchAll(weaponish)].map((match) => match[1].toLowerCase());
    if (brackets.some((keyword) => /lone operative|deep strike|scouts|infiltrator/.test(keyword))) {
      found.push("keyword-rendered-as-weapon-ability");
    }
  }

  if (/has the following weapon|ability \(see left\)|weapon \(see/i.test(sourceText)) {
    found.push("source-is-pointer");
  }
  return found;
}

export type RoundTripRow = {
  ability_id: string;
  name: string;
  bucket: Bucket;
  template: string | null;
  defect_classes: DefectClass[];
  declared_notes: string | null;
  fact_diff: FactDiff;
  jaccard: number;
  embedding_cosine: number | null;
  source_text: string;
  rendered_text: string;
};

const TEMPLATE_PATTERN = /always takes the form\s+([A-Z][A-Za-z ]+?)\s*[X.]/;

/** Does any node in the effect tree grant an ability instead of encoding it? */
function grantsAbility(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(grantsAbility);
  if (node === null || typeof node !== "object") return false;
  const record = node as AnyRecord;
  if (record.type === "ability-grant") {
    const modifier = record.modifier;
    if (modifier && typeof modifier === "object") {
      const keys = modifier as AnyRecord;
      if (typeof keys.grant_type === "string" || typeof keys.ability_id === "string") return true;
    }
  }
  return Object.values(record).some(grantsAbility);
}

export function classify(record: AnyRecord, sourceText: string): { bucket: Bucket; template: string | null } {
  const notes = typeof record.community_notes === "string" ? record.community_notes : "";
  const template = TEMPLATE_PATTERN.exec(sourceText)?.[1]?.trim() ?? null;
  // Core rules and templated rules are definitional: the DSL references the
  // rule by id instead of re-encoding its body, so a text diff is expected.
  if (template
    || String(record.ability_type) === "core"
    || /has the following weapon|ability \(see left\)/i.test(sourceText)
    || grantsAbility(record.effect)) {
    return { bucket: "delegated", template };
  }
  if (notes.includes("[APPROX]")) return { bucket: "declared-approximation", template };
  return { bucket: "divergence", template };
}

export async function roundTripReport(options: {
  abilityIds?: readonly string[];
  embedEnabled?: boolean;
  concurrency?: number;
} = {}): Promise<{ rows: RoundTripRow[]; summary: AnyRecord }> {
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

  const vocabularies = await buildReferenceVocabularies();
  const vocab = vocabularies.keywords;
  const states = buildCohortStates({ abilityIds: targetIds });
  const byId = new Map(abilities.map((ability) => [String(ability.ability_id), ability]));

  const rows: RoundTripRow[] = [];
  for (const abilityId of targetIds) {
    const state = states[abilityId];
    const record = byId.get(abilityId);
    if (!state || !record) continue;
    const rendered = describeAbility(record as Parameters<typeof describeAbility>[0]);
    const sourceText = state.source_text;
    const { bucket, template } = classify(record, sourceText);
    const notes = typeof record.community_notes === "string" ? record.community_notes : null;
    rows.push({
      ability_id: abilityId,
      name: String(record.name),
      bucket,
      template,
      defect_classes: defectClasses(record, sourceText, rendered),
      declared_notes: notes,
      fact_diff: factDiff(sourceText, rendered, vocab),
      jaccard: jaccard(contentTokens(sourceText), contentTokens(rendered)),
      embedding_cosine: null,
      source_text: sourceText,
      rendered_text: rendered,
    });
  }

  if (options.embedEnabled) {
    const limit = options.concurrency ?? 6;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < rows.length) {
        const index = cursor;
        cursor += 1;
        const row = rows[index];
        const [a, b] = await Promise.all([embed(row.source_text), embed(row.rendered_text)]);
        row.embedding_cosine = a && b ? cosine(a, b) : null;
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
    // A silent embedding outage would present as "null cosine everywhere",
    // which reads like a property of the data rather than a broken dependency.
    const unembedded = rows.filter((row) => row.embedding_cosine === null).length;
    if (unembedded > 0) {
      console.warn(
        `[round-trip] ${unembedded}/${rows.length} rows have no embedding. `
        + `Is \`ollama serve\` running with the ${EMBED_MODEL} model? `
        + "Ranking falls back to the exact fact diff, which is the authority anyway.",
      );
    }
  }

  rows.sort((left, right) =>
    (right.fact_diff.lost + right.fact_diff.invented) - (left.fact_diff.lost + left.fact_diff.invented)
    || left.jaccard - right.jaccard);

  const byBucket = (bucket: Bucket): RoundTripRow[] => rows.filter((row) => row.bucket === bucket);
  const mean = (values: number[]): number | null =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const cosines = (subset: RoundTripRow[]): number | null =>
    mean(subset.map((row) => row.embedding_cosine).filter((value): value is number => value !== null));

  const summary = {
    abilities: rows.length,
    buckets: {
      divergence: byBucket("divergence").length,
      declared_approximation: byBucket("declared-approximation").length,
      delegated: byBucket("delegated").length,
    },
    clean_by_bucket: Object.fromEntries(([
      "divergence", "declared-approximation", "delegated",
    ] as Bucket[]).map((bucket) => [
      bucket,
      byBucket(bucket).filter((row) => row.fact_diff.lost === 0 && row.fact_diff.invented === 0).length,
    ])),
    mean_jaccard_by_bucket: Object.fromEntries(([
      "divergence", "declared-approximation", "delegated",
    ] as Bucket[]).map((bucket) => [bucket, mean(byBucket(bucket).map((row) => row.jaccard))])),
    mean_embedding_cosine_by_bucket: Object.fromEntries(([
      "divergence", "declared-approximation", "delegated",
    ] as Bucket[]).map((bucket) => [bucket, cosines(byBucket(bucket))])),
    embed_model: options.embedEnabled ? EMBED_MODEL : null,
    defect_classes: (() => {
      const counts: Record<string, number> = {};
      for (const row of rows) {
        for (const name of row.defect_classes) counts[name] = (counts[name] ?? 0) + 1;
      }
      return counts;
    })(),
    defect_classes_in_divergence: (() => {
      const counts: Record<string, number> = {};
      for (const row of byBucket("divergence")) {
        for (const name of row.defect_classes) counts[name] = (counts[name] ?? 0) + 1;
      }
      return counts;
    })(),
  };
  return { rows, summary };
}

const isMain = process.argv[1]?.endsWith("round-trip-report.ts") ?? false;
if (isMain) {
  const argv = process.argv.slice(2);
  const sample = argv.includes("--sample");
  const noEmbed = argv.includes("--no-embed");
  const onlyBucket = argv[argv.indexOf("--bucket") + 1];
  const limitArg = argv.indexOf("--limit");
  const limit = limitArg === -1 ? (sample ? 5 : 25) : Number(argv[limitArg + 1]);
  roundTripReport({ embedEnabled: !noEmbed })
    .then((report) => {
      const rows = report.rows
        .filter((row) => !argv.includes("--bucket") || row.bucket === onlyBucket)
        .slice(0, limit);
      if (sample) {
        for (const row of rows) {
          console.log(`\n${"=".repeat(96)}\n${row.ability_id}  (${row.name})  [${row.bucket}]\n${"-".repeat(96)}`);
          console.log(`SOURCE   : ${row.source_text.replace(/\s+/g, " ").slice(0, 700)}`);
          console.log(`RENDERED : ${row.rendered_text.replace(/\s+/g, " ")}`);
          const lost = Object.fromEntries(
            Object.entries(row.fact_diff).filter(([key, value]) => key.startsWith("missing") && Array.isArray(value) && value.length),
          );
          const added = Object.fromEntries(
            Object.entries(row.fact_diff).filter(([key, value]) => key.startsWith("added") && Array.isArray(value) && value.length),
          );
          console.log(`LOST     : ${JSON.stringify(lost)}`);
          console.log(`INVENTED : ${JSON.stringify(added)}`);
          console.log(`jac=${row.jaccard.toFixed(3)} cos=${row.embedding_cosine?.toFixed(3) ?? "n/a"}`);
        }
        return;
      }
      console.log(JSON.stringify({ summary: report.summary }, null, 2));
      console.log(`\nworst ${rows.length} (filtered):`);
      for (const row of rows) {
        console.log([
          row.ability_id.padEnd(46),
          row.bucket.padEnd(24),
          `lost=${String(row.fact_diff.lost).padStart(2)}`,
          `inv=${String(row.fact_diff.invented).padStart(2)}`,
          `jac=${row.jaccard.toFixed(2)}`,
          `cos=${row.embedding_cosine?.toFixed(2) ?? " n/a"}`,
        ].join("  "));
      }
      mkdirSync(PRIVATE_ROOT, { recursive: true });
      writeFileSync(join(PRIVATE_ROOT, "round-trip.json"), JSON.stringify(report, null, 2));
      console.log(`\nwrote ${join(PRIVATE_ROOT, "round-trip.json")}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
