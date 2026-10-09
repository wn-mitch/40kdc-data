import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { blastRatingRefused } from "./contracts.js";

/**
 * Keyword-less weapon-ability-grant frames ("ranged weapons equipped by models in this unit have
 * the") folded together with the weapon-ability-keyword leaves they grant, before anything else
 * compiles. A frame takes the run of keyword leaves right after it, with no other leaf between;
 * failing that ("… have the selected ability"), the nearest unclaimed run before it. A run whose
 * keywords are joined by "or" or listed as bullets is a menu: one of them is chosen. Otherwise
 * every keyword in it is granted. The folded leaf keeps the frame's place and carries `keywords`
 * and `keyword_choice`, which the effect fragment reads.
 */

const KEYWORD = "weapon-ability-keyword";
// A frame already folded (it carries `keywords`) is not a frame again: a container option's
// leaves are compiled a second time, after this fold has run on the whole ability.
const isFrame = (leaf: CompileLeaf) => leaf.family_id === "weapon-ability-grant" && leaf.parameters.keyword === undefined && leaf.parameters.keywords === undefined;
const CHOICE_JOINER = /\bor\b|[■▪•]/iu;
const ALL_JOINER = /\band\b/iu;

/** The source text between two leaves, or "" when the bytes or the text are unknown. */
function between(sourceText: string | undefined, left: CompileLeaf, right: CompileLeaf): string {
  if (sourceText === undefined || left.end_byte === undefined) return "";
  return Buffer.from(sourceText, "utf8").subarray(left.end_byte, right.start_byte).toString("utf8");
}

/** Recipient leaves a frame may have between it and the keywords it grants: "… equipped by K models from your army have the". */
const RECIPIENT_LEAVES = new Set(["unit-filter", "unit-owner"]);

/**
 * The first unclaimed keyword run after a frame, when only recipient leaves of the frame's fragment
 * sit between them and the wording between them has no sentence break. Anything else between them
 * (a duration, a condition, a roll) leaves the run unclaimed.
 */
function runAfter(list: readonly CompileLeaf[], index: number, runs: readonly number[][], claimed: ReadonlySet<number[]>, sourceText: string | undefined): number[] | undefined {
  const frame = list[index]!;
  const run = runs.find((candidate) => candidate[0]! > index && !claimed.has(candidate));
  if (!run) return undefined;
  for (let at = index + 1; at < run[0]!; at += 1) {
    const other = list[at]!;
    if (other.fragment !== frame.fragment || !RECIPIENT_LEAVES.has(other.family_id)) return undefined;
  }
  if (run[0]! > index + 1 && /[.;:]/u.test(between(sourceText, frame, list[run[0]!]!))) return undefined;
  return run;
}

export function foldWeaponKeywords(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === KEYWORD)) {
    if (list.some(isFrame)) throw new CompileError("A weapon-ability-grant without a keyword needs weapon-ability-keyword leaves to grant.");
    return [...list];
  }
  // Runs of keyword leaves with no other leaf between them, by index into `list`.
  const runs: number[][] = [];
  list.forEach((leaf, index) => {
    if (leaf.family_id !== KEYWORD) return;
    const last = runs.at(-1);
    if (last && last.at(-1) === index - 1) last.push(index);
    else runs.push([index]);
  });
  const claimed = new Set<number[]>();
  const folded = new Map<number, CompileLeaf>();
  list.forEach((leaf, index) => {
    if (!isFrame(leaf)) return;
    const after = runAfter(list, index, runs, claimed, sourceText);
    const before = [...runs].reverse().find((run) => run.at(-1)! < index && !claimed.has(run));
    const run = after ?? before;
    if (!run) throw new CompileError("A weapon-ability-grant without a keyword needs weapon-ability-keyword leaves to grant.");
    claimed.add(run);
    const joiners = run.slice(1).map((at) => between(sourceText, list[at - 1]!, list[at]!));
    // A bulleted list's first item follows a bullet too ("the following: ■ [A] ■ [B]").
    const lead = after ? between(sourceText, leaf, list[run[0]!]!) : "";
    const choice = joiners.some((text) => CHOICE_JOINER.test(text)) || /[■▪•]/u.test(lead);
    if (choice && joiners.some((text) => ALL_JOINER.test(text) && !CHOICE_JOINER.test(text))) {
      throw new CompileError("Weapon-ability keywords are joined by both \"and\" and \"or\"; split the menu into its options.");
    }
    const keywords = run.map((at) => list[at]!.parameters.keyword as string);
    folded.set(index, { ...leaf, parameters: { ...leaf.parameters, keywords, keyword_choice: choice && keywords.length > 1 } });
  });
  const unclaimed = runs.filter((run) => !claimed.has(run));
  if (unclaimed.length) throw new CompileError("A weapon-ability-keyword leaf has no weapon-ability-grant frame saying which weapons gain it.");
  return list.flatMap((leaf, index) => (leaf.family_id === KEYWORD ? [] : [folded.get(index) ?? leaf]));
}

/**
 * A Blast keyword whose printed span gives a rating other than 1 is a gap: the keyword has no
 * rating, so plain Blast would drop the printed value. Spans are checked only where the bytes are known.
 */
export function refuseBlastRating(leaves: readonly CompileLeaf[], sourceText: string | undefined): void {
  if (sourceText === undefined) return;
  const bytes = Buffer.from(sourceText, "utf8");
  for (const leaf of leaves) {
    if ((leaf.family_id !== KEYWORD && leaf.family_id !== "weapon-ability-grant") || leaf.parameters.keyword !== "Blast") continue;
    if (leaf.start_byte === undefined || leaf.end_byte === undefined || leaf.end_byte <= leaf.start_byte) continue;
    if (blastRatingRefused(bytes.subarray(leaf.start_byte, leaf.end_byte).toString("utf8"))) {
      throw new CompileError("Blast with a rating other than 1 has no authored keyword; it is a gap.");
    }
  }
}
