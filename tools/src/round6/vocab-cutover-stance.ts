import type { CutoverContext, Node } from "./vocab-cutover-types.js";

export interface StanceRecord { file: string; faction?: string; record: string; value: unknown }
interface Option { ability_id: string; option_id: string; aliases: Set<string> }
interface Menu { options: Option[]; ambiguous: boolean }
const object = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);
// This is an import-time lookup key only: emitted identity never depends on a display label.
const alias = (value: string): string => value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const key = (faction: string | undefined, id: string): string => `${faction ?? ""}/${id}`;

/** Build before transforming files so references do not depend on traversal order. */
export class StanceIndex {
  private menus = new Map<string, Menu>();
  private entities = new Set<string>();

  constructor(records: readonly StanceRecord[]) {
    for (const record of records) {
      this.entities.add(key(record.faction, record.record));
      const menus: Node[] = [];
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) value.forEach(visit);
        else if (object(value)) {
          if (value.type === "stance-select" || value.type === "dice-pool-allocation") menus.push(value);
          Object.values(value).forEach(visit);
        }
      };
      visit(record.value);
      if (!menus.length) continue;
      const options = menus.flatMap((menu) => (Array.isArray(menu.options) ? menu.options : []).flatMap((option, i): Option[] => {
        if (!object(option) || typeof option.name !== "string") return [];
        const id = typeof option.id === "string" ? option.id : `option-${i + 1}`;
        return [{ ability_id: record.record, option_id: id, aliases: new Set([id, option.name, alias(option.name)]) }];
      }));
      this.menus.set(key(record.faction, record.record), { options, ambiguous: menus.length !== 1 || new Set(options.map((o) => o.option_id)).size !== options.length });
    }
  }

  private menu(faction: string | undefined, ability: string): Menu | undefined {
    return this.menus.get(key(faction, ability)) ?? this.menus.get(key("_core", ability));
  }

  resolve(ability: string, value: unknown, ctx: CutoverContext): Node | undefined {
    const menu = this.menu(ctx.faction, ability);
    const candidate = object(value) ? value.option_id : value;
    if (object(value) && value.ability_id !== ability) {
      ctx.report("stance option parent differs from referenced ability", value);
      return undefined;
    }
    const matches = menu?.options.filter((option) => typeof candidate === "string" && option.aliases.has(candidate)) ?? [];
    if (!menu || menu.ambiguous || matches.length !== 1) {
      ctx.report(`unresolved or ambiguous stance option in ${ability}`, value);
      return undefined;
    }
    const match = matches[0]!;
    return { ability_id: match.ability_id, option_id: match.option_id };
  }

  transform(node: Node, ctx: CutoverContext): Node {
    if ((node.type === "stance-select" || node.type === "dice-pool-allocation") && Array.isArray(node.options)) {
      if (this.menu(ctx.faction, ctx.record)?.ambiguous) ctx.report("containing ability has ambiguous stance menus or duplicate option IDs", node);
      node.options.forEach((option, i) => { if (object(option) && option.id === undefined) option.id = `option-${i + 1}`; });
      if (node.type === "stance-select") {
        if (node.min_choices !== undefined && node.max_choices === undefined) node.max_choices = 1;
        if (node.max_choices !== undefined && node.min_choices === undefined) node.min_choices = 1;
      }
    }
    if (node.type === "ability-activate" && object(node.modifier)) {
      const modifier = node.modifier;
      if (typeof modifier.ability === "string") {
        if (modifier.option !== undefined) {
          const ref = this.resolve(modifier.ability, modifier.option, ctx);
          if (ref) modifier.option = ref.option_id;
        }
        if (Array.isArray(modifier.options)) modifier.options = modifier.options.map((option) => this.resolve(String(modifier.ability), option, ctx)?.option_id ?? option);
      }
    }
    if (node.type === "stance-selection-capacity" && object(node.modifier)) {
      const modifier = node.modifier;
      const ability = modifier.ability_id;
      if (typeof ability !== "string") ctx.report("stance capacity requires explicit parent ability_id", node);
      else {
        if (modifier.option !== undefined) modifier.option = this.resolve(ability, modifier.option, ctx) ?? modifier.option;
        if (Array.isArray(modifier.options)) modifier.options = modifier.options.map((option) => this.resolve(ability, option, ctx) ?? option);
      }
    }
    if (node.type === "rule-active" && object(node.parameters) && typeof node.parameters.rule === "string") {
      const rule = node.parameters.rule;
      // Real entity identity wins over a coincidentally equal option display label.
      if (this.entities.has(key(ctx.faction, rule)) || this.entities.has(key("_core", rule))) return node;
      const local = [...this.menus.entries()].filter(([id]) => id.startsWith(`${ctx.faction ?? ""}/`));
      const core = [...this.menus.entries()].filter(([id]) => id.startsWith("_core/"));
      const find = (entries: Array<[string, Menu]>): Option[] => entries.flatMap(([, menu]) => menu.ambiguous ? [] : menu.options.filter((option) => option.aliases.has(rule)));
      const localMatches = find(local);
      const matches = localMatches.length ? localMatches : find(core);
      if (matches.length === 1) node.parameters.rule = { ability_id: matches[0]!.ability_id, option_id: matches[0]!.option_id };
      else ctx.report("rule-active reference resolves to neither one local/core entity nor one stance option", node);
    }
    return node;
  }
}
