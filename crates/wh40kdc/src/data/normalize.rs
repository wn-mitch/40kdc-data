//! Name normalization for diacritic- and punctuation-insensitive lookup.
//!
//! Warhammer 40,000 is played globally and many entity names carry diacritics or
//! punctuation — "Khârn the Betrayer", "T'au", "Be'lakor". A user typing the
//! plain-ASCII form of a name must still find the entity. Every name comparison
//! in this crate routes through [`normalize_name`] so the matching rule is
//! defined in exactly one place; it is exported so consumers can reproduce the
//! same behaviour in their own search UIs.
//!
//! This is the Rust mirror of the TypeScript `normalizeName`
//! (`tools/src/data/normalize.ts`); the two implementations are pinned together
//! by the shared `conformance/normalize.json` corpus.

use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

/// Reduce a display name to a canonical lookup key.
///
/// The transform, in order:
/// 1. Unicode NFD-decompose, then strip combining marks — `Khârn` → `Kharn`.
/// 2. Casefold to lower case.
/// 3. Remove apostrophe and quote variants (`'`, `’`, `‘`, `` ` ``, `"`, `“`,
///    `”`) — `T'au` → `Tau`.
/// 4. Collapse any run of whitespace or dashes (ASCII `-`, U+2010–U+2015,
///    U+2212) to a single space, then trim — `Be'lakor` → `belakor`,
///    `the   betrayer` → `the betrayer`, `Grav‑Tank` → `grav tank`.
///
/// The result is intended only for comparison; it is not a display value.
///
/// # Examples
///
/// ```
/// use wh40kdc::normalize_name;
///
/// assert_eq!(normalize_name("Khârn the Betrayer"), "kharn the betrayer");
/// assert_eq!(normalize_name("T'au"), "tau");
/// assert_eq!(normalize_name("Be'lakor"), "belakor");
/// assert_eq!(normalize_name("  Adeptus   Astartes  "), "adeptus astartes");
/// ```
pub fn normalize_name(input: &str) -> String {
    // NFD-decompose, drop combining marks, then lowercase. Ordering matches the
    // TS `.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()`.
    let decomposed: String = input.nfd().filter(|c| !is_combining_mark(*c)).collect();

    let mut out = String::with_capacity(decomposed.len());
    let mut pending_space = false;
    for c in decomposed.chars().flat_map(char::to_lowercase) {
        match c {
            // Apostrophe / quote variants are removed outright (not spaced),
            // so `T'au` → `tau` rather than `t au`.
            '\'' | '\u{2019}' | '\u{2018}' | '`' | '"' | '\u{201C}' | '\u{201D}' => {}
            // Whitespace and dashes collapse to a single separating space; a
            // leading run is suppressed (out is still empty) and a trailing run
            // is dropped because the space is only flushed before the next char.
            _ if c.is_whitespace() || is_dash(c) => {
                if !out.is_empty() {
                    pending_space = true;
                }
            }
            _ => {
                if pending_space {
                    out.push(' ');
                    pending_space = false;
                }
                out.push(c);
            }
        }
    }
    out
}

/// The ASCII hyphen-minus, the Unicode hyphens and dashes U+2010–U+2015, and
/// the minus sign U+2212. GW's data keeps the non-breaking hyphen (`Grav‑Tank`,
/// U+2011) while roster exports print the ASCII `Grav-Tank`.
fn is_dash(c: char) -> bool {
    matches!(c, '-' | '\u{2010}'..='\u{2015}' | '\u{2212}')
}

/// Strip a leading "The " (case-insensitive, after trimming) from a display
/// name, returning the remainder. Returns `None` when there is no leading
/// "The " to strip.
///
/// Used only by roster import to bridge the leading-article mismatch between
/// data names and roster exports in BOTH directions ("The Bloody Twins" ↔
/// "Bloody Twins", "Fire Axe" ↔ "The Fire Axe"). Deliberately NOT folded into
/// [`normalize_name`]: that key is shared by unit, faction, and ability lookup,
/// where dropping a leading "The" would collide distinct entities (e.g. "The
/// Emperor's Champion"). Mirror of the TS `stripLeadingThe`.
pub fn strip_leading_the(input: &str) -> Option<String> {
    let trimmed = input.trim();
    // Byte length of the first three characters, so the prefix slice is valid
    // even if they are multi-byte (no ASCII assumption).
    let mut prefix_end = 0;
    let mut chars = trimmed.chars();
    for _ in 0..3 {
        match chars.next() {
            Some(c) => prefix_end += c.len_utf8(),
            None => return None,
        }
    }
    if !trimmed[..prefix_end].eq_ignore_ascii_case("the") {
        return None;
    }
    let after = &trimmed[prefix_end..];
    let rest = after.trim_start();
    // Require at least one stripped whitespace char (so "theatre" is rejected)
    // and a non-empty remainder.
    if rest.len() == after.len() || rest.is_empty() {
        return None;
    }
    Some(rest.to_string())
}

#[cfg(test)]
mod tests {
    use super::normalize_name;

    #[test]
    fn strips_diacritics() {
        assert_eq!(normalize_name("Khârn the Betrayer"), "kharn the betrayer");
        assert_eq!(normalize_name("Magnús"), "magnus");
    }

    #[test]
    fn removes_quote_variants() {
        assert_eq!(normalize_name("T'au"), "tau");
        assert_eq!(normalize_name("Be'lakor"), "belakor");
        assert_eq!(normalize_name("\u{2018}quoted\u{2019}"), "quoted");
    }

    #[test]
    fn collapses_whitespace_and_hyphens() {
        assert_eq!(normalize_name("the   betrayer"), "the betrayer");
        assert_eq!(normalize_name("space--marines"), "space marines");
        assert_eq!(
            normalize_name("  leading and trailing  "),
            "leading and trailing"
        );
    }

    #[test]
    fn distinct_names_stay_distinct() {
        assert_ne!(normalize_name("Khorne"), normalize_name("Khârn"));
    }
}
