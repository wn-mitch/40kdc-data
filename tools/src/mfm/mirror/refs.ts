/**
 * Every place an ability or stratagem id is referenced inside a JSON value (an ability's DSL, a
 * conformance case, a test fixture), found by shape rather than by path so new containers are
 * covered: grants/modifiers/activations (`modifier.ability`), `has-ability` (`parameters.ability`),
 * `rule-state` of kind `ability`/`faction-rule`, `rule-active`, `source_ability.ability_id`,
 * `aura_of`, `interactions[].ability_ref`, `{kind|of: "ability", id}` events, and Stratagem
 * permissions/targeting (`stratagem`).
 */
export type RefKind = "ability" | "stratagem";

export interface FoundRef {
  path: (string | number)[];
  value: string;
  kind: RefKind;
  /** The shape that located it, for reports. */
  shape: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

/** Every id reference in `node`, with its path relative to `node`. */
export function findRefs(node: unknown, base: (string | number)[] = []): FoundRef[] {
  const out: FoundRef[] = [];
  const walk = (v: unknown, path: (string | number)[], parent: Obj | null): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...path, i], parent));
      return;
    }
    if (!isObj(v)) return;
    const add = (key: string, kind: RefKind, shape: string): void => {
      const val = v[key];
      if (typeof val === "string") out.push({ path: [...path, key], value: val, kind, shape });
    };
    if (typeof v.ability === "string") add("ability", "ability", "ability");
    if (typeof v.aura_of === "string") add("aura_of", "ability", "aura_of");
    if (typeof v.ability_ref === "string") add("ability_ref", "ability", "ability_ref");
    if (typeof v.stratagem === "string") add("stratagem", "stratagem", "stratagem");
    if (typeof v.rule === "string") {
      const rk = v.rule_kind;
      if (rk === "ability" || rk === "faction-rule") add("rule", "ability", `rule-state:${rk}`);
      else if (rk === undefined && parent?.type === "rule-active") add("rule", "ability", "rule-active");
    }
    if (typeof v.id === "string" && (v.kind === "ability" || v.of === "ability")) add("id", "ability", "event-ability");
    for (const [k, x] of Object.entries(v)) {
      if (k === "source_ability" && isObj(x) && typeof x.ability_id === "string") {
        out.push({ path: [...path, k, "ability_id"], value: x.ability_id, kind: "ability", shape: "source_ability" });
      }
      walk(x, [...path, k], v);
    }
  };
  walk(node, base, null);
  return out;
}
