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
 * army-construction rules is a part of its own too, and so is the sentence after it.
 *
 * Leading sentences with no effect ("ADEPTUS CUSTODES model only.", a Stratagem's phase and
 * target lines) are the ability's header: they are compiled into every part. A header holding a
 * moment, a usage limit or a choice belongs to the whole ability only once, so such an ability
 * is not split. Sentences after a colon ("While …:" and its bullets) are the items it introduces,
 * so none of them opens a new part, and neither does a sentence naming "that unit" or "such a
 * weapon" from an earlier one.
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

/** Whether a sentence ends between two leaves: "fragment" for a new source fragment, "list" for a colon introducing what follows. */
function sentenceBreak(previous: CompileLeaf, next: CompileLeaf, sourceText: string): "fragment" | "stop" | "list" | null {
  if (previous.fragment !== undefined && next.fragment !== undefined && previous.fragment !== next.fragment) return "fragment";
  if (previous.end_byte === undefined || next.start_byte <= previous.end_byte) return null;
  const gap = between(sourceText, previous.end_byte, next.start_byte);
  const mark = [...gap].reverse().find((character) => ".;:".includes(character));
  return mark === undefined ? null : mark === ":" ? "list" : "stop";
}

/** A sentence's words: the source after its break, through its last leaf. */
function sentenceWords(leaves: readonly CompileLeaf[], start: number, sentence: readonly CompileLeaf[], sourceText: string): string {
  const first = sentence[0]!;
  const last = sentence.at(-1)!;
  const from = start === 0 ? 0 : leaves[start - 1]!.end_byte ?? first.start_byte;
  const gap = between(sourceText, from, first.start_byte);
  const lead = gap.slice(Math.max(...[".", ";", ":"].map((mark) => gap.lastIndexOf(mark))) + 1);
  return `${lead}${between(sourceText, first.start_byte, last.end_byte ?? first.start_byte)}`.replace(/^[\s*#■•\-–—]+/u, "");
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
    const ending = index > 0 ? sentenceBreak(leaves[index - 1]!, leaf, sourceText)
      : between(sourceText, 0, leaf.start_byte).includes(":") ? "list" : "stop";
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
  if (header.some((leaf) => leaf.role === "EVENT" || HEADER_ONCE.has(leaf.family_id))) return null;

  const parts: CompileLeaf[][] = [[]];
  sentences.forEach((sentence, position) => {
    const words = sentenceWords(leaves, starts[position]!, sentence, sourceText);
    const opensPart = position > firstEffectful && !listed.slice(0, position + 1).includes(true) && parts.at(-1)!.some((leaf) => leaf.role === "EFFECT") && (
      IN_ADDITION.test(words) || (MOMENT_OPENER.test(words) && !TIED_BACK.test(words))) && !REFERS_BACK.test(words.replace(/^in addition,\s*/iu, "").split(",")[0]!) && !SUCH.test(words);
    if (opensPart || (position > firstEffectful && (armyOnly(sentence) || armyOnly(sentences[position - 1]!)))) parts.push([]);
    if (position >= firstEffectful) parts.at(-1)!.push(...sentence);
  });
  // A part with no effect (a moment sentence whose effects follow in the next one) joins the next.
  for (let at = parts.length - 2; at >= 0; at -= 1) {
    if (!hasEffect(parts[at]!)) parts.splice(at, 2, [...parts[at]!, ...parts[at + 1]!]);
  }
  if (!hasEffect(parts.at(-1)!) && parts.length > 1) parts.splice(-2, 2, [...parts.at(-2)!, ...parts.at(-1)!]);
  if (parts.length < 2) return null;
  // An army-construction rule is about the list, not the units a header names.
  return parts.map((part) => armyOnly(part) ? part : [...header, ...part]);
}

type PartResult = { mechanics: Mechanics; checks: CoreCheck[]; core?: { target_restrictions: Node } };

const BEHAVIOR_RANK = ["reactive", "activated", "aura", "passive"];

/**
 * One ability from its independently compiled parts. Each part keeps its own moment, usage limit
 * and duration on an ability-part; a part with none of those is its effect alone.
 */
export function joinSegments(results: readonly PartResult[], oneUse = false): { mechanics: Mechanics; checks: CoreCheck[]; core?: { target_restrictions: Node }; errors: string[] } {
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
