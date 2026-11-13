/**
 * Name normalization for diacritic- and punctuation-insensitive lookup.
 *
 * Warhammer 40,000 is played globally and many entity names carry diacritics or
 * punctuation — "Khârn the Betrayer", "T'au", "Be'lakor". A user typing the
 * plain-ASCII form of a name must still find the entity. Every name comparison
 * in this package routes through {@link normalizeName} so the matching rule is
 * defined in exactly one place; consumers can import it to reproduce the same
 * behaviour in their own search UIs.
 *
 * @packageDocumentation
 */

/**
 * Reduce a display name to a canonical lookup key.
 *
 * The transform, in order:
 * 1. Unicode NFD-decompose, then strip combining marks — `Khârn` → `Kharn`.
 * 2. Casefold to lower case.
 * 3. Remove apostrophe and quote variants (`' ’ ‘ \` " “ ”`) — `T'au` → `Tau`.
 * 4. Collapse any run of whitespace or dashes to a single space, then trim —
 *    `Be'lakor` → `belakor`, `the   betrayer` → `the betrayer`. A dash is the
 *    ASCII hyphen-minus, the Unicode hyphens and dashes U+2010–U+2015, or the
 *    minus sign U+2212, so GW's non-breaking hyphen in `Grav‑Tank` (U+2011)
 *    matches the ASCII `Grav-Tank` a roster export prints.
 *
 * The result is intended only for comparison; it is not a display value.
 *
 * @example
 * normalizeName("Khârn the Betrayer"); // "kharn the betrayer"
 * normalizeName("T'au");               // "tau"
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFD")
    // Strip the Unicode Mark category (Mn/Mc/Me) — every combining mark.
    // \p{Diacritic} is a smaller property that misses some Mn characters,
    // which let TS and Rust drift apart on non-Latin combining marks (the
    // Rust mirror uses unicode-normalization's is_combining_mark, which is
    // \p{M}). The cross-impl property fuzz in tooling/parity/ surfaces the
    // divergence; the documented contract in CONFORMANCE.md is "strip
    // combining marks", so \p{M} is canonical.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’‘`"“”]/g, "")
    .replace(/[\s\-\u2010-\u2015\u2212]+/g, " ")
    .trim();
}

/**
 * Strip a leading "The " (case-insensitive, after trimming) from a display
 * name, returning the remainder. Returns `null` when there is no leading
 * "The " to strip, so callers can cheaply tell whether a retry is worthwhile.
 *
 * Used only by roster import to bridge the leading-article mismatch between
 * data names and roster exports in BOTH directions ("The Bloody Twins" ↔
 * "Bloody Twins", "Fire Axe" ↔ "The Fire Axe"). This is deliberately NOT
 * folded into {@link normalizeName}: that key is shared by unit, faction, and
 * ability lookup, where dropping a leading "The" would collide distinct
 * entities (e.g. "The Emperor's Champion").
 *
 * @example
 * stripLeadingThe("The Bloody Twins"); // "Bloody Twins"
 * stripLeadingThe("Bloody Twins");     // null
 */
export function stripLeadingThe(input: string): string | null {
  const m = /^the\s+(.+)$/i.exec(input.trim());
  return m ? m[1].trim() : null;
}
