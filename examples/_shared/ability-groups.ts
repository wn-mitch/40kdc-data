import type { AbilityView } from "@alpaca-software/40kdc-data";

/**
 * Datasheet reading order for abilities, bucketed by `ability_type`. Shared by
 * unit cards and roundtrip collation so both surfaces group and order abilities
 * identically.
 */
export const ABILITY_GROUPS: { label: string; types: string[] }[] = [
  { label: "Core", types: ["core"] },
  { label: "Faction", types: ["faction"] },
  { label: "Datasheet", types: ["unit"] },
  { label: "Other", types: ["detachment", "enhancement", "stratagem"] },
];

export interface AbilityGroup {
  label: string;
  abilities: AbilityView[];
}

/** Bucket abilities into datasheet groups, dropping empty groups. */
export function groupAbilities(abilities: AbilityView[]): AbilityGroup[] {
  return ABILITY_GROUPS.map((group) => ({
    label: group.label,
    abilities: abilities.filter((ability) => {
      const type = ability.raw.ability_type ?? "unit";
      return group.types.includes(type);
    }),
  })).filter((group) => group.abilities.length > 0);
}
