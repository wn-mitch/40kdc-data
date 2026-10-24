/**
 * Span-preserving edits to a JSON file whose top level is an array (data files) or an object
 * (`vocab-overrides.json`): per-element value replacement through `round6/json-spans.ts`, element
 * removal and append, and object member rename and removal. Bytes outside the edited spans stay
 * as the file wrote them.
 */
import { applyReplacements, escapesNonAscii, type Replacement } from "../../round6/json-spans.js";

function skipWs(t: string, i: number): number {
  while (i < t.length && " \t\r\n".includes(t[i]!)) i++;
  return i;
}

function skipString(t: string, i: number): number {
  i++;
  while (t[i] !== '"') {
    if (i >= t.length) throw new Error("unterminated string");
    i += t[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}

function skipValue(t: string, i: number): number {
  i = skipWs(t, i);
  const c = t[i];
  if (c === '"') return skipString(t, i);
  if (c === "{" || c === "[") {
    let depth = 0;
    for (;;) {
      const ch = t[i]!;
      if (ch === '"') {
        i = skipString(t, i);
        continue;
      }
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
  }
  while (i < t.length && !",}] \t\r\n".includes(t[i]!)) i++;
  return i;
}

interface Span {
  start: number;
  end: number;
}

/** The top-level array's open/close offsets and each element's span. */
function arrayLayout(text: string): { open: number; close: number; elements: Span[] } {
  const open = skipWs(text, 0);
  if (text[open] !== "[") throw new Error("top level is not an array");
  const elements: Span[] = [];
  let i = skipWs(text, open + 1);
  if (text[i] === "]") return { open, close: i, elements };
  for (;;) {
    const end = skipValue(text, i);
    elements.push({ start: i, end });
    i = skipWs(text, end);
    if (text[i] === ",") {
      i = skipWs(text, i + 1);
      continue;
    }
    if (text[i] !== "]") throw new Error(`expected , or ] at ${i}`);
    return { open, close: i, elements };
  }
}

const toAscii = (s: string): string => s.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function setIn(root: unknown, path: ReadonlyArray<string | number>, value: unknown): void {
  let cur = root as Record<string | number, unknown>;
  for (const step of path.slice(0, -1)) cur = (cur[step] ??= {}) as Record<string | number, unknown>;
  cur[path[path.length - 1]!] = value;
}

/** Append members to a multi-line object element, in the indentation its members use. */
function insertMembers(el: string, entries: [string, unknown][], indent: string): string {
  const m = /\n([ \t]*)"/.exec(el);
  const close = el.lastIndexOf("}");
  if (!m || close < 0) throw new Error("not a multi-line object");
  const memberIndent = m[1]!;
  let end = close;
  while (end > 0 && " \t\r\n".includes(el[end - 1]!)) end--;
  const add = entries.map(([k, v]) => `,\n${memberIndent}${JSON.stringify(k)}: ${JSON.stringify(v, null, 2).replace(/\n/g, `\n${memberIndent}`)}`).join("");
  void indent;
  return el.slice(0, end) + add + el.slice(end);
}

export interface ArrayEdit {
  /** Element index → replacements inside that element (paths relative to the element). */
  replace?: Map<number, Replacement[]>;
  /** Element indices to drop. */
  remove?: Set<number>;
  /** Values appended after the last element. */
  append?: unknown[];
}

/**
 * Apply per-element replacements, removals and appends to a top-level JSON array. The separator
 * and indentation come from the file itself; an unchanged file returns the same string.
 */
export function editArray(text: string, edit: ArrayEdit): string {
  const { open, close, elements } = arrayLayout(text);
  const escapes = escapesNonAscii(text);
  const sep = elements.length > 1 ? text.slice(elements[0]!.end, elements[1]!.start) : ",\n  ";
  const lead = elements.length ? text.slice(open + 1, elements[0]!.start) : "\n  ";
  const tail = elements.length ? text.slice(elements[elements.length - 1]!.end, close) : "\n";
  const indent = /[ \t]*$/.exec(lead)![0];
  const parts: string[] = [];
  elements.forEach((span, i) => {
    if (edit.remove?.has(i)) return;
    let el = text.slice(span.start, span.end);
    const reps = edit.replace?.get(i);
    if (reps?.length) {
      // The element's first line sits at `indent`; pad so nested values indent as they do in place.
      const parsed = JSON.parse(el) as Record<string, unknown>;
      // A top-level key the element lacks is inserted after its last member.
      const missing = reps.filter((r) => r.path.length === 1 && parsed && typeof parsed === "object" && !Array.isArray(parsed) && !(String(r.path[0]) in parsed));
      const present = reps.filter((r) => !missing.includes(r));
      const padded = indent + el;
      try {
        el = (present.length ? applyReplacements(padded, present) : padded).slice(indent.length);
        if (missing.length) el = insertMembers(el, missing.map((r) => [String(r.path[0]), r.value] as [string, unknown]), indent);
      } catch {
        // A path that does not exist yet (a key the element lacks): rewrite the element whole.
        const value = JSON.parse(el) as unknown;
        for (const r of reps) setIn(value, r.path, r.value);
        el = JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
      }
      if (escapes) el = toAscii(el);
    }
    parts.push(el);
  });
  for (const v of edit.append ?? []) {
    let s = JSON.stringify(v, null, 2).replace(/\n/g, `\n${indent}`);
    if (escapes) s = toAscii(s);
    parts.push(s);
  }
  if (!parts.length) return `${text.slice(0, open)}[]${text.slice(close + 1)}`;
  const leadOut = elements.length ? lead : `\n${indent}`;
  const tailOut = elements.length ? tail : "\n";
  return `${text.slice(0, open + 1)}${leadOut}${parts.join(sep)}${tailOut}${text.slice(close)}`;
}

export interface Member {
  key: string;
  keyStart: number;
  valueEnd: number;
}

/** The top-level object's members in file order. */
export function objectMembers(text: string): { open: number; close: number; members: Member[] } {
  const open = skipWs(text, 0);
  if (text[open] !== "{") throw new Error("top level is not an object");
  const members: Member[] = [];
  let i = skipWs(text, open + 1);
  if (text[i] === "}") return { open, close: i, members };
  for (;;) {
    const keyEnd = skipString(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    let j = skipWs(text, keyEnd);
    if (text[j] !== ":") throw new Error(`expected : at ${j}`);
    const valueEnd = skipValue(text, skipWs(text, j + 1));
    members.push({ key, keyStart: i, valueEnd });
    j = skipWs(text, valueEnd);
    if (text[j] === ",") {
      i = skipWs(text, j + 1);
      continue;
    }
    if (text[j] !== "}") throw new Error(`expected , or } at ${j}`);
    return { open, close: j, members };
  }
}

/** Rename (to a string) or drop (null) top-level object members by key; values keep their bytes. */
export function editObjectKeys(text: string, keys: Map<string, string | null>): string {
  const { open, close, members } = objectMembers(text);
  if (!members.length) return text;
  const sep = members.length > 1 ? text.slice(members[0]!.valueEnd, members[1]!.keyStart) : ",\n  ";
  const lead = text.slice(open + 1, members[0]!.keyStart);
  const tail = text.slice(members[members.length - 1]!.valueEnd, close);
  const escapes = escapesNonAscii(text);
  const parts: string[] = [];
  for (const m of members) {
    const target = keys.has(m.key) ? keys.get(m.key)! : m.key;
    if (target === null) continue;
    const body = text.slice(m.keyStart, m.valueEnd);
    if (target === m.key) {
      parts.push(body);
      continue;
    }
    const keyEnd = skipString(text, m.keyStart);
    const k = escapes ? toAscii(JSON.stringify(target)) : JSON.stringify(target);
    parts.push(k + text.slice(keyEnd, m.valueEnd));
  }
  if (!parts.length) return `${text.slice(0, open)}{}${text.slice(close + 1)}`;
  return `${text.slice(0, open + 1)}${lead}${parts.join(sep)}${tail}${text.slice(close)}`;
}
