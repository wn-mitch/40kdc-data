//! The shared words of the effect describer: the rendering context, subject phrases for effect
//! targets, verb agreement, and the name tables for characteristics, rolls, tests and pools.
//! Mirrors `tools/src/translate/effect-words.ts`. ASCII-only; pinned byte-for-byte across the
//! ports by `conformance/effect-translation`.
//!
//! Everything reads the effect's JSON form with the TS oracle's JS semantics: `jstr` is the
//! template stringification, `num` is `Number(v)`, and `nn` is `v != null`.

pub(crate) use super::js::*;
pub(crate) use super::quantity::*;
pub(crate) use super::subject::*;
use serde_json::Value;

use crate::translate::condition::{article, id_label, nn, obj, or_list, P};
use crate::translate::dekebab;
use crate::translate::designations::designation_label;

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

/// Dice tokens print with a capital `D` (`d3` → `D3`, `2d6` → `2D6`); a bound or counted
/// quantity prints its phrase.
pub(crate) fn dice_case(v: Option<&Value>) -> String {
    if let Some(Value::Object(q)) = v {
        return quantity_phrase(q);
    }
    jstr(v).replace('d', "D")
}

/// A structured catalog weapon keyword reference as a bracketed rules label.
pub(crate) fn bracket_keyword(k: &Value) -> String {
    let Some(reference) = k.as_object() else {
        return "[?]".to_string();
    };
    let parameters = obj(reference.get("parameters"));
    let name = dekebab(&jstr(reference.get("keyword_id"))).to_uppercase();
    let qualifier = |key, prefix| {
        map_arr(parameters, key, jv)
            .filter(|items| !items.is_empty())
            .map(|items| format!(" ({prefix} {} units)", or_list(&items)))
            .unwrap_or_default()
    };
    let against = qualifier("required_target_keywords_any", "against");
    let excluding = qualifier("excluded_target_keywords", "excluding");
    if sv(reference, "keyword_id") == Some("anti") {
        let target = nn(parameters, "target_keyword")
            .map(|target| format!("-{}", jv(target).to_uppercase()))
            .unwrap_or_default();
        let threshold = nn(parameters, "threshold")
            .map(|threshold| format!(" {}+", jv(threshold)))
            .unwrap_or_default();
        return format!("[ANTI{target}{threshold}]{against}{excluding}");
    }
    let value = nn(parameters, "value")
        .map(|value| format!(" {}", dice_case(Some(value))))
        .unwrap_or_default();
    format!("[{name}{value}]{against}{excluding}")
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
        "receives" => "receive",
        "keeps" => "keep",
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
    // The dice a named ability rolls: "Reanimation Protocols".
    if let Some(Value::Object(o)) = roll {
        if nn(o, "of_ability").is_some() {
            return ability_label(o.get("of_ability"));
        }
    }
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
        "manoeuvre" => "Agile Manoeuvre",
        "channelling" => "Channel the Warp",
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

/// The display name for an ability or Stratagem id: a curated override, else its name part in
/// Title Case.
pub(crate) fn ability_label(id: Option<&Value>) -> String {
    if let Some(reference) =
        id.filter(|id| id.get("definition_id").is_some() && id.get("ability_id").is_some())
    {
        return format!(
            "{} ({})",
            id_label(reference.get("definition_id")),
            ability_label(reference.get("ability_id"))
        );
    }
    let id = jstr(id);
    match id.as_str() {
        "nurgles-gift-death-guard" => "Nurgle's Gift (Aura)".to_string(),
        "fights-first" => "Fights First".to_string(),
        _ => id_label(Some(&Value::String(id))),
    }
}

/// `{rating: true}`: the rating the unit's datasheet prints for this rule (substituted when a
/// unit is known).
pub(crate) fn is_rating_ref(v: Option<&Value>) -> bool {
    v.and_then(Value::as_object)
        .is_some_and(|o| o.get("rating") == Some(&Value::Bool(true)))
}

/// The display name for a granted weapon id: a curated override, else Title Case of the id. A
/// trailing "-drone" is the disambiguator for a drone's weapon entity and is not printed.
pub(crate) fn weapon_label(id: Option<&Value>) -> String {
    let id = jstr(id);
    match id.as_str() {
        "imperiums-sword" | "imperiums-sword-assault-brethren" => "Imperium's Sword".to_string(),
        "tl-4-9-lords-of-the-forge" => "TL-4ø9".to_string(),
        "eadbanger-wurrband" => "'Eadbanger".to_string(),
        _ => title_case(id.strip_suffix("-drone").unwrap_or(&id)),
    }
}

/// "melee weapons", "ranged Bolt Rifle weapons with [PISTOL]" — a canonical weapon scope.
pub(crate) fn weapon_noun(m: &P) -> String {
    let scope = obj(m.get("weapons"));
    let kind = nn(scope, "type")
        .map(|value| format!("{} ", jv(value)))
        .unwrap_or_default();
    let keyword_phrase = |value: &Value| {
        let refs = value.as_array().map_or_else(
            || vec![bracket_keyword(value)],
            |items| items.iter().map(bracket_keyword).collect(),
        );
        or_list(&refs)
    };
    let keyword = nn(scope, "keyword")
        .map(|value| format!(" with {}", keyword_phrase(value)))
        .unwrap_or_default();
    let exclude_name = nn(scope, "exclude_name")
        .map(|value| format!(" other than \"{}\"", jv(value)))
        .unwrap_or_default();
    let exclude_keyword = nn(scope, "exclude_keyword")
        .map(|value| format!(" (excluding weapons with {})", keyword_phrase(value)))
        .unwrap_or_default();
    if let Some(reference) = nn(scope, "ref") {
        let reference = obj(Some(reference));
        if let Some(selected) = nn(reference, "selected_by") {
            let label = ability_label(obj(Some(selected)).get("ability"));
            return format!(
                "the {kind}weapons selected for {label}{keyword}{exclude_name}{exclude_keyword}"
            );
        }
        return format!("the selected {kind}weapon{keyword}{exclude_name}{exclude_keyword}");
    }
    let raw = nn(scope, "name")
        .map(jv)
        .unwrap_or_default()
        .trim_end_matches(|character: char| character.is_whitespace())
        .to_string();
    let raw = raw
        .strip_suffix(" weapons")
        .or_else(|| raw.strip_suffix(" weapon"))
        .unwrap_or(&raw);
    let slug = raw.contains('-')
        && raw.split('-').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        });
    let named = if slug {
        title_case(raw)
    } else {
        raw.to_string()
    };
    format!(
        "{kind}{}{keyword}{exclude_name}{exclude_keyword}",
        if named.is_empty() {
            "weapons".to_string()
        } else {
            format!("{named} weapons")
        }
    )
}

/// Whether a modifier carries a canonical weapon scope.
pub(crate) fn has_weapon(m: &P) -> bool {
    nn(m, "weapons")
        .and_then(Value::as_object)
        .is_some_and(|scope| !scope.is_empty())
}

/// " with melee weapons" for a roll scoped to a weapon filter, else "".
pub(crate) fn weapon_roll_scope(m: &P) -> String {
    if has_weapon(m) {
        format!(" with {}", weapon_noun(m))
    } else {
        String::new()
    }
}

/// A tag an effect applies: a registered id prints the rules' term, a legacy upper-case tag
/// stays as printed, others read "marked as …".
pub(crate) fn designation_for(tag: &str) -> String {
    if let Some(label) = designation_label(tag, false) {
        return label;
    }
    if tag == tag.to_uppercase() {
        tag.to_string()
    } else {
        format!("marked as {}", dekebab(tag))
    }
}

/// "a Normal move" — the move a counts_as_move names.
pub(crate) fn moved_phrase(mv: Option<&Value>) -> String {
    let m = jstr(mv);
    match m.as_str() {
        "normal" => "a Normal move".to_string(),
        "advance" => "an Advance move".to_string(),
        "fall-back" => "a Fall Back move".to_string(),
        "charge" => "a Charge move".to_string(),
        "remain-stationary" => "no move (it Remained Stationary)".to_string(),
        _ => format!("{} {} move", article(&m), title_case(&m)),
    }
}

/// A dice requirement: "pair of 4+", or alternatives "pair of 6+ or triple of 3+".
pub(crate) fn requirement_phrase(req: Option<&Value>) -> String {
    let one = |r: &Value| {
        let r = obj(Some(r));
        format!("{} of {}+", jstr(r.get("type")), jstr(r.get("min_value")))
    };
    let r = obj(req);
    if let Some(any) = r.get("any_of").and_then(Value::as_array) {
        return any.iter().map(one).collect::<Vec<_>>().join(" or ");
    }
    format!("{} of {}+", jstr(r.get("type")), jstr(r.get("min_value")))
}

/// "a Psychic test", "a Blessings of Khorne roll" — what kind of roll a gate or a roll step is.
pub(crate) fn roll_kind_noun(kind: Option<&Value>) -> String {
    let name = roll_name(kind);
    let test = matches!(
        kind.and_then(Value::as_str),
        Some("psychic" | "battle-shock" | "leadership" | "desperate-escape" | "hazard")
    );
    format!(
        "{} {name} {}",
        article(&name),
        if test { "test" } else { "roll" }
    )
}
