import type { SemanticFamilyDefinition } from "./contracts.js";

/**
 * Anaphoric subjects ("that enemy unit", "that unit", "it", "those units", "that model") name
 * the unit an earlier leaf of the same record introduced. The leaf records only that it points
 * back (`antecedent`); which unit that is depends on the record's other leaves, so compilation
 * binds it (`compile-antecedent.ts`), never authoring.
 *
 * Each family below gains one version whose listed unit-ref keys also accept `antecedent`. The
 * version is otherwise the previous one: its parameters normalize as that version's do, and
 * every earlier leaf still fits it unchanged.
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
  "keyword-grant": ["subject"],
  "feel-no-pain": ["subject"],
  "regain-wounds": ["subject"],
  "return-models": ["subject"],
  "unit-has-ability": ["subject"],
  // "it has the Deep Strike ability", "that unit has a 4+ invulnerable save".
  "core-ability-grant": ["subject"],
  "invulnerable-save": ["subject"],
  "ability-record-grant": ["subject"],
};

/**
 * Keys whose antecedent a later family version (`family-extensions.ts`) accepts directly, in a
 * schema of its own rather than through an antecedent version above.
 */
const EXTENDED_ANTECEDENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  event: ["subject", "by"],
  "rule-state": ["subject"],
  "targeting-restriction": ["by", "target"],
  "weapon-property-scope": ["subject"],
  "ignore-modifiers": ["subject"],
  "leading-unit": ["subject"],
  "roll-modifier": ["subject"],
  reroll: ["subject"],
  "in-region": ["subject"],
  // "that unit is within your army's Hallowed Ground": the unit an earlier leaf introduced (family-extensions-15-named-region.ts).
  "counts-as": ["subject"],
  // "if that unit targeted this unit"; "if one or more units with this ability are selected as a target of that charge".
  targeted: ["subject"],
  "target-is-selected": ["by", "target"],
  "ability-activate": ["subject"],
  "chosen-option-grant": ["holder"],
  // "change the Damage of that attack to 0" for the model whose save an earlier roll moment names.
  "damage-reduction": ["subject"],
  // "your **VEHICLE** unit is eligible to shoot …", "do not make an Advance roll for it" (family-extensions-w8-multi.ts).
  "act-after-move": ["subject"],
  "no-advance-roll": ["subject"],
  // "in a turn in which it used its Foo ability": a family whose own enum lists antecedent.
  "ability-used": ["subject"],
  // "None of these models can be your WARLORD": the group of an earlier list-building rule or filter (compile-army.ts).
  "army-construction": ["subject"],
};

/** Values an antecedent stands in for while the previous version's normalizer checks the rest. */
const PLACEHOLDERS = ["selected-unit", "event-subject", "that-unit", "this-unit", "target", "recipient"] as const;

type Schema = Record<string, unknown>;

/** The enum a unit-ref key lists, directly or as the enum branch of an anyOf. */
export function keyEnum(schema: Schema, key: string): string[] | null {
  const property = (schema.properties as Record<string, Schema> | undefined)?.[key];
  if (!property) return null;
  if (Array.isArray(property.enum)) return property.enum as string[];
  const branch = (property.anyOf as Schema[] | undefined)?.find((item) => Array.isArray(item.enum));
  return branch ? branch.enum as string[] : null;
}

function withAntecedent(schema: Schema, keys: readonly string[], family: string): Schema {
  const properties = { ...(schema.properties as Record<string, Schema>) };
  for (const key of keys) {
    const property = properties[key];
    if (!property || !keyEnum(schema, key)) throw new Error(`${family}.${key} lists no unit-ref enum to extend with ${ANTECEDENT}.`);
    properties[key] = Array.isArray(property.enum)
      ? { ...property, enum: [...(property.enum as string[]), ANTECEDENT] }
      : { ...property, anyOf: (property.anyOf as Schema[]).map((item) => Array.isArray(item.enum) ? { ...item, enum: [...(item.enum as string[]), ANTECEDENT] } : item) };
  }
  return { ...schema, properties };
}

const antecedentVersions = new Map<string, number>();

/**
 * The registry with one more version of every `ANTECEDENT_KEYS` family: the previous current
 * version is retired and its successor also accepts `antecedent` at the listed keys.
 */
export function withAntecedentVersions(registry: readonly SemanticFamilyDefinition[]): SemanticFamilyDefinition[] {
  const result = [...registry];
  for (const [id, keys] of Object.entries(ANTECEDENT_KEYS)) {
    const at = result.flatMap((family, index) => family.id === id && !family.deprecated ? [index] : []);
    if (at.length !== 1) throw new Error(`Family ${id} has ${at.length} current versions; it needs exactly one to gain ${ANTECEDENT}.`);
    const current = result[at[0]!]!;
    const { deprecated: _deprecated, ...rest } = current;
    result[at[0]!] = { ...current, deprecated: true };
    result.push({
      ...rest,
      version: current.version + 1,
      description: `As version ${current.version}, and ${keys.join(" and ")} can be ${ANTECEDENT}: the unit an earlier leaf of the record introduced ("that enemy unit", "it"), bound when the record compiles.`,
      parameterSchema: withAntecedent(current.parameterSchema, keys, id),
    });
    antecedentVersions.set(id, current.version + 1);
  }
  return result;
}

/** The version that first accepts `antecedent` for a family, if any. */
export function antecedentVersion(family: string): number | undefined {
  return antecedentVersions.get(family);
}

/** The listed keys of a leaf's parameters that name the antecedent. */
export function antecedentKeys(family: string, parameters: Record<string, unknown>): string[] {
  return [...(ANTECEDENT_KEYS[family] ?? []), ...(EXTENDED_ANTECEDENT_KEYS[family] ?? [])].filter((key) => parameters[key] === ANTECEDENT);
}

/**
 * Normalize an antecedent version's parameters with the previous version's rules: each
 * `antecedent` stands in as a value the previous version accepts, distinct from the leaf's other
 * values, and comes back once the rest of the leaf has been checked.
 */
export function normalizeWithAntecedent(
  family: string,
  input: Record<string, unknown>,
  version: number,
  normalize: (input: Record<string, unknown>, version: number) => Record<string, unknown>,
  schema: Schema,
): Record<string, unknown> {
  if (antecedentVersion(family) !== version) return normalize(input, version);
  const keys = antecedentKeys(family, input);
  if (keys.length === 0) return normalize(input, version - 1);
  const used = new Set(Object.values(input).filter((value): value is string => typeof value === "string"));
  const substituted = { ...input };
  for (const key of keys) {
    const choices = keyEnum(schema, key) ?? [];
    const placeholder = PLACEHOLDERS.find((value) => choices.includes(value) && !used.has(value));
    if (!placeholder) throw new TypeError(`${family}.${key} has no value to check ${ANTECEDENT} against.`);
    used.add(placeholder);
    substituted[key] = placeholder;
  }
  const normalized = normalize(substituted, version - 1);
  for (const key of keys) {
    if (normalized[key] !== substituted[key]) throw new TypeError(`${family}.${key}: ${ANTECEDENT} did not survive normalization.`);
    normalized[key] = ANTECEDENT;
  }
  return normalized;
}
