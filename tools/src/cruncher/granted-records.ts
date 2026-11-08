/**
 * Grants of ability records ("friendly BLOOD LEGIONS units gain Blessings of Khorne"), resolved
 * to the record itself so the translator reads them as printed definitions: the holders run the
 * granted rule as their own ability, and its "this unit" is the holder.
 */

/** The parts of an ability record a grant carries to its holders. */
export type GrantedRecord = { effect?: unknown; trigger?: unknown; usage?: unknown; optional?: unknown };

/** The ability record with this id, or undefined when none resolves. */
export type GrantedRecordLookup = (abilityId: string) => GrantedRecord | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrite each `ability-grant` that names an ability record by id into a printed grant: its
 * `definition` is an ability part carrying the record's effect (itself resolved), trigger, usage
 * and optionality. A grant already carrying a definition, a rules bundle, an id `lookup` does not
 * resolve (a core ability), and a record in `seen` (the granting ability itself, or a cycle) stay
 * as they are, so the translator reports them as before. Unchanged subtrees keep their identity.
 */
export function resolveGrantedRecords(effect: unknown, lookup: GrantedRecordLookup, seen: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(effect)) {
    let copy: unknown[] | undefined;
    effect.forEach((child, index) => {
      const resolved = resolveGrantedRecords(child, lookup, seen);
      if (resolved !== child) (copy ??= [...effect])[index] = resolved;
    });
    return copy ?? effect;
  }
  if (!isObject(effect)) return effect;
  if (effect.type === "ability-grant" && isObject(effect.modifier)) {
    const modifier = effect.modifier;
    const ability = modifier.ability;
    if (typeof ability === "string" && modifier.definition == null && modifier.rules_bundle !== true && !seen.has(ability)) {
      const record = lookup(ability);
      if (record && isObject(record.effect)) {
        const definition: Record<string, unknown> = { type: "ability-part", effect: resolveGrantedRecords(record.effect, lookup, new Set([...seen, ability])) };
        if (record.trigger != null) definition.trigger = record.trigger;
        if (record.usage != null) definition.usage = record.usage;
        if (record.optional === true) definition.optional = true;
        return { ...effect, modifier: { ...modifier, definition } };
      }
    }
  }
  let copy: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(effect)) {
    const resolved = resolveGrantedRecords(child, lookup, seen);
    if (resolved !== child) (copy ??= { ...effect })[key] = resolved;
  }
  return copy ?? effect;
}
