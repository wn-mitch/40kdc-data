import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { wordingBetween } from "./compile-discontiguous-gap.js";
import { ordered } from "./compile-placement.js";
import { normalizeFingerprintParameters } from "./contracts.js";

/**
 * "…until the start of your next Command phase, in addition to any other combat doctrine": the
 * qualifier completes the option activation before it. The binder walks back from the qualifier
 * through duration leaves to the nearest effect of the same clause. That effect must be an
 * ability-activate (version 2), and only a comma or whitespace may separate it from the qualifier
 * once its duration's wording is removed. The binder sets additive on the activation and drops
 * the qualifier. The activation is then normalised, so an option form it cannot keep additive
 * still refuses.
 */

const QUALIFIER = "additive-option";
const HOST = "ability-activate";
const HOST_VERSION = 2;
const CLAUSE_GAP = /^[\s,]*$/u;

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
    let host: CompileLeaf | undefined;
    for (let index = at - 1; index >= 0; index -= 1) {
      const leaf = sorted[index]!;
      if (leaf.fragment !== qualifier.fragment) break;
      if (leaf.role === "DURATION") { skipped.unshift(leaf); continue; }
      if (leaf.family_id === QUALIFIER) continue;
      if (leaf.role === "EFFECT") { host = leaf; break; }
      throw new CompileError(`An additive option at byte ${qualifier.start_byte} is separated from its activation by ${leaf.family_id}; only a duration may come between them.`);
    }
    if (host === undefined) throw new CompileError(`An additive option at byte ${qualifier.start_byte} has no activation before it in its clause.`);
    if (host.family_id !== HOST || host.family_version !== HOST_VERSION) {
      throw new CompileError(`An additive option at byte ${qualifier.start_byte} follows ${host.family_id}, which has no additive form.`);
    }
    if (claimed.has(host)) throw new CompileError(`Two additive options at byte ${qualifier.start_byte} claim one activation; give each its own.`);
    if (!CLAUSE_GAP.test(wordingBetween(source, host, qualifier, skipped))) {
      throw new CompileError(`An additive option at byte ${qualifier.start_byte} is separated from its activation by more than its duration.`);
    }
    if (host.parameters.additive === true) throw new CompileError(`The activation at byte ${host.start_byte} is already additive.`);
    claimed.add(host);
    let parameters: Record<string, unknown>;
    try {
      parameters = normalizeFingerprintParameters(HOST, { ...host.parameters, additive: true }, HOST_VERSION);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new CompileError(`The additive option at byte ${qualifier.start_byte} cannot apply to its activation: ${error.message}`);
    }
    folded.set(host, { ...host, parameters });
    dropped.add(qualifier);
  });
  return leaves.flatMap((leaf) => {
    if (dropped.has(leaf)) return [];
    return [folded.get(leaf) ?? leaf];
  });
}
