import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { nameToId } from "./converters/id-generator.js";
import { applyWrites, type StagedWrite } from "./mfm/apply.js";
import { REPO_ROOT } from "./mfm/repo-files.js";
import { normModelName } from "./convert-bsdata-wargear.js";
import { JjRevisionTree, parseRevision, resolveLinks } from "./mfm/bsdata-backstop.js";
import { arr, children, constraint, constraints, fixedEquipment, str, type EquipmentAlternative, type JsonNode } from "./bsdata-equipment.js";
import { compositionSizes, errorCountRules, evaluateMaxCap, fitCap, minCap, ruleCap, type CapForm, type CountRule, type SizeCap } from "./bsdata-caps.js";

export type { JsonNode } from "./bsdata-equipment.js";

export interface LoadoutVariant { name: string; weapon_ids: string[]; max_count?: number }
export interface LoadoutVariantBudget { variant_names: string[]; count: number; per_models: number; scope: "unit" | "model-row"; stepped?: boolean }
export interface VariantIssue { unit: string; model_row: string; variant: string; item: string; reason: string }

/**
 * One peer group's whole-model alternatives. `own` are the group's own model
 * peers; `peers` adds the base model when the group is a nested block of
 * alternatives whose plain model sits beside it in the parent (e.g. a "Heavy
 * weapons" group under "4-9 Purifiers" holding "Purifier").
 */
export interface PeerFamily { group: JsonNode; own: JsonNode[]; peers: JsonNode[] }

export function collectPeerFamilies(unit: JsonNode, sourceNodes: ReadonlyMap<string, JsonNode> = new Map()): PeerFamily[] {
  const found: PeerFamily[] = [];
  // A model placed by a link to a shared entry (Catachan Jungle Fighters' plain
  // trooper) is the target model under the link's own id, name and limits.
  // Each link resolves once, so a peer keeps its identity across lookups.
  const linked = new Map<JsonNode, JsonNode | undefined>();
  const linkedModel = (link: JsonNode): JsonNode | undefined => {
    if (!linked.has(link)) {
      const target = sourceNodes.get(str(link.targetId) ?? "");
      linked.set(link, target?.type === "model"
        ? {
            ...target,
            id: link.id,
            name: str(link.name) ?? target.name,
            constraints: [...arr(link.constraints), ...arr(target.constraints)],
            modifiers: [...arr(link.modifiers), ...arr(target.modifiers)],
          }
        : undefined);
    }
    return linked.get(link);
  };
  const models = (node: JsonNode): JsonNode[] => [
    ...arr(node.selectionEntries).filter((entry) => entry.type === "model"),
    ...arr(node.entryLinks).map(linkedModel).filter((entry): entry is JsonNode => !!entry),
  ];
  const isPeerGroup = (node: JsonNode): boolean => {
    const peers = models(node);
    const sameModel = new Set(peers.map((entry) => normModelName(str(entry.name) ?? ""))).size === 1;
    const allOptional = peers.every((entry) => (constraint(entry, "min") ?? 0) === 0);
    return peers.length >= 2 && (sameModel || allOptional);
  };
  const claimed = new Set<JsonNode>();
  const visit = (node: JsonNode, parent?: JsonNode): void => {
    if (isPeerGroup(node)) {
      const own = models(node);
      const names = new Set(own.map((entry) => normModelName(str(entry.name) ?? "")));
      // A base model joins only the first alternatives block beside it.
      const siblings = parent && !isPeerGroup(parent) && names.size === 1
        ? models(parent).filter((entry) => !claimed.has(entry) && names.has(normModelName(str(entry.name) ?? "")) && !own.some((peer) => str(peer.name) === str(entry.name)))
        : [];
      for (const sibling of siblings) claimed.add(sibling);
      found.push({ group: node, own, peers: [...siblings, ...own] });
    }
    for (const child of [...arr(node.selectionEntries), ...arr(node.selectionEntryGroups)]) visit(child, node);
  };
  visit(unit);
  return found;
}

export function collectPeerGroups(unit: JsonNode, sourceNodes: ReadonlyMap<string, JsonNode> = new Map()): JsonNode[] {
  return collectPeerFamilies(unit, sourceNodes).map((family) => family.group);
}

function externalId(entity: JsonNode): string | undefined {
  return arr(entity.external_refs).find((ref) => ref.namespace === "bsdata")?.id as string | undefined;
}

/**
 * BSData equipment names that differ from the MFM name a repo id is minted
 * from, by repo unit: BSData name → the datasheet's MFM item name. Each MFM
 * name is the only dump item on that datasheet the BSData entry can mean.
 */
export const BSDATA_EQUIPMENT_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "acolyte-hybrids-with-hand-flamers": { "Demolition charge": "Demolition charges" },
  "corsair-skyreavers": { "Corsair blaster": "Blaster" },
  "corsair-voidscarred": { "Corsair blaster": "Blaster", "Corsair shredder": "Shredder" },
  "cthonian-beserks": { "Twin concussion gauntlets": "Twin concussion gauntlet" },
  "death-korps-of-krieg": { "Death Korps of Krieg Medi-pack": "Death Korps Medi-pack" },
  "deathwatch-veterans": { "Astartes shield": "Storm Shield", "Deathwatch thunder hammer": "Heavy Thunder Hammer" },
  "fortis-kill-team": {
    "Astartes grenade launcher": "Grenade Launcher",
    "Superfrag missile launcher": "Superfrag Rocket Launcher",
    "Superkrak missile launcher": "Superkrak Rocket Launcher",
  },
  "hernkyn-pioneers": { "Pan-spectral scanner": "Panspectral Scanner" },
  "sisters-novitiate-squad": { "Novitiate autogun": "Autogun", "Novitiate melee weapon": "Novitiate melee weapons" },
  "thunderwolf-cavalry": { "Crushing teeth and claws": "Teeth and Claws" },
};

export function makeEquipmentResolver(entities: JsonNode[], unitId: string, factionUnitIds: readonly string[] = []): (link: JsonNode) => string | undefined {
  const byExternal = new Map<string, string[]>();
  for (const entity of entities) {
    const sourceId = externalId(entity);
    const entityId = str(entity.id);
    if (sourceId && entityId) byExternal.set(sourceId, [...(byExternal.get(sourceId) ?? []), entityId]);
  }
  const ids = new Set(entities.map((entity) => str(entity.id)).filter((id): id is string => !!id));
  const owner = (id: string): string | undefined => factionUnitIds
    .filter((candidate) => id.endsWith(`-${candidate}`))
    .sort((left, right) => right.length - left.length)[0];
  return (link) => {
    const sourceId = str(link.targetId) ?? str(link.id);
    const exactCandidates = sourceId ? byExternal.get(sourceId) ?? [] : [];
    const exact = exactCandidates.find((id) => owner(id) === unitId)
      ?? exactCandidates.find((id) => owner(id) === undefined);
    if (exact) return exact;
    const sourceName = str(link.name);
    if (!sourceName) return undefined;
    // BSData joins a combined profile's parts with "&" where the MFM name says "and".
    const name = (BSDATA_EQUIPMENT_NAMES[unitId]?.[sourceName] ?? sourceName).replace(/\s*&\s*/g, " and ");
    let slug: string;
    try { slug = nameToId(name); } catch { return undefined; }
    if (ids.has(`${slug}-${unitId}`)) return `${slug}-${unitId}`;
    return ids.has(slug) && owner(slug) === undefined ? slug : undefined;
  };
}

export function projectBudget(group: JsonNode, names: string[]): LoadoutVariantBudget | undefined {
  const count = constraint(group, "max");
  if (!count || names.length < 2) return undefined;
  const increments = arr(group.modifiers).filter((m) => m.type === "increment" && typeof m.value === "number");
  if (!increments.length) return { variant_names: names, count, per_models: 0, scope: "model-row" };
  if (increments.length !== 1 || increments[0].value !== count) return undefined;
  const condition = arr(increments[0].conditions)[0];
  const threshold = condition?.value;
  if (condition?.type !== "atLeast" || condition?.childId !== "model" || typeof threshold !== "number") return undefined;
  const perModels = threshold / 2;
  if (!Number.isInteger(perModels) || perModels < count) return undefined;
  return { variant_names: names, count, per_models: perModels, scope: "unit" };
}

/** A source cap as budget forms; `fallback` when the static `max` stands in for a cap no form reproduces. */
interface ProjectedCap { forms: CapForm[]; fallback: boolean; pooledWith: string[] }

const isWideScope = (c: JsonNode): boolean => c.scope !== undefined && c.scope !== "parent" && c.scope !== "self";

/**
 * A node's `max`, narrowed by structured count rules on the node itself,
 * evaluated at every legal unit size and projected onto budget forms. When the
 * cap depends on something other than the model count, or no flat/ratio form
 * reproduces it exactly, the static `max` stands.
 */
function projectCap(node: JsonNode, sizes: readonly number[], rules: readonly CountRule[], accept: (c: JsonNode) => boolean = () => true): ProjectedCap | undefined {
  const staticMax = arr(node.constraints).find((c) => c.type === "max" && c.field === "selections" && typeof c.value === "number" && accept(c))?.value as number | undefined;
  const id = str(node.id);
  const rule = id ? ruleCap(rules, id, sizes) : undefined;
  if (staticMax === undefined && !rule) return undefined;
  const fallback = (pooledWith: string[] = []): ProjectedCap | undefined =>
    staticMax ? { forms: [{ count: staticMax, per_models: 0 }], fallback: true, pooledWith } : undefined;
  const evaluated = staticMax === undefined ? undefined : evaluateMaxCap(node, sizes, accept);
  if (staticMax !== undefined && !evaluated) return fallback();
  const forms = sizes.length ? fitCap(minCap(sizes, evaluated?.cap, rule)) : undefined;
  return forms ? { forms, fallback: false, pooledWith: evaluated?.pooledWith ?? [] } : fallback(evaluated?.pooledWith);
}

const flatOf = (forms: readonly CapForm[]): number | undefined => forms.find((form) => form.per_models === 0)?.count;
const ratiosOf = (forms: readonly CapForm[]): CapForm[] => forms.filter((form) => form.per_models > 0);
const budgetsFor = (names: string[], forms: readonly CapForm[]): LoadoutVariantBudget[] =>
  forms.map((form) => ({
    variant_names: names,
    count: form.count,
    per_models: form.per_models,
    scope: form.per_models === 0 ? "model-row" : "unit",
    ...(form.stepped ? { stepped: true } : {}),
  }));

/** Copies of source entry `target` in one alternative's equipment. */
const copiesOf = (links: readonly JsonNode[], target: string): number =>
  links.filter((link) => str(link.targetId) === target || str(link.id) === target).length;

export function projectUnit(
  unit: JsonNode,
  rows: JsonNode[],
  equipment: JsonNode[],
  unitId: string,
  factionUnitIds: readonly string[] = [],
  sourceNodes: ReadonlyMap<string, JsonNode> = new Map(),
  sizes: readonly number[] = compositionSizes({ models: rows }),
  notes: string[] = [],
  previous: readonly JsonNode[] = [],
  wargearBudgets: readonly JsonNode[] = [],
  wargearOptions?: readonly JsonNode[],
): VariantIssue[] {
  const issues: VariantIssue[] = [];
  const resolve = makeEquipmentResolver(equipment, unitId, factionUnitIds);
  // Repo wargear (no weapon profiles): an upgrade resolving to one is equipment even when its own profile is an ability.
  const wargearIds = new Set(equipment.filter((entity) => !Array.isArray(entity.profiles)).map((entity) => str(entity.id)).filter((id): id is string => !!id));
  interface Bucket {
    rowName: string;
    variants: LoadoutVariant[];
    budgets: LoadoutVariantBudget[];
    /** Families that declare each variant name. */
    sources: Map<string, Set<number>>;
    /** Group-level budgets with the family whose constraint they project. */
    groupBudgets: { budget: LoadoutVariantBudget; family: number }[];
    /** Each variant's source equipment, for count rules on equipment entries. */
    links: Map<string, JsonNode[]>;
    /** Variant names by source peer id, and peer pools to resolve against them. */
    peerNames: Map<string, string[]>;
    pools: { names: string[]; with: string[]; forms: CapForm[] }[];
    /** Per variant, its cap in each fixed-size tier block (row count → max); `undefined` once any copy is unsized or uncapped. */
    blockCaps: Map<string, Map<number, number> | undefined>;
  }
  const rules: CountRule[] = [];
  const ruleSources = new Set<JsonNode>();
  const addRules = (node: JsonNode | undefined): void => {
    if (!node || ruleSources.has(node)) return;
    ruleSources.add(node);
    rules.push(...errorCountRules(node));
  };
  const walkRules = (node: JsonNode): void => { addRules(node); for (const child of children(node)) walkRules(child); };
  walkRules(unit);
  // Committed caps stand in for a size-dependent source cap no budget form
  // reproduces, so a projection never loosens what is already enforced.
  const previousRow = (rowName: string): JsonNode | undefined =>
    previous.find((row) => normModelName(str(row.name) ?? "") === normModelName(rowName));
  const previousMax = (rowName: string, names: readonly string[]): number | undefined =>
    arr(previousRow(rowName)?.loadout_variants).filter((v) => names.includes(str(v.name) ?? "")).map((v) => v.max_count).find((n): n is number => typeof n === "number");
  const previousBudgets = (rowName: string, names: readonly string[]): LoadoutVariantBudget[] =>
    arr(previousRow(rowName)?.loadout_variant_budgets)
      .filter((b) => Array.isArray(b.variant_names) && b.variant_names.length && b.variant_names.every((name) => names.includes(name)))
      .map((b) => structuredClone(b) as unknown as LoadoutVariantBudget);
  const covered = (items: readonly string[]): boolean =>
    wargearBudgets.some((budget) => Array.isArray(budget.items) && budget.items.some((item) => typeof item === "string" && items.includes(item)));
  // An MFM wargear option whose branches include both this choice and a budgeted
  // pick is one dump menu: the dump's limited set owns its duplicate limits even
  // where the summed budget leaves the item out because another model type also
  // takes it (the Aspiring Champion's own plasma pistol).
  const sameItems = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]);
  const menuGoverned = (rowBase: string, items: readonly string[]): boolean =>
    (wargearOptions ?? []).some((option) => {
      const modelName = str((option.model_constraint as JsonNode | null | undefined)?.model_name);
      if (modelName && normModelName(modelName) !== rowBase) return false;
      const branches = (Array.isArray(option.replacement_choice) ? option.replacement_choice : [])
        .filter((branch): branch is string[] => Array.isArray(branch) && branch.every((id) => typeof id === "string"));
      return branches.some((branch) => sameItems(branch, items)) && branches.some((branch) => !sameItems(branch, items) && covered(branch));
    });
  const noted = (what: string): void => { if (!notes.includes(`${unitId}: ${what}`)) notes.push(`${unitId}: ${what}`); };
  const families = collectPeerFamilies(unit, sourceNodes);
  const peerIds = new Set(families.flatMap((family) => family.peers.map((peer) => str(peer.id)).filter((id): id is string => !!id)));
  const grouped = new Map<string, Bucket>();
  const incompleteRows = new Set<string>();
  for (const [familyIndex, family] of families.entries()) {
    const { group, peers } = family;
    const ownNames: string[] = [];
    const base = normModelName(str(peers[0]?.name) ?? "");
    const projected = { rowName: str(peers[0]?.name) ?? "", variants: [] as LoadoutVariant[], budgets: [] as LoadoutVariantBudget[] };
    const links = new Map<string, JsonNode[]>();
    const peerNames = new Map<string, string[]>();
    const pools: Bucket["pools"] = [];
    let complete = true;
    for (const peer of peers) {
      const name = str(peer.name) ?? "unnamed";
      const fixed = fixedEquipment(peer, sourceNodes, (entry) => wargearIds.has(resolve(entry) ?? ""));
      if (fixed.reason) {
        issues.push({ unit: unitId, model_row: base, variant: name, item: fixed.item ?? "(no fixed equipment)", reason: fixed.reason });
        complete = false;
        continue;
      }
      for (const alternative of fixed.alternatives) for (const link of alternative.links) addRules(sourceNodes.get(str(link.targetId) ?? ""));
      let peerCap = projectCap(peer, sizes, rules);
      if (peerCap?.fallback && arr(peer.modifiers).length) {
        const kept = previousMax(projected.rowName, [name]);
        if (kept) peerCap = { ...peerCap, forms: [{ count: kept, per_models: 0 }] };
        noted(`${name}: size-dependent cap kept at its ${kept ? "committed" : "static"} ${flatOf(peerCap.forms)}`);
      }
      const splitNames: string[] = [];
      // What one alternative fields beyond what every alternative of the peer fields.
      const resolvedIds = fixed.alternatives.map((alternative) => new Set(alternative.links.map(resolve).filter((id): id is string => !!id)));
      const sharedIds = resolvedIds.length ? [...resolvedIds[0]].filter((id) => resolvedIds.every((ids) => ids.has(id))) : [];
      for (const alternative of fixed.alternatives) {
        const variantName = alternative.labels.length ? `${name} (${alternative.labels.join(", ")})` : name;
        const ids = alternative.links.map(resolve);
        const unresolved = ids.findIndex((id) => !id);
        if (unresolved >= 0 || ids.length === 0) {
          issues.push({ unit: unitId, model_row: base, variant: variantName, item: str(alternative.links[unresolved]?.name) ?? "(no fixed equipment)", reason: "unresolved equipment" });
          complete = false;
          continue;
        }
        // A unit-scoped cap on one choice limits duplicates of that choice. The
        // MFM wargear budgets own duplicate limits (`duplicate_limit`) for the
        // items they cover, so such a cap stands only where no budget covers what
        // the choice adds.
        const added = (ids as string[]).filter((id) => !sharedIds.includes(id));
        const budgeted = added.length > 0 && (covered(added) || menuGoverned(base, added));
        const choiceCaps = budgeted ? [] : alternative.choices.map((choice) => projectCap(choice, sizes, rules, isWideScope)).filter((cap): cap is ProjectedCap => !!cap);
        const flats = [...choiceCaps, ...(peerCap ? [peerCap] : [])].map((cap) => flatOf(cap.forms)).filter((n): n is number => n !== undefined);
        const max = flats.length ? Math.min(...flats) : undefined;
        const variant = { name: variantName, weapon_ids: ids as string[], ...(max ? { max_count: max } : {}) };
        for (const cap of choiceCaps) projected.budgets.push(...budgetsFor([variantName], ratiosOf(cap.forms)));
        splitNames.push(variantName);
        links.set(variantName, alternative.links);
        if (family.own.includes(peer) && !ownNames.includes(variantName)) ownNames.push(variantName);
        const existing = projected.variants.find((item) => item.name === variantName);
        if (!existing) projected.variants.push(variant);
        else if (sameItems(existing.weapon_ids, variant.weapon_ids)) {
          const mergedMax = Math.max(existing.max_count ?? 0, variant.max_count ?? 0);
          if (mergedMax > 0) existing.max_count = mergedMax;
        } else {
          issues.push({ unit: unitId, model_row: base, variant: variantName, item: variantName, reason: "conflicting duplicate variant" });
          complete = false;
        }
      }
      if (str(peer.id)) peerNames.set(str(peer.id)!, splitNames);
      if (!peerCap) continue;
      // A peer split by its equipment choice is still one peer: its cap pools
      // across every split rather than applying to each. A ratio cap binds the
      // peer even when it is not split.
      projected.budgets.push(...budgetsFor(splitNames, splitNames.length > 1 ? peerCap.forms : ratiosOf(peerCap.forms)));
      if (peerCap.pooledWith.length) pools.push({ names: splitNames, with: peerCap.pooledWith, forms: peerCap.forms });
    }
    if (!complete) {
      incompleteRows.add(base);
      continue;
    }
    const bucket: Bucket = grouped.get(base)
      ?? { rowName: projected.rowName, variants: [], budgets: [], sources: new Map(), groupBudgets: [], links: new Map(), peerNames: new Map(), pools: [], blockCaps: new Map() };
    const blockSize = constraint(group, "min") === constraint(group, "max") ? constraint(group, "min") : undefined;
    if (ownNames.length >= 2) {
      const groupCap = projectCap(group, sizes, rules);
      let groupBudgets = groupCap && !groupCap.fallback ? budgetsFor(ownNames, groupCap.forms) : [projectBudget(group, ownNames)].filter((b): b is LoadoutVariantBudget => !!b);
      if (groupCap?.fallback && arr(group.modifiers).some((m) => m.field !== "error")) {
        const kept = previousBudgets(projected.rowName, ownNames);
        if (kept.length) groupBudgets = kept;
        noted(`${str(group.name) ?? "peer group"}: size-dependent cap kept at its ${kept.length ? "committed" : "static"} value`);
      }
      // One pick of a group whose peers are each required (a missile-launcher
      // weapons team: the gunner and the loader) fields every one of them.
      const fielded = family.own.reduce((sum, peer) => sum + (constraint(peer, "min") ?? 0), 0);
      if (family.own.every((peer) => (constraint(peer, "min") ?? 0) > 0)) groupBudgets = groupBudgets.map((budget) => ({ ...budget, count: budget.count * fielded }));
      for (const budget of groupBudgets) bucket.groupBudgets.push({ budget, family: familyIndex });
    }
    for (const [name, value] of links) bucket.links.set(name, value);
    for (const [id, names] of peerNames) bucket.peerNames.set(id, names);
    bucket.pools.push(...pools);
    for (const variant of projected.variants) {
      bucket.sources.set(variant.name, new Set([...(bucket.sources.get(variant.name) ?? []), familyIndex]));
      const blocks = bucket.blockCaps.has(variant.name) ? bucket.blockCaps.get(variant.name) : new Map<number, number>();
      const sized = blocks && blockSize !== undefined && variant.max_count !== undefined && !(blocks.has(blockSize) && blocks.get(blockSize) !== variant.max_count);
      bucket.blockCaps.set(variant.name, sized ? blocks.set(blockSize, variant.max_count!) : undefined);
      const existing = bucket.variants.find((item) => item.name === variant.name);
      if (!existing) bucket.variants.push(variant);
      else if (sameItems(existing.weapon_ids, variant.weapon_ids)) {
        // A same-named peer may recur across families (tier blocks, a default
        // pick inside a nested slot); the merged variant keeps the larger
        // ceiling, and an uncapped copy leaves it uncapped.
        if (existing.max_count === undefined || variant.max_count === undefined) delete existing.max_count;
        else existing.max_count = Math.max(existing.max_count, variant.max_count);
      } else {
        issues.push({ unit: unitId, model_row: base, variant: variant.name, item: variant.name, reason: "conflicting duplicate variant" });
        incompleteRows.add(base);
      }
    }
    bucket.budgets.push(...projected.budgets);
    grouped.set(base, bucket);
  }
  const targets = [...new Set(rules.map((rule) => rule.target))].filter((target) => !peerIds.has(target));
  // The MFM rows' defaults and the unit's option items are everything the dump
  // lets the unit carry; without the options or recorded defaults there is no
  // inventory to hold a projection to.
  const itemIds = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(itemIds) : [];
  const dumpItems = wargearOptions && rows.some((row) => Array.isArray(row.default_weapon_ids))
    ? new Set([
      ...rows.flatMap((row) => itemIds(row.default_weapon_ids)),
      ...wargearOptions.flatMap((option) => [...itemIds(option.replaces), ...itemIds(option.replacement), ...itemIds(option.replacement_choice)]),
    ])
    : undefined;
  for (const [base, projected] of grouped) {
    if (incompleteRows.has(base) || !projected.variants.length) continue;
    const row = rows.find((candidate) => str(candidate.name)?.toLocaleLowerCase("en") === projected.rowName.toLocaleLowerCase("en"))
      ?? rows.find((candidate) => normModelName(str(candidate.name) ?? "") === normModelName(projected.rowName));
    if (!row) continue;
    // Same-named rows each record their own default loadout (a miniature the MFM pass split
    // by default group); whole-loadout variants for the name cannot belong to one of them.
    if (rows.filter((candidate) => str(candidate.name) === str(row.name)).length > 1) continue;
    // A variant carrying an item the dump never gives the unit is a loadout the
    // live game does not offer (or a source name resolving to the wrong item),
    // so the row keeps its committed variants.
    const offDump = [...new Set(projected.variants.flatMap((variant) => variant.weapon_ids))].filter((id) => dumpItems && !dumpItems.has(id));
    // Every model of a full row can keep the MFM default loadout, so some
    // variant must carry exactly those items with room for the whole row.
    const defaults = Array.isArray(row.default_weapon_ids) ? itemIds(row.default_weapon_ids) : undefined;
    const rowMax = typeof row.max === "number" ? row.max : 0;
    const holdsDefault = !defaults || projected.variants.some((variant) =>
      sameItems(variant.weapon_ids, defaults) && (variant.max_count === undefined || variant.max_count >= rowMax));
    // A peer named for another MFM row (a Soul Weaver beside a Shade Runner) is
    // that row's model, not an alternative loadout of this one.
    const ownRowOf = projected.variants.map((variant) => variant.name)
      .filter((name) => rows.some((other) => other !== row && normModelName(str(other.name) ?? "") === normModelName(name)));
    const refusal = offDump.length ? `${offDump.join(", ")} not in the unit's MFM wargear`
      : !holdsDefault ? "no variant holds the MFM default loadout for the full row"
      : ownRowOf.length ? `${ownRowOf.join(", ")} named for another MFM row`
      : undefined;
    if (refusal) {
      noted(`${str(row.name)}: not projected: ${refusal}`);
      continue;
    }
    // A group's cap counts only the selections made through that group. A
    // variant another family also declares is indistinguishable once merged,
    // so the group cap cannot charge it.
    for (const { budget, family } of projected.groupBudgets) {
      const names = budget.variant_names.filter((name) => [...(projected.sources.get(name) ?? [])].every((source) => source === family));
      if (names.length) projected.budgets.push({ ...budget, variant_names: names });
    }
    // A variant whose tier blocks cap it differently (Krieg vox-casters: 1 of
    // 9 troopers, 2 of 18) keeps the larger ceiling as its max_count; the
    // row's own model count scales it back down in the smaller block.
    for (const [name, blocks] of projected.blockCaps) {
      if (!blocks || blocks.size < 2 || new Set(blocks.values()).size < 2) continue;
      if ([...blocks].every(([size, max]) => max >= size)) continue;
      const forms = fitCap(blocks);
      if (!forms) { noted(`${name}: tier-block caps not projected: no flat or ratio form reproduces them`); continue; }
      projected.budgets.push(...forms.map((form) => ({ variant_names: [name], count: form.count, per_models: form.per_models, scope: "model-row" as const, ...(form.stepped ? { stepped: true } : {}) })));
    }
    // A peer whose cap the source lowers per selection of other peers shares
    // that cap with them.
    for (const pool of projected.pools) {
      const names = [...pool.names, ...pool.with.flatMap((id) => projected.peerNames.get(id) ?? [])];
      if (names.length > pool.names.length) projected.budgets.push(...budgetsFor([...new Set(names)], pool.forms));
    }
    // A structured count limit on an equipment entry caps the variants that carry it.
    for (const target of targets) {
      const carrying = [...projected.links].filter(([, value]) => copiesOf(value, target) > 0);
      if (!carrying.length) continue;
      const label = `${str(sourceNodes.get(target)?.name) ?? target} count limit`;
      if (carrying.some(([, value]) => copiesOf(value, target) > 1)) { noted(`${label} not projected: a variant carries several copies`); continue; }
      const forms = fitCap(ruleCap(rules, target, sizes) ?? new Map());
      if (!forms) { noted(`${label} not projected: no flat or ratio form reproduces it`); continue; }
      projected.budgets.push(...budgetsFor(carrying.map(([name]) => name), forms));
    }
    const unique = new Map<string, LoadoutVariantBudget>();
    for (const budget of projected.budgets) {
      const key = JSON.stringify({ ...budget, variant_names: [...budget.variant_names].sort() });
      if (!unique.has(key)) unique.set(key, budget);
    }
    row.loadout_variants = projected.variants;
    if (unique.size) row.loadout_variant_budgets = [...unique.values()];
    else delete row.loadout_variant_budgets;
  }
  return issues;
}

function walk(root: JsonNode, visitor: (node: JsonNode) => void): void { visitor(root); for (const child of children(root)) walk(child, visitor); }
export function collectSourceNodes(catalogues: JsonNode[]): Map<string, JsonNode> {
  const nodes = new Map<string, JsonNode>();
  for (const doc of catalogues) {
    walk((doc.catalogue ?? doc.gameSystem) as JsonNode, (node) => {
      const id = str(node.id);
      if (id) nodes.set(id, node);
    });
  }
  return nodes;
}
function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, "utf8")); }

export function prepareFactionProjection(
  units: JsonNode[],
  compositions: JsonNode[],
  equipment: JsonNode[],
  sourceNodes: ReadonlyMap<string, JsonNode>,
  wargearOptions: readonly JsonNode[] = [],
): { compositions: JsonNode[]; issues: VariantIssue[]; notes: string[]; discoveredUnits: number; discoveredVariants: number; projectedUnits: number; projectedVariants: number } {
  const projected = structuredClone(compositions);
  for (const composition of projected) {
    for (const row of arr(composition.models)) {
      delete row.loadout_variants;
      delete row.loadout_variant_budgets;
    }
  }

  const issues: VariantIssue[] = [];
  const notes: string[] = [];
  let discoveredUnits = 0;
  let discoveredVariants = 0;
  let projectedUnits = 0;
  let projectedVariants = 0;
  const factionUnitIds = units.map((item) => str(item.id)).filter((id): id is string => !!id);
  for (const repoUnit of units) {
    const sourceId = externalId(repoUnit);
    const source = sourceId ? sourceNodes.get(sourceId) : undefined;
    const composition = projected.find((item) => item.unit_id === repoUnit.id);
    if (!source || !composition) continue;
    const rows = arr(composition.models);
    const peerFamilies = collectPeerFamilies(source, sourceNodes).filter((family) =>
      rows.some((row) => normModelName(str(row.name) ?? "") === normModelName(str(family.own[0]?.name) ?? "")));
    const sourceVariantCount = peerFamilies.reduce((sum, family) => sum + family.own.length, 0);
    if (sourceVariantCount > 0) discoveredUnits += 1;
    discoveredVariants += sourceVariantCount;
    const committed = arr(compositions.find((item) => item.unit_id === repoUnit.id)?.models);
    issues.push(...projectUnit(source, rows, equipment, str(repoUnit.id)!, factionUnitIds, sourceNodes, compositionSizes(composition), notes, committed, arr(repoUnit.wargear_budgets), wargearOptions.filter((option) => option.unit_id === repoUnit.id)));
    const variantCount = rows.reduce((sum, row) => sum + arr(row.loadout_variants).length, 0);
    if (variantCount > 0) projectedUnits += 1;
    projectedVariants += variantCount;
  }
  // A row the source no longer projects onto (its peers renamed or removed
  // upstream, or a projection refused) keeps its committed variants.
  for (const [unitIndex, composition] of projected.entries()) {
    const committed = arr(compositions[unitIndex]?.models);
    for (const [index, row] of arr(composition.models).entries()) {
      const kept = committed[index];
      if (row.loadout_variants !== undefined || !kept?.loadout_variants) continue;
      row.loadout_variants = structuredClone(kept.loadout_variants);
      if (kept.loadout_variant_budgets) row.loadout_variant_budgets = structuredClone(kept.loadout_variant_budgets);
      notes.push(`${str(composition.unit_id)}: ${str(row.name)}: committed variants kept; no source projection replaces them`);
    }
  }
  return { compositions: projected, issues, notes, discoveredUnits, discoveredVariants, projectedUnits, projectedVariants };
}

export async function run(argv: readonly string[]): Promise<void> {
  const cmd = new Command().option("--bsdata <path>", "11e BSData directory", path.join(REPO_ROOT, "_private", "bsdata-wh40k-11e")).option("--source-ref <rev>").option("--faction <id>").option("--write").exitOverride();
  cmd.parse(argv, { from: "user" });
  const opts = cmd.opts<{ bsdata: string; sourceRef?: string; faction?: string; write?: boolean }>();
  const core = path.join(REPO_ROOT, "data", "core");
  const factions = opts.faction ? [opts.faction] : fs.readdirSync(core).filter((name) => fs.existsSync(path.join(core, name, "units.json")));
  let catalogues: JsonNode[];
  if (opts.sourceRef) {
    const tree = new JjRevisionTree(opts.bsdata);
    const revision = tree.resolveRevision(opts.sourceRef);
    const parsed = parseRevision(tree, revision);
    resolveLinks(parsed);
    catalogues = parsed.documents.map((document) => ({ [document.kind === "catalogue" ? "catalogue" : "gameSystem"]: document.root }));
  } else {
    catalogues = fs.readdirSync(opts.bsdata).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(opts.bsdata, name)) as JsonNode);
  }
  const allNodes = collectSourceNodes(catalogues);
  const staged: StagedWrite[] = [];
  let projectedUnits = 0;
  let projectedVariants = 0;
  let discoveredUnits = 0;
  let discoveredVariants = 0;
  let unresolvedVariants = 0;
  for (const faction of factions) {
    const dir = path.join(core, faction);
    const units = readJson(path.join(dir, "units.json")) as JsonNode[];
    const compositionsPath = path.join(dir, "unit-compositions.json");
    if (!fs.existsSync(compositionsPath)) continue;
    const compositions = readJson(compositionsPath) as JsonNode[];
    const equipment = ["weapons.json", "wargear.json"].flatMap((file) => fs.existsSync(path.join(dir, file)) ? readJson(path.join(dir, file)) as JsonNode[] : []);
    const optionsPath = path.join(dir, "wargear-options.json");
    const wargearOptions = fs.existsSync(optionsPath) ? readJson(optionsPath) as JsonNode[] : [];
    const projection = prepareFactionProjection(units, compositions, equipment, allNodes, wargearOptions);
    discoveredUnits += projection.discoveredUnits;
    discoveredVariants += projection.discoveredVariants;
    projectedUnits += projection.projectedUnits;
    projectedVariants += projection.projectedVariants;
    unresolvedVariants += projection.issues.length;
    for (const note of projection.notes) console.log(`[bsdata-loadout-variants] ${faction}: ${note}`);
    if (projection.issues.length) {
      const detail = projection.issues
        .map((issue) => `${issue.unit}/${issue.model_row}/${issue.variant}: ${issue.item} (${issue.reason})`)
        .join("; ");
      throw new Error(`[bsdata-loadout-variants] ${faction}: refusing incomplete projection; current variants remain unchanged (${detail})`);
    }
    const original = fs.readFileSync(compositionsPath, "utf8");
    const text = `${JSON.stringify(projection.compositions, null, 2)}\n`;
    if (text !== original) staged.push({ path: compositionsPath, value: projection.compositions, text });
    console.log(`[bsdata-loadout-variants] ${faction}: 0 unresolved`);
  }
  console.log(`[bsdata-loadout-variants] discovered ${discoveredVariants} source variants across ${discoveredUnits} units; projected ${projectedVariants} variants across ${projectedUnits} units; ${unresolvedVariants} unresolved`);
  await applyWrites(staged, { write: !!opts.write, label: "bsdata-loadout-variants" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });
