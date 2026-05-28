/**
 * NewRecruit "simple" markdown-ish text exporter.
 *
 * Shape:
 * ```
 * <faction> - <list name> - [N pts]
 *
 * # ++ Army Roster ++ [N pts]
 * ## Configuration
 * Battle Size: <Label>
 * Detachment: <Name>
 *
 * ## Battleline [N pts]
 * <Unit> [pts]: <wargear, …, EnhName [N pts], …>
 * <Multi-Unit> [pts]:
 * • <Nx> <ModelType>: <wargear>
 * ```
 *
 * Enhancements are inlined as `Name [N pts]` (the only place we re-emit a
 * `[N pts]` bracket on a token).
 *
 * @packageDocumentation
 */
import type { Roster, RosterUnit } from "../import/types.js";
import { displayedUnitPoints, titleCaseId, totalArmyPoints } from "./helpers.js";
import type { RosterSerializer } from "./serializer.js";

function battleSizeLabel(roster: Roster): string | null {
  if (roster.battle_size === "strike-force") {
    return `Strike Force (${roster.points.declared_limit ?? 2000} Point limit)`;
  }
  if (roster.battle_size === "incursion") {
    return `Incursion (${roster.points.declared_limit ?? 1000} Point limit)`;
  }
  return null;
}

/** Build the wargear list inline. For homogeneous multi-model units, divides
 * counts by model_count so the per-model render is clean. */
function wargearText(u: RosterUnit, perModelDivisor: number): string {
  const parts: string[] = [];
  if (u.enhancement) {
    const ptsTag = u.enhancement_points === null ? "" : ` [${u.enhancement_points} pts]`;
    parts.push(`${u.enhancement.raw_name}${ptsTag}`);
  }
  if (u.is_warlord) parts.push("Warlord");
  for (const w of u.wargear) {
    const c = perModelDivisor > 0 ? w.count / perModelDivisor : w.count;
    parts.push(c > 1 ? `${c}x ${w.ref.raw_name}` : w.ref.raw_name);
  }
  return parts.join(", ");
}

function unitText(u: RosterUnit): string[] {
  const pts = displayedUnitPoints(u);
  const ptsText = pts === null ? "" : `${pts} pts`;

  if (u.model_count <= 1) {
    return [`${u.ref.raw_name} [${ptsText}]: ${wargearText(u, 1)}`];
  }
  // Multi-model: homogeneous when every weapon count divides cleanly.
  const divisible = u.wargear.every((w) => w.count % u.model_count === 0);
  if (divisible) {
    return [
      `${u.ref.raw_name} [${ptsText}]:`,
      `• ${u.model_count}x ${u.ref.raw_name}: ${wargearText(u, u.model_count)}`,
    ];
  }
  // Heterogeneous fallback: render as a single bullet with full counts.
  return [
    `${u.ref.raw_name} [${ptsText}]:`,
    `• ${u.model_count}x ${u.ref.raw_name}: ${wargearText(u, 1)}`,
  ];
}

export const newRecruitSimpleSerializer: RosterSerializer = {
  id: "newrecruit-simple",

  serialize(roster: Roster): string {
    const faction = titleCaseId(roster.faction_id) ?? "Unknown";
    const detachment = titleCaseId(roster.detachment_id);
    const battle = battleSizeLabel(roster);
    const total = totalArmyPoints(roster);

    const lines: string[] = [];
    // First line carries the *declared limit* (the army's points ceiling); the
    // `# ++ Army Roster ++` line carries the *reported total*. They differ
    // when the list isn't filled to the cap.
    const limit = roster.points.declared_limit ?? total;
    lines.push(`${faction} - ${roster.name} - [${limit} pts]`);
    lines.push("");
    lines.push(`# ++ Army Roster ++ [${total} pts]`);
    lines.push("## Configuration");
    if (battle) lines.push(`Battle Size: ${battle}`);
    if (detachment) lines.push(`Detachment: ${detachment}`);
    lines.push("");

    // The Roster doesn't tag allied vs. battleline per unit; emit one section.
    const sectionTotal = roster.units.reduce(
      (acc, u) => acc + (u.points ?? 0) + (u.enhancement_points ?? 0),
      0,
    );
    lines.push(`## Battleline [${sectionTotal} pts]`);
    for (const u of roster.units) lines.push(...unitText(u));

    return lines.join("\n") + "\n";
  },
};
