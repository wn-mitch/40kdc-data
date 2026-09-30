/**
 * Every ability-bearing row of the GW MFM dump, with the faction and owner that print it.
 *
 * A row's faction is the publication that prints it (decision D7): a datasheet ability belongs to
 * each faction whose datasheet links it, a detachment's rules to the detachment's publication, an
 * army rule to its publication. Core Rules rows belong to `_core`. Supplements and indexes map to
 * their own faction dir (Blood Angels, Dark Angels, Space Wolves, Black Templars, Deathwatch),
 * whether or not the repo has that dir yet. Rows that no datasheet, detachment, enhancement, army
 * rule or core-rules section links are not abilities anyone can use; they are reported as
 * `unowned`, never returned as prose.
 *
 * Out of scope, by design: weapon abilities (`wargear_ability`, the weapon keywords in
 * `weapon-keywords.json`), and nameless rows (`wargear_rule`, `invulnerable_save`).
 */
import { readDamaged } from "./damaged.js";
import { nameToId } from "../converters/id-generator.js";
import { FACTION_ALIASES } from "./faction-map.js";
import type { MfmDump, MfmRow, MfmTableName } from "./loader.js";
import { assembleRuleText, type BulletLookup, menuSections, plainBlock, plainLine, ruleSections } from "./dump-text.js";
import { wargearItemsForDatasheet } from "./wargear.js";

/** The faction every Core Rules row belongs to. */
export const CORE_FACTION = "_core";

/** Faction keywords the repo does not model (titan legions): their rows map to no faction. */
const UNMODELLED_KEYWORDS = new Set(["Adeptus Titanicus", "Titanicus Traitoris"]);

export type AbilityRowKind =
  | "datasheet-ability"
  | "core-ability"
  | "datasheet-rule"
  | "sub-ability"
  | "damaged"
  | "wargear"
  | "allegiance-ability"
  | "army-rule"
  | "detachment-rule"
  | "rule-section"
  | "menu-option"
  | "stratagem"
  | "enhancement"
  | "core-rule";

/** Who prints a row: a datasheet, a detachment, an enhancement, the faction's army rules, or the core rules. */
export type AbilityOwner =
  | { kind: "datasheet"; id: string; name: string; slug: string | null }
  | { kind: "detachment"; id: string; name: string; slug: string | null }
  | { kind: "enhancement"; id: string; name: string; slug: string | null }
  | { kind: "army" }
  | { kind: "core" };

export interface PublicationInfo {
  id: string;
  name: string;
  combatPatrol: boolean;
  legends: boolean;
}

export interface StratagemFields {
  when?: string;
  target?: string;
  effect?: string;
  restrictions?: string;
  secondaryEffect?: string;
}

export interface AbilityRow {
  /** Unique and stable across runs on the same dump. */
  key: string;
  kind: AbilityRowKind;
  table: MfmTableName;
  rowId: string;
  /** `dump.json#<rowId>`. */
  ref: string;
  faction: string;
  publication: PublicationInfo | null;
  owner: AbilityOwner;
  /** The printed name, exactly as the dump spells it. */
  name: string;
  /** `nameToId(name)`: the slug the mirror derives ids from (D11); null if the name has none. */
  slug: string | null;
  /** Assembled prose; undefined when the dump prints none. */
  text?: string;
  stratagem?: StratagemFields;
  /** `datasheet_ability.abilityType` (`core` / `faction` / `datasheet`). */
  abilityType?: string;
  /** A datasheet stub ("-") takes its prose from the army or detachment rule it points at. */
  textFrom?: { table: MfmTableName; rowId: string };
  /** The row a section, menu option or sub-ability belongs to. */
  parent?: { table: MfmTableName; rowId: string };
  /** A datasheet link's model restriction ("Sergeant model only"). */
  restriction?: string;
  /** The publication or the datasheet is Legends. */
  legends: boolean;
  /** Core abilities: the datasheets that print them. */
  datasheetIds?: string[];
  /** Army/detachment rules: names datasheet stubs print for them ("… (Aura)"). */
  aliases?: string[];
  /** Other factions whose rows carry this same dump row. */
  sharedWith: string[];
}

export interface UnownedRow {
  table: MfmTableName;
  rowId: string;
  ref: string;
  name?: string;
  reason: "no-owner" | "unmapped-publication" | "no-name";
  publication?: string;
}

export interface AbilityRowSet {
  rows: AbilityRow[];
  unowned: UnownedRow[];
}

/** A faction keyword's repo dir: aliases first, unmodelled keywords none, else its slug. */
export function factionForKeyword(name: string | undefined): string | null {
  if (!name || UNMODELLED_KEYWORDS.has(name)) return null;
  return FACTION_ALIASES[name] ?? safeSlug(name);
}

export function safeSlug(name: string | null | undefined): string | null {
  if (!name) return null;
  try {
    return nameToId(name);
  } catch {
    return null;
  }
}

const ref = (rowId: string): string => `dump.json#${rowId}`;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A table's rows, or none when a focused fixture omits it. */
function rowsOf<N extends MfmTableName>(dump: MfmDump, name: N): readonly MfmRow<N>[] {
  return dump.tables[name] ?? [];
}

function groupRows<T>(rows: readonly T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const g = m.get(k);
    if (g) g.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function ownerKey(o: AbilityOwner): string {
  return o.kind === "army" || o.kind === "core" ? o.kind : `${o.kind}:${o.slug ?? ""}:${o.id}`;
}

type Placement = { faction: string; publication: PublicationInfo | null; owner: AbilityOwner; legends: boolean; restriction?: string };
type RowBody = Omit<AbilityRow, "key" | "faction" | "publication" | "owner" | "legends" | "sharedWith" | "restriction" | "slug" | "ref">;

/** Enumerate every ability-bearing dump row per (faction, owner), sorted deterministically. */
export function enumerateAbilityRows(dump: MfmDump): AbilityRowSet {
  const en = (row: { localisations?: Record<string, unknown> } | undefined): Record<string, string | null | undefined> =>
    ((row?.localisations as Record<string, Record<string, string | null | undefined>> | undefined)?.en ?? {});
  const nameOf = (row: { localisations?: Record<string, unknown> } | undefined): string | undefined =>
    (typeof en(row).name === "string" ? en(row).name!.trim() : undefined) || undefined;

  const pubs = new Map(rowsOf(dump, "publication").map((p) => [p.id, p]));
  const keywords = new Map(rowsOf(dump, "faction_keyword").map((k) => [k.id, k]));
  const datasheets = new Map(rowsOf(dump, "datasheet").map((d) => [d.id, d]));
  const detachments = new Map(rowsOf(dump, "detachment").map((d) => [d.id, d]));
  const enhancements = new Map(rowsOf(dump, "enhancement").map((e) => [e.id, e]));
  const bulletRows = groupRows(rowsOf(dump, "bullet_point"), (b) => b.ruleContainerComponentId);
  const bullets: BulletLookup = (id) => (bulletRows.get(id) ?? []).map((b) => ({ id: b.id, displayOrder: b.displayOrder, text: en(b).text }));

  const pubInfo = (id: string | null | undefined): PublicationInfo | null => {
    const p = id ? pubs.get(id) : undefined;
    if (!p) return null;
    return { id: p.id, name: nameOf(p) ?? p.id, combatPatrol: p.isCombatPatrol === true, legends: p.isLegends === true };
  };
  /** A publication's faction: Core Rules → `_core`, else its faction keyword's dir. */
  const pubFaction = (id: string | null | undefined): string | null => {
    const p = id ? pubs.get(id) : undefined;
    if (!p) return null;
    if (p.isCoreRules) return CORE_FACTION;
    return p.factionKeywordId ? factionForKeyword(nameOf(keywords.get(p.factionKeywordId))) : null;
  };
  const owned = (owner: AbilityOwner, pubId: string | null | undefined, legends = false, faction = pubFaction(pubId)): Placement | string => {
    const publication = pubInfo(pubId);
    if (!faction) return publication?.name ?? "(no publication)";
    return { faction, publication, owner, legends: legends || (publication?.legends ?? false) };
  };
  const datasheetPlacement = (id: string): Placement | string => {
    const ds = datasheets.get(id);
    if (!ds) return "(missing datasheet)";
    const name = nameOf(ds) ?? ds.id;
    return owned({ kind: "datasheet", id: ds.id, name, slug: safeSlug(name) }, ds.publicationId, ds.isLegends === true);
  };
  const detachmentPlacement = (id: string): Placement | string => {
    const det = detachments.get(id);
    if (!det) return "(missing detachment)";
    const name = nameOf(det) ?? det.id;
    return owned({ kind: "detachment", id: det.id, name, slug: safeSlug(name) }, det.publicationId);
  };

  const out = new Map<string, AbilityRow>();
  const unowned: UnownedRow[] = [];
  const emit = (body: RowBody, placements: readonly (Placement | string)[], keySuffix = ""): void => {
    const slug = safeSlug(body.name);
    let placed = false;
    const unmapped = new Set<string>();
    for (const p of placements) {
      if (typeof p === "string") {
        unmapped.add(p);
        continue;
      }
      placed = true;
      const key = `${p.faction}|${ownerKey(p.owner)}|${body.kind}|${body.table}#${body.rowId}${keySuffix}`;
      if (out.has(key)) continue;
      out.set(key, {
        key,
        ...body,
        ref: ref(body.rowId),
        slug,
        faction: p.faction,
        publication: p.publication,
        owner: p.owner,
        legends: p.legends,
        ...(p.restriction ? { restriction: p.restriction } : {}),
        sharedWith: [],
      });
    }
    if (placed || keySuffix) return;
    unowned.push({
      table: body.table,
      rowId: body.rowId,
      ref: ref(body.rowId),
      name: body.name,
      reason: unmapped.size ? "unmapped-publication" : "no-owner",
      ...(unmapped.size ? { publication: [...unmapped].sort(cmp).join(", ") } : {}),
    });
  };
  const nameless = (table: MfmTableName, rowId: string): void => {
    unowned.push({ table, rowId, ref: ref(rowId), reason: "no-name" });
  };

  // Army and detachment rules first: datasheet stubs take their text from them.
  const armyComponents = groupRows(rowsOf(dump, "rule_container_component"), (c) => c.armyRuleId);
  const detComponents = groupRows(rowsOf(dump, "rule_container_component"), (c) => c.detachmentRuleId);
  const armyRuleKeywords = groupRows(rowsOf(dump, "army_rule_faction_keyword"), (r) => r.armyRuleId);
  const ruleText = new Map<string, string | undefined>();
  const stubsByRule = groupRows(rowsOf(dump, "datasheet_ability"), (a) => a.armyRuleId ?? a.detachmentRuleId);
  const aliasesOf = (ruleId: string, name: string): string[] | undefined => {
    const names = [...new Set((stubsByRule.get(ruleId) ?? []).map((s) => nameOf(s)).filter((n): n is string => !!n && n !== name))].sort(cmp);
    return names.length ? names : undefined;
  };
  const emitRule = (table: "army_rule" | "detachment_rule", row: { id: string }, name: string, components: readonly MfmRow<"rule_container_component">[], placements: (Placement | string)[]): void => {
    const text = assembleRuleText(components, bullets);
    ruleText.set(row.id, text);
    const aliases = aliasesOf(row.id, name);
    emit({ kind: table === "army_rule" ? "army-rule" : "detachment-rule", table, rowId: row.id, name, ...(text ? { text } : {}), ...(aliases ? { aliases } : {}) }, placements);
    const parent = { table, rowId: row.id };
    const ruleSlug = safeSlug(name);
    // A section headed with the rule's own name is the rule itself, not a sub-rule.
    for (const s of ruleSections(components, bullets)) {
      if (!s.text || safeSlug(s.name) === ruleSlug) continue;
      emit({ kind: "rule-section", table: "rule_container_component", rowId: s.header.id, name: s.name, text: s.text, parent }, placements);
    }
    for (const m of text ? menuSections(text) : []) {
      if (safeSlug(m.name) === ruleSlug) continue;
      emit(
        { kind: "menu-option", table, rowId: row.id, name: m.name, text: m.cost ? `**${m.name} [${m.cost}]**\n${m.text}` : `**${m.name}**\n${m.text}`, parent },
        placements,
        `|menu:${safeSlug(m.name) ?? m.name}`,
      );
    }
  };
  for (const r of rowsOf(dump, "army_rule")) {
    const name = nameOf(r);
    if (!name) {
      nameless("army_rule", r.id);
      continue;
    }
    let placements: (Placement | string)[] = [owned({ kind: "army" }, r.publicationId)];
    if (typeof placements[0] === "string") {
      // A publication with no faction keyword: the rule names its factions itself.
      const fks = (armyRuleKeywords.get(r.id) ?? []).map((k) => k.factionKeywordId).sort(cmp);
      if (fks.length) placements = fks.map((fk) => owned({ kind: "army" }, r.publicationId, false, factionForKeyword(nameOf(keywords.get(fk)))));
    }
    emitRule("army_rule", r, name, armyComponents.get(r.id) ?? [], placements);
  }
  for (const r of rowsOf(dump, "detachment_rule")) {
    const name = nameOf(r);
    if (!name) {
      nameless("detachment_rule", r.id);
      continue;
    }
    emitRule("detachment_rule", r, name, detComponents.get(r.id) ?? [], r.detachmentId ? [detachmentPlacement(r.detachmentId)] : []);
  }

  // Datasheet abilities: per linking datasheet (or enhancement); core ones once, in `_core`.
  const dsLinks = groupRows(rowsOf(dump, "datasheet_datasheet_ability"), (l) => l.datasheetAbilityId);
  const enhLinks = groupRows(rowsOf(dump, "enhancement_datasheet_ability"), (l) => l.datasheetAbilityId);
  const subsOf = groupRows(rowsOf(dump, "datasheet_sub_ability"), (s) => s.datasheetAbilityId);
  const abilityPlacements = new Map<string, (Placement | string)[]>();
  for (const a of rowsOf(dump, "datasheet_ability")) {
    const name = nameOf(a);
    if (!name) {
      nameless("datasheet_ability", a.id);
      continue;
    }
    const links = [...(dsLinks.get(a.id) ?? [])].sort((x, y) => cmp(x.datasheetId, y.datasheetId));
    const own = plainBlock(en(a).rules);
    const ruleId = a.armyRuleId ?? a.detachmentRuleId;
    const stub = !own || own === "-";
    const base = stub && ruleId ? ruleText.get(ruleId) : stub ? undefined : own;
    const subs = [...(subsOf.get(a.id) ?? [])].sort((x, y) => x.displayOrder - y.displayOrder || cmp(x.id, y.id));
    const subBlocks = subs.flatMap((s) => {
      const t = plainBlock(en(s).rules);
      const n = nameOf(s);
      return n && t ? [`**${n}**\n${t}`] : [];
    });
    const header = plainLine(en(a).subAbilityHeader);
    const parts = [base, ...(subBlocks.length && header ? [header] : []), ...subBlocks].filter((p): p is string => !!p);
    const text = parts.length ? parts.join("\n") : undefined;
    const textFrom = stub && ruleId ? { table: (a.armyRuleId ? "army_rule" : "detachment_rule") as MfmTableName, rowId: ruleId } : undefined;
    const body: RowBody = { kind: "datasheet-ability", table: "datasheet_ability", rowId: a.id, name, abilityType: a.abilityType, ...(text ? { text } : {}), ...(textFrom ? { textFrom } : {}) };
    let placements: (Placement | string)[];
    if (a.abilityType === "core") {
      body.kind = "core-ability";
      body.datasheetIds = [...new Set(links.map((l) => l.datasheetId))].sort(cmp);
      placements = links.length ? [{ faction: CORE_FACTION, publication: null, owner: { kind: "core" }, legends: false }] : [];
    } else {
      placements = links.map((l) => {
        const p = datasheetPlacement(l.datasheetId);
        const restriction = plainLine(en(l).restriction);
        return typeof p === "string" || !restriction ? p : { ...p, restriction };
      });
      for (const l of enhLinks.get(a.id) ?? []) {
        const e = enhancements.get(l.enhancementId);
        if (!e) continue;
        const ename = nameOf(e) ?? e.id;
        placements.push(owned({ kind: "enhancement", id: e.id, name: ename, slug: safeSlug(ename) }, e.publicationId ?? detachments.get(e.detachmentId ?? "")?.publicationId));
      }
      // A stub no datasheet links is its rule, already emitted under the rule's owner.
      if (!placements.length && ruleId) continue;
    }
    abilityPlacements.set(a.id, placements);
    emit(body, placements);
  }
  for (const s of rowsOf(dump, "datasheet_sub_ability")) {
    const name = nameOf(s);
    if (!name) {
      nameless("datasheet_sub_ability", s.id);
      continue;
    }
    const text = plainBlock(en(s).rules);
    emit(
      { kind: "sub-ability", table: "datasheet_sub_ability", rowId: s.id, name, ...(text ? { text } : {}), parent: { table: "datasheet_ability", rowId: s.datasheetAbilityId } },
      abilityPlacements.get(s.datasheetAbilityId) ?? [],
    );
  }

  for (const r of rowsOf(dump, "datasheet_rule")) {
    const name = nameOf(r);
    if (!name) {
      nameless("datasheet_rule", r.id);
      continue;
    }
    const text = plainBlock(en(r).rules);
    emit({ kind: "datasheet-rule", table: "datasheet_rule", rowId: r.id, name, ...(text ? { text } : {}) }, [datasheetPlacement(r.datasheetId)]);
  }
  const corePlacement: Placement = { faction: CORE_FACTION, publication: null, owner: { kind: "core" }, legends: false };
  for (const r of rowsOf(dump, "datasheet_damage")) {
    const name = nameOf(r);
    if (!name) {
      nameless("datasheet_damage", r.id);
      continue;
    }
    const text = plainBlock(en(r).rules);
    // A block that restates core Damaged X is that core rule, rated X for this datasheet; an extra
    // Objective Control penalty is the core `Damaged Objective Control` rule, rated by the penalty.
    const reading = readDamaged(name, en(r).rules, (r as { damagedAt?: number | null }).damagedAt);
    if (reading.kind !== "other") {
      const datasheetIds = [r.datasheetId];
      emit({ kind: "core-ability", table: "datasheet_damage", rowId: r.id, name: `Damaged ${reading.threshold}`, datasheetIds }, [corePlacement]);
      if (reading.kind === "core+oc")
        emit({ kind: "core-ability", table: "datasheet_damage", rowId: r.id, name: `Damaged Objective Control ${reading.oc}`, datasheetIds }, [corePlacement], "#oc");
      continue;
    }
    emit({ kind: "damaged", table: "datasheet_damage", rowId: r.id, name, ...(text ? { text } : {}) }, [datasheetPlacement(r.datasheetId)]);
  }

  // Wargear with rules: printed on every datasheet that can take the item.
  const itemDatasheets = new Map<string, string[]>();
  if (dump.tables.wargear_item) {
    for (const ds of [...datasheets.keys()].sort(cmp)) {
      for (const item of wargearItemsForDatasheet(dump, ds)) itemDatasheets.set(item.id, [...(itemDatasheets.get(item.id) ?? []), ds]);
    }
  }
  for (const w of rowsOf(dump, "wargear_item")) {
    const text = plainBlock(en(w).ruleText);
    if (!text) continue;
    const name = nameOf(w);
    if (!name) {
      nameless("wargear_item", w.id);
      continue;
    }
    emit({ kind: "wargear", table: "wargear_item", rowId: w.id, name, text }, (itemDatasheets.get(w.id) ?? []).map(datasheetPlacement));
  }

  // Allegiance abilities: a detachment's group, or a datasheet's own group.
  const groups = new Map(rowsOf(dump, "allegiance_ability_group").map((g) => [g.id, g]));
  const groupDatasheets = groupRows([...datasheets.values()], (d) => d.allegianceAbilityGroupId);
  for (const r of rowsOf(dump, "allegiance_ability")) {
    const name = nameOf(r);
    if (!name) {
      nameless("allegiance_ability", r.id);
      continue;
    }
    const g = groups.get(r.allegianceAbilityGroupId);
    const placements: (Placement | string)[] = [];
    if (g?.detachmentId) placements.push(detachmentPlacement(g.detachmentId));
    for (const d of [...(groupDatasheets.get(r.allegianceAbilityGroupId) ?? [])].sort((x, y) => cmp(x.id, y.id))) placements.push(datasheetPlacement(d.id));
    const text = plainBlock(en(r).rules);
    emit({ kind: "allegiance-ability", table: "allegiance_ability", rowId: r.id, name, ...(text ? { text } : {}) }, placements);
  }

  for (const s of rowsOf(dump, "stratagem")) {
    const name = nameOf(s);
    if (!name) {
      nameless("stratagem", s.id);
      continue;
    }
    const e = en(s);
    const fields: StratagemFields = {};
    const set = (k: keyof StratagemFields, v: string | undefined): void => {
      if (v) fields[k] = v;
    };
    set("when", plainLine(e.whenRules));
    set("target", plainLine(e.targetRules));
    set("effect", plainLine(e.effectRules));
    set("restrictions", plainLine(e.restrictionRules));
    set("secondaryEffect", plainLine(e.secondaryEffect));
    const text = [
      fields.when && `WHEN: ${fields.when}`,
      fields.target && `TARGET: ${fields.target}`,
      fields.effect && `EFFECT: ${fields.effect}`,
      fields.secondaryEffect && `SECONDARY EFFECT: ${fields.secondaryEffect}`,
      fields.restrictions && `RESTRICTIONS: ${fields.restrictions}`,
    ].filter((p): p is string => !!p).join("\n");
    const placement = s.detachmentId ? detachmentPlacement(s.detachmentId) : owned({ kind: "core" }, s.publicationId, false, pubs.get(s.publicationId ?? "")?.isCoreRules ? CORE_FACTION : null);
    emit({ kind: "stratagem", table: "stratagem", rowId: s.id, name, ...(text ? { text } : {}), stratagem: fields }, [placement]);
  }

  for (const r of rowsOf(dump, "enhancement")) {
    const name = nameOf(r);
    if (!name) {
      nameless("enhancement", r.id);
      continue;
    }
    const text = plainBlock(en(r).rules);
    const det = r.detachmentId ? detachments.get(r.detachmentId) : undefined;
    const placement = det
      ? owned({ kind: "detachment", id: det.id, name: nameOf(det) ?? det.id, slug: safeSlug(nameOf(det)) }, r.publicationId ?? det.publicationId)
      : "(no detachment)";
    emit({ kind: "enhancement", table: "enhancement", rowId: r.id, name, ...(text ? { text } : {}) }, [placement]);
  }

  // Core rules: the Core Rules publication's rule containers. Stratagem containers repeat the
  // stratagem rows; introductions are section intros. Other publications' sections are mission
  // and event rules, not abilities.
  const sections = new Map(rowsOf(dump, "rule_section").map((s) => [s.id, s]));
  const containerComponents = groupRows(rowsOf(dump, "rule_container_component"), (c) => c.ruleContainerId);
  for (const c of rowsOf(dump, "rule_container")) {
    if (c.containerType === "introduction" || c.containerType === "stratagem") continue;
    const pub = pubs.get(sections.get(c.ruleSectionId ?? "")?.publicationId ?? "");
    if (!pub?.isCoreRules) continue;
    const name = plainLine(en(c).title)?.replace(/\*\*/g, "");
    if (!name) {
      nameless("rule_container", c.id);
      continue;
    }
    const text = assembleRuleText(containerComponents.get(c.id) ?? [], bullets);
    emit({ kind: "core-rule", table: "rule_container", rowId: c.id, name, ...(text ? { text } : {}) }, [{ faction: CORE_FACTION, publication: pubInfo(pub.id), owner: { kind: "core" }, legends: false }]);
  }

  const rows = [...out.values()];
  const factionsOfRow = groupRows(rows, (r) => `${r.table}#${r.rowId}#${r.kind}#${r.name}`);
  for (const r of rows) {
    const others = new Set((factionsOfRow.get(`${r.table}#${r.rowId}#${r.kind}#${r.name}`) ?? []).map((x) => x.faction));
    others.delete(r.faction);
    r.sharedWith = [...others].sort(cmp);
  }
  rows.sort((a, b) => cmp(a.faction, b.faction) || cmp(ownerKey(a.owner), ownerKey(b.owner)) || cmp(a.kind, b.kind) || cmp(a.slug ?? a.name, b.slug ?? b.name) || cmp(a.key, b.key));
  unowned.sort((a, b) => cmp(a.table, b.table) || cmp(a.rowId, b.rowId));
  return { rows, unowned };
}
