/**
 * Link-resolution for the detachment section. Detachments are the army-
 * construction hub: a detachment record references its rule ability/abilities,
 * the force dispositions it grants, and the enhancements + stratagems it makes
 * available. This module follows those id links through the embedded Dataset so
 * the Svelte component stays thin (mirrors how export.ts / source-store.ts keep
 * logic out of the `.svelte` files).
 *
 * Resolution uses `.getAny(id)` rather than `.get(id)` throughout: enhancements,
 * stratagems, and force dispositions are passthrough collections without a
 * faction index, and Space Marine detachments are replicated across chapters, so
 * `.get()` would throw on an ambiguous shared id. `.getAny()` is first-wins and
 * never throws; a dangling id resolves to `undefined` and is dropped.
 */

import {
  abilities,
  detachments,
  enhancements,
  stratagems,
  forceDispositions,
} from "@alpaca-software/40kdc-data";
import type {
  Detachment,
  Enhancement,
  Stratagem,
} from "@alpaca-software/40kdc-data";

/** An ability id resolved to its display name and describer prose. */
export interface ResolvedAbility {
  id: string;
  name: string;
  /** Describer output rendered from the DSL; "" when empty or it threw. */
  description: string;
}

/** A force disposition resolved to its display name and community text. */
export interface ResolvedDisposition {
  id: string;
  name: string;
  text: string;
}

/** A detachment with all of its links resolved to concrete records. */
export interface ResolvedDetachment {
  raw: Detachment;
  /** Resolved rule abilities (a detachment may grant more than one). */
  rules: ResolvedAbility[];
  dispositions: ResolvedDisposition[];
  enhancements: Enhancement[];
  stratagems: Stratagem[];
}

/**
 * Resolve an ability id to its name + describer output, or `undefined` when the
 * id is null/absent or does not resolve to an ability. Reused for detachment
 * rules and for enhancement/stratagem `ability_id`s (which are often null).
 */
export function resolveAbility(
  id: string | null | undefined,
  factionId: string,
): ResolvedAbility | undefined {
  if (!id) return undefined;
  const a = abilities.getInFaction(id, factionId) ?? abilities.getAny(id);
  if (!a || (a.raw.faction_id != null && a.raw.faction_id !== factionId)) return undefined;
  let description = "";
  try {
    description = a.describe();
  } catch {
    description = "";
  }
  return { id: a.id, name: a.name, description };
}

/** All rule ability ids for a detachment (plural form preferred, scalar fallback). */
function ruleIdsOf(d: Detachment): string[] {
  if (d.detachment_rule_ids && d.detachment_rule_ids.length > 0) {
    return d.detachment_rule_ids;
  }
  return d.detachment_rule_id ? [d.detachment_rule_id] : [];
}

/** Resolve one detachment's rule / disposition / enhancement / stratagem links. */
export function resolveDetachment(d: Detachment, factionId: string): ResolvedDetachment {
  const rules = ruleIdsOf(d)
    .map((id) => resolveAbility(id, factionId))
    .filter((r): r is ResolvedAbility => r !== undefined);

  const dispositions = (d.force_dispositions ?? [])
    .map((id) => {
      const fd = forceDispositions.getAny(id);
      // fd.id is a string-literal union; widen to string to match ResolvedDisposition.
      return fd
        ? { id: fd.id as string, name: fd.name, text: fd.text ?? "" }
        : undefined;
    })
    .filter((x): x is ResolvedDisposition => x !== undefined);

  const resolvedEnhancements = (d.enhancement_ids ?? [])
    .map((id) => enhancements.getAny(id))
    .filter((x): x is Enhancement => x !== undefined);

  const resolvedStratagems = (d.stratagem_ids ?? [])
    .map((id) => stratagems.getAny(id))
    .filter((x): x is Stratagem => x !== undefined);

  return {
    raw: d,
    rules,
    dispositions,
    enhancements: resolvedEnhancements,
    stratagems: resolvedStratagems,
  };
}

/** Every detachment for a faction, resolved and sorted by name. */
export function detachmentsForFaction(factionId: string): ResolvedDetachment[] {
  return [...detachments.byFaction(factionId)]
    .map((detachment) => resolveDetachment(detachment, factionId))
    .sort((a, b) => a.raw.name.localeCompare(b.raw.name));
}
