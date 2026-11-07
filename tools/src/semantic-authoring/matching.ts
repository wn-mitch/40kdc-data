export type NormalizedProjection = { text: string; starts: number[]; ends: number[] };
const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });

export function normalizedProjection(source: string): NormalizedProjection {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let byteOffset = 0;
  let whitespaceStart: number | null = null;
  let whitespaceEnd: number | null = null;
  const append = (character: string, start: number, end: number): void => {
    text += character;
    for (let index = 0; index < character.length; index += 1) {
      starts.push(start);
      ends.push(end);
    }
  };
  const flushWhitespace = (): void => {
    if (whitespaceStart === null || whitespaceEnd === null) return;
    if (text.length > 0) append(" ", whitespaceStart, whitespaceEnd);
    whitespaceStart = null;
    whitespaceEnd = null;
  };
  for (const { segment: sourceGrapheme } of GRAPHEME_SEGMENTER.segment(source)) {
    const start = byteOffset;
    byteOffset += Buffer.byteLength(sourceGrapheme, "utf8");
    const end = byteOffset;
    const normalized = sourceGrapheme.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—]/gu, "-");
    for (const character of normalized) {
      if (/\s/u.test(character)) {
        whitespaceStart ??= start;
        whitespaceEnd = end;
      } else {
        flushWhitespace();
        append(character, start, end);
      }
    }
  }
  return { text, starts, ends };
}

export function normalizedSurface(source: string): string {
  return normalizedProjection(source).text;
}

const SURFACE_EDGE_PUNCTUATION = /^[\s\p{P}]+|[\s\p{P}]+$/gu;

/** Edge punctuation is not wording, except a sign introducing a numeric term. */
export function leafSurfaceKey(text: string): string {
  const normalized = normalizedSurface(text);
  const numeric = /^([\s\p{P}]*?)([+-−])\s*\d/u.exec(normalized);
  const wording = numeric
    ? normalized.slice(numeric[1]!.length).replace(/[\s\p{P}]+$/gu, "")
    : normalized.replace(SURFACE_EDGE_PUNCTUATION, "");
  return wording;
}
