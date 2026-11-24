/**
 * "You cannot use this Stratagem while you have 0 Pain tokens": a Stratagem's RESTRICTIONS forbidding its own use
 * name that Stratagem, not every Stratagem. The permission is bound to the record's own id, which a Stratagem's
 * ability record shares with its core record, so the describer reads it as "this Stratagem".
 */

import { CompileError } from "./compile-error.js";
import type { CompileLeaf } from "./compile-fragments.js";

/** A RESTRICTIONS leaf forbidding the use of a Stratagem, with no Stratagem named. */
function isOwnUseDenial(leaf: CompileLeaf): boolean {
  return leaf.family_id === "eligibility-permission" && leaf.fragment === "RESTRICTIONS" && leaf.parameters.activity === "use-stratagem"
    && leaf.parameters.allow === false && leaf.parameters.stratagem === undefined;
}

/** Binds each own-use denial to the record's id; a record with one and no known id is refused. */
export function bindOwnStratagemDenials(leaves: readonly CompileLeaf[], abilityId: string | undefined): CompileLeaf[] {
  return leaves.map((leaf) => {
    if (!isOwnUseDenial(leaf)) return leaf;
    if (abilityId === undefined) throw new CompileError("A Stratagem's restriction on its own use needs the record's ability id.");
    return { ...leaf, parameters: { ...leaf.parameters, stratagem: abilityId } };
  });
}
