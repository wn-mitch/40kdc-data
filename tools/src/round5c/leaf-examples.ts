import type { DatabaseSync } from "node:sqlite";

import { leafSurface, surfaceOccurrences } from "./leaves.js";

/**
 * Where a wording appears, so a reviewer can check what it means before naming it: a few current
 * sources, each with the sentence around the wording. Different abilities first, spread across
 * factions, so one faction's copies of a rule do not fill the list.
 */

export type LeafExample = {
  ability_version_id: number; faction_id: string; ability_id: string; name: string | null;
  before: string; match: string; after: string;
};

const CONTEXT_BYTES = 240;
/** Where a sentence (or a bullet) ends: context stops there. */
const BOUNDARY = /[.;:!?]\s|\n|■/gu;

function around(source: string, startByte: number, endByte: number): { before: string; match: string; after: string } {
  const bytes = Buffer.from(source, "utf8");
  const before = bytes.subarray(Math.max(0, startByte - CONTEXT_BYTES), startByte).toString("utf8");
  const after = bytes.subarray(endByte, Math.min(bytes.length, endByte + CONTEXT_BYTES)).toString("utf8");
  const lastBoundary = [...before.matchAll(BOUNDARY)].at(-1);
  const firstBoundary = BOUNDARY.exec(after);
  BOUNDARY.lastIndex = 0;
  return {
    before: (lastBoundary ? before.slice(lastBoundary.index + lastBoundary[0].length) : `…${before}`).trimStart(),
    match: bytes.subarray(startByte, endByte).toString("utf8"),
    after: firstBoundary ? after.slice(0, firstBoundary.index + 1) : `${after}…`,
  };
}

export function leafExamples(db: DatabaseSync, value: { text?: unknown; limit?: unknown; faction?: unknown }): { total: number; examples: LeafExample[] } {
  if (typeof value.text !== "string" || !leafSurface(value.text)) throw new TypeError("Examples need the wording's text.");
  const limit = Number.isSafeInteger(value.limit) ? Math.min(20, Math.max(1, value.limit as number)) : 5;
  const faction = typeof value.faction === "string" && value.faction ? value.faction : null;
  const occurrences = surfaceOccurrences(db, leafSurface(value.text)).filter((item) => faction === null || item.faction_id === faction);
  // One per ability, rotating through factions, before any second copy.
  const byFaction = new Map<string, typeof occurrences>();
  const seen = new Set<string>();
  for (const occurrence of occurrences) {
    if (seen.has(occurrence.ability_id)) continue;
    seen.add(occurrence.ability_id);
    byFaction.set(occurrence.faction_id, [...(byFaction.get(occurrence.faction_id) ?? []), occurrence]);
  }
  const picked: typeof occurrences = [];
  for (let round = 0; picked.length < limit && [...byFaction.values()].some((list) => list.length > round); round += 1) {
    for (const list of byFaction.values()) if (list[round] && picked.length < limit) picked.push(list[round]!);
  }
  const source = db.prepare("SELECT source_text, name FROM abilities WHERE id = ?");
  return {
    total: occurrences.length,
    examples: picked.map((item) => {
      const row = source.get(item.ability_version_id) as { source_text: string; name: string | null };
      return { ability_version_id: item.ability_version_id, faction_id: item.faction_id, ability_id: item.ability_id, name: row.name, ...around(row.source_text, item.start_byte, item.end_byte) };
    }),
  };
}
