import { DESIGNATION_IDS, refuseListBuildingTag } from "../../translate/designations.js";
import { MARK_TAGS } from "../economy-families.js";
import { PHASES } from "../event-family.js";
import { type FamilyExtension, optional, standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";
import { enumOrSourceSchema, enumValue, sourceQualifiedSchema } from "../family-validation.js";
import { designationId } from "./shared.js";

/**
 * Versions of the timing and designation families: duration, phase-window, battle-round,
 * usage-limit and apply-mark. Each version checks only its own additions and hands the rest of a
 * leaf to the previous version, so every earlier leaf still fits it unchanged.
 */

/** Who applied a designation an apply-mark tags: the unit with the ability, its selected unit, or the moment's unit. */
const APPLIER = ["this-unit", "this-model", "selected-unit", "event-subject"] as const;

const SELECTED_OBJECTIVE = "selected-objective";

/** Designations the set-up records tag an objective marker or a unit with, beyond the earlier apply-mark tags. */
const WIDENED_TAGS = ["corrupted", "warded"] as const;

/**
 * apply-mark@5: the tag a record selects an objective marker to carry (selected-objective, a
 * marker the record's select leaf binds), and any registered designation as the tag. Both are
 * staged through a value the previous version accepts, then put back.
 */
const APPLY_MARK_OBJECTIVE: FamilyExtension = {
  family: "apply-mark",
  version: 5,
  description: "As the previous version, plus subject selected-objective (the objective marker a select leaf of this record bound), and the tags warded and corrupted.",
  schema: (previous) => withProperties(previous, {
    subject: widenedEnum(previous, "subject", [SELECTED_OBJECTIVE]),
    tag: enumOrSourceSchema([...MARK_TAGS, ...WIDENED_TAGS]),
  }),
  normalize: (input, previous) => {
    const objective = input.subject === SELECTED_OBJECTIVE;
    const widenedTag = typeof input.tag === "string" && (WIDENED_TAGS as readonly string[]).includes(input.tag) && !MARK_TAGS.includes(input.tag);
    if (!objective && !widenedTag) return previous(input);
    const tag = widenedTag ? designationId(input.tag, "apply-mark.tag") : undefined;
    const staged: Record<string, unknown> = { ...input };
    if (objective) staged.subject = "selected-unit";
    if (tag !== undefined) staged.tag = MARK_TAGS[0];
    const normalized = previous(staged);
    return { ...normalized, ...(objective ? { subject: SELECTED_OBJECTIVE } : {}), ...(tag !== undefined ? { tag } : {}) };
  },
};

/** Owner-qualified phase edges: "until the end of your next Fight phase" and similar. */
export const PHASE_EDGE_ENDPOINTS: readonly string[] = ["end-of-next-phase", "start-of-next-phase"];

/** The five official phases; "any" is an event-only value and never names a duration's phase. */
const ACTIVE_PHASES = PHASES.filter((phase) => phase !== "any");

const EDGE_TURNS = ["your", "opponent"] as const;

/**
 * The v3 endpoint that already names a start edge for the owner's own turn. `start-of-next-phase`
 * with turn "your" is refused and points here, so one meaning never has two spellings.
 */
const V3_START_ENDPOINT: Record<string, string> = {
  command: "start-of-next-command-phase",
  movement: "start-of-next-movement-phase",
  shooting: "start-of-next-shooting-phase",
};

const USAGE_SELECTED_UNIT = "selected-unit";

const USAGE_PER_SELECTED_UNIT: FamilyExtension = {
  family: "usage-limit",
  version: 5,
  description: "As the previous version, plus per selected-unit: the frequency counts for each unit the ability's one unit selection chooses, across every bearer. It lowers to that selection's selection_limit, not to the ability's usage.",
  schema: (previous) => withProperties(previous, { per: widenedEnum(previous, "per", [USAGE_SELECTED_UNIT]) }),
  normalize: (input, previous) => input.per === USAGE_SELECTED_UNIT ? standIn(input, "per", "any", previous) : previous(input),
};

export const DURATION_AND_DESIGNATION_EXTENSIONS: readonly FamilyExtension[] = [
  /**
   * Duration endpoints: an edge of the next occurrence of a named phase, with one player as owner.
   * `end-of-next-phase` takes any official phase and either owner. `start-of-next-phase` is the
   * start edge for the opponent's Command phase only; the owner's own start edges are the v3
   * endpoints. Which combinations have a DSL value is decided by the compiler, not here.
   */
  {
    family: "duration",
    version: 4,
    description: "As the previous version, plus two phase edges, each with a phase and a turn: until the end of the next Command, Movement, Shooting, Charge or Fight phase of yours or your opponent's (end-of-next-phase), and until the start of your opponent's next Command phase (start-of-next-phase).",
    schema: (previous) => withProperties(previous, {
      endpoint: widenedEnum(previous, "endpoint", [...PHASE_EDGE_ENDPOINTS]),
      phase: optional({ enum: [...ACTIVE_PHASES], "x-only-when": { endpoint: [...PHASE_EDGE_ENDPOINTS] } }),
      turn: optional({ enum: [...EDGE_TURNS], "x-only-when": { endpoint: [...PHASE_EDGE_ENDPOINTS] } }),
    }),
    normalize: (input, previous) => {
      const endpoint = input.endpoint;
      if (endpoint !== "end-of-next-phase" && endpoint !== "start-of-next-phase") {
        if ("phase" in input || "turn" in input) throw new TypeError("duration.phase and duration.turn belong to the phase-edge endpoints only.");
        return previous(input);
      }
      if (input.phase === undefined) throw new TypeError(`duration.${endpoint} names a phase.`);
      if (input.turn === undefined) throw new TypeError(`duration.${endpoint} names whose phase: your or opponent's.`);
      const phase = enumValue(input.phase, [...ACTIVE_PHASES], "duration.phase");
      const turn = enumValue(input.turn, [...EDGE_TURNS], "duration.turn");
      if (endpoint === "start-of-next-phase") {
        if (phase !== "command" || turn !== "opponent") {
          const v3 = turn === "your" ? V3_START_ENDPOINT[phase] : undefined;
          throw new TypeError(v3
            ? `duration.start-of-next-phase with turn your is the v3 endpoint ${v3}.`
            : "duration.start-of-next-phase is the start of your opponent's next Command phase; other starts are not phase-edge endpoints.");
        }
      }
      return { endpoint, phase, turn };
    },
  },
  {
    family: "duration",
    version: 5,
    description: "As the previous version, plus after-this-use: the effect expires after the activation finishes resolving, distinct from end-of-this-use, which lasts only during its resolution.",
    schema: (previous) => withProperties(previous, { endpoint: widenedEnum(previous, "endpoint", ["after-this-use"]) }),
    normalize: (input, previous) => input.endpoint === "after-this-use"
      ? standIn(input, "endpoint", "end-of-this-use", previous)
      : previous(input),
  },
  {
    // "Until the end of the next turn", from a moment in either player's turn: the turn after the current one, whoever's it is.
    family: "duration",
    version: 6,
    description: "As the previous version, plus end-of-next-turn: until the end of the turn after the current one, whichever player's it is (\"until the end of the next turn\" from a moment that can fall in either turn). end-of-your-next-turn and end-of-opponents-next-turn name the player.",
    schema: (previous) => withProperties(previous, { endpoint: widenedEnum(previous, "endpoint", ["end-of-next-turn"]) }),
    normalize: (input, previous) => input.endpoint === "end-of-next-turn"
      ? standIn(input, "endpoint", "end-of-turn", previous)
      : previous(input),
  },
  {
    // "Once per battle, in any phase, just after …": every phase, said outright.
    family: "phase-window",
    version: 2,
    description: "As the previous version, plus phase any: \"in any phase\" (with turn either it gates nothing; with your or opponent it is that player's turn).",
    schema: (previous) => withProperties(previous, { phase: widenedEnum(previous, "phase", ["any"]) }),
    normalize: (input, previous) => input.phase === "any" ? { ...previous({ ...input, phase: "command" }), phase: "any" } : previous(input),
  },
  {
    // "in the first, third and fifth battle rounds".
    family: "battle-round",
    version: 2,
    description: "As the previous version, or rounds: any one of two or more listed battle rounds, in place of min and max.",
    schema: (previous) => {
      const { minProperties: _minimum, ...rest } = previous;
      return { ...withProperties(rest, { rounds: optional({ type: "array", items: { type: "integer", minimum: 1, maximum: 5 }, minItems: 2, uniqueItems: true }) }), minProperties: 1 };
    },
    normalize: (input, previous) => {
      if (!("rounds" in input)) return previous(input);
      const { rounds, ...rest } = input;
      if (Object.keys(rest).length) throw new TypeError("battle-round lists rounds or gives min and max, not both.");
      if (!Array.isArray(rounds) || rounds.length < 2) throw new TypeError("battle-round.rounds lists at least two rounds.");
      for (const round of rounds) previous({ min: round, max: round });
      if (new Set(rounds).size !== rounds.length) throw new TypeError("battle-round.rounds lists a round twice.");
      return { rounds: [...rounds as number[]].sort((left, right) => left - right) };
    },
  },
  {
    // "Place two tokens next to the unit, removing one each time this ability is used."
    family: "usage-limit",
    version: 4,
    description: "As the previous version, plus frequency twice-per-battle.",
    schema: (previous) => withProperties(previous, { frequency: widenedEnum(previous, "frequency", ["twice-per-battle"]) }),
    normalize: (input, previous) => input.frequency === "twice-per-battle" ? { ...previous({ ...input, frequency: "once-per-battle" }), frequency: "twice-per-battle" } : previous(input),
  },
  /**
   * Per selected-unit: a frequency counted for each unit the ability's one unit selection chooses,
   * across every bearer ("once per turn" on the selected unit, 8553). Lowers to that selection's
   * selection_limit (compile.ts), so the usage is never the ability's.
   */
  USAGE_PER_SELECTED_UNIT,
  {
    // "That unit is wracked with agonies": any designation in the live registry, not only the ones
    // registered when apply-mark was first reviewed.
    family: "apply-mark",
    version: 3,
    description: "As the previous version, but tag is any registered designation id (tools/src/translate/designations.ts), or still a source-qualified value.",
    schema: (previous) => withProperties(previous, { tag: { anyOf: [{ type: "string", pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$", examples: ["afflicted"] }, sourceQualifiedSchema] } }),
    normalize: (input, previous) => {
      if (typeof input.tag !== "string") return previous(input);
      if (!DESIGNATION_IDS.has(input.tag)) throw new TypeError(`apply-mark.tag ${JSON.stringify(input.tag)} is not a registered designation.`);
      refuseListBuildingTag(input.tag, "apply-mark.tag");
      return { ...previous({ ...input, tag: "designated" }), tag: input.tag };
    },
  },
  /**
   * A designation one unit applies to another (a Bondsman's affected unit).
   */
  {
    // "Those models are affected by that Bondsman ability": the tagged unit records who tagged it.
    family: "apply-mark",
    version: 4,
    description: "As the previous version, plus by: the unit that applied the designation (this-unit, this-model, selected-unit or event-subject). The designation ends at the record's printed duration (compile-designation-expiry.ts), so a by with no printed duration is refused at compile time.",
    schema: (previous) => withProperties(previous, { by: optional({ enum: [...APPLIER] }) }),
    normalize: (input, previous) => {
      if (input.by === undefined) return previous(input);
      const { by, ...rest } = input;
      return { ...previous(rest), by: enumValue(by, [...APPLIER], "apply-mark.by") };
    },
  },
 APPLY_MARK_OBJECTIVE,
];
