import type { FamilyExtension } from "../family-extension-helpers.js";
import { standIn, widenedEnum, withProperties } from "../family-extension-helpers.js";

export const TURN_START_EXTENSIONS: readonly FamilyExtension[] = [
  {
    // "At the start of any turn": either player's turn, not only yours.
    family: "turn-start",
    version: 2,
    description: "As the previous version, plus turn any-turn: the start of each turn, whichever player's it is.",
    schema: (previous) => withProperties(previous, { turn: widenedEnum(previous, "turn", ["any-turn"]) }),
    normalize: (input, previous) => input.turn === "any-turn" ? standIn(input, "turn", "player-turn", previous) : previous(input),
  },
];
