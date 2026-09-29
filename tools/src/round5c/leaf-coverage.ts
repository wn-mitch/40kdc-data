import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileLeaves, type CompileLeaf, type Compiled } from "./compile.js";
import { REVIEWED_FAMILY_REGISTRY, type SemanticFamilyDefinition } from "./contracts.js";
import { boundedCombinations, familyCombinations } from "./leaf-coverage-samples.js";

/**
 * Step-8 leaf coverage: proof, by actually compiling, that every DSL type in the schema catalog
 * (single effects, containers, condition predicates, trigger events, durations, usage
 * frequencies, and a handful of behavior flags) can be produced by some reviewed leaf family.
 *
 * The inventory (catalogInventory) mirrors `_private/phase4/matrix2/census.py`'s schema-reading
 * step exactly (same four schema files, same closed unions, same five behavior-flag markers).
 * Production differs from that script on purpose: census.py classified a type as covered by
 * grepping for its literal string in round5c source files, which both over- and under-counts
 * (a type can appear in a comment or an unrelated table, and a mapped/computed value such as
 * `event:charge` -> `move-ended` never appears as its own literal anywhere). This module instead
 * builds each reviewed family's leaves for every one of its valid parameter combinations
 * (`familyCombinations` in `leaf-coverage-samples.ts`, in the same spirit as `leaf-describer-audit.ts`'s own
 * `combinations()`: a product over each parameter's domain, `x-only-when` applied in dependency
 * order, invalid combinations dropped by re-running them through `normalizeFingerprintParameters`
 * -- widened here to also flatten `oneOf` the way that file flattens `anyOf`, sample a `pattern`
 * property against a few representative strings, and fall back to a family's own `starter`
 * example for a property shape neither of those covers, since production needs every schema-valid
 * family to yield at least one combination, not just enough samples to audit describer wording),
 * compiles them through the real compiler (`compileLeaves`), and walks the compiled DSL tree for
 * the literals that actually came out the other end.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
const schemaRoot = join(repoRoot, "schemas");

function loadJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export type CatalogKind = "effect" | "container" | "predicate" | "trigger" | "duration" | "usage" | "behavior";
export type CatalogEntry = { kind: CatalogKind; type: string };

/** The five behavior markers census.py tracks by name, ported as-is. */
const BEHAVIOR_FLAGS = ["aura.range_cap", "unit-rating.rating=true", "cost-modifier.multiply", "counts_as_move", "wholly"];

/** Every DSL type the schema catalog defines, derived from the schema files (not hand-listed). */
export function catalogInventory(): CatalogEntry[] {
  const effectSchema = loadJson(join(schemaRoot, "enrichment/ability-dsl/effect.schema.json"));
  const conditionSchema = loadJson(join(schemaRoot, "enrichment/ability-dsl/condition.schema.json"));
  const abilitySchema = loadJson(join(schemaRoot, "enrichment/ability-dsl/ability.schema.json"));
  const scopeSchema = loadJson(join(schemaRoot, "enrichment/ability-dsl/scope.schema.json"));
  const commonSchema = loadJson(join(schemaRoot, "$defs/common.schema.json"));

  const effectDefs = effectSchema.$defs as Record<string, Record<string, unknown>>;
  const singleEffect = effectDefs["single-effect"]!.oneOf as Array<{ properties: { type: { const: string } } }>;
  const singleEffectTypes = singleEffect.map((variant) => variant.properties.type.const);

  const effectNode = effectDefs["effect-node"]!.oneOf as Array<{ $ref: string }>;
  const containerTypes = effectNode
    .map((ref) => ref.$ref.split("/").at(-1)!)
    .filter((name) => name !== "single-effect")
    .map((name) => {
      const def = effectDefs[name]!;
      const props = (def.properties ?? {}) as Record<string, { const?: string }>;
      return props.type?.const ?? name;
    });

  const conditionDefs = conditionSchema.$defs as Record<string, Record<string, unknown>>;
  const simpleCondition = conditionDefs["simple-condition"]!.oneOf as Array<{ properties: { type: { const: string } } }>;
  const predicateTypes = simpleCondition.map((variant) => variant.properties.type.const);

  const commonDefs = commonSchema.$defs as Record<string, { enum: string[] }>;
  const triggerEvents = commonDefs["game-event"]!.enum;

  const scopeDefs = scopeSchema.$defs as Record<string, { enum: string[] }>;
  const scopeDurations = scopeDefs["scope-duration"]!.enum;

  const abilityDefs = abilitySchema.$defs as Record<string, { properties: { frequency: { enum: string[] } } }>;
  const usageFrequencies = abilityDefs["ability-usage-limit"]!.properties.frequency.enum;

  return [
    ...singleEffectTypes.map((type): CatalogEntry => ({ kind: "effect", type })),
    ...containerTypes.map((type): CatalogEntry => ({ kind: "container", type })),
    ...predicateTypes.map((type): CatalogEntry => ({ kind: "predicate", type })),
    ...triggerEvents.map((type): CatalogEntry => ({ kind: "trigger", type })),
    ...scopeDurations.map((type): CatalogEntry => ({ kind: "duration", type })),
    ...usageFrequencies.map((type): CatalogEntry => ({ kind: "usage", type })),
    ...BEHAVIOR_FLAGS.map((type): CatalogEntry => ({ kind: "behavior", type: `BEHAVIOR:${type}` })),
  ];
}

// ------------------------------------------------------------------------------------------
// Production: compile every active family's every valid parameter combination.
// ------------------------------------------------------------------------------------------

let offset = 0;
function nextByte(): number {
  offset += 10;
  return offset;
}

function leafOf(role: string, familyId: string, parameters: Record<string, unknown>, version = 1, fragment?: string): CompileLeaf {
  return { role, family_id: familyId, family_version: version, parameters, start_byte: nextByte(), ...(fragment !== undefined ? { fragment } : {}) };
}

/** A minimal effect to pair with a lone CONDITION/EVENT/DURATION/RESTRICTION leaf, as the existing compiler tests do. */
function healLeaf(fragment?: string): CompileLeaf {
  return leafOf("EFFECT", "regain-wounds", { subject: "this-unit", amount: "1" }, 2, fragment);
}

/** Two more option leaves for the container-opener families, so their opener actually gets options. */
const CONTAINER_OPENER_FOLLOWUPS: Partial<Record<string, () => CompileLeaf[]>> = {
  "choice-open": () => [
    leafOf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
    leafOf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
  ],
  "stance-select-open": () => [
    leafOf("EVENT", "named-option", { label: "Conqueror Doctrine" }, 1, "B"),
    leafOf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
    leafOf("EVENT", "named-option", { label: "Ballistic Doctrine" }, 1, "C"),
    leafOf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
  ],
  "issue-orders-open": () => [
    leafOf("EVENT", "named-option", { label: "First Rank, Fire!" }, 1, "B"),
    leafOf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
    leafOf("EVENT", "named-option", { label: "Take Aim!" }, 1, "C"),
    leafOf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
  ],
  "dice-pool-allocation-open": () => [
    leafOf("EVENT", "named-option", { label: "Path of Slaughter", requirement_type: "pair", requirement_min_value: 3 }, 1, "B"),
    leafOf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
    leafOf("EVENT", "named-option", { label: "Path of Rage", requirement_type: "triple", requirement_min_value: 4 }, 1, "C"),
    leafOf("EFFECT", "invulnerable-save", { subject: "this-model", threshold: 4 }, 1, "C"),
  ],
  "risk-reward-open": () => [
    leafOf("EVENT", "on-fail-open", {}, 1, "B"),
    leafOf("EFFECT", "mortal-wounds", { recipient: "this-model", count: "1" }, 1, "B"),
    leafOf("EFFECT", "fights-first", { subject: "this-model" }, 1, "C"),
  ],
  "resource-action-menu-open": () => [
    leafOf("EVENT", "menu-action", { action_id: "swift", label: "Swift", cost_amount: 1 }, 2, "B"),
    leafOf("EVENT", "event", { kind: "phase-start", phase: "movement", turn: "your" }, 8, "B"),
    leafOf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
  ],
  "persistent-designation-open": () => [
    leafOf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
  ],
  "select-objective-open": () => [
    leafOf("EFFECT", "fights-first", { subject: "this-model" }, 1, "B"),
  ],
};

/**
 * Families whose parameter schema is nested deeply enough (`$ref`-composed sub-objects with their
 * own *required* fields) that no sweep — full product or bounded — can synthesize a concrete
 * value for them at all: `domain()` returns `[]` for a required object field with no starter
 * example, so every combination is invalid. `named-region-state` (flow-of-magic-thousand-sons,
 * pinned by `round5c-compile-named-region.test.ts`) is the only reviewed family shaped this way;
 * everything else goes through `boundedCombinations` below.
 */
const FIXED_PARAMETERS: Partial<Record<string, Array<Record<string, unknown>>>> = {
  "named-region-state": [
    {
      region_id: "flow-of-magic", owner_faction: "thousand-sons", behavior: "aura", membership_scope: "model",
      beneficiary_operator: "and", beneficiary_keywords: ["THOUSAND SONS"], beneficiary_faction: "thousand-sons",
      default_branch: { kind: "reroll", roll: "wound", subset: "ones", weapon_keyword: "Psychic", optional: false },
      qualified_branch: { kind: "roll-modifier", roll: "wound", operation: "add", value: 1, weapon_keyword: "Psychic", optional: false },
    },
  ],
  // pool_gain/pool_spend are optional, but each is a required-shaped nested object with no
  // starter example, so a bounded sample (which only ever varies one property from a baseline)
  // never includes either — the same reason named-region-state needs a hand-picked set.
  "resource-action-menu-open": [
    {
      menu_id: "agile-manoeuvres", pool_id: "battle-focus-pool", unit_max_manoeuvres_per_phase: 1, default_manoeuvre_max_per_phase: 1,
      pool_gain: { trigger: "round-started", amount: "variable", label: "Battle Focus token" },
      pool_spend: { trigger: "round-ended", amount: "all", label: "Battle Focus token" },
    },
  ],
};

/**
 * Families whose independent optional properties are numerous enough that the full cross-product
 * (`familyCombinations` in `leaf-coverage-samples.ts`) is too large to build (`menu-action`'s ~11 independent optional
 * properties once OOM'd the sweep) — `boundedCombinations` samples instead of multiplying: one
 * baseline (every required field, no optionals) plus one variant per optional property in
 * isolation. This is O(properties), not O(values-per-property^properties); it does not reach
 * combinations that need two or more properties set together (`test`'s enemy/friendly filtered
 * target needs `target`+`range`+`within_inches` all at once), but the coverage gate only needs
 * one compiling combination per catalog type, which the baseline alone already supplies — the
 * exact record shapes stay covered by their own pinned tests, not this sweep.
 */
const BOUNDED_SAMPLE_FAMILIES = new Set(["menu-action", "test", "test-exemption"]);

/**
 * `trigger`/`when` are the only fields whose value is genuinely a trigger node (or an array of
 * alternatives); once inside one, `event` counts. `parameters` holds a predicate's own payload —
 * data, not further compiled-DSL structure — so descending through it always leaves trigger
 * context, even when the parameters happen to carry their own `event` (a `happened` condition's
 * own history filter reuses the game-event enum for what it checks, which is not the same as the
 * ability's own firing moment).
 */
const TRIGGER_KEYS = new Set(["trigger", "when"]);

function addLiteral(into: Map<string, Set<string>>, bucket: string, value: string): void {
  const set = into.get(bucket);
  if (set) set.add(value); else into.set(bucket, new Set([value]));
}

/**
 * Walk a compiled DSL node, collecting every literal by the catalog kind it actually sits in —
 * not by its object key alone, which several unrelated shapes reuse (`set-up` is both a movement
 * EFFECT's own `type` and the unconnected `set-up` trigger's `event`; a `happened` condition's
 * `type` reuses the same key a container's own `type` does). `type` becomes an effect/container
 * type unless the node also carries `parameters` (a predicate's own shape), in which case it's a
 * predicate type instead; `event` only counts while `inTrigger`. `duration`/`frequency` have no
 * such collision today, so they stay flat, key-name-only collectors.
 */
function collectLiterals(node: unknown, into: Map<string, Set<string>>, inTrigger = false): void {
  if (Array.isArray(node)) {
    for (const item of node) collectLiterals(item, into, inTrigger);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const isPredicate = "parameters" in record;
  if (typeof record.type === "string") addLiteral(into, isPredicate ? "predicate" : "type", record.type);
  if (inTrigger && typeof record.event === "string") addLiteral(into, "trigger", record.event);
  if (typeof record.frequency === "string") addLiteral(into, "frequency", record.frequency);
  if (typeof record.duration === "string") addLiteral(into, "duration", record.duration);
  const modifier = record.modifier as Record<string, unknown> | undefined;
  if (record.type === "aura" && modifier?.range_cap != null) addLiteral(into, "behavior", "aura.range_cap");
  if (record.rating === true) addLiteral(into, "behavior", "unit-rating.rating=true");
  if (record.type === "cost-modifier" && modifier?.operation === "multiply") addLiteral(into, "behavior", "cost-modifier.multiply");
  if (record.counts_as_move !== undefined) addLiteral(into, "behavior", "counts_as_move");
  if ("wholly" in record) addLiteral(into, "behavior", "wholly");
  for (const [key, value] of Object.entries(record)) {
    collectLiterals(value, into, key === "parameters" ? false : inTrigger || TRIGGER_KEYS.has(key));
  }
}

/** The `Produced` key for one catalog entry: kind-namespaced, matching `collectLiterals`' buckets. */
function producedKey(entry: CatalogEntry): string {
  if (entry.kind === "behavior") return `behavior:${entry.type.slice("BEHAVIOR:".length)}`;
  const bucket = entry.kind === "effect" || entry.kind === "container" ? "type" : entry.kind === "usage" ? "frequency" : entry.kind;
  return `${bucket}:${entry.type}`;
}

export type Produced = Map<string, string[]>;

/** Build the leaves for one family/parameter combination, wrapping a lone non-EFFECT leaf as the compile tests do. */
function leavesFor(family: SemanticFamilyDefinition, parameters: Record<string, unknown>): CompileLeaf[] {
  const followups = CONTAINER_OPENER_FOLLOWUPS[family.id];
  const opener = leafOf(family.role, family.id, parameters, family.version, followups ? "A" : undefined);
  if (followups) return [opener, ...followups()];
  if (family.role === "EFFECT") return [opener];
  return [opener, healLeaf()];
}

/** Compile every active family's every valid parameter combination and record what each produces. */
export function produceLiterals(): Produced {
  const produced: Produced = new Map();
  const activeFamilies = REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated);
  for (const family of activeFamilies) {
    // A COMBINATOR ("instead") replaces an earlier effect of its own family; it owns no DSL type
    // of its own and only compiles inside a fuller ability (see the COMPOSED list).
    if (family.role === "COMBINATOR") continue;
    const combos = FIXED_PARAMETERS[family.id] ?? (BOUNDED_SAMPLE_FAMILIES.has(family.id) ? boundedCombinations(family) : familyCombinations(family));
    for (const parameters of combos) {
      let result: Compiled;
      try {
        result = compileLeaves(leavesFor(family, parameters));
      } catch {
        continue;
      }
      if (!result.ok) continue;
      const literals: Map<string, Set<string>> = new Map();
      collectLiterals(result.mechanics, literals);
      if (result.core) collectLiterals(result.core, literals);
      const key = `${family.id}@${family.version}`;
      for (const [bucket, values] of literals) {
        for (const value of values) {
          const literal = `${bucket}:${value}`;
          const existing = produced.get(literal);
          if (existing) { if (!existing.includes(key)) existing.push(key); } else produced.set(literal, [key]);
        }
      }
    }
  }
  return produced;
}

// ------------------------------------------------------------------------------------------
// RETIRED and COMPOSED: catalog types the production sweep above cannot and should not produce.
// ------------------------------------------------------------------------------------------

export type RetiredEntry = { type: string; reason: string };

/** Catalog types no reviewed family targets any more, on purpose. */
export const RETIRED: readonly RetiredEntry[] = [
  { type: "terrain-area-control", reason: "Superseded by the generic named-region-state template (batch 5); no reviewed family or authored record still uses this container." },
  { type: "one-use", reason: "Superseded by usage-limit's n-per-battle (count: 1) plus scope.duration: permanent; no reviewed family emits the one-use duration any more." },
];

export type ComposedEntry = { type: string; reason: string; pinnedTest: string };

/**
 * Catalog types no single reviewed family produces alone: the compiler only emits them from a
 * particular arrangement of two or more leaves (often from different families). Each is already
 * pinned by an existing compiler test, cited here rather than re-proven by this module.
 */
export const COMPOSED: readonly ComposedEntry[] = [
  {
    type: "dice-gated",
    reason: "Needs a dice-roll (EVENT) leaf plus one roll-result (CONDITION) band reaching the die's top face; dice-roll alone has no band to gate on.",
    pinnedTest: "tools/test/round5c-compile-containers.test.ts (dice-roll + roll-result -> dice-gated) and round5c-compose.test.ts:186",
  },
  {
    type: "dice-table",
    reason: "Needs a dice-roll leaf plus two or more disjoint roll-result bands; compile-dice.ts only builds a table once more than one band exists.",
    pinnedTest: "tools/test/round5c-compose.test.ts:171 and grey-knights-fidelity.test.ts:172",
  },
  {
    type: "roll",
    reason: "Needs dice-roll@2's roll_var plus a roll-result band binding to it; dice-roll@2 alone (no roll-result) has nothing to bind.",
    pinnedTest: "tools/test/round5c-compile-containers.test.ts:319 (dice-roll@2 roll_var binding)",
  },
  {
    type: "no-effect",
    reason: "Only appears filling a gap between two dice-table rows (compile-dice.ts); needs a dice-roll leaf and two roll-result bands that do not cover every face.",
    pinnedTest: "tools/test/round5c-compose.test.ts:172 (dice-table gap fill)",
  },
  {
    type: "designate-target",
    reason: "Needs a select-unit leaf plus a later attack leaf targeting that selection; select-unit alone (no attack) compiles to select-units instead.",
    pinnedTest: "tools/test/round5c-compose.test.ts:298",
  },
];

// ------------------------------------------------------------------------------------------
// leafCoverage(): the module's public verdict.
// ------------------------------------------------------------------------------------------

export type LeafCoverage = {
  produced: Produced;
  unproduced: string[];
};

/** Every catalog type, checked against what the compiler actually produces, composes, or has retired. */
export function leafCoverage(): LeafCoverage {
  const produced = produceLiterals();
  const composedTypes = new Set(COMPOSED.map((entry) => entry.type));
  const retiredTypes = new Set(RETIRED.map((entry) => entry.type));
  const unproduced: string[] = [];
  for (const entry of catalogInventory()) {
    if (produced.has(producedKey(entry)) || composedTypes.has(entry.type) || retiredTypes.has(entry.type)) continue;
    unproduced.push(`${entry.kind}:${entry.type}`);
  }
  return { produced, unproduced };
}

// ------------------------------------------------------------------------------------------
// CLI: `npx tsx src/round5c/leaf-coverage.ts` prints the table.
// ------------------------------------------------------------------------------------------

function printTable(): void {
  const { produced, unproduced } = leafCoverage();
  const composedTypes = new Set(COMPOSED.map((entry) => entry.type));
  const retiredTypes = new Set(RETIRED.map((entry) => entry.type));
  const rows = catalogInventory().map((entry) => {
    const families = produced.get(producedKey(entry));
    const state = families ? "produced" : composedTypes.has(entry.type) ? "composed" : retiredTypes.has(entry.type) ? "retired" : "MISSING";
    return { kind: entry.kind, type: entry.type, state, families: families?.join(", ") ?? "" };
  });
  const width = Math.max(...rows.map((row) => row.type.length), 4);
  for (const row of rows) {
    console.log(`${row.kind.padEnd(10)} ${row.type.padEnd(width)} ${row.state.padEnd(9)} ${row.families}`);
  }
  console.log("");
  console.log(`${rows.length} catalog types; ${rows.filter((row) => row.state === "produced").length} produced, ` +
    `${rows.filter((row) => row.state === "composed").length} composed, ${rows.filter((row) => row.state === "retired").length} retired, ` +
    `${unproduced.length} MISSING.`);
  if (unproduced.length) console.log(`Missing: ${unproduced.join(", ")}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) printTable();
