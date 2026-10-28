import type { Compiled, CompileOptions } from "./compile.js";
import type { CompileLeaf } from "./compile-fragments.js";

/**
 * Two for-each-unit-select passes in one record, in separate sentences: "if a friendly X unit is
 * controlling an objective, that objective is secured. Until you lose control of that objective,
 * while an enemy unit is within range of that objective, that enemy unit is Afflicted." Each pass
 * compiles alone: the first sentence onward from the record's moment is the record itself, and the
 * sentence holding the second quantifier becomes a later ability-part of the same moment, with its
 * own duration. A pass-two reader of the secured markers ("that objective": an objective filter
 * `designated: secured`) is bound by tagging every marker the first pass secures.
 */

type Node = Record<string, unknown>;
type Compile = (leaves: CompileLeaf[], sourceText?: string, options?: CompileOptions) => Compiled;

const SECURED = "secured";
const isPass = (leaf: CompileLeaf) => leaf.family_id === "for-each-unit-select";

/** The byte offset where the sentence holding `byte` starts (after the last ". " before it). */
function sentenceStart(text: Buffer, byte: number): number {
  for (let at = byte - 1; at > 0; at--) {
    if (text[at - 1] === 0x2e && (text[at] === 0x20 || text[at] === 0x0a)) return at + 1;
  }
  return 0;
}

/** Whether any objective filter in a tree reads the secured designation. */
function readsSecured(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(readsSecured);
  if (node === null || typeof node !== "object") return false;
  const record = node as Node;
  const objective = record.objective as Node | undefined;
  if (objective && typeof objective === "object" && objective.designated === SECURED) return true;
  return Object.values(record).some(readsSecured);
}

/** Every objective-sticky in a tree, followed by a designate tagging the markers it secures. */
function tagSecured(node: unknown): { node: unknown; tagged: number } {
  if (Array.isArray(node)) {
    let tagged = 0;
    const items = node.map((item) => { const next = tagSecured(item); tagged += next.tagged; return next.node; });
    return { node: items, tagged };
  }
  if (node === null || typeof node !== "object") return { node, tagged: 0 };
  const record = node as Node;
  if (record.type === "objective-sticky") {
    const modifier = (record.modifier ?? {}) as Node;
    // The markers it secures: the one it names, else those its unit controls when the rule triggers.
    const objective = modifier.objective ?? { controlled_by_unit: record.target };
    const designate = { type: "designate", target: record.target, modifier: { subject: { objective }, tag: SECURED } };
    return { node: { type: "sequence", steps: [record, designate] }, tagged: 1 };
  }
  let tagged = 0;
  const out: Node = {};
  for (const [key, value] of Object.entries(record)) {
    const next = tagSecured(value);
    tagged += next.tagged;
    out[key] = next.node;
  }
  return { node: out, tagged };
}

/**
 * Compiles a record with exactly two for-each-unit-select passes, the second opening its own
 * sentence after every moment, as the first pass's record plus a later ability-part. Returns null
 * for any other record, which then compiles (or refuses) as one pass.
 */
export function compileForEachPasses(
  leaves: readonly CompileLeaf[],
  sourceText: string | undefined,
  options: CompileOptions,
  compile: Compile,
  signatureOf: (leaves: readonly CompileLeaf[]) => string,
): Compiled | null {
  const list = [...leaves].sort((a, b) => a.start_byte - b.start_byte);
  const passes = list.filter(isPass);
  if (passes.length !== 2 || sourceText === undefined) return null;
  const from = sentenceStart(Buffer.from(sourceText, "utf8"), passes[1]!.start_byte);
  const split = list.findIndex((leaf) => leaf.start_byte >= from);
  // Both passes in one sentence, or the second sentence opens with no leaf: not two passes.
  if (split <= list.indexOf(passes[0]!) || split > list.indexOf(passes[1]!)) return null;
  // A later sentence with its own moment is a compound ability's part, not a pass of the record's moment.
  if (list.slice(split).some((leaf) => leaf.family_id === "event")) return null;
  const signature = signatureOf(list);
  const refuse = (message: string): Compiled => ({ ok: false, signature, errors: [message] });
  const first = compile(list.slice(0, split), sourceText, options);
  if (!first.ok) return { ok: false, signature, errors: first.errors };
  const second = compile(list.slice(split), sourceText, options);
  if (!second.ok) return { ok: false, signature, errors: second.errors };
  const later = second.mechanics as unknown as Node;
  // The later pass fires on the record's moment, so it brings no moment, use limit or scope of its own beyond a duration.
  if (later.trigger != null || later.usage != null) return refuse("A second for-each-unit-select pass with its own moment or use limit has no reading as a later part.");
  const scope = (later.scope ?? {}) as Node;
  if (Object.keys(scope).some((key) => key !== "duration")) return refuse("A second for-each-unit-select pass with a scope beyond its duration has no reading as a later part.");
  const record = first.mechanics as unknown as Node;
  let effect = record.effect;
  if (readsSecured(later.effect)) {
    const tagged = tagSecured(effect);
    if (tagged.tagged === 0) return refuse("The second pass reads the secured objective markers, but the first pass secures none.");
    effect = tagged.node;
  }
  const duration = scope.duration;
  const part: Node = { type: "ability-part", effect: later.effect, ...(duration !== undefined && duration !== "resolution" ? { duration } : {}) };
  const mechanics = { ...record, effect: { type: "sequence", steps: [effect, part] } } as unknown as typeof first.mechanics;
  return { ok: true, signature, mechanics, checks: [...first.checks, ...second.checks], ...(first.core ? { core: first.core } : {}) };
}
