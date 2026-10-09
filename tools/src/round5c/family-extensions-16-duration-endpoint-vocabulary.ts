import { type FamilyExtension, optional, widenedEnum, withProperties } from "./family-extension-helpers.js";
import { enumValue } from "./family-validation.js";
import { PHASES } from "./event-family.js";

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

/**
 * Wave-10 duration endpoints: an edge of the next occurrence of a named phase, with one player as
 * owner. `end-of-next-phase` takes any official phase and either owner. `start-of-next-phase` is
 * the start edge for the opponent's Command phase only; the owner's own start edges are the v3
 * endpoints. Which combinations have a DSL value is decided by the compiler, not here.
 */
export const FAMILY_EXTENSIONS_16_DURATION_ENDPOINTS: readonly FamilyExtension[] = [
  {
    family: "duration",
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
];
