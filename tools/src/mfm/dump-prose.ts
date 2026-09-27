/**
 * Rules prose from the GW MFM dump, shaped as the raw-text store keeps it: stratagems as their
 * when/target/effect/restrictions fields, everything else as `raw_text` with `**bold**` keywords
 * and line breaks kept. Shared by the store backfills and the dump-wins store refresh.
 */
import { detachmentScopedId, nameToId } from "../converters/id-generator.js";
import type { MfmDump, RuleContainerComponentRow } from "./loader.js";
import { repoDirForFactionName } from "./faction-map.js";

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };

/** HTML character references as the characters they stand for ("&#x65;" → "e", "&amp;" → "&"). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** Inline markup to plain text on one line, `<b>` kept as `**bold**`; null/empty → undefined. */
export function plainLine(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s
    .replace(/<b>(.*?)<\/b>/gis, "**$1**")
    .replace(/<[^>]+>/g, "")
    .replace(/&[#a-z0-9]+;/giu, (m) => decodeEntities(m))
    .replace(/\s+/g, " ")
    .trim();
  return t || undefined;
}

/**
 * Inline markup to plain text keeping line breaks: multi-section rules delimit their sub-rules by
 * line (the `■ **Name [cost]**` reward menus), and that structure carries meaning.
 */
export function plainBlock(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s
    .replace(/<b>(.*?)<\/b>/gis, "**$1**")
    .replace(/<[^>]+>/g, "")
    .replace(/&[#a-z0-9]+;/giu, (m) => decodeEntities(m))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
  return t || undefined;
}

/** A rule's prose from its ordered rule-container components; undefined if none carry text. */
export function assembleRuleText(components: readonly RuleContainerComponentRow[]): string | undefined {
  const blocks: string[] = [];
  for (const c of [...components].sort((a, b) => a.displayOrder - b.displayOrder)) {
    const en = c.localisations?.en;
    switch (c.type) {
      case "text":
      case "textBold":
      case "boxedText":
      case "bullets": {
        const t = plainBlock(en?.textContent);
        if (t) blocks.push(t);
        break;
      }
      case "header": {
        const t = plainBlock(en?.textContent);
        if (t) blocks.push(`**${t.replace(/\*\*/g, "")}**`);
        break;
      }
      case "accordion": {
        const title = plainBlock(en?.title);
        const t = plainBlock(en?.textContent);
        if (title) blocks.push(`**${title.replace(/\*\*/g, "")}**`);
        if (t) blocks.push(t);
        break;
      }
      case "triggerEffectAccordion": {
        const title = plainBlock(en?.title);
        const trigger = plainBlock(en?.trigger);
        const effect = plainBlock(en?.effect);
        if (title) blocks.push(`**${title.replace(/\*\*/g, "")}**`);
        if (trigger) blocks.push(trigger);
        if (effect) blocks.push(effect);
        break;
      }
      default:
        break; // loreAccordion / quote / image — flavour and presentation
    }
  }
  return blocks.length ? blocks.join("\n") : undefined;
}

export interface StratagemProse {
  name: string;
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
  ref: string;
}

/** Repo stratagem id (`detachmentScopedId`, or `nameToId` for core ones) → its dump prose. */
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

/** Every detachment and army rule with assembled prose, deduped per (faction, primary slug). */
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
    const slugs = [nameToId(name)];
    const detName = dump.enName(det);
    if (detName) {
      try {
        slugs.push(detachmentScopedId(name, detName));
      } catch {
        /* unslugable detachment name — the bare slug still applies */
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
    candidates.push({ name, slugs: [nameToId(name)], factionDir: dir, text, ref: `dump.json#${r.id}`, fromPreferredPub: preferredPub(dump, r.publicationId) });
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
  for (const chunk of rule.text.split(/\n?■ ?/).slice(1)) {
    const m = /^\*\*([^*\n]+?)\s*(?:\[([^\]]+)\])?\*\*\n?([\s\S]*)$/.exec(chunk.trim());
    if (!m) continue;
    const [, title, cost, body] = m;
    const text = body!.split(/\n?■ /)[0]!.trim();
    if (!title!.trim() || !text) continue;
    let slug: string;
    try {
      slug = nameToId(title!.trim());
    } catch {
      continue;
    }
    subs.push({
      name: title!.trim(),
      slugs: [slug],
      factionDir: rule.factionDir,
      text: cost ? `**${title!.trim()} [${cost}]**\n${text}` : `**${title!.trim()}**\n${text}`,
      ref: rule.ref,
      fromPreferredPub: rule.fromPreferredPub,
      isSub: true,
    });
  }
  return subs;
}

/** Every id spelling a name can carry: with and without a trailing "(…)", and apostrophes as separators. */
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

/** Unit abilities, enhancements and wargear prose, keyed as repo ability ids are. */
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

/** A repo ability's prose: its own id first, then the units it is on, then a bare name match. */
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
