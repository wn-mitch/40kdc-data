/**
 * The army and detachment rules the dump prints, as the ability ids a faction's `faction_rule_ids`
 * and a detachment's `detachment_rule_ids` list. The dump is authoritative: a link the repo carries
 * that the dump no longer prints goes, and every printed rule is linked.
 *
 * - A faction dir's army rules are those of its own codex, index or supplement (never a Combat
 *   Patrol's or a Legends book's). A codex chapter whose supplement prints none takes its parent
 *   roster's (Ultramarines play the Space Marine codex's army rules).
 * - A detachment's rules are the detachment-rule rows owned by the dump detachments its `mfm` refs
 *   name; a rule section or menu option under a rule is reached through that rule. A Combat Patrol
 *   detachment also carries its box's army rules, which apply only when that patrol is played.
 *
 * Both lists follow the dump's display order and hold only ids with a record after the mirror.
 */
import type { MfmDump } from "../loader.js";
import { SHARED_ROSTERS } from "../faction-map.js";
import type { IdentitySet } from "./identity.js";

export interface RuleLinks {
  /** Faction dir → army rule ids, or undefined when the dump prints none for it or its parents. */
  armyRules(dir: string): string[] | undefined;
  /** Detachment rule ids for a detachment linked to these dump detachment ids. */
  detachmentRules(dumpDetachmentIds: readonly string[]): string[];
  /** The dump stratagem or enhancement rows those detachments print, in display order. */
  detachmentRows(kind: "stratagem" | "enhancement", dumpDetachmentIds: readonly string[]): string[];
}

export function buildRuleLinks(dump: MfmDump, ids: IdentitySet, hasRecord: (id: string) => boolean): RuleLinks {
  const order = new Map<string, number>();
  for (const table of ["army_rule", "detachment_rule"] as const) {
    if (!dump.tables[table]) continue;
    for (const r of dump.table(table) as ReadonlyArray<{ id: string; displayOrder?: number | null }>) order.set(`${table}#${r.id}`, r.displayOrder ?? 0);
  }
  const armyByDir = new Map<string, Array<{ id: string; at: number }>>();
  // Combat Patrol publication id → its army rules.
  const patrolArmy = new Map<string, Array<{ id: string; at: number }>>();
  const byDetachment = new Map<string, Array<{ id: string; at: number }>>();
  for (const identity of ids.identities) {
    if (!hasRecord(identity.id)) continue;
    for (const r of identity.rows) {
      const at = order.get(`${r.table}#${r.rowId}`) ?? 0;
      if (r.kind === "army-rule" && r.owner.kind === "army" && !r.legends && !r.publication?.combatPatrol && !r.publication?.legends) {
        const list = armyByDir.get(identity.faction) ?? armyByDir.set(identity.faction, []).get(identity.faction)!;
        if (!list.some((x) => x.id === identity.id)) list.push({ id: identity.id, at });
      }
      if (r.kind === "army-rule" && r.owner.kind === "army" && r.publication?.combatPatrol) {
        const list = patrolArmy.get(r.publication.id) ?? patrolArmy.set(r.publication.id, []).get(r.publication.id)!;
        if (!list.some((x) => x.id === identity.id)) list.push({ id: identity.id, at });
      }
      if (r.kind === "detachment-rule" && r.owner.kind === "detachment") {
        const list = byDetachment.get(r.owner.id) ?? byDetachment.set(r.owner.id, []).get(r.owner.id)!;
        if (!list.some((x) => x.id === identity.id)) list.push({ id: identity.id, at });
      }
    }
  }
  const sorted = (list: Array<{ id: string; at: number }>): string[] =>
    [...list].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => x.id);
  const rowsByDetachment = { stratagem: new Map<string, Array<{ id: string; at: number }>>(), enhancement: new Map<string, Array<{ id: string; at: number }>>() };
  for (const kind of ["stratagem", "enhancement"] as const) {
    if (!dump.tables[kind]) continue;
    for (const r of dump.table(kind) as ReadonlyArray<{ id: string; detachmentId?: string | null; displayOrder?: number | null }>) {
      if (!r.detachmentId) continue;
      const m = rowsByDetachment[kind];
      (m.get(r.detachmentId) ?? m.set(r.detachmentId, []).get(r.detachmentId)!).push({ id: r.id, at: r.displayOrder ?? 0 });
    }
  }
  return {
    detachmentRows(kind, dumpDetachmentIds) {
      return sorted(dumpDetachmentIds.flatMap((d) => rowsByDetachment[kind].get(d) ?? []));
    },
    armyRules(dir) {
      const own = armyByDir.get(dir);
      if (own?.length) return sorted(own);
      for (const parent of SHARED_ROSTERS[dir] ?? []) {
        const inherited = armyByDir.get(parent);
        if (inherited?.length) return sorted(inherited);
      }
      return undefined;
    },
    detachmentRules(dumpDetachmentIds) {
      const seen = new Set<string>();
      const once = (list: Array<{ id: string; at: number }>) => sorted(list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))));
      const own = once(dumpDetachmentIds.flatMap((d) => byDetachment.get(d) ?? []));
      const detachments = dump.tables.detachment ? dump.byId("detachment") : new Map();
      const pubs = [...new Set(dumpDetachmentIds.map((d) => (detachments.get(d) as { publicationId?: string } | undefined)?.publicationId).filter((p): p is string => !!p))];
      return [...own, ...once(pubs.flatMap((p) => patrolArmy.get(p) ?? []))];
    },
  };
}
