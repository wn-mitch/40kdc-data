//! Bullet grammar of the headerless plain-text adapter
//! ([`super::gw_headerless`]): one bullet line parsed into a model, wargear, or
//! annotation, and a unit's bullets folded into a [`ParsedUnit`]. Mirror of
//! `parseBullet` / `finishUnit` in `tools/src/import/gw-headerless.ts`.

use once_cell::sync::Lazy;
use regex::Regex;

use super::attached_groups::{attached_as_role, AttachedAs};
use super::gw_headerless::RE_NX_PREFIX;
use super::gw_headerless_preamble::join_final_and;
use super::loadout_candidates::exact_loadout_groups;
use super::newrecruit_text::{classify_wargear_list, split_wargear_list};
use super::types::{ParsedLoadoutGroup, ParsedUnit, ParsedWargear};

const CHARACTER_SUFFIX: &str = " Character";
const WARLORD_MARKER: &str = "Warlord";

static RE_MODEL_WITH_WARGEAR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(\d+)(?:[x×]\s+|\s+)(.+?)\s+with\s+(.+)$").unwrap());
/// Inline enhancement annotation: `Name (+N pts)` or `Name [+N points]`.
static RE_ENHANCEMENT_ANNOT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)^(.+?)\s*(?:\(\+\s*(\d+)\s*pts?\s*\)|\[\+\s*(\d+)\s*(?:pts?|points?)\s*\])\s*$",
    )
    .unwrap()
});
/// `Enhancements: X` / `E: X`, including localized labels.
static RE_ENHANCEMENT_LABEL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:e|enh|enhancement|enhancements|verbesserung|verbesserungen)\s*:\s*(.+)$")
        .unwrap()
});
/// Attachment relationship annotations emitted by GW-family exports.
static RE_ATTACHMENT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(attached\s+as|leader|leading)\s*:\s*(.+)$").unwrap());
/// `(Character)` inside an attachment role.
static RE_CHARACTER_ROLE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\(\s*Character\s*\)").unwrap());
/// Detachment keyword annotations which promote the selected bearer to Character.
static RE_CHARACTER_ANNOTATION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:.+\s+keywords?\s*:\s*character|subterranean\s+assault\s+character)$")
        .unwrap()
});
static RE_COLON_ANNOTATION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:.+\s+keywords?|mark of chaos|daemonic allegiance)\s*:").unwrap()
});
static RE_KEYWORD_ANNOTATION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^This Datasheet also has the (.+?) keyword$").unwrap());

fn is_attached_as(raw: &str) -> bool {
    let mut words = raw.split_whitespace();
    words
        .next()
        .is_some_and(|word| word.eq_ignore_ascii_case("attached"))
        && words
            .next()
            .is_some_and(|word| word.eq_ignore_ascii_case("as"))
        && words.next().is_none()
}

#[derive(Clone)]
pub(super) struct Bullet {
    pub(super) indent: usize,
    pub(super) count: Option<u64>,
    pub(super) name: String,
    pub(super) colon_wargear: Option<String>,
    pub(super) is_annotation: bool,
    pub(super) enhancement: Option<(String, Option<u64>)>,
    pub(super) bulleted: bool,
    pub(super) is_attachment: bool,
    pub(super) sets_character: bool,
    /// Role from an `Attached as: …` annotation, when present.
    pub(super) attachment_role: Option<AttachedAs>,
    /// A keyword the source explicitly grants the unit (`… Keyword: Character`,
    /// `This Datasheet also has the X keyword`, `Mark of Chaos: X`).
    pub(super) keyword_override: Option<String>,
}

pub(super) struct UnitAcc {
    pub(super) raw_name: String,
    pub(super) displayed_pts: Option<u64>,
    pub(super) is_character_section: bool,
    pub(super) bullets: Vec<Bullet>,
    /// The `Attached Unit N` group this unit sits in, if any.
    pub(super) attachment_group: Option<u64>,
    /// The unit's role in that group (first `Attached as:` bullet, or a
    /// preceding `Attached as Support:` line).
    pub(super) attachment_role: Option<AttachedAs>,
}

pub(super) fn parse_bullet(indent: usize, body: &str, bulleted: bool) -> Bullet {
    let plain = body.trim();
    if let Some(c) = RE_ATTACHMENT.captures(plain) {
        let sets_character = is_attached_as(&c[1]) && RE_CHARACTER_ROLE.is_match(&c[2]);
        let attachment_role = if is_attached_as(&c[1]) {
            attached_as_role(&c[2])
        } else {
            None
        };
        return Bullet {
            indent,
            count: None,
            name: String::new(),
            colon_wargear: None,
            is_annotation: true,
            enhancement: None,
            bulleted,
            is_attachment: true,
            sets_character,
            attachment_role,
            keyword_override: None,
        };
    }
    if RE_CHARACTER_ANNOTATION.is_match(plain) {
        return Bullet {
            indent,
            count: None,
            name: String::new(),
            colon_wargear: None,
            is_annotation: true,
            enhancement: None,
            bulleted,
            is_attachment: false,
            attachment_role: None,
            keyword_override: Some("Character".to_string()),
            sets_character: true,
        };
    }
    if let Some(c) = RE_ENHANCEMENT_LABEL.captures(plain) {
        return Bullet {
            indent,
            count: None,
            name: String::new(),
            colon_wargear: None,
            is_annotation: true,
            enhancement: Some((c[1].trim().to_string(), None)),
            bulleted,
            is_attachment: false,
            attachment_role: None,
            keyword_override: None,
            sets_character: false,
        };
    }
    let (mut count, mut rest) = match RE_NX_PREFIX.captures(plain) {
        Some(nx) => (nx[1].parse().ok(), nx[2].trim().to_string()),
        None => (None, plain.to_string()),
    };
    if let Some(c) = RE_ENHANCEMENT_ANNOT.captures(&rest) {
        let points = c
            .get(2)
            .or_else(|| c.get(3))
            .and_then(|m| m.as_str().parse().ok());
        return Bullet {
            indent,
            count,
            name: rest.clone(),
            colon_wargear: None,
            is_annotation: true,
            enhancement: Some((c[1].trim().to_string(), points)),
            bulleted,
            is_attachment: false,
            attachment_role: None,
            keyword_override: None,
            sets_character: false,
        };
    }
    if let Some(c) = RE_MODEL_WITH_WARGEAR.captures(&rest) {
        return Bullet {
            indent,
            count: c[1].parse().ok(),
            name: c[2].trim().to_string(),
            colon_wargear: Some(join_final_and(&c[3])),
            is_annotation: false,
            enhancement: None,
            bulleted,
            is_attachment: false,
            attachment_role: None,
            keyword_override: None,
            sets_character: false,
        };
    }
    if count.is_none() {
        if let Some(c) = Regex::new(r"^(\d+)\s+(.+)$").unwrap().captures(&rest) {
            count = c[1].parse().ok();
            rest = c[2].trim().to_string();
        }
    }
    let sets_character = RE_CHARACTER_ANNOTATION.is_match(&rest);
    let explicit_keyword = RE_KEYWORD_ANNOTATION
        .captures(&rest)
        .map(|c| c[1].trim().to_string());
    if sets_character || explicit_keyword.is_some() {
        return Bullet {
            indent,
            count: None,
            name: String::new(),
            colon_wargear: None,
            is_annotation: true,
            enhancement: None,
            bulleted,
            is_attachment: false,
            attachment_role: None,
            keyword_override: Some(explicit_keyword.unwrap_or_else(|| "Character".to_string())),
            sets_character,
        };
    }
    if RE_COLON_ANNOTATION.is_match(&rest) {
        let keyword = rest[rest.find(':').map_or(rest.len(), |i| i + 1)..].trim();
        return Bullet {
            indent,
            count: None,
            name: String::new(),
            colon_wargear: None,
            is_annotation: true,
            enhancement: None,
            bulleted,
            is_attachment: false,
            attachment_role: None,
            keyword_override: (!keyword.is_empty()).then(|| keyword.to_string()),
            sets_character: false,
        };
    }
    if let Some(idx) = rest.find(':') {
        let (model, wargear) = rest.split_at(idx);
        let wargear = wargear[1..].trim();
        return Bullet {
            indent,
            count,
            name: model.trim().to_string(),
            colon_wargear: (!wargear.is_empty()).then(|| wargear.to_string()),
            is_annotation: false,
            enhancement: None,
            bulleted,
            is_attachment: false,
            attachment_role: None,
            keyword_override: None,
            sets_character: false,
        };
    }
    Bullet {
        indent,
        count,
        name: rest,
        colon_wargear: None,
        is_annotation: count.is_none(),
        enhancement: None,
        bulleted,
        is_attachment: false,
        attachment_role: None,
        keyword_override: None,
        sets_character: false,
    }
}

pub(super) fn finish_unit(acc: UnitAcc) -> ParsedUnit {
    // Keywords the source grants explicitly, in first-seen order.
    let mut keyword_overrides: Vec<String> = Vec::new();
    for keyword in acc
        .bullets
        .iter()
        .filter_map(|b| b.keyword_override.as_ref())
    {
        if !keyword_overrides.contains(keyword) {
            keyword_overrides.push(keyword.clone());
        }
    }

    // Models live at the shallowest *bulleted* indent that isn't an attachment,
    // enhancement, or colon-wargear line. The GW v2.0.5 export prefixes each
    // unit with an `Attached as:` bullet shallower than the models, so a plain
    // "min of all indents" would misplace the model level — filter those out.
    let model_indent = acc
        .bullets
        .iter()
        .filter(|b| {
            b.bulleted && !b.is_attachment && b.enhancement.is_none() && b.colon_wargear.is_none()
        })
        .map(|b| b.indent)
        .min()
        .unwrap_or(0);

    // A model group: a bulleted entry at the model indent followed by a *deeper
    // bulleted* line (its squad-wide wargear). Keying on the child being
    // bulleted keeps a lone bulleted weapon trailed by plain continuation lines
    // (Fire Prism's Prism cannon) as wargear, not a model. A count-less model
    // name (`• Bloodreaper` with children) still counts as one model.
    let is_model_group = |b: &Bullet, next: Option<&Bullet>| -> bool {
        b.bulleted
            && b.colon_wargear.is_none()
            && b.enhancement.is_none()
            && !b.is_attachment
            && b.indent == model_indent
            && next
                .map(|n| n.bulleted && n.indent > b.indent)
                .unwrap_or(false)
    };

    let mut wargear: Vec<ParsedWargear> = Vec::new();
    let mut add_wargear = |raw_name: &str, count: u64| {
        let raw_name = raw_name.trim();
        if raw_name.is_empty() {
            return;
        }
        if let Some(w) = wargear.iter_mut().find(|w| w.raw_name == raw_name) {
            w.count += count;
        } else {
            wargear.push(ParsedWargear {
                raw_name: raw_name.to_string(),
                count,
            });
        }
    };

    let mut model_count: u64 = 0;
    let mut is_warlord = false;
    let mut is_character = acc.is_character_section;
    let mut enhancement_raw_name: Option<String> = None;
    let mut enhancement_points: Option<u64> = None;
    // Per-model groups as the source lists them; kept only if exact.
    let mut candidate_groups: Vec<ParsedLoadoutGroup> = Vec::new();

    for (i, b) in acc.bullets.iter().enumerate() {
        // `Attached as: …` carries no model or gear; a `(Character)` role flags
        // the unit. Skip before model detection — it sits shallower than the
        // models and would otherwise read as a model group.
        if b.is_attachment {
            if b.sets_character {
                is_character = true;
            }
            continue;
        }

        // Enhancement annotation (`Enhancements: X` or `X (+N pts)`).
        if let Some((name, pts)) = &b.enhancement {
            if enhancement_raw_name.is_none() {
                enhancement_raw_name = Some(name.clone());
                enhancement_points = *pts;
            }
            continue;
        }

        // Model with inline `: wargear` (the `##`/fixture dialect).
        if let Some(csv) = &b.colon_wargear {
            let n = b.count.unwrap_or(1);
            model_count += n;
            // Items carry their own per-model `Nx` count; markers such as
            // `Warlord` are not wargear.
            let classified = classify_wargear_list(&split_wargear_list(csv));
            for item in &classified.wargear {
                add_wargear(&item.raw_name, item.count * n);
            }
            candidate_groups.push(ParsedLoadoutGroup {
                model_name: Some(b.name.clone()),
                count: n,
                wargear: classified.wargear,
            });
            continue;
        }

        // Model group: counted bullet at the model indent with a deeper bulleted child.
        if is_model_group(b, acc.bullets.get(i + 1)) {
            let n = b.count.unwrap_or(1);
            model_count += n;
            // Each child's count is the squad-wide total; split it per model.
            let mut group_wargear: Vec<ParsedWargear> = Vec::new();
            let mut exact = true;
            for child in acc.bullets[i + 1..]
                .iter()
                .take_while(|c| c.indent > b.indent)
            {
                let total = child.count.unwrap_or(1);
                if child.is_attachment
                    || child.sets_character
                    || child.enhancement.is_some()
                    || child.is_annotation
                    || child.colon_wargear.is_some()
                    || n == 0
                    || total % n != 0
                {
                    exact = false;
                    continue;
                }
                group_wargear.push(ParsedWargear {
                    raw_name: child.name.clone(),
                    count: total / n,
                });
            }
            if exact && !group_wargear.is_empty() {
                candidate_groups.push(ParsedLoadoutGroup {
                    model_name: Some(b.name.clone()),
                    count: n,
                    wargear: group_wargear,
                });
            }
            continue;
        }

        // Annotation (no count): Warlord / Character flags, else bare wargear.
        if b.is_annotation {
            if b.sets_character {
                is_character = true;
            }
            let mut leftover: Vec<&str> = Vec::new();
            for token in b.name.split(',').map(str::trim).filter(|t| !t.is_empty()) {
                if token == WARLORD_MARKER {
                    is_warlord = true;
                } else if token.ends_with(CHARACTER_SUFFIX) {
                    is_character = true;
                } else {
                    leftover.push(token);
                }
            }
            for token in leftover {
                add_wargear(token, 1);
            }
            continue;
        }

        // Everything else is wargear — a bulleted weapon under a model or an
        // unbulleted continuation line, at any depth.
        add_wargear(&b.name, b.count.unwrap_or(1));
    }

    if model_count == 0 {
        model_count = 1;
    }

    let points = match (acc.displayed_pts, enhancement_points) {
        (Some(displayed), Some(enh)) => Some(displayed.saturating_sub(enh)),
        (displayed, _) => displayed,
    };

    let loadout_groups = exact_loadout_groups(candidate_groups, model_count, &wargear);

    ParsedUnit {
        raw_name: acc.raw_name,
        is_character,
        keyword_overrides: (!keyword_overrides.is_empty()).then_some(keyword_overrides),
        model_count,
        points,
        is_warlord,
        enhancement_raw_name,
        enhancement_points,
        wargear,
        loadout_groups,
        leader_attachment: None,
    }
}
