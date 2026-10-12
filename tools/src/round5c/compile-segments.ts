import { exactSpan } from "./contracts.js";
import type { CompileLeaf } from "./compile-fragments.js";
import type { CoreCheck } from "./core-checks.js";
import type { Mechanics } from "./entries.js";

type Node = Record<string, unknown>;

/**
 * Independent sentences of one ability. A sentence that opens a new moment ("Each time…",
 * "When…", "After…", "At the end of…", optionally after "Once per battle,") or opens with
 * "In addition," is its own part: the conditions, usage limit and duration of earlier sentences
 * do not reach it. A sentence tied back to the one before ("When doing so,", "If you do,")
 * opens no moment, so it stays in that sentence's part. A sentence whose effects are all
 * army-construction rules is a part of its own too, and so is the sentence after it, unless its
 * rules point back to the group of a composition rule in the part before it.
 *
 * Leading sentences with no effect ("ADEPTUS CUSTODES model only.", a Stratagem's phase and
 * target lines) are the ability's header: they are compiled into every part. A header holding a
 * moment, a usage limit or a choice belongs to the whole ability only once, so such an ability
 * is not split. Sentences after a colon ("While …:" and its bullets) are the items it introduces,
 * so none of them opens a new part (a colon before a roll's result band does not end its
 * sentence), and neither does a sentence naming "that unit" or "such a weapon" from an earlier one.
 */

const MOMENT_OPENER = /^(?:once per (?:battle|turn|phase|battle round),\s*)?(?:each time|whenever|when|after|at the (?:start|end) of)\b/iu;
const TIED_BACK = /^(?:when doing so|(?:each time|when) (?:you|it|they) do(?:es)?)\b/iu;
const IN_ADDITION = /^in addition\b/iu;
// "In addition, each time a model in that unit …": the sentence's opening clause names a unit an
// earlier sentence introduced. Later in the sentence, "that unit" is usually its own subject.
// "such an enemy unit" always points back, wherever it sits in the sentence.
const SUCH = /\bsuch (?:an? )?(?:\w+ )?(?:units?|models?|weapons?|attacks?)\b/iu;
const REFERS_BACK = /\b(?:that|those|such(?: an?)?) (?:units?|models?|weapons?|attacks?)\b/iu;
/** Leaves that make an ability a Stratagem, used once as a whole. */
export const STRATAGEM_HEADER = new Set(["stratagem-target", "use-window", "stratagem-cost"]);
// Header leaves that would be counted once per part if they were copied into each.
const HEADER_ONCE = new Set(["usage-limit", "usage-scope", "optional-use", "rules-bundle-marker", "triggering-target"]);

/** The source between two byte offsets, or "" where a leaf's offsets do not reach into the text. */
function between(sourceText: string, start: number, end: number): string {
  const length = Buffer.byteLength(sourceText, "utf8");
  return start < end && end <= length ? exactSpan(sourceText, start, end) : "";
}

/**
 * Whether moments in a row, with no effect between, are alternatives. Moments joined by "or" or
 * "and" ("selected to shoot or to fight"; "after a Hit roll, a Wound roll, or a saving throw")
 * are alternatives: each gap is a comma or holds the conjunction, and the last gap holds it.
 * Otherwise a later moment is nested in an earlier one ("each time this unit uses this ability,
 * at the end of the phase"): a delayed moment that a DSL trigger list (any one of its events)
 * cannot express. Leaves in different fragments, or with no source text, keep the alternative
 * reading; one leaf listed twice (an event's `also` moment) is one alternative.
 */
export function alternativeMoments(moments: readonly CompileLeaf[], sourceText: string | undefined): boolean {
  const run = moments.filter((leaf, index) => index === 0 || leaf !== moments[index - 1]);
  if (sourceText === undefined || run.length < 2) return true;
  const gaps: string[] = [];
  for (let index = 1; index < run.length; index += 1) {
    const previous = run[index - 1]!;
    const next = run[index]!;
    if ((previous.fragment ?? null) !== (next.fragment ?? null) || previous.end_byte === undefined || next.start_byte < previous.end_byte) return true;
    gaps.push(between(sourceText, previous.end_byte, next.start_byte));
  }
  const joined = (gap: string) => /\b(?:or|and)\b/iu.test(gap);
  return joined(gaps.at(-1)!) && gaps.every((gap) => joined(gap) || /^\s*,\s*$/u.test(gap));
}

/** Whether a sentence ends between two leaves: "fragment" for a new source fragment, "list" for a colon introducing what follows. */
function sentenceBreak(previous: CompileLeaf, next: CompileLeaf, sourceText: string): "fragment" | "stop" | "list" | null {
  if (previous.fragment !== undefined && next.fragment !== undefined && previous.fragment !== next.fragment) return "fragment";
  if (previous.end_byte === undefined || next.start_byte <= previous.end_byte) return null;
  const gap = between(sourceText, previous.end_byte, next.start_byte);
  const mark = [...gap].reverse().find((character) => ".;:".includes(character));
  return mark === undefined ? null : mark === ":" ? "list" : "stop";
}

/** The source between a sentence and the leaf before it (the whole lead-in for the first sentence). */
function sentenceGap(leaves: readonly CompileLeaf[], start: number, sentence: readonly CompileLeaf[], sourceText: string): string {
  const first = sentence[0]!;
  const from = start === 0 ? 0 : leaves[start - 1]!.end_byte ?? first.start_byte;
  return between(sourceText, from, first.start_byte);
}

/** A sentence's words: the source after its break, through its last leaf. */
function sentenceWords(leaves: readonly CompileLeaf[], start: number, sentence: readonly CompileLeaf[], sourceText: string): string {
  const first = sentence[0]!;
  const last = sentence.at(-1)!;
  const gap = sentenceGap(leaves, start, sentence, sourceText);
  const lead = gap.slice(Math.max(...[".", ";", ":"].map((mark) => gap.lastIndexOf(mark))) + 1);
  return `${lead}${between(sourceText, first.start_byte, last.end_byte ?? first.start_byte)}`.replace(/^[\s*#■•\-–—]+/u, "");
}

/** A bullet mark in a sentence's lead-in: ■ or •, or a dash or asterisk that opens a line. */
const BULLET = /[■•]|(?:^|\n)[ \t]*[-*–—](?=\s)/u;
/** A plain label that opens its own source line: "Bestial Forms: …" (a bold granted-ability name is not one). */
const LABEL = /^[ \t]*(?!Or:)[A-Z][A-Za-z' ]{0,40}:/u;

/**
 * Whether a sentence starts its own source line with a label. The gap before it must hold a
 * newline, and the label is the text from that newline through the sentence's opening words.
 */
function labelLine(leaves: readonly CompileLeaf[], start: number, sentence: readonly CompileLeaf[], sourceText: string): boolean {
  const gap = sentenceGap(leaves, start, sentence, sourceText);
  const newline = gap.lastIndexOf("\n");
  if (newline === -1) return false;
  const opening = `${gap.slice(newline + 1)}${between(sourceText, sentence[0]!.start_byte, sentence.at(-1)!.end_byte ?? sentence[0]!.start_byte)}`;
  return LABEL.test(opening);
}

/**
 * The leaves of each independent part, the header copied into each, or null when the ability
 * is one part. Leaves must be in source order.
 */
export function sentenceSegments(leaves: readonly CompileLeaf[], sourceText: string | undefined): CompileLeaf[][] | null {
  if (sourceText === undefined || leaves.length < 2) return null;
  const sentences: CompileLeaf[][] = [];
  const starts: number[] = [];
  // "…until the end of the phase:" followed by bullets: the bullets are the list it introduces.
  const listed: boolean[] = [];
  leaves.forEach((leaf, index) => {
    // Before the first leaf, a colon ("While … near a beacon:") still introduces what follows.
    const found = index > 0 ? sentenceBreak(leaves[index - 1]!, leaf, sourceText)
      : between(sourceText, 0, leaf.start_byte).includes(":") ? "list" : "stop";
    // "Roll one D6: on a 4+, …": a colon before a roll's result band continues the roll's sentence.
    const ending = found === "list" && index > 0 && leaf.family_id === "roll-result" ? null : found;
    if (ending) {
      sentences.push([]);
      starts.push(index);
      listed.push(ending === "list");
    }
    sentences.at(-1)!.push(leaf);
  });
  const hasEffect = (sentence: readonly CompileLeaf[]) => sentence.some((leaf) => leaf.role === "EFFECT");
  const armyOnly = (sentence: readonly CompileLeaf[]) => hasEffect(sentence)
    && sentence.every((leaf) => leaf.role !== "EFFECT" || leaf.family_id === "army-construction");
  const firstEffectful = sentences.findIndex(hasEffect);
  if (firstEffectful === -1) return null;
  const header = sentences.slice(0, firstEffectful).flat();
  // An attack frame in the header ("This model's melee attacks … can:") is the list's own frame, which
  // a Stratagem's header also takes: a Stratagem's header keeps refusing a moment.
  const stratagem = leaves.some((leaf) => STRATAGEM_HEADER.has(leaf.family_id));
  const attackHeader = (leaf: CompileLeaf) => leaf.role === "EVENT" && leaf.family_id === "attack" && !stratagem;
  const attackFrame = header.some(attackHeader);
  if (header.some((leaf) => (leaf.role === "EVENT" && !attackHeader(leaf)) || HEADER_ONCE.has(leaf.family_id))) return null;

  // A colon's list runs until a sentence ends it: a bullet-free sentence that opens a moment or
  // "In addition," (rule a), or one that starts its own line with a label (rule b). Such a
  // sentence starts a part; a label line is never a list item.
  const moments: boolean[] = [];
  const labels: boolean[] = [];
  const inList: boolean[] = [];
  sentences.forEach((sentence, position) => {
    const words = sentenceWords(leaves, starts[position]!, sentence, sourceText);
    const bulleted = BULLET.test(sentenceGap(leaves, starts[position]!, sentence, sourceText));
    const moment = IN_ADDITION.test(words) || (MOMENT_OPENER.test(words) && !TIED_BACK.test(words));
    const label = labelLine(leaves, starts[position]!, sentence, sourceText);
    const ends = !bulleted && (moment || label);
    moments.push(moment);
    labels.push(label);
    inList.push(!label && (listed[position]! || (position > 0 && inList[position - 1]! && !ends)));
  });
  const parts: CompileLeaf[][] = [[]];
  sentences.forEach((sentence, position) => {
    const words = sentenceWords(leaves, starts[position]!, sentence, sourceText);
    const opensPart = position > firstEffectful && !inList[position] && parts.at(-1)!.some((leaf) => leaf.role === "EFFECT") && (
      moments[position] || labels[position]) && !REFERS_BACK.test(words.replace(/^in addition,\s*/iu, "").split(",")[0]!) && !SUCH.test(words);
    // "None of these models can be your WARLORD" after a composition rule: the group it points back
    // to is that rule's (compile-army.ts), so the sentence stays in that rule's part.
    const pointsBack = armyOnly(sentence) && parts.at(-1)!.some((leaf) => leaf.family_id === "army-construction" && leaf.parameters.rule === "composition")
      && sentence.some((leaf) => leaf.family_id === "army-construction" && leaf.parameters.subject === "antecedent");
    if (opensPart || (position > firstEffectful && !pointsBack && (armyOnly(sentence) || armyOnly(sentences[position - 1]!)))) parts.push([]);
    if (position >= firstEffectful) parts.at(-1)!.push(...sentence);
  });
  // A part with no effect (a moment sentence whose effects follow in the next one) joins the next.
  for (let at = parts.length - 2; at >= 0; at -= 1) {
    if (!hasEffect(parts[at]!)) parts.splice(at, 2, [...parts[at]!, ...parts[at + 1]!]);
  }
  if (!hasEffect(parts.at(-1)!) && parts.length > 1) parts.splice(-2, 2, [...parts.at(-2)!, ...parts.at(-1)!]);
  if (parts.length < 2) return null;
  // A Warlord gate in the header ("If a friendly X model is your Warlord, … have:") would gate every
  // part, and a moment that follows the list is not gated by the army. The ability stays one part,
  // which gatesTriggerOnWarlord (compile-warlord-test.ts) refuses.
  if (header.some((leaf) => leaf.family_id === "designated-filter" && leaf.parameters.tag === "warlord")) return null;
  // An army-construction rule is about the list, not the units a header names. An attack frame in the
  // header gates the list it introduces (the first part) only: a later part with its own moment
  // ("When this unit destroys a …") is not one of that frame's attacks.
  // A labelled part ("Bestial Forms: …") is a named rule of its own, so the list's header does not gate it either.
  const labelled = new Set(sentences.filter((_sentence, position) => labels[position]).map((sentence) => sentence[0]!));
  return parts.map((part, at) => armyOnly(part) ? part : (attackFrame || labelled.has(part[0]!)) && at > 0 ? part : [...header, ...part]);
}

type PartResult = { mechanics: Mechanics; checks: CoreCheck[]; core?: { target_restrictions: Node | Node[] } };

const BEHAVIOR_RANK = ["reactive", "activated", "aura", "passive"];

/**
 * One ability from its independently compiled parts. Each part keeps its own moment, usage limit
 * and duration on an ability-part; a part with none of those is its effect alone.
 */
export function joinSegments(results: readonly PartResult[], oneUse = false): { mechanics: Mechanics; checks: CoreCheck[]; core?: { target_restrictions: Node | Node[] }; errors: string[] } {
  const errors: string[] = [];
  const cores = [...new Set(results.flatMap((result) => result.core ? [JSON.stringify(result.core)] : []))];
  if (cores.length > 1) errors.push("Parts disagree on the Stratagem's target.");
  const checks = [...new Map(results.flatMap((result) => result.checks).map((check) => [JSON.stringify(check), check])).values()];
  const steps: unknown[] = [];
  const durations = results.map(({ mechanics }) => ((mechanics as unknown as Node).scope as Node | undefined)?.duration);
  // A Stratagem is one use: a part with no duration of its own lasts as long as the first part.
  const inherited = oneUse ? durations.find((duration) => duration !== undefined && duration !== "permanent") : undefined;
  for (const [position, { mechanics }] of results.entries()) {
    const node = mechanics as unknown as Node;
    const own = durations[position];
    const durationOf = own !== undefined && own !== "permanent" ? own : inherited;
    const carried: Node = {
      ...(node.trigger != null ? { trigger: node.trigger } : {}),
      ...(node.usage != null ? { usage: node.usage } : {}),
      ...(durationOf !== undefined && durationOf !== "permanent" ? { duration: durationOf } : {}),
    };
    const effect = node.effect as Node;
    if (Object.keys(carried).length) steps.push({ type: "ability-part", ...carried, effect });
    // A part that is already a run of moments ("each time …; each time …") adds its parts as they are.
    else if (effect.type === "sequence" && (effect.steps as Node[]).every((step) => step.type === "ability-part")) steps.push(...(effect.steps as Node[]));
    else steps.push(effect);
  }
  const behaviors = new Set(results.map((result) => String((result.mechanics as unknown as Node).behavior)));
  const behavior = BEHAVIOR_RANK.find((kind) => behaviors.has(kind)) ?? "passive";
  const mechanics = { effect: { type: "sequence", steps }, scope: { duration: "permanent" }, behavior, trigger: null } as unknown as Mechanics;
  return { mechanics, checks, ...(cores.length === 1 ? { core: JSON.parse(cores[0]!) } : {}), errors };
}
