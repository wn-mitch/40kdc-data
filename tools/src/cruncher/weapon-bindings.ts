/**
 * "Select one of this model's plasma rifles. That weapon's attacks have +1 D.": a `select-weapon` step that names
 * the weapon it binds (`weapons.name`) is resolved before translation. Every later `weapons.ref` naming its
 * `bind_as` variable, in the same sequence or nested under it, takes the selection's weapon scope instead, and the
 * selection step itself is dropped. A model holds one weapon of a name in nearly every loadout, so the named scope
 * is the selected weapon; with two same-named weapons it over-reaches to both.
 *
 * A selection whose scope does not name the weapon ("one ranged weapon") is the player's choice among several, so
 * it stays bound and the cruncher keeps reporting its refs as unresolved. Unchanged subtrees keep their identity.
 */
type Scope = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The weapon scope a selection binds by name, or undefined when it does not name its weapon. */
function namedBinding(step: unknown): { variable: string; scope: Scope } | undefined {
  if (!isObject(step) || step.type !== "select-weapon" || !isObject(step.modifier)) return undefined;
  const { bind_as: variable, weapons: scope } = step.modifier;
  if (typeof variable !== "string" || !isObject(scope) || typeof scope.name !== "string" || scope.ref !== undefined) return undefined;
  return { variable, scope };
}

/** A `weapons.ref` naming a bound variable, replaced by the bound scope; other scope fields are kept. */
function substituted(scope: Scope, bindings: ReadonlyMap<string, Scope>): Scope | undefined {
  const ref = scope.ref;
  if (!isObject(ref) || Object.keys(ref).length !== 1 || typeof ref.weapon_var !== "string") return undefined;
  const bound = bindings.get(ref.weapon_var);
  if (bound === undefined) return undefined;
  const { ref: _ref, ...rest } = scope;
  return { ...rest, ...bound };
}

/** Called with each node the rewrite replaces and its replacement, so side tables keyed by node follow it. */
type OnReplace = (from: object, to: object) => void;

function resolve(node: unknown, bindings: ReadonlyMap<string, Scope>, onReplace: OnReplace): unknown {
  if (Array.isArray(node)) {
    const mapped = node.map((child) => resolve(child, bindings, onReplace));
    return mapped.some((child, index) => child !== node[index]) ? mapped : node;
  }
  if (!isObject(node)) return node;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    let next: unknown;
    if (key === "steps" && node.type === "sequence" && Array.isArray(value)) {
      const local = new Map(bindings);
      const steps: unknown[] = [];
      for (const step of value) {
        const binding = namedBinding(step);
        if (binding) local.set(binding.variable, binding.scope);
        else steps.push(resolve(step, local, onReplace));
      }
      next = steps.length === value.length && steps.every((step, index) => step === value[index]) ? value : steps;
    } else if (key === "weapons" && isObject(value)) {
      next = substituted(value, bindings) ?? resolve(value, bindings, onReplace);
    } else {
      next = resolve(value, bindings, onReplace);
    }
    if (next !== value) changed = true;
    out[key] = next;
  }
  if (!changed) return node;
  onReplace(node, out);
  return out;
}

/** The effect with each weapon a selection binds by name written into the scopes that refer to it. */
export function resolveNamedWeaponBindings(effect: unknown, onReplace: OnReplace = () => {}): unknown {
  return resolve(effect, new Map(), onReplace);
}
