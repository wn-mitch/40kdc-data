import { slug } from "../pack-blocks.js";
import type { Compiled } from "./compile.js";
import type { CoreCheck } from "./core-checks.js";
import { CompileError, type CompileLeaf } from "./compile-fragments.js";
import { dslUnitFilter } from "./compile-unit-filters.js";
import { ordered, shapeSignature } from "./compile-placement.js";
import { GRANTED_ABILITY_NAME } from "./families/abilities.js";

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
 * ":" (ignoring bold markers and spacing) or the next line opens with "■". A body's paragraph also
 * continues over a directly following line that opens with "Or:", so that line's leaves belong to
 * the body. Leaves after the last body go back to the host. A body that opens with a keyword-only
 * "units only" filter narrows the header's holders to those units (`leadingNarrowing`).
 */

type Node = Record<string, unknown>;
type Compile = (leaves: readonly CompileLeaf[], sourceText?: string) => Compiled;

/**
 * One compiled body as the header carries it: the granted ability's id (from its label), its part,
 * and the keyword filter a leading "… units only" narrows its holders by (`narrow`), if any.
 */
/** `ability` names the printed ability as one this record defines inside itself, when the record's id is known. */
export type GrantedBody = { ability?: string | { ability_id: string; definition_id: string }; part: Node; narrow?: Node };

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

/** A body's paragraph extends over an "Or:" line that directly follows it (the line break is one byte). */
function orEnd(spans: ReadonlyArray<[number, number]>, bytes: Buffer, end: number): number {
  if (!Number.isFinite(end)) return end;
  const next = spans.find(([from]) => from === end + 1);
  if (!next) return end;
  return /^[\s*]*Or:/u.test(bytes.subarray(next[0], next[1]).toString("utf8")) ? next[1] : end;
}

/**
 * A body whose wording opens with a keyword-only unit-filter followed by "units only" ("SHADOW LEGION
 * units only: …") holds only the header's units that also have those keywords. Returns that filter as
 * DSL and the body's leaves after it. Any other leading filter stays part of the body.
 */
function leadingNarrowing(leaves: readonly CompileLeaf[], sourceText: string | undefined): { narrow: Node; rest: CompileLeaf[] } | undefined {
  const [first, ...rest] = leaves;
  if (first?.family_id !== "unit-filter" || sourceText === undefined) return undefined;
  const after = Buffer.from(sourceText, "utf8").subarray(first.start_byte, (first.end_byte ?? first.start_byte) + 16).toString("utf8");
  if (!/units only/iu.test(after)) return undefined;
  const set = Object.entries(first.parameters).filter(([, value]) => value !== undefined).map(([key]) => key);
  if (!set.every((key) => key === "side" || key === "keywords") || !Array.isArray(first.parameters.keywords)) {
    throw new CompileError(`A "units only" section at byte ${first.start_byte} narrows by keywords alone; this filter names more.`);
  }
  return { narrow: dslUnitFilter(first), rest };
}

/** The header's target with the body's keywords added: the units that hold both. */
function narrowTarget(target: Node | string, narrow: Node): Node {
  if (typeof target === "string" || narrow.owner !== target.owner) throw new CompileError("A units-only section needs a unit-filter header with the same owner.");
  const extra = Array.isArray(narrow.all_of) ? narrow.all_of as string[] : [];
  return { ...target, all_of: [...new Set([...(Array.isArray(target.all_of) ? target.all_of as string[] : []), ...extra])] };
}

/**
 * A body's own Stratagem check: the Stratagem its trigger names (`event` with activity stratagem and
 * an id) and no subject. The check only restates that id; it does not restrict who holds the ability.
 */
function ownStratagemCheck(check: CoreCheck, trigger: unknown): boolean {
  const filter = (trigger as { filter?: { kind?: unknown; id?: unknown } } | null | undefined)?.filter;
  return check.kind === "named-ability" && check.parameters.activity === "stratagem" && check.parameters.subject === undefined
    && filter?.kind === "stratagem" && filter.id !== undefined && filter.id === check.parameters.id;
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
      const end = orEnd(spans, Buffer.from(sourceText, "utf8"), paragraphEnd(spans, opener.start_byte));
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
export function compileGranted(leaves: readonly CompileLeaf[], sourceText: string | undefined, compileHost: Compile, compileBody: Compile, abilityId?: string): Compiled {
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
  const bodyChecks: CoreCheck[] = [];
  const errors: string[] = [];
  // A grant of this record to other units ("benefit from the <record> rule") gives them the record's
  // own-ability bodies (ownHeader): those bodies compile first, and a self-grant leaf in any body or the
  // host lowers to one ability-grant per own body on its own target.
  const isSelfGrant = (leaf: CompileLeaf) => leaf.family_id === "ability-record-grant" && leaf.parameters.printed === undefined
    && abilityId !== undefined && leaf.parameters.ability === abilityId;
  let ownGranted: GrantedBody[] = [];
  const withSelfGrant = (leaves: CompileLeaf[]) => ownGranted.length === 0 ? leaves
    : leaves.map((leaf) => isSelfGrant(leaf) ? { ...leaf, parameters: { ...leaf.parameters, granted: ownGranted } } : leaf);
  const compileBodies = (bodies: Fold["bodies"]) => {
  for (const body of bodies) {
    const name = abilityId ? `${body.label ?? "The unnamed granted ability"} in ${abilityId}` : body.label ?? "The unnamed granted ability";
    let lead: ReturnType<typeof leadingNarrowing>;
    try { lead = leadingNarrowing(body.leaves, sourceText); } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      errors.push(`${name}: ${error.message}`);
      continue;
    }
    if (lead && selfHeld(body.header)) { errors.push(`${name}: a units-only section cannot narrow a self-held ability.`); continue; }
    const compiled = compileBody(withSelfGrant(lead ? lead.rest : body.leaves), sourceText);
    if (!compiled.ok) { errors.push(...compiled.errors.map((error) => `${name}: ${error}`)); continue; }
    const refused = compiled.core || compiled.checks.some((check) => !ownStratagemCheck(check, compiled.mechanics.trigger));
    if (refused) { errors.push(`${name}: a granted ability cannot hold a Stratagem target or a bearer restriction.`); continue; }
    bodyChecks.push(...compiled.checks);
    if (selfHeld(body.header) && compiled.mechanics.behavior) behaviors.push(compiled.mechanics.behavior);
    const list = granted.get(body.header) ?? [];
    const ability = body.label ? (abilityId ? { ability_id: abilityId, definition_id: slug(body.label) } : slug(body.label)) : undefined;
    list.push({ ...(ability ? { ability } : {}), part: bodyPart(body.label, compiled), ...(lead ? { narrow: lead.narrow } : {}) });
    granted.set(body.header, list);
  }
  };
  const ownHeader = (header: CompileLeaf) => {
    const before = list[list.indexOf(header) - 1];
    return before?.family_id === "unit-has-ability" && before.fragment === header.fragment && before.parameters.own === true;
  };
  compileBodies(fold.bodies.filter((body) => ownHeader(body.header)));
  ownGranted = [...granted.values()].flat();
  compileBodies(fold.bodies.filter((body) => !ownHeader(body.header)));
  if (errors.length) return { ok: false, signature, errors };
  const host = fold.host.map((leaf) => {
    if (granted.has(leaf)) return { ...leaf, parameters: { ...leaf.parameters, granted: granted.get(leaf), ...(selfHeld(leaf) ? { granted_self: true } : {}) } };
    if (isSelfGrant(leaf) && ownGranted.length) return { ...leaf, parameters: { ...leaf.parameters, granted: ownGranted } };
    return leaf;
  });
  const result = compileHost(host, sourceText);
  if (!result.ok) return { ...result, signature };
  // A self-held ability is part of the record's own: the record reads as its liveliest part.
  const rank = Math.max(...[result.mechanics.behavior ?? "passive", ...behaviors].map((behavior) => BEHAVIOR_RANK.indexOf(behavior)));
  // A body's own Stratagem check belongs to the record: its id is checked against the core Stratagem.
  return { ...result, signature, checks: [...result.checks, ...bodyChecks], mechanics: { ...result.mechanics, behavior: BEHAVIOR_RANK[rank] ?? result.mechanics.behavior } };
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
    : { type: "ability-grant", target: structuredClone(body.narrow ? narrowTarget(target, body.narrow) : target), modifier: { ...(body.ability ? { ability: body.ability } : {}), definition: structuredClone(body.part) } });
  return nodes.length === 1 ? nodes[0]! : { type: "sequence", steps: nodes };
}
