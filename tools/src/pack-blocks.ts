/**
 * Shared bbox-coordinate primitives for parsing GW 11e Faction Pack PDFs.
 *
 * GW lays each card out as discrete, positioned text blocks. `pdftotext
 * -bbox-layout` emits per-word coordinates; we group them into blocks and locate
 * cards by coordinate (column + reading-order y) rather than by the linear text
 * stream — `-layout` interleaves the packs' 2-column stratagem cards into garbage.
 *
 * These primitives are layout-independent (column positions differ across packs)
 * and are shared by two tools:
 *   - `extract-faction-pack.ts` — emits names + numeric/enum metadata only (the
 *     committed, IP-safe staging file). It never writes prose.
 *   - `author-input-pack.ts` — captures each card's rule body (prose) into the
 *     gitignored authoring worklist. It is the only consumer that emits prose.
 *
 * Keeping the coordinate machinery here lets both share it without weakening the
 * first tool's "never emits prose" property.
 *
 * Requires `pdftotext` (poppler) on PATH — authoring-time only, not CI.
 */
import { execFileSync } from "node:child_process";

/** A positioned text block from `pdftotext -bbox-layout`. `gy` is page-globalised y. */
export interface Block {
  x: number;
  gy: number;
  text: string;
}

/** Section headers (caps) that are never card/enhancement names. */
export const SECTION_WORDS = /^(DETACHMENT RULES?|ENHANCEMENTS?|STRATAGEMS?|KEYWORDS?|RESTRICTIONS?)$/;

export function runPdftotext(args: string[]): string {
  try {
    return execFileSync("pdftotext", args, { encoding: "utf-8", maxBuffer: 128 * 1024 * 1024 });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "ENOENT") {
      throw new Error("pdftotext not found — install poppler (e.g. `brew install poppler`).");
    }
    throw err;
  }
}

export const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

/**
 * Parse the whole pack's bbox-layout HTML into positioned blocks. `gy` globalises
 * y across pages (pageIndex × 100000 + y) so blocks sort in reading order without
 * relying on printed page numbers (which drift from physical pages on later pages
 * when full-bleed art is inserted).
 */
export function allBlocks(pdf: string): Block[] {
  const html = runPdftotext(["-bbox-layout", pdf, "-"]);
  const blocks: Block[] = [];
  html.split(/<page\b/).slice(1).forEach((pageHtml, pageIdx) => {
    const offset = pageIdx * 100000;
    for (const m of pageHtml.matchAll(/<block\b([^>]*)>([\s\S]*?)<\/block>/g)) {
      const x = Number(/xMin="([\d.]+)"/.exec(m[1])?.[1] ?? "0");
      const y = Number(/yMin="([\d.]+)"/.exec(m[1])?.[1] ?? "0");
      const words = [...m[2].matchAll(/<word[^>]*>([^<]*)<\/word>/g)].map((w) => decodeEntities(w[1]));
      const text = words.join(" ").replace(/\s+/g, " ").trim();
      if (text) blocks.push({ x, gy: offset + y, text });
    }
  });
  return blocks;
}

/** Title/caps name → kebab id, matching existing entity-id conventions. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Title-case a pack ALL-CAPS header for storage as a display name. */
export function titleCase(raw: string): string {
  const small = new Set(["of", "the", "and", "to", "a", "in", "for"]);
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export const normCaps = (s: string): string =>
  s.toUpperCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** A card/enhancement name candidate: a real caps header, not a section word or token. */
export const isCapsHeader = (t: string): boolean =>
  /^[A-Z0-9][A-Z0-9'’.,!&/()\- ]*$/.test(t) &&
  /[A-Z]{3,}/.test(t) && // a real word, not a "1CP"/"D6" token
  t.length >= 3 &&
  t.length <= 46 &&
  t.split(" ").length <= 7 &&
  !SECTION_WORDS.test(t) &&
  !/^\d+\s?CP$/.test(t) &&
  !/\bSTRATAGEM$/.test(t);

/** Two blocks share a column when their left edges are within tolerance. */
export const sameColumn = (a: number, b: number): boolean => Math.abs(a - b) < 46;

/** Split a trailing "… N CP" off a name block. */
export const stripCp = (t: string): { name: string; cp: number | null } => {
  const m = t.match(/^(.*?)[\s]+(\d+)\s?CP$/);
  return m ? { name: m[1].trim(), cp: Number(m[2]) } : { name: t, cp: null };
};
