/**
 * Linked-api cases pinning game-mode views: the default (matched-play) view's
 * listings omit Combat Patrol-only records, a `gameMode` view lists them, and id
 * lookups resolve them in every view.
 */
import type { Dataset } from "./data/dataset.js";
import type { GameModeView } from "./data/collection.js";

/** A linked-api case over a game-mode-aware query. */
export type GameModeLinkedQuery =
  | {
      name: string;
      query: "units_of_faction" | "detachments_of_faction";
      args: { factionId: string; gameMode?: GameModeView };
      comparison: "set";
    }
  | {
      name: string;
      query: "get_unit";
      args: { unitId: string; gameMode?: GameModeView };
      comparison: "scalar";
    }
  | {
      name: string;
      query: "get_detachment";
      args: { detachmentId: string; gameMode?: GameModeView };
      comparison: "scalar";
    }
  | {
      name: string;
      query: "find_unit" | "find_enhancement" | "find_detachment";
      args: { query: string; gameMode?: GameModeView };
      comparison: "scalar";
    }
  | {
      name: string;
      query: "get_enhancement";
      args: { id: string; gameMode?: GameModeView };
      comparison: "scalar";
    };

const ADMECH = "adeptus-mechanicus";
const SKAND = "manipulus-skand";
const PURGE_CORPS = "purge-corps-deltic-9";
const PURGE_CORPS_ENHANCEMENT =
  "empowered-mechanisms-purge-corps-deltic-9-adeptus-mechanicus";

/** The game-mode cases, appended to the linked-api corpus. */
export const GAME_MODE_LINKED_QUERIES: GameModeLinkedQuery[] = [
  {
    name: "units_of_faction adeptus-mechanicus default view omits Combat Patrol units",
    query: "units_of_faction",
    args: { factionId: ADMECH },
    comparison: "set",
  },
  {
    name: "units_of_faction adeptus-mechanicus combat-patrol view lists only Combat Patrol units",
    query: "units_of_faction",
    args: { factionId: ADMECH, gameMode: "combat-patrol" },
    comparison: "set",
  },
  {
    name: "units_of_faction adeptus-mechanicus all view lists every unit",
    query: "units_of_faction",
    args: { factionId: ADMECH, gameMode: "all" },
    comparison: "set",
  },
  {
    name: "get_unit resolves a Combat Patrol unit in the default view",
    query: "get_unit",
    args: { unitId: SKAND },
    comparison: "scalar",
  },
  {
    name: "find_unit misses a Combat Patrol unit by name in the default view",
    query: "find_unit",
    args: { query: "Manipulus Skand" },
    comparison: "scalar",
  },
  {
    name: "find_unit finds a Combat Patrol unit by name in the combat-patrol view",
    query: "find_unit",
    args: { query: "Manipulus Skand", gameMode: "combat-patrol" },
    comparison: "scalar",
  },
  {
    name: "detachments_of_faction adeptus-mechanicus default view omits Combat Patrol detachments",
    query: "detachments_of_faction",
    args: { factionId: ADMECH },
    comparison: "set",
  },
  {
    name: "detachments_of_faction adeptus-mechanicus combat-patrol view",
    query: "detachments_of_faction",
    args: { factionId: ADMECH, gameMode: "combat-patrol" },
    comparison: "set",
  },
  {
    name: "get_detachment resolves a Combat Patrol detachment in the default view",
    query: "get_detachment",
    args: { detachmentId: PURGE_CORPS },
    comparison: "scalar",
  },
  {
    name: "find_detachment misses a Combat Patrol detachment by name in the default view",
    query: "find_detachment",
    args: { query: "Purge Corps Deltic-9" },
    comparison: "scalar",
  },
  {
    name: "find_detachment finds a Combat Patrol detachment by name in the combat-patrol view",
    query: "find_detachment",
    args: { query: "Purge Corps Deltic-9", gameMode: "combat-patrol" },
    comparison: "scalar",
  },
  {
    name: "get_enhancement resolves a Combat Patrol enhancement in the default view",
    query: "get_enhancement",
    args: { id: PURGE_CORPS_ENHANCEMENT },
    comparison: "scalar",
  },
  {
    name: "find_enhancement misses a Combat Patrol enhancement by name in the default view",
    query: "find_enhancement",
    args: { query: "Empowered Mechanisms" },
    comparison: "scalar",
  },
  {
    name: "find_enhancement finds a Combat Patrol enhancement by name in the combat-patrol view",
    query: "find_enhancement",
    args: { query: "Empowered Mechanisms", gameMode: "combat-patrol" },
    comparison: "scalar",
  },
];

/** Answer a game-mode case against `ds` viewed in the case's `gameMode`. */
export function runGameModeQuery(
  ds: Dataset,
  q: GameModeLinkedQuery,
): string | null | string[] {
  const view = q.args.gameMode ? ds.forGameMode(q.args.gameMode) : ds;
  switch (q.query) {
    case "units_of_faction":
      return view.units
        .byFaction(q.args.factionId)
        .map((u) => u.id)
        .sort();
    case "detachments_of_faction":
      return view.detachments
        .byFaction(q.args.factionId)
        .map((d) => d.id)
        .sort();
    case "get_unit":
      return view.units.getAny(q.args.unitId)?.id ?? null;
    case "get_detachment":
      return view.detachments.getAny(q.args.detachmentId)?.id ?? null;
    case "find_unit":
      return view.units.find(q.args.query)?.id ?? null;
    case "find_enhancement":
      return view.enhancements.find(q.args.query)?.id ?? null;
    case "find_detachment":
      return view.detachments.find(q.args.query)?.id ?? null;
    case "get_enhancement":
      return view.enhancements.get(q.args.id)?.id ?? null;
  }
}
