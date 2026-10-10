/**
 * Named abilities in compilation: a moment of an aura's recipient becomes the trigger's subject
 * and proximity; a `by-ability` leaf folds into the moment it qualifies; an `ability-used` leaf
 * lowers to a `happened` history condition; and every named id becomes a core check.
 */

import type { CoreCheck } from "./core-checks.js";
import { abilityRollOf, CompileError, type CompileLeaf } from "./compile-fragments.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { ANTECEDENT } from "./antecedent-families.js";

type Node = Record<string, unknown>;

/** Moments of an aura's recipient that fold into a trigger with proximity. Only new leaves reach them. */
const AURA_MOMENT_KINDS = new Set(["used", "after-roll"]);

/** Whether the bytes between two leaves hold no sentence break. */
export function sameSentence(sourceText: string | undefined, from: number | undefined, to: number): boolean {
  if (sourceText === undefined || from === undefined || to <= from) return true;
  return !/[.;:]/u.test(Buffer.from(sourceText, "utf8").subarray(from, to).toString("utf8"));
}

/**
 * "While a friendly X unit is within 3\" of this model, each time that unit uses its Foo ability":
 * a unit-filter, a side-less aura-range and the next leaf's moment of that unit (subject antecedent) become one
 * trigger whose subject is the filter and whose proximity is the aura's range. The aura is
 * dropped; later anaphors bind to the triggering unit.
 */
export function foldAuraMoments(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  const out: CompileLeaf[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const filter = list[index]!;
    const aura = list[index + 1];
    const moment = list[index + 2];
    // Only a moment whose leaf says the recipient acts ("that unit uses", "that model Channels"):
    // in "when you target that unit with a Stratagem" the recipient is not who used it.
    const alternative = list[index + 3];
    const sameAura = filter.family_id === "unit-filter" && aura?.family_id === "aura-range" && aura.parameters.side === undefined
      && moment?.family_id === "event" && filter.fragment === aura.fragment && aura.fragment === moment.fragment
      && sameSentence(sourceText, aura.end_byte, moment.start_byte)
      // "fails a Battle-shock test or is destroyed": the alternative moment's unit would stay unbound.
      && !(alternative?.family_id === "event" && alternative.fragment === moment.fragment && sameSentence(sourceText, moment.end_byte, alternative.start_byte));
    const fits = sameAura && AURA_MOMENT_KINDS.has(String(moment!.parameters.kind)) && moment!.parameters.subject === ANTECEDENT;
    // "chosen by a Gadget": the chosen unit is the moment's object, and any owner may choose it.
    const targeted = sameAura && moment!.parameters.kind === "targets-selected" && moment!.parameters.object === ANTECEDENT
      && moment!.parameters.action_kind === "stratagem" && moment!.parameters.subject === undefined;
    if (!fits && !targeted) {
      out.push(filter);
      continue;
    }
    if (targeted) {
      if (aura!.parameters.wholly === true || aura!.parameters.range_cap_inches !== undefined) {
        throw new CompileError("A moment of an aura's recipient becomes a trigger's object range, which cannot say wholly within or cap the range.");
      }
      if (filter.parameters.visible === true) throw new CompileError("An aura reaches units whether or not they are visible; drop visible from its unit-filter.");
      const { object: _object, ...rest } = moment!.parameters;
      out.push({
        ...moment!,
        parameters: { ...rest, owner: moment!.parameters.owner ?? "any", object_filter: { ...dslUnitFilter(filter), within: { of: aura!.parameters.of ?? "this-unit", range: { inches: aura!.parameters.inches } } } },
      });
      index += 2;
      continue;
    }
    if (moment!.parameters.owner !== undefined) throw new CompileError("A moment of an aura's recipient names its unit by the aura's filter, not by an owner.");
    if (aura!.parameters.wholly === true || aura!.parameters.range_cap_inches !== undefined) {
      throw new CompileError("A moment of an aura's recipient becomes a trigger's proximity, which cannot say wholly within or cap the range.");
    }
    if (filter.parameters.visible === true) throw new CompileError("An aura reaches units whether or not they are visible; drop visible from its unit-filter.");
    const { subject: _subject, ...rest } = moment!.parameters;
    out.push({
      ...moment!,
      parameters: { ...rest, subject_filter: dslUnitFilter(filter), proximity: { of: aura!.parameters.of ?? "this-unit", inches: aura!.parameters.inches } },
    });
    index += 2;
  }
  return out;
}

/** Moments a `by-ability` leaf can say happened through an ability. */
const BY_ABILITY_MOMENTS = new Set(["targets-selected", "move-ended", "move-started", "selected", "set-up"]);

/**
 * "pinned by a friendly X unit's Foo ability", "a move made using its Bar ability": the ability
 * through which the moment before it happened. A targets-selected moment takes it as the
 * selecting ability, with the unit-filter between them as that ability's user; a move, selection
 * or set-up takes it as a use of that ability in the same moment.
 */
export function foldByAbility(list: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!list.some((leaf) => leaf.family_id === "by-ability")) return [...list];
  const out: CompileLeaf[] = [];
  for (const leaf of list) {
    if (leaf.family_id !== "by-ability") {
      out.push(leaf);
      continue;
    }
    const between: CompileLeaf[] = [];
    while (out.length && out.at(-1)!.fragment === leaf.fragment && (out.at(-1)!.family_id === "unit-filter" || out.at(-1)!.family_id === "unit-owner")) between.unshift(out.pop()!);
    const moment = out.at(-1);
    if (moment?.family_id !== "event" || moment.fragment !== leaf.fragment || !BY_ABILITY_MOMENTS.has(String(moment.parameters.kind))
      || !sameSentence(sourceText, moment.end_byte, leaf.start_byte)) {
      throw new CompileError(`by-ability at byte ${leaf.start_byte} names the ability a moment happened through, but no move, selection, set-up or targeting sits before it in its clause.`);
    }
    if (moment.parameters.id !== undefined || moment.parameters.source_ability !== undefined || moment.parameters.by_ability !== undefined) {
      throw new CompileError(`by-ability at byte ${leaf.start_byte} names an ability for a moment that already names one.`);
    }
    const id = String(leaf.parameters.id);
    const filters = between.filter((item) => item.family_id === "unit-filter");
    if (moment.parameters.kind === "targets-selected") {
      if (moment.parameters.action_kind !== "ability") throw new CompileError("by-ability on a targeting names the selecting ability; the moment's action_kind must be ability.");
      if (filters.length !== 1) throw new CompileError("by-ability on a targeting needs exactly one unit-filter between them: the unit whose ability selected.");
      const { side, keywords, ...extra } = filters[0]!.parameters as { side: string; keywords?: string[] } & Node;
      if (side !== "friendly" && side !== "enemy") throw new CompileError("The unit whose ability selected must be friendly or enemy.");
      if (!keywords?.length || Object.keys(extra).length) throw new CompileError("The unit whose ability selected is named only by its side and every keyword it has; the DSL holds nothing else.");
      out[out.length - 1] = { ...moment, parameters: { ...moment.parameters, source_ability: { ability_id: id, owner: side, keywords: [...keywords].sort() } } };
      continue;
    }
    if (filters.length) throw new CompileError("by-ability on a move, selection or set-up names the moment's own unit's ability; a unit-filter between them names another unit.");
    out[out.length - 1] = { ...moment, parameters: { ...moment.parameters, by_ability: id } };
  }
  return out;
}

/** The `happened` condition of an `ability-used` leaf: used in the window, or being used now. */
export function abilityUsedCondition(leaf: CompileLeaf): Node {
  const p = leaf.parameters;
  const subject = String(p.subject);
  const node: Node = {
    type: "happened",
    parameters: {
      event: "used",
      ...(subject === "this-unit" ? {} : { subject }),
      filter: { kind: p.activity, ...(p.id !== undefined ? { id: p.id } : {}) },
      window: p.window === "now" ? "event" : p.window,
    },
  };
  return p.negated === true ? { operator: "not", operands: [node] } : node;
}

/** Leaves through which a use can be in progress when a condition is checked: a moment, an attack, a roll. */
const IN_PROGRESS_FAMILIES = new Set(["event", "attack", "dice-roll", "roll-modifier", "reroll"]);

/** "While it is performing a Foo" needs a moment, an attack or a roll the use can be in progress at. */
export function checkAbilityUsedWindows(list: readonly CompileLeaf[]): void {
  const now = list.find((leaf) => leaf.family_id === "ability-used" && leaf.parameters.window === "now");
  if (now && !list.some((leaf) => IN_PROGRESS_FAMILIES.has(leaf.family_id))) {
    throw new CompileError(`ability-used at byte ${now.start_byte} says a use is in progress, but no moment, attack or roll in the record can happen during it.`);
  }
}

/** The named ids of a record's folded leaves, each a check against the core and enrichment records. */
export function namedAbilityChecks(list: readonly CompileLeaf[]): CoreCheck[] {
  return list.flatMap((leaf): CoreCheck[] => {
    const p = leaf.parameters;
    if (leaf.family_id === "event") {
      const checks: CoreCheck[] = [];
      if (p.id !== undefined) {
        const activity = p.kind === "used" ? p.activity : p.action_kind;
        checks.push({ kind: "named-ability", parameters: { id: p.id, activity, ...(typeof p.subject === "string" ? { subject: p.subject } : {}) } });
      }
      // A folded by-ability: the selecting ability is another unit's; a move's is the moment's own unit's.
      const source = p.source_ability as { ability_id: string } | undefined;
      if (source !== undefined) checks.push({ kind: "named-ability", parameters: { id: source.ability_id, activity: "ability" } });
      if (p.by_ability !== undefined) checks.push({ kind: "named-ability", parameters: { id: p.by_ability, activity: "ability", ...(typeof p.subject === "string" ? { subject: p.subject } : {}) } });
      return checks;
    }
    if (leaf.family_id === "ability-used" && p.id !== undefined) return [{ kind: "named-ability", parameters: { id: p.id, activity: p.activity, subject: p.subject } }];
    // A roll of a named ability's own dice: the id must be an ability of the record's faction (or a core one).
    const rolled = abilityRollOf(leaf)?.of_ability;
    if (rolled !== undefined) return [{ kind: "named-ability", parameters: { id: rolled, activity: "ability", subject: "this-unit" } }];
    // A count of the models equipped with a wargear item: the wargear must be a core wargear record. The
    // count-scale is folded into the effect it scales (compile-count-scale.ts), so the scaling carries it here.
    const scaling = p.scaling as { of?: unknown; wargear?: unknown } | undefined;
    if (scaling?.of === "models-equipped-with") return [{ kind: "named-wargear", parameters: { id: String(scaling.wargear) } }];
    return [];
  });
}
