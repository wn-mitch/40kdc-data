/**
 * Locate a value inside JSON text by its key path, so a migration can replace that value
 * and leave every other byte (escape style, inline arrays, key order) as the file wrote it.
 */

function skipWs(t: string, i: number): number {
  while (i < t.length && " \t\r\n".includes(t[i]!)) i++;
  return i;
}

function skipString(t: string, i: number): number {
  i++;
  while (t[i] !== '"') i += t[i] === "\\" ? 2 : 1;
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

/** The [start, end) offsets of the value at `path` (object keys and array indices). */
export function valueSpan(text: string, path: ReadonlyArray<string | number>): [number, number] {
  let i = skipWs(text, 0);
  for (const step of path) {
    if (text[i] === "{") {
      i = skipWs(text, i + 1);
      for (;;) {
        const keyEnd = skipString(text, i);
        const key = JSON.parse(text.slice(i, keyEnd)) as string;
        i = skipWs(text, keyEnd);
        if (text[i] !== ":") throw new Error(`expected ':' at ${i}`);
        i = skipWs(text, i + 1);
        if (key === step) break;
        i = skipWs(text, skipValue(text, i));
        if (text[i] !== ",") throw new Error(`key ${String(step)} not found`);
        i = skipWs(text, i + 1);
      }
    } else if (text[i] === "[") {
      if (typeof step !== "number") throw new Error(`index expected, got ${String(step)}`);
      i = skipWs(text, i + 1);
      for (let n = 0; n < step; n++) {
        i = skipWs(text, skipValue(text, i));
        if (text[i] !== ",") throw new Error(`index ${step} out of range`);
        i = skipWs(text, i + 1);
      }
    } else throw new Error(`cannot step into ${text[i]} at ${i}`);
  }
  return [i, skipValue(text, i)];
}

/** Whether the file writes non-ASCII as `\uXXXX` escapes rather than literal UTF-8. */
export function escapesNonAscii(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\\u[0-9a-fA-F]{4}/.test(text) && !/[^\x00-\x7f]/.test(text);
}

/** Serialize `value` as it would sit at `start` in `text`: the line's indent, the file's escapes. */
export function serializeAt(text: string, start: number, value: unknown, compact: boolean): string {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const indent = /^[ ]*/.exec(text.slice(lineStart, start))![0];
  let out = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
  if (escapesNonAscii(text)) out = out.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return out;
}

export type Replacement = { path: ReadonlyArray<string | number>; value: unknown };

/** Apply replacements (disjoint paths) to `text`, each written in the style of what it replaces. */
export function applyReplacements(text: string, replacements: Replacement[]): string {
  const spans = replacements.map((r) => {
    const [start, end] = valueSpan(text, r.path);
    // A value the file wrote on one line stays on one line.
    const compact = !text.slice(start, end).includes("\n");
    return { start, end, text: serializeAt(text, start, r.value, compact) };
  });
  spans.sort((a, b) => b.start - a.start);
  let out = text;
  let last = Infinity;
  for (const s of spans) {
    if (s.end > last) throw new Error("overlapping replacements");
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
    last = s.start;
  }
  return out;
}
