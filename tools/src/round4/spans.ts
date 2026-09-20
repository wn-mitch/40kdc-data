import type { FrozenAbility, SpanBoundary, SpanLattice } from "./contracts.js";

export function plain(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<b>(.*?)<\/b>/gis, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&rsquo;|&#39;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
  return text || null;
}

export function byteOffsets(text: string): Uint32Array {
  const offsets = new Uint32Array(text.length + 1);
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    let width = 1;
    let units = 1;
    if (code < 0x80) width = 1;
    else if (code < 0x800) width = 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        width = 4;
        units = 2;
      } else width = 3;
    } else width = 3;
    bytes += width;
    for (let unit = 1; unit <= units; unit += 1) offsets[index + unit] = bytes;
    index += units;
  }
  return offsets;
}

export function isCharBoundary(bytes: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset > bytes.length) return false;
  if (offset === 0 || offset === bytes.length) return true;
  return ((bytes[offset] as number) & 0xc0) !== 0x80;
}

const CONNECTIVE = new RegExp(
  [
    "\\b(?:if|when|while|unless|after|before|until|then|otherwise|instead|and|or|but|provided)\\b",
    "\\beach\\s+time\\b",
    "\\bfor\\s+each\\b",
    "\\bas\\s+well\\b",
    "\\bin\\s+addition\\b",
  ].join("|"),
  "gi",
);
const LIST_MARKER = /(?:^|\n)[ \t]*([-*■•‣◦▪◾])[ \t]*/g;
const PUNCTUATION = new Set([".", ",", ";", ":"]);
const CELL_SEPARATOR = new Set(["\t", "|"]);

function addBoundary(found: Map<number, Set<string>>, offset: number, reason: string): void {
  const reasons = found.get(offset);
  if (reasons) reasons.add(reason);
  else found.set(offset, new Set([reason]));
}

export function buildSpanLattice(record: FrozenAbility): SpanLattice {
  const text = record.source_text;
  const offsets = byteOffsets(text);
  const total = offsets[text.length] as number;
  const found = new Map<number, Set<string>>();
  addBoundary(found, 0, "source-start");
  addBoundary(found, total, "source-end");

  for (const fragment of record.source_fragments) {
    addBoundary(found, fragment.start, "clause-field");
    addBoundary(found, fragment.end, "clause-field");
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char === "\n") {
      addBoundary(found, offsets[index] as number, "line-break");
      addBoundary(found, offsets[index + 1] as number, text[index + 1] === "\n" ? "paragraph-break" : "line-break");
    } else if (PUNCTUATION.has(char)) addBoundary(found, offsets[index + 1] as number, "punctuation");
    else if ("■•‣◦▪◾".includes(char)) addBoundary(found, offsets[index] as number, "bullet");
    else if (CELL_SEPARATOR.has(char)) {
      addBoundary(found, offsets[index] as number, "dice-row");
      addBoundary(found, offsets[index + 1] as number, "dice-row");
    }
  }
  for (const match of text.matchAll(CONNECTIVE)) {
    const start = match.index;
    addBoundary(found, offsets[start] as number, "connective");
    addBoundary(found, offsets[start + match[0].length] as number, "connective");
  }
  for (const match of text.matchAll(LIST_MARKER)) {
    addBoundary(found, offsets[match.index + match[0].length - 1] as number, "bullet");
  }

  const boundaries: SpanBoundary[] = [...found.entries()]
    .map(([offset, reasons]) => ({ offset, reasons: [...reasons].sort() }))
    .sort((left, right) => left.offset - right.offset);
  const atomic_intervals = boundaries.slice(0, -1).map((boundary, index) => ({
    start: boundary.offset,
    end: (boundaries[index + 1] as SpanBoundary).offset,
  }));
  const count = boundaries.length;
  return {
    source_byte_length: total,
    boundaries,
    atomic_intervals,
    clause_spans: record.source_fragments.map((fragment) => ({
      label: fragment.label,
      start: fragment.start,
      end: fragment.end,
    })),
    metrics: {
      atomic_interval_count: Math.max(0, count - 1),
      total_span_count: (count * (count + 1)) / 2,
    },
  };
}

export function utf8Span(text: string, utf16Start: number, utf16End: number): { start: number; end: number } {
  const offsets = byteOffsets(text);
  return { start: offsets[utf16Start] as number, end: offsets[utf16End] as number };
}
