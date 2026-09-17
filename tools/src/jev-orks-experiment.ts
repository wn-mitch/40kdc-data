import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  TypeSafeClient,
  choice,
  noul,
  type Questions,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import { createValidator } from "./schema-loader.js";
import { nameToId, detachmentScopedId } from "./converters/id-generator.js";
import {
  DEFAULT_DUMP_PATH,
  loadDump,
  type MfmDump,
  type RuleContainerComponentRow,
} from "./mfm/loader.js";
import { sourceDigest } from "./source-digest.js";
import { describeAbility } from "./translate/effect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const DEFAULT_PRIVATE_ROOT = join(REPO, "_private", "jev-orks");
/** Source-text corpus. Absent outside the maintainer's checkout, so tests guard on it. */
export const DEFAULT_CORPUS = join(DEFAULT_PRIVATE_ROOT, "source-corpus.json");
const ABILITIES = join(REPO, "data", "enrichment", "orks", "abilities.json");
const MODEL = "jev-latest";
const INPUT_PRICE_PER_MILLION_USD = 0.042;
const DEFAULT_BUDGET_USD = 0.1;
const ACCEPTANCE_CONFIDENCE = 0.8;
const SCHEDULING_RESERVE_USD = 0.005;
const EXPERIMENT_VERSION = 2;
const ABILITY_SCHEMA_ID = "https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json";
export const INITIAL_COHORT = [
  "waaagh-banner",
  "try-dat-button-dread-mob",
  "where-dya-fink-youre-going-da-big-hunt",
  "waaagh",
  "enhanced-runt-maw-madcap-meks",
  "competitive-streak-kult-of-speed",
  "armed-to-da-teef-bully-boyz",
  "dakkastorm-kult-of-speed",
  "adrenaline-junkies-kult-of-speed",
  "wild-ride",
  "bomb-squig",
  "shooty-power-trip",
] as const;

export const RANDOM_COHORT_2 = [
  "follow-me-ladz-war-horde",
  "push-dat-bit-back-in",
  "squig-mine",
  "morgogs-finkin-cap-brute-bosses",
  "get-da-good-bitz",
  "supa-glowy-fing-shoota-boyz",
  "piston-driven-brutality",
  "hardy-bioniks",
  "boom-bomb",
  "smash-em-up",
  "long-uncontrolled-bursts-flyboyz",
  "aerial-deployment",
  "while-their-backs-are-turned-taktikal-brigade",
  "da-boss-ladz",
  "squig-barrage",
] as const;

export const COHORT = [...INITIAL_COHORT, ...RANDOM_COHORT_2] as const;

/** Abilities with hand-authored constructors and per-ability packets. */
const SUPERVISED_IDS = new Set<string>(INITIAL_COHORT);
/** Unseen abilities already examined before slicing existed. */
const LEGACY_UNSEEN_IDS = new Set<string>(RANDOM_COHORT_2);

export const SLICE_SIZE = 15;
const SLICE_SEED = 20040;

/** Deterministic PRNG: the slice order must be reproducible across runs. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Every Ork ability with source text, minus the supervised fixtures and the
 * already-examined legacy cohort, in a fixed shuffled order. Slices are cut
 * from this order, so slice N is stable no matter which slices have run.
 */
export function orkSlicePool(corpusPath?: string): string[] {
  const corpus = readJson<Record<string, Record<string, string>>>(corpusPath ?? DEFAULT_CORPUS);
  const ids = Object.keys(corpus.orks ?? {})
    .filter((id) => !SUPERVISED_IDS.has(id) && !LEGACY_UNSEEN_IDS.has(id))
    .sort();
  return seededShuffle(ids, SLICE_SEED);
}

export function orkSliceCount(corpusPath?: string): number {
  return Math.ceil(orkSlicePool(corpusPath).length / SLICE_SIZE);
}

export function orkSlice(index: number, corpusPath?: string): string[] {
  const pool = orkSlicePool(corpusPath);
  return pool.slice((index - 1) * SLICE_SIZE, index * SLICE_SIZE);
}

export const JEV_REFINEMENT_LEDGER = [
  {
    ability_id: "competitive-streak-kult-of-speed",
    unresolved_slot: "effect subject",
    weak_question: "Who receives the Charge re-roll effect?",
    issue: "The choice required interpreting enhancement bearer semantics.",
    replacements: [
      "Does the operative sentence literally make 'This unit' the subject?",
      "Does that sentence grant this unit permission to re-roll Charge rolls?",
    ],
  },
  {
    ability_id: "competitive-streak-kult-of-speed",
    unresolved_slot: "re-roll extent",
    weak_question: "Which Charge results may be re-rolled?",
    issue: "The answer taxonomy imposed failure-result semantics absent from the source.",
    replacements: [
      "Does the source state no result subset or per-battle usage limit?",
      "Does the source state no event trigger or expiry?",
    ],
  },
  {
    ability_id: "waaagh",
    unresolved_slot: "state expiry",
    weak_question: "Does the state last through the controlling player's following turn?",
    issue: "The question inferred turn ownership not stated by the source.",
    replacements: [
      "Does the source define expiry exactly as the end of the next turn without naming a player?",
    ],
  },
  {
    ability_id: "waaagh",
    unresolved_slot: "state-dependent permissions",
    weak_question: "Do both permissions depend on the same state?",
    issue: "A compound relation obscured which permission depended on the state.",
    replacements: [
      "Is post-Advance shooting available only while the Waaagh is active?",
      "Is post-Advance charging available only while the Waaagh is active?",
    ],
  },
  {
    ability_id: "enhanced-runt-maw-madcap-meks",
    unresolved_slot: "selection optionality",
    weak_question: "May the controller decline to select a qualifying enemy?",
    issue: "The negative permission required inference from imperative source wording.",
    replacements: [
      "When a qualifying enemy exists, does the rule instruct the controller to select one?",
    ],
  },
  {
    ability_id: "wild-ride",
    unresolved_slot: "charge-roll branch",
    weak_question: "Does a separate branch affect Charge rolls?",
    issue: "The question mixed source extraction with decomposition into branches.",
    replacements: [
      "Does the source explicitly list Charge rolls among the modifier categories?",
    ],
  },
  {
    ability_id: "wild-ride",
    unresolved_slot: "effect subject",
    weak_question: "Do all three branches apply to this unit?",
    issue: "The compound branch question made subject binding depend on prior interpretation.",
    replacements: [
      "Is this unit the subject that may ignore each listed modifier?",
    ],
  },
] as const;

/**
 * Laws extracted from the unseen-data rounds. Distinct from
 * JEV_REFINEMENT_LEDGER, which records individual weak→strong question
 * rewrites learned on the supervised cohort.
 *
 * Each law names the measured failure that produced it. The evidence column
 * is the observation, not a rationale — these were derived by running the
 * harness, not by reasoning about it.
 */
export const JEV_DESIGN_LAWS = [
  {
    law: "Closure is per slot, not per question.",
    evidence:
      "Conjunctive closure over a flat question list scored 1/15. Re-scoring the "
      + "same answers per slot scored 12/15. Raising per-leaf reliability 76%→85% "
      + "while growing leaves 13→32 moved closure 1/15→0/15 — better answers, worse "
      + "score, which is the signature of a gate that measures the wrong quantity.",
  },
  {
    law: "A forced choice cannot describe a multi-valued or unstated slot.",
    evidence:
      "5 of 6 single-choice slots produced mid-band answers by construction. "
      + "`condition_relation` failed 11 of 15 abilities because its predicates "
      + "co-occur in one source clause.",
  },
  {
    law: "Derive absence; never ask for it.",
    evidence:
      "`semantic_duration=none` was ambiguous in 8 of 15 abilities, and the sole "
      + "remaining blocker after 12/15 was a negation-flavored boolean "
      + "(`controller_choice_present`) sitting at 0.53–0.59. Omitting the question "
      + "and deriving the field from clause structure closed all 15.",
  },
  {
    law: "Gate generation on confident answers only.",
    evidence:
      "`has_trigger` at 0.51 spawned a `trigger_event` slot whose emptiness then "
      + "counted against closure.",
  },
  {
    law: "Slots are per clause.",
    evidence:
      "`semantic_subject` had both `this-unit` and `selected-unit` in the ambiguous "
      + "band for 6 of 15 abilities. Selection sentences and effect sentences have "
      + "different subjects, so one per-rule slot cannot hold the value. Observed but "
      + "not yet repaired.",
  },
] as const;

/**
 * The cohort is no longer a closed literal union: slices are cut from the
 * whole Ork corpus, so ability ids are open-ended. The alias is kept because
 * it documents every signature that speaks in ability ids.
 */
export type CohortAbilityId = string;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type AnyRecord = Record<string, unknown>;

type SourceComponent = {
  id: string;
  position: number;
  type: string | null;
  heading: string | null;
  text: string;
};

export type AbilityState = {
  ability: {
    source_id: string;
    name: string;
    faction: "orks";
    kind: string;
  };
  hierarchy: {
    container_type: string | null;
    components: SourceComponent[];
  };
  entity_context: {
    unit_ids: string[];
    detachment_id: string | null;
  };
  literal_candidates: {
    integers: number[];
    dice: string[];
    distances_inches: number[];
    named_keywords: string[];
  };
  source_text: string;
};

export type CachedResponse = {
  request_hash: string;
  repeat: number;
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
};

export type CandidateClaim = {
  id: string;
  ability_id: CohortAbilityId;
  question_id: string;
  predicate: string;
  value: Json;
  probability: number;
  selected: boolean;
  source_digest: string;
  state: "proposed";
};

export type ConstructionResult = {
  status: "constructed" | "incomplete" | "unsupported";
  candidate?: AnyRecord;
  consumed_claim_ids: string[];
  unconsumed_claim_ids: string[];
  findings: string[];
};

export type CostLedger = {
  budget_usd: number;
  input_tokens: number;
  output_tokens: number;
  observed_cost_usd: number;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const canonical = (value: unknown): string => JSON.stringify(sortJson(value));
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as AnyRecord)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function plain(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<b>(.*?)<\/b>/gis, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
  return text || null;
}

function componentText(component: RuleContainerComponentRow): { heading: string | null; text: string } {
  const en = component.localisations?.en;
  const heading = plain(en?.title ?? null);
  const fields = [en?.textContent, en?.trigger, en?.effect]
    .map((value) => plain(value ?? null))
    .filter((value): value is string => value !== null);
  return { heading, text: fields.join("\n") };
}

export function slugCandidates(name: string, detachmentName: string | undefined): string[] {
  const candidates = new Set<string>([nameToId(name)]);
  if (detachmentName) {
    try {
      candidates.add(detachmentScopedId(name, detachmentName));
    } catch {
      // The bare identity remains usable for names outside the slug contract.
    }
  }
  return [...candidates];
}

function hierarchyFor(dump: MfmDump, ability: AnyRecord): AbilityState["hierarchy"] {
  const abilityId = String(ability.ability_id);
  const abilityName = String(ability.name);
  const detachmentId = typeof ability.detachment_id === "string" ? ability.detachment_id : null;
  const detachment = detachmentId ? dump.byId("detachment").get(detachmentId) : undefined;
  const ids = new Set(slugCandidates(abilityName, dump.enName(detachment)));
  ids.add(abilityId);
  const unitIds = new Set(Array.isArray(ability.unit_ids) ? ability.unit_ids.map(String) : []);
  const usesDatasheetHierarchy = ["unit", "core"].includes(String(ability.ability_type));
  const datasheetIds = new Set(
    dump.table("datasheet")
      .filter((datasheet) => {
        const name = dump.enName(datasheet);
        return name ? unitIds.has(nameToId(name)) : false;
      })
      .map((datasheet) => datasheet.id),
  );
  const linkedDatasheetAbilityIds = new Set(
    dump.table("datasheet_datasheet_ability")
      .filter((link) => datasheetIds.has(link.datasheetId))
      .map((link) => link.datasheetAbilityId),
  );

  // Faction scope. Ability names collide across factions — "Full Throttle" is
  // both an Ork and an Adeptus Astartes stratagem — and the dump table is not
  // faction-ordered, so an unscoped name match silently returns another
  // faction's rule text. Both the detachment and the units give a reliable
  // faction keyword to gate on.
  const expectedFaction = (detachment ? dump.factionKeywordOfDetachment(detachment.id) : null)
    ?? [...datasheetIds]
      .map((datasheetId) => dump.factionKeywordOfDatasheet(datasheetId))
      .find((keyword): keyword is string => Boolean(keyword))
    ?? null;

  // The stratagem table is only a valid source for abilities that ARE
  // stratagems. A datasheet or detachment rule that happens to share a
  // stratagem's name ("Breakin' Heads", "Gun-crazy Show-offs") would otherwise
  // resolve to the stratagem's text and every downstream claim would rest on
  // the wrong rule.
  const usesStratagemHierarchy = String(ability.ability_type) === "stratagem";

  for (const stratagem of usesStratagemHierarchy ? dump.table("stratagem") : []) {
    const stratagemName = dump.enName(stratagem);
    const stratagemDetachment = stratagem.detachmentId
      ? dump.byId("detachment").get(stratagem.detachmentId)
      : undefined;
    if (!stratagemName
      || !slugCandidates(stratagemName, dump.enName(stratagemDetachment)).some((id) => ids.has(id))) {
      continue;
    }
    // A stratagem printed under a specific detachment must belong to the same
    // detachment the ability is scoped to. Detachment-less stratagems are the
    // universal core set, which is legitimately shared across factions.
    if (detachment && stratagem.detachmentId && stratagem.detachmentId !== detachment.id) continue;
    if (expectedFaction && stratagem.detachmentId) {
      const stratagemFaction = dump.factionKeywordOfDetachment(stratagem.detachmentId);
      if (stratagemFaction && stratagemFaction !== expectedFaction) continue;
    }
    const en = stratagem.localisations.en ?? stratagem.localisations["en-US"]
      ?? Object.values(stratagem.localisations)[0];
    if (!en) continue;
    const fields = [
      ["when", "When", en.whenRules],
      ["target", "Target", en.targetRules],
      ["effect", "Effect", en.effectRules],
      ["restriction", "Restriction", en.restrictionRules],
      ["secondary-effect", "Secondary effect", en.secondaryEffect],
    ] as const;
    return {
      container_type: "stratagem",
      components: fields
        .filter(([, , text]) => plain(text) !== null)
        .map(([key, heading, text], position) => ({
          id: `${stratagem.id}:${key}`,
          position,
          type: key,
          heading,
          text: plain(text) ?? "",
        })),
    };
  }

  for (const datasheetAbility of dump.table("datasheet_ability")) {
    if (!usesDatasheetHierarchy) continue;
    const name = dump.enName(datasheetAbility);
    if (!name || !slugCandidates(name, undefined).some((id) => ids.has(id))) continue;
    if (linkedDatasheetAbilityIds.size && !linkedDatasheetAbilityIds.has(datasheetAbility.id)) continue;
    const en = datasheetAbility.localisations.en ?? datasheetAbility.localisations["en-US"]
      ?? Object.values(datasheetAbility.localisations)[0];
    if (!en) continue;
    return {
      container_type: "datasheet-ability",
      components: [{
        id: datasheetAbility.id,
        position: 0,
        type: datasheetAbility.abilityType,
        heading: plain(en.subAbilityHeader),
        text: plain(en.rules) ?? "",
      }],
    };
  }

  const componentGroups = [
    { table: "detachment_rule" as const, relation: "detachmentRuleId" as const, abilityType: "detachment" },
    { table: "army_rule" as const, relation: "armyRuleId" as const, abilityType: "faction" },
  ];
  for (const group of componentGroups) {
    // Only the matching ability type may resolve through this table, so a unit
    // or stratagem ability that shares a name cannot borrow a rule body.
    if (String(ability.ability_type) !== group.abilityType) continue;
    for (const rule of dump.table(group.table)) {
      const ruleName = dump.enName(rule);
      if (!ruleName) continue;
      const ruleDetachment = "detachmentId" in rule && typeof rule.detachmentId === "string"
        ? dump.byId("detachment").get(rule.detachmentId)
        : undefined;
      if (!slugCandidates(ruleName, dump.enName(ruleDetachment)).some((id) => ids.has(id))) continue;
      // Same rule name recurs across detachments ("Try Dat Button!" is both a
      // Taktikal Brigade and a Dread Mob rule), so the detachment must agree.
      if (detachment && ruleDetachment && ruleDetachment.id !== detachment.id) continue;
      if (expectedFaction && ruleDetachment) {
        const ruleFaction = dump.factionKeywordOfDetachment(ruleDetachment.id);
        if (ruleFaction && ruleFaction !== expectedFaction) continue;
      }
      const components = [...dump.groupBy("rule_container_component", group.relation).get(rule.id) ?? []]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((component) => {
          const rendered = componentText(component);
          return {
            id: component.id,
            position: component.displayOrder,
            type: component.type ?? null,
            heading: rendered.heading,
            text: rendered.text,
          };
        })
        .filter((component) => !component.type?.toLowerCase().includes("lore"))
        .filter((component) => component.heading || component.text);
      return { container_type: group.table.replace("_rule", "-rule"), components };
    }
  }
  return { container_type: null, components: [] };
}

const CORE_DATA = join(REPO, "data", "core");

/**
 * Every keyword the dataset uses, read once from the faction unit files.
 *
 * A hard-coded seven-keyword list was the only source of `keyword_*` questions,
 * so a keyword gate the source states in a keyword outside that list was never
 * asked about and could never be constructed. The unit files carry the real
 * vocabulary (985 keywords), which is the same list a reader of the datasheet
 * would recognise.
 */
let keywordCatalogCache: readonly string[] | null = null;

function keywordCatalog(): readonly string[] {
  if (keywordCatalogCache) return keywordCatalogCache;
  const keywords = new Set<string>();
  for (const entry of readdirSync(CORE_DATA, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const unitsPath = join(CORE_DATA, entry.name, "units.json");
    if (!existsSync(unitsPath)) continue;
    for (const unit of readJson<AnyRecord[]>(unitsPath)) {
      for (const field of ["keywords", "faction_keywords"]) {
        for (const keyword of (unit[field] as unknown[] | undefined) ?? []) {
          if (typeof keyword === "string" && keyword.trim()) keywords.add(keyword.trim().toUpperCase());
        }
      }
    }
  }
  keywordCatalogCache = [...keywords].sort((left, right) => right.length - left.length);
  return keywordCatalogCache;
}

/** Compile the catalog into one alternation, longest first so a compound
 *  keyword wins over its own prefix (`Epic Hero` before `Hero`). */
function keywordMatcher(): RegExp {
  const alternatives = keywordCatalog().map((keyword) => keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\w'])(?:${alternatives.join("|")})(?![\\w'])`, "gi");
}

function literals(source: string): AbilityState["literal_candidates"] {
  const integers = [...new Set([...source.matchAll(/\b\d+\b/g)].map((match) => Number(match[0])))].sort((a, b) => a - b);
  const dice = [...new Set([...source.matchAll(/\b(?:\d+)?D\d+\b/gi)].map((match) => match[0].toUpperCase()))];
  const distances = [...new Set([...source.matchAll(/\b(\d+)\s*(?:"|inches?)/gi)].map((match) => Number(match[1])))].sort((a, b) => a - b);
  const named = new Set<string>();
  for (const match of source.matchAll(keywordMatcher())) named.add(match[0].toUpperCase());
  return {
    integers,
    dice,
    distances_inches: distances,
    named_keywords: [...named].sort(),
  };
}

export function buildCohortStates(options: {
  dumpPath?: string;
  corpusPath?: string;
  abilitiesPath?: string;
  abilityIds?: readonly string[];
} = {}): Record<CohortAbilityId, AbilityState> {
  const dump = loadDump(options.dumpPath ?? DEFAULT_DUMP_PATH);
  const corpus = readJson<Record<string, Record<string, string>>>(options.corpusPath ?? DEFAULT_CORPUS);
  const abilities = readJson<AnyRecord[]>(options.abilitiesPath ?? ABILITIES);
  const byId = new Map(abilities.map((ability) => [String(ability.ability_id), ability]));
  const result = {} as Record<CohortAbilityId, AbilityState>;
  for (const abilityId of options.abilityIds ?? COHORT) {
    const ability = byId.get(abilityId);
    const source = corpus.orks?.[abilityId];
    if (!ability || !source) throw new Error(`Cohort source unavailable: orks/${abilityId}`);
    const hierarchy = hierarchyFor(dump, ability);
    const operativeSource = hierarchy.components.map((component) => component.text).filter(Boolean).join("\n") || source;
    result[abilityId] = {
      ability: {
        source_id: abilityId,
        name: String(ability.name),
        faction: "orks",
        kind: String(ability.ability_type ?? "unit"),
      },
      hierarchy,
      entity_context: {
        unit_ids: Array.isArray(ability.unit_ids) ? ability.unit_ids.map(String) : [],
        detachment_id: typeof ability.detachment_id === "string" ? ability.detachment_id : null,
      },
      literal_candidates: literals(operativeSource),
      source_text: operativeSource,
    };
  }
  return result;
}

const compositionCriteria = {
  leaf: "One atomic mechanic without a wrapper.",
  conditional: "One effect applies only when a condition is true.",
  sequence: "Two or more effects all resolve.",
  choice: "A player deliberately selects exactly one effect from a menu.",
  "dice-table": "A die result selects an outcome from an exhaustive table.",
  "dice-count-choice": "The player chooses how many dice to roll and the number changes the consequences.",
  selection: "The rule selects another unit or model before resolving an effect.",
  other: "The structure does not fit any listed composition.",
} as const;

const primaryEffectCriteria = {
  "roll-modifier": "Add to or subtract from a roll.",
  "stat-modifier": "Change a characteristic or weapon statistic.",
  "keyword-grant": "Give attacks, weapons, or a unit a keyword.",
  "ability-grant": "Grant a named permission, mode, or ability.",
  "hazard-rolls": "Require one or more hazard rolls.",
  "mortal-wounds": "Inflict mortal wounds directly.",
  restriction: "Prevent or require an action.",
  other: "None of the listed leaf families is the primary effect.",
} as const;

export function broadQuestions(): Questions {
  return {
    composition: choice(
      { task: "Classify the top-level mechanical composition of this rule.", ignore: "Flavor or lore text." },
      compositionCriteria,
    ),
    primary_effect: choice("Which leaf family best describes the rule's primary mechanical effect?", primaryEffectCriteria),
    has_trigger: noul("Does the rule activate in response to a stated event or timing window?"),
    has_condition: noul("Does any operative effect depend on a condition, restriction, or eligibility test?"),
    has_multiple_effects: noul("Does the rule contain two or more mechanical effects that can all resolve?"),
    has_random_resolution: noul("Does a die roll determine which effect occurs?"),
    has_deliberate_choice: noul("Does a player deliberately choose between mechanical options?"),
    has_target_selection: noul("Does the rule select a unit or model as a target before applying its effect?"),
    has_usage_limit: noul("Does the rule state a per-phase, per-turn, per-round, per-battle, or other usage limit?"),
    has_keyword_eligibility: noul("Does the rule restrict an actor or target using one or more keywords?"),
    likely_ontology_gap: noul({
      task: "Would faithfully representing this rule require a semantic mechanic outside the listed composition and leaf families?",
      true: "A materially different mechanic is present.",
      false: "The listed families can represent the rule by composition and parameters.",
    }),
  };
}

function specificQuestions(abilityId: CohortAbilityId): Questions {
  switch (abilityId) {
    case "waaagh-banner":
      return {
        roll_kind: choice("Which roll is modified?", { charge: null, hit: null, wound: null, save: null, other: null }),
        operation: choice("How is that roll changed?", { add: null, subtract: null, reroll: null, other: null }),
        value_is_one: noul("Is the numeric modifier exactly 1?"),
        affects_unit: noul("Does the modifier apply to this unit rather than only the bearer model?"),
      };
    case "try-dat-button-dread-mob":
      return {
        has_one_or_two_dice_choice: noul("Can the player choose to roll either one D6 or two D6?"),
        duplicate_results_rerolled: noul("When two dice are rolled, must duplicate results be re-rolled?"),
        low_result_adds_attacks: noul("Does the lowest result band add 1 to Attacks?"),
        middle_result_adds_strength: noul("Does the middle result band add 2 to Strength?"),
        high_result_adds_ap: noul("Does the highest result band improve or add 1 to AP?"),
        two_dice_causes_hazard: noul("Does choosing two dice cause one hazard roll after the unit attacks?"),
        applies_in_shooting_or_fight: noul("Can the rule be used in either the Shooting phase or the Fight phase?"),
        walker_non_titanic_eligibility: noul("Is the eligible unit a friendly ORKS WALKER that must not be TITANIC?"),
      };
    case "bomb-squig":
      return {
        activates_after_normal_move: noul("Does the rule activate in your Movement phase after this unit ends a Normal move?"),
        selects_one_visible_enemy_within_twelve: noul("Does the rule select exactly one visible enemy unit within 12 inches?"),
        succeeds_on_three_plus: noul("Does the D6 test succeed on a 3+?"),
        deals_d3_mortal_wounds: noul("Does a successful test deal D3 mortal wounds to the selected enemy?"),
        consumes_bomb_squig_token: noul("Is one Bomb Squig token consumed after this ability is used?"),
      };
    case "where-dya-fink-youre-going-da-big-hunt":
      return {
        fallback_trigger: noul("Does the rule trigger when an enemy unit is selected to make a Fall Back move?"),
        requires_beast_snagga_engagement: noul("Must that enemy be engaged with a friendly BEAST SNAGGA unit?"),
        forces_desperate_escape: noul("Must the enemy use the Desperate Escape mode?"),
        monster_vehicle_gate: noul("Are additional hazard rolls limited to an enemy MONSTER or VEHICLE?"),
        three_per_engaged_unit: noul("Are three additional hazard rolls made for each engaged BEAST SNAGGA unit?"),
        battleshock_subtracts_one: noul("Is 1 subtracted from those hazard rolls if the enemy is Battle-shocked?"),
        opponent_movement_phase: noul("Is the activation window the opponent's Movement phase?"),
      };
    case "competitive-streak-kult-of-speed":
      return {
        eligibility_is_named_model: noul("Is this enhancement restricted to one specifically named model rather than a keyword class?"),
        eligible_model_is_deffkilla_wartrike: noul("Is the only eligible bearer model a Deffkilla Wartrike?"),
        effect_sentence_subject_is_this_unit: noul("Does the operative sentence literally make 'This unit' the subject of the Charge re-roll?"),
        effect_grants_charge_roll_reroll: noul("Does that sentence grant this unit permission to re-roll Charge rolls?"),
        effect_has_no_stated_subset_or_usage_limit: noul("Does the source state no result subset or per-battle usage limit for that re-roll?"),
        effect_has_no_trigger_or_expiry: noul("Does the source state no event trigger or expiry for the re-roll effect?"),
      };
    case "waaagh":
      return {
        advance_reroll_is_independent: noul("Is re-rolling Advance rolls an always-active rule independent of calling a Waaagh?"),
        advance_reroll_targets_friendly_orks: noul("Does that Advance re-roll apply to friendly ORKS units?"),
        shoot_permission_requires_active_waaagh: noul("Is the post-Advance shooting permission available only while the Waaagh is active?"),
        charge_permission_requires_active_waaagh: noul("Is the post-Advance Charge permission available only while the Waaagh is active?"),
        activation_is_optional: noul("May the controlling player choose whether to call the Waaagh?"),
        activation_once_per_battle: noul("Can the Waaagh be called exactly once per battle?"),
        activation_start_command_phase: noul("Is it called at the start of the controlling player's Command phase?"),
        activation_creates_named_state: noul("Does calling it create a named Waaagh-active state for eligible units?"),
        state_targets_friendly_orks: noul("Does the Waaagh-active state apply to friendly ORKS units?"),
        state_allows_shoot_after_advance: noul("While active, can an affected unit shoot in a turn in which it Advanced?"),
        state_allows_charge_after_advance: noul("While active, can an affected unit declare a Charge in a turn in which it Advanced?"),
        state_expiry_is_end_of_next_turn: noul("Does the source define the Waaagh state's expiry exactly as the end of the next turn, without assigning that turn to a named player?"),
      };
    case "enhanced-runt-maw-madcap-meks":
      return {
        selection_mandatory_when_target_exists: noul("If at least one enemy was hit by those attacks, does the rule instruct the controller to select one rather than optionally allowing selection?"),
        eligibility_is_named_model: noul("Is this enhancement restricted to one specifically named model?"),
        eligible_model_is_big_mek_shokk_attack_gun: noul("Is the eligible bearer a Big Mek with Shokk Attack Gun?"),
        trigger_after_bearer_unit_shoots: noul("Does activation occur after the bearer's unit has shot?"),
        target_must_be_hit_by_those_attacks: noul("Must the selected enemy have been hit by attacks from that exact shooting sequence?"),
        selects_exactly_one_enemy: noul("Does the rule select exactly one qualifying enemy unit?"),
        applies_named_infestation_state: noul("Does selection apply a named Infested with Snotlings state to that enemy?"),
        state_ends_start_of_your_next_turn: noul("Does the infestation end at the start of the controlling player's next turn?"),
        state_persists_on_selected_enemy: noul("Does the selected enemy remain the subject of the infestation for its full duration?"),
        infestation_penalty_is_minus_one_leadership_rolls: noul("Does an infested unit have exactly -1 to Leadership rolls?"),
      };
    case "wild-ride":
      return {
        effect_is_optional_modifier_immunity: noul("Does this rule let the controller choose to ignore modifiers rather than mandating that they be ignored?"),
        controller_may_ignore_any_subset: noul("Can the controller ignore any subset of the applicable modifiers?"),
        affects_move_characteristic: noul("Does one branch ignore modifiers to the unit's Move characteristic?"),
        affects_advance_rolls: noul("Does a separate branch ignore modifiers to Advance rolls made for the unit?"),
        move_characteristic_not_move_distance: noul("Is the Move branch specifically about the characteristic rather than one movement distance?"),
        effect_is_passive: noul("Is the permission continuously active without a trigger or usage limit?"),
        charge_rolls_explicitly_listed: noul("Does the source explicitly list Charge rolls among the modifier categories that may be ignored?"),
        permission_held_by_this_unit: noul("Is this unit the subject that may ignore each listed modifier?"),
      };
    default:
      return {};
  }
}

export function extractionQuestions(abilityId: CohortAbilityId): Questions {
  return { ...broadQuestions(), ...specificQuestions(abilityId) };
}


function slugify(value: string | number): string {
  return String(value).toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "");
}

function literalQuestionId(prefix: string, value: string | number): string {
  return `${prefix}_${slugify(value)}`;
}

export function genericDecompositionQuestions(
  state: AbilityState,
  broadAnswers: Record<string, string | number | undefined>,
): Questions {
  const questions: Questions = {
    semantic_subject: choice("Which entity is the grammatical subject of the operative effect?", {
      "this-model": null,
      "this-unit": null,
      "selected-unit": null,
      attack: null,
      "objective-marker": null,
      other: null,
    }),
    semantic_timing: choice("What explicit timing window governs the rule?", {
      passive: null,
      "phase-start": null,
      "phase-end": null,
      "selected-to-act": null,
      "after-action": null,
      "move-ended": null,
      other: null,
    }),
    semantic_duration: choice("What duration is explicitly stated for the operative effect?", {
      none: null,
      resolution: null,
      phase: null,
      turn: null,
      "until-next-turn": null,
      battle: null,
      persistent: null,
      other: null,
    }),
    semantic_structure: choice("How are the rule's operative clauses related?", {
      "single-effect": null,
      "all-effects": null,
      alternatives: null,
      conditional: null,
      "dice-result-bands": null,
      "selection-then-effect": null,
      other: null,
    }),
    turn_is_your: noul({
      task: "Does the source name the controlling player's own turn as a condition of the rule?",
      true: "The source says my turn / your turn (or names a phase in a way that only your turn satisfies) as a condition.",
      false: "The source does not name whose turn gates the rule, or it states that either player's turn satisfies it. Do not infer a turn from the phase alone.",
    }),
    turn_is_opponent: noul({
      task: "Does the source name the opposing player's turn as a condition of the rule?",
      true: "The source says the opponent's turn / their turn as a condition.",
      false: "The source does not name the opponent's turn, or it states that either player's turn satisfies it.",
    }),
    recipient: choice("Which entity does the operative effect apply to?", {
      "this-model": null,
      "this-unit": null,
      "selected-unit": null,
      "attacking-enemy": null,
      "triggering-unit": null,
      "all-friendly": null,
      "all-enemy": null,
    }),
  };

  if (broadAnswers.has_trigger === 1) {
    questions.trigger_event = choice("Which event directly triggers resolution?", {
      "phase-start": null,
      "phase-end": null,
      "selected-to-shoot": null,
      "selected-to-fight": null,
      "move-ended": null,
      "after-shot": null,
      "attack-targets": null,
      other: null,
    });
  }
  if (broadAnswers.has_condition === 1) {
    questions.condition_relation = choice("What kind of predicate gates the effect?", {
      keyword: null,
      comparison: null,
      position: null,
      engagement: null,
      leadership: null,
      target: null,
      state: null,
      other: null,
    });
  }
  if (broadAnswers.has_target_selection === 1) {
    questions.selection_owner = choice("Who owns the selected entity?", {
      friendly: null,
      enemy: null,
      either: null,
      other: null,
    });
    questions.selection_cardinality = choice("How many entities does the source instruct the controller to select?", {
      one: null,
      "up-to-one": null,
      multiple: null,
      variable: null,
      other: null,
    });
    questions.selection_reference = choice("What is the selection range or relationship measured from?", {
      model: null,
      unit: null,
      objective: null,
      engagement: null,
      none: null,
      other: null,
    });
    questions.selection_requires_visibility = noul("Does the source explicitly require the selected entity to be visible?");
  }

  switch (broadAnswers.primary_effect) {
    case "stat-modifier":
      questions.effect_stat = choice("Which characteristic is modified?", {
        M: null,
        A: null,
        S: null,
        T: null,
        Sv: null,
        W: null,
        Ld: null,
        OC: null,
        AP: null,
        D: null,
        other: null,
      });
      questions.effect_operation = choice("What operation is applied to that characteristic?", {
        add: null,
        subtract: null,
        set: null,
        other: null,
      });
      break;
    case "roll-modifier":
      questions.effect_roll = choice("Which roll is modified?", {
        hit: null,
        wound: null,
        save: null,
        charge: null,
        advance: null,
        leadership: null,
        other: null,
      });
      questions.effect_operation = choice("What operation is applied to that roll?", {
        add: null,
        subtract: null,
        reroll: null,
        "ignore-modifiers": null,
        other: null,
      });
      break;
    case "mortal-wounds":
      questions.mortal_wound_resolution = choice("How is the mortal-wound amount resolved?", {
        fixed: null,
        dice: null,
        "dice-test": null,
        "dice-result-bands": null,
        "per-success": null,
        other: null,
      });
      break;
    case "keyword-grant":
      questions.keyword_grant_subject = choice("What receives the granted keyword or weapon ability?", {
        model: null,
        unit: null,
        attacks: null,
        weapon: null,
        other: null,
      });
      break;
    case "ability-grant":
      questions.granted_permission = choice("What permission or rule is granted?", {
        movement: null,
        shooting: null,
        charge: null,
        reroll: null,
        deployment: null,
        "weapon-ability": null,
        other: null,
      });
      break;
    case "hazard-rolls":
      questions.hazard_resolution = choice("How are Hazard rolls determined?", {
        fixed: null,
        "per-weapon": null,
        "per-model": null,
        conditional: null,
        other: null,
      });
      break;
    default:
      questions.effect_family_refinement = choice("Which concrete effect best describes the operative consequence?", {
        movement: null,
        healing: null,
        "objective-control": null,
        "weapon-ability": null,
        "persistent-state": null,
        "dice-resolution": null,
        other: null,
      });
  }

  for (const value of state.literal_candidates.integers) {
    questions[literalQuestionId("integer", value)] = choice(`What semantic role does the source integer ${value} play?`, {
      "modifier-value": null,
      threshold: null,
      "result-band-boundary": null,
      count: null,
      "range-inches": null,
      duration: null,
      "keyword-value": null,
      other: null,
    });
  }
  for (const value of state.literal_candidates.dice) {
    questions[literalQuestionId("dice", value)] = choice(`What semantic role does ${value} play?`, {
      "effect-amount": null,
      "test-roll": null,
      "movement-distance": null,
      count: null,
      other: null,
    });
  }
  for (const value of state.literal_candidates.distances_inches) {
    questions[literalQuestionId("distance", value)] = choice(`What semantic role does the ${value}-inch distance play?`, {
      "selection-range": null,
      "aura-range": null,
      "movement-distance": null,
      other: null,
    });
  }
  for (const value of state.literal_candidates.named_keywords) {
    questions[literalQuestionId("keyword", value)] = choice(`What semantic role does the ${value} keyword play?`, {
      "bearer-eligibility": null,
      "subject-eligibility": null,
      "target-eligibility": null,
      "target-exclusion": null,
      "granted-effect": null,
      condition: null,
      other: null,
    });
  }

  return questions;
}
function refinementTask(questionId: string): string {
  if (questionId === "semantic_subject") {
    return "Read only the operative sentence's grammatical subject. Which listed entity is that subject?";
  }
  if (questionId === "semantic_timing") {
    return "Classify only the source's explicit activation timing. Use passive when no activation event is stated.";
  }
  if (questionId === "semantic_duration") {
    return "Classify only an explicitly stated effect lifetime. Use none when the source states no expiry.";
  }
  if (questionId === "semantic_structure") {
    return "Classify the literal relationship between operative clauses, without inferring an implementation shape.";
  }
  if (questionId === "controller_choice_present") {
    return "Does the operative source explicitly give the controller a choice using permission or alternative wording?";
  }
  if (questionId.startsWith("integer_") || questionId.startsWith("dice_") || questionId.startsWith("distance_")) {
    return "Classify only the literal's direct grammatical role in the source sentence.";
  }
  if (questionId.startsWith("keyword_")) {
    return "Classify only how this keyword restricts or grants something in the source sentence.";
  }
  return "Answer from the source's literal operative wording only; do not infer unstated game semantics.";
}

/**
 * Refinement strategy: convert a forced single-choice over N options into N
 * independent propositions.
 *
 * Re-asking the same single-choice with sharper instructions does not move
 * confidence — the failure is the question's *form*, not its wording. A forced
 * choice cannot express a rule that satisfies two options at once (a condition
 * that is both a keyword and a position test) or none of them (a slot the
 * source leaves unstated), so the model's distribution spreads across options
 * and every option lands in the ambiguous band.
 *
 * N propositions fix both: several may hold simultaneously, and all may be
 * false. The catch-all `other` option is excluded — it names an escape hatch,
 * not a testable proposition.
 */
export function genericRefinementQuestions(
  previousQuestions: Questions,
  unresolvedQuestionIds: readonly string[],
  stage: number,
): Questions {
  const refined: Questions = {};
  for (const questionId of unresolvedQuestionIds) {
    const slot = slotOf(questionId);
    const previous = previousQuestions[questionId] as unknown as AnyRecord | undefined;
    if (!previous) continue;
    if (previous.type === "choice") {
      const criteria = previous.criteria as Record<string, string | null>;
      for (const [option, guidance] of Object.entries(criteria)) {
        if (option === "other") continue;
        refined[`refine_${stage}__${slot}__${slugify(option)}`] = noul({
          task: `${refinementTask(slot)} Decide this one proposition only: ${guidance ?? `the slot's value is "${option}"`}`,
          true: `The source's operative wording directly supports "${option}" here.`,
          false: `The source does not state "${option}" here, or the wording contradicts it. Do not infer it from convention.`,
        });
      }
      continue;
    }
    refined[`refine_${stage}__${slot}__truth`] = noul({
      task: refinementTask(slot),
      true: "The proposition is explicitly supported by the source.",
      false: "The proposition is absent or contradicted by the source.",
    });
  }
  return refined;
}

/**
 * A leaf is settled when it is confidently true or confidently false. The
 * symmetric band matters for proposition form: "this option does not hold" is
 * an answer, and requiring only high probabilities would make every excluded
 * option an eternal blocker.
 */
export function leafSettled(probability: number): boolean {
  return probability >= ACCEPTANCE_CONFIDENCE || probability <= 1 - ACCEPTANCE_CONFIDENCE;
}

const DECOMPOSITION_REQUIREMENTS: Partial<Record<CohortAbilityId, readonly string[]>> = {
  "competitive-streak-kult-of-speed": [
    "eligibility_is_named_model",
    "eligible_model_is_deffkilla_wartrike",
    "effect_sentence_subject_is_this_unit",
    "effect_grants_charge_roll_reroll",
    "effect_has_no_stated_subset_or_usage_limit",
    "effect_has_no_trigger_or_expiry",
  ],
  "waaagh": [
    "advance_reroll_is_independent",
    "advance_reroll_targets_friendly_orks",
    "activation_is_optional",
    "activation_once_per_battle",
    "activation_start_command_phase",
    "activation_creates_named_state",
    "state_targets_friendly_orks",
    "state_expiry_is_end_of_next_turn",
    "state_allows_shoot_after_advance",
    "state_allows_charge_after_advance",
    "shoot_permission_requires_active_waaagh",
    "charge_permission_requires_active_waaagh",
  ],
  "enhanced-runt-maw-madcap-meks": [
    "eligibility_is_named_model",
    "eligible_model_is_big_mek_shokk_attack_gun",
    "trigger_after_bearer_unit_shoots",
    "target_must_be_hit_by_those_attacks",
    "selects_exactly_one_enemy",
    "selection_mandatory_when_target_exists",
    "applies_named_infestation_state",
    "state_ends_start_of_your_next_turn",
    "state_persists_on_selected_enemy",
    "infestation_penalty_is_minus_one_leadership_rolls",
  ],
  "wild-ride": [
    "effect_is_optional_modifier_immunity",
    "controller_may_ignore_any_subset",
    "affects_move_characteristic",
    "affects_advance_rolls",
    "charge_rolls_explicitly_listed",
    "move_characteristic_not_move_distance",
    "permission_held_by_this_unit",
    "effect_is_passive",
  ],
};

export function verificationQuestions(abilityId: CohortAbilityId): Questions {
  const common = {
    candidate_supported: noul({
      task: "Do candidate_mechanics and candidate_rendered_text preserve the source rule's gameplay behavior?",
      true: "Every operative effect, condition, timing rule, target, and quantity is equivalent. Normalized wording may make an implicit passive duration or subject explicit.",
      false: "At least one gameplay consequence is absent, wrong, or broadened.",
    }),
    preserves_effects: noul("Do the candidate representations state every operative effect the source states?"),
    preserves_conditions: noul("Do the candidate representations state every eligibility condition, restriction, and gate the source states?"),
    preserves_quantities: noul("Do the candidate representations state every numeric quantity and die expression the source states?"),
    preserves_recipients: noul("Do the candidate representations apply each effect to the same recipient the source names?"),
    missing_effect: noul("Does the source contain an operative gameplay effect absent from both candidate representations?"),
    missing_condition: noul("Does the source contain an eligibility condition or restriction absent from both candidate representations?"),
    missing_timing_or_usage: noul("Does the source contain timing or usage semantics absent from both candidate representations? Ignore an explicit battle duration for a passive datasheet rule whose source is implicitly always active."),
    introduced_mechanic: noul("Do the candidate representations introduce a gameplay consequence not present in the source? Ignore normalized phrasing and explicit passive duration or subject information that does not change gameplay."),
  };
  switch (abilityId) {
    case "waaagh-banner":
      return {
        ...common,
        preserves_charge_modifier: noul("Do the candidate representations preserve exactly a +1 modifier to Charge rolls?"),
        preserves_unit_target: noul("Do the candidate representations apply that modifier to this unit?"),
      };
    case "try-dat-button-dread-mob":
      return {
        ...common,
        preserves_attack_timing: noul("Do the candidate representations preserve use when an eligible unit is selected to attack in its Shooting phase or either Fight phase?"),
        preserves_walker_eligibility: noul("Do the candidate representations require a friendly ORKS WALKER and exclude TITANIC units?"),
        preserves_dice_count_choice: noul("Do the candidate representations preserve the choice to roll one D6 or two D6?"),
        preserves_duplicate_rerolls: noul("Do the candidate representations require duplicate results to be re-rolled when two dice are rolled?"),
        preserves_result_table: noul("Do the candidate representations preserve 1-2 as +1 Attacks, 3-4 as +2 Strength, and 5-6 as +1 AP for each retained result?"),
        preserves_two_dice_hazard: noul("Do the candidate representations preserve exactly one hazard roll after attacking when two dice were chosen?"),
      };
    case "bomb-squig":
      return {
        ...common,
        preserves_normal_move_timing: noul("Do the candidate representations preserve activation in your Movement phase after this unit ends a Normal move?"),
        preserves_visible_enemy_selection: noul("Do the candidate representations preserve selection of exactly one visible enemy unit within 12 inches?"),
        preserves_three_plus_test: noul("Do the candidate representations preserve a D6 test that succeeds on 3+?"),
        preserves_d3_mortal_wounds: noul("Do the candidate representations preserve D3 mortal wounds to the selected enemy on success?"),
        preserves_token_consumption: noul("Do the candidate representations preserve consumption of one Bomb Squig token after use?"),
      };
    case "where-dya-fink-youre-going-da-big-hunt":
      return {
        ...common,
        preserves_activation: noul("Do the candidate representations preserve activation in the opponent's Movement phase when an engaged enemy is selected to Fall Back?"),
        preserves_beast_snagga_target: noul("Do the candidate representations preserve selection of the engaged friendly BEAST SNAGGA unit?"),
        preserves_desperate_escape: noul("Do the candidate representations require the enemy to use Desperate Escape mode?"),
        preserves_monster_vehicle_gate: noul("Do the candidate representations limit additional hazard rolls to an enemy MONSTER or VEHICLE?"),
        preserves_hazard_count: noul("Do the candidate representations preserve three additional hazard rolls per engaged BEAST SNAGGA unit?"),
        preserves_battleshock_modifier: noul("Do the candidate representations subtract 1 from those rolls when the enemy is Battle-shocked?"),
      };
    default:
      return common;
  }
}

function selectedProbability(answer: AnyRecord): number {
  if (answer.type === "noul" && typeof answer.noul === "number") return Math.max(answer.noul, 1 - answer.noul);
  if (answer.type === "choice" && typeof answer.choice === "string" && answer.probabilities && typeof answer.probabilities === "object") {
    const probability = (answer.probabilities as AnyRecord)[answer.choice];
    return typeof probability === "number" ? probability : 0;
  }
  return 0;
}

export function claimsFromResponse(
  abilityId: CohortAbilityId,
  state: AbilityState,
  response: CachedResponse,
): CandidateClaim[] {
  return Object.entries(response.answers).flatMap(([questionId, rawAnswer]) => {
    if (!rawAnswer || typeof rawAnswer !== "object") return [];
    const answer = rawAnswer as AnyRecord;
    const value = answer.type === "choice"
      ? answer.choice
      : typeof answer.noul === "number"
        ? Number(answer.noul >= 0.5)
        : undefined;
    if (typeof value !== "string" && typeof value !== "number") return [];
    const probability = selectedProbability(answer);
    const claimValue = value as Json;
    return [{
      id: hash({ abilityId, questionId, claimValue, source: sourceDigest(state.source_text) }),
      ability_id: abilityId,
      question_id: questionId,
      predicate: `jev.${questionId.replaceAll("_", "-")}`,
      value: claimValue,
      probability,
      selected: true,
      source_digest: sourceDigest(state.source_text),

      state: "proposed" as const,
    }];
  });
}

function selectedAnswers(response: CachedResponse): Record<string, string | number | undefined> {
  return Object.fromEntries(Object.entries(response.answers).map(([questionId, rawAnswer]) => {
    if (!rawAnswer || typeof rawAnswer !== "object") return [questionId, undefined];
    const answer = rawAnswer as AnyRecord;
    if (answer.type === "choice") return [questionId, answer.choice as string | undefined];
    return [questionId, typeof answer.noul === "number" ? Number(answer.noul >= 0.5) : undefined];
  }));
}

/**
 * Bind a question to the gate that makes it worth asking. A gated question is
 * asked only when its gate answer is confidently true, so a wobbling `noul`
 * upstream cannot spawn downstream questions that then block closure.
 */
export function confidentAnswers(response: CachedResponse): Record<string, string | number | undefined> {
  const selected = selectedAnswers(response);
  return Object.fromEntries(
    Object.entries(response.answers)
      .filter(([, rawAnswer]) => {
        const answer = rawAnswer as AnyRecord;
        if (!answer || typeof answer !== "object") return false;
        return answer.type !== "noul"
          || (typeof answer.noul === "number" && selectedProbability(answer) >= ACCEPTANCE_CONFIDENCE);
      })
      .map(([questionId]) => [questionId, selected[questionId]]),
  );
}

const CLASSIFICATION_QUESTIONS = [
  "composition",
  "primary_effect",
  "has_trigger",
  "has_condition",
  "has_multiple_effects",
  "has_random_resolution",
  "has_deliberate_choice",
  "has_target_selection",
  "has_usage_limit",
  "has_keyword_eligibility",
  "likely_ontology_gap",
] as const;

function classifyClaims(claims: CandidateClaim[]): AnyRecord {
  const byQuestion = new Map(claims.map((claim) => [claim.question_id, claim]));
  return Object.fromEntries(CLASSIFICATION_QUESTIONS.flatMap((questionId) => {
    const claim = byQuestion.get(questionId);
    return claim ? [[questionId, { value: claim.value, probability: claim.probability }]] : [];
  }));
}

/**
 * Slots whose absence is itself a fact about the rule. For these, "every
 * positive proposition is confidently false" resolves the slot as absent
 * rather than leaving it open. Slots outside this set demand a value: no
 * settled-true proposition means the vocabulary does not cover the source,
 * which is an ontology obligation rather than a missing answer.
 */
const ABSENCE_IS_AN_ANSWER = new Set([
  "semantic_duration",
  "semantic_timing",
  "condition_relation",
  "selection_reference",
  "recipient",
]);

/** `refine_<stage>__<slot>__<slugified option>`, the refinement question id form. */
const SLOT_OF_REFINEMENT = /^refine_\d+__(.+?)__(.+)$/;

/** Map a question id to the slot it belongs to; refined propositions map back. */
export function slotOf(questionId: string): string {
  return SLOT_OF_REFINEMENT.exec(questionId)?.[1] ?? questionId;
}

export type SlotStatus = "determined" | "absent" | "open";

export type SlotEvidence = {
  slot: string;
  status: SlotStatus;
  determined: string[];
  candidates: { question_id: string; probability: number | null }[];
};

/**
 * Evaluate closure per slot rather than per question.
 *
 * Conjunctive closure over a flat question list measures the wrong thing. A
 * rule with 43 facts each 85% reliable closes ~0.1% of the time, so the gate
 * reports failure for rules the harness understands and rewards *asking fewer
 * questions* over asking better ones. What matters is whether each slot has a
 * load-bearing determination: one settled-true proposition, or a confident
 * derivation of absence. Ambiguous sibling propositions that no longer decide
 * the slot are inert, not blockers.
 */
export function slotEvidence(
  claims: CandidateClaim[],
  requiredQuestions: readonly string[],
): SlotEvidence[] {
  const byQuestion = new Map(claims.map((claim) => [claim.question_id, claim]));
  const groups = new Map<string, string[]>();
  for (const questionId of requiredQuestions) {
    const slot = slotOf(questionId);
    groups.set(slot, [...(groups.get(slot) ?? []), questionId]);
  }
  return [...groups].map(([slot, questionIds]) => {
    const candidates = questionIds.map((questionId) => ({
      question_id: questionId,
      probability: byQuestion.get(questionId)?.probability ?? null,
    }));
    const determined = candidates
      .filter((candidate) => candidate.probability !== null && candidate.probability >= ACCEPTANCE_CONFIDENCE)
      .map((candidate) => candidate.question_id);
    if (determined.length > 0) return { slot, status: "determined" as const, determined, candidates };
    if (candidates.length === 1) {
      const only = candidates[0];
      const settled = only.probability !== null && leafSettled(only.probability);
      return {
        slot,
        status: settled ? ("determined" as const) : ("open" as const),
        determined: settled ? [only.question_id] : [],
        candidates,
      };
    }
    const allSettled = candidates.every(
      (candidate) => candidate.probability !== null && leafSettled(candidate.probability),
    );
    const absent = allSettled && ABSENCE_IS_AN_ANSWER.has(slot);
    return {
      slot,
      status: absent ? ("absent" as const) : ("open" as const),
      determined: [],
      candidates,
    };
  });
}

export function openSlots(
  claims: CandidateClaim[],
  requiredQuestions: readonly string[],
): string[] {
  return slotEvidence(claims, requiredQuestions)
    .filter((evidence) => evidence.status === "open")
    .map((evidence) => evidence.slot);
}

/**
 * Fields computed from determinations rather than asked directly.
 *
 * A question whose answer is a function of other settled facts must not be
 * asked: the model has no independent signal for it, so it splits down the
 * middle, and an ambiguous conjunction-free proposition becomes the sole
 * blocker for a rule the harness otherwise understands completely. Deriving
 * also removes a whole class of negation-flavored questions ("does the source
 * *not* offer a choice?") whose true answer is the absence of a feature.
 */
export function derivedFields(
  determined: readonly { slot: string; option: string }[],
): AnyRecord {
  const structure = new Set(
    determined
      .filter((entry) => entry.slot === "semantic_structure")
      .map((entry) => slugify(entry.option)),
  );
  const impliesChoice = ["alternatives"].some((option) => structure.has(slugify(option)));
  const impliesNoChoice = ["single-effect", "all-effects", "conditional", "dice-result-bands"]
    .some((option) => structure.has(slugify(option)));
  return {
    controller_choice_present: impliesChoice && !impliesNoChoice
      ? true
      : impliesNoChoice && !impliesChoice
        ? false
        : null,
  };
}

export function decompositionEvidence(
  abilityId: CohortAbilityId,
  claims: CandidateClaim[],
  requiredQuestions?: readonly string[],
): AnyRecord | null {
  const required = requiredQuestions ?? DECOMPOSITION_REQUIREMENTS[abilityId];
  if (!required) return null;
  const byQuestionId = new Map(claims.map((claim) => [claim.question_id, claim]));
  const slots = slotEvidence(claims, required);
  const open = slots.filter((slot) => slot.status === "open");
  const determined = slots.flatMap((slot) => slot.determined.map((questionId) => ({
    slot: slot.slot,
    option: questionId.includes("__")
      ? questionId.split("__").at(-1)!
      : slugify(String(byQuestionId.get(questionId)?.value ?? "")),
  })));
  return {
    status: open.length === 0 ? "closed" : "open",
    required_leaves: required.length,
    slots: slots.length,
    unresolved_slots: open.map((slot) => slot.slot),
    derived: derivedFields(determined),
    // Retained for continuity with earlier rounds: a flat view of every
    // still-ambiguous proposition, load-bearing or not.
    unresolved: slots
      .flatMap((slot) => slot.candidates)
      .filter((candidate) => candidate.probability === null || !leafSettled(candidate.probability))
      .map((candidate) => candidate.question_id),
    evidence: slots,
  };
}

function answerMap(claims: CandidateClaim[]): Map<string, Json> {
  return new Map(claims.map((claim) => [claim.question_id, claim.value]));
}

function requirements(
  claims: CandidateClaim[],
  expected: Record<string, Json>,
): { consumed: string[]; findings: string[] } {
  const values = answerMap(claims);
  const consumed: string[] = [];
  const findings: string[] = [];
  for (const [questionId, expectedValue] of Object.entries(expected)) {
    const actual = values.get(questionId);
    if (actual !== expectedValue) findings.push(`${questionId}: expected ${String(expectedValue)}, received ${String(actual)}`);
    else {
      const claim = claims.find((candidate) => candidate.question_id === questionId);
      if (claim) consumed.push(claim.id);
    }
  }
  return { consumed, findings };
}

function baseAbility(current: AnyRecord, effect: AnyRecord, extra: AnyRecord = {}): AnyRecord {
  const candidate = structuredClone(current);
  candidate.effect = effect;
  Object.assign(candidate, extra);
  delete candidate.community_notes;
  return candidate;
}

function constructWaaaghBanner(current: AnyRecord, claims: CandidateClaim[]): ConstructionResult {
  const gate = requirements(claims, {
    composition: "leaf",
    primary_effect: "roll-modifier",
    roll_kind: "charge",
    operation: "add",
    value_is_one: 1,
    affects_unit: 1,
  });
  if (gate.findings.length) return incomplete(claims, gate);
  return constructed(claims, gate.consumed, baseAbility(current, {
    type: "roll-modifier",
    target: "unit",
    modifier: { roll: "charge", operation: "add", value: 1 },
  }));
}

function randomButtonResult(): AnyRecord {
  return {
    type: "dice-table",
    dice: "D6",
    outcomes: [
      {
        results: [1, 2],
        effect: { type: "stat-modifier", target: "unit", modifier: { stat: "A", operation: "add", value: 1 } },
      },
      {
        results: [3, 4],
        effect: { type: "stat-modifier", target: "unit", modifier: { stat: "S", operation: "add", value: 2 } },
      },
      {
        results: [5, 6],
        effect: { type: "stat-modifier", target: "unit", modifier: { stat: "AP", operation: "add", value: 1 } },
      },
    ],
  };
}

function constructBombSquig(current: AnyRecord, claims: CandidateClaim[]): ConstructionResult {
  const gate = requirements(claims, {
    activates_after_normal_move: 1,
    selects_one_visible_enemy_within_twelve: 1,
    succeeds_on_three_plus: 1,
    deals_d3_mortal_wounds: 1,
    consumes_bomb_squig_token: 1,
  });
  if (gate.findings.length) return incomplete(claims, gate);
  const effect = {
    type: "conditional",
    condition: {
      operator: "and",
      operands: [
        { type: "player-turn-is", parameters: { turn: "your" } },
        { type: "phase-is", parameters: { phase: "movement" } },
        { type: "timing-is", parameters: { timing: "end-of-normal-move" } },
      ],
    },
    effect: {
      type: "sequence",
      steps: [
        {
          type: "select-units",
          selector: {
            owner: "enemy",
            target_kind: "unit",
            count: 1,
            range_inches: 12,
            visibility_required: true,
            reference: "bearer-unit",
          },
          effect: {
            type: "dice-gated",
            dice: "D6",
            threshold: 3,
            comparison: "gte",
            on_success: {
              type: "mortal-wounds",
              target: "unit",
              modifier: { count: "D3" },
            },
          },
        },
        {
          type: "resource-spend",
          target: "unit",
          modifier: { resource: "bomb-squig-token", amount: 1 },
        },
      ],
    },
  };
  return constructed(claims, gate.consumed, baseAbility(current, effect, {
    scope: { range: "aura-12", duration: "resolution" },
  }));
}

function constructTryDatButton(current: AnyRecord, claims: CandidateClaim[]): ConstructionResult {
  const gate = requirements(claims, {
    composition: "dice-count-choice",
    has_random_resolution: 1,
    has_deliberate_choice: 1,
    has_one_or_two_dice_choice: 1,
    duplicate_results_rerolled: 1,
    low_result_adds_attacks: 1,
    middle_result_adds_strength: 1,
    high_result_adds_ap: 1,
    two_dice_causes_hazard: 1,
    applies_in_shooting_or_fight: 1,
    walker_non_titanic_eligibility: 1,
  });
  if (gate.findings.length) return incomplete(claims, gate);
  const condition = {
    operator: "and",
    operands: [

      {
        operator: "or",
        operands: [
          { operator: "and", operands: [
            { type: "player-turn-is", parameters: { turn: "your" } },
            { type: "phase-is", parameters: { phase: "shooting" } },
          ] },
          { type: "phase-is", parameters: { phase: "fight" } },
        ],
      },
      { type: "timing-is", parameters: { timing: "selected-to-attack" } },
      { type: "disposition-matches", parameters: { disposition: "friendly" } },
      { type: "unit-has-keyword", parameters: { keyword: "ORKS" } },
      { type: "unit-has-keyword", parameters: { keyword: "WALKER" } },
      { operator: "not", operands: [{ type: "unit-has-keyword", parameters: { keyword: "TITANIC" } }] },
    ],
  };
  const effect = {
    type: "conditional",
    condition,
    effect: {
      type: "choice",
      choice_label: "dice-count",
      options: [
        randomButtonResult(),
        {
          type: "sequence",
          steps: [
            { type: "ability-grant", target: "unit", modifier: { grant_type: "reroll-duplicate-random-results" } },
            randomButtonResult(),
            randomButtonResult(),
            {
              type: "conditional",
              condition: { type: "timing-is", parameters: { timing: "after-unit-has-attacked" } },
              effect: { type: "ability-grant", target: "unit", modifier: { grant_type: "make-one-hazard-roll" } },
            },
          ],
        },
      ],
    },
  };
  return constructed(claims, gate.consumed, baseAbility(current, effect, {
    scope: { range: "any-on-battlefield", duration: "phase" },
  }));
}

function constructFallbackHazard(current: AnyRecord, claims: CandidateClaim[]): ConstructionResult {
  const gate = requirements(claims, {
    has_multiple_effects: 1,
    fallback_trigger: 1,
    requires_beast_snagga_engagement: 1,
    forces_desperate_escape: 1,
    monster_vehicle_gate: 1,
    three_per_engaged_unit: 1,
    battleshock_subtracts_one: 1,
    opponent_movement_phase: 1,
  });
  if (gate.findings.length) return incomplete(claims, gate);
  const effect = {
    type: "sequence",
    steps: [
      { type: "ability-grant", target: "defender", modifier: { grant_type: "desperate-escape", enabled: true } },
      {
        type: "conditional",
        condition: {
          operator: "or",
          operands: [
            { type: "target-has-keyword", parameters: { keyword: "MONSTER" } },
            { type: "target-has-keyword", parameters: { keyword: "VEHICLE" } },
          ],
        },
        effect: {
          type: "hazard-rolls",
          target: "defender",
          modifier: {
            engaged_keyword: "BEAST SNAGGA",
            additional_per_engaged_unit: 3,
            roll_modifier_if_battle_shocked: -1,
          },
        },
      },
    ],
  };
  return constructed(claims, gate.consumed, baseAbility(current, effect, {
    trigger: {
      event: "fall-back-move",
      subject: "enemy-unit",
      condition: {
        operator: "and",
        operands: [
          { type: "player-turn-is", parameters: { turn: "opponent" } },
          { type: "phase-is", parameters: { phase: "movement" } },
          { type: "engagement-state", parameters: { state: "engaged-with-friendly-beast-snagga" } },
        ],
      },
    },
    applies_to: { required_keywords: ["BEAST SNAGGA"] },
    scope: { range: "engagement-range", duration: "resolution" },
  }));
}

/* ==========================================================================
 * Family registry
 * ==========================================================================
 *
 * Construction used to dispatch on ability id, so only the four abilities a
 * human had written a constructor for could be constructed at all; the other
 * 241 reported one aggregate `unsupported family` string and nothing else.
 * This registry dispatches on the pair the classifier already emits —
 * (composition, primary_effect) — and every constructor reads the same
 * decomposition slots, so a family is covered once rather than per ability.
 *
 * Two rules keep a family constructor honest:
 *
 *   1. It authors only what a settled slot determines. An undetermined slot is
 *      reported, never defaulted — a guessed recipient is precisely the
 *      `wrong-recipient` defect the round trip exists to catch.
 *   2. Every claim it evaluated is either consumed (its slot decided the
 *      output) or left in `unconsumed_claim_ids` beside a finding naming the
 *      slot that blocked it, so an incomplete candidate is a worklist item
 *      instead of an opaque failure.
 */

/**
 * Option names whose refinement slug is lossy because `slugify` lowercases
 * them. Every other option survives the round trip through `_` -> `-`.
 */
const SLOT_OPTION_VOCABULARY: Record<string, readonly string[]> = {
  effect_stat: ["M", "A", "S", "T", "Sv", "W", "Ld", "OC", "AP", "D"],
};

function optionFromSlug(slot: string, slug: string): string {
  if (slug === "truth") return "true";
  const canonical = SLOT_OPTION_VOCABULARY[slot]?.find((option) => slugify(option) === slug);
  return canonical ?? slug.replaceAll("_", "-");
}

export type SlotReading = {
  slot: string;
  /** Settled options. Several may hold at once; that is what refinement buys. */
  options: string[];
  /** Every claim evaluated for this slot, relied on or not. */
  claim_ids: string[];
  evidence: "refined" | "direct" | "selected" | "undetermined";
  /** Support behind the reading, so a thin one can be reported. */
  probability: number | null;
  /** Proposition slots answer true or false; not-settled-true is a value
   *  ("the rule does not say this"), not a missing answer. */
  proposition: boolean;
};

/**
 * Below a coin flip there is no leading candidate to fall back to, and the slot
 * is reported as undetermined rather than answered by noise.
 */
const SELECTION_FLOOR = 0.5;

/**
 * Read each decomposition slot's settled value.
 *
 * A refined slot is read from its propositions, because a forced choice cannot
 * express a value that satisfies two options at once (design law 2). A slot
 * that was never refined is read from its own answer.
 *
 * When no proposition clears the threshold the slot still has a leading option —
 * the negatives settle while the affirmative sits in the ambiguous band, which
 * is the ordinary outcome for a slot whose options co-occur in one clause
 * (design law 5). That option is carried with its probability and marked
 * `selected`, so a constructor reads the selection rather than the threshold and
 * reports how thin the support was. A slot whose best option cannot reach the
 * floor stays `undetermined`: absent evidence is not evidence.
 */
export function readSlots(
  claims: readonly CandidateClaim[],
  threshold: number = ACCEPTANCE_CONFIDENCE,
): Map<string, SlotReading> {
  const direct = new Map<string, CandidateClaim>();
  for (const claim of claims) {
    if (!SLOT_OF_REFINEMENT.test(claim.question_id)) direct.set(claim.question_id, claim);
  }

  const readings = new Map<string, SlotReading>();
  const affirmative = new Map<string, { option: string; probability: number }[]>();
  for (const claim of claims) {
    const match = SLOT_OF_REFINEMENT.exec(claim.question_id);
    if (!match) continue;
    const slot = match[1];
    const reading = readings.get(slot)
      ?? { slot, options: [], claim_ids: [], evidence: "refined" as const, probability: null, proposition: false };
    reading.claim_ids.push(claim.id);
    if (claim.value === 1) {
      const option = optionFromSlug(slot, match[2]);
      affirmative.set(slot, [...(affirmative.get(slot) ?? []), { option, probability: claim.probability }]);
      if (claim.probability >= threshold) {
        reading.options.push(option);
        reading.probability = claim.probability;
      }
    }
    readings.set(slot, reading);
  }

  for (const [slot, claim] of direct) {
    const refined = readings.get(slot);
    if (refined) {
      refined.claim_ids.push(claim.id);
      continue;
    }
    if (typeof claim.value === "number") {
      // Proposition slots: only a settled true contributes a value. A settled
      // false is the answer "this does not hold", which is absence rather than
      // a value to read.
      const settledTrue = claim.probability >= threshold && claim.value === 1;
      readings.set(slot, {
        slot,
        options: settledTrue ? ["true"] : [],
        claim_ids: [claim.id],
        evidence: claim.probability >= threshold ? "direct" : "undetermined",
        probability: claim.probability,
        proposition: true,
      });
      continue;
    }
    if (typeof claim.value !== "string") continue;
    const supported = claim.probability >= SELECTION_FLOOR;
    readings.set(slot, {
      slot,
      options: supported ? [claim.value] : [],
      claim_ids: [claim.id],
      evidence: claim.probability >= threshold ? "direct" : supported ? "selected" : "undetermined",
      probability: claim.probability,
      proposition: false,
    });
  }

  for (const [slot, reading] of readings) {
    if (reading.options.length > 0) continue;
    const base = direct.get(slot);
    const candidates = [
      ...(affirmative.get(slot) ?? []),
      ...(base && typeof base.value === "string"
        ? [{ option: base.value, probability: base.probability }]
        : []),
    ];
    const best = candidates.reduce<{ option: string; probability: number } | null>(
      (leader, candidate) => (!leader || candidate.probability > leader.probability ? candidate : leader),
      null,
    );
    if (best && best.probability >= SELECTION_FLOOR) {
      reading.options = [best.option];
      reading.evidence = "selected";
      reading.probability = best.probability;
    } else if (reading.evidence === "refined") {
      reading.evidence = "undetermined";
    }
  }
  return readings;
}

/** Findings for slots answered from a leading option rather than a settled one. */
function fallbackFindings(
  readings: Map<string, SlotReading>,
  slots: readonly string[],
): string[] {
  return [...new Set(slots)]
    .filter((slot) => readings.get(slot)?.evidence === "selected")
    .map((slot) => {
      const reading = readings.get(slot)!;
      return `${slot}: nothing settled; used the leading option `
        + `${reading.options[0]} (${(reading.probability ?? 0).toFixed(2)})`;
    });
}

function slotOptions(readings: Map<string, SlotReading>, slot: string): string[] {
  return readings.get(slot)?.options ?? [];
}

function slotClaims(readings: Map<string, SlotReading>, slots: readonly string[]): string[] {
  return [...new Set(slots.flatMap((slot) => readings.get(slot)?.claim_ids ?? []))];
}

/** One finding per slot that was asked and produced nothing, so an incomplete
 *  candidate names every question a human has to answer rather than one
 *  aggregate string. A slot the packet never asked (because its gate answer was
 *  confidently false) is silent: it is not a question waiting to be answered. */
function blockingFindings(
  readings: Map<string, SlotReading>,
  slots: readonly string[],
): string[] {
  return slots
    .filter((slot) => readings.has(slot))
    .filter((slot) => slotOptions(readings, slot).length === 0)
    // A proposition that is not settled true is the answer "the rule does not
    // state this", so it too is not a question waiting to be answered.
    .filter((slot) => !readings.get(slot)?.proposition)
    .map((slot) => `${slot}: no settled option (${readings.get(slot)?.evidence ?? "not asked"})`);
}

type LiteralReading = {
  value: string | number;
  question_id: string;
  options: string[];
  claim_ids: string[];
};

/**
 * Literal-role slots (`integer_4`, `distance_8`, `keyword_ORKS`, ...) are named
 * after the value they ask about, so the question id is recomputed from the
 * state rather than parsed back out of the slug.
 */
function literalReadings(
  readings: Map<string, SlotReading>,
  state: AbilityState | null,
  kind: "integer" | "dice" | "distance" | "keyword",
): LiteralReading[] {
  if (!state) return [];
  const values: (string | number)[] =
    kind === "integer" ? state.literal_candidates.integers
      : kind === "dice" ? state.literal_candidates.dice
        : kind === "distance" ? state.literal_candidates.distances_inches
          : state.literal_candidates.named_keywords;
  return values.map((value) => {
    const questionId = literalQuestionId(kind, value);
    const reading = readings.get(questionId);
    return {
      value,
      question_id: questionId,
      options: reading?.options ?? [],
      claim_ids: reading?.claim_ids ?? [],
    };
  });
}

/**
 * Slot option -> condition operand. Every entry is the source-literal reading
 * of one slot option; nothing here infers a gate the slot did not report.
 */
const TRIGGER_OPERAND: Record<string, () => AnyRecord> = {
  "selected-to-shoot": () => ({ type: "phase-is", parameters: { phase: "shooting" } }),
  "selected-to-fight": () => ({ type: "phase-is", parameters: { phase: "fight" } }),
  "phase-start": () => ({ type: "timing-is", parameters: { timing: "start-of-phase" } }),
  "phase-end": () => ({ type: "timing-is", parameters: { timing: "end-of-phase" } }),
  "move-ended": () => ({ type: "timing-is", parameters: { timing: "end-of-normal-move" } }),
};

const SEMANTIC_TIMING_OPERAND: Record<string, () => AnyRecord> = {
  "phase-start": () => ({ type: "timing-is", parameters: { timing: "start-of-phase" } }),
  "phase-end": () => ({ type: "timing-is", parameters: { timing: "end-of-phase" } }),
  "move-ended": () => ({ type: "timing-is", parameters: { timing: "end-of-normal-move" } }),
};

const TURN_OPERANDS: Record<string, () => AnyRecord> = {
  turn_is_your: () => ({ type: "player-turn-is", parameters: { turn: "your" } }),
  turn_is_opponent: () => ({ type: "player-turn-is", parameters: { turn: "opponent" } }),
};

const KEYWORD_OPERAND: Record<string, (keyword: string) => AnyRecord> = {
  "bearer-eligibility": (keyword) => ({ type: "unit-has-keyword", parameters: { keyword } }),
  "subject-eligibility": (keyword) => ({ type: "unit-has-keyword", parameters: { keyword } }),
  condition: (keyword) => ({ type: "unit-has-keyword", parameters: { keyword } }),
  "target-eligibility": (keyword) => ({ type: "target-has-keyword", parameters: { keyword } }),
  "target-exclusion": (keyword) => ({
    operator: "not",
    operands: [{ type: "target-has-keyword", parameters: { keyword } }],
  }),
};

/** Slots the condition compiler reads. A family whose source gates on one of
 *  these and reports nothing has an extraction gap, not an ontology gap. */
const CONDITION_SLOTS = [
  "trigger_event",
  "semantic_timing",
  "turn_is_your",
  "turn_is_opponent",
  "condition_relation",
] as const;

type ConditionCompilation = {
  condition: AnyRecord | null;
  claim_ids: string[];
  findings: string[];
};

function compileCondition(
  readings: Map<string, SlotReading>,
  state: AbilityState | null,
): ConditionCompilation {
  const operands: AnyRecord[] = [];
  const used: string[] = [];
  const seen = new Set<string>();
  const add = (node: AnyRecord | null, slot: string): void => {
    if (!node) return;
    const key = canonical(node);
    if (seen.has(key)) return;
    seen.add(key);
    operands.push(node);
    used.push(slot);
  };

  for (const option of slotOptions(readings, "trigger_event")) {
    add(TRIGGER_OPERAND[option]?.() ?? null, "trigger_event");
  }
  for (const option of slotOptions(readings, "semantic_timing")) {
    add(SEMANTIC_TIMING_OPERAND[option]?.() ?? null, "semantic_timing");
  }
  for (const [slot, build] of Object.entries(TURN_OPERANDS)) {
    if (slotOptions(readings, slot).includes("true")) add(build(), slot);
  }
  for (const literal of literalReadings(readings, state, "keyword")) {
    for (const option of literal.options) {
      add(KEYWORD_OPERAND[option]?.(String(literal.value)) ?? null, literal.question_id);
    }
  }
  for (const literal of literalReadings(readings, state, "distance")) {
    if (!literal.options.includes("selection-range")) continue;
    add({ type: "unit-within-range-of", parameters: { range: literal.value } }, literal.question_id);
  }

  const condition = operands.length === 0
    ? null
    : operands.length === 1 ? operands[0] : { operator: "and", operands };
  return {
    condition,
    claim_ids: slotClaims(readings, [...new Set(used)]),
    findings: [...fallbackFindings(readings, used), ...blockingFindings(readings, CONDITION_SLOTS)],
  };
}

/** `recipient` option -> effect target. The names are the describer's subjects:
 *  `self` is the bearer model, `unit` its unit, `target` the enemy it acts on. */
const RECIPIENT_TARGET: Record<string, string> = {
  "this-model": "self",
  "this-unit": "unit",
  "attacking-enemy": "target",
  "triggering-unit": "triggering-unit",
  "all-friendly": "all-friendly",
  "all-enemy": "all-enemy",
};

type RecipientReading = {
  target: string | null;
  claim_ids: string[];
  finding: string | null;
};

/** The slot a composition reads its recipient from, for fallback reporting. */
function recipientSlots(context: LeafContext): string[] {
  return context.composition === "selection" ? ["selection_owner"] : ["recipient"];
}

/**
 * The effect's recipient. Inside a `selection` composition the selected unit is
 * the recipient, so the side of the selection decides it and `recipient` is not
 * consulted; everywhere else the `recipient` slot does.
 */
function recipientTarget(
  readings: Map<string, SlotReading>,
  composition: string | null,
): RecipientReading {
  const owner = slotOptions(readings, "selection_owner")[0];
  if (composition === "selection" && owner) {
    return {
      target: owner === "enemy" ? "defender" : "unit",
      claim_ids: slotClaims(readings, ["selection_owner"]),
      finding: null,
    };
  }
  const recipient = slotOptions(readings, "recipient")[0];
  const target = recipient ? RECIPIENT_TARGET[recipient] : undefined;
  if (!target) {
    return {
      target: null,
      claim_ids: slotClaims(readings, ["recipient"]),
      finding: "recipient: no settled recipient to apply the effect to",
    };
  }
  return { target, claim_ids: slotClaims(readings, ["recipient"]), finding: null };
}

const ROLL_KIND: Record<string, string> = {
  hit: "hit",
  wound: "wound",
  save: "save",
  charge: "charge",
  advance: "advance",
  leadership: "leadership",
};

const STAT_OPERATION: Record<string, string> = { add: "add", subtract: "subtract", set: "set" };
const ROLL_OPERATION: Record<string, string> = {
  add: "add",
  subtract: "subtract",
  "ignore-modifiers": "ignore-modifiers",
};

type EffectCompilation = {
  effect: AnyRecord | null;
  claim_ids: string[];
  findings: string[];
};

/**
 * The modifier's magnitude. Exactly one integer may claim the `modifier-value`
 * role; zero or several is undetermined, and a default of 1 would be an
 * invented quantity.
 */
function modifierValue(
  readings: Map<string, SlotReading>,
  state: AbilityState | null,
): { value: number | null; claim_ids: string[]; finding: string | null } {
  const candidates = literalReadings(readings, state, "integer")
    .filter((literal) => literal.options.includes("modifier-value"));
  if (candidates.length === 1) {
    return { value: Number(candidates[0].value), claim_ids: candidates[0].claim_ids, finding: null };
  }
  return {
    value: null,
    claim_ids: candidates.flatMap((literal) => literal.claim_ids),
    finding: candidates.length === 0
      ? "modifier-value: no integer is settled as the modifier magnitude"
      : `modifier-value: ${candidates.length} integers claim the role, so the magnitude is ambiguous`,
  };
}

type LeafContext = {
  readings: Map<string, SlotReading>;
  state: AbilityState | null;
  composition: string | null;
};

function compileRollModifier(context: LeafContext): EffectCompilation {
  const { readings, state } = context;
  const roll = slotOptions(readings, "effect_roll")[0];
  const operation = slotOptions(readings, "effect_operation")[0];
  const findings: string[] = [
    ...fallbackFindings(readings, ["effect_roll", "effect_operation", ...recipientSlots(context)]),
  ];
  const kind = roll ? ROLL_KIND[roll] : undefined;
  if (!roll) findings.push(...blockingFindings(readings, ["effect_roll"]));
  else if (!kind) findings.push(`effect_roll: ${roll} does not name a roll that can be modified`);
  const applied = operation ? ROLL_OPERATION[operation] : undefined;
  if (!operation) findings.push(...blockingFindings(readings, ["effect_operation"]));
  else if (!applied) {
    findings.push(operation === "reroll"
      // `re-roll` needs `subset` (ones | all-failures) and no slot reports it,
      // so the operation is reported rather than defaulted to one of them.
      ? "effect_operation: reroll needs a re-roll subset, which no slot reports"
      : `effect_operation: ${operation} does not name a supported roll operation`);
  }
  const recipient = recipientTarget(readings, context.composition);
  if (recipient.finding) findings.push(recipient.finding);
  if (!kind || !applied || !recipient.target) {
    return { effect: null, claim_ids: [...recipient.claim_ids], findings };
  }
  const modifier: AnyRecord = { roll: kind, operation: applied };
  const claimIds = [...slotClaims(readings, ["effect_roll", "effect_operation"]), ...recipient.claim_ids];
  if (applied !== "ignore-modifiers") {
    const magnitude = modifierValue(readings, state);
    if (magnitude.finding) {
      return { effect: null, claim_ids: [...claimIds, ...magnitude.claim_ids], findings: [...findings, magnitude.finding] };
    }
    modifier.value = magnitude.value;
    claimIds.push(...magnitude.claim_ids);
  }
  return {
    effect: { type: "roll-modifier", target: recipient.target, modifier },
    claim_ids: claimIds,
    findings,
  };
}

function compileStatModifier(context: LeafContext): EffectCompilation {
  const { readings, state } = context;
  const stat = slotOptions(readings, "effect_stat")[0];
  const operation = slotOptions(readings, "effect_operation")[0];
  const findings: string[] = [
    ...fallbackFindings(readings, ["effect_stat", "effect_operation", ...recipientSlots(context)]),
  ];
  const modified = stat && SLOT_OPTION_VOCABULARY.effect_stat.includes(stat) ? stat : undefined;
  if (!stat) findings.push(...blockingFindings(readings, ["effect_stat"]));
  else if (!modified) findings.push(`effect_stat: ${stat} does not name a modifiable characteristic`);
  const applied = operation ? STAT_OPERATION[operation] : undefined;
  if (!operation) findings.push(...blockingFindings(readings, ["effect_operation"]));
  else if (!applied) {
    findings.push(`effect_operation: ${operation} does not name a supported characteristic operation`);
  }
  const recipient = recipientTarget(readings, context.composition);
  if (recipient.finding) findings.push(recipient.finding);
  if (!modified || !applied || !recipient.target) {
    return { effect: null, claim_ids: [...recipient.claim_ids], findings };
  }
  const magnitude = modifierValue(readings, state);
  if (magnitude.finding) {
    return {
      effect: null,
      claim_ids: [...recipient.claim_ids, ...magnitude.claim_ids],
      findings: [...findings, magnitude.finding],
    };
  }
  return {
    effect: {
      type: "stat-modifier",
      target: recipient.target,
      modifier: { stat: modified, operation: applied, value: magnitude.value },
    },
    claim_ids: [
      ...slotClaims(readings, ["effect_stat", "effect_operation"]),
      ...magnitude.claim_ids,
      ...recipient.claim_ids,
    ],
    findings,
  };
}

function compileKeywordGrant(context: LeafContext): EffectCompilation {
  const { readings, state } = context;
  const findings: string[] = [
    ...fallbackFindings(readings, ["keyword_grant_subject", ...recipientSlots(context)]),
  ];
  const subject = slotOptions(readings, "keyword_grant_subject")[0];
  if (!subject) findings.push(...blockingFindings(readings, ["keyword_grant_subject"]));
  const granted = literalReadings(readings, state, "keyword")
    .filter((literal) => literal.options.includes("granted-effect"));
  if (granted.length === 0) {
    findings.push("keyword: no keyword is settled as granted, so there is nothing to grant");
  }
  const recipient = recipientTarget(readings, context.composition);
  if (recipient.finding) findings.push(recipient.finding);
  if (!subject || granted.length === 0 || !recipient.target) {
    return { effect: null, claim_ids: [...recipient.claim_ids], findings };
  }
  return {
    effect: {
      type: "keyword-grant",
      target: recipient.target,
      modifier: { keywords: granted.map((literal) => String(literal.value)) },
    },
    claim_ids: [
      ...slotClaims(readings, ["keyword_grant_subject"]),
      ...granted.flatMap((literal) => literal.claim_ids),
      ...recipient.claim_ids,
    ],
    findings,
  };
}

function compileMortalWounds(context: LeafContext): EffectCompilation {
  const { readings, state } = context;
  const findings: string[] = [
    ...fallbackFindings(readings, ["mortal_wound_resolution", ...recipientSlots(context)]),
  ];
  const resolution = slotOptions(readings, "mortal_wound_resolution")[0];
  const recipient = recipientTarget(readings, context.composition);
  if (recipient.finding) findings.push(recipient.finding);
  const claimIds = [...recipient.claim_ids];
  let count: string | number | null = null;

  if (resolution === "dice") {
    const dice = literalReadings(readings, state, "dice").filter((literal) => literal.options.includes("effect-amount"));
    if (dice.length === 1) {
      count = String(dice[0].value);
      claimIds.push(...dice[0].claim_ids);
    } else findings.push(`effect-amount: ${dice.length} dice claim the mortal-wound amount`);
  } else if (resolution === "fixed") {
    const fixed = literalReadings(readings, state, "integer").filter((literal) => literal.options.includes("count"));
    if (fixed.length === 1) {
      count = String(fixed[0].value);
      claimIds.push(...fixed[0].claim_ids);
    } else findings.push(`count: ${fixed.length} integers claim the mortal-wound count`);
  } else {
    findings.push(...blockingFindings(readings, ["mortal_wound_resolution"]));
    if (resolution) findings.push(`mortal_wound_resolution: ${resolution} is not composable from the settled slots`);
  }

  if (count === null || !recipient.target) {
    return { effect: null, claim_ids: claimIds, findings };
  }
  const wounds: AnyRecord = { type: "mortal-wounds", target: recipient.target, modifier: { count } };
  const usedSlots = ["mortal_wound_resolution"];

  // A die that the slot calls a `test-roll` gates the wounds rather than
  // measuring them. Emitting the bare mortal-wounds node would flatten the test
  // into an unconditional effect, which changes play rather than wording.
  const tests = literalReadings(readings, state, "dice")
    .filter((literal) => literal.options.includes("test-roll"));
  if (tests.length > 0) {
    const thresholds = literalReadings(readings, state, "integer")
      .filter((literal) => literal.options.includes("threshold"));
    if (tests.length !== 1 || thresholds.length !== 1) {
      findings.push(
        `test-roll: ${tests.length} dice and ${thresholds.length} thresholds claim the mortal-wound test, `
        + "so the gate cannot be assembled",
      );
      return { effect: null, claim_ids: claimIds, findings };
    }
    usedSlots.push(tests[0].question_id, thresholds[0].question_id);
    return {
      effect: {
        type: "dice-gated",
        dice: String(tests[0].value),
        threshold: Number(thresholds[0].value),
        comparison: "gte",
        on_success: wounds,
        on_fail: null,
      },
      claim_ids: [
        ...slotClaims(readings, usedSlots),
        ...tests[0].claim_ids,
        ...thresholds[0].claim_ids,
        ...claimIds,
      ],
      findings: [...findings, ...fallbackFindings(readings, [tests[0].question_id, thresholds[0].question_id])],
    };
  }

  return {
    effect: wounds,
    claim_ids: [...slotClaims(readings, usedSlots), ...claimIds],
    findings,
  };
}

const EFFECT_BUILDERS: Record<string, (context: LeafContext) => EffectCompilation> = {
  "roll-modifier": compileRollModifier,
  "stat-modifier": compileStatModifier,
  "keyword-grant": compileKeywordGrant,
  "mortal-wounds": compileMortalWounds,
};

const CARDINALITY: Record<string, AnyRecord> = {
  one: { count: 1 },
  "up-to-one": { max_count: 1 },
};

/** `selection_owner`/`selection_cardinality`/`selection_reference` -> selector. */
function compileSelector(
  readings: Map<string, SlotReading>,
  state: AbilityState | null,
): { selector: AnyRecord | null; claim_ids: string[]; findings: string[] } {
  const owner = slotOptions(readings, "selection_owner")[0];
  const cardinality = slotOptions(readings, "selection_cardinality")[0];
  const reference = slotOptions(readings, "selection_reference")[0];
  const findings: string[] = [
    ...fallbackFindings(readings, ["selection_owner", "selection_cardinality", "selection_reference"]),
  ];
  const bounds = cardinality ? CARDINALITY[cardinality] : undefined;
  if (!owner) findings.push(...blockingFindings(readings, ["selection_owner"]));
  if (!bounds) {
    findings.push(`selection_cardinality: ${cardinality ?? "no settled option"} has no selector bound`);
  }
  if (!reference || !["model", "unit"].includes(reference)) {
    findings.push(`selection_reference: ${reference ?? "no settled option"} does not name a selectable kind`);
  }
  if (!owner || !bounds || !reference || !["model", "unit"].includes(reference)) {
    return { selector: null, claim_ids: [], findings };
  }
  const selector: AnyRecord = { owner, target_kind: reference, ...bounds };
  const distances = literalReadings(readings, state, "distance")
    .filter((literal) => literal.options.includes("selection-range"));
  if (distances.length === 1) selector.range_inches = distances[0].value;
  const visibility = slotOptions(readings, "selection_requires_visibility").includes("true");
  if (visibility) selector.visibility_required = true;
  return {
    selector,
    claim_ids: [
      ...slotClaims(readings, ["selection_owner", "selection_cardinality", "selection_reference"]),
      ...distances.flatMap((literal) => literal.claim_ids),
      ...slotClaims(readings, ["selection_requires_visibility"]),
    ],
    findings,
  };
}

/** The answer the classifier selected for a broad question, as text. */
function broadValue(claims: readonly CandidateClaim[], questionId: string): string | null {
  const claim = claims.find((candidate) => candidate.question_id === questionId);
  return claim === undefined ? null : String(claim.value);
}

type FamilyContext = {
  abilityId: CohortAbilityId;
  current: AnyRecord;
  claims: readonly CandidateClaim[];
  state: AbilityState | null;
  readings: Map<string, SlotReading>;
};

const WRAPPING_COMPOSITIONS = ["leaf", "conditional", "selection"] as const;

/**
 * A rule with several operative effects cannot be composed by a family that
 * authors one. Emitting the single effect the family understands would flatten
 * the others into nothing, which changes play rather than wording, so the
 * constructor declines and names the reason. A `selection` composition is
 * exempt because selection-then-effect is exactly what it models.
 */
function multiEffectBlocker(context: FamilyContext): string | null {
  if (broadValue(context.claims, "composition") === "selection") return null;
  if (!slotOptions(context.readings, "has_multiple_effects").includes("true")) return null;
  return "has_multiple_effects: the source states several effects and this family composes one";
}

/**
 * Wrap a compiled leaf in the composition the classifier reported. A
 * `conditional` whose condition could not be assembled is incomplete: emitting
 * the leaf unconditioned would drop the gate the source states, which is the
 * `omitted-condition` defect the round trip flags.
 */
function constructWrapped(context: FamilyContext, leaf: EffectCompilation): ConstructionResult {
  const composition = broadValue(context.claims, "composition");
  const findings = [...leaf.findings];
  const claimIds = [...leaf.claim_ids];
  if (!leaf.effect) {
    return incomplete(context.claims, {
      consumed: claimIds,
      findings: findings.length ? findings : ["effect: no settled slot determines the effect payload"],
    });
  }
  const flattened = multiEffectBlocker(context);
  if (flattened) {
    return incomplete(context.claims, {
      consumed: claimIds,
      findings: [...findings, flattened],
    });
  }
  if (composition === "leaf") {
    return constructed(context.claims, claimIds, baseAbility(context.current, leaf.effect), findings);
  }
  if (composition === "conditional") {
    const condition = compileCondition(context.readings, context.state);
    findings.push(...condition.findings);
    claimIds.push(...condition.claim_ids);
    if (!condition.condition) {
      return incomplete(context.claims, {
        consumed: claimIds,
        findings: [...findings, "condition: no settled slot assembles a condition operand"],
      });
    }
    return constructed(
      context.claims,
      claimIds,
      baseAbility(context.current, { type: "conditional", condition: condition.condition, effect: leaf.effect }),
      findings,
    );
  }
  const selection = compileSelector(context.readings, context.state);
  findings.push(...selection.findings);
  claimIds.push(...selection.claim_ids);
  if (!selection.selector) {
    return incomplete(context.claims, {
      consumed: claimIds,
      findings: [...findings, "selector: no settled slot assembles the selection"],
    });
  }
  return constructed(
    context.claims,
    claimIds,
    baseAbility(context.current, { type: "select-units", selector: selection.selector, effect: leaf.effect }),
    findings,
  );
}

const FAMILY_CONSTRUCTORS = new Map<string, (context: FamilyContext) => ConstructionResult>();
for (const [effectKind, build] of Object.entries(EFFECT_BUILDERS)) {
  for (const composition of WRAPPING_COMPOSITIONS) {
    FAMILY_CONSTRUCTORS.set(`${composition}/${effectKind}`, (context) =>
      constructWrapped(context, build({
        readings: context.readings,
        state: context.state,
        composition,
      })));
  }
}

/** Family keys a constructor exists for, sorted. The registry is the contract. */
export function registeredFamilies(): string[] {
  return [...FAMILY_CONSTRUCTORS.keys()].sort();
}

function constructed(
  claims: readonly CandidateClaim[],
  consumed: string[],
  candidate: AnyRecord,
  findings: string[] = [],
): ConstructionResult {
  const consumedSet = new Set(consumed);
  const unconsumed = claims.filter((claim) => !consumedSet.has(claim.id)).map((claim) => claim.id);
  return { status: "constructed", candidate, consumed_claim_ids: consumed, unconsumed_claim_ids: unconsumed, findings };
}

function incomplete(claims: readonly CandidateClaim[], gate: { consumed: string[]; findings: string[] }): ConstructionResult {
  const consumedSet = new Set(gate.consumed);
  return {
    status: "incomplete",
    consumed_claim_ids: gate.consumed,
    unconsumed_claim_ids: claims.filter((claim) => !consumedSet.has(claim.id)).map((claim) => claim.id),
    findings: gate.findings,
  };
}

type CandidateConstructor = (current: AnyRecord, claims: CandidateClaim[]) => ConstructionResult;

/**
 * Ability-specific overrides, tried before the family registry.
 *
 * The supervised abilities are asked per-ability question packets rather than
 * the generic slots, so a family constructor has nothing to read for them and
 * would report every slot blocking. Their constructors are the only encoding of
 * those questions' answers, and they stay until the fleet-wide slots can carry
 * the same claims.
 */
const CONSTRUCTORS: Partial<Record<CohortAbilityId, CandidateConstructor>> = {
  "bomb-squig": constructBombSquig,
  "try-dat-button-dread-mob": constructTryDatButton,
  "waaagh-banner": constructWaaaghBanner,
  "where-dya-fink-youre-going-da-big-hunt": constructFallbackHazard,
};

export function constructCandidate(
  abilityId: CohortAbilityId,
  current: AnyRecord,
  claims: CandidateClaim[],
  state?: AbilityState,
): ConstructionResult {
  const override = CONSTRUCTORS[abilityId];
  if (override) return override(current, claims);
  const readings = readSlots(claims);
  const composition = broadValue(claims, "composition");
  const primaryEffect = broadValue(claims, "primary_effect");
  const family = composition && primaryEffect ? `${composition}/${primaryEffect}` : null;
  const constructor = family ? FAMILY_CONSTRUCTORS.get(family) : undefined;
  if (!constructor || !family) {
    return incomplete(claims, {
      consumed: [],
      findings: [family
        ? `unsupported family: composition=${composition}; primary_effect=${primaryEffect}; `
          + `ontology_gap=${String(broadValue(claims, "likely_ontology_gap"))}`
        : `unclassified: composition=${String(composition)}; primary_effect=${String(primaryEffect)}`],
    });
  }
  return constructor({
    abilityId,
    current,
    claims,
    state: state ?? null,
    readings,
  });
}

function responsePath(privateRoot: string, requestHash: string, repeat: number): string {
  return join(privateRoot, "responses", `${requestHash}.repeat-${repeat}.json`);
}

function estimateInputTokens(payload: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(payload), "utf8") / 3);
}

export function estimatedCost(inputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION_USD;
}

export async function ask(
  client: TypeSafeClient | null,
  state: JsonObject,
  questions: Questions,
  ledger: CostLedger,
  privateRoot: string,
  repeat: number,
  live: boolean,
): Promise<CachedResponse> {
  const request = { state, questions, model: MODEL };
  const requestHash = hash({ version: EXPERIMENT_VERSION, request });
  const cachePath = responsePath(privateRoot, requestHash, repeat);
  if (existsSync(cachePath)) return readJson<CachedResponse>(cachePath);
  if (!live || !client) throw new Error(`Missing cached response ${requestHash}; rerun with --live`);
  const estimatedTokens = estimateInputTokens(request);
  const estimated = estimatedCost(ledger.input_tokens + estimatedTokens);
  if (estimated > ledger.budget_usd - SCHEDULING_RESERVE_USD) {
    throw new Error(`Refusing request: estimated cumulative spend $${estimated.toFixed(6)} exceeds scheduling ceiling`);
  }
  const started = performance.now();
  const result: SystemOneResult<Questions> = await client.systemOne(request, {
    timeout: 120_000,
    retry: { maxRetries: 0 },
  });
  const response: CachedResponse = {
    request_hash: requestHash,
    repeat,
    model: result.model,
    answers: result.answers,
    usage: result.usage,
    latency_ms: Math.round(performance.now() - started),
  };
  ledger.input_tokens += result.usage.input_tokens;
  ledger.output_tokens += result.usage.output_tokens;
  ledger.observed_cost_usd = estimatedCost(ledger.input_tokens);
  writeJson(cachePath, response);
  if (ledger.observed_cost_usd > ledger.budget_usd) throw new Error("TypeSafe experiment exceeded its hard budget");
  return response;
}

function safeDifference(current: AnyRecord, candidate: AnyRecord): string[] {
  const fields = ["effect", "scope", "trigger", "usage", "applies_to"];
  return fields.filter((field) => canonical(current[field]) !== canonical(candidate[field]));
}

function sanitizeState(state: AbilityState): JsonObject {
  return structuredClone(state) as unknown as JsonObject;
}

function summaryResponse(response: CachedResponse): AnyRecord {
  return {
    request_hash: response.request_hash,
    model: response.model,
    question_count: Object.keys(response.answers).length,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    latency_ms: response.latency_ms,
  };
}

/**
 * Acceptance: the aggregate must be confident, no defect may be confidently
 * asserted, and no preservation claim may be confidently denied.
 *
 * Requiring every `preserves_*` proposition to clear the threshold made the
 * gate a conjunction over up to thirteen probabilistic facts, so it measured
 * how many questions were asked rather than whether the candidate is right —
 * the failure design law 1 names. The atomic propositions are vetoes here: an
 * unconfident one is "don't know" and decides nothing, while a confident denial
 * or a confident defect rejects outright.
 */
export function verificationPassed(response: CachedResponse): boolean {
  const probabilities = Object.fromEntries(
    Object.entries(response.answers).map(([questionId, answer]) => [
      questionId,
      answer && typeof answer === "object" && (answer as AnyRecord).type === "noul"
        ? (answer as AnyRecord).noul
        : undefined,
    ]),
  );
  const value = (questionId: string): number | undefined => {
    const probability = probabilities[questionId];
    return typeof probability === "number" ? probability : undefined;
  };
  const supported = value("candidate_supported");
  if (supported === undefined || supported < ACCEPTANCE_CONFIDENCE) return false;
  const preserved = Object.entries(probabilities)
    .filter(([questionId]) => questionId.startsWith("preserves_"))
    .map(([, probability]) => probability);
  if (preserved.some((probability) => typeof probability === "number" && probability <= 1 - ACCEPTANCE_CONFIDENCE)) {
    return false;
  }
  return ["missing_effect", "missing_condition", "missing_timing_or_usage", "introduced_mechanic"]
    .every((questionId) => {
      const probability = value(questionId);
      return probability === undefined || probability < ACCEPTANCE_CONFIDENCE;
    });
}

export async function runExperiment(options: {
  live: boolean;
  privateRoot?: string;
  dumpPath?: string;
  corpusPath?: string;
  budgetUsd?: number;
  slice?: number;
}): Promise<AnyRecord> {
  const privateRoot = options.privateRoot ?? DEFAULT_PRIVATE_ROOT;
  const cohort = options.slice ? orkSlice(options.slice, options.corpusPath) : [...COHORT];
  // Fail closed: a crashed run must not leave the previous run's summary on
  // disk, where a consumer would read it as this run's result.
  const summaryPath = join(privateRoot, "run-summary.json");
  if (options.live && existsSync(summaryPath)) rmSync(summaryPath, { force: true });
  const states = buildCohortStates({
    dumpPath: options.dumpPath,
    corpusPath: options.corpusPath,
    abilityIds: cohort,
  });
  const abilities = readJson<AnyRecord[]>(ABILITIES);
  const byId = new Map(abilities.map((ability) => [String(ability.ability_id), ability]));
  const ledger: CostLedger = {
    budget_usd: options.budgetUsd ?? DEFAULT_BUDGET_USD,
    input_tokens: 0,
    output_tokens: 0,
    observed_cost_usd: 0,
  };
  for (const file of existsSync(join(privateRoot, "responses")) ? readdirSync(join(privateRoot, "responses")) : []) {
    const cached = readJson<CachedResponse>(join(privateRoot, "responses", file));
    ledger.input_tokens += cached.usage.input_tokens;
    ledger.output_tokens += cached.usage.output_tokens;
  }
  ledger.observed_cost_usd = estimatedCost(ledger.input_tokens);
  const client = options.live ? new TypeSafeClient({ logLevel: "off", retry: { maxRetries: 0 }, timeout: 120_000 }) : null;
  const summaries: AnyRecord[] = [];
  const acceptedCandidates = new Map<CohortAbilityId, AnyRecord>();
  const hardCase = "try-dat-button-dread-mob" satisfies CohortAbilityId;

  for (const abilityId of cohort) {
    const state = states[abilityId];
    writeJson(join(privateRoot, "source-state", `${abilityId}.json`), state);
    const unseen = !SUPERVISED_IDS.has(abilityId);
    const questions = unseen ? broadQuestions() : extractionQuestions(abilityId);
    const repeats = abilityId === hardCase ? [0, 1, 2] : [0];
    const responses: CachedResponse[] = [];
    for (const repeat of repeats) {
      responses.push(await ask(client, sanitizeState(state), questions, ledger, privateRoot, repeat, options.live));
    }
    const response = responses[0];
    const broadAnswers = selectedAnswers(response);
    const decompositionQuestions = unseen
      ? genericDecompositionQuestions(state, confidentAnswers(response))
      : null;
    const decompositionStages: Questions[] = [];
    const decompositionResponses: CachedResponse[] = [];
    const claims = claimsFromResponse(abilityId, state, response);
    let decompositionRequired: string[] | undefined;
    if (decompositionQuestions) {
      const slotQuestions = decompositionQuestions;
      let stageQuestions = decompositionQuestions;
      decompositionRequired = Object.keys(stageQuestions);
      for (let stage = 0; stage < 3; stage += 1) {
        decompositionStages.push(stageQuestions);
        const stageResponse = await ask(
          client,
          {
            source: sanitizeState(state),
            broad_answers: broadAnswers as JsonObject,
            previous_answers: decompositionResponses.length
              ? selectedAnswers(decompositionResponses.at(-1)!) as JsonObject
              : {},
          },
          stageQuestions,
          ledger,
          privateRoot,
          0,
          options.live,
        );
        decompositionResponses.push(stageResponse);
        claims.push(...claimsFromResponse(abilityId, state, stageResponse));
        const open = openSlots(claims, decompositionRequired);
        if (open.length === 0 || stage === 2) break;
        // Enumerate options from the stage-0 packet: refined propositions carry
        // no criteria, so the slot's original choice definition is the source
        // of truth for what its options are.
        const refinement = genericRefinementQuestions(
          slotQuestions,
          open,
          stage + 1,
        );
        const refinedSlots = new Set(open);
        decompositionRequired = [
          ...decompositionRequired.filter((questionId) => !refinedSlots.has(slotOf(questionId))),
          ...Object.keys(refinement),
        ];
        stageQuestions = refinement;
      }
    }
    writeJson(
      join(privateRoot, "question-bank", `${abilityId}.json`),
      decompositionQuestions
        ? { broad: questions, decomposition_stages: decompositionStages }
        : questions,
    );
    writeJson(join(privateRoot, "claims", `${abilityId}.json`), claims);
    const current = byId.get(abilityId);
    if (!current) throw new Error(`Current Ork ability missing: ${abilityId}`);
    const construction = constructCandidate(abilityId, current, claims, state);
    if (construction.candidate) {
      const ajv = createValidator();
      const validate = ajv.getSchema(ABILITY_SCHEMA_ID);
      if (!validate) throw new Error(`Ability schema unavailable: ${ABILITY_SCHEMA_ID}`);
      if (!validate(construction.candidate)) {
        construction.status = "unsupported";
        construction.findings.push("constructed candidate failed the ability schema");
      }
    }
    writeJson(join(privateRoot, "candidates", `${abilityId}.json`), construction);

    let verification: CachedResponse | null = null;
    if (construction.candidate) {
      verification = await ask(
        client,
        {
          source: sanitizeState(state),
          candidate_mechanics: {
            effect: construction.candidate.effect as Json,
            scope: (construction.candidate.scope ?? null) as Json,
            trigger: (construction.candidate.trigger ?? null) as Json,
            usage: (construction.candidate.usage ?? null) as Json,
            applies_to: (construction.candidate.applies_to ?? null) as Json,
          },
          candidate_rendered_text: describeAbility(
            construction.candidate as Parameters<typeof describeAbility>[0],
          ),
        },
        verificationQuestions(abilityId),
        ledger,
        privateRoot,
        0,
        options.live,
      );
    }
    const differences = construction.candidate ? safeDifference(current, construction.candidate) : [];
    const acceptanceStatus = construction.status !== "constructed"
      ? "not-constructed"
      : verification && verificationPassed(verification)
        ? "accepted"
        : "verification-rejected";
    if (acceptanceStatus === "accepted" && construction.candidate) {
      acceptedCandidates.set(abilityId, construction.candidate);
    }
    const safeSummary: AnyRecord = {
      ability_id: abilityId,
      source_digest: sourceDigest(state.source_text),
      extraction: summaryResponse(response),
      decomposition_extractions: decompositionResponses.map(summaryResponse),
      classification: classifyClaims(claims),
      decomposition: decompositionEvidence(
        abilityId,
        claims,
        decompositionRequired,
      ),
      repeatability_runs: responses.map(summaryResponse),
      repeatability_selected_identical: responses.every(
        (candidate) => canonical(selectedAnswers(candidate)) === canonical(selectedAnswers(response)),
      ),
      repeatability_distributions_identical: responses.every(
        (candidate) => canonical(candidate.answers) === canonical(response.answers),
      ),
      repeatability_construction_identical: responses.every((candidateResponse) => {
        const candidateConstruction = constructCandidate(
          abilityId,
          current,
          claimsFromResponse(abilityId, state, candidateResponse),
          state,
        );
        return canonical({
          status: candidateConstruction.status,
          candidate: candidateConstruction.candidate,
        }) === canonical({
          status: construction.status,
          candidate: construction.candidate,
        });
      }),
      construction_status: construction.status,
      acceptance_status: acceptanceStatus,
      claims_proposed: claims.length,
      claims_consumed: construction.consumed_claim_ids.length,
      unconsumed_count: construction.unconsumed_claim_ids.length,
      findings: construction.findings,
      current_dsl_differences: differences,
      verification: verification ? {
        ...summaryResponse(verification),
        passed: verificationPassed(verification),
        answers: verification.answers,
      } : null,
    };
    writeJson(join(privateRoot, "comparisons", `${abilityId}.json`), safeSummary);
    summaries.push(safeSummary);
  }
  rmSync(join(privateRoot, "accepted-candidates"), { recursive: true, force: true });
  for (const [abilityId, candidate] of acceptedCandidates) {
    writeJson(join(privateRoot, "accepted-candidates", `${abilityId}.json`), candidate);
  }

  const totals = {
    accepted: summaries.filter((summary) => summary.acceptance_status === "accepted").length,
    verification_rejected: summaries.filter((summary) => summary.acceptance_status === "verification-rejected").length,
    not_constructed: summaries.filter((summary) => summary.acceptance_status === "not-constructed").length,
  };
  const unseenSummaries = summaries.filter((summary) =>
    !SUPERVISED_IDS.has(String(summary.ability_id))
  );
  const unresolvedSlotCounts = new Map<string, number>();
  for (const summary of unseenSummaries) {
    const decomposition = summary.decomposition as AnyRecord;
    for (const slot of decomposition.unresolved_slots as string[]) {
      unresolvedSlotCounts.set(slot, (unresolvedSlotCounts.get(slot) ?? 0) + 1);
    }
  }
  const unseenResult = {
    abilities: unseenSummaries.length,
    closed: unseenSummaries.filter(
      (summary) => (summary.decomposition as AnyRecord).status === "closed",
    ).length,
    open: unseenSummaries.filter(
      (summary) => (summary.decomposition as AnyRecord).status === "open",
    ).length,
    max_refinement_stages: 3,
    unresolved_slot_counts: Object.fromEntries(
      [...unresolvedSlotCounts.entries()].sort((left, right) => right[1] - left[1]),
    ),
  };
  const sliceStatePath = join(privateRoot, "slices.json");
  const sliceState = existsSync(sliceStatePath)
    ? readJson<Record<string, string[]>>(sliceStatePath)
    : {};
  if (options.slice) sliceState[String(options.slice)] = cohort;
  writeJson(sliceStatePath, sliceState);

  const sliceRunLogPath = join(privateRoot, "slice-runs.json");
  const sliceRuns: AnyRecord[] = existsSync(sliceRunLogPath)
    ? readJson<AnyRecord[]>(sliceRunLogPath)
    : [];
  if (options.slice) {
    const entry = {
      slice: options.slice,
      cohort,
      closed: unseenResult.closed,
      open: unseenResult.open,
      unresolved_slot_counts: unseenResult.unresolved_slot_counts,
      open_abilities: unseenSummaries
        .filter((summary) => (summary.decomposition as AnyRecord).status === "open")
        .map((summary) => ({
          ability_id: summary.ability_id,
          unresolved_slots: (summary.decomposition as AnyRecord).unresolved_slots,
        })),
    };
    const prior = sliceRuns.findIndex((run) => run.slice === options.slice);
    if (prior === -1) sliceRuns.push(entry);
    else sliceRuns[prior] = entry;
  }
  writeJson(sliceRunLogPath, sliceRuns);

  const pool = orkSlicePool(options.corpusPath);
  const examined = new Set<string>([
    ...Object.values(sliceState).flat(),
    ...RANDOM_COHORT_2,
    ...INITIAL_COHORT,
  ]);
  const corpusProgress = {
    ork_abilities_with_source: pool.length + SUPERVISED_IDS.size + LEGACY_UNSEEN_IDS.size,
    slice_size: SLICE_SIZE,
    slices_total: orkSliceCount(options.corpusPath),
    slices_recorded: Object.keys(sliceState).length,
    examined: [...examined].length,
    remaining: pool.filter((id) => !examined.has(id)).length,
  };

  const report = {
    experiment_version: EXPERIMENT_VERSION,
    model: MODEL,
    slice: options.slice ?? null,
    cohort: [...cohort],
    cohorts: {
      initial: [...INITIAL_COHORT],
      random_2: [...RANDOM_COHORT_2],
    },
    corpus_progress: corpusProgress,
    question_refinement_ledger: JEV_REFINEMENT_LEDGER,
    design_laws: JEV_DESIGN_LAWS,
    totals,
    unseen_result: unseenResult,
    ledger: {
      ...ledger,
      observed_cost_usd: estimatedCost(ledger.input_tokens),
    },
    abilities: summaries,
  };
  writeJson(join(privateRoot, "run-summary.json"), report);
  writeJson(join(privateRoot, "question-refinement-ledger.json"), JEV_REFINEMENT_LEDGER);
  writeJson(join(privateRoot, "design-laws.json"), JEV_DESIGN_LAWS);
  return report;
}

function parseCli(argv: string[]): {
  live: boolean;
  privateRoot?: string;
  dumpPath?: string;
  corpusPath?: string;
  budgetUsd?: number;
  slice?: number;
} {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const budget = value("--budget");
  const slice = value("--slice");
  return {
    live: argv.includes("--live"),
    privateRoot: value("--private-root") ? resolve(value("--private-root")!) : undefined,
    dumpPath: value("--dump") ? resolve(value("--dump")!) : undefined,
    corpusPath: value("--corpus") ? resolve(value("--corpus")!) : undefined,
    budgetUsd: budget ? Number(budget) : undefined,
    slice: slice ? Number(slice) : undefined,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runExperiment(parseCli(process.argv.slice(2)))
    .then((report) => {
      const ledger = report.ledger as AnyRecord;
      console.log(JSON.stringify({
        slice: report.slice,
        cohort: report.cohort,
        corpus_progress: report.corpus_progress,
        unseen_result: report.unseen_result,
        totals: report.totals,
        input_tokens: ledger.input_tokens,
        cost_usd: ledger.observed_cost_usd,
        abilities: (report.abilities as AnyRecord[]).map((ability) => ({
          ability_id: ability.ability_id,
          construction_status: ability.construction_status,
          acceptance_status: ability.acceptance_status,
          repeatability_selected_identical: ability.repeatability_selected_identical,
          repeatability_distributions_identical: ability.repeatability_distributions_identical,
          repeatability_construction_identical: ability.repeatability_construction_identical,
          verification_passed: (ability.verification as AnyRecord | null)?.passed ?? null,
          current_dsl_differences: ability.current_dsl_differences,
        })),
      }, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
