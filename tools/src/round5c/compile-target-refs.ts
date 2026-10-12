import { ANTECEDENT, antecedentKeys } from "./antecedent-families.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { currentFamilyVersion, exactSpan, familyRole } from "./contracts.js";
import { AMONG_TARGETS } from "./family-extensions-w8-multi.js";
import { awaitsFollowingFilter, FOLLOWING_FILTER } from "./family-extensions-11.js";
import { type TargetHead, targetGroupOf, targetHeads } from "./compile-target-groups.js";
import { assignTargetModes } from "./compile-target-modes.js";

/**
 * References to one or several of a Stratagem's named targets ("your **VEHICLE** unit", "both of
 * those units") while its leaves lower. A reference travels through lowering as a string the
 * compiler mints (`stratagem-target:<name>`, or `stratagem-targets:<every|any>:<a>,<b>` for
 * several) and becomes the DSL's `{stratagem_target: name}` once the entry is built
 * (`resolveTargetRefs`): an effect on several targets is one effect per target, a condition about
 * several is all of them (every) or any one of them (any), and a moment is one alternative per target.
 */

type Node = Record<string, unknown>;

const ONE = "stratagem-target:";
const SEVERAL = "stratagem-targets:";

/** The reference to one named target. */
export const targetRef = (name: string) => `${ONE}${name}`;

/** Whether a lowered value is a reference to the Stratagem's targets (one or several). */
export function isTargetRef(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith(ONE) || value.startsWith(SEVERAL));
}

/** Whether a lowered value is a reference to one named Stratagem target (not several). */
export function isOneTargetRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ONE);
}

/** One matched target, and the keywords it must also have when only some of its alternatives match. */
type Match = { name: string; gate?: string[] };
type Several = { pick: "every" | "any"; targets: Match[] };

/** One target, or every / any one of several. */
export function targetRefs(pick: "every" | "any", targets: readonly Match[]): string {
  return targets.length === 1 && !targets[0]!.gate ? targetRef(targets[0]!.name) : `${SEVERAL}${JSON.stringify({ pick, targets })}`;
}

const parseSeveral = (ref: string) => JSON.parse(ref.slice(SEVERAL.length)) as Several;

/**
 * Keys a target reference can fill: those whose lowering takes any DSL unit-ref (effects through
 * `compile-fragments.ts` target(), conditions through their widened who), as compile-antecedent.ts
 * binds selected and triggering units to.
 */
export const TARGET_REF_KEYS: Readonly<Record<string, readonly string[]>> = {
  "characteristic-modifier": ["subject"], "weapon-ability-grant": ["subject"], "weapon-ability-range": ["subject"], "keyword-grant": ["subject"], "feel-no-pain": ["subject"],
  "regain-wounds": ["subject"], "return-models": ["subject"], "eligibility-permission": ["subject", "into"], "core-ability-grant": ["subject"],
  "invulnerable-save": ["subject"], "ability-record-grant": ["subject"], "move-through": ["subject"],
  "targeting-restriction": ["by", "target"], "weapon-property-scope": ["subject"], "ignore-modifiers": ["subject"],
  "roll-modifier": ["subject"], reroll: ["subject"], "make-move": ["subject"], "act-after-move": ["subject"], "no-advance-roll": ["subject"],
  "ability-activate": ["subject"], "set-up": ["subject"], "apply-mark": ["subject"], test: ["target"],
  "unit-state": ["subject", "with"], "unit-activity": ["subject"], "unit-position": ["subject", "of"], "unit-keyword": ["subject"],
  "hit-by-attacks": ["subject"], "in-region": ["subject"], targeted: ["subject"], "target-is-selected": ["by", "target"],
  visible: ["subject", "to"], eligible: ["subject"],
};

const accepts = (leaf: CompileLeaf, key: string) => TARGET_REF_KEYS[leaf.family_id]?.includes(key) === true;

/** A Stratagem's fragments where its targets are already chosen: everything after WHEN and TARGET. */
const afterTargeting = (leaf: CompileLeaf) => leaf.fragment !== "TARGET" && leaf.fragment !== "WHEN";

/**
 * Which targets an among-filter names: the heads its side, level and keywords match. A target whose
 * filter offers alternatives ("one **ARMIGER** model or one **TITANIC** model") matches when every
 * alternative has the keywords, and matches gated on them when only some do: "your **ARMIGER**
 * models" covers the first target when it is an ARMIGER.
 */
function matchedNames(filter: CompileLeaf, heads: readonly TargetHead[]): Match[] {
  const p = filter.parameters as { side: string; keywords?: string[]; level?: string } & Record<string, unknown>;
  const extra = Object.keys(p).filter((key) => !["side", "keywords", "level", "among", "targets"].includes(key));
  if (extra.length) throw new CompileError(`An among-filter names a Stratagem target by side, level and keywords only; it also holds ${extra.join(", ")}.`);
  const level = p.level ?? "unit";
  return heads.flatMap((head) => {
    const side = p.side === "any" || (head.side !== null && head.side === p.side);
    if (!side || head.level !== level) return [];
    const missing = (p.keywords ?? []).filter((keyword) => !head.keywords.includes(keyword));
    if (missing.length === 0) return head.names.map((name) => ({ name }));
    const fits = head.alternatives.filter((keywords) => missing.every((keyword) => keywords.includes(keyword)));
    if (fits.length === 0) return [];
    return head.names.map((name) => fits.length === head.alternatives.length ? { name } : { name, gate: missing });
  });
}

/**
 * The reference an among-filter makes, refusing a pick that is not exactly what the targets allow.
 * A bare "your unit" (no keywords) that matches several targets, the first among them, is the
 * first target when the record has no target modes; any other ambiguity refuses.
 */
/** Whether the head that names `name` picks several targets: an up-to count, or a count_max above one. */
function isMultiCountHead(heads: readonly TargetHead[], name: string): boolean {
  const head = heads.find((item) => item.names.includes(name));
  const parameters = head?.selector?.parameters;
  if (parameters === undefined || head?.selector?.family_id !== "stratagem-target") return false;
  return parameters.count === "up-to" || Number(parameters.count_max ?? 1) > 1;
}

function referenceOf(filter: CompileLeaf, heads: readonly TargetHead[]): { ref: string; singular: boolean } {
  const matches = matchedNames(filter, heads);
  const names = matches.map((match) => match.name);
  const pick = String(filter.parameters.targets);
  if (matches.length === 0) throw new CompileError(`An among-filter at byte ${filter.start_byte} matches none of the Stratagem's targets.`);
  if (pick === "one") {
    const bare = ((filter.parameters.keywords as string[] | undefined) ?? []).length === 0;
    const first = heads[0]!;
    // With target modes the chosen target may be in either mode, so a bare "your unit" is not the first target.
    const moded = heads.some((head) => head.mode !== null);
    if (!moded && matches.length > 1 && bare && first.names.length === 1 && names[0] === first.names[0] && !matches[0]!.gate) return { ref: targetRef(first.names[0]!), singular: true };
    if (matches.length !== 1) throw new CompileError(`An among-filter at byte ${filter.start_byte} names one target but matches ${matches.length} (${names.join(", ")}).`);
    if (matches[0]!.gate) throw new CompileError(`An among-filter at byte ${filter.start_byte} names one target, which has its keywords only in some of its alternatives.`);
    return { ref: targetRef(names[0]!), singular: true };
  }
  // "one of those WAR DOG units" over one "up to three" head: the head is one target that holds several units,
  // so a plural pick takes that head whole. A singular head or a fixed count keeps the refusal below.
  if (matches.length === 1 && !matches[0]!.gate && isMultiCountHead(heads, names[0]!)) return { ref: targetRefs(pick as "every" | "any", matches), singular: false };
  if (matches.length < 2) throw new CompileError(`An among-filter at byte ${filter.start_byte} names ${pick === "every" ? "every" : "any one"} of several targets but matches only ${names[0]}.`);
  return { ref: targetRefs(pick as "every" | "any", matches), singular: false };
}

/**
 * The EFFECT leaves of the same fragment whose span holds the among-filter at `index`. The
 * filter's own span lies inside its container's, and a container starts no later than the filter.
 */
function containerOf(leaves: readonly CompileLeaf[], index: number): number[] {
  const filter = leaves[index]!;
  const end = filter.end_byte ?? filter.start_byte;
  return leaves.flatMap((leaf, at) => at !== index && leaf.role === "EFFECT" && leaf.fragment === filter.fragment
    && leaf.start_byte <= filter.start_byte && end <= (leaf.end_byte ?? leaf.start_byte) ? [at] : []);
}

/** The one target a group names, refusing a group of several ("Two X units" pointed back to as "it"). */
function oneTarget(head: TargetHead, leaf: CompileLeaf): string {
  if (head.names.length !== 1) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to a group of ${head.names.length} targets; the compiler binds only one.`);
  return targetRef(head.names[0]!);
}

/**
 * An anaphor in TARGET, in a Stratagem with several targets. A condition that gates a later
 * target ("If that unit is **BATTLELINE**, you can also target …") is about the target before
 * it. In a later target's own conditions every anaphor ("within 6\" of it", "of that **PSYKER**
 * model", "that **X** unit is within 6\" of") names the target before it; the candidate unit
 * itself is this-unit or target. The first target's anaphors keep their meaning
 * (compile-antecedent.ts).
 */
function bindInTarget(list: readonly CompileLeaf[], index: number, heads: readonly TargetHead[], sourceText: string | undefined): CompileLeaf {
  const leaf = list[index]!;
  const keys = antecedentKeys(leaf.family_id, leaf.parameters);
  const { group, gate } = targetGroupOf(list, index, sourceText);
  if (gate) {
    if (leaf.parameters.subject !== ANTECEDENT) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} decides whether a later target can be selected, so it must be about the earlier target (subject antecedent).`);
    return bind(leaf, keys, oneTarget(heads[group - 1]!, leaf));
  }
  if (group === 0 || keys.length === 0) return leaf;
  return bind(leaf, keys, oneTarget(heads[group - 1]!, leaf));
}

/**
 * Binds a targeting restriction that holds an among-filter naming its enemy target: the filter's
 * reference is the restriction's target, and an antecedent `by` is the attacker that the nearest
 * attack before it names (the among-filter before that attack). Without such an attacker the
 * restriction refuses, rather than taking the enemy target as the attacker.
 */
function bindRestriction(leaves: CompileLeaf[], at: number, ref: string, start_byte: number, attackers: readonly { at: number; ref: string }[]): void {
  const restriction = leaves[at]!;
  const keys = antecedentKeys(restriction.family_id, restriction.parameters);
  if (!keys.includes("target")) throw new CompileError(`An among-filter at byte ${start_byte} names a target inside a targeting restriction whose target is not antecedent.`);
  let bound = bind(restriction, ["target"], ref);
  if (keys.includes("by")) {
    const attacker = attackers.filter((item) => item.at < at).at(-1);
    if (attacker === undefined) throw new CompileError(`${restriction.family_id} at byte ${restriction.start_byte} takes its attacker from an antecedent, but no among-filter names the attacker before it.`);
    bound = bind(bound, ["by"], attacker.ref);
  }
  leaves[at] = bound;
}

/** The keys of `leaf` set to `ref`, refusing any its family cannot name a target with. */
function bind(leaf: CompileLeaf, keys: readonly string[], ref: string): CompileLeaf {
  const refused = keys.filter((key) => !accepts(leaf, key));
  if (refused.length) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} names a Stratagem target, which its ${refused.join(", ")} cannot hold.`);
  return { ...leaf, parameters: { ...leaf.parameters, ...Object.fromEntries(keys.map((key) => [key, ref])) } };
}

const FOLLOWING_KEYS = ["of", "with", "target", "to", "by", "object", "into"];
/** Wording that points back to several units at once: "those", "both", "either", "each of", "them" and "the targeted units". Bare "each" and "models" are not here: singular "each time a model" leaves are valid in several-target records. */
const PLURAL = /\b(?:those|both|either|each of|them|the targeted units)\b/iu;

/**
 * "One **X** unit within 6\" of a friendly **Y** unit that was selected as the target of …": the
 * **Y** unit is named only inside the target's eligibility, but the binding makes it one unit,
 * named when the Stratagem is used, so it is a further (bound) target. A TARGET target-binding
 * right after the unit-filter a distance (or other following-filter key) is measured from opens a
 * target there; the distance names that target. Returns the leaves unchanged when none does.
 */
function promoteBoundFilters(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "stratagem-target" || leaf.family_id === "triggering-target")) return [...list];
  const out: CompileLeaf[] = [];
  const promoted: number[] = [];
  list.forEach((leaf, index) => {
    const binding = list[index + 1];
    const measuring = list[index - 1];
    if (leaf.family_id === "unit-filter" && leaf.fragment === "TARGET" && binding?.family_id === "target-binding" && binding.fragment === "TARGET"
      && measuring?.fragment === "TARGET" && awaitsFollowingFilter(measuring.parameters)) {
      const version = currentFamilyVersion("stratagem-target");
      out.push({ role: familyRole("stratagem-target", version), family_id: "stratagem-target", family_version: version, parameters: { count: "one" }, start_byte: leaf.start_byte, end_byte: leaf.start_byte, fragment: "TARGET" });
      promoted.push(out.length - 1);
    }
    out.push(leaf);
  });
  if (promoted.length === 0) return out;
  const heads = targetHeads(out);
  for (const at of promoted) {
    const measuring = out[at - 1]!;
    const key = FOLLOWING_KEYS.find((name) => measuring.parameters[name] === FOLLOWING_FILTER)!;
    out[at - 1] = bind(measuring, [key], targetRef(heads.find((head) => head.index === at)!.names[0]!));
  }
  return out;
}

/**
 * Bind every among-filter of a Stratagem with several targets to the leaf it names, and drop the
 * filter. It is the other unit of the distance or visibility right before it ("within 6\" of" +
 * "that **TRANSPORT**"), the attacker of the attack right after it ("a model in" + "one of those
 * units" + "makes an attack"), the unit of an ownerless moment right after it, or the unit the
 * next leaf points back to ("your **VEHICLE** unit" + "is eligible …"). Returns the bound leaves
 * and, for each, the target an `antecedent` with no nearer introducer names: the most recent
 * singular reference, else the last target; after a moment or attack of several targets, that
 * moment's unit.
 */
export function bindTargetRefs(raw: readonly CompileLeaf[], sourceText?: string): { leaves: CompileLeaf[]; focus: (index: number) => string | null } {
  const input = assignTargetModes(promoteBoundFilters(raw), sourceText).leaves;
  const heads = targetHeads(input);
  const names = heads.flatMap((head) => head.names);
  const among = input.filter((leaf) => leaf.family_id === "unit-filter" && leaf.parameters.among === AMONG_TARGETS);
  if (names.length < 2) {
    if (among.length) throw new CompileError("An among-filter picks among a Stratagem's targets, but this record names one target; name it as this unit.");
    return { leaves: [...input], focus: () => null };
  }
  const leaves = input.map((leaf, index) => leaf.fragment === "TARGET" ? bindInTarget(input, index, heads, sourceText) : leaf);
  const dropped = new Set<number>();
  // Attack leaves an among-filter named the attacker of, and restrictions whose enemy target an among-filter names.
  const attackers: Array<{ at: number; ref: string }> = [];
  const restrictionTargets: Array<{ at: number; ref: string; start_byte: number }> = [];
  // What a later bare antecedent names, at each leaf.
  const focusAt: Array<string | null> = leaves.map(() => null);
  // The level of the target a bare antecedent names: "model" when the focus is a model-level target.
  const focusLevelAt: Array<string> = leaves.map(() => "unit");
  let focus = targetRef(names.at(-1)!);
  let focusLevel = String(heads.at(-1)?.level ?? "unit");
  // What a later bare antecedent names as a subject: the first target, until an among-filter binds the
  // subject of a later leaf. An embark permission's subject reads this, its destination reads focus.
  const subjectFocusAt: Array<string | null> = leaves.map(() => null);
  let subjectFocus = targetRef(names[0]!);
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index]!;
    if (!(leaf.family_id === "unit-filter" && leaf.parameters.among === AMONG_TARGETS)) {
      if (afterTargeting(leaf)) { focusAt[index] = focus; focusLevelAt[index] = focusLevel; subjectFocusAt[index] = subjectFocus; }
      continue;
    }
    if (leaf.fragment === "TARGET") throw new CompileError("An among-filter cannot sit in TARGET; a later target points back to an earlier one with antecedent.");
    const { ref, singular } = referenceOf(leaf, heads);
    dropped.add(index);
    const containers = containerOf(leaves, index);
    if (containers.length > 1) throw new CompileError(`An among-filter at byte ${leaf.start_byte} sits inside several effects; name the one it means.`);
    if (containers.length === 1) {
      // "Remove those units …": the effect that contains the filter takes the filter's reference as its subject.
      const container = leaves[containers[0]!]!;
      const keys = antecedentKeys(container.family_id, container.parameters);
      if (keys.length === 0) throw new CompileError(`An among-filter inside an effect names that effect's subject, but the effect's subject is not antecedent (${container.family_id} at byte ${container.start_byte}).`);
      // A restriction's enemy target is its target only; its by is the attacker, bound once every attacker is known.
      if (container.family_id === "targeting-restriction") restrictionTargets.push({ at: containers[0]!, ref, start_byte: leaf.start_byte });
      else leaves[containers[0]!] = bind(container, keys, ref);
      if (singular) { focus = ref; focusLevel = String(leaf.parameters.level ?? "unit"); }
      continue;
    }
    const previous = leaves[index - 1];
    const followingKey = previous && previous.fragment === leaf.fragment && !dropped.has(index - 1)
      ? FOLLOWING_KEYS.find((key) => previous.parameters[key] === FOLLOWING_FILTER) : undefined;
    if (followingKey !== undefined) {
      leaves[index - 1] = bind(previous!, [followingKey], ref);
      if (singular) { focus = ref; focusLevel = String(leaf.parameters.level ?? "unit"); }
      continue;
    }
    let at = index + 1;
    while (leaves[at]?.family_id === "unit-owner" && leaves[at]!.fragment === leaf.fragment) dropped.add(at++);
    const next = leaves[at];
    if (!next || next.fragment !== leaf.fragment) throw new CompileError(`An among-filter at byte ${leaf.start_byte} names no leaf in its clause.`);
    if (next.family_id === "attack" && next.parameters.direction === "makes" && next.parameters.attacker_filter === undefined) {
      const attackerSide = next.parameters.unit === "friendly-unit" ? "friendly" : next.parameters.unit === "enemy-unit" ? "enemy" : null;
      if (attackerSide === null || (leaf.parameters.side !== "any" && leaf.parameters.side !== attackerSide)) {
        throw new CompileError(`An among-filter at byte ${leaf.start_byte} names the attacker, but the attack after it is made by ${String(next.parameters.unit)}.`);
      }
      leaves[at] = { ...next, parameters: { ...next.parameters, attacker_filter: ref } };
      attackers.push({ at, ref });
      focus = singular ? ref : "attacker";
      focusLevel = "unit";
    } else if (next.family_id === "event" && next.parameters.owner === undefined && next.parameters.subject === undefined) {
      leaves[at] = { ...next, parameters: { ...next.parameters, subject_filter: ref } };
      focus = singular ? ref : "event-subject";
      focusLevel = "unit";
    } else if (antecedentKeys(next.family_id, next.parameters).length) {
      // An embark permission with a subject and a destination: the among-filter names its subject; its destination stays for focus.
      const keys = antecedentKeys(next.family_id, next.parameters);
      const bound = keys.includes("subject") && keys.includes("into") ? keys.filter((key) => key !== "into") : keys;
      leaves[at] = bind(next, bound, ref);
      if (singular && bound.includes("subject")) subjectFocus = ref;
      if (singular) { focus = ref; focusLevel = String(leaf.parameters.level ?? "unit"); }
    } else throw new CompileError(`An among-filter at byte ${leaf.start_byte} names no distance, attack, moment or back-reference right beside it.`);
    index = at - 1;
  }
  for (const { at, ref, start_byte } of restrictionTargets) bindRestriction(leaves, at, ref, start_byte, attackers);
  const kept = leaves.flatMap((leaf, index) => dropped.has(index) ? [] : [{ leaf, focus: focusAt[index] ?? null, subject: subjectFocusAt[index] ?? null, level: focusLevelAt[index]! }]);
  const out = kept.map((item) => settleDestination(item.leaf, item.subject, item.focus));
  return {
    leaves: out,
    focus: (index) => {
      const leaf = out[index]!;
      const target = kept[index]!.focus;
      if (target === null) return null;
      // A set-up places units. A bare "it" that names a model-level target cannot be placed.
      if (leaf.family_id === "set-up" && kept[index]!.level === "model") {
        throw new CompileError(`set-up at byte ${leaf.start_byte} takes its subject from a model-level Stratagem target; a set-up places a unit, so name the unit it means.`);
      }
      // "those units", "both of them": several targets, which one bound anaphor cannot carry.
      if (sourceText !== undefined && leaf.end_byte !== undefined && PLURAL.test(exactSpan(sourceText, leaf.start_byte, leaf.end_byte))) {
        throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} points back to several of the Stratagem's targets; name them with an among-filter (targets every or any).`);
      }
      return target;
    },
  };
}

/**
 * An embark permission whose subject and destination are both bare anaphors ("that unit can embark
 * within that TRANSPORT"): the subject binds to the subject focus and the destination to the focus.
 * One focus for both would embark the unit within itself. Other leaves return unchanged.
 */
function settleDestination(leaf: CompileLeaf, subject: string | null, destination: string | null): CompileLeaf {
  if (leaf.family_id !== "eligibility-permission" || leaf.parameters.into !== ANTECEDENT) return leaf;
  const parameters = { ...leaf.parameters };
  if (parameters.subject === ANTECEDENT && subject !== null) parameters.subject = subject;
  if (destination !== null) parameters.into = destination;
  return { ...leaf, parameters };
}

/**
 * In a Stratagem with several targets, "this unit" no longer says which one: refuse any leaf
 * outside TARGET that still names it once anaphors are bound.
 *
 * A placement limit's subject is rewritten to this-unit by foldSetUpPlacement, because it places the
 * set-up's unit; `placedLimit` exempts that subject only, so a limit's other fields still refuse.
 */
export function refuseBareTarget(leaves: readonly CompileLeaf[], placedLimit: (leaf: CompileLeaf) => boolean = () => false): CompileLeaf[] {
  if (targetHeads(leaves).flatMap((head) => head.names).length < 2) return [...leaves];
  for (const leaf of leaves) {
    if (leaf.fragment === "TARGET") continue;
    const exempt = placedLimit(leaf) ? "subject" : undefined;
    const keys = Object.entries(leaf.parameters).filter(([key, value]) => value === "this-unit" && key !== exempt).map(([key]) => key);
    if (keys.length) throw new CompileError(`${leaf.family_id} at byte ${leaf.start_byte} names this unit (${keys.join(", ")}), but the Stratagem has several targets; name the one it means.`);
  }
  return [...leaves];
}

/** Keys under which a node is a condition rather than an effect or a moment. */
const CONDITION_KEYS = new Set(["condition", "operands", "eligibility", "ends_when", "unless", "when"]);

type Position = "effect" | "condition" | "moment" | "value";

function positionOf(node: Node, key: string | null, parent: Position): Position {
  if ("operator" in node || (key !== null && CONDITION_KEYS.has(key))) return "condition";
  if (typeof node.event === "string" && !("type" in node)) return "moment";
  if (typeof node.type === "string") return "parameters" in node && parent === "condition" ? "condition" : "effect";
  return parent;
}

/** The references to several targets in a node's own fields (not inside a nested DSL node). */
function ownRefs(node: unknown, top = true): string[] {
  if (typeof node === "string") return node.startsWith(SEVERAL) ? [node] : [];
  if (Array.isArray(node)) return node.flatMap((item) => ownRefs(item, false));
  if (node === null || typeof node !== "object") return [];
  const record = node as Node;
  if (!top && (typeof record.type === "string" || "operator" in record || typeof record.event === "string")) return [];
  return Object.values(record).flatMap((value) => ownRefs(value, false));
}

function replaced(node: unknown, from: string, to: unknown): unknown {
  if (node === from) return to;
  if (Array.isArray(node)) return node.map((item) => replaced(item, from, to));
  if (node !== null && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, replaced(value, from, to)]));
  return node;
}

/** Whether a target has the keywords its gate names (the alternative it was selected by). */
const hasKeywords = (name: string, keywords: readonly string[]): Node => ({ type: "has-keyword", parameters: { subject: { stratagem_target: name }, all_of: [...keywords] } });

function expand(node: unknown, key: string | null, parent: Position): unknown {
  if (typeof node === "string") {
    if (node.startsWith(ONE)) return { stratagem_target: node.slice(ONE.length) };
    if (node.startsWith(SEVERAL)) throw new CompileError("A reference to several Stratagem targets sits where only one unit fits.");
    return node;
  }
  if (Array.isArray(node)) {
    return node.flatMap((item) => {
      const out = expand(item, key, parent);
      // Moments fanned out over several targets are alternatives beside the list's others.
      if (Array.isArray(out) && !Array.isArray(item)) return out;
      // A step fanned out over several targets is that many steps of the sequence it sits in.
      const fanned = key === "steps" && item !== null && typeof item === "object" && ownRefs(item).length > 0;
      return fanned && (out as Node).type === "sequence" ? (out as Node).steps as unknown[] : [out];
    });
  }
  if (node === null || typeof node !== "object") return node;
  const record = node as Node;
  const position = positionOf(record, key, parent);
  const refs = [...new Set(ownRefs(record))];
  if (refs.length > 1) throw new CompileError("One node names two different groups of Stratagem targets; the compiler expands only one.");
  if (refs.length === 1) {
    const { pick, targets } = parseSeveral(refs[0]!);
    const copies = targets.map(({ name, gate }) => {
      const copy = expand(replaced(record, refs[0]!, targetRef(name)), key, parent) as Node;
      if (!gate) return copy;
      // A target selected by only some alternatives: the copy holds when it is one of those.
      if (position === "effect") return { type: "conditional", condition: hasKeywords(name, gate), effect: copy };
      if (position === "condition") return pick === "every" ? { operator: "or", operands: [{ operator: "not", operands: [hasKeywords(name, gate)] }, copy] } : { operator: "and", operands: [hasKeywords(name, gate), copy] };
      throw new CompileError("A moment of a target selected by only some of its alternatives has no gate; the compiler does not expand it.");
    });
    if (position === "condition") return { operator: pick === "every" ? "and" : "or", operands: copies };
    if (position === "moment") return copies;
    if (position === "effect") return { type: "sequence", steps: copies };
    throw new CompileError("A reference to several Stratagem targets sits where only one unit fits.");
  }
  return Object.fromEntries(Object.entries(record).map(([field, value]) => [field, expand(value, field, position)]));
}

/** An entry's target references as the DSL's `{stratagem_target}`, with several-target references fanned out. */
export function resolveTargetRefs<T>(value: T, position: Position = "effect"): T {
  return expand(value, null, position) as T;
}

/**
 * A compiled entry's effect, moment and core target with every target reference resolved. With
 * several targets, the moment's "this unit" is the one target the moment binds (bound_to: the
 * attacked or the triggering unit); an effect still naming this unit (a default the leaves did
 * not override) is ambiguous and refuses.
 */
export function resolveEntry(effect: Node, trigger: unknown, target: Node | Node[] | null, several: boolean): { effect: Node; trigger: unknown; core: { target_restrictions: Node | Node[] } | null } {
  let moment = resolveTargetRefs(trigger, "moment");
  if (several && Array.isArray(target) && JSON.stringify(moment ?? null).includes('"this-unit"')) {
    const bound = target.filter((item) => item.bound_to !== undefined);
    if (bound.length !== 1) throw new CompileError(`The moment names the Stratagem's target, but ${bound.length} of its several targets are bound to a moment's unit; the compiler binds exactly one.`);
    moment = replaced(moment, "this-unit", { stratagem_target: bound[0]!.name }) as typeof moment;
  }
  const resolved = { effect: resolveTargetRefs(effect), trigger: moment };
  if (several && JSON.stringify(resolved).includes('"this-unit"')) throw new CompileError("An effect names this unit, but the Stratagem has several targets; name the one it means.");
  return { ...resolved, core: target ? { target_restrictions: resolveTargetRefs(target, "value") } : null };
}
