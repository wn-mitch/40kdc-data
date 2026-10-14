import { keywordMatchesPredicate } from "../scope.js";
import type { EngineContext } from "./buffs.js";

export type FilterVerdict = boolean | "unknown";

/** Evaluate only facts present in the crunch; never infer model membership from keywords. */
export function matchesUnitFilter(filter: unknown, context: EngineContext, side: "attacker" | "target", owner: "friendly" | "enemy" = "friendly"): FilterVerdict {
  if (!isObject(filter)) return "unknown";
  let unknown = false;
  const predicate: { all_of?: string[]; any_of?: string[]; none_of?: string[]; not_all_of?: string[] } = {};
  const memberSide = filter.member_of === "this-unit" ||
    (side === "attacker" ? filter.member_of === "attacker" : filter.member_of === "defender");
  const keywords = side === "attacker" ? context.attackerKeywords : context.targetKeywords;
  for (const key of ["all_of", "any_of", "none_of", "not_all_of"] as const) {
    const value = filter[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) return "unknown";
    predicate[key] = value;
  }
  if (filter.level === "model" && Object.keys(predicate).length > 0) unknown = true;
  if (Object.keys(predicate).length > 0) {
    if (keywords === undefined) unknown = true;
    else if (!keywordMatchesPredicate(predicate, keywords)) return false;
  }
  for (const [key, value] of Object.entries(filter)) {
    if (key in predicate) continue;
    if (key === "owner") {
      if (value !== "any" && value !== owner) return false;
    } else if (key === "unit_ids") {
      if (filter.level !== "unit" || !Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === "string")) return "unknown";
      const id = side === "attacker" ? context.attackerUnitId : context.targetUnitId;
      if (id === undefined) unknown = true;
      else if (!value.includes(id)) return false;
    } else if (key === "any_of_filters") {
      if (!Array.isArray(value) || value.length === 0) return "unknown";
      const results = value.map((item) => matchesUnitFilter(item, context, side, owner));
      if (!results.includes(true)) {
        if (!results.includes("unknown")) return false;
        unknown = true;
      }
    } else if (key === "state" && value === "benefit-of-cover") {
      const covered = side === "attacker" ? context.attackerInCover : context.targetInCover;
      if (covered === false) return false;
      if (covered === undefined) unknown = true;
    } else if (key === "within" && isObject(value) && value.wholly !== true &&
      ((side === "attacker" && value.of === "defender") || (side === "target" && value.of === "attacker"))) {
      if (value.range === "half-weapon") {
        if (context.withinHalfRange === false) return false;
        if (context.withinHalfRange === undefined) unknown = true;
        continue;
      }
      let range = value.range;
      if (isObject(range) && Array.isArray(range.per_battle_round) && context.battleRound !== undefined) {
        range = range.per_battle_round[Math.min(Math.max(context.battleRound - 1, 0), range.per_battle_round.length - 1)];
      }
      if (!isObject(range) || typeof range.inches !== "number" || context.distanceInches === undefined) unknown = true;
      else if (context.distanceInches > range.inches) return false;
    } else if (key === "level" && value === "unit") {
      continue;
    } else if (key === "level" && value === "model" && filter.attachment_role !== undefined && memberSide) {
      // The selected unit's actual membership can identify its whole bodyguard/leader model pool.
      continue;
    } else if (key === "attachment_role" && filter.level === "model" && memberSide) {
      const role = side === "attacker" ? context.attackerAttachmentRole : context.targetAttachmentRole;
      if (role === undefined) unknown = true;
      else if (role !== value) return false;
    } else if (key === "member_of" && memberSide && filter.attachment_role !== undefined) {
      continue;
    } else {
      unknown = true;
    }
  }
  return unknown ? "unknown" : true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
