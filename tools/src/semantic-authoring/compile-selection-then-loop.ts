import type { Compiled, CompileOptions } from "./compile.js";
import type { CompileLeaf } from "./compile-fragments.js";

/**
 * A selection, then a loop in a later sentence of the same moment: "at the start of your Shooting phase you can select
 * units … to become Observer units. During your Shooting phase, for each Observer unit …, select one enemy unit … to be
 * marked as their Spotted unit …". Each compiles alone: the sentences before the loop's are the record itself, and the
 * loop's sentence onward becomes a later ability-part of the record's moment, with its own duration. The later part
 * reads the first part's selection only through the marks it applies, so the two never bind the same unit.
 */

type Node = Record<string, unknown>;
type Compile = (leaves: CompileLeaf[], sourceText?: string, options?: CompileOptions) => Compiled;

/** The byte offset where the sentence holding `byte` starts (after the last ". " or line break before it). */
function sentenceStart(text: Buffer, byte: number): number {
  for (let at = byte - 1; at > 0; at--) {
    if ((text[at - 1] === 0x2e && text[at] === 0x20) || text[at] === 0x0a) return at + 1;
  }
  return 0;
}

/**
 * Compiles a record whose one for-each-unit-select opens a later sentence after a select-unit and the record's moment,
 * as the first sentences' record plus a later ability-part. Returns null for any other record, which then compiles (or
 * refuses) whole.
 */
export function compileSelectionThenLoop(
  leaves: readonly CompileLeaf[],
  sourceText: string | undefined,
  options: CompileOptions,
  compile: Compile,
  signatureOf: (leaves: readonly CompileLeaf[]) => string,
): Compiled | null {
  const list = [...leaves].sort((a, b) => a.start_byte - b.start_byte);
  const loops = list.filter((leaf) => leaf.family_id === "for-each-unit-select");
  if (loops.length !== 1 || sourceText === undefined) return null;
  const from = sentenceStart(Buffer.from(sourceText, "utf8"), loops[0]!.start_byte);
  const split = list.findIndex((leaf) => leaf.start_byte >= from);
  if (split <= 0) return null;
  const head = list.slice(0, split);
  const rest = list.slice(split);
  // The first sentences hold the record's moment and a selection with an effect of its own; the later ones select again.
  if (!head.some((leaf) => leaf.family_id === "event") || !head.some((leaf) => leaf.family_id === "select-unit")) return null;
  if (!head.some((leaf) => leaf.role === "EFFECT") || !rest.some((leaf) => leaf.family_id === "select-unit")) return null;
  const signature = signatureOf(list);
  const refuse = (message: string): Compiled => ({ ok: false, signature, errors: [message] });
  const first = compile(head, sourceText, options);
  if (!first.ok) return { ok: false, signature, errors: first.errors };
  const second = compile(rest, sourceText, options);
  if (!second.ok) return { ok: false, signature, errors: second.errors };
  const later = second.mechanics as unknown as Node;
  // The later part fires on the record's moment, so it brings no moment, use limit or scope of its own beyond a duration.
  if (later.trigger != null || later.usage != null) return refuse("A loop after a selection with its own moment or use limit has no reading as a later part.");
  const scope = (later.scope ?? {}) as Node;
  if (Object.keys(scope).some((key) => key !== "duration")) return refuse("A loop after a selection with a scope beyond its duration has no reading as a later part.");
  const record = first.mechanics as unknown as Node;
  const duration = scope.duration;
  const part: Node = { type: "ability-part", effect: later.effect, ...(duration !== undefined && duration !== "resolution" && duration !== "permanent" ? { duration } : {}) };
  // "If your Army Faction is …" gates the whole ability, not only the sentence it opens.
  const effect = record.effect as Node;
  const armyGate = effect.type === "conditional" && (effect.condition as Node | undefined)?.type === "army-faction";
  const steps = { type: "sequence", steps: [armyGate ? effect.effect : effect, part] };
  const mechanics = { ...record, effect: armyGate ? { ...effect, effect: steps } : steps } as unknown as typeof first.mechanics;
  return { ok: true, signature, mechanics, checks: [...first.checks, ...second.checks], ...(first.core ? { core: first.core } : {}) };
}
