/**
 * DSL stub authoring engine (#21) — batched, subscription-billed, two-phase.
 *
 * Empty-modifier ability stubs (`{type:"stat-modifier", modifier:{}}` and kin)
 * are authored into real DSL from their 10e-archive source rule. The work is a
 * pile of discrete, stateless, structured LLM calls, so we run them as batched
 * `claude -p --json-schema` invocations on the Claude subscription rather than
 * spawning a full agent per ability (the agent fan-out's per-call system-prompt
 * + tool-loop overhead is ~50-100x the useful work). Assembly and schema
 * validation are pure TS — the model only classifies and judges.
 *
 *   author-input/<faction>.json  (datasheet-resolved rules, from author-input.ts)
 *     ── classify ──▶  flat slot-forms        (batched claude -p)
 *     ── assemble ──▶  full ability entries    (TS: effect + scope, no LLM)
 *     ── validate ──▶  AJV against the schema   (TS — rejects invented enums)
 *     ── verify  ──▶  fidelity verdict          (batched claude -p, scope-aware)
 *     ─────────────▶  data/_audit/proposed/<faction>.json
 *
 * Two modes:
 *   propose  (default) — write proposals; never touch live data.
 *   apply              — splice gated proposals into live abilities.json. Only
 *                        rewrites entries that are STILL empty-modifier stubs,
 *                        so re-running is safe and authored work is never
 *                        clobbered. Gate defaults: schema-valid + verifier-
 *                        faithful + confidence≠low + not complex-flagged.
 *
 * Usage:
 *   npx tsx tools/src/author-batch.ts propose <faction|--all> [--batch N] [--model M]
 *   npx tsx tools/src/author-batch.ts apply   <faction|--all> [--min-confidence high|medium]
 *                                                              [--include-complex] [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createValidator } from "./schema-loader.js";
import { hasEmptyModifier } from "./audit-coverage.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");
const INPUT_DIR = resolve(DATA_ROOT, "_audit", "author-input");
const ENRICHMENT_ROOT = resolve(DATA_ROOT, "enrichment");
const OUT_DIR = resolve(DATA_ROOT, "_audit", "proposed");
const ABILITY_SCHEMA_ID = "https://40kdc.dev/schemas/enrichment/ability-dsl/ability.schema.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJSON = (p: string): Json => JSON.parse(readFileSync(p, "utf-8"));
const writeJSON = (p: string, v: Json): void => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

const PARAMETERLESS = new Set(["deep-strike", "fallback-and-act", "fight-first", "fight-last", "shoot-on-death", "fight-on-death"]);

export interface Proposal {
  ability_id: string;
  name: string;
  faction: string;
  effect_type?: string;
  complex?: boolean;
  confidence?: "high" | "medium" | "low";
  schema_valid: boolean;
  proposed_effect?: Json;
  proposed_scope?: Json;
  /** Ability-level behavior the repair pass inferred (passive/activated/reactive/aura). */
  proposed_behavior?: string;
  verdict?: { severity: string; faithful: boolean; issue: string } | null;
  final_faithful: boolean;
  error?: string;
  /** Set by the full-tree repair pass — the effect is a nested tree, not flat-form. */
  repaired?: boolean;
  /** Repair pass flagged this rule as genuinely unencodable (needs hand-authoring). */
  unencodable?: boolean;
  /** Canonical-key lint result (repair pass only). false = invented/out-of-vocab modifier keys. */
  canonical?: boolean;
}

// ─── claude CLI bridge (subscription, structured output) ─────────────

/** One batched, structured `claude -p` call. Resolves to the validated object. */
export function callClaude(system: string, user: string, schema: Json, model: string): Promise<Json> {
  return new Promise((res, rej) => {
    execFile(
      "claude",
      ["-p", user, "--system-prompt", system, "--exclude-dynamic-system-prompt-sections",
       "--json-schema", JSON.stringify(schema), "--output-format", "json", "--model", model],
      { maxBuffer: 64 * 1024 * 1024, timeout: 300_000 },
      (err, stdout) => {
        if (err && !stdout) return rej(err);
        try {
          const env = JSON.parse(stdout);
          if (env.is_error) return rej(new Error(env.result ?? "claude error"));
          if (!env.structured_output) return rej(new Error("no structured_output in response"));
          res(env.structured_output);
        } catch (e) {
          rej(new Error(`parse failed: ${(e as Error).message}; head=${String(stdout).slice(0, 200)}`));
        }
      },
    );
  });
}

// ─── prompts + schemas ───────────────────────────────────────────────

const CLASSIFY_SYSTEM =
  `You translate Warhammer 40k ability rules into a structured DSL. For each ability return one slot-form.\n\n` +
  `effect_type — pick the SINGLE best of:\n` +
  `  stat-modifier {operation:"add"|"subtract"|"set", stat:"A"|"S"|"T"|"Sv"|"AP"|"OC"|"Ld", value:int}\n` +
  `  roll-modifier {operation:"add"|"subtract", roll:"hit"|"wound"|"save"|"charge", value:int}\n` +
  `  re-roll {roll:"hit"|"wound"|"save"|"damage"|"charge", subset:"ones"|"all-failures"} — ONLY combat dice, NOT Battle-shock/Leadership\n` +
  `  leadership-modifier {test:"battle-shock", operation:"re-roll"} or {operation:"add"|"subtract", value:int} — USE for Battle-shock/Leadership rerolls or Ld changes\n` +
  `  mortal-wounds {count:int|"D3"|"D6"} ; feel-no-pain {threshold:int} ; invulnerable-save {invuln_sv:int}\n` +
  `  keyword-grant {keywords:[ "lethal-hits"|"sustained-hits"|"devastating-wounds"|"twin-linked"|... ]} (ARRAY)\n` +
  `  damage-reduction {reduction:int} ; objective-control-modifier {operation,value}|{sticky:true}\n` +
  `  ability-grant {ability_id:"kebab"}|{grant_type:"..."} ; attack-restriction {restriction:"..."}\n` +
  `  cp-gain|cp-refund {amount:int} ; resurrection {count:int|"D3"} ; model-destruction {count:int}\n` +
  `  resource-gain|resource-spend {pool_id:"...", amount:int|"D3"} — faction resources: Miracle Dice→"miracle-dice-pool", Khorne Blessings→"blessings-of-khorne-pool", Pain tokens→"pain-token-pool"\n` +
  `  movement-modifier {move_type,value} ; deep-strike/fallback-and-act/fight-first/fight-last/shoot-on-death/fight-on-death → modifier {}\n\n` +
  `attack_type — "melee"|"ranged" if the rule limits to that attack kind, else "any". (Do NOT encode this as a condition.)\n` +
  `condition_kind — DEFAULT "none". Only set if the rule EXPLICITLY restricts: "phase" (+condition_param = phase name), "vs-keyword" (+param=keyword), ` +
  `"charged", "stationary", "below-half", "below-starting", "attached", "leading". Do NOT add a phase condition just because the ability operates in a phase. ` +
  `If the rule needs a compound/event trigger (e.g. a dice roll, an either/or choice, or "when a friendly VEHICLE is destroyed within 12\\"") set complex=true.\n` +
  `scope_range — EXACTLY one of "self"|"unit"|"attached"|"aura-6"|"aura-9"|"aura-12"|"aura-custom"|"engagement-range"|"any-visible"|"any-on-battlefield"|"terrain-within-range" (a distance from the bearer; NEVER a target like "all-friendly"/"friendly-within-aura"). For an army-wide detachment/faction buff ("all friendly X units"), use "unit". scope_duration — "phase"|"turn"|"battle-round"|"battle"|"until-next-command-phase"|"one-use"|"permanent".\n` +
  `target — "self"|"unit"|"friendly-within-aura"|"enemy-within-aura"|"attacker"|"defender"|... (only values from the schema enum).\n` +
  `Never copy rule text into any field. Give confidence and a one-sentence reasoning.`;

export const VERIFY_SYSTEM =
  `You judge whether authored DSL faithfully captures a 40k rule. The DSL includes scope {range,duration} — credit the aura/range/duration when it is in scope (do NOT flag "missing 6\\" aura" if scope.range is "aura-6"). ` +
  `Be strict about the core mechanic: wrong effect type, wrong stat/roll, wrong value, a condition the rule does NOT state (phantom), a stated condition that is missing, or modeling a Leadership/Battle-shock re-roll as a combat re-roll. ` +
  `severity "ok" = core mechanic + conditions + scope correct; "minor" = core correct but a secondary detail imperfect; "wrong" = core mechanic wrong. Return one verdict per ability, echoing its ability_id.`;

const CLASSIFY_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { results: { type: "array", items: {
    type: "object", additionalProperties: false,
    properties: {
      ability_id: { type: "string" }, effect_type: { type: "string" }, target: { type: "string" },
      modifier: { type: "object", additionalProperties: true }, attack_type: { enum: ["any", "melee", "ranged"] },
      condition_kind: { enum: ["none", "phase", "vs-keyword", "charged", "stationary", "below-half", "below-starting", "attached", "leading"] },
      condition_param: { type: ["string", "null"] }, scope_range: { type: "string" }, scope_duration: { type: "string" },
      complex: { type: "boolean" }, confidence: { enum: ["high", "medium", "low"] }, reasoning: { type: "string" },
    },
    required: ["ability_id", "effect_type", "target", "modifier", "attack_type", "condition_kind", "scope_range", "scope_duration", "complex", "confidence", "reasoning"],
  } } },
  required: ["results"],
};

export const VERIFY_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { results: { type: "array", items: {
    type: "object", additionalProperties: false,
    properties: { ability_id: { type: "string" }, severity: { enum: ["ok", "minor", "wrong"] }, faithful: { type: "boolean" }, issue: { type: "string" } },
    required: ["ability_id", "severity", "faithful", "issue"],
  } } },
  required: ["results"],
};

// ─── full-tree repair prompts + schema ───────────────────────────────
//
// The flat-form classifier (above) emits a single condition + flat leaf, so it
// structurally CANNOT express compound conditions, event triggers, or nested
// effect kinds — every such rule lands in the proposed/ residue with a verifier
// `issue` naming the gap. The repair pass hands the model the FULL DSL grammar
// and asks it to emit the complete nested effect tree, seeded with the existing
// draft + that exact gap. The envelope schema below is intentionally loose (just
// `effect`/`scope` objects); the real gate is AJV against ability.schema, exactly
// as the flat-form path validates `buildEntry` output.

export const REPAIR_SYSTEM =
  `You repair Warhammer 40k ability DSL. You are given a rule, a DRAFT effect that an earlier flat-form pass produced, and the EXACT gap a verifier found (usually a missing trigger or compound condition). Emit the COMPLETE nested effect tree that fixes the gap. Never copy rule text into any field.\n\n` +
  `An effect node is ONE of:\n` +
  `  • a leaf: {type, target, modifier} — type ∈ [stat-modifier, roll-modifier, re-roll, mortal-wounds, feel-no-pain, invulnerable-save, ward, keyword-grant, movement-modifier, deep-strike, fallback-and-act, fight-first, fight-last, shoot-on-death, fight-on-death, objective-control-modifier, leadership-modifier, damage-reduction, attack-restriction, ability-grant, cp-gain, cp-refund, model-destruction, resurrection, resource-gain, resource-spend, charge-roll-modifier, terrain-area-tag, bs-modifier, engagement-passthrough]; target ∈ [self, bearer, unit, attached-unit, attacker, defender, friendly-within-aura, enemy-within-aura, all-friendly, all-enemy]\n` +
  `  • conditional: {type:"conditional", condition, effect}\n` +
  `  • sequence: {type:"sequence", steps:[effect, ...]} — multiple effects that all apply\n` +
  `  • choice: {type:"choice", options:[effect, ...], choice_label?} — pick exactly one\n` +
  `  • dice-gated: {type:"dice-gated", dice:"D6"|..., threshold:int, comparison?:"greater-or-equal"|..., on_success:effect, on_fail?:effect}\n` +
  `  • dice-pool-allocation: {type:"dice-pool-allocation", pool:{count,die}, max_activations:int, options:[{name, requirement, effect}, ...]}\n\n` +
  `A condition is ONE of:\n` +
  `  • simple: {type, parameters:{...}} — ALL params go UNDER "parameters", never as top-level keys (e.g. {"type":"unit-has-keyword","parameters":{"keyword":"VEHICLE"}}, NOT {"type":"unit-has-keyword","keyword":"VEHICLE"}). type ∈ [phase-is{phase}, timing-is{timing}, player-turn-is{turn}, unit-below-starting-strength, unit-below-half-strength, unit-has-keyword{keyword}, unit-within-range-of{target_type}, model-is-leader, target-has-keyword{keyword}, charged-this-turn, advanced-this-turn, remained-stationary, is-battle-shocked, has-lost-wounds, was-hit-by-attack{subject?:"self"|"target",attack_type?,weapon_name?,count_min?}, opponent-unit-within-range, within-range-of-objective, attack-is-type{attack_type}, has-fought-this-phase, destroyed-by-attack-type{attack_type}, controls-objective, is-attached, terrain-area-control, engagement-state, territory-control, fights-first, disposition-matches, units-destroyed{side,window,count_min}, units-destroyed-comparison, objective-majority, attack-stat-compare{attacker_stat,comparison:"greater-than"|"less-than"|"greater-or-equal"|"less-or-equal"|"equal",target_stat} (e.g. attack S greater than unit T), made-ingress-move-this-turn]\n` +
  `  • compound: {operator:"and"|"or"|"not", operands:[condition, ...]} — use "not" with ONE operand to negate (e.g. "while not Battle-shocked" → {operator:"not", operands:[{type:"is-battle-shocked"}]}). Nest compounds freely.\n\n` +
  `Encode reactive/event triggers as a conditional whose condition is the trigger (e.g. an enemy destroyed a model nearby → destroyed-by-attack-type / opponent-unit-within-range). Encode "first time per turn"/"once per game" by choosing the correct timing condition; do not invent fields.\n` +
  `scope = {range, duration}: range ∈ [self, unit, attached, aura-6, aura-9, aura-12, aura-custom, engagement-range, any-visible, any-on-battlefield, terrain-within-range] — this is the COMPLETE list. range is a distance from the bearer and is NEVER a target value: do NOT put "all-friendly"/"friendly-within-aura"/"all-enemy" here (those are effect targets). For an army-wide detachment/faction buff ("all friendly X units"), use range "unit" and express the audience via the effect target / applies_to keywords. duration ∈ [phase, turn, battle-round, battle, until-next-command-phase, one-use, permanent]. Credit the aura in scope.range, NOT as a condition.\n` +
  `behavior ∈ [passive, activated, reactive, aura].\n\n` +
  `CANONICAL MODIFIER KEYS — use ONLY the keys listed per type; never invent a key (an unknown key is silently ignored by consumers and corrupts the data):\n` +
  `  stat-modifier.modifier: {stat, operation:"add"|"subtract"|"set", value:int}. stat ∈ [A,S,T,Sv,AP,OC,Ld,M,W,D] ONLY (use "M" for Move, never "Move"/"range"; weapon range is NOT a unit stat). operation:"set" IS allowed for "characteristic of N" rules (e.g. OC of 9). Optional narrowing: attack_type:"melee"|"ranged", weapon_type:"melee"|"ranged", weapon_name:"<weapon>" for a single named weapon, or weapon_keyword:"<ability>" to restrict to weapons with a keyword like "Torrent"/"Blast"/"Pistol". Do NOT use weapon_filter/model_filter.\n` +
  `  roll-modifier.modifier: {roll:"hit"|"wound"|"save"|"charge"|"damage", operation, value}. re-roll.modifier: {roll, subset:"ones"|"all-failures"}. Optional attack_type/weapon_type/weapon_name/weapon_keyword as above.\n` +
  `  keyword-grant.modifier: {keywords:[...]} (array) — combat keywords as written ("Lethal Hits","Sustained Hits 1","Twin-linked"). Optional weapon_type:"melee"|"ranged", weapon_name, weapon_keyword.\n` +
  `  feel-no-pain.modifier:{threshold:int}; damage-reduction.modifier:{reduction:int}; bs-modifier.modifier:{operation,value}; ability-grant.modifier:{grant_type:"kebab-label"}; objective-control-modifier.modifier:{operation:"add"|"set",value} or {sticky:true}; movement-modifier.modifier:{move_type:"kebab",value}; deep-strike.modifier:{} (parameterless).\n` +
  `  SCALING ("X per N models/units"): add a sibling \`scaling\`:{per:int, of:"enemy-models-in-range"|"friendly-models-in-range"|"models-in-bearer-unit"|"enemy-units-in-range"|"wounds-lost", within_inches?:int, round?:"down"|"up"} to the leaf and set modifier.value to the PER-INCREMENT amount (e.g. "+2 A per 5 enemy models within 6\\"" → {type:"stat-modifier",...,modifier:{stat:"A",operation:"add",value:2,attack_type:"melee"},scaling:{per:5,of:"enemy-models-in-range",within_inches:6}}). Do NOT flatten the scaling away.\n\n` +
  `dice-gated.comparison ∈ ["gte","lte","gt","lt","eq"] (use "gte" for "on a 2+"). dice e.g. "D6","2D6"; threshold int. on_success/on_fail are effect nodes.\n` +
  `ENCODING THE RESIDUE — these ARE expressible, do not punt on them:\n` +
  `  • "roll a D6, on 2+ <effect>" → dice-gated {dice:"D6", threshold:2, comparison:"gte", on_success:<effect>}.\n` +
  `  • "select one of N abilities/effects" → choice {options:[<effect>,...]}.\n` +
  `  • "re-roll Battle-shock/Leadership tests" → leadership-modifier {test:"battle-shock", operation:"re-roll"} (NOT a combat re-roll).\n` +
  `  • deployment/redeploy ("set up in Strategic Reserves", "set up anywhere >9\\"", "redeploy after deployment") → deep-strike, or ability-grant {grant_type:"<descriptive-kebab>"} for a named deployment rule.\n` +
  `  • "move through terrain" → movement-modifier {move_type:"through-terrain"}.\n` +
  `  • "characteristic of N" → the matching stat/OC modifier with operation:"set".\n` +
  `  • "when/if this unit WAS HIT by one or more attacks" → was-hit-by-attack {subject:"self"} (NOT has-lost-wounds — a hit that is saved still counts). "if an enemy unit was hit by [the bearer's] attacks" (offensive follow-up like grav-pinning) → was-hit-by-attack {subject:"target"}; narrow with attack_type/weapon_name when the rule names the weapon.\n\n` +
  `Set unencodable:true ONLY when the rule is NOT an in-battle ability effect at all — army-construction ("you can include one X per Y", "cannot include A with B"), roster selection ("cannot be your Warlord"), model geometry/transport-capacity declarations, or roll-off/meta procedures. For those, return your best partial effect and explain. Everything that IS an in-battle effect must be encoded with the grammar above. Give confidence + one-sentence reasoning.`;

export const REPAIR_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { results: { type: "array", items: {
    type: "object", additionalProperties: false,
    properties: {
      ability_id: { type: "string" },
      effect: { type: "object", additionalProperties: true },
      scope: { type: "object", additionalProperties: true },
      behavior: { type: "string" },
      unencodable: { type: "boolean" },
      confidence: { enum: ["high", "medium", "low"] },
      reasoning: { type: "string" },
    },
    required: ["ability_id", "effect", "scope", "behavior", "unencodable", "confidence", "reasoning"],
  } } },
  required: ["results"],
};

// ─── assembly (pure TS, no LLM) ──────────────────────────────────────

export function conditionNode(kind: string, param: string | null | undefined): Json | null {
  switch (kind) {
    case "phase": return { type: "phase-is", parameters: { phase: param } };
    case "vs-keyword": return { type: "target-has-keyword", parameters: { keyword: param } };
    case "charged": return { type: "charged-this-turn" };
    case "stationary": return { type: "remained-stationary" };
    case "below-half": return { type: "unit-below-half-strength" };
    case "below-starting": return { type: "unit-below-starting-strength" };
    case "attached": return { type: "is-attached" };
    case "leading": return { type: "model-is-leader" };
    default: return null;
  }
}

/** Build the effect node + scope from a flat-form. */
export function assembleEffect(form: Json): { effect: Json; scope: Json } {
  const modifier = PARAMETERLESS.has(form.effect_type) ? {} : { ...(form.modifier ?? {}) };
  if (form.attack_type && form.attack_type !== "any" && ["stat-modifier", "roll-modifier", "re-roll"].includes(form.effect_type)) {
    modifier.attack_type = form.attack_type;
  }
  let effect: Json = { type: form.effect_type, target: form.target, modifier };
  const cond = conditionNode(form.condition_kind, form.condition_param);
  if (cond) effect = { type: "conditional", condition: cond, effect };
  return { effect, scope: { range: form.scope_range, duration: form.scope_duration } };
}

/** Splice the authored effect+scope onto the original entry, preserving metadata. */
export function buildEntry(original: Json, form: Json): Json {
  const { effect, scope } = assembleEffect(form);
  return { ...original, effect, scope, community_notes: "community-authored from 10e source (provisional 11e); see #21" };
}

const BEHAVIOR_VALUES = new Set(["passive", "activated", "reactive", "aura"]);

// ─── canonical-key lint ──────────────────────────────────────────────
//
// The full-tree repair model emits the whole effect node, including the open
// `modifier` object. AJV permits any modifier key (additionalProperties:true),
// so an invented key (`weapon_keyword`, `model_filter`, `critical_threshold`)
// passes schema validation — but the cruncher reads ONLY the canonical keys, so
// an ignored filter on an `add` operation silently OVER-APPLIES the buff. The
// verifier can't catch this: it judges the JSON against the rule as a reader,
// not against what the engine honors. This lint is the deterministic gate.
//
// Vocabulary is calibrated to what EXISTING enrichment data actually uses (not
// world-eaters alone): `keywords` array is the dominant keyword-grant form,
// `damage-reduction` uses `reduction`, and `stat` spans the full statline. The
// lint only runs on NEW repair proposals, so strictness can't regress shipped
// data — a rejected proposal just stays residue for hand-authoring.

/** Modifier keys the cruncher / canonical conventions recognise, per leaf type. */
const CANONICAL_MODIFIER_KEYS: Record<string, Set<string>> = {
  // weapon_type/weapon_name are valid narrowing keys (gold uses weapon_name): the
  // cruncher honors weapon_type as a phase gate and fail-safes (unsupported) on
  // weapon_name, so the data can carry them without risking a silent over-apply.
  "stat-modifier": new Set(["stat", "operation", "value", "attack_type", "weapon_type", "weapon_name", "weapon_keyword"]),
  "roll-modifier": new Set(["roll", "operation", "value", "attack_type", "weapon_type", "weapon_name", "weapon_keyword", "critical_on", "uses", "context"]),
  "re-roll": new Set(["roll", "subset", "attack_type", "weapon_type", "weapon_name", "weapon_keyword", "max_rerolls", "uses", "context"]),
  "keyword-grant": new Set(["keyword", "keywords", "weapon_type", "weapon_name", "weapon_keyword"]),
  "bs-modifier": new Set(["operation", "value", "attack_type"]),
  "feel-no-pain": new Set(["threshold"]),
  "damage-reduction": new Set(["reduction", "amount"]),
};
const CANONICAL_STATS = new Set(["A", "S", "T", "Sv", "AP", "OC", "Ld", "M", "W", "D", "Damage", "BS", "WS"]);
const CANONICAL_ROLLS = new Set(["hit", "wound", "save", "charge", "damage", "advance", "any", "all"]);
const CANONICAL_SUBSETS = new Set(["ones", "all-failures"]);
const CANONICAL_ATTACK_TYPES = new Set(["melee", "ranged"]);

/**
 * Walk an effect tree and flag any cruncher-interpreted leaf whose modifier
 * carries an unknown key or an out-of-vocabulary stat/roll/subset/attack_type.
 * Non-interpreted leaf types (ability-grant, movement-modifier, …) are left
 * permissive — they don't reach the damage path, so an unknown key there is a
 * consistency nit, not a silent-corruption risk.
 */
export function lintCanonical(effect: Json): { canonical: boolean; issues: string[] } {
  const issues: string[] = [];
  // A simple condition is {type, parameters?, negated?}; every param lives UNDER
  // `parameters`. The cruncher reads condition.parameters.* only, and AJV doesn't
  // forbid stray top-level keys, so a param placed top-level (e.g.
  // {type:"unit-has-keyword", keyword:"X"}) silently makes the condition
  // unevaluatable — the buff never fires. Existing data is 680 nested / 0 top-level.
  const visitCondition = (c: Json): void => {
    if (!c || typeof c !== "object") return;
    if (Array.isArray(c.operands)) return c.operands.forEach(visitCondition); // compound {operator, operands}
    if (typeof c.type === "string") {
      for (const k of Object.keys(c)) if (k !== "type" && k !== "parameters" && k !== "negated") issues.push(`condition ${c.type}: param "${k}" must live under "parameters"`);
    }
  };
  const visit = (node: Json): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const type = node.type as string | undefined;
    const allow = type ? CANONICAL_MODIFIER_KEYS[type] : undefined;
    if (allow && node.modifier && typeof node.modifier === "object") {
      const m = node.modifier as Record<string, unknown>;
      for (const k of Object.keys(m)) if (!allow.has(k)) issues.push(`${type}: non-canonical modifier key "${k}"`);
      if (type === "stat-modifier" && m.stat != null && !CANONICAL_STATS.has(String(m.stat))) issues.push(`stat-modifier: unknown stat "${String(m.stat)}"`);
      if ((type === "roll-modifier" || type === "re-roll") && m.roll != null && !CANONICAL_ROLLS.has(String(m.roll))) issues.push(`${type}: unknown roll "${String(m.roll)}"`);
      if (m.subset != null && !CANONICAL_SUBSETS.has(String(m.subset))) issues.push(`${type}: unknown subset "${String(m.subset)}"`);
      if (m.attack_type != null && !CANONICAL_ATTACK_TYPES.has(String(m.attack_type))) issues.push(`${type}: unknown attack_type "${String(m.attack_type)}"`);
    }
    if (node.condition) visitCondition(node.condition);
    // Recurse through the wrapper kinds (conditional/sequence/choice/dice-*).
    for (const key of ["effect", "steps", "options", "on_success", "on_fail"]) if (node[key]) visit(node[key]);
  };
  visit(effect);
  return { canonical: issues.length === 0, issues };
}

/**
 * Splice a pre-formed nested effect tree (from the repair pass) onto the original
 * entry. Unlike {@link buildEntry} the LLM owns the whole tree, so we only graft
 * `effect`/`scope`/`behavior` and the citation — never the flat-form assembly.
 * `behavior` is an ability-level field; only set it when the model returned a
 * valid enum value (an invalid one would just fail AJV and lose the whole entry).
 */
export function buildRepairedEntry(original: Json, effect: Json, scope: Json, behavior?: string): Json {
  const entry: Json = { ...original, effect, scope, community_notes: "community-authored from 10e source (provisional 11e); see #21" };
  if (behavior && BEHAVIOR_VALUES.has(behavior)) entry.behavior = behavior;
  return entry;
}

// ─── apply gate ──────────────────────────────────────────────────────

export interface GateOpts { minConfidence: "high" | "medium"; includeComplex: boolean }

/** Whether a proposal is safe to apply automatically. */
export function passesGate(p: Proposal, opts: GateOpts): boolean {
  if (!p.schema_valid || !p.final_faithful) return false;
  if (p.confidence === "low") return false;
  if (opts.minConfidence === "high" && p.confidence !== "high") return false;
  // A repaired proposal IS the full nested tree, so `complex` no longer means
  // "couldn't express it" — the AJV + verifier gate already proved it expresses
  // the rule faithfully. It must also clear the canonical-key lint so an invented
  // modifier key can't silently over-apply. The complex-exclusion only applies to
  // flat-form output.
  if (p.repaired) return p.canonical !== false;
  if (p.complex && !opts.includeComplex) return false;
  return true;
}

// ─── batching helpers ────────────────────────────────────────────────

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const classifyUserPrompt = (items: Json[]): string =>
  `Classify each ability below. Return results[] (one per ability, echo its ability_id):\n\n` +
  items.map((it) => `- ability_id: ${it.ability_id}\n  name: ${it.name}\n  rule: ${it.src?.description ?? "(none)"}`).join("\n");

export const verifyUserPrompt = (entries: { ability_id: string; rule: string; effect: Json; scope: Json }[]): string =>
  `Judge each authored DSL against its rule. Return results[] (one per ability, echo its ability_id):\n\n` +
  entries.map((e) => `- ability_id: ${e.ability_id}\n  rule: ${e.rule}\n  authored: ${JSON.stringify({ effect: e.effect, scope: e.scope })}`).join("\n");

export const repairUserPrompt = (items: { ability_id: string; rule: string; draft: Json; issue: string }[]): string =>
  `Repair each ability's DSL. Emit the full nested effect tree + scope + behavior that fixes the stated gap. Return results[] (one per ability, echo its ability_id):\n\n` +
  items.map((it) =>
    `- ability_id: ${it.ability_id}\n  rule: ${it.rule || "(none)"}\n  draft_effect: ${JSON.stringify(it.draft ?? null)}\n  gap_to_fix: ${it.issue || "(verifier produced no issue — re-author faithfully from the rule)"}`,
  ).join("\n\n");

// ─── propose ─────────────────────────────────────────────────────────

interface ProposeOpts { batch: number; model: string }

async function proposeFaction(faction: string, opts: ProposeOpts, validate: (x: unknown) => boolean): Promise<Json> {
  const inputPath = resolve(INPUT_DIR, `${faction}.json`);
  if (!existsSync(inputPath)) return { faction, skipped: "no author-input" };
  const input: Json[] = readJSON(inputPath).filter((e: Json) => e.resolved);
  if (input.length === 0) return { faction, skipped: "no resolved stubs" };

  const original = new Map<string, Json>();
  for (const a of readJSON(resolve(ENRICHMENT_ROOT, faction, "abilities.json")) as Json[]) original.set(a.ability_id, a);

  const proposals: Proposal[] = [];
  for (const batch of chunk(input, opts.batch)) {
    let forms: Json[];
    try {
      ({ results: forms } = await callClaude(CLASSIFY_SYSTEM, classifyUserPrompt(batch), CLASSIFY_SCHEMA, opts.model));
    } catch (e) {
      // One flaky call shouldn't sink the run — record the batch as errored and move on.
      process.stderr.write(`  ${faction}: classify batch failed (${(e as Error).message.slice(0, 80)}) — skipping ${batch.length}\n`);
      for (const it of batch) proposals.push({ ability_id: it.ability_id, name: it.name, faction, schema_valid: false, final_faithful: false, error: "classify call failed" });
      continue;
    }
    const byId = new Map<string, Json>(forms.map((f: Json) => [f.ability_id, f]));

    const built: { it: Json; form: Json; entry: Json; schemaValid: boolean }[] = [];
    for (const it of batch) {
      const form = byId.get(it.ability_id);
      const orig = original.get(it.ability_id);
      if (!form || !orig) {
        proposals.push({ ability_id: it.ability_id, name: it.name, faction, schema_valid: false, final_faithful: false, error: !form ? "no classification" : "no original entry" });
        continue;
      }
      const entry = buildEntry(orig, form);
      built.push({ it, form, entry, schemaValid: validate(entry) });
    }

    const toVerify = built.filter((b) => b.schemaValid);
    const verdicts = new Map<string, Json>();
    if (toVerify.length > 0) {
      try {
        const { results } = await callClaude(VERIFY_SYSTEM,
          verifyUserPrompt(toVerify.map((b) => ({ ability_id: b.it.ability_id, rule: b.it.src?.description ?? "", effect: b.entry.effect, scope: b.entry.scope }))),
          VERIFY_SCHEMA, opts.model);
        for (const v of results) verdicts.set(v.ability_id, v);
      } catch (e) {
        // Verify failure → leave verdicts null (proposal kept, just not auto-gateable).
        process.stderr.write(`  ${faction}: verify batch failed (${(e as Error).message.slice(0, 80)})\n`);
      }
    }

    for (const b of built) {
      const verdict = verdicts.get(b.it.ability_id) ?? null;
      proposals.push({
        ability_id: b.it.ability_id, name: b.it.name, faction,
        effect_type: b.form.effect_type, complex: b.form.complex, confidence: b.form.confidence,
        schema_valid: b.schemaValid, proposed_effect: b.entry.effect, proposed_scope: b.entry.scope,
        verdict, final_faithful: !!verdict?.faithful && b.schemaValid,
      });
    }
    process.stderr.write(`  ${faction}: ${proposals.length}/${input.length}\n`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeJSON(resolve(OUT_DIR, `${faction}.json`), proposals);
  return {
    faction, total: proposals.length,
    schema_valid: proposals.filter((p) => p.schema_valid).length,
    faithful: proposals.filter((p) => p.final_faithful).length,
    gateable: proposals.filter((p) => passesGate(p, { minConfidence: "medium", includeComplex: false })).length,
  };
}

// ─── repair (full-tree pass over the residue) ────────────────────────

interface RepairOpts { batch: number; model: string; types?: Set<string> }

/**
 * Re-author the complex residue in proposed/<faction>.json as full nested DSL.
 * Reuses the propose pipeline shape — classify(→repair)/assemble/AJV/verify —
 * but the model emits the whole effect tree and we seed it with the existing
 * draft + the verifier's gap. Updates the proposals in place (matched by
 * ability_id), tagging each `repaired:true`; the already-gateable and the errored
 * entries are left untouched.
 */
async function repairFaction(faction: string, opts: RepairOpts, validate: (x: unknown) => boolean): Promise<Json> {
  const proposalsPath = resolve(OUT_DIR, `${faction}.json`);
  if (!existsSync(proposalsPath)) return { faction, skipped: "no proposals — run propose first" };
  const proposals: Proposal[] = readJSON(proposalsPath);
  const gate = { minConfidence: "medium" as const, includeComplex: false };

  // Residue = not already auto-appliable, not a hard error. Phase A narrows to
  // the cruncher-relevant leaf types via --types.
  const targets = proposals
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => !passesGate(p, gate) && !p.error)
    .filter(({ p }) => !opts.types || (p.effect_type != null && opts.types.has(p.effect_type)));
  if (targets.length === 0) return { faction, skipped: "no matching residue" };

  // Source rules (the gap the draft must close) + originals (metadata + AJV).
  const inputPath = resolve(INPUT_DIR, `${faction}.json`);
  const srcById = new Map<string, string>();
  if (existsSync(inputPath)) for (const e of readJSON(inputPath) as Json[]) if (e.src?.description) srcById.set(e.ability_id, e.src.description);
  const original = new Map<string, Json>();
  for (const a of readJSON(resolve(ENRICHMENT_ROOT, faction, "abilities.json")) as Json[]) original.set(a.ability_id, a);

  let done = 0;
  for (const batch of chunk(targets, opts.batch)) {
    let results: Json[];
    try {
      ({ results } = await callClaude(REPAIR_SYSTEM,
        repairUserPrompt(batch.map(({ p }) => ({ ability_id: p.ability_id, rule: srcById.get(p.ability_id) ?? "", draft: p.proposed_effect, issue: p.verdict?.issue ?? "" }))),
        REPAIR_SCHEMA, opts.model));
    } catch (e) {
      process.stderr.write(`  ${faction}: repair batch failed (${(e as Error).message.slice(0, 80)}) — skipping ${batch.length}\n`);
      continue;
    }
    const byId = new Map<string, Json>(results.map((r: Json) => [r.ability_id, r]));

    const built: { idx: number; p: Proposal; r: Json; entry: Json; schemaValid: boolean; canonical: boolean }[] = [];
    for (const { p, idx } of batch) {
      const r = byId.get(p.ability_id);
      const orig = original.get(p.ability_id);
      if (!r || !orig) continue; // model dropped it / live entry gone — leave the proposal as-is
      const entry = buildRepairedEntry(orig, r.effect, r.scope, r.behavior);
      built.push({ idx, p, r, entry, schemaValid: validate(entry), canonical: lintCanonical(r.effect).canonical });
    }

    // Verify only what can still pass the gate — a non-canonical entry can't, so
    // don't spend a verify call on it.
    const toVerify = built.filter((b) => b.schemaValid && b.canonical);
    const verdicts = new Map<string, Json>();
    if (toVerify.length > 0) {
      try {
        const { results: vs } = await callClaude(VERIFY_SYSTEM,
          verifyUserPrompt(toVerify.map((b) => ({ ability_id: b.p.ability_id, rule: srcById.get(b.p.ability_id) ?? "", effect: b.entry.effect, scope: b.entry.scope }))),
          VERIFY_SCHEMA, opts.model);
        for (const v of vs) verdicts.set(v.ability_id, v);
      } catch (e) {
        process.stderr.write(`  ${faction}: repair-verify batch failed (${(e as Error).message.slice(0, 80)})\n`);
      }
    }

    for (const b of built) {
      const verdict = verdicts.get(b.p.ability_id) ?? null;
      const behavior = b.r.behavior && BEHAVIOR_VALUES.has(b.r.behavior) ? b.r.behavior : undefined;
      proposals[b.idx] = {
        ...b.p,
        confidence: b.r.confidence ?? b.p.confidence,
        schema_valid: b.schemaValid,
        canonical: b.canonical,
        proposed_effect: b.entry.effect,
        proposed_scope: b.entry.scope,
        proposed_behavior: behavior,
        verdict,
        final_faithful: !!verdict?.faithful && b.schemaValid && b.canonical,
        repaired: true,
        unencodable: !!b.r.unencodable,
      };
    }
    done += batch.length;
    process.stderr.write(`  ${faction}: repaired ${done}/${targets.length}\n`);
  }

  writeJSON(proposalsPath, proposals);
  const repaired = proposals.filter((p) => p.repaired);
  return {
    faction, attempted: targets.length,
    now_faithful: repaired.filter((p) => p.final_faithful).length,
    non_canonical: repaired.filter((p) => p.canonical === false).length,
    unencodable: repaired.filter((p) => p.unencodable).length,
    gateable: proposals.filter((p) => passesGate(p, gate)).length,
  };
}

// ─── apply ───────────────────────────────────────────────────────────

interface ApplyOpts extends GateOpts { dryRun: boolean }

/** Splice gated proposals into the live abilities.json — only over surviving stubs. */
function applyFaction(faction: string, opts: ApplyOpts): Json {
  const proposalsPath = resolve(OUT_DIR, `${faction}.json`);
  if (!existsSync(proposalsPath)) return { faction, skipped: "no proposals — run propose first" };
  const proposals: Proposal[] = readJSON(proposalsPath);
  const abilitiesPath = resolve(ENRICHMENT_ROOT, faction, "abilities.json");
  if (!existsSync(abilitiesPath)) return { faction, skipped: "no live abilities.json" };
  const abilities: Json[] = readJSON(abilitiesPath);
  const byId = new Map<string, Json>(abilities.map((a) => [a.ability_id, a]));

  let applied = 0;
  const skipped: { id: string; why: string }[] = [];
  for (const p of proposals) {
    if (!passesGate(p, opts)) { skipped.push({ id: p.ability_id, why: "gate" }); continue; }
    const entry = byId.get(p.ability_id);
    if (!entry) { skipped.push({ id: p.ability_id, why: "gone" }); continue; }
    // Never clobber work that's no longer a stub (idempotent + safe to re-run).
    if (!hasEmptyModifier(entry.effect)) { skipped.push({ id: p.ability_id, why: "not-a-stub" }); continue; }
    entry.effect = p.proposed_effect;
    entry.scope = p.proposed_scope;
    if (p.proposed_behavior && BEHAVIOR_VALUES.has(p.proposed_behavior)) entry.behavior = p.proposed_behavior;
    entry.community_notes = "community-authored from 10e source (provisional 11e); see #21";
    applied++;
  }
  if (!opts.dryRun && applied > 0) writeJSON(abilitiesPath, abilities);
  return { faction, applied, skipped_gate: skipped.filter((s) => s.why === "gate").length, skipped_other: skipped.filter((s) => s.why !== "gate").length, dry_run: opts.dryRun };
}

// ─── review (cluster proposals into shape-families) ──────────────────

/** Load every faction's proposals (skips the ad-hoc damage-batch scratch file). */
function loadAllProposals(): Proposal[] {
  if (!existsSync(OUT_DIR)) return [];
  return readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".json") && f !== "damage-batch.json")
    .flatMap((f) => readJSON(resolve(OUT_DIR, f)) as Proposal[]);
}

/** Write a shape-family clustered REVIEW.md — gateable vs the complex residue, grouped for templating. */
function review(): Json {
  const all = loadAllProposals();
  const gate = { minConfidence: "medium" as const, includeComplex: false };
  const gateable = all.filter((p) => passesGate(p, gate));
  const residue = all.filter((p) => !passesGate(p, gate) && !p.error);

  const byType = (ps: Proposal[]): [string, number][] =>
    Object.entries(ps.reduce<Record<string, number>>((m, p) => ((m[p.effect_type ?? "?"] = (m[p.effect_type ?? "?"] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);

  // Cross-faction name dupes among the residue — author once, fan to all members.
  const byName = new Map<string, Proposal[]>();
  for (const p of residue) (byName.get(p.name) ?? byName.set(p.name, []).get(p.name)!).push(p);
  const shared = [...byName.entries()].filter(([, ps]) => new Set(ps.map((p) => p.faction)).size > 1)
    .map(([name, ps]) => ({ name, type: ps[0].effect_type, factions: [...new Set(ps.map((p) => p.faction))] }))
    .sort((a, b) => b.factions.length - a.factions.length);

  const L: string[] = [
    "# DSL stub authoring — review",
    "",
    `Generated by \`author-batch review\`. ${all.length} proposals across ${new Set(all.map((p) => p.faction)).size} factions.`,
    "",
    `- **schema-valid:** ${all.filter((p) => p.schema_valid).length}`,
    `- **verifier-faithful:** ${all.filter((p) => p.final_faithful).length}`,
    `- **complex-flagged:** ${all.filter((p) => p.complex).length}`,
    `- **auto-appliable (gate: valid+faithful+conf≠low+not-complex):** ${gateable.length}`,
    "",
    "## Auto-appliable now — by faction",
    "",
    ...Object.entries(gateable.reduce<Record<string, number>>((m, p) => ((m[p.faction] = (m[p.faction] ?? 0) + 1), m), {})).sort().map(([f, n]) => `- \`${f}\`: ${n}`),
    "",
    "Apply with: `npm run author:apply -- <faction|--all> --dry-run` then drop `--dry-run`.",
    "",
    "## Complex residue — by shape family (author a template per family)",
    "",
    ...byType(residue).map(([t, n]) => `- **${t}** — ${n}`),
    "",
    "## Cross-faction shared shapes (author once, fan to all members)",
    "",
    ...(shared.length ? shared.map((s) => `- **${s.name}** (\`${s.type}\`) → ${s.factions.join(", ")}`) : ["_(none found)_"]),
    "",
  ];
  writeFileSync(resolve(OUT_DIR, "REVIEW.md"), L.join("\n") + "\n");
  return { total: all.length, gateable: gateable.length, residue: residue.length, shared_shapes: shared.length };
}

// ─── main ────────────────────────────────────────────────────────────

function factionList(arg: string, dir: string): string[] {
  return arg === "--all"
    ? readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "damage-batch.json").map((f) => f.replace(/\.json$/, "")).sort()
    : [arg];
}
const flag = (argv: string[], name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const target = argv[1];
  if (mode === "review") {
    console.log(JSON.stringify(review(), null, 2));
    console.error(`\nWrote ${resolve(OUT_DIR, "REVIEW.md")}`);
    return;
  }
  if (!["propose", "repair", "apply"].includes(mode) || !target) {
    console.error("Usage:\n  author-batch propose <faction|--all> [--batch N] [--model M]\n  author-batch repair  <faction|--all> [--types t1,t2] [--batch N] [--model M]\n  author-batch apply   <faction|--all> [--min-confidence high|medium] [--include-complex] [--dry-run]\n  author-batch review");
    process.exit(1);
  }

  if (mode === "propose") {
    const ajv = createValidator();
    const validateFn = ajv.getSchema(ABILITY_SCHEMA_ID);
    if (!validateFn) throw new Error(`ability schema not loaded: ${ABILITY_SCHEMA_ID}`);
    const validate = (x: unknown): boolean => !!validateFn(x);
    const opts: ProposeOpts = { batch: Number(flag(argv, "--batch")) || 15, model: flag(argv, "--model") ?? "claude-haiku-4-5" };
    const summary: Json[] = [];
    for (const f of factionList(target, INPUT_DIR)) {
      try {
        summary.push(await proposeFaction(f, opts, validate));
      } catch (e) {
        process.stderr.write(`  ${f}: FAILED (${(e as Error).message.slice(0, 100)})\n`);
        summary.push({ faction: f, error: (e as Error).message });
      }
    }
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (mode === "repair") {
    const ajv = createValidator();
    const validateFn = ajv.getSchema(ABILITY_SCHEMA_ID);
    if (!validateFn) throw new Error(`ability schema not loaded: ${ABILITY_SCHEMA_ID}`);
    const validate = (x: unknown): boolean => !!validateFn(x);
    const typesArg = flag(argv, "--types");
    const opts: RepairOpts = {
      batch: Number(flag(argv, "--batch")) || 8,
      model: flag(argv, "--model") ?? "claude-sonnet-4-6",
      types: typesArg ? new Set(typesArg.split(",").map((t) => t.trim()).filter(Boolean)) : undefined,
    };
    const summary: Json[] = [];
    for (const f of factionList(target, OUT_DIR)) {
      try {
        summary.push(await repairFaction(f, opts, validate));
      } catch (e) {
        process.stderr.write(`  ${f}: FAILED (${(e as Error).message.slice(0, 100)})\n`);
        summary.push({ faction: f, error: (e as Error).message });
      }
    }
    console.log(JSON.stringify(summary, null, 2));
    const unenc = summary.reduce((n, s) => n + (s.unencodable ?? 0), 0);
    const faithful = summary.reduce((n, s) => n + (s.now_faithful ?? 0), 0);
    const noncanon = summary.reduce((n, s) => n + (s.non_canonical ?? 0), 0);
    console.error(`\nrepair: ${faithful} now faithful, ${noncanon} non-canonical (gate-blocked), ${unenc} flagged unencodable (need hand-authoring).`);
    return;
  }

  // apply
  const opts: ApplyOpts = {
    minConfidence: flag(argv, "--min-confidence") === "high" ? "high" : "medium",
    includeComplex: argv.includes("--include-complex"),
    dryRun: argv.includes("--dry-run"),
  };
  const summary = factionList(target, OUT_DIR).map((f) => applyFaction(f, opts));
  console.log(JSON.stringify(summary, null, 2));
  const total = summary.reduce((n, s) => n + (s.applied ?? 0), 0);
  console.error(`\n${opts.dryRun ? "[dry-run] would apply" : "applied"} ${total} entr${total === 1 ? "y" : "ies"}.`);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\.\w+$/, "") === fileURLToPath(import.meta.url).replace(/\.\w+$/, "");
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
