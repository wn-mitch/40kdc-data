/**
 * Rules prose from the GW MFM dump.
 *
 * The faction-safe API is {@link DumpProse} (`dump-prose-lookup.ts`): prose keyed by (faction,
 * owner, ability) over {@link enumerateAbilityRows} (`dump-prose-rows.ts`), the complete,
 * deterministic list of ability-bearing dump rows with their owning publication, faction, owner,
 * printed name and slug. Text assembly lives in `dump-text.ts`.
 *
 * The store-shaped helpers below (`stratagemProseById`, `collectRules`, `buildProseIndex`,
 * `resolveProse`) serve the raw-text store writers and are deprecated with them: they key by bare
 * name across factions.
 */
import { detachmentScopedId, nameToId } from "../converters/id-generator.js";
import type { MfmDump } from "./loader.js";
import { repoDirForFactionName } from "./faction-map.js";
import { assembleRuleText, menuSections, plainBlock, plainLine } from "./dump-text.js";

export * from "./dump-text.js";
export * from "./dump-prose-rows.js";
export * from "./dump-prose-lookup.js";

export interface StratagemProse {
  name: string;
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
  ref: string;
}

/** Repo stratagem id (`detachmentScopedId`, or `nameToId` for core ones) → its dump prose.
 * @deprecated Keys by bare name across factions; use {@link DumpProse}.
 */
export function stratagemProseById(dump: MfmDump): Map<string, StratagemProse> {
  const detName = dump.byId("detachment");
  const m = new Map<string, StratagemProse>();
  for (const s of dump.table("stratagem")) {
    const name = dump.enName(s);
    if (!name) continue;
    let id: string;
    try {
      id = s.detachmentId ? detachmentScopedId(name, dump.enName(detName.get(s.detachmentId)) ?? "") : nameToId(name);
    } catch {
      continue;
    }
    const en = s.localisations?.en;
    m.set(id, {
      name,
      when: plainLine(en?.whenRules),
      target: plainLine(en?.targetRules),
      effect: plainLine(en?.effectRules),
      restrictions: plainLine(en?.restrictionRules),
      ref: `dump.json#${s.id}`,
    });
  }
  return m;
}

export interface DumpRule {
  name: string;
  /** Bare, then detachment-scoped (detachment rules only). */
  slugs: string[];
  factionDir: string;
  text: string;
  ref: string;
  /** From a non-Combat-Patrol, non-Legends publication. */
  fromPreferredPub: boolean;
  /** A `■`-section sub-rule: only meaningful if enrichment models it as its own ability. */
  isSub?: boolean;
}

function preferredPub(dump: MfmDump, publicationId: string | undefined): boolean {
  if (!publicationId) return false;
  const pub = dump.byId("publication").get(publicationId);
  return !!pub && !pub.isCombatPatrol && !pub.isLegends;
}

/** Every detachment and army rule with assembled prose, deduped per (faction, primary slug).
 * @deprecated Keys by bare name across factions; use {@link DumpProse}.
 */
export function collectRules(dump: MfmDump): DumpRule[] {
  const fkName = (fkId: string | null): string | undefined =>
    fkId ? dump.enName(dump.byId("faction_keyword").get(fkId)) : undefined;
  const byDetRule = dump.groupBy("rule_container_component", "detachmentRuleId");
  const byArmyRule = dump.groupBy("rule_container_component", "armyRuleId");
  const armyRuleFk = dump.groupBy("army_rule_faction_keyword", "armyRuleId");
  const detById = dump.byId("detachment");

  const candidates: DumpRule[] = [];
  for (const r of dump.table("detachment_rule")) {
    const name = dump.enName(r);
    if (!name || !r.id) continue;
    const det = r.detachmentId ? detById.get(r.detachmentId) : undefined;
    const dir = repoDirForFactionName(fkName(r.detachmentId ? dump.factionKeywordOfDetachment(r.detachmentId) : null));
    const text = assembleRuleText(byDetRule.get(r.id) ?? []);
    if (!dir || !text) continue;
    const slugs = apostropheSlugs(name);
    const detName = dump.enName(det);
    if (detName) {
      for (const spelling of apostropheSpellings(name)) {
        try {
          slugs.push(detachmentScopedId(spelling, detName));
        } catch {
          /* unslugable detachment name — the bare slug still applies */
        }
      }
    }
    candidates.push({ name, slugs, factionDir: dir, text, ref: `dump.json#${r.id}`, fromPreferredPub: preferredPub(dump, det?.publicationId) });
  }
  for (const r of dump.table("army_rule")) {
    const name = dump.enName(r);
    if (!name || !r.id) continue;
    const fkId =
      armyRuleFk.get(r.id)?.[0]?.factionKeywordId ??
      dump.byId("publication").get(r.publicationId ?? "")?.factionKeywordId ??
      null;
    const dir = repoDirForFactionName(fkName(fkId));
    const text = assembleRuleText(byArmyRule.get(r.id) ?? []);
    if (!dir || !text) continue;
    candidates.push({ name, slugs: apostropheSlugs(name), factionDir: dir, text, ref: `dump.json#${r.id}`, fromPreferredPub: preferredPub(dump, r.publicationId) });
  }

  // Preferred publication wins, then the longest text.
  const best = new Map<string, DumpRule>();
  for (const c of candidates) {
    const key = `${c.factionDir}::${c.slugs[0]}`;
    const cur = best.get(key);
    if (!cur || (c.fromPreferredPub && !cur.fromPreferredPub) || (c.fromPreferredPub === cur.fromPreferredPub && c.text.length > cur.text.length)) {
      best.set(key, c);
    }
  }
  // A rule's `■ **Name [cost]**` sections are named sub-rules the repo may model as separate
  // abilities; each is emitted under its own slug and only lands if such an ability exists.
  for (const rule of [...best.values()]) {
    for (const sub of subSections(rule)) {
      const key = `${sub.factionDir}::${sub.slugs[0]}`;
      if (!best.has(key)) best.set(key, sub);
    }
  }
  return [...best.values()];
}

function subSections(rule: DumpRule): DumpRule[] {
  const subs: DumpRule[] = [];
  for (const m of menuSections(rule.text)) {
    let slug: string;
    try {
      slug = nameToId(m.name);
    } catch {
      continue;
    }
    subs.push({
      name: m.name,
      slugs: [slug],
      factionDir: rule.factionDir,
      text: m.cost ? `**${m.name} [${m.cost}]**\n${m.text}` : `**${m.name}**\n${m.text}`,
      ref: rule.ref,
      fromPreferredPub: rule.fromPreferredPub,
      isSub: true,
    });
  }
  return subs;
}

/** Every id spelling a name can carry: with and without a trailing "(…)", and apostrophes as separators. */
/** A name as written, and with each apostrophe read as a word break ("Nurgle’s" → "Nurgle s"). */
function apostropheSpellings(name: string): string[] {
  const spaced = name.replace(/[’']/g, " ");
  return spaced === name ? [name] : [name, spaced];
}

/** The ids a rule name can have: the repo slugs "Nurgle’s Gift" both `nurgles-gift` and `nurgle-s-gift`.
 * The first entry is always `nameToId(name)`, which callers key on. */
export function apostropheSlugs(name: string): string[] {
  const out: string[] = [];
  for (const spelling of apostropheSpellings(name)) {
    try {
      const slug = nameToId(spelling);
      if (!out.includes(slug)) out.push(slug);
    } catch {
      /* unslugable spelling */
    }
  }
  return out;
}

export function slugVariants(name: string | null | undefined): string[] {
  if (typeof name !== "string" || !name.trim()) return [];
  const out = new Set<string>();
  for (const base of [name, name.replace(/\s*\([^)]*\)\s*$/, "")]) {
    for (const v of [base, base.replace(/[’']/g, " ")]) {
      try {
        out.add(nameToId(v));
      } catch {
        /* unslugable spelling */
      }
    }
  }
  return [...out];
}

/** Candidate prose under a key; a key two different texts claim is ambiguous and resolves to nothing. */
class Candidates {
  private readonly byKey = new Map<string, Map<string, { text: string; ref: string }>>();

  add(key: string, text: string | undefined, ref: string): void {
    if (!text || text === "-") return;
    const set = this.byKey.get(key) ?? new Map();
    if (!set.has(text)) set.set(text, { text, ref });
    this.byKey.set(key, set);
  }

  resolve(key: string): { text: string; ref: string } | null {
    const set = this.byKey.get(key);
    return set && set.size === 1 ? [...set.values()][0]! : null;
  }
}

export interface ProseIndex {
  /** `<unit-id>|<name-slug>`: datasheet abilities, rules and sub-abilities, by the datasheet they hang off. */
  unitScoped: Candidates;
  /** `<name-slug>-<detachment-slug>`: enhancements. */
  detachmentScoped: Candidates;
  /** `<name-slug>`: enhancements, kept apart so a unit ability never resolves to one. */
  bareDetachment: Candidates;
  /** `<name-slug>`: datasheet abilities and rules, wargear and allegiance abilities. */
  bareRule: Candidates;
}

type Row = Record<string, unknown> & { id?: unknown; localisations?: { en?: Record<string, unknown> } };
const en = (row: Row): Record<string, unknown> => row.localisations?.en ?? {};
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Unit abilities, enhancements and wargear prose, keyed as repo ability ids are.
 * @deprecated Keys by bare name across factions; use {@link DumpProse}.
 */
export function buildProseIndex(dump: MfmDump): ProseIndex {
  const table = (name: string): Row[] => dump.table(name as Parameters<MfmDump["table"]>[0]) as unknown as Row[];
  const index: ProseIndex = { unitScoped: new Candidates(), detachmentScoped: new Candidates(), bareDetachment: new Candidates(), bareRule: new Candidates() };
  const slug = (name: unknown): string | undefined => {
    try {
      return typeof name === "string" ? nameToId(name) : undefined;
    } catch {
      return undefined;
    }
  };
  const detachmentSlug = new Map<string, string>();
  for (const row of table("detachment")) {
    const s = slug(en(row).name);
    if (s) detachmentSlug.set(String(row.id), s);
  }
  for (const row of table("enhancement")) {
    const text = plainBlock(str(en(row).rules));
    const ref = `dump.json#${String(row.id)}`;
    const det = typeof row.detachmentId === "string" ? detachmentSlug.get(row.detachmentId) : undefined;
    for (const n of slugVariants(str(en(row).name))) {
      if (det) index.detachmentScoped.add(`${n}-${det}`, text, ref);
      index.bareDetachment.add(n, text, ref);
    }
  }
  // Distinct units share ability names, so datasheet prose resolves through the datasheet join.
  const datasheetUnit = new Map<string, string>();
  for (const row of table("datasheet")) {
    const s = slug(en(row).name);
    if (s) datasheetUnit.set(String(row.id), s);
  }
  const abilityById = new Map<string, Row>();
  for (const row of table("datasheet_ability")) {
    abilityById.set(String(row.id), row);
    for (const n of slugVariants(str(en(row).name))) index.bareRule.add(n, plainBlock(str(en(row).rules)), `dump.json#${String(row.id)}`);
  }
  const unitsOfAbility = new Map<string, string[]>();
  for (const link of table("datasheet_datasheet_ability")) {
    const unit = datasheetUnit.get(String(link.datasheetId));
    const ability = abilityById.get(String(link.datasheetAbilityId));
    if (!unit || !ability) continue;
    unitsOfAbility.set(String(link.datasheetAbilityId), [...(unitsOfAbility.get(String(link.datasheetAbilityId)) ?? []), unit]);
    for (const n of slugVariants(str(en(ability).name))) index.unitScoped.add(`${unit}|${n}`, plainBlock(str(en(ability).rules)), `dump.json#${String(ability.id)}`);
  }
  for (const row of table("datasheet_rule")) {
    const unit = datasheetUnit.get(String(row.datasheetId));
    if (!unit) continue;
    for (const n of slugVariants(str(en(row).name))) index.unitScoped.add(`${unit}|${n}`, plainBlock(str(en(row).rules)), `dump.json#${String(row.id)}`);
  }
  for (const row of table("datasheet_sub_ability")) {
    const names = slugVariants(str(en(row).name));
    const text = plainBlock(str(en(row).rules));
    const ref = `dump.json#${String(row.id)}`;
    for (const unit of unitsOfAbility.get(String(row.datasheetAbilityId)) ?? []) for (const n of names) index.unitScoped.add(`${unit}|${n}`, text, ref);
    for (const n of names) index.bareRule.add(n, text, ref);
  }
  for (const [tableName, field] of [["allegiance_ability", "rules"], ["wargear_ability", "rules"], ["wargear_item", "ruleText"]] as const) {
    for (const row of table(tableName)) for (const n of slugVariants(str(en(row).name))) index.bareRule.add(n, plainBlock(str(en(row)[field])), `dump.json#${String(row.id)}`);
  }
  return index;
}

/** A repo ability's prose: its own id first, then the units it is on, then a bare name match.
 * @deprecated Keys by bare name across factions; use {@link DumpProse}.
 */
export function resolveProse(
  ability: { ability_id: string; name?: string; ability_type?: string; unit_ids?: readonly string[] },
  index: ProseIndex,
): { text: string; ref: string } | null {
  const names = slugVariants(ability.name);
  const direct = index.detachmentScoped.resolve(ability.ability_id);
  if (direct) return direct;
  for (const unit of ability.unit_ids ?? []) {
    for (const n of names) {
      const hit = index.unitScoped.resolve(`${unit}|${n}`);
      if (hit) return hit;
    }
  }
  const bare = ability.ability_type === "enhancement" ? index.bareDetachment : index.bareRule;
  for (const n of [ability.ability_id, ...names]) {
    const hit = bare.resolve(n);
    if (hit) return hit;
  }
  return null;
}
