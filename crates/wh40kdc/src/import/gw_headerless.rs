//! Headerless plain-text adapter: the GW 40K app's *exported* list (no
//! `++…++` / `+ FACTION KEYWORD:` summary fence), the NewRecruit "copy as
//! text" dialect, and the markdown-ish `## Section (N pts)` shape hand-authored
//! lists use. All three share one body grammar; they differ only in cosmetic
//! framing, so a single lenient parser covers them.
//!
//! Shape (any of):
//! ```text
//! <list name> (1995 Points)            ← title line (consumed, not a unit)
//! World Eaters                         ← faction / detachment / battle-size preamble (skipped)
//! Strike Force (2,000 Points)
//!
//! CHARACTERS                           ← ALL-CAPS role section …
//! ## Battleline (200 pts)              ← … or `##` markdown section …
//! Epic Hero:                           ← … or `Title:` colon section
//!
//! Khârn the Betrayer (100 Points)      ← unit header: Name (N pts|Points)
//!   • Warlord                          ← annotation
//!   • 1x Gorechild                     ← Nx wargear (single-model unit)
//!   • Enhancements: Berzerker Glaive   ← enhancement
//! Khorne Berzerkers (180 Points)
//!   • 9x Khorne Berzerker              ← model group (has ◦ children) …
//!      ◦ 8x Bolt pistol                ← … children are squad-wide wargear
//!   • 4x Intercessor: Bolt rifle       ← model group (colon wargear, no children)
//!
//! Fire Dragons (120 points)            ← GW app v2.0.5 "Attached Units" nesting
//! • Attached as: Bodyguard             ← attachment annotation (skipped)
//!   • 4x Fire Dragon                   ← model group (deeper • child) …
//!     • 4x Close combat weapon         ← … first weapon is bulleted …
//!       4x Dragon fusion gun           ← … the rest are unbulleted continuations
//! ```
//!
//! **Model vs wargear** (the crux), unified across dialects: a model group is a
//! bulleted entry, at the shallowest model indent, that is followed by a *deeper
//! bulleted* line (its squad-wide wargear); its `Nx` count (default 1) adds to
//! the model count. Keying on the child being *bulleted* keeps a lone bulleted
//! weapon trailed by unbulleted continuation lines (a Fire Prism's `Prism
//! cannon`) as wargear, not a model. A bullet with a `: wargear` colon is also a
//! model group. Everything else is wargear — a `Nx`/bare item, or the GW app's
//! unbulleted continuation lines (v2.0.5 bullets only the *first* weapon under a
//! model and emits the rest unbulleted, one indent deeper) — or an annotation
//! (`Warlord`, `… Character`, `Enhancements: …`, `Attached as: …`).
//!
//! **Disjointness**: this adapter is the fallback for bullet-bearing text that
//! the framed adapters reject — it declines input carrying the GW
//! `+ FACTION KEYWORD:` fence (→ [`GwAdapter`](super::gw)), the NewRecruit
//! `# ++ Army Roster ++` header (→ [`NewRecruitSimpleAdapter`]), or WTC
//! `N with` body lines, and requires at least one `•` bullet.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use super::adapter::{FormatAdapter, ParseError};
use super::attached_groups::{
    attached_as_role, attached_unit_number, is_attached_as_support, is_attached_section,
    pair_attached_groups, AttachedAs, GroupMember,
};
use super::gw_headerless_preamble::{
    expand_dense_lines, join_final_and, strip_bcp_summary, summary_warlord, Metadata, Preamble,
    RE_EMBEDDED_APP_BATTLE_SIZE,
};
use super::loadout_candidates::exact_loadout_groups;
use super::newrecruit_text::{classify_wargear_list, infer_battle_size_raw, split_wargear_list};
use super::types::{ParsedLoadoutGroup, ParsedRoster, ParsedUnit, ParsedWargear, RosterFormat};

const CHARACTERS_SECTION: &str = "CHARACTERS";
const ALLIED_SECTION: &str = "ALLIED UNITS";
const ATTACHED_SECTION: &str = "ATTACHED UNITS";
const CHARACTER_SUFFIX: &str = " Character";
const WARLORD_MARKER: &str = "Warlord";

/// Title / unit header: `Name (N pts|Points)` with localized thousands
/// separators used by event exports.
static RE_PTS_LINE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(.+?)\s*\(\s*([\d,.'’\u{00a0}\u{202f} ]+)\s*(?:pts?|points?)\s*\).*$")
        .unwrap()
});
/// A title-less total line used by event submissions.
static RE_BARE_POINTS_LINE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\(?\s*([\d,.'’\u{00a0}\u{202f} ]+)\s*(?:pts?|points?)\s*\)?$").unwrap()
});
/// `## Section [ (N pts) ]` markdown header.
static RE_MD_SECTION: Lazy<Regex> = Lazy::new(|| Regex::new(r"^#{1,6}\s*(.+?)\s*$").unwrap());
/// ALL-CAPS role section (`CHARACTERS`, `OTHER DATASHEETS`, …).
static RE_CAPS_SECTION: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Z][A-Z0-9 \-/&]+$").unwrap());
/// `Title:` colon section (`Epic Hero:`, `Battleline:`).
static RE_COLON_SECTION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^([A-Za-z][\w /&-]*):\s*$").unwrap());
/// Bullet line: leading indent, a `•`, `◦`, or `*` marker, then the body.
static RE_BULLET: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^([\t \u{00a0}]*)([•◦*])\s*(.+?)\s*$").unwrap());
static RE_NX_PREFIX: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^(\d+)[x×]\s+(.+)$").unwrap());
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
static RE_WITH_LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^[\t ]*\d+\s+with\b").unwrap());
static RE_BULLET_ANYWHERE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?m)^[\t \u{00a0}]*[•◦*]").unwrap());
static RE_BODY_SECTION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:CHARACTERS|BATTLELINE|DEDICATED TRANSPORTS|OTHER DATASHEETS|ALLIED UNITS|FORTIFICATIONS)$").unwrap()
});
static RE_LOOSE_BATTLE_SIZE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(Combat Patrol|Incursion|Strike Force|Onslaught)\b").unwrap());
static RE_DETACHMENT_POINTS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bDetachment Points?\b").unwrap());
static RE_URL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)https?://").unwrap());
static RE_LISTFORGE_FIRST_LINE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(.+)\s\(\s*[\d,.'’\u{00a0}\u{202f} ]+\s*Points?\s*\)\s*$").unwrap()
});

/// Battle-size labels that look like unit headers (`Strike Force (2,000 Points)`)
/// but are army metadata, not datasheets.
const BATTLE_SIZE_NAMES: &[&str] = &[
    "combat patrol",
    "incursion",
    "strike force",
    "onslaught",
    "strikeforce",
];
fn parse_pts(raw: &str) -> Option<u64> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
}

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

/// Accept bullet-bearing plain text that no framed adapter claims.
fn headerless_text(decoded: &Value) -> Option<String> {
    let raw = decoded.as_str()?;
    if raw.contains("+ FACTION KEYWORD:")
        && raw.contains("+ NUMBER OF UNITS:")
        && !RE_EMBEDDED_APP_BATTLE_SIZE.is_match(raw)
    {
        return None;
    }
    let s = strip_bcp_summary(raw);
    if !RE_BULLET_ANYWHERE.is_match(&s)
        || (s.contains("+ FACTION KEYWORD:") && !RE_EMBEDDED_APP_BATTLE_SIZE.is_match(&s))
        || RE_WITH_LINE.is_match(&s)
    {
        return None;
    }
    let lines: Vec<&str> = s.lines().collect();
    let first = lines.iter().find(|line| !line.trim().is_empty())?.trim();
    if RE_LISTFORGE_FIRST_LINE
        .captures(first)
        .is_some_and(|c| c[1].split(" - ").count() >= 3)
    {
        return None;
    }
    if lines.iter().any(|line| {
        let line = line.trim();
        line.starts_with("# ++") && line.contains("Army Roster")
    }) {
        return None;
    }
    lines
        .iter()
        .any(|line| RE_PTS_LINE.is_match(line.trim()))
        .then(|| s.clone())
}

#[derive(Clone)]
struct Bullet {
    indent: usize,
    count: Option<u64>,
    name: String,
    colon_wargear: Option<String>,
    is_annotation: bool,
    enhancement: Option<(String, Option<u64>)>,
    bulleted: bool,
    is_attachment: bool,
    sets_character: bool,
    /// Role from an `Attached as: …` annotation, when present.
    attachment_role: Option<AttachedAs>,
    /// A keyword the source explicitly grants the unit (`… Keyword: Character`,
    /// `This Datasheet also has the X keyword`, `Mark of Chaos: X`).
    keyword_override: Option<String>,
}

struct UnitAcc {
    raw_name: String,
    displayed_pts: Option<u64>,
    is_character_section: bool,
    bullets: Vec<Bullet>,
    /// The `Attached Unit N` group this unit sits in, if any.
    attachment_group: Option<u64>,
    /// The unit's role in that group (first `Attached as:` bullet, or a
    /// preceding `Attached as Support:` line).
    attachment_role: Option<AttachedAs>,
}

fn parse_bullet(indent: usize, body: &str, bulleted: bool) -> Bullet {
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

fn finish_unit(acc: UnitAcc) -> ParsedUnit {
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

fn is_battle_size(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    BATTLE_SIZE_NAMES.iter().any(|b| lower == *b)
}

pub struct GwHeaderlessAdapter;

impl FormatAdapter for GwHeaderlessAdapter {
    fn format(&self) -> RosterFormat {
        // Provenance: a GW-family plain-text export. Reuses the `gw` enum value
        // so no schema/codegen churn is needed for a new label.
        RosterFormat::Gw
    }

    fn detect(&self, decoded: &Value) -> bool {
        headerless_text(decoded).is_some()
    }

    fn parse(&self, decoded: &Value) -> Result<ParsedRoster, ParseError> {
        let text = headerless_text(decoded)
            .ok_or_else(|| ParseError("gw-headerless: not a headerless plain-text list".into()))?;
        let summary_warlord = decoded.as_str().and_then(summary_warlord);

        let mut name = String::from("Imported roster");
        let mut declared_limit: Option<u64> = None;
        let mut total_reported: Option<u64> = None;
        let mut battle_size_raw: Option<String> = None;
        let mut units: Vec<ParsedUnit> = Vec::new();
        let mut current: Option<UnitAcc> = None;
        let mut section: Option<String> = None;
        let mut allied = 0u64;
        let mut consumed_title = false;
        let mut pre = Preamble::new();
        let mut attachment_members: Vec<GroupMember> = Vec::new();
        let mut attachment_group: Option<u64> = None;
        let mut pending_support = false;
        let mut flush = |current: &mut Option<UnitAcc>, units: &mut Vec<ParsedUnit>| {
            if let Some(u) = current.take() {
                if let (Some(group), Some(role)) = (u.attachment_group, u.attachment_role) {
                    attachment_members.push(GroupMember {
                        unit_index: units.len(),
                        group,
                        role,
                    });
                }
                units.push(finish_unit(u));
            }
        };

        for raw in expand_dense_lines(&text, |s| RE_PTS_LINE.is_match(s)) {
            let raw = raw.trim_end_matches('\r');
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }

            // Bullets attach to the open unit.
            if let Some(c) = RE_BULLET.captures(raw) {
                if let Some(unit) = current.as_mut() {
                    let marker_depth = (c[2].as_bytes() == "◦".as_bytes()) as usize;
                    let bullet = parse_bullet(c[1].chars().count() + marker_depth, &c[3], true);
                    if unit.attachment_role.is_none() {
                        unit.attachment_role = bullet.attachment_role;
                    }
                    unit.bullets.push(bullet);
                }
                continue;
            }

            // GW export footer.
            if line.starts_with("Exported with") {
                continue;
            }
            let before_body = pre.open && current.is_none() && units.is_empty();
            if before_body {
                match pre.metadata(line) {
                    Metadata::None => {}
                    Metadata::Skip => continue,
                    Metadata::ListName(value) => {
                        name = value;
                        consumed_title = true;
                        continue;
                    }
                    Metadata::BattleSize(value) => {
                        if let Some(points) = RE_PTS_LINE.captures(&value) {
                            declared_limit = parse_pts(&points[2]);
                        }
                        battle_size_raw = Some(value);
                        consumed_title = true;
                        continue;
                    }
                    Metadata::Recorded => {
                        consumed_title = true;
                        continue;
                    }
                }
            }
            // A battle-size line in the preamble (`Strike Force (2,000 Points)`
            // or a bare `Strike Force`). It closes the preamble once a force
            // disposition has been seen, since the app prints it last.
            if before_body && RE_LOOSE_BATTLE_SIZE.is_match(line) {
                battle_size_raw = Some(line.to_string());
                declared_limit = parse_pts(line);
                if pre.force_disposition_raw_name.is_some() || pre.has_disposition_line() {
                    pre.close();
                }
                continue;
            }

            // The GW app bullets only the first wargear line under a model and
            // emits the rest unbulleted, one indent deeper
            // (`      4x Shuriken pistol`). Capture those `Nx …` continuation
            // lines as the open unit's wargear at their real indent so
            // `finish_unit` can place them. A unit header also lacks a bullet
            // but carries a `(N pts)` parenthetical, so it is excluded here and
            // handled just below.
            if RE_NX_PREFIX.is_match(line) && !RE_PTS_LINE.is_match(line) {
                if let Some(unit) = current.as_mut() {
                    // Characters, not bytes: a non-breaking space is one column.
                    let indent = raw.chars().count() - raw.trim_start().chars().count();
                    unit.bullets.push(parse_bullet(indent, line, false));
                    continue;
                }
            }

            if let Some(c) = RE_MD_SECTION.captures(line) {
                pre.close();
                flush(&mut current, &mut units);
                section = Some(
                    RE_PTS_LINE
                        .captures(&c[1])
                        .map(|points| points[1].trim().to_string())
                        .unwrap_or_else(|| c[1].trim().to_string()),
                );
                continue;
            }

            // A bare points line is the roster total when no title was
            // supplied. It is metadata, never a unit or faction token.
            if let Some(c) = RE_BARE_POINTS_LINE.captures(line) {
                if total_reported.is_none() {
                    total_reported = parse_pts(&c[1]);
                }
                consumed_title = true;
                continue;
            }

            if let Some(c) = RE_PTS_LINE.captures(line) {
                let header_name = c[1].trim().to_string();
                let pts = parse_pts(&c[2]);
                // Battle-size metadata may occur anywhere in the ordered
                // preamble; it is never a roster title or datasheet, and it
                // does not close the preamble.
                if is_battle_size(&header_name) {
                    battle_size_raw = Some(line.to_string());
                    if pts.is_some() {
                        declared_limit = pts;
                    }
                    continue;
                }
                if current.is_none() && units.is_empty() && RE_DETACHMENT_POINTS.is_match(line) {
                    pre.lines.push(line.to_string());
                    continue;
                }
                // First `Name (N pts|Points)` line is the roster title, not a
                // unit. Its number is the army total; a battle-size line is
                // the limit.
                if !consumed_title && current.is_none() && units.is_empty() {
                    consumed_title = true;
                    name = header_name;
                    total_reported = pts;
                    continue;
                }
                // Some event exports prepend participant/team lines without a
                // fence; the real high-point roster title arrives afterwards.
                // No unit costs 1,000+ points, so this stays unambiguous.
                if declared_limit.is_none()
                    && current.is_none()
                    && units.is_empty()
                    && pts.unwrap_or(0) >= 1000
                {
                    name = header_name;
                    total_reported = pts;
                    if pre.lines.len() >= 2 {
                        let keep_from = pre.lines.len() - 1;
                        pre.lines.drain(..keep_from);
                    } else {
                        pre.lines.clear();
                    }
                    continue;
                }
                pre.close();
                flush(&mut current, &mut units);
                let in_chars = section
                    .as_deref()
                    .map(|s| s.eq_ignore_ascii_case(CHARACTERS_SECTION))
                    .unwrap_or(false);
                if section.as_deref() == Some(ALLIED_SECTION) {
                    allied += 1;
                }
                current = Some(UnitAcc {
                    raw_name: header_name,
                    displayed_pts: pts,
                    is_character_section: in_chars,
                    bullets: Vec::new(),
                    attachment_group,
                    attachment_role: pending_support.then_some(AttachedAs::Support),
                });
                pending_support = false;
                continue;
            }

            if let Some(group) = attached_unit_number(line) {
                pre.close();
                flush(&mut current, &mut units);
                section = Some(ATTACHED_SECTION.to_string());
                attachment_group = Some(group);
                continue;
            }

            if is_attached_as_support(line) {
                pre.close();
                flush(&mut current, &mut units);
                pending_support = true;
                continue;
            }

            // `Attached Units` is a body section even when it isn't uppercased.
            if is_attached_section(line) {
                pre.close();
                flush(&mut current, &mut units);
                section = Some(ATTACHED_SECTION.to_string());
                attachment_group = None;
                continue;
            }

            // An ALL-CAPS line before the body that is not a role heading is
            // preamble metadata (an upper-cased faction or detachment).
            if pre.open
                && current.is_none()
                && units.is_empty()
                && RE_CAPS_SECTION.is_match(line)
                && !RE_BODY_SECTION.is_match(line)
            {
                pre.lines.push(line.to_string());
                continue;
            }
            if RE_CAPS_SECTION.is_match(line) || RE_COLON_SECTION.is_match(line) {
                pre.close();
                flush(&mut current, &mut units);
                section = Some(line.trim_end_matches(':').trim().to_string());
                attachment_group = None;
                continue;
            }

            // Anything else before the body is title/preamble metadata. A URL
            // on a leading note line is event commentary, not a roster name.
            if pre.open && RE_URL.is_match(line) {
                continue;
            }
            if !consumed_title && current.is_none() && units.is_empty() {
                consumed_title = true;
                name = line.to_string();
            } else if pre.open && current.is_none() && units.is_empty() {
                pre.lines.push(line.to_string());
            }
        }
        pre.close();
        flush(&mut current, &mut units);
        pair_attached_groups(&mut units, &attachment_members);
        if let Some(warlord) = summary_warlord {
            let key = warlord.to_lowercase();
            let matches: Vec<usize> = (0..units.len())
                .filter(|&i| units[i].raw_name.to_lowercase().starts_with(&key))
                .collect();
            if let [only] = matches[..] {
                for unit in units.iter_mut() {
                    unit.is_warlord = false;
                }
                units[only].is_warlord = true;
            }
        }

        let total_computed: u64 = units
            .iter()
            .map(|u| u.points.unwrap_or(0) + u.enhancement_points.unwrap_or(0))
            .sum();
        let effective_limit = declared_limit.or(total_reported);

        if battle_size_raw.is_none() {
            battle_size_raw = infer_battle_size_raw(effective_limit);
        }
        let faction_raw_name = pre.faction_raw_name;
        let detachment_raw_names = pre.detachment_raw_names;
        let force_disposition_raw_name = pre.force_disposition_raw_name;

        Ok(ParsedRoster {
            name,
            generated_by: None,
            faction_raw_name,
            detachment_raw_names,
            battle_size_raw,
            force_disposition: None,
            force_disposition_raw_name: Some(force_disposition_raw_name),
            declared_limit: effective_limit,
            total_reported,
            total_computed,
            units,
            multi_force: allied > 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // GW app export (world-eaters dialect): `(N Points)`, ALL-CAPS sections,
    // `◦` child wargear, single-model characters with bare/`Nx` wargear.
    const GW_APP: &str = "Ding dong (1995 Points)

World Eaters
Berzerker Warband
Strike Force (2,000 Points)

CHARACTERS

Khârn the Betrayer (100 Points)
  • Warlord
  • 1x Gorechild
  • 1x Plasma pistol

Master of Executions (95 Points)
  • 1x Axe of dismemberment
  • Enhancements: Berzerker Glaive

BATTLELINE

Khorne Berzerkers (180 Points)
  • 1x Khorne Berzerker Champion
     ◦ 1x Chainblade
  • 9x Khorne Berzerker
     ◦ 8x Bolt pistol
     ◦ 7x Chainblade

Exported with App Version: v1.48.0 (1), Data Version: v750
";

    // Markdown `##` fixture dialect: `(N pts)`, `• Nx Model: wargear`.
    const MD_FIXTURE: &str = "Test Army - Space Marines - Gladius Task Force (300 pts)

## Battleline (200 pts)
Intercessor Squad (200 pts)
  • 4x Intercessor: Bolt rifle
  • Intercessor Sergeant: Bolt rifle
";

    // NewRecruit body dialect with a bare title: `Title:` sections and
    // deeper-`•` children. ListForge's three-segment first line is excluded.
    const NR_TEXT: &str = "Daemon Incursion (1995 Points)

Character:
Bloodmaster (65 pts)
  • Blade of blood

Battleline:
Bloodletters (110 pts)
  • Bloodreaper
    • Hellblade
  • Instrument of Chaos
  • 9x Bloodletter
    • 9x Hellblade
";

    const LISTFORGE_TEXT: &str =
        "all gas no breaks - Chaos Daemons - Daemonic Incursion (1995 Points)
Character:
Bloodmaster (65 pts)
  • Blade of blood
";

    #[test]
    fn detects_only_headerless_bullet_text() {
        assert!(GwHeaderlessAdapter.detect(&json!(GW_APP)));
        assert!(GwHeaderlessAdapter.detect(&json!(MD_FIXTURE)));
        assert!(GwHeaderlessAdapter.detect(&json!(NR_TEXT)));
        assert!(!GwHeaderlessAdapter.detect(&json!(LISTFORGE_TEXT)));
        // Framed GW export belongs to GwAdapter.
        assert!(!GwHeaderlessAdapter.detect(&json!("+ FACTION KEYWORD: X\n\nU (1 pts)\n• 1x W\n")));
        // No bullets → not this family.
        assert!(!GwHeaderlessAdapter.detect(&json!("U (100 pts)\n")));
        assert!(!GwHeaderlessAdapter.detect(&json!({"roster": {}})));
    }

    #[test]
    fn parses_gw_app_export() {
        let p = GwHeaderlessAdapter.parse(&json!(GW_APP)).unwrap();
        assert_eq!(p.name, "Ding dong");
        // Faction / detachment are read from the bare preamble lines.
        assert_eq!(p.faction_raw_name.as_deref(), Some("World Eaters"));
        assert_eq!(
            p.detachment_raw_names,
            vec!["Berzerker Warband".to_string()]
        );
        assert_eq!(p.units.len(), 3);

        let kharn = &p.units[0];
        assert_eq!(kharn.raw_name, "Khârn the Betrayer");
        assert!(kharn.is_warlord);
        assert!(kharn.is_character); // CHARACTERS section
        assert_eq!(kharn.model_count, 1);
        assert!(kharn.wargear.iter().any(|w| w.raw_name == "Gorechild"));

        let moe = &p.units[1];
        assert_eq!(
            moe.enhancement_raw_name.as_deref(),
            Some("Berzerker Glaive")
        );

        let zerks = &p.units[2];
        assert_eq!(zerks.model_count, 10); // 1 champion + 9
        let bolt = zerks
            .wargear
            .iter()
            .find(|w| w.raw_name == "Bolt pistol")
            .unwrap();
        assert_eq!(bolt.count, 8);
    }

    #[test]
    fn parses_md_fixture_model_count() {
        let p = GwHeaderlessAdapter.parse(&json!(MD_FIXTURE)).unwrap();
        assert_eq!(p.units.len(), 1);
        let squad = &p.units[0];
        assert_eq!(squad.raw_name, "Intercessor Squad");
        assert_eq!(squad.model_count, 5); // 4 + 1
        let bolt = squad
            .wargear
            .iter()
            .find(|w| w.raw_name == "Bolt rifle")
            .unwrap();
        assert_eq!(bolt.count, 5);
    }

    #[test]
    fn parses_nr_text_dialect() {
        let p = GwHeaderlessAdapter.parse(&json!(NR_TEXT)).unwrap();
        assert_eq!(p.units.len(), 2);
        let bloodmaster = &p.units[0];
        assert_eq!(bloodmaster.model_count, 1);
        assert!(bloodmaster
            .wargear
            .iter()
            .any(|w| w.raw_name == "Blade of blood"));
        let letters = &p.units[1];
        assert_eq!(letters.model_count, 10); // Bloodreaper + 9 Bloodletter
        assert!(letters.wargear.iter().any(|w| w.raw_name == "Hellblade"));
    }

    // GW app v2.0.5 "Attached Units" export: models nest under `Attached as:`
    // annotations, and each model bullets only its first weapon — the rest are
    // unbulleted, deeper-indented continuation lines.
    const GW_V2_ATTACHED: &str = "Test List (2275 points)

Aeldari
Armoured Warhost

Attached Units
Attached Unit 1

Warlock Conclave (120 points)
• Attached as: Leader
• Leading: Eldrad Ulthran
  • 4x Warlock
    • 4x Destructor
      4x Shuriken pistol
      4x Singing Spear

Eldrad Ulthran (130 points)
• Attached   as: Leader (Character)
• Leader: Warlock Conclave
  • Warlord
  • 1x Mind War
    1x Shuriken pistol
    1x The Staff of Ulthamar and witchblade

OTHER DATASHEETS

Fire Prism (150 points)
  • 1x Prism cannon
    1x Twin shuriken catapult
    1x Wraithbone hull

Fire Dragons (120 points)
  • 1x Fire Dragon Exarch
    • 1x Close combat weapon
      1x Firepike
  • 4x Fire Dragon
    • 4x Close combat weapon
      4x Dragon fusion gun

Exported with App Version: v2.0.5 (128), Data Version: v886
";

    #[test]
    fn parses_gw_v2_attached_format() {
        let p = GwHeaderlessAdapter.parse(&json!(GW_V2_ATTACHED)).unwrap();
        let unit = |name: &str| p.units.iter().find(|u| u.raw_name == name).unwrap();
        let count = |u: &ParsedUnit, name: &str| {
            u.wargear
                .iter()
                .find(|w| w.raw_name == name)
                .map(|w| w.count)
        };

        // Model group with an `Attached as:` prefix: the model line is `Warlock`,
        // and both the bulleted and the two unbulleted continuation weapons attach.
        let conclave = unit("Warlock Conclave");
        assert_eq!(conclave.model_count, 4);
        assert_eq!(count(conclave, "Destructor"), Some(4));
        assert_eq!(count(conclave, "Shuriken pistol"), Some(4)); // dropped pre-fix
        assert_eq!(count(conclave, "Singing Spear"), Some(4)); // dropped pre-fix
        assert!(!conclave.wargear.iter().any(|w| w.raw_name == "Warlock"));
        assert!(!conclave
            .wargear
            .iter()
            .any(|w| w.raw_name.to_lowercase().contains("leader")));
        assert!(!conclave
            .wargear
            .iter()
            .any(|w| w.raw_name.to_lowercase().contains("leading")));

        // `Attached as: … (Character)` flags the unit; `Warlord` is still read.
        let eldrad = unit("Eldrad Ulthran");
        assert_eq!(eldrad.model_count, 1);
        assert!(eldrad.is_character);
        assert!(eldrad.is_warlord);
        assert_eq!(count(eldrad, "Shuriken pistol"), Some(1));
        assert_eq!(
            count(eldrad, "The Staff of Ulthamar and witchblade"),
            Some(1)
        );
        assert!(!eldrad
            .wargear
            .iter()
            .any(|w| w.raw_name.to_lowercase().contains("leader")));

        // A lone bulleted weapon trailed by plain continuations is a single-model
        // unit whose bullet is wargear, not a model group.
        let prism = unit("Fire Prism");
        assert_eq!(prism.model_count, 1);
        assert_eq!(count(prism, "Prism cannon"), Some(1));
        assert_eq!(count(prism, "Twin shuriken catapult"), Some(1));
        assert_eq!(count(prism, "Wraithbone hull"), Some(1));

        // Two model groups, each `model → • weapon → plain weapon`.
        let dragons = unit("Fire Dragons");
        assert_eq!(dragons.model_count, 5); // 1 Exarch + 4
        assert_eq!(count(dragons, "Close combat weapon"), Some(5));
        assert_eq!(count(dragons, "Firepike"), Some(1));
        assert_eq!(count(dragons, "Dragon fusion gun"), Some(4));
    }
    #[test]
    fn recovers_unframed_event_preamble_without_phantom_unit() {
        let input = "Participant
Team
Drukhari
Recon (1995 points)
Skysplinter Assault (3 Detachment Points)

1995 points

CHARACTERS

Archon (100 points)
• Warlord
• 1x Huskblade
";
        let parsed = GwHeaderlessAdapter.parse(&json!(input)).unwrap();
        assert_eq!(parsed.name, "Recon");
        assert_eq!(parsed.declared_limit, Some(1995));
        assert_eq!(parsed.faction_raw_name.as_deref(), Some("Drukhari"));
        assert_eq!(
            parsed.detachment_raw_names,
            vec!["Skysplinter Assault".to_string()]
        );
        assert_eq!(parsed.units.len(), 1);
        assert_eq!(parsed.units[0].raw_name, "Archon");
    }
}
