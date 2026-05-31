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
 * 4. Collapse any run of whitespace or hyphens to a single space, then trim —
 *    `Be'lakor` → `belakor`, `the   betrayer` → `the betrayer`.
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
    .replace(/[\s-]+/g, " ")
    .trim();
}
