import { exactSpan } from "./contracts.js";
import type { CompileLeaf } from "./compile-fragments.js";
import { isContainerOpener } from "./compile-containers.js";
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
 * A sentence whose only effects are printed grants ("Friendly K units have the following ability:") after
 * a part with a moment is a part of its own too: it holds whenever the record applies.
 */

// The usage prefix may be printed in parentheses with its owner: "(Once per battle, per army) When …".
const MOMENT_OPENER = /^(?:once per (?:battle|turn|phase|battle round),\s*|\(once per (?:battle|turn|phase|battle round)(?:,\s*per (?:army|unit|model))?\)\s*)?(?:each time|whenever|when|after|at the (?:start|end) of|during the declare battle formations step)\b/iu;
const TIED_BACK = /^(?:when doing so|(?:each time|when) (?:you|it|they) do(?:es)?)\b/iu;
const IN_ADDITION = /^in addition\b/iu;
// "In addition, each time a model in that unit …": the sentence's opening clause names a unit an
// earlier sentence introduced. Later in the sentence, "that unit" is usually its own subject.
// "such an enemy unit" always points back, wherever it sits in the sentence.
const SUCH = /\bsuch (?:an? )?(?:\w+ )?(?:units?|models?|weapons?|attacks?)\b/iu;
const REFERS_BACK = /\b(?:that|those|such(?: an?)?) (?:units?|models?|weapons?|attacks?)\b/iu;
/** The leaves that begin a menu's options: a named option, or a resource-action menu's action. */
const OPTION_MARKERS = new Set(["named-option", "menu-action"]);
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
  // A bold heading line before the sentence ("**Afflicted**") titles it; its words are not the sentence's.
  const lead = gap.slice(Math.max(...[".", ";", ":"].map((mark) => gap.lastIndexOf(mark))) + 1).replace(/^(?:\s*\*\*[^*\n]+\*\*[ \t]*\n)+/u, "");
  return `${lead}${between(sourceText, first.start_byte, last.end_byte ?? first.start_byte)}`.replace(/^[\s*#■•\-–—]+/u, "");
}

/** A bullet mark in a sentence's lead-in: ■ or •, or a dash or asterisk that opens a line. */
const BULLET = /[■•]|(?:^|\n)[ \t]*[-*–—](?=\s)/u;
/** A line holding only a bold heading ("**Favoured ka’tah**"): what follows is a block of its own. */
const HEADING_LINE = /(?:^|[\r\n])[ \t]*\*\*[^*\r\n]+\*\*[ \t]*[\r\n]/u;
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
  // "Friendly K units have the following ability:" is a standing grant the units hold whenever the record applies:
  // a sentence whose effects are all printed grants (compile-granted.ts folds the granted bodies onto them).
  const standingGrant = (sentence: readonly CompileLeaf[]) => hasEffect(sentence)
    && sentence.every((leaf) => leaf.role !== "EFFECT" || (leaf.family_id === "ability-record-grant" && Array.isArray(leaf.parameters.granted)));
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
  if (header.some((leaf) => (leaf.role === "EVENT" && !attackHeader(leaf)) || HEADER_ONCE.has(leaf.family_id))) {
    // The header's moment is the whole record's, except across a bold heading line ("**Favoured ka’tah**"): each block
    // under one is a rule of its own, so it neither fires at the header's moment nor splits anywhere else.
    const headed = sentences.map((sentence, position) => position > firstEffectful && hasEffect(sentence.concat(sentences.slice(position + 1).flat()))
      && HEADING_LINE.test(sentenceGap(leaves, starts[position]!, sentence, sourceText)));
    if (!headed.some(Boolean)) return null;
    const blocks: CompileLeaf[][] = [[...header]];
    sentences.forEach((sentence, position) => {
      if (headed[position]) blocks.push([]);
      if (position >= firstEffectful) blocks.at(-1)!.push(...sentence);
    });
    return blocks.every(hasEffect) ? blocks : null;
  }

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
    const label = labelLine(leaves, starts[position]!, sentence, sourceText) || HEADING_LINE.test(sentenceGap(leaves, starts[position]!, sentence, sourceText));
    const ends = !bulleted && (moment || label);
    moments.push(moment);
    labels.push(label);
    inList.push(!label && (listed[position]! || (position > 0 && inList[position - 1]! && !ends)));
  });
  // A menu whose named options each carry their own moment ("Calistus. Your Movement phase, when …") is used at
  // those moments, not at an earlier sentence's: the sentence that opens it starts a part of its own.
  const selfTimedMenu = (position: number) => {
    if (!sentences[position]!.some((leaf) => isContainerOpener(leaf.family_id))) return false;
    const options: CompileLeaf[][] = [];
    for (const leaf of sentences.slice(position + 1).flat()) {
      if (OPTION_MARKERS.has(leaf.family_id)) options.push([]);
      options.at(-1)?.push(leaf);
    }
    // A resource-action menu's actions (menu-action markers) are each triggered on their own, however many there are.
    return (options.length > 1 || options.some((option) => option[0]!.family_id === "menu-action")) && options.every((option) => option.some((leaf) => leaf.role === "EVENT" || leaf.family_id === "phase-window"));
  };
  const parts: CompileLeaf[][] = [[]];
  sentences.forEach((sentence, position) => {
    const words = sentenceWords(leaves, starts[position]!, sentence, sourceText);
    // A standing grant after a part with a moment of its own is not that moment's: the moment cannot trigger it.
    const standing = standingGrant(sentence) && parts.at(-1)!.some((leaf) => leaf.role === "EVENT" && leaf.family_id !== "select-unit" && leaf.family_id !== "dice-roll");
    // A menu whose options begin at named-option markers holds every sentence after its opener: "Each time …" there is one option's moment.
    // A resource-action menu holds every sentence after its opener the same way, even before its first action: a
    // sentence between them ("At the end of the battle round, …") is given back by the container plan.
    const inMenu = (parts.at(-1)!.some((leaf) => isContainerOpener(leaf.family_id)) && parts.at(-1)!.some((leaf) => OPTION_MARKERS.has(leaf.family_id)))
      || parts.at(-1)!.some((leaf) => leaf.family_id === "resource-action-menu-open");
    // "While …: this model has K. In your Shooting phase, you can select …": an item of the list the header's colon
    // introduces that holds its own selection or phase is a rule of its own under the header's condition, so neither
    // reaches a sibling item.
    const ownTiming = (leaves: readonly CompileLeaf[]) => leaves.some((leaf) => leaf.family_id === "select-unit" || leaf.family_id === "phase-window");
    const headerItem = listed[firstEffectful]! && inList[position]! && !inMenu && (ownTiming(sentence) || ownTiming(parts.at(-1)!));
    const opensPart = position > firstEffectful && (!inList[position] || headerItem) && !inMenu && parts.at(-1)!.some((leaf) => leaf.role === "EFFECT") && (
      headerItem || moments[position] || labels[position] || standing || selfTimedMenu(position)) && !REFERS_BACK.test(words.replace(/^in addition,\s*/iu, "").split(",")[0]!) && !SUCH.test(words);
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
  // "While this model is leading a unit, …. When …, …": a first sentence that opens with "While" frames the whole
  // ability, so its leading-unit condition is copied into each later part, unless that part opens with
  // "In addition," (it states its own frame) or already holds a leading-unit leaf of its own.
  const firstSentence = sentences[firstEffectful]!;
  const firstEffectAt = firstSentence.findIndex((leaf) => leaf.role === "EFFECT" || leaf.role === "EVENT");
  const whileFrame = /^while\b/iu.test(sentenceWords(leaves, starts[firstEffectful]!, firstSentence, sourceText))
    ? firstSentence.slice(0, firstEffectAt).filter((leaf) => leaf.role === "CONDITION" && leaf.family_id === "leading-unit") : [];
  // Whether a sentence of the part, with its lead-in, says "that unit".
  const partSaysThatUnit = (part: readonly CompileLeaf[]) => sentences.some((sentence, position) => sentence.some((leaf) => part.includes(leaf))
    && /\bthat unit\b/iu.test(sentenceWords(leaves, starts[position]!, sentence, sourceText)));
  // A part's own opening sentence (its first leaf; parts are built before the header is prepended).
  const opensInAddition = (part: readonly CompileLeaf[]) => {
    const position = sentences.findIndex((sentence) => sentence.includes(part[0]!));
    return position !== -1 && IN_ADDITION.test(sentenceWords(leaves, starts[position]!, sentences[position]!, sourceText));
  };
  // "If your Army Faction is X, at the start of …, …. Each time …": an army-faction condition that leads the first
  // sentence decides whether the record applies at all, so every later part holds it too.
  const factionFrame = firstSentence.slice(0, firstEffectAt).filter((leaf) => leaf.family_id === "army-faction");
  const frame = leadingFrame(leaves, parts[0]!);
  // A later part holds the frame the record opens with: the "While" frame, or the leading-unit frame a part naming "that unit" is about.
  const frameFor = (part: CompileLeaf[], at: number, byThatUnit: boolean): CompileLeaf[] => {
    if (at <= 0) return [];
    // Only a part that says "that unit" is about the unit the frame names; a sentence that never refers back is not gated.
    if (whileFrame.length > 0 && !opensInAddition(part) && !part.some((leaf) => leaf.family_id === "leading-unit") && partSaysThatUnit(part)) return whileFrame;
    return byThatUnit && frame !== null && namesFrameUnit(part, frame, sourceText) ? [frame] : [];
  };
  const factionFor = (part: CompileLeaf[], at: number) => at > 0 && !part.some((leaf) => leaf.family_id === "army-faction") ? factionFrame : [];
  return parts.map((part, at) => armyOnly(part) ? part
    : (attackFrame || labelled.has(part[0]!)) && at > 0 ? [...factionFor(part, at), ...frameFor(part, at, false), ...part]
    : [...header, ...factionFor(part, at), ...frameFor(part, at, true), ...part]);
}

/**
 * "While this model is leading a unit, …": the record's first leaf, when it is a leading-unit condition, frames the
 * unit the later sentences call "that unit". Null when the record opens any other way.
 */
function leadingFrame(leaves: readonly CompileLeaf[], first: readonly CompileLeaf[]): CompileLeaf | null {
  const leaf = first[0];
  return leaf !== undefined && leaf === leaves[0] && leaf.role === "CONDITION" && leaf.family_id === "leading-unit" ? leaf : null;
}

/** A later part that says "that unit" is about the unit the frame names, and holds only while the frame does; a part with its own leading-unit condition keeps it. */
function namesFrameUnit(part: readonly CompileLeaf[], frame: CompileLeaf, sourceText: string): boolean {
  return !part.some((leaf) => leaf.family_id === frame.family_id) && saysThatUnit(part, sourceText);
}

/** Whether the part's own wording says "that unit". */
function saysThatUnit(part: readonly CompileLeaf[], sourceText: string): boolean {
  const first = part[0]!;
  const last = part.at(-1)!;
  return /\bthat unit\b/iu.test(between(sourceText, first.start_byte, last.end_byte ?? first.start_byte));
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
  const behaviors = new Set(results.map((result) => String((result.mechanics as unknown as Node).behavior)));
  const behavior = BEHAVIOR_RANK.find((kind) => behaviors.has(kind)) ?? "passive";
  for (const [position, { mechanics }] of results.entries()) {
    const node = mechanics as unknown as Node;
    const own = durations[position];
    const durationOf = own !== undefined && own !== "permanent" ? own : inherited;
    // "You can select …" in a part of a record that is otherwise reactive: the record's behavior no longer says the player may decline it.
    // A Stratagem's parts are one use the player already chose to make.
    const declinable = !oneUse && node.behavior === "activated" && behavior !== "activated";
    const carried: Node = {
      ...(node.trigger != null ? { trigger: node.trigger } : {}),
      ...(node.usage != null ? { usage: node.usage } : {}),
      ...(durationOf !== undefined && durationOf !== "permanent" ? { duration: durationOf } : {}),
      ...(declinable ? { optional: true } : {}),
    };
    const effect = node.effect as Node;
    if (Object.keys(carried).length) steps.push({ type: "ability-part", ...carried, effect });
    // A part that is already a run of moments ("each time …; each time …") adds its parts as they are.
    else if (effect.type === "sequence" && (effect.steps as Node[]).every((step) => step.type === "ability-part")) steps.push(...(effect.steps as Node[]));
    else steps.push(effect);
  }
  const mechanics = { effect: { type: "sequence", steps }, scope: { duration: "permanent" }, behavior, trigger: null } as unknown as Mechanics;
  return { mechanics, checks, ...(cores.length === 1 ? { core: JSON.parse(cores[0]!) } : {}), errors };
}
