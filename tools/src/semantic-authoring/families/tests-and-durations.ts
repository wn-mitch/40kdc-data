import { ANTECEDENT } from "../antecedent-families.js";
import { boundedInteger, enumValue, exactKeys } from "../family-validation.js";
import type { FlatFamily } from "./types.js";
import { type Input, KEYWORD_LIST, stringList } from "./dice-and-core-shared.js";

/** Tests and test exemptions, effect durations and turn starts. */

// ---------------------------------------------------------------------------------------------
// test, test-exemption

const TARGETS = [
  "this-unit", "this-model", "attacker", "defender", "event-subject", "event-object",
  "stratagem-target", "selected-unit", "recipient", "bearer-transport", "ability-unit", "enemy", "friendly",
] as const;
const FILTERED_TARGETS = new Set(["enemy", "friendly"]);
const TARGET_RANGES = ["engagement", "inches", "any"] as const;
const TARGET_OF = ["this-model", "event-object"] as const;
const TARGET_OF_OWNERS = ["friendly", "enemy"] as const;

/** The target and the filter fields `test` and `test-exemption` share. */
const targetFilterProperties = (targets: readonly string[]) => ({
  target: { enum: targets },
  range: { enum: TARGET_RANGES, "x-only-when": { target: ["enemy", "friendly"] } },
  within_inches: { type: "integer", minimum: 1, maximum: 48, "x-only-when": { range: ["inches"] } },
  of: { enum: TARGET_OF, "x-only-when": { range: ["inches", "engagement"] } },
  of_owner: { enum: TARGET_OF_OWNERS, "x-only-when": { range: ["inches", "engagement"] } },
  of_keywords: { ...KEYWORD_LIST, "x-only-when": { of_owner: TARGET_OF_OWNERS } },
  require_keywords: { ...KEYWORD_LIST, "x-only-when": { target: ["enemy", "friendly"] } },
  exclude_keywords: { ...KEYWORD_LIST, "x-only-when": { target: ["enemy", "friendly"] } },
});


/** The target and its filter fields: the keys it used, and their values. */
function normalizeTargetFilter(input: Input, prefix: string, targets: readonly string[]): { keys: string[]; values: Input } {
  const target = enumValue(input.target, targets, `${prefix}.target`);
  const keys = ["target"];
  const values: Input = { target };
  if (FILTERED_TARGETS.has(target)) {
    const range = enumValue(input.range, TARGET_RANGES, `${prefix}.range`);
    values.range = range;
    keys.push("range");
    if (range === "inches") {
      values.within_inches = boundedInteger(input.within_inches, 1, 48, `${prefix}.within_inches`);
      keys.push("within_inches");
    }
    if (range !== "any" && "of" in input && "of_owner" in input) throw new TypeError(`${prefix}.of and ${prefix}.of_owner are mutually exclusive.`);
    if (range !== "any" && "of" in input) {
      values.of = enumValue(input.of, TARGET_OF, `${prefix}.of`);
      keys.push("of");
    }
    if (range !== "any" && "of_owner" in input) {
      values.of_owner = enumValue(input.of_owner, TARGET_OF_OWNERS, `${prefix}.of_owner`);
      keys.push("of_owner");
      if ("of_keywords" in input) {
        values.of_keywords = stringList(input.of_keywords, `${prefix}.of_keywords`);
        keys.push("of_keywords");
      }
    } else if ("of_keywords" in input) {
      throw new TypeError(`${prefix}.of_keywords only applies with ${prefix}.of_owner.`);
    }
    for (const key of ["require_keywords", "exclude_keywords"]) {
      if (key in input) {
        values[key] = stringList(input[key], `${prefix}.${key}`);
        keys.push(key);
      }
    }
  } else if (["range", "within_inches", "of", "of_owner", "require_keywords", "exclude_keywords"].some((key) => key in input)) {
    throw new TypeError(`${prefix}.range/within_inches/of/of_owner/require_keywords/exclude_keywords only apply when target is enemy or friendly.`);
  }
  return { keys, values };
}

const TEST_KINDS = ["battle-shock", "leadership", "hazard", "desperate-escape"] as const;
const SCALING_SOURCES = [
  "enemy-models-in-range", "friendly-models-in-range", "models-in-bearer-unit", "models-in-or-embarked-in-bearer",
  "models-embarked-in-bearer", "embarked-models-oc", "models-equipped-with", "enemy-units-in-range", "wounds-lost", "battle-round",
] as const;
const SCALING_ROUNDING = ["down", "up"] as const;
const SCALING_KEYS = ["scaling_per", "scaling_of", "scaling_round", "scaling_max_value"];

function normalizeTest(input: Input): Input {
  // antecedent is not a filtered target, so it takes no range, of or keywords.
  const filter = normalizeTargetFilter(input, "test", [...TARGETS, ANTECEDENT]);
  const scalingKeys = SCALING_KEYS.filter((key) => key in input);
  exactKeys(input, [...filter.keys, "test", ...["modifier", "count", "per", ...scalingKeys].filter((key) => key in input)], "test");
  const result: Input = { ...filter.values, test: enumValue(input.test, TEST_KINDS, "test.test") };
  if ("modifier" in input) result.modifier = boundedInteger(input.modifier, -20, 20, "test.modifier");
  if ("count" in input) result.count = boundedInteger(input.count, 1, 20, "test.count");
  if ("per" in input) {
    if (typeof input.per !== "string" || !input.per) throw new TypeError("test.per must be a nonblank string.");
    result.per = input.per;
  }
  if (scalingKeys.length) {
    if (!("scaling_per" in input) || !("scaling_of" in input)) throw new TypeError("test.scaling_per and test.scaling_of must be given together.");
    result.scaling_per = boundedInteger(input.scaling_per, 1, 999, "test.scaling_per");
    result.scaling_of = enumValue(input.scaling_of, SCALING_SOURCES, "test.scaling_of");
    if ("scaling_round" in input) result.scaling_round = enumValue(input.scaling_round, SCALING_ROUNDING, "test.scaling_round");
    if ("scaling_max_value" in input) result.scaling_max_value = boundedInteger(input.scaling_max_value, -999, 999, "test.scaling_max_value");
  }
  return result;
}

const EXEMPTION_TESTS = ["battle-shock", "leadership", "desperate-escape"] as const;
const EXEMPTION_WINDOWS = ["phase", "turn", "battle-round"] as const;

function normalizeTestExemption(input: Input): Input {
  const filter = normalizeTargetFilter(input, "test-exemption", TARGETS);
  exactKeys(input, [...filter.keys, "test", "window"], "test-exemption");
  return {
    ...filter.values,
    test: enumValue(input.test, EXEMPTION_TESTS, "test-exemption.test"),
    window: enumValue(input.window, EXEMPTION_WINDOWS, "test-exemption.window"),
  };
}

// ---------------------------------------------------------------------------------------------
// duration

const DURATION_ENDPOINTS = [
  "end-of-phase", "end-of-turn", "end-of-battle-round", "end-of-battle",
  "start-of-next-turn", "start-of-next-command-phase", "start-of-next-movement-phase", "start-of-next-battle-round",
  "end-of-attack-sequence", "end-of-this-use", "start-of-next-shooting-phase",
  "end-of-your-next-turn", "end-of-opponents-next-turn", "this-unit-has-shot", "control-lost",
  "end-of-next-phase", "start-of-next-phase", "after-this-use", "end-of-next-turn",
] as const;
const PHASE_EDGES = ["end-of-next-phase", "start-of-next-phase"] as const;
const ACTIVE_PHASES = ["command", "movement", "shooting", "charge", "fight"] as const;
const EDGE_TURNS = ["your", "opponent"] as const;
/** The endpoint that names the start edge of the owner's own next phase. */
const OWN_START_ENDPOINT: Record<string, string> = {
  command: "start-of-next-command-phase",
  movement: "start-of-next-movement-phase",
  shooting: "start-of-next-shooting-phase",
};

function normalizeDuration(input: Input): Input {
  const endpoint = input.endpoint;
  if (endpoint !== "end-of-next-phase" && endpoint !== "start-of-next-phase") {
    if ("phase" in input || "turn" in input) throw new TypeError("duration.phase and duration.turn belong to the phase-edge endpoints only.");
    exactKeys(input, ["endpoint"], "duration");
    return { endpoint: enumValue(endpoint, DURATION_ENDPOINTS, "duration.endpoint") };
  }
  if (input.phase === undefined) throw new TypeError(`duration.${endpoint} names a phase.`);
  if (input.turn === undefined) throw new TypeError(`duration.${endpoint} names whose phase: your or opponent's.`);
  exactKeys(input, ["endpoint", "phase", "turn"], "duration");
  const phase = enumValue(input.phase, ACTIVE_PHASES, "duration.phase");
  const turn = enumValue(input.turn, EDGE_TURNS, "duration.turn");
  if (endpoint === "start-of-next-phase" && (phase !== "command" || turn !== "opponent")) {
    const own = turn === "your" ? OWN_START_ENDPOINT[phase] : undefined;
    throw new TypeError(own
      ? `duration.start-of-next-phase with turn your is the endpoint ${own}.`
      : "duration.start-of-next-phase is the start of your opponent's next Command phase; other starts are not phase-edge endpoints.");
  }
  return { endpoint, phase, turn };
}

const TEST_SCHEMA_PROPERTIES = {
  test: { enum: TEST_KINDS },
  modifier: { type: "integer" },
  count: { type: "integer", minimum: 1 },
  per: { type: "string", minLength: 1 },
  scaling_per: { type: "integer", minimum: 1 },
  scaling_of: { enum: SCALING_SOURCES },
  scaling_round: { enum: SCALING_ROUNDING },
  scaling_max_value: { type: "integer" },
};

const TURN_STARTS = ["battle-round", "player-turn", "opponent-turn", "any-turn"] as const;

export const TESTS_AND_DURATIONS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "duration",
    version: 6,
    role: "DURATION",
    label: "Set a duration",
    description: "Marks when an effect ends: the end of this phase, turn, battle round or battle; the start of your next turn, Command, Movement or Shooting phase, or battle round; the end of the current attack sequence; only while resolving this use (end-of-this-use), or until the activation finishes resolving (after-this-use); the end of your or your opponent's next turn, or of the turn after the current one whichever player's it is (end-of-next-turn); until this unit has shot; or until you lose control of the designated objective. Two phase edges also take a phase and a turn: the end of the next Command, Movement, Shooting, Charge or Fight phase of yours or your opponent's (end-of-next-phase), and the start of your opponent's next Command phase (start-of-next-phase).",
    starter: { endpoint: "" },
    parameterSchema: {
      type: "object",
      required: ["endpoint"],
      properties: {
        endpoint: { enum: DURATION_ENDPOINTS },
        phase: { enum: ACTIVE_PHASES, "x-only-when": { endpoint: PHASE_EDGES }, "x-optional": true },
        turn: { enum: EDGE_TURNS, "x-only-when": { endpoint: PHASE_EDGES }, "x-optional": true },
      },
      additionalProperties: false,
    },
    normalize: normalizeDuration,
  },
  {
    id: "turn-start",
    version: 2,
    role: "EVENT",
    label: "At the start of a turn or round",
    description: "Marks the start of a battle round, your turn, your opponent's turn, or each turn whichever player's it is (any-turn).",
    starter: { turn: "" },
    parameterSchema: { type: "object", required: ["turn"], properties: { turn: { enum: TURN_STARTS } }, additionalProperties: false },
    normalize: (input) => {
      exactKeys(input, ["turn"], "turn-start");
      return { turn: enumValue(input.turn, TURN_STARTS, "turn-start.turn") };
    },
  },
  {
    id: "test-exemption",
    version: 2,
    role: "EFFECT",
    label: "Exempt from a test",
    description: "The target does not need to take a named test again within a window (no further Battle-shock tests this phase).",
    starter: { target: "", test: "", window: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "test", "window"],
      properties: { ...targetFilterProperties(TARGETS), test: { enum: EXEMPTION_TESTS }, window: { enum: EXEMPTION_WINDOWS } },
      additionalProperties: false,
    },
    normalize: normalizeTestExemption,
  },
  {
    id: "test",
    version: 3,
    role: "EFFECT",
    label: "Force a test",
    description: "The target must take a Battle-shock, Leadership, Hazard, or Desperate Escape test, optionally with a characteristic modifier, several times (count/per), or scaled up per a named count (Powers of da WAAAGH!: -1 for every 10 models in the bearer's unit). The target can be antecedent: the unit an earlier leaf of the record introduced (\"that enemy unit\", \"it\"), bound when the record compiles.",
    starter: { target: "", test: "" },
    parameterSchema: {
      type: "object",
      required: ["target", "test"],
      properties: { ...targetFilterProperties([...TARGETS, ANTECEDENT]), ...TEST_SCHEMA_PROPERTIES },
      additionalProperties: false,
    },
    normalize: normalizeTest,
  },
];
