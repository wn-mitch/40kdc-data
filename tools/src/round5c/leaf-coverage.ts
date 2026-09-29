import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileLeaves, type CompileLeaf, type Compiled } from "./compile.js";
import { normalizeFingerprintParameters, REVIEWED_FAMILY_REGISTRY, type SemanticFamilyDefinition } from "./contracts.js";

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
 * (`familyCombinations` below, in the same spirit as `leaf-describer-audit.ts`'s own
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
    leafOf("EVENT", "menu-action", { action_id: "swift", label: "Swift", cost_amount: 1 }, 1, "B"),
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
 * own required fields) that even `familyCombinations`' `starter` fallback below cannot assemble a
 * concrete value: a hand-picked, schema-valid parameter set stands in for the combinatorial sweep
 * instead. `named-region-state` is the only reviewed family shaped this way; this is exactly the
 * flow-of-magic-thousand-sons case pinned by `round5c-compile-named-region.test.ts`.
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
};

type Schema = {
  enum?: readonly unknown[]; anyOf?: Schema[]; oneOf?: Schema[]; type?: string; minimum?: number; maximum?: number;
  items?: Schema; pattern?: string; const?: unknown; required?: string[]; "x-only-when"?: Record<string, readonly string[]>;
};

/** A handful of representative strings, tried against a `pattern` until one matches it. */
const PATTERN_CANDIDATES = ["test-id", "test-unit", "test-rule", "TEST KEYWORD", "Test Ability", "Lethal Hits", "Sustained Hits 1", "test"];

function sampleForPattern(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  const re = new RegExp(pattern.startsWith("^") ? pattern : `^(?:${pattern})$`, "u");
  return PATTERN_CANDIDATES.find((candidate) => re.test(candidate));
}

const isConcrete = (value: unknown): boolean => value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);

/**
 * Values to try for one parameter: every listed value, a couple of samples of an open one, or (for
 * a shape none of that structurally covers) the family's own `starter` example for this property,
 * when it is concrete rather than a placeholder.
 */
function domain(name: string, schema: Schema, starter: Record<string, unknown> | undefined): unknown[] {
  if (schema.const !== undefined) return [schema.const];
  if (schema.enum) return [...schema.enum];
  if (schema.type === "boolean") return [false, true];
  if (schema.type === "array") {
    if (schema.items?.enum) return [...schema.items.enum.map((value) => [value]), schema.items.enum.slice(0, 2)];
    const sample = sampleForPattern(schema.items?.pattern);
    if (sample) return [[sample]];
    if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
    return [["CHARACTER"]];
  }
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    const values: unknown[] = [];
    const listed = branches.flatMap((item) => item.enum ?? []);
    values.push(...listed.filter((value) => value !== "source"));
    const patterned = branches.map((item) => sampleForPattern(item.pattern)).find((value) => value !== undefined);
    if (patterned) values.push(patterned);
    if (branches.some((item) => item.type === "integer")) values.push(...(name === "threshold" ? [4, 5] : [1, 2]));
    // An object branch closed to one const-valued shape (buff-families.ts's abilityRatingSchema:
    // `{rating: true}`, the "or rated instead of numbered" alternative on a cap/value field).
    for (const branch of branches) {
      if (branch.type !== "object" || !branch.required) continue;
      const properties = ((branch as { properties?: Record<string, { const?: unknown }> }).properties) ?? {};
      if (branch.required.every((key) => "const" in (properties[key] ?? {}))) {
        values.push(Object.fromEntries(branch.required.map((key) => [key, properties[key]!.const])));
      }
    }
    if (values.length) return values;
    if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
    return [];
  }
  if (schema.type === "integer") {
    const low = schema.minimum ?? 1;
    // A few hand-validated fields (stratagem-cost's amount, a "multiply" needs at least 2) impose a
    // tighter minimum than the schema states; a wider sample catches those without naming each one.
    return name === "threshold" ? [4, 5] : name === "inches" ? [6, 12] : [low, low + 1, low + 2, low + 3];
  }
  if (schema.type === "string") {
    const sample = sampleForPattern(schema.pattern);
    if (sample) return [sample];
    if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
    // No pattern is visible at the schema level (some families validate a string's shape by hand,
    // e.g. rule-state's rule_kind-dependent slug/keyword check), so try several plain shapes and
    // let normalizeFingerprintParameters keep whichever the family actually accepts.
    return [...PATTERN_CANDIDATES, "Test Value"];
  }
  if (schema.type === "object") {
    if (!schema.required || schema.required.length === 0) return [{}];
    if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
    return [];
  }
  if (starter && name in starter && isConcrete(starter[name])) return [starter[name]];
  return [];
}

function appliesGiven(schema: Schema, parameters: Record<string, unknown>): boolean {
  return !schema["x-only-when"] || Object.entries(schema["x-only-when"]).every(([key, values]) => values.includes(String(parameters[key])));
}

/**
 * Every valid parameter set for one family: a product over the parameters that apply, given
 * earlier choices, with invalid combinations dropped by `normalizeFingerprintParameters`. In the
 * same spirit as `leaf-describer-audit.ts`'s own `combinations()`, widened (see `domain` above)
 * so a family with a `oneOf`-, pattern-, or nested-object-shaped property still yields at least
 * one combination rather than zero.
 */
function familyCombinations(family: SemanticFamilyDefinition): Record<string, unknown>[] {
  const properties = Object.entries((family.parameterSchema.properties ?? {}) as Record<string, Schema>);
  properties.sort(([, left], [, right]) => Number(Boolean(left["x-only-when"])) - Number(Boolean(right["x-only-when"])));
  let sets: Record<string, unknown>[] = [{}];
  for (const [name, schema] of properties) {
    sets = sets.flatMap((set) => appliesGiven(schema, set) ? domain(name, schema, family.starter).map((value) => ({ ...set, [name]: value })) : [set]);
  }
  const valid = new Map<string, Record<string, unknown>>();
  for (const set of sets) {
    try {
      const normalized = normalizeFingerprintParameters(family.id, set, family.version);
      valid.set(JSON.stringify(normalized), normalized);
    } catch {
      // Combinations the family refuses are not leaves; skip them the same way the audit does.
    }
  }
  return [...valid.values()];
}

const LITERAL_KEYS = new Set(["type", "event", "frequency", "duration"]);

/** Walk a compiled DSL node, collecting every type/event/frequency/duration literal, plus the five behavior flags. */
function collectLiterals(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectLiterals(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (LITERAL_KEYS.has(key) && typeof value === "string") into.add(value);
    collectLiterals(value, into);
  }
  const modifier = record.modifier as Record<string, unknown> | undefined;
  if (record.type === "aura" && modifier?.range_cap != null) into.add("BEHAVIOR:aura.range_cap");
  if (record.rating === true) into.add("BEHAVIOR:unit-rating.rating=true");
  if (record.type === "cost-modifier" && modifier?.operation === "multiply") into.add("BEHAVIOR:cost-modifier.multiply");
  if (record.counts_as_move !== undefined) into.add("BEHAVIOR:counts_as_move");
  if ("wholly" in record) into.add("BEHAVIOR:wholly");
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
    const combos = FIXED_PARAMETERS[family.id] ?? familyCombinations(family);
    for (const parameters of combos) {
      let result: Compiled;
      try {
        result = compileLeaves(leavesFor(family, parameters));
      } catch {
        continue;
      }
      if (!result.ok) continue;
      const literals = new Set<string>();
      collectLiterals(result.mechanics, literals);
      if (result.core) collectLiterals(result.core, literals);
      const key = `${family.id}@${family.version}`;
      for (const literal of literals) {
        const existing = produced.get(literal);
        if (existing) { if (!existing.includes(key)) existing.push(key); } else produced.set(literal, [key]);
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
  {
    type: "ability-part",
    reason: "Needs two distinct trigger/EVENT moments in one ability with an effect between them; a single family only ever supplies one trigger leaf.",
    pinnedTest: "tools/test/round5c-compose.test.ts (compound-ability part tests)",
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
    if (produced.has(entry.type) || composedTypes.has(entry.type) || retiredTypes.has(entry.type)) continue;
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
    const families = produced.get(entry.type);
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
