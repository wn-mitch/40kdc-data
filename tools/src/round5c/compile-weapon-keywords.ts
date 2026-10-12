import { isContainerOpener } from "./compile-containers.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { blastRatingRefused } from "./contracts.js";
import { qualifierOf } from "./compile-weapon-scopes.js";
import { foldQualifiedKeywordMenus } from "./compile-keyword-menu.js";

/**
 * Keyword-less weapon-ability-grant frames ("ranged weapons equipped by models in this unit have
 * the") folded together with the weapon-ability-keyword leaves they grant, before anything else
 * compiles. A frame takes the run of keyword leaves right after it, with no other leaf between;
 * failing that ("… have the selected ability"), the nearest unclaimed run before it. A run whose
 * keywords are joined by "or" or listed as bullets is a menu: one of them is chosen. Otherwise
 * every keyword in it is granted. When neither exists, characteristic-modifier leaves directly after
 * the frame ("have: +1 S. [Lethal Hits]") are stepped over to find the run behind them. The folded leaf keeps the frame's place and carries `keywords`
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

export function foldWeaponKeywords(input: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  const { list, forced } = absorbMenuOpeners(foldQualifiedKeywordMenus(input, sourceText), sourceText);
  if (!list.some((leaf) => leaf.family_id === KEYWORD)) {
    if (list.some(isFrame)) throw new CompileError("A weapon-ability-grant without a keyword needs weapon-ability-keyword leaves to grant.");
    return [...list];
  }
  const { runs, claims, stepped } = claimRuns(list, sourceText);
  const folded = new Map<number, CompileLeaf>();
  const grants: Array<{ frame: number; run: number[] }> = [];
  for (const [index, run] of claims) {
    if (!run) throw new CompileError("A weapon-ability-grant without a keyword needs weapon-ability-keyword leaves to grant.");
    grants.push({ frame: index, run });
    const leaf = list[index]!;
    const joiners = run.slice(1).map((at) => between(sourceText, list[at - 1]!, list[at]!));
    const isMenu = run.some((at) => forced.has(list[at]!));
    // A bulleted list's first item follows a bullet too ("the following: ■ [A] ■ [B]").
    const lead = run[0]! > index && !stepped.has(index) ? between(sourceText, leaf, list[run[0]!]!) : "";
    let choice: boolean;
    if (isMenu) {
      // A menu under an opener is one of its keywords by definition; "and" cannot mean that.
      if (joiners.some((text) => ALL_JOINER.test(text))) {
        throw new CompileError("Weapon-ability keywords in a menu are joined by \"and\"; split the menu into its options.");
      }
      choice = true;
    } else {
      choice = joiners.some((text) => CHOICE_JOINER.test(text)) || /[■▪•]/u.test(lead);
      if (choice && joiners.some((text) => ALL_JOINER.test(text) && !CHOICE_JOINER.test(text))) {
        throw new CompileError("Weapon-ability keywords are joined by both \"and\" and \"or\"; split the menu into its options.");
      }
    }
    const keywords = run.map((at) => list[at]!.parameters.keyword as string);
    // The grant ends where its last keyword does, so the text after it (", if this unit is …") is in its own sentence.
    const last = list[run.at(-1)!]!;
    const end = run[0]! > index && last.end_byte !== undefined && last.end_byte > (leaf.end_byte ?? 0) ? last.end_byte : leaf.end_byte;
    folded.set(index, { ...leaf, end_byte: end, parameters: { ...leaf.parameters, keywords, keyword_choice: choice && keywords.length > 1 } });
  }
  const claimed = new Set([...claims.values()]);
  if (runs.some((run) => !claimed.has(run))) throw new CompileError("A weapon-ability-keyword leaf has no weapon-ability-grant frame saying which weapons gain it.");
  const { consumed, merged } = foldGrantQualifiers(list, grants, folded, sourceText);
  return list.flatMap((leaf, index) => (leaf.family_id === KEYWORD || consumed.has(index) || merged.has(index) ? [] : [folded.get(index) ?? leaf]));
}

/** Runs of keyword leaves with no other leaf between them, as index lists into `list`. */
function keywordRuns(list: readonly CompileLeaf[]): number[][] {
  const runs: number[][] = [];
  list.forEach((leaf, index) => {
    if (leaf.family_id !== KEYWORD) return;
    const last = runs.at(-1);
    if (last && last.at(-1) === index - 1) last.push(index);
    else runs.push([index]);
  });
  return runs;
}

/**
 * Claims a keyword run for each keyword-less frame, in list order. The map holds every frame's index
 * and the run it claimed, or undefined where none was left to claim. `runs` is every run in `list`.
 */
function claimRuns(list: readonly CompileLeaf[], sourceText: string | undefined): { runs: number[][]; claims: Map<number, number[] | undefined>; stepped: Set<number> } {
  const runs = keywordRuns(list);
  const claimed = new Set<number[]>();
  const claims = new Map<number, number[] | undefined>();
  const stepped = new Set<number>();
  list.forEach((leaf, index) => {
    if (!isFrame(leaf)) return;
    const after = runAfter(list, index, runs, claimed, sourceText);
    const before = [...runs].reverse().find((candidate) => candidate.at(-1)! < index && !claimed.has(candidate));
    // Last resort: "have: +1 S. [Lethal Hits]" puts stat adjustments of the same attacks between the frame and its keywords.
    let skip = index + 1;
    while (list[skip]?.family_id === "characteristic-modifier") skip += 1;
    const past = skip > index + 1 ? runs.find((candidate) => candidate[0] === skip && !claimed.has(candidate)) : undefined;
    const run = after ?? before ?? past;
    if (run) claimed.add(run);
    if (run && run === past) stepped.add(index);
    claims.set(index, run);
  });
  return { runs, claims, stepped };
}

const MENU_OPENER_PARAMETERS = new Set(["min_choices", "max_choices", "choice_label"]);

/**
 * An opener over one keyword menu ("select one of the following abilities", then keywords) is folded
 * into the keyword-less frame of its own region, so the menu is a choice without an opener of its own.
 * The opener must allow exactly one choice, its region must hold exactly one run of two or more
 * keywords and exactly one frame, and no other effect. Its `choice_label` moves onto that frame.
 * Returns the list without the openers absorbed, and the keyword leaves of each absorbed menu.
 */
function absorbMenuOpeners(input: readonly CompileLeaf[], sourceText: string | undefined): { list: CompileLeaf[]; forced: Set<CompileLeaf> } {
  let list = [...input];
  const forced = new Set<CompileLeaf>();
  let at = 0;
  while (at < list.length) {
    const absorbed = list[at]!.family_id === "choice-open" ? absorbMenu(list, at, sourceText) : undefined;
    if (!absorbed) {
      at += 1;
      continue;
    }
    list = absorbed.list;
    for (const leaf of absorbed.keywords) forced.add(leaf);
  }
  return { list, forced };
}

function absorbMenu(list: CompileLeaf[], at: number, sourceText: string | undefined): { list: CompileLeaf[]; keywords: CompileLeaf[] } | undefined {
  const opener = list[at]!;
  const parameters = opener.parameters;
  if (!Object.keys(parameters).every((key) => MENU_OPENER_PARAMETERS.has(key)) || parameters.min_choices !== 1 || parameters.max_choices !== 1) return undefined;
  let end = at + 1;
  while (end < list.length && !isContainerOpener(list[end]!.family_id)) end += 1;
  const region = Array.from({ length: end - at - 1 }, (_, offset) => at + 1 + offset);
  const keywordAt = region.filter((index) => list[index]!.family_id === KEYWORD);
  if (keywordAt.length < 2 || !keywordAt.every((index, offset) => index === keywordAt[0]! + offset)) return undefined;
  const effects = region.filter((index) => list[index]!.role === "EFFECT" && list[index]!.family_id !== KEYWORD);
  if (effects.some((index) => !isFrame(list[index]!))) return undefined;
  const frames = effects.filter((index) => isFrame(list[index]!));
  if (frames.length !== 1) return undefined;
  // The menu's frame must claim the menu's run once the opener is out of the list. An earlier frame
  // that would take the menu's run first is refused by name, since the fold would fail without it.
  const without = list.filter((_, index) => index !== at);
  const frameNow = frames[0]! - 1;
  const runNow = keywordAt.map((index) => index - 1);
  const { claims } = claimRuns(without, sourceText);
  const sameRun = (run: number[] | undefined) => run !== undefined && run.length === runNow.length && run[0] === runNow[0];
  for (const [index, run] of claims) {
    if (index < frameNow && sameRun(run)) {
      throw new CompileError("A keyword menu after a keyword-less weapon-ability-grant frame refuses: that frame would take the menu's keywords. Join the frame to the menu or end the frame before the menu.");
    }
  }
  if (!sameRun(claims.get(frameNow))) return undefined;
  const next = [...list];
  const frame = next[frames[0]!]!;
  next[frames[0]!] = parameters.choice_label === undefined ? frame : { ...frame, parameters: { ...frame.parameters, choice_label: parameters.choice_label } };
  next.splice(at, 1);
  return { list: next, keywords: keywordAt.map((index) => list[index]!) };
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

/** The printed gap between two options of a menu: "[A: X]. Or: [B: Y]" (the period ends the first clause). */
const CHOICE_GAP = /^[\s\]\[*.]*\bor\b[\s:*\[]*$/iu;

/**
 * Target qualifiers printed after the keywords a frame grants ("[SUSTAINED HITS 1: NON-MONSTER/VEHICLE]").
 * Two single-keyword grants, each qualified, joined by an "Or:" become one menu whose options carry their
 * qualifiers (`option_conditions`, read by the effect fragment). A qualified option with an unqualified
 * partner in such a menu is refused. A qualifier after several keywords is refused. Any other qualifier
 * is set on its frame as `gate`, so it conditions only that grant. Returns the list indices the fold
 * removes (the qualifiers and the second frame of a menu).
 */
function foldGrantQualifiers(list: readonly CompileLeaf[], grants: ReadonlyArray<{ frame: number; run: number[] }>, folded: Map<number, CompileLeaf>, sourceText?: string) {
  const source = sourceText === undefined ? undefined : Buffer.from(sourceText, "utf8");
  const qualifiers = new Map<number, CompileLeaf>();
  const consumed = new Set<number>();
  const merged = new Set<number>();
  const ordered = [...grants].sort((a, b) => a.frame - b.frame);
  for (const grant of ordered) {
    // A scope that already took its qualifier (foldWeaponScopes) has the gate on its frame.
    if (list[grant.frame]!.parameters.gate !== undefined) continue;
    const fragment = list[grant.frame]!.fragment;
    const last = grant.run.at(-1)!;
    const qualifier = qualifierOf(list, source, last, fragment);
    if (!qualifier) continue;
    if (grant.run.length > 1) throw new CompileError("A qualifier after a keyword run of more than one keyword is not compiled.");
    qualifiers.set(grant.frame, qualifier);
    consumed.add(last + 1);
  }
  const singles = ordered.filter((grant) => grant.run.length === 1);
  for (let at = 0; at < singles.length; at += 1) {
    const first = singles[at]!;
    const next = singles[at + 1];
    if (!next || merged.has(first.frame)) continue;
    const tail = qualifiers.get(first.frame) ?? list[first.run[0]!]!;
    const gap = between(sourceText, tail, list[next.run[0]!]!);
    if (!CHOICE_GAP.test(gap)) continue;
    const qualifiedFirst = qualifiers.has(first.frame);
    if (qualifiedFirst !== qualifiers.has(next.frame)) throw new CompileError("A choice between a qualified and an unqualified keyword is not compiled.");
    if (!qualifiedFirst) continue;
    const options = [first, next].map((grant) => list[grant.run[0]!]!.parameters.keyword as string);
    const leaf = folded.get(first.frame)!;
    folded.set(first.frame, { ...leaf, parameters: { ...leaf.parameters, keywords: options, keyword_choice: true, option_conditions: [qualifiers.get(first.frame)!, qualifiers.get(next.frame)!] } });
    qualifiers.delete(first.frame);
    qualifiers.delete(next.frame);
    merged.add(next.frame);
    at += 1;
  }
  // A qualifier that is not a menu option gates its own grant.
  for (const [frame, qualifier] of qualifiers) {
    const leaf = folded.get(frame)!;
    folded.set(frame, { ...leaf, parameters: { ...leaf.parameters, gate: qualifier } });
  }
  return { consumed, merged };
}

/** A grant that the keyword fold made into a menu: one of its keywords is chosen. */
const isKeywordMenu = (leaf: CompileLeaf) => leaf.family_id === "weapon-ability-grant" && leaf.parameters.keyword_choice === true;

/**
 * A choice-open whose only effect is a keyword menu ("select either the [A] or the [B]") is the
 * menu itself, so the opener is dropped: the menu's grant keeps the opener's choice_label, and the
 * fragment for a keyword menu lowers to the same DSL choice. Any other choice-open holding a menu
 * (a second effect, a random pick, a min or max other than one) is refused, because a sentence
 * after the menu would otherwise be split into a choice between the menu and that sentence.
 * The refusal names a second effect when there is one, and the choice's own bounds otherwise.
 */
export function dropRedundantMenuOpeners(list: readonly CompileLeaf[]): CompileLeaf[] {
  const dropped = new Set<number>();
  const relabelled = new Map<number, CompileLeaf>();
  list.forEach((leaf, index) => {
    if (leaf.family_id !== "choice-open") return;
    let end = index + 1;
    while (end < list.length && !isContainerOpener(list[end]!.family_id)) end += 1;
    const rest = list.slice(index + 1, end);
    const menus = rest.flatMap((other, offset) => isKeywordMenu(other) ? [index + 1 + offset] : []);
    if (menus.length === 0) return;
    const effects = rest.filter((other) => other.family_id !== "duration");
    const menu = effects.length === 1 && isKeywordMenu(effects[0]!) && (effects[0]!.parameters.keywords as unknown[]).length >= 2 ? effects[0]! : null;
    const oneOfOne = leaf.parameters.min_choices === 1 && leaf.parameters.max_choices === 1 && leaf.parameters.or_random === undefined;
    if (menu && oneOfOne) {
      dropped.add(index);
      if (leaf.parameters.choice_label !== undefined) {
        relabelled.set(list.indexOf(menu), { ...menu, parameters: { ...menu.parameters, choice_label: leaf.parameters.choice_label } });
      }
      return;
    }
    if (effects.length > 1 || (effects.length === 1 && !isKeywordMenu(effects[0]!))) {
      throw new CompileError("A choice-open over a keyword menu needs the menu as its only effect.");
    }
    throw new CompileError("A choice-open over a keyword menu needs exactly one choice: min_choices and max_choices both 1, and no random pick.");
  });
  return list.flatMap((leaf, index) => dropped.has(index) ? [] : [relabelled.get(index) ?? leaf]);
}
