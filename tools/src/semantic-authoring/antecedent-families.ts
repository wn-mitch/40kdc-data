/**
 * Anaphoric subjects ("that enemy unit", "that unit", "it", "those units", "that model") name
 * the unit an earlier leaf of the same record introduced. The leaf records only that it points
 * back (`antecedent`); which unit that is depends on the record's other leaves, so compilation
 * binds it (`compile-antecedent.ts`), never authoring.
 *
 * The families below accept `antecedent` at their listed unit-ref keys.
 */

export const ANTECEDENT = "antecedent";

/** The unit-ref keys of each family that may point back to an earlier leaf's unit. */
export const ANTECEDENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  "unit-state": ["subject", "with"],
  "apply-mark": ["subject"],
  test: ["target"],
  "characteristic-modifier": ["subject"],
  "unit-activity": ["subject"],
  "unit-position": ["subject", "of"],
  visible: ["subject", "to"],
  guided: ["subject"],
  "hit-by-attacks": ["subject"],
  "destroy-models": ["recipient"],
  "set-up": ["subject"],
  "make-move": ["subject"],
  "mortal-wounds": ["recipient"],
  eligible: ["subject"],
  "unit-keyword": ["subject"],
  // These name only the ability's own unit or model, so their antecedent binds only to a Stratagem's target.
  "eligibility-permission": ["subject"],
  "targeting-restriction": ["subject"],
  "move-through": ["subject"],
  // "that unit has the [LETHAL HITS] ability", "models in that unit have the Feel No Pain 5+ ability".
  "weapon-ability-grant": ["subject"],
  // "Friendly X units' Rapid Fire attacks benefit from [Rapid Fire] …": the units the leading unit-filter names.
  "weapon-ability-range": ["subject"],
  "keyword-grant": ["subject"],
  "feel-no-pain": ["subject"],
  "regain-wounds": ["subject"],
  "return-models": ["subject"],
  "unit-has-ability": ["subject"],
  // "it has the Deep Strike ability", "that unit has a 4+ invulnerable save".
  "core-ability-grant": ["subject"],
  "invulnerable-save": ["subject"],
  "ability-record-grant": ["subject"],
  // "if that unit is your Warlord" after a unit-filter: the Warlord test folds onto the filter (compile-warlord-test.ts).
  "designated-filter": ["subject"],
};

/**
 * More unit-ref keys that accept the antecedent, beyond the unit-ref keys above.
 */
const EXTENDED_ANTECEDENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  "unit-filter": ["member_of"],
  // "based on that unit's Starting Strength": the unit whose row a by-table cost reads.
  "resource-spend": ["table_of"],
  // "that Psyker unit's psyker level": the unit whose own pool a characteristic-sized gain fills.
  "resource-gain": ["subject"],
  // "add 3\" to that unit's Contagion Range": the unit an earlier filter, aura or Stratagem target names.
  "ability-modifier": ["subject"],
  // "your model issues …": the Stratagem's target, or the unit an earlier leaf introduced.
  "orders-modifier": ["subject"],
  event: ["subject", "by"],
  // "each time an attack targets one of those units": the attacked unit (compile-part-plan.ts gates on it).
  attack: ["unit"],
  // An embark permission's destination ("that TRANSPORT"), accepted by eligibility-permission.
  "eligibility-permission": ["into"],
  "rule-state": ["subject"],
  "targeting-restriction": ["by", "target"],
  "weapon-property-scope": ["subject"],
  "ignore-modifiers": ["subject"],
  "leading-unit": ["subject"],
  "roll-modifier": ["subject"],
  reroll: ["subject"],
  "in-region": ["subject"],
  // "that unit is within your army's Hallowed Ground": the unit an earlier leaf introduced.
  "counts-as": ["subject"],
  // "if that unit targeted this unit"; "if one or more units with this ability are selected as a target of that charge".
  targeted: ["subject"],
  "target-is-selected": ["by", "target"],
  "ability-activate": ["subject"],
  "chosen-option-grant": ["holder"],
  "menu-options-grant": ["holder"],
  // "change the Damage of that attack to 0" for the model whose save an earlier roll moment names.
  "damage-reduction": ["subject"],
  // "your **VEHICLE** unit is eligible to shoot …", "do not make an Advance roll for it".
  "act-after-move": ["subject"],
  "no-advance-roll": ["subject"],
  // "-2\" from that pile-in move" of the enemy unit an earlier unit-filter names.
  "move-distance": ["subject"],
  // "in a turn in which it used its Foo ability": a family whose own enum lists antecedent.
  "ability-used": ["subject"],
  // "None of these models can be your WARLORD": the group of an earlier list-building rule or filter (compile-army.ts).
  "army-construction": ["subject"],
  // "That unit is battle-shocked" for each unit a loop names.
  "battle-shock-state": ["recipient"],
};

type Schema = Record<string, unknown>;

/** The enum a unit-ref key lists, directly or as the enum branch of an anyOf. */
export function keyEnum(schema: Schema, key: string): string[] | null {
  const property = (schema.properties as Record<string, Schema> | undefined)?.[key];
  if (!property) return null;
  if (Array.isArray(property.enum)) return property.enum as string[];
  const branch = (property.anyOf as Schema[] | undefined)?.find((item) => Array.isArray(item.enum));
  return branch ? branch.enum as string[] : null;
}

/** The listed keys of a leaf's parameters that name the antecedent. */
export function antecedentKeys(family: string, parameters: Record<string, unknown>): string[] {
  return [...(ANTECEDENT_KEYS[family] ?? []), ...(EXTENDED_ANTECEDENT_KEYS[family] ?? [])].filter((key) => parameters[key] === ANTECEDENT);
}
