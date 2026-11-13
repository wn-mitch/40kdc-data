/**
 * A unit's MFM loadout (unit-composition `loadout`) as per-model selections,
 * so a roster cannot hold a combination of items no assignment to models
 * gives. Mirrors `checkMfmLoadout`:
 *
 * - Each model row's entry holds one group per slot on that row. A model
 *   takes `picks` choices from each group (a choice at most once unless the
 *   slot repeats); each choice is a whole bundle, an entry holding exactly its
 *   items. A slot without a row is a group on the unit.
 * - A row with alternate slots takes picks from those instead of its other
 *   slots: selecting an alternate choice sets the other groups to zero.
 * - A limit whose choices are single items caps, across its row (or the unit),
 *   the bundles that add those items above the row's default: each such bundle
 *   entry's maximum is the cap less the other such bundles taken, and 0 once
 *   the cap's hidden category counts more than the cap (BattleScribe reads a
 *   maximum of -1 as no limit, so the difference alone stops capping when the
 *   others pass the cap by two). `per_choice` caps each item the same way. The
 *   cap follows the unit's model count.
 * - In a uniform set, taking one main option sets every other main option's
 *   bundles to zero across the row (or unit).
 *
 * Limits with multi-item choices are left to per-item counts; the residual
 * against the package is pinned by `bsdata-export-model-wargear.test.ts`.
 */
import type { MfmItem, MfmLoadoutRules } from "../data/mfm-loadout.js";
import { bareModels, checkboxCaps, copiesOf, limitCap, modelStock, rowSlotChoices, slotChoices } from "../data/mfm-loadout.js";
import { forEachMfmConfiguration, mfmAssignment, MfmSearchTooLarge, type MfmConfiguration } from "../data/mfm-loadout-search.js";
import { mfmBaseLoadout, mfmRows, type MfmComposition } from "../data/mfm-loadout-unit.js";
import type { Unit } from "../generated.js";
import { categoryLink, compact, condition, constraint, cost, entryLink, modifier } from "./nodes.js";
import type { BsNode } from "./source.js";
import type { WargearContext } from "./wargear.js";

interface Row {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

/** A bundle entry: one slot choice on one row (or on the unit). */
interface Choice {
  readonly id: string;
  readonly row: string | null;
  readonly items: readonly MfmItem[];
  /** The slot (index into the rules' slots) the choice belongs to. */
  readonly slot: number;
}

export interface ModelWargear {
  /** Groups for each row model entry, by row index. */
  readonly rowGroups: readonly BsNode[][];
  /** Fixed item links for each row model entry: the template of a row with no slots. */
  readonly rowLinks: readonly BsNode[][];
  /** Models of each row the default unit leaves bare, which may carry nothing. */
  readonly bare: readonly number[];
  /** Fixed item links on the unit entry (a one-model unit's template). */
  readonly unitLinks: readonly BsNode[];
  /** Limits left to per-item counts, as `limit <index>: <reason>`. */
  readonly unencoded: readonly string[];
  /** Groups the unit entry itself holds (unit slots; every slot for a one-model unit). */
  readonly unitGroups: readonly BsNode[];
}

const itemKey = (items: readonly MfmItem[]): string =>
  items
    .map((i) => `${i.id}x${i.count}`)
    .sort()
    .join("+");

/** The MFM row key each composition row answers to: its name, and `name#k` for the k-th row of that name. */
export function rowKeys(rows: readonly Row[]): string[][] {
  return rows.map((row, index) => {
    const ordinal = rows.slice(0, index + 1).filter((r) => r.name === row.name).length;
    return [row.name, `${row.name}#${ordinal}`];
  });
}

function bundleName(ctx: WargearContext, items: readonly MfmItem[]): string {
  if (items.length === 0) return "None";
  return items.map((i) => `${i.count > 1 ? `${i.count}x ` : ""}${ctx.itemEntry(i.id)?.name ?? i.id}`).join(", ");
}

function atLeastModels(ctx: WargearContext, n: number): BsNode {
  return condition({ childId: "model", field: "selections", scope: ctx.entryId, type: "atLeast", value: n, includeChildSelections: true });
}

function fewerModels(ctx: WargearContext, n: number): BsNode {
  return condition({ childId: "model", field: "selections", scope: ctx.entryId, type: "lessThan", value: n, includeChildSelections: true });
}

function inUnit(choiceId: string): { childId: string; field: string; scope: string; value: number; repeats: number; roundUp: boolean; shared: boolean; includeChildSelections: boolean } {
  return { childId: choiceId, field: "selections", scope: "unit", value: 1, repeats: 1, roundUp: false, shared: true, includeChildSelections: true };
}

/** A shared cap's piece on one member: its maximum, the modifiers on it, and its link to the cap's category. */
interface CapPiece {
  readonly constraint: BsNode;
  readonly modifiers: BsNode[];
  readonly categoryLink?: BsNode;
}

/**
 * A shared cap over `members` (choice entries) across the unit: on each, a
 * maximum of the cap at each model count, decremented once per selection of
 * every other member, then set to 0 while the members together pass the cap.
 * The members share a hidden category so a condition can count them together.
 */
function sharedCap(
  ctx: WargearContext,
  key: string,
  members: readonly Choice[],
  capAt: (n: number) => number,
  counts: readonly number[],
  scope: "unit" | "parent" = "unit",
): Map<string, CapPiece> {
  const out = new Map<string, CapPiece>();
  const category = members.length > 1 ? ctx.capCategory(key) : undefined;
  // Model-count spans sharing one cap, in order: [first, last, cap].
  const spans: [number, number, number][] = [];
  for (const n of counts) {
    const cap = capAt(n);
    const span = spans[spans.length - 1];
    if (span && span[2] === cap) span[1] = n;
    else spans.push([n, n, cap]);
  }
  for (const member of members) {
    const id = ctx.ids.id(`${key}:${member.id}`);
    const modifiers: BsNode[] = spans.slice(1).map(([n, , cap]) => modifier({ field: id, type: "set", value: cap, conditions: [atLeastModels(ctx, n)] }));
    for (const other of members) {
      if (other.id === member.id) continue;
      modifiers.push({ type: "decrement", field: id, value: 1, repeats: [{ ...inUnit(other.id), scope }] });
    }
    if (category) {
      for (const [first, last, cap] of spans) {
        const conditions = [
          condition({ childId: category.id, field: "selections", scope, type: "atLeast", value: cap + 1, includeChildSelections: true }),
          ...(first > counts[0] ? [atLeastModels(ctx, first)] : []),
          ...(last < counts[counts.length - 1] ? [fewerModels(ctx, last + 1)] : []),
        ];
        modifiers.push(modifier({ field: id, type: "set", value: 0, conditions }));
      }
    }
    out.set(member.id, {
      constraint: constraint({ id, type: "max", value: capAt(counts[0]), field: "selections", scope, includeChildSelections: true }),
      modifiers,
      categoryLink: category ? categoryLink(category.name, ctx.ids.id(`${key}:${member.id}:category`), category.id, false) : undefined,
    });
  }
  return out;
}

/** Configurations the starting-loadout search visits before giving up. */
const START_SEARCH_LIMIT = 2000;

/**
 * The loadout a unit of `modelCount` models starts on: the package's base loadout when each row's
 * models carry one bundle in it, else the first legal configuration that does. Keyed by row model,
 * `undefined` for the unit's own wargear. Null when the size has no such configuration.
 */
export function startingBundles(composition: MfmComposition, modelCount: number): Map<string | undefined, MfmItem[]> | null {
  const rules = composition.loadout;
  const rows = rules ? mfmRows(composition, modelCount) : null;
  if (!rules || !rows) return null;
  const uniform = (c: MfmConfiguration) => new Set(c.groups.map((g) => g.model)).size === c.groups.length;
  let found: MfmConfiguration | null = null;
  try {
    const base = mfmBaseLoadout(rules, rows);
    const assigned = base?.legal ? mfmAssignment(rules, rows, base.counts) : null;
    if (assigned && uniform(assigned)) found = assigned;
    let visited = 0;
    if (!found) {
      forEachMfmConfiguration(rules, rows, (c) => {
        visited += 1;
        if (uniform(c)) found = c;
        return found !== null || visited >= START_SEARCH_LIMIT;
      });
    }
  } catch (error) {
    if (!(error instanceof MfmSearchTooLarge)) throw error;
  }
  if (!found) return null;
  const chosen: MfmConfiguration = found;
  return new Map<string | undefined, MfmItem[]>([...chosen.groups.map((g) => [g.model, g.items] as [string, MfmItem[]]), [undefined, chosen.unit]]);
}

/**
 * Each non-alternate slot's starting choice (an index into `expanded[s]`), drawn from the starting
 * bundles: a slot takes the largest choice its row's remaining bundle holds. A row whose bundle the
 * slots do not use up exactly gets none.
 */
function startingChoices(rules: MfmLoadoutRules, expanded: readonly (readonly MfmItem[])[][], bundles: ReadonlyMap<string | undefined, MfmItem[]>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [model, items] of bundles) {
    const left = copiesOf(items);
    const picked = new Map<number, number>();
    let mixed = false;
    for (const [s, slot] of rules.slots.entries()) {
      if (slot.model !== model || slot.alternate) continue;
      for (let k = 0; k < slot.picks; k += 1) {
        const fits = expanded[s]
          .map((choice, c) => ({ choice, c }))
          .filter(({ choice }) => choice.every((i) => (left.get(i.id) ?? 0) >= i.count))
          .sort((a, b) => b.choice.reduce((n, i) => n + i.count, 0) - a.choice.reduce((n, i) => n + i.count, 0))[0];
        if (!fits) break;
        for (const i of fits.choice) left.set(i.id, left.get(i.id)! - i.count);
        // A group starts on one choice taken `picks` times; a slot that starts on two cannot be stated.
        if (picked.has(s) && picked.get(s) !== fits.c) mixed = true;
        picked.set(s, fits.c);
      }
    }
    // The row's slots must account for its whole bundle, or the starting choices would misstate it.
    const stock = rules.slots.some((slot) => slot.model === model) ? [...left.values()].every((n) => n === 0) : true;
    if (stock && !mixed) for (const [s, c] of picked) out.set(s, c);
  }
  return out;
}

/** The per-model selections for `unit`'s MFM `rules`; `rows` are its composition rows in order. */
export function modelWargear(unit: Unit, ctx: WargearContext, rules: MfmLoadoutRules, rows: readonly Row[], counts: readonly number[], multiModel: boolean): ModelWargear {
  const key = `unit:${unit.faction_id}/${unit.id}:mfm`;
  const keys = rowKeys(rows);
  const surcharge = new Map((unit.wargear_costs ?? []).map((wc) => [wc.item_id, wc.cost]));
  const templates = new Map(rules.templates.map((t) => [t.model, t.items]));
  // An MFM row key names every composition row of that name, or with `#k` the k-th of them.
  const rowsOf = (model: string | undefined): number[] => (model === undefined ? [] : keys.flatMap((k, r) => (k.includes(model) ? [r] : [])));
  /** Choices a row-scoped rule covers: those of `model`'s rows, or every choice when the rule is unit-wide. */
  const inScope = (c: Choice, model: string | undefined): boolean => model === undefined || rowsOf(model).map(String).includes(c.row ?? "");

  // Every choice entry, by slot.
  const unitStock = copiesOf(rules.stock.filter((entry) => entry.model === undefined).flatMap((entry) => entry.items));
  // The package's own expansion: an add-on slot can be left empty, and a stock choice can drop unticked checkbox items.
  const expanded = rules.slots.map((slot) => (slot.model === undefined ? slotChoices(slot, unitStock) : rowSlotChoices(rules, slot, modelStock(rules, slot.model))));
  const composition = ctx.dataset.unitCompositionOf(unit) as MfmComposition | undefined;
  const bundles = composition ? startingBundles(composition, counts[0]) : null;
  const starts = bundles ? startingChoices(rules, expanded, bundles) : new Map<number, number>();
  // Choice entries per slot and row ("unit" for a slot without a row): each row gets its own.
  const choicesBySlot = new Map<string, Choice[]>();
  rules.slots.forEach((slot, s) => {
    for (const row of slot.model === undefined ? [null] : rowsOf(slot.model)) {
      choicesBySlot.set(
        `${s}:${row ?? "unit"}`,
        expanded[s].map((items, c): Choice => ({ id: ctx.ids.id(`${key}:slot:${s}:${row ?? "unit"}:choice:${c}:${itemKey(items)}`), row: row === null ? null : String(row), items, slot: s })),
      );
    }
  });
  const allChoices = [...choicesBySlot.values()].flat();

  // Shared caps from limits and uniform sets, keyed by choice entry id.
  const caps = new Map<string, { constraints: BsNode[]; modifiers: BsNode[]; categoryLinks: BsNode[] }>();
  const addCap = (id: string, piece: CapPiece): void => {
    const slot = caps.get(id) ?? { constraints: [], modifiers: [], categoryLinks: [] };
    slot.constraints.push(piece.constraint);
    slot.modifiers.push(...piece.modifiers);
    if (piece.categoryLink) slot.categoryLinks.push(piece.categoryLink);
    caps.set(id, slot);
  };
  const unencoded: string[] = [];
  rules.limits.forEach((limit, l) => {
    const scoped = allChoices.filter((c) => inScope(c, limit.model));
    // As compileLimit: a choice's stock items are dropped when it holds any other item.
    const stockIds = new Set(
      keys
        .filter((_, r) => limit.model === undefined || rowsOf(limit.model).includes(r))
        .flatMap((k) => k.flatMap((name) => templates.get(name) ?? []))
        .map((i) => i.id),
    );
    const vectors = limit.choices.map((choice) => (choice.some((i) => !stockIds.has(i.id)) ? choice.filter((i) => !stockIds.has(i.id)) : choice));
    // A limit that lists the stock itself counts every copy, not the copies above the default.
    if (!vectors.every((v) => v.length === 1 && v[0].count === 1 && !stockIds.has(v[0].id))) {
      unencoded.push(`limit ${l}: a choice of several items, several copies or stock`);
      return;
    }
    const limited = new Set(vectors.map((v) => v[0].id));
    const weight = (c: Choice): number => c.items.filter((i) => limited.has(i.id)).reduce((n, i) => n + i.count, 0);
    const members = scoped.filter((c) => weight(c) > 0);
    if (members.length === 0 || members.some((c) => weight(c) !== 1)) {
      unencoded.push(`limit ${l}: a bundle adds several limited copies`);
      return;
    }
    for (const [id, piece] of sharedCap(ctx, `${key}:limit:${l}`, members, (n) => limitCap(limit, n).cap, counts)) addCap(id, piece);
    for (const item of limited) {
      const perChoice = (n: number) => limitCap(limit, n).perChoice;
      if (counts.every((n) => perChoice(n) === undefined)) continue;
      const holders = members.filter((c) => c.items.some((i) => i.id === item));
      for (const [id, piece] of sharedCap(ctx, `${key}:limit:${l}:per:${item}`, holders, (n) => perChoice(n) ?? 999, counts)) addCap(id, piece);
    }
  });
  // Checkbox items: a row (or the unit) takes each at most once per checkbox, or its stock copies.
  for (const model of [undefined, ...new Set(rules.options.flatMap((o) => (o.model === undefined ? [] : [o.model])))]) {
    const individual = model !== undefined && rules.stock.some((entry) => entry.model === model && entry.individual === true);
    for (const [item, cap] of checkboxCaps(rules, model)) {
      const members = allChoices.filter((c) => (model === undefined ? c.row === null : inScope(c, model)) && c.items.some((i) => i.id === item));
      if (members.length === 0) continue;
      const weight = (c: Choice) => c.items.filter((i) => i.id === item).reduce((n, i) => n + i.count, 0);
      // A bundle holding more copies than the cap can never be taken.
      for (const c of members.filter((m) => weight(m) > cap)) {
        addCap(c.id, { constraint: constraint({ id: ctx.ids.id(`${key}:checkbox:${model ?? "unit"}:${item}:${c.id}:never`), type: "max", value: 0, field: "selections", scope: "parent" }), modifiers: [] });
      }
      const takeable = members.filter((m) => weight(m) <= cap);
      // The most copies the takeable bundles can add in the cap's scope: each group (slot on a row)
      // gives at most its picks per model, over the row's most models (one model when individual).
      const groups = new Map<string, number>();
      for (const c of takeable) {
        const at = `${c.slot}:${c.row ?? "unit"}`;
        groups.set(at, Math.max(groups.get(at) ?? 0, weight(c)));
      }
      const most = [...groups].reduce((n, [at, w]) => {
        const [s, row] = at.split(":");
        const models = individual || row === "unit" ? 1 : rows[Number(row)].max;
        return n + w * rules.slots[Number(s)].picks * models;
      }, 0);
      if (most <= cap) continue;
      if (takeable.some((c) => weight(c) !== 1)) {
        unencoded.push(`checkbox ${model ?? "unit"}/${item}: a bundle adds several copies`);
        continue;
      }
      if (takeable.length === 0) continue;
      for (const [id, piece] of sharedCap(ctx, `${key}:checkbox:${model ?? "unit"}:${item}`, takeable, () => cap, counts, individual ? "parent" : "unit")) addCap(id, piece);
    }
  }
  rules.uniform.forEach((set, u) => {
    const scoped = allChoices.filter((c) => inScope(c, set.model));
    const mains = set.choices.filter((c) => !c.substitute && c.items.length > 0);
    const holders = mains.map((main) => scoped.filter((c) => main.items.every((i) => c.items.some((j) => j.id === i.id && j.count >= i.count))));
    holders.forEach((own, m) => {
      const others = holders.filter((_, o) => o !== m).flat();
      if (others.length === 0) return;
      for (const choice of own) {
        const id = ctx.ids.id(`${key}:uniform:${u}:${m}:${choice.id}`);
        addCap(choice.id, {
          constraint: constraint({ id, type: "max", value: -1, field: "selections", scope: "unit", includeChildSelections: true }),
          modifiers: [
            modifier({
              field: id,
              type: "set",
              value: 0,
              conditionGroups: [{ type: "or", conditions: others.map((o) => condition({ childId: o.id, field: "selections", scope: "unit", type: "atLeast", value: 1, includeChildSelections: true })) }],
            }),
          ],
        });
      }
    });
  });

  const itemLinks = (ownerKey: string, items: readonly MfmItem[]): BsNode[] =>
    items.map((item) => {
      const target = ctx.itemEntry(item.id);
      if (!target) throw new Error(`bsdata export: ${unit.id} wargear item ${item.id} has no entry`);
      const linkKey = `${ownerKey}:item:${item.id}`;
      const extra = surcharge.get(item.id);
      return compact({
        ...entryLink({
          name: target.name,
          id: ctx.ids.id(linkKey),
          targetId: target.id,
          type: "selectionEntry",
          collective: true,
          constraints: [
            constraint({ id: ctx.ids.id(`${linkKey}:min`), type: "min", value: item.count, field: "selections", scope: "parent" }),
            constraint({ id: ctx.ids.id(`${linkKey}:max`), type: "max", value: item.count, field: "selections", scope: "parent" }),
          ],
        }),
        defaultAmount: item.count,
        costs: extra ? [cost("pts", ctx.ptsTypeId, extra)] : undefined,
      });
    });

  const choiceEntry = (choice: Choice, repeats: boolean, picks: number): BsNode => {
    const shared = caps.get(choice.id);
    const links = itemLinks(choice.id, choice.items);
    return compact({
      name: bundleName(ctx, choice.items),
      id: choice.id,
      hidden: false,
      collective: true,
      import: true,
      type: "upgrade",
      constraints: [
        constraint({ id: ctx.ids.id(`${choice.id}:max`), type: "max", value: repeats || choice.items.length === 0 ? picks : 1, field: "selections", scope: "parent" }),
        ...(shared?.constraints ?? []),
      ],
      modifiers: shared && shared.modifiers.length > 0 ? shared.modifiers : undefined,
      categoryLinks: shared && shared.categoryLinks.length > 0 ? shared.categoryLinks : undefined,
      entryLinks: links,
      costs: [cost("pts", ctx.ptsTypeId, 0)],
    });
  };

  const groupFor = (s: number, row: number | null, alternates: readonly string[]): BsNode => {
    const slot = rules.slots[s];
    const slotKey = `${key}:slot:${s}:${row ?? "unit"}`;
    const groupId = ctx.ids.id(slotKey);
    const minId = ctx.ids.id(`${slotKey}:min`);
    const maxId = ctx.ids.id(`${slotKey}:max`);
    const choices = choicesBySlot.get(`${s}:${row ?? "unit"}`)!;
    // The choice the unit's starting loadout gives the slot (`startingChoices`); without one, the
    // choice one model's stock holds, else the empty choice, so an optional slot starts empty.
    const start = slot.model === undefined ? unitStock : modelStock(rules, slot.model);
    const defaultChoice = starts.has(s)
      ? choices[starts.get(s)!]
      : (choices.find((c) => c.items.length > 0 && c.items.every((i) => (start.get(i.id) ?? 0) >= i.count)) ?? choices.find((c) => c.items.length === 0));
    const offAlternate = alternates.length > 0 && !slot.alternate;
    const alternateTaken = alternates.map((id) => condition({ childId: id, field: "selections", scope: "parent", type: "atLeast", value: 1, includeChildSelections: true }));
    return compact({
      name: `${slot.alternate ? "Alternative wargear" : "Wargear"} ${s + 1}`,
      id: groupId,
      hidden: false,
      defaultSelectionEntryId: slot.alternate ? undefined : defaultChoice?.id,
      constraints: [
        constraint({ id: minId, type: "min", value: slot.alternate ? 0 : slot.picks, field: "selections", scope: "parent" }),
        constraint({ id: maxId, type: "max", value: slot.picks, field: "selections", scope: "parent" }),
      ],
      modifiers: offAlternate
        ? [
            modifier({ field: minId, type: "set", value: 0, conditionGroups: [{ type: "or", conditions: alternateTaken }] }),
            modifier({ field: maxId, type: "set", value: 0, conditionGroups: [{ type: "or", conditions: alternateTaken }] }),
          ]
        : undefined,
      selectionEntries: choices.map((choice) => {
        const entry = choiceEntry(choice, slot.repeats, slot.picks);
        return choice.id === defaultChoice?.id ? { ...entry, defaultAmount: slot.picks } : entry;
      }),
    });
  };

  const rowGroups: BsNode[][] = rows.map(() => []);
  const rowLinks: BsNode[][] = rows.map(() => []);
  const unitGroups: BsNode[] = [];
  const unitLinks: BsNode[] = [];
  rows.forEach((_, r) => {
    const own = rules.slots.map((slot, s) => ({ slot, s })).filter(({ slot }) => rowsOf(slot.model).includes(r));
    const alternates = own.filter(({ slot }) => slot.alternate).map(({ s }) => ctx.ids.id(`${key}:slot:${s}:${r}`));
    const groups = own.map(({ s }) => groupFor(s, r, alternates));
    // A row with no slots carries its template.
    const template = keys[r].map((k) => templates.get(k)).find((items) => items !== undefined) ?? [];
    const fixed = own.length === 0 ? itemLinks(`${key}:row:${r}:template`, template) : [];
    (multiModel ? rowGroups[r] : unitGroups).push(...groups);
    (multiModel ? rowLinks[r] : unitLinks).push(...fixed);
  });
  rules.slots.forEach((slot, s) => {
    if (slot.model === undefined) unitGroups.push(groupFor(s, null, []));
    else if (rowsOf(slot.model).length === 0) throw new Error(`bsdata export: ${unit.id} slot names unknown row ${slot.model}`);
  });
  const bare = rows.map((_, r) => Math.max(0, ...keys[r].map((k) => bareModels(rules, k))));
  return { rowGroups, rowLinks, bare, unitGroups, unitLinks, unencoded };
}
