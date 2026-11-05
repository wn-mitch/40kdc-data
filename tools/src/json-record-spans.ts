/**
 * Byte-preserving scanner for a `data/enrichment/<faction>/abilities.json` array: it finds each
 * record and its top-level members by offset, so a tool can splice edits into the original text
 * without re-serialising it.
 */

/** One member of a scanned JSON object, with the offsets of its key and value. */
export interface JsonMemberSpan {
  key: string;
  /** Offset of the opening quote of the key. */
  keyStart: number;
  /** Offset of the value's first character. */
  valueStart: number;
  /** Offset just past the value's last character. */
  valueEnd: number;
}

/** One scanned record of the top-level array, with its member offsets. */
export interface AbilityRecordSpan {
  /** Offset of the record's `{`. */
  start: number;
  /** Offset just past the record's `}`. */
  end: number;
  /** Top-level members only, in authored order. */
  members: JsonMemberSpan[];
}

function isJsonWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isJsonWhitespace(text[i])) i += 1;
  return i;
}

/** Skip a JSON string starting at its opening quote; returns the offset past it. */
function skipString(text: string, from: number): number {
  let i = from + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      // Skip the escape and whatever it escapes, so an escaped quote (or an
      // escaped backslash before a quote) cannot end the string early.
      i += 2;
      continue;
    }
    if (text[i] === '"') return i + 1;
    i += 1;
  }
  throw new Error("unterminated string");
}

/** Skip any JSON value; returns the offset just past it. */
function skipValue(text: string, from: number): number {
  const ch = text[from];
  if (ch === '"') return skipString(text, from);
  if (ch === "{" || ch === "[") {
    let i = from;
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i = skipString(text, i);
        continue;
      }
      if (c === "{" || c === "[") depth += 1;
      else if (c === "}" || c === "]") {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
    throw new Error("unterminated object or array");
  }
  // A number, `true`, `false` or `null`: runs to the next structural character.
  let i = from;
  while (i < text.length && !",}]".includes(text[i]) && !isJsonWhitespace(text[i])) {
    i += 1;
  }
  if (i === from) throw new Error("expected a value");
  return i;
}

/** Scan one object starting at its `{`, recording its top-level members. */
function scanObject(text: string, start: number): AbilityRecordSpan {
  let i = skipWhitespace(text, start + 1);
  const members: JsonMemberSpan[] = [];
  if (text[i] === "}") return { start, end: i + 1, members };
  for (;;) {
    i = skipWhitespace(text, i);
    if (text[i] !== '"') throw new Error("expected an object key");
    const keyStart = i;
    const keyEnd = skipString(text, i);
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    i = skipWhitespace(text, keyEnd);
    if (text[i] !== ":") throw new Error("expected ':' after an object key");
    const valueStart = skipWhitespace(text, i + 1);
    const valueEnd = skipValue(text, valueStart);
    members.push({ key, keyStart, valueStart, valueEnd });
    i = skipWhitespace(text, valueEnd);
    if (text[i] === ",") {
      i += 1;
      continue;
    }
    if (text[i] === "}") return { start, end: i + 1, members };
    throw new Error("expected ',' or '}' after an object member");
  }
}

/**
 * Locate every record of a `data/enrichment/<faction>/abilities.json` array in
 * its original text.
 *
 * This exists because the backfill must not re-serialise the file. The
 * committed tree does not share one JSON escape convention — some faction files
 * write `\uXXXX` escapes for typographic punctuation and others write the
 * literal UTF-8 — so any serialiser round-trips one half and rewrites the
 * other. `JSON.stringify` emits literal UTF-8 and would silently rewrite every
 * escaped `name` and `community_notes` value; an ASCII-escaping serialiser
 * would rewrite the literal ones. Neither is acceptable in a change that is
 * supposed to add one field.
 *
 * So the file is parsed to decide *what* to do and scanned to find *where*,
 * and the new text is the original text with digest edits spliced in. Every
 * other byte — escape style, spacing, key order, trailing newline — survives
 * untouched because it is never rewritten.
 *
 * @throws Error when the text is not a JSON array of objects. The caller has
 * already `JSON.parse`d the same text, so this only fires on a scanner bug.
 */
export function scanAbilityRecordSpans(text: string): AbilityRecordSpan[] {
  let i = skipWhitespace(text, 0);
  if (text[i] !== "[") throw new Error("expected a JSON array of annotations");
  i = skipWhitespace(text, i + 1);
  const spans: AbilityRecordSpan[] = [];
  if (text[i] === "]") return spans;
  for (;;) {
    i = skipWhitespace(text, i);
    if (text[i] !== "{") throw new Error("expected an annotation object");
    const span = scanObject(text, i);
    spans.push(span);
    i = skipWhitespace(text, span.end);
    if (text[i] === ",") {
      i += 1;
      continue;
    }
    if (text[i] === "]") return spans;
    throw new Error("expected ',' or ']' after an annotation");
  }
}
