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
    attached_unit_number, is_attached_as_support, is_attached_section, pair_attached_groups,
    AttachedAs, GroupMember,
};
use super::gw_headerless_bullets::{finish_unit, parse_bullet, UnitAcc};
use super::gw_headerless_preamble::{
    expand_dense_lines, strip_bcp_summary, summary_warlord, Metadata, Preamble,
    RE_EMBEDDED_APP_BATTLE_SIZE,
};
use super::newrecruit_text::infer_battle_size_raw;
use super::types::{ParsedRoster, ParsedUnit, RosterFormat};

const CHARACTERS_SECTION: &str = "CHARACTERS";
const ALLIED_SECTION: &str = "ALLIED UNITS";
const ATTACHED_SECTION: &str = "ATTACHED UNITS";

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
pub(super) static RE_NX_PREFIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(\d+)[x×]\s+(.+)$").unwrap());
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
#[path = "gw_headerless_tests.rs"]
mod tests;
