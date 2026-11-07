import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { wordingBetween } from "./compile-discontiguous-gap.js";
import { ordered } from "./compile-placement.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "./contracts.js";
import { dslUnitFilter } from "./compile-unit-filter-dsl.js";

/**
 * "…until the start of your next Command phase, in addition to any other combat doctrine": the
 * qualifier completes the option activation before it. The binder walks back from the qualifier
 * through duration leaves to the nearest effect of the same clause. That effect must be an
 * ability-activate (version 2), and only a comma or whitespace may separate it from the qualifier
 * once its duration's wording is removed. The binder sets additive on the activation and drops
 * the qualifier. The activation is then normalised, so an option form it cannot keep additive
 * still refuses.
 *
 * A unit-filter may sit between the activation and the qualifier ("that Blessing is active for friendly
 * K units in addition to any other …"): the filter names the activation's units. The binder folds it onto
 * the activation as subject filtered-units and its `subject_filter`, and drops the filter leaf. The
 * activation's subject must be this-unit (its default) or absent, and only one filter may sit there.
 */

const QUALIFIER = "additive-option";
const HOST = "ability-activate";
const HOST_VERSION = 2;
const CLAUSE_GAP = /^[\s,]*$/u;
const FILTER = "unit-filter";
const FILTERED_UNITS = "filtered-units";

export function bindAdditiveOptions(leaves: readonly CompileLeaf[], sourceText?: string): CompileLeaf[] {
  if (!leaves.some((leaf) => leaf.family_id === QUALIFIER)) return [...leaves];
  if (sourceText === undefined) throw new CompileError("An additive option needs source text to verify its clause.");
  const source = Buffer.from(sourceText, "utf8");
  const sorted = ordered(leaves);
  const folded = new Map<CompileLeaf, CompileLeaf>();
  const claimed = new Set<CompileLeaf>();
  const dropped = new Set<CompileLeaf>();
  sorted.forEach((qualifier, at) => {
    if (qualifier.family_id !== QUALIFIER) return;
    const skipped: CompileLeaf[] = [];
    const filters: CompileLeaf[] = [];
    let host: CompileLeaf | undefined;
    for (let index = at - 1; index >= 0; index -= 1) {
      const leaf = sorted[index]!;
      if (leaf.fragment !== qualifier.fragment) break;
      if (leaf.role === "DURATION") { skipped.unshift(leaf); continue; }
      if (leaf.family_id === QUALIFIER) continue;
      if (leaf.family_id === FILTER && filters.length === 0 && host === undefined) { filters.push(leaf); continue; }
      if (leaf.role === "EFFECT") { host = leaf; break; }
      throw new CompileError(`An additive option at byte ${qualifier.start_byte} is separated from its activation by ${leaf.family_id}; only a duration may come between them.`);
    }
    if (host === undefined) throw new CompileError(`An additive option at byte ${qualifier.start_byte} has no activation before it in its clause.`);
    if (host.family_id !== HOST || host.family_version < HOST_VERSION) {
      throw new CompileError(`An additive option at byte ${qualifier.start_byte} follows ${host.family_id}, which has no additive form.`);
    }
    if (claimed.has(host)) throw new CompileError(`Two additive options at byte ${qualifier.start_byte} claim one activation; give each its own.`);
    if (!CLAUSE_GAP.test(wordingBetween(source, host, qualifier, [...skipped, ...filters].sort((left, right) => left.start_byte - right.start_byte)))) {
      throw new CompileError(`An additive option at byte ${qualifier.start_byte} is separated from its activation by more than its duration.`);
    }
    if (host.parameters.additive === true) throw new CompileError(`The activation at byte ${host.start_byte} is already additive.`);
    claimed.add(host);
    // The units the filter names are the activation's recipients: subject filtered-units, read by the fragment as subject_filter.
    if (filters.length > 1) throw new CompileError(`The additive option at byte ${qualifier.start_byte} has more than one unit-filter before it.`);
    if (filters.length === 1 && host.parameters.subject !== undefined && host.parameters.subject !== "this-unit") {
      throw new CompileError(`The activation at byte ${host.start_byte} names its own units, so a unit-filter cannot also name them.`);
    }
    const version = filters.length === 1 ? currentFamilyVersion(HOST) : host.family_version;
    let parameters: Record<string, unknown>;
    try {
      parameters = normalizeFingerprintParameters(HOST, { ...host.parameters, additive: true, ...(filters.length ? { subject: FILTERED_UNITS } : {}) }, version);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new CompileError(`The additive option at byte ${qualifier.start_byte} cannot apply to its activation: ${error.message}`);
    }
    const bound: CompileLeaf = filters.length === 0 ? { ...host, parameters } : {
      ...host, family_version: version, role: familyRole(HOST, version),
      parameters: { ...parameters, subject_filter: dslUnitFilter(filters[0]!) },
    };
    folded.set(host, bound);
    dropped.add(qualifier);
    for (const filter of filters) dropped.add(filter);
  });
  return leaves.flatMap((leaf) => {
    if (dropped.has(leaf)) return [];
    return [folded.get(leaf) ?? leaf];
  });
}
