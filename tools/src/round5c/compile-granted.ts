import { slug } from "../pack-blocks.js";
import type { Compiled } from "./compile.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { ordered, shapeSignature } from "./compile-placement.js";
import { GRANTED_ABILITY_NAME } from "./family-extensions-w8-granted.js";

/**
 * Printed grants: "X units have the following ability: **Name:** …". The header leaf
 * (ability-record-grant with `printed`) says abilities follow it; each named body opens with a
 * granted-ability-name leaf, and an unnamed body ("have the following:") opens right after the
 * header. A body is its holder's own ability, so it compiles alone: its moment, usage, duration
 * and "this unit" are the holder's, never the host record's. The host keeps the header, which
 * lowers to the bodies (`printedGrantEffect`).
 *
 * Where a body ends is computed, not guessed: at the next marker, the next printed header, a
 * change of source fragment, or the end of the marker's paragraph, whichever comes first. A
 * paragraph ends at a line break, except that it continues onto the next line when it ends with
 * ":" (ignoring bold markers and spacing) or the next line opens with "■". Leaves after the last
 * body go back to the host.
 */

type Node = Record<string, unknown>;
type Compile = (leaves: readonly CompileLeaf[], sourceText?: string) => Compiled;

/** One compiled body as the header carries it: the granted ability's id (from its label) and its part. */
export type GrantedBody = { ability?: string; part: Node };

const SELF_HOLDERS = new Set(["this-unit", "this-model"]);
const BEHAVIOR_RANK = ["passive", "activated", "reactive", "aura"];

export const isPrintedHeader = (leaf: CompileLeaf) => leaf.family_id === "ability-record-grant" && leaf.parameters.printed !== undefined;

/** Byte ranges of the source's paragraphs, with continuation lines joined (see above). */
function paragraphs(sourceText: string): Array<[number, number]> {
  const bytes = Buffer.from(sourceText, "utf8");
  const lines: Array<[number, number]> = [];
  let start = 0;
  bytes.forEach((byte, at) => {
    if (byte === 0x0a || byte === 0x0d) { lines.push([start, at]); start = at + 1; }
  });
  lines.push([start, bytes.length]);
  const text = ([from, to]: [number, number]) => bytes.subarray(from, to).toString("utf8");
  const joined: Array<[number, number]> = [];
  for (const line of lines) {
    const last = joined.at(-1);
    if (last && (text(last).replace(/[\s*]+$/u, "").endsWith(":") || /^\s*■/u.test(text(line)))) last[1] = line[1];
    else joined.push([line[0], line[1]]);
  }
  return joined;
}

function paragraphEnd(spans: ReadonlyArray<[number, number]>, byte: number): number {
  return spans.find(([from, to]) => byte >= from && byte <= to)?.[1] ?? Number.POSITIVE_INFINITY;
}

/** A body's mechanics as one ability-part: the holder's own moment, usage, duration and choice. */
function bodyPart(label: string | null, compiled: Extract<Compiled, { ok: true }>): Node {
  const { effect, trigger, usage, scope, behavior } = compiled.mechanics;
  const duration = scope.duration;
  return {
    type: "ability-part",
    ...(label ? { name: label } : {}),
    effect,
    ...(behavior === "activated" && !trigger ? { optional: true } : {}),
    ...(trigger ? { trigger } : {}),
    ...(usage ? { usage } : {}),
    ...(duration !== undefined && duration !== "permanent" ? { duration } : {}),
  };
}

type Fold = { host: CompileLeaf[]; bodies: Array<{ header: CompileLeaf; label: string | null; leaves: CompileLeaf[] }> };

/** Split the record into host leaves and the leaves of each printed body. */
function splitBodies(list: readonly CompileLeaf[], sourceText: string | undefined): Fold {
  const headers = list.flatMap((leaf, index) => isPrintedHeader(leaf) ? [index] : []);
  const firstMarker = list.findIndex((leaf) => leaf.family_id === GRANTED_ABILITY_NAME);
  if (firstMarker !== -1 && (headers.length === 0 || firstMarker < headers[0]!)) {
    throw new CompileError(`granted-ability-name at byte ${list[firstMarker]!.start_byte} names a granted ability, but no printed ability-record-grant header comes before it.`);
  }
  if (headers.length === 0) return { host: [...list], bodies: [] };
  if (sourceText === undefined) throw new CompileError("A printed ability-record-grant needs the source text to find where each granted ability ends.");
  const spans = paragraphs(sourceText);
  const taken = new Set<number>();
  const bodies: Fold["bodies"] = [];
  headers.forEach((at, position) => {
    const header = list[at]!;
    const next = headers[position + 1] ?? list.length;
    const markers = list.slice(at + 1, next).flatMap((leaf, offset) => leaf.family_id === GRANTED_ABILITY_NAME ? [at + 1 + offset] : []);
    const printed = String(header.parameters.printed);
    const expected = printed === "one" ? markers.length === 1 : printed === "several" ? markers.length >= 2 : markers.length === 0;
    if (!expected) {
      const wants = printed === "one" ? "exactly one" : printed === "several" ? "two or more" : "no";
      throw new CompileError(`The printed grant at byte ${header.start_byte} (${printed}) needs ${wants} granted-ability-name leaves after it; found ${markers.length}.`);
    }
    if (markers.length && markers[0]! > at + 1) {
      throw new CompileError(`${list[at + 1]!.family_id} at byte ${list[at + 1]!.start_byte} sits between a printed grant header and its first granted-ability-name.`);
    }
    // Each body: from its marker (or the header) to its end, never past the next marker or header.
    const starts = markers.length ? markers : [at];
    starts.forEach((start, index) => {
      const opener = list[start]!;
      const limit = starts[index + 1] ?? next;
      const end = paragraphEnd(spans, opener.start_byte);
      const leaves: CompileLeaf[] = [];
      let cursor = start + 1;
      while (cursor < limit && list[cursor]!.start_byte < end && list[cursor]!.fragment === opener.fragment) leaves.push(list[cursor++]!);
      const label = markers.length ? String(opener.parameters.label) : null;
      const name = label ?? "The unnamed granted ability";
      // A header printed inside the body's own paragraph would be a grant within the granted ability.
      if (cursor === next && next < list.length && list[next]!.start_byte < end && list[next]!.fragment === opener.fragment) {
        throw new CompileError(`${name} holds another printed grant (byte ${list[next]!.start_byte}); nested grants do not compile.`);
      }
      if (!leaves.some((leaf) => leaf.role === "EFFECT")) throw new CompileError(`${name} has no effect leaf in its body.`);
      if (markers.length) taken.add(start);
      for (let item = start + 1; item < cursor; item += 1) taken.add(item);
      bodies.push({ header, label, leaves });
    });
  });
  return { host: list.filter((_, index) => !taken.has(index)), bodies };
}

/**
 * Compile a record that may print granted abilities. A record with none compiles as `compileHost`
 * does. Otherwise each body compiles alone (`compileBody`) into an ability-part on its header.
 * A self-held grant ("this model has the following ability") that is the record's only effect is
 * the record itself: the record compiles without the header, as that ability.
 */
export function compileGranted(leaves: readonly CompileLeaf[], sourceText: string | undefined, compileHost: Compile, compileBody: Compile): Compiled {
  const list = ordered(leaves);
  const signature = shapeSignature(list, sourceText);
  let fold: Fold;
  try {
    fold = splitBodies(list, sourceText);
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    return { ok: false, signature, errors: [error.message] };
  }
  if (fold.bodies.length === 0) return compileHost(leaves, sourceText);
  const selfHeld = (header: CompileLeaf) => SELF_HOLDERS.has(String(header.parameters.subject));
  const others = fold.host.filter((leaf) => !isPrintedHeader(leaf));
  if (fold.bodies.length === 1 && selfHeld(fold.bodies[0]!.header) && !others.some((leaf) => leaf.role === "EFFECT")) {
    const whole = compileBody([...others, ...fold.bodies[0]!.leaves], sourceText);
    return { ...whole, signature };
  }
  const granted = new Map<CompileLeaf, GrantedBody[]>();
  const behaviors: string[] = [];
  const errors: string[] = [];
  for (const body of fold.bodies) {
    const name = body.label ?? "The unnamed granted ability";
    const compiled = compileBody(body.leaves, sourceText);
    if (!compiled.ok) { errors.push(...compiled.errors.map((error) => `${name}: ${error}`)); continue; }
    if (compiled.core || compiled.checks.length) { errors.push(`${name}: a granted ability cannot hold a Stratagem target or a bearer restriction.`); continue; }
    if (selfHeld(body.header) && compiled.mechanics.behavior) behaviors.push(compiled.mechanics.behavior);
    const list = granted.get(body.header) ?? [];
    list.push({ ...(body.label ? { ability: slug(body.label) } : {}), part: bodyPart(body.label, compiled) });
    granted.set(body.header, list);
  }
  if (errors.length) return { ok: false, signature, errors };
  const host = fold.host.map((leaf) => granted.has(leaf)
    ? { ...leaf, parameters: { ...leaf.parameters, granted: granted.get(leaf), ...(selfHeld(leaf) ? { granted_self: true } : {}) } }
    : leaf);
  const result = compileHost(host, sourceText);
  if (!result.ok) return { ...result, signature };
  // A self-held ability is part of the record's own: the record reads as its liveliest part.
  const rank = Math.max(...[result.mechanics.behavior ?? "passive", ...behaviors].map((behavior) => BEHAVIOR_RANK.indexOf(behavior)));
  return { ...result, signature, mechanics: { ...result.mechanics, behavior: BEHAVIOR_RANK[rank] ?? result.mechanics.behavior } };
}

/**
 * The DSL a folded printed header lowers to: for a self-held grant, the parts themselves; for a
 * grant to other units, one ability-grant per body whose `definition` is that body.
 */
export function printedGrantEffect(leaf: CompileLeaf, target: Node | string): Node {
  const granted = leaf.parameters.granted as GrantedBody[] | undefined;
  if (!granted?.length) throw new CompileError(`ability-record-grant at byte ${leaf.start_byte} prints its abilities, but no body was folded onto it.`);
  const nodes = granted.map((body) => leaf.parameters.granted_self === true
    ? structuredClone(body.part)
    : { type: "ability-grant", target: structuredClone(target), modifier: { ...(body.ability ? { ability: body.ability } : {}), definition: structuredClone(body.part) } });
  return nodes.length === 1 ? nodes[0]! : { type: "sequence", steps: nodes };
}
