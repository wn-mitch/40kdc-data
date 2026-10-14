import { countPhrase, str, titleCase, type P } from "./condition-refs.js";

/**
 * English for the named-equipment predicates (`named-weapon`, `unit-wargear`). Negation is written
 * here rather than through negatePhrase: a printed weapon name may contain " is " or " has ", which
 * would make the verb-turning regex pick the wrong verb. Unit-level counts over models negate as
 * "it is not the case that …", because "not at least K" does not read as a verb negation.
 */
export function namedEquipmentPhrase(type: string, p: P, negated: boolean): string {
  if (type === "unit-wargear") return wargearPhrase(p, negated);
  return weaponPhrase(p, negated);
}

function wargearPhrase(p: P, negated: boolean): string {
  const label = titleCase(str(p.wargear));
  const models = p.models as P | undefined;
  if (models === undefined) return `this unit ${negated ? "does not have" : "has"} the ${label} wargear`;
  const verb = models.state === "lack" ? "are not equipped with" : "are equipped with";
  return unitLevel(`${modelsSubject(models)} ${verb} the ${label} wargear`, negated);
}

function weaponPhrase(p: P, negated: boolean): string {
  const name = str(p.name);
  const count = Number(p.count);
  const weapons = count === 1 ? `one weapon named "${name}"` : `exactly ${count} weapons named "${name}"`;
  if (p.subject === "this-model") return `this model ${negated ? "is not" : "is"} equipped with ${weapons}`;
  const models = p.models as P;
  if (models.state === "lack") {
    const none = count === 1 ? `no weapon named "${name}"` : `fewer than ${count} weapons named "${name}"`;
    return unitLevel(`${modelsSubject(models)} have ${none}`, negated);
  }
  return unitLevel(`${modelsSubject(models)} are each equipped with ${weapons}`, negated);
}

function modelsSubject(models: P): string {
  const count = (models.count ?? {}) as P;
  if (count.max == null) return count.min === 1 ? "one or more models in this unit" : `at least ${str(count.min)} models in this unit`;
  return `${countPhrase(count)} models in this unit`;
}

function unitLevel(phrase: string, negated: boolean): string {
  return negated ? `it is not the case that ${phrase}` : phrase;
}
