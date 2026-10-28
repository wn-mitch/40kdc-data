/** The `happened` history predicate as English ("the unit charged this turn"). */
import { countPhrase, dekebab, designationPhrase, eventRelationPhrase, idLabel, moveKinds, namedUsePhrase, objectivePhrase, type P, pastOf, placeRefPhrase, rangePhrase, rollWord, str, subjectOf, titleCase, unitFilterPhrase, unitRefPhrase, usedAbilityPhrase, windowPhrase as baseWindowPhrase } from "./condition-refs.js";
import { bracketKeyword, weaponNoun } from "./effect-words.js";

/** A rule of one kind being used now, when the filter names none. */
const IN_PROGRESS: Record<string, string> = {
  ability: "an ability", stratagem: "a Stratagem", manoeuvre: "an Agile Manoeuvre", action: "an action", order: "an Order",
  ritual: "a Ritual", "dark-pact": "a Dark Pact", "act-of-faith": "an Act of Faith", doctrine: "a Combat Doctrine", contract: "a contract",
};

/** The printed name of a resource pool a history condition reads. */
const RESOURCE_TERMS: Record<string, string> = { "yp-pool": "YP" };

export function describeHappened(p: P, negated: boolean): string {
  let phrase = happenedPhrase(p, negated);
  const filter = (p.filter ?? {}) as P;
  if ((p.event === "destroyed" || p.event === "model-destroyed") && filter.weapons != null && !(p.object === "event-object" && p.window === "event")) phrase += ` made with ${weaponNoun({ weapons: filter.weapons })}`;
  if (p.count != null && (p.event === "destroyed" || p.event === "model-destroyed") && (p.object === "this-model" || (p.object === "event-object" && p.window === "event"))) phrase += ` (${countPhrase(p.count)} times)`;
  phrase += eventRelationPhrase(filter);
  if (p.proximity != null) {
    const proximity = p.proximity as P;
    phrase += ` within ${rangePhrase(proximity.range)} of ${placeRefPhrase(proximity.of)}`;
  }
  if (p.count != null && !["after-roll", "destroyed", "model-destroyed", "objective-gained", "designation-changed"].includes(str(p.event)) && !(p.event === "used" && (p.filter as P | undefined)?.kind === "action")) phrase += ` (${countPhrase(p.count)} times)`;
  return phrase;
}

function happenedPhrase(p: P, negated: boolean): string {
  const neg = negated ? "not " : "";
  const didNot = (verb: string): string => (negated ? `did not ${verb}` : pastOf(verb));
  const f = (p.filter ?? {}) as P;
  // The phase the event happened in leads its window: "in the Fight phase this battle".
  const inPhase = f.phase != null ? `in the ${titleCase(str(f.phase))} phase` : "";
  const windowPhrase = (w: unknown): string => [inPhase, baseWindowPhrase(w)].filter((part) => part !== "").join(" ");
  const withWindow = (text: string, w: unknown): string => (windowPhrase(w) ? `${text} ${windowPhrase(w)}` : text);
  const event = str(p.event);
  const who = subjectOf(p);
  const count = (p.count ?? {}) as P;
  const amount = countPhrase(p.count);
  switch (event) {
    case "move-ended": {
      const types = (f.move_types as string[] | undefined) ?? [];
      const verb: Record<string, string> = { charge: "charge", advance: "advance", "fall-back": "fall back", "remain-stationary": "remain stationary", ingress: "make an ingress move" };
      const done = types.length === 1 && verb[types[0]!] ? didNot(verb[types[0]!]!) : didNot(types.length ? `make a ${moveKinds(types)} move` : "move");
      return withWindow(`${who} ${done}`, p.window);
    }
    case "selected": {
      const to = str(f.to);
      if (to === "fight") return withWindow(`${who} ${negated ? "has not" : "has"} fought`, p.window);
      return withWindow(`${who} ${negated ? "has not" : "has"} been selected to ${to === "attack" ? "shoot or fight" : dekebab(to)}`, p.window);
    }
    case "set-up": {
      const from: Record<string, string> = { "deep-strike": " using Deep Strike", "strategic-reserves": " from Strategic Reserves", "cult-ambush": " from Cult Ambush", transport: " from a Transport" };
      return withWindow(`${who} ${negated ? "was not" : "was"} set up${from[str(f.from)] ?? ""}`, p.window);
    }
    case "targets-selected": {
      // A named Stratagem's targeting (compile-opponent-stratagem.ts): the unit is the one targeted, whoever targeted it.
      if (f.kind === "stratagem" && f.id !== undefined) {
        const target = p.object != null ? unitRefPhrase(p.object) : "the unit";
        return withWindow(`${target} ${negated ? "has not" : "has"} been targeted with the ${idLabel(f.id)} Stratagem`, p.window);
      }
      // Only ranged (or melee, psychic) attacks: "as a target of its ranged attacks".
      const atk = f.attack_type ? str(f.attack_type) : "";
      // A charge's targets: "selected the unit as a charge target", apart from an attack's.
      const noun = f.kind === "charge" ? "a charge target" : "a target";
      const what = p.object != null ? `${unitRefPhrase(p.object)} as ${noun}${atk ? ` of its ${atk} attacks` : ""}` : `${f.kind === "charge" ? "charge targets" : "targets"}${atk ? ` for its ${atk} attacks` : ""}`;
      return withWindow(`${who} ${negated ? "has not" : "has"} selected ${what}`, p.window);
    }
    case "disembarked": {
      const from = f.transport == null ? "a Transport" : f.transport === "this-unit" || f.transport === "this-model" ? "this Transport" : unitRefPhrase(f.transport);
      return withWindow(`${who} ${didNot("disembark")} from ${from}`, p.window);
    }
    case "after-roll": {
      const obj = unitRefPhrase(p.object, "the unit");
      const target = obj === "the target unit" ? "the target" : obj;
      const atk = f.attack_type ? `${str(f.attack_type)} ` : "";
      const weapons = (f.weapons ?? {}) as P;
      const keyword = weapons.keyword != null && !Array.isArray(weapons.keyword) ? bracketKeyword(weapons.keyword) : "";
      const weaponName = /^[a-z0-9]+(-[a-z0-9]+)+$/.test(str(weapons.name)) ? titleCase(str(weapons.name)) : str(weapons.name);
      const simple = Object.keys(weapons).every((key) => key === "name" || key === "keyword") && !Array.isArray(weapons.keyword);
      const weapon = !simple ? ` made with ${weaponNoun({ weapons })}` : weapons.name ? ` by ${weaponName}${keyword ? ` (with ${keyword})` : ""}` : keyword ? ` made with a ${keyword} weapon` : "";
      const by = f.by && typeof f.by === "object" && "event_var" in (f.by as P) ? " from the triggering unit" : f.by != null ? ` from ${unitRefPhrase(f.by)}` : "";
      const when = p.window === "event" ? " during its just-finished shooting sequence" : ` ${windowPhrase(p.window)}`;
      // Who made the attacks, when it is not the unit being checked ("hit by an attack made by this unit").
      const attacker = p.subject != null && p.subject !== "this-unit" ? ` made by ${unitRefPhrase(p.subject)}` : "";
      if (f.roll === "hit" && f.result === "success") {
        const hits = (count.min != null && count.min !== 1) || count.max != null ? `${amount} ${atk}attacks` : atk === "" ? "an attack" : `a ${atk}attack`;
        return `${neg}${target} was hit by ${hits}${attacker}${weapon}${by}${when}`;
      }
      // Whose roll it was, when the subject names one: "the unit made a battle-shock roll and failed it".
      if (p.subject != null) {
        const outcome = f.result === "failure" ? " and failed it" : f.result === "success" ? " and passed it" : "";
        return `${neg}${who} made a ${rollWord(f.roll)} roll${outcome} ${windowPhrase(p.window)}${p.count != null ? ` (${amount} times)` : ""}`.trimEnd();
      }
      return `${neg}a ${rollWord(f.roll)} roll ${f.result ? `was a ${str(f.result)} ` : "was made "}${windowPhrase(p.window)}${p.count != null ? ` (${amount} times)` : ""}`.trimEnd();
    }
    case "damage-allocated": {
      const obj = unitRefPhrase(p.object, "the unit");
      const atk = f.attack_type ? `${str(f.attack_type)} ` : "";
      return `${neg}${obj} lost one or more wounds from ${atk}attacks${p.window === "event" ? " from the triggering attacks" : ` ${windowPhrase(p.window)}`}`;
    }
    case "destroyed":
    case "model-destroyed": {
      const noun = event === "model-destroyed" ? "model" : "unit";
      if (p.object === "event-object" && p.window === "event") {
        return f.attack_type ? `${neg}destroyed by a ${str(f.attack_type)} attack${f.weapons != null ? ` made with ${weaponNoun({ weapons: f.weapons })}` : ""}` : `${neg}destroyed by any attack${f.weapons != null ? ` made with ${weaponNoun({ weapons: f.weapons })}` : ""}`;
      }
      // "this model": the destroyed model is this one, not any model of the unit.
      if (p.object === "this-model") return withWindow(negated ? "this model was not destroyed" : "this model was destroyed", p.window);
      const obj = (typeof p.object === "object" && p.object ? p.object : {}) as P;
      const kws = Array.isArray(obj.all_of) ? `${(obj.all_of as unknown[]).map(str).join(" ")} ` : "";
      const owner = obj.owner != null ? `${str(obj.owner)} ` : "";
      const extended = Object.keys(obj).some((key) => !["all_of", "owner", "level", "designated"].includes(key));
      const objects = extended ? unitFilterPhrase({ ...obj, level: event === "model-destroyed" ? "model" : "unit" }).replace(/^an? /, "").replace(/\b(unit|model)\b/, "$1s") : `${owner}${kws}${noun}s`;
      // Who destroyed them: the filter's attacker, else the event's subject.
      const killer = f.by ?? p.subject;
      if (killer != null) {
        // A destruction by one attack type says it: "with its just-resolved melee attacks", "with melee attacks this phase".
        const atk = f.attack_type ? `${str(f.attack_type)} ` : "";
        const when = p.window === "event" ? `with its just-resolved ${atk}attacks` : `${atk ? `with ${atk}attacks ` : ""}${windowPhrase(p.window)}`;
        return `${neg}${unitRefPhrase(killer)} has destroyed ${amount} ${objects} ${when}`.trimEnd();
      }
      const tagged = !extended && obj.designated != null ? ` ${designationPhrase(str(obj.designated))}` : "";
      return `${neg}${withWindow(`${amount} ${objects}${tagged} destroyed`, p.window)}`;
    }
    case "used": {
      // The use being resolved now: "the unit is performing the Swift as the Wind Agile Manoeuvre".
      if (p.window === "event" && f.ability_keyword == null && f.same_rule_as == null) {
        const kind = str(f.kind ?? "ability");
        const rule = namedUsePhrase(f) ?? IN_PROGRESS[kind] ?? `a ${dekebab(kind)}`;
        return `${who} is ${negated ? "not " : ""}${kind === "ability" || kind === "stratagem" ? "using" : "performing"} ${rule}`;
      }
      if (f.kind === "action") {
        let s = `${neg}${amount} actions completed`;
        if (f.id != null) s += ` (${dekebab(str(f.id))})`;
        const o = p.object as P | undefined;
        if (o && typeof o === "object" && o.objective) s += ` on ${objectivePhrase(o.objective as P)}`;
        else if (o && typeof o === "object" && o.terrain_area) s += ` on terrain${(o.terrain_area as P).territory ? ` in ${dekebab(str((o.terrain_area as P).territory))}` : ""}`;
        else if (o && typeof o === "object" && (o as P).owner === "enemy") s += " on an enemy unit";
        return withWindow(s, p.window);
      }
      const which = usedAbilityPhrase(f);
      if (which != null) return `${neg}${withWindow(`${who} used ${which}`, p.window)}`;
      return `${neg}${withWindow(`${who} used ${f.id != null ? `the ${idLabel(f.id)} ` : "a "}${dekebab(str(f.kind ?? "ability"))}`, p.window)}`;
    }
    case "objective-gained":
      return `${neg}you newly control ${amount} objectives ${windowPhrase(p.window)}`.trimEnd();
    case "designation-changed":
      return `${neg}${withWindow(`${amount} ${unitRefPhrase(p.object, "units")} became ${designationPhrase(str(f.tag))}`, p.window)}`;
    // "you spent YP in that turn" (optional-cost-paid window turn): a negated read is "you spent no YP".
    case "resource-spent": {
      const pool = str(f.pool);
      const what = RESOURCE_TERMS[pool] ?? dekebab(pool);
      const spent = negated ? `you spent no ${what}` : `you spent ${what}`;
      return withWindow(spent, p.window);
    }
    default:
      return `${neg}${withWindow(`${dekebab(event)} happened`, p.window)}`;
  }
}

export function destroyedCount(side: P): string {
  const o = (side.object ?? {}) as P;
  const objects = unitRefPhrase(o).replace(/^an? /, "").replace(/\b(unit|model)\b/, "$1s");
  return `${objects} ${baseWindowPhrase(side.window)}`.trimEnd();
}
