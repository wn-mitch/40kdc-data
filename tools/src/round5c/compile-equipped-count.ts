import { CompileError, type CompileLeaf } from "./compile-fragments.js";

const COUNT = "equipped-weapon-count";
const isAntecedentStat = (leaf: CompileLeaf) => leaf.family_id === "characteristic-modifier" && leaf.family_version >= 13
  && leaf.parameters.weapon === "antecedent";

/**
 * Binds "those two weapons" to the one equipped-weapon-count condition in the record. The stat
 * adjustment takes that condition's subject and the weapon it excluded; it compiles only for
 * exactly two extra melee weapons beside a "Close combat weapon", because the DSL stat-modifier
 * then selects the same weapons (every melee weapon except the close combat one). Any other count
 * or name is refused rather than widened to every melee weapon.
 */
export function bindEquippedCounts(list: readonly CompileLeaf[]): CompileLeaf[] {
  if (!list.some(isAntecedentStat)) return [...list];
  const counts = list.filter((leaf) => leaf.family_id === COUNT);
  return list.map((leaf) => {
    if (!isAntecedentStat(leaf)) return leaf;
    if (counts.length !== 1) throw new CompileError("An antecedent stat adjustment needs exactly one equipped-weapon count in its ability.");
    const count = counts[0]!;
    if (list.indexOf(count) > list.indexOf(leaf)) throw new CompileError("An antecedent stat adjustment must follow the equipped-weapon count it names.");
    if (count.parameters.negated === true) throw new CompileError("A negated equipped-weapon count names no weapons for an antecedent stat adjustment.");
    if (count.parameters.count !== 2) throw new CompileError("An antecedent stat adjustment compiles only for exactly two extra weapons.");
    if (String(count.parameters.other_than).trim().toLowerCase() !== "close combat weapon") {
      throw new CompileError("An antecedent stat adjustment compiles only beside a Close combat weapon.");
    }
    if (leaf.parameters.weapon_type !== count.parameters.weapon_type) {
      throw new CompileError("Stat adjustment weapon_type conflicts with the equipped-weapon count it names.");
    }
    if (leaf.parameters.subject !== undefined && leaf.parameters.subject !== count.parameters.subject) {
      throw new CompileError("Stat adjustment subject conflicts with the equipped-weapon count it names.");
    }
    const { weapon: _antecedent, ...rest } = leaf.parameters;
    return { ...leaf, parameters: { ...rest, subject: count.parameters.subject, exclude_weapon_name: count.parameters.other_than } };
  });
}
