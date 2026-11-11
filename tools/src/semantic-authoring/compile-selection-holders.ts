/**
 * "Select which augmentations are active for X INFANTRY models (excluding Y models) from your army
 * … 1 - …: Add 1 to the Attacks characteristic of melee weapons equipped by this model.": the models
 * the lead sentence names hold every option, and each option's "this model" is one of them.
 */

import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { ARMY_MODELS } from "./families/characteristics.js";

const SELECT = "stance-select-open";
const SENTENCE_END = /[.!?\n]/gu;
/** The first characteristic-modifier version whose subject can be army-models. */
const ARMY_MODELS_VERSION = 21;

/**
 * The friendly model filter (with an optional "from your army") in the sentence of, or the one
 * before, the record's one stance-select-open folds into the options: each characteristic change
 * on "this model" becomes a change on the army's models with the filter's keywords. The filter has
 * no other place in such a record, so any other leaf on "this model", or a filter the options do
 * not use, is refused rather than dropped.
 */
export function foldSelectionHolders(leaves: readonly CompileLeaf[], sourceText?: string): readonly CompileLeaf[] {
  const selects = leaves.filter((leaf) => leaf.family_id === SELECT);
  if (selects.length !== 1 || sourceText === undefined) return leaves;
  const select = selects[0]!;
  const at = leaves.indexOf(select);
  const bytes = Buffer.from(sourceText, "utf8");
  // The filter's sentence, or the one right before the selection's ("… for X models from your army. To do so, select …").
  const leads = (leaf: CompileLeaf) => leaf.fragment === select.fragment && leaf.end_byte !== undefined && select.start_byte !== undefined
    && (bytes.subarray(leaf.end_byte, select.start_byte).toString("utf8").match(SENTENCE_END) ?? []).length <= 1;
  const filterAt = leaves.findIndex((leaf, index) => index < at && leaf.family_id === "unit-filter" && leaf.parameters.level === "model"
    && leaf.parameters.side === "friendly" && leads(leaf));
  if (filterAt < 0) return leaves;
  const filter = leaves[filterAt]!;
  const owner = leaves[filterAt + 1]?.family_id === "unit-owner" && leaves[filterAt + 1]!.parameters.owner === "friendly" ? leaves[filterAt + 1] : undefined;
  const keywords = filter.parameters.keywords as string[] | undefined;
  const excluded = filter.parameters.excluded_keywords as string[] | undefined;
  const extra = Object.keys(filter.parameters).filter((key) => !["side", "level", "keywords", "excluded_keywords"].includes(key));
  if (extra.length) throw new CompileError(`The models a selection is made for are a keyword filter; ${extra.join(", ")} cannot narrow them.`);
  let held = 0;
  const out = leaves.flatMap((leaf, index): CompileLeaf[] => {
    if (leaf === filter || leaf === owner) return [];
    if (index <= at || leaf.parameters.subject !== "this-model") return [leaf];
    if (leaf.family_id !== "characteristic-modifier" || leaf.family_version < ARMY_MODELS_VERSION) {
      throw new CompileError(`An option's "this model" is one of the models the selection is made for; ${leaf.family_id} cannot name them yet.`);
    }
    held += 1;
    const { model_keywords: own, excluded_model_keywords: ownExcluded, ...rest } = leaf.parameters;
    if (own !== undefined || ownExcluded !== undefined) throw new CompileError("An option names its own models besides the models the selection is made for.");
    return [{ ...leaf, parameters: { ...rest, subject: ARMY_MODELS, ...(keywords ? { model_keywords: keywords } : {}), ...(excluded ? { excluded_model_keywords: excluded } : {}) } }];
  });
  if (held === 0) throw new CompileError("A selection names the models it is made for, but no option changes \"this model\".");
  return out;
}
