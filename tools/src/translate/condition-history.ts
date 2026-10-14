/** The `happened` history predicate as English ("the unit charged this turn"). */
import { dekebab, designationPhrase, idLabel, moveKinds, objectivePhrase, type P, pastOf, rollWord, str, subjectOf, titleCase, unitRefPhrase, usedAbilityPhrase, windowPhrase, withWindow } from "./condition-refs.js";

export function describeHappened(p: P, negated: boolean): string {
  const neg = negated ? "not " : "";
  const didNot = (verb: string): string => (negated ? `did not ${verb}` : pastOf(verb));
  const f = (p.filter ?? {}) as P;
  const event = str(p.event);
  const who = subjectOf(p);
  const n = typeof p.count_min === "number" ? p.count_min : 1;
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
    case "set-up":
      return withWindow(`${who} ${negated ? "was not" : "was"} set up`, p.window);
    case "targets-selected":
      return withWindow(`${who} ${negated ? "has not" : "has"} selected ${p.object != null ? `${unitRefPhrase(p.object)} as a target` : "targets"}`, p.window);
    case "disembarked":
      return withWindow(`${who} ${didNot("disembark")} from a Transport`, p.window);
    case "after-roll": {
      const obj = unitRefPhrase(p.object, "the unit");
      const target = obj === "the target unit" ? "the target" : obj;
      const atk = f.attack_type ? `${str(f.attack_type)} ` : "";
      const keyword = f.weapon_keyword ? `[${dekebab(str(f.weapon_keyword)).toUpperCase()}]` : "";
      const weaponName = /^[a-z0-9]+(-[a-z0-9]+)+$/.test(str(f.weapon_name)) ? titleCase(str(f.weapon_name)) : str(f.weapon_name);
      const weapon = f.weapon_name ? ` by ${weaponName}${keyword ? ` (with ${keyword})` : ""}` : keyword ? ` made with a ${keyword} weapon` : "";
      const by = f.by && typeof f.by === "object" && "event_var" in (f.by as P) ? " from the triggering unit" : f.by != null ? ` from ${unitRefPhrase(f.by)}` : "";
      const when = p.window === "event" ? " during its just-finished shooting sequence" : ` ${windowPhrase(p.window)}`;
      // Who made the attacks, when it is not the unit being checked ("hit by an attack made by this unit").
      const attacker = p.subject != null && p.subject !== "this-unit" ? ` made by ${unitRefPhrase(p.subject)}` : "";
      if (f.roll === "hit" && f.result === "success") {
        const hits = n > 1 ? `${n}+ ${atk}attacks` : atk === "" ? "an attack" : `a ${atk}attack`;
        return `${neg}${target} was hit by ${hits}${attacker}${weapon}${by}${when}`;
      }
      return `${neg}a ${rollWord(f.roll)} roll ${f.result ? `was a ${str(f.result)} ` : "was made "}${windowPhrase(p.window)}`.trimEnd();
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
        return f.attack_type ? `${neg}destroyed by a ${str(f.attack_type)} attack${f.weapon_name ? ` made with ${str(f.weapon_name)}` : ""}` : `${neg}destroyed by any attack`;
      }
      const obj = (typeof p.object === "object" && p.object ? p.object : {}) as P;
      const kws = Array.isArray(obj.all_of) ? `${(obj.all_of as unknown[]).map(str).join(" ")} ` : "";
      const owner = obj.owner != null ? `${str(obj.owner)} ` : "";
      if (f.by != null) {
        const when = p.window === "event" ? "with its just-resolved attacks" : windowPhrase(p.window);
        return `${neg}${unitRefPhrase(f.by)} has destroyed ${n}+ ${owner}${kws}${noun}s ${when}`.trimEnd();
      }
      const tagged = obj.designated != null ? ` ${designationPhrase(str(obj.designated))}` : "";
      return `${neg}${withWindow(`${n}+ ${owner}${kws}${noun}s${tagged} destroyed`, p.window)}`;
    }
    case "used": {
      if (f.kind === "action") {
        let s = `${neg}${n}+ actions completed`;
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
      return `${neg}you newly control ${n}+ objectives ${windowPhrase(p.window)}`.trimEnd();
    case "designation-changed":
      return `${neg}${withWindow(`${n}+ ${unitRefPhrase(p.object, "units")} became ${designationPhrase(str(f.tag))}`, p.window)}`;
    default:
      return `${neg}${withWindow(`${dekebab(event)} happened`, p.window)}`;
  }
}

export function destroyedCount(side: P): string {
  const o = (side.object ?? {}) as P;
  const kws = Array.isArray(o.all_of) ? `${(o.all_of as unknown[]).map(str).join(" ")} ` : "";
  return `${str(o.owner)} ${kws}units ${windowPhrase(side.window)}`.trimEnd();
}
