//! The shared words of the effect describer: the rendering context, subject phrases for effect
//! targets, verb agreement, and the name tables for characteristics, rolls, tests and pools.
//! Mirrors `tools/src/translate/effect-words.ts`. ASCII-only; pinned byte-for-byte across the
//! ports by `conformance/effect-translation`.
//!
//! Everything reads the effect's JSON form with the TS oracle's JS semantics: `jstr` is the
//! template stringification, `num` is `Number(v)`, and `nn` is `v != null`.

pub(crate) use super::js::*;
pub(crate) use super::subject::*;
use serde_json::Value;

use crate::translate::condition::{nn, P};
use crate::translate::dekebab;

/// Rendering context threaded down from the containers to the leaves.
#[derive(Default, Clone)]
pub(crate) struct Ctx {
    /// Inside a `select-units` / `for-each-unit`: the selected unit reads "that unit".
    pub selected_unit: bool,
    /// Inside a model-level selection: the selected model reads "that model".
    pub selected_model: bool,
    /// Explicit beneficiary binding inside a designated attack.
    pub unit_subject: Option<String>,
    /// Inside an aura: the recipient reads "that unit".
    pub aura_recipient: bool,
    /// The ability's trigger already says a unit or model is destroyed; leaves must not repeat it.
    pub destroyed_trigger: bool,
}

impl Ctx {
    /// TS `ctx.unitSubject` truthiness (a non-empty binding).
    pub(crate) fn unit_subject(&self) -> Option<&str> {
        self.unit_subject.as_deref().filter(|s| !s.is_empty())
    }
}

// ── Words ───────────────────────────────────────────────────────────────────

/// Uppercase the first character (idempotent; leaves the rest untouched).
pub(crate) fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

const TITLE_SMALL: &[&str] = &[
    "of", "or", "and", "the", "a", "an", "to", "in", "on", "for", "with",
];

/// kebab/space → Title Case (`deep-strike` → `Deep Strike`, small words stay lowercase mid-phrase).
pub(crate) fn title_case(s: &str) -> String {
    dekebab(s)
        .split(' ')
        .enumerate()
        .map(|(i, w)| {
            if w.is_empty() {
                w.to_string()
            } else if i > 0 && TITLE_SMALL.contains(&w.to_lowercase().as_str()) {
                w.to_lowercase()
            } else {
                capitalize(w)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Dice tokens print with a capital `D` (`d3` → `D3`, `2d6` → `2D6`).
pub(crate) fn dice_case(v: Option<&Value>) -> String {
    jstr(v).replace('d', "D")
}

/// `^anti[\s-]+(.*)$` (case-insensitive): the remainder after an `anti` prefix and ≥1 separator.
fn strip_anti_prefix(raw: &str) -> Option<&str> {
    let prefix = raw.get(..4)?;
    if !prefix.eq_ignore_ascii_case("anti") {
        return None;
    }
    let after = &raw[4..];
    let rest = after.trim_start_matches(|c: char| c.is_whitespace() || c == '-');
    if rest.len() == after.len() {
        return None;
    }
    Some(rest)
}

/// `^(.*?)[\s-]*(\d+)\s*(?:\+|plus)?$` (case-insensitive): the earliest (name, number) split.
fn split_trailing_number(s: &str) -> Option<(&str, &str)> {
    fn number_suffix(suffix: &str) -> Option<&str> {
        let body = suffix.trim_start_matches(|c: char| c.is_whitespace() || c == '-');
        let digits_end = body
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(body.len());
        if digits_end == 0 {
            return None;
        }
        let tail = body[digits_end..].trim_start_matches(char::is_whitespace);
        (tail.is_empty() || tail == "+" || tail.eq_ignore_ascii_case("plus"))
            .then_some(&body[..digits_end])
    }
    let cuts = s
        .char_indices()
        .map(|(i, _)| i)
        .chain(std::iter::once(s.len()));
    for p in cuts {
        if let Some(digits) = number_suffix(&s[p..]) {
            return Some((&s[..p], digits));
        }
    }
    None
}

/// A GW weapon keyword token → bracketed caps (`lethal-hits` → `[LETHAL HITS]`).
/// Anti-X keywords keep their hyphen and normalize the threshold to `N+`.
pub(crate) fn bracket_keyword(k: &Value) -> String {
    let raw = jv(k);
    let raw = raw.trim();
    if let Some(anti) = strip_anti_prefix(raw) {
        if let Some((name, n)) = split_trailing_number(anti) {
            return format!("[ANTI-{} {n}+]", dekebab(name).trim().to_uppercase());
        }
        return format!("[ANTI-{}]", dekebab(anti).trim().to_uppercase());
    }
    format!("[{}]", dekebab(raw).to_uppercase())
}

pub(crate) fn test_name(test: Option<&Value>) -> String {
    let t = jstr(test);
    match t.as_str() {
        "battle-shock" => "Battle-shock".to_string(),
        "desperate-escape" => "Desperate Escape".to_string(),
        _ => title_case(&t),
    }
}

/// Does a subject noun phrase take a plural verb? (`enemy units within 6"`, `all friendly units`).
pub(crate) fn is_plural(subj: &str) -> bool {
    has_word_end(subj, " units")
        || has_word_end(subj, " models")
        || subj.starts_with("all ")
        || subj.starts_with("targets ")
}

/// Subject-verb agreement: the plural form of a present-tense verb when the subject is plural.
pub(crate) fn v(subj: &str, singular: &str) -> String {
    if !is_plural(subj) {
        return singular.to_string();
    }
    let plural = match singular {
        "has" => "have",
        "is" => "are",
        "gets" => "get",
        "gains" => "gain",
        "suffers" => "suffer",
        "retains" => "retain",
        "makes" => "make",
        "passes" => "pass",
        "fails" => "fail",
        "treats" => "treat",
        "regains" => "regain",
        "counts" => "count",
        "ignores" => "ignore",
        "loses" => "lose",
        "scores" => "score",
        "takes" => "take",
        "resolves" => "resolve",
        "does" => "do",
        "controls" => "control",
        other => return other.strip_suffix('s').unwrap_or(other).to_string(),
    };
    plural.to_string()
}

pub(crate) fn stat_name(stat: Option<&Value>) -> String {
    let s = jstr(stat);
    let name = match s.as_str() {
        "M" => "Move",
        "T" => "Toughness",
        "Sv" => "Save",
        "W" => "Wounds",
        "A" => "Attacks",
        "Ld" => "Leadership",
        "OC" => "Objective Control",
        "S" => "Strength",
        "WS" => "Weapon Skill",
        "BS" => "Ballistic Skill",
        "AP" => "Armour Penetration",
        "D" => "Damage",
        "Range" => "Range",
        "detection-range" => "detection range",
        _ => return title_case(&s),
    };
    name.to_string()
}

/// The unit of resource a pool holds, singular, for pools whose id does not name it.
fn pool_unit(base: &str) -> Option<&'static str> {
    Some(match base {
        "blood-tithe" => "Blood Tithe point",
        "battle-focus" => "Battle Focus token",
        "yp" => "YP",
        _ => return None,
    })
}

/// Countable nouns a pool id can end in: singular → plural.
fn pool_noun(word: &str) -> Option<(&'static str, &'static str)> {
    Some(match word {
        "dice" | "die" => ("die", "dice"),
        "token" | "tokens" => ("token", "tokens"),
        "point" | "points" => ("point", "points"),
        "marker" => ("marker", "markers"),
        _ => return None,
    })
}

/// A pool's noun: its author label (pluralized by count), else the resource the pool holds —
/// "1 Miracle die", "2 Pain tokens" — never the pool itself ("1 Miracle Dice Pool").
pub(crate) fn resource_noun(
    pool: Option<&Value>,
    label: Option<&Value>,
    count: Option<&Value>,
) -> String {
    let one = num_of_jstr(count) == 1.0;
    if let Some(label) = label.and_then(Value::as_str).filter(|l| !l.is_empty()) {
        return if one {
            label.to_string()
        } else {
            format!("{label}s")
        };
    }
    let id = jstr(pool).to_lowercase();
    if id == "cp" {
        return "CP".to_string();
    }
    let base = id.strip_suffix("-pool").unwrap_or(&id);
    if let Some(unit) = pool_unit(base) {
        return if unit == "YP" || one {
            unit.to_string()
        } else {
            format!("{unit}s")
        };
    }
    let words: Vec<&str> = base.split('-').collect();
    let Some((singular, plural)) = pool_noun(words[words.len() - 1]) else {
        return title_case(base);
    };
    let head = title_case(&words[..words.len() - 1].join("-"));
    format!(
        "{}{}",
        if head.is_empty() {
            String::new()
        } else {
            format!("{head} ")
        },
        if one { singular } else { plural }
    )
}

pub(crate) fn roll_name(roll: Option<&Value>) -> String {
    let r = jstr(roll);
    let name = match r.as_str() {
        "hit" => "Hit",
        "wound" => "Wound",
        "charge" => "Charge",
        "damage" => "Damage",
        "advance" => "Advance",
        "save" => "saving throw",
        "leadership" => "Leadership",
        "battle-shock" => "Battle-shock",
        "desperate-escape" => "Desperate Escape",
        "normal-move" => "Normal move",
        "deadly-demise" => "Deadly Demise",
        "dark-pact" => "Dark Pact",
        "blessings-of-khorne" => "Blessings of Khorne",
        "resource-die" => "pool die",
        _ => return title_case(&r),
    };
    name.to_string()
}

/// `+1` / `-1` from an operation + value (a negative value flips the sign, so never `+-1`).
pub(crate) fn signed(operation: Option<&Value>, value: Option<&Value>) -> String {
    let op = operation.and_then(Value::as_str);
    let mut sign = if op == Some("add") || op == Some("improve") {
        1
    } else {
        -1
    };
    let n = num(value);
    let shown = if !n.is_nan() && n < 0.0 {
        sign = -sign;
        fnum(n.abs())
    } else {
        dice_case(value)
    };
    format!(
        "{}{}",
        if sign > 0 { "+" } else { "-" },
        shown.replace('d', "D")
    )
}

/// Dice comparison → "a 4+", "a 3 or less", etc. (for dice-gated thresholds).
pub(crate) fn format_comparison(comp: &str, threshold: Option<&Value>) -> String {
    let th = jstr(threshold);
    match comp {
        "lte" => format!("a {th} or less"),
        "gt" => format!("greater than {th}"),
        "lt" => format!("less than {th}"),
        "eq" => format!("exactly {th}"),
        _ => format!("a {th}+"),
    }
}

/// Possessive form of a subject noun phrase (`the unit` → `the unit's`).
pub(crate) fn possessive(s: &str) -> String {
    if s.ends_with('s') {
        format!("{s}'")
    } else {
        format!("{s}'s")
    }
}

/// `<subj>'s <rest>`, or `the <rest> of <subj>` when the subject is a clause ending in a range.
pub(crate) fn of_or_possessive(subj: &str, rest: &str) -> String {
    let clause = [" within ", " other than ", " that ", " with "]
        .iter()
        .any(|p| subj.contains(p));
    if clause || subj.ends_with('"') {
        format!("the {rest} of {subj}")
    } else {
        format!("{} {rest}", possessive(subj))
    }
}

/// The subject of a "cannot" clause: "all enemy units cannot …" reads "enemy units cannot …".
pub(crate) fn none_of(subj: &str) -> String {
    strip_all(subj)
}

/// Possessive pronoun agreeing with the subject (`its` / `their`).
pub(crate) fn pronoun(subj: &str) -> &'static str {
    if is_plural(subj) {
        "their"
    } else {
        "its"
    }
}

/// The display label for an ability id: a curated override, else Title Case.
pub(crate) fn ability_label(id: Option<&Value>) -> String {
    let id = jstr(id);
    match id.as_str() {
        "nurgle-s-gift-aura" => "Nurgle's Gift (Aura)".to_string(),
        "fights-first" => "Fights First".to_string(),
        _ => title_case(&id),
    }
}

/// The display name for a granted weapon id: a curated override, else Title Case.
pub(crate) fn weapon_label(id: Option<&Value>) -> String {
    let id = jstr(id);
    match id.as_str() {
        "imperiums-sword" => "Imperium's Sword".to_string(),
        _ => title_case(&id),
    }
}

/// "melee weapons", "ranged Bolt Rifle weapons with [PISTOL]" — a weapon filter as a noun.
pub(crate) fn weapon_noun(m: &P) -> String {
    let kind = if truthy_key(m, "weapon_type") {
        format!("{} ", jstr(m.get("weapon_type")))
    } else {
        String::new()
    };
    // A name that already carries the noun ("hellforged weapons") must not read "weapons weapons".
    let raw = if truthy_key(m, "weapon_name") {
        strip_weapons_suffix(&jstr(m.get("weapon_name")))
    } else {
        String::new()
    };
    let named = if is_kebab_slug(&raw) {
        title_case(&raw)
    } else {
        raw
    };
    let name = if named.is_empty() {
        String::new()
    } else {
        format!("{named} ")
    };
    let keyword = if truthy_key(m, "weapon_keyword") {
        format!(" with [{}]", jstr(m.get("weapon_keyword")).to_uppercase())
    } else {
        String::new()
    };
    format!("{kind}{name}weapons{keyword}")
}

/// `s.replace(/\s+weapons?$/i, "")`.
fn strip_weapons_suffix(s: &str) -> String {
    let lower = s.to_lowercase();
    for suffix in ["weapons", "weapon"] {
        if lower.ends_with(suffix) {
            let head = &s[..s.len() - suffix.len()];
            let trimmed = head.trim_end_matches(char::is_whitespace);
            if trimmed.len() < head.len() {
                return trimmed.to_string();
            }
        }
    }
    s.to_string()
}

/// `/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)`.
fn is_kebab_slug(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() > 1
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}

/// Whether a modifier carries a weapon filter.
pub(crate) fn has_weapon(m: &P) -> bool {
    nn(m, "weapon_type").is_some()
        || nn(m, "weapon_name").is_some()
        || nn(m, "weapon_keyword").is_some()
}

/// " with melee weapons" for a roll scoped to a weapon filter, else "".
pub(crate) fn weapon_roll_scope(m: &P) -> String {
    if has_weapon(m) {
        format!(" with {}", weapon_noun(m))
    } else {
        String::new()
    }
}

/// A tag an effect applies: GW-printed tags stay as printed, internal ones read "marked as …".
pub(crate) fn designation_for(tag: &str) -> String {
    if tag == tag.to_uppercase() {
        tag.to_string()
    } else {
        format!("marked as {}", dekebab(tag))
    }
}
