//! NewRecruit "simple" markdown-ish text adapter.
//!
//! Shape:
//! ```text
//! <breadcrumb> - <faction> - <list name> - [N pts]
//!
//! # ++ Army Roster ++ [N pts]
//! ## Configuration
//! Battle Size: <Label>
//! Detachment: <Name>
//!
//! ## <Section> [N pts]
//! <Unit> [N pts]: <wargear>
//! <Unit> [N pts]:
//! • <count>x <ModelType>[ [N pts]]: <wargear>
//! ```
//!
//! Enhancements are inlined in the wargear list as `<Name> [N pts]` — the
//! only wargear token wearing a `[…]` pts suffix. `Warlord` and `<X>
//! Character` are stripped and become flags.
//!
//! Rust mirror of `tools/src/import/newrecruit-simple.ts`.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use super::adapter::{FormatAdapter, ParseError};
use super::newrecruit_text::{classify_wargear_list, split_wargear_list};
use super::types::{ParsedRoster, ParsedUnit, ParsedWargear, RosterFormat};

static RE_FIRST_LINE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(.+)\s-\s\[\s*(\d+)\s*pts?\s*\]\s*$").unwrap());
static RE_ROSTER_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^#\s*\+\+\s*Army Roster\s*\+\+\s*\[\s*(\d+)\s*pts?\s*\]\s*$").unwrap()
});
static RE_ROSTER_HEADER_SIG: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?im)^#\s*\+\+\s*Army Roster\s*\+\+").unwrap());
static RE_SECTION_HEADER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^##\s*(.+?)(?:\s*\[\s*(\d+)\s*pts?\s*\])?\s*$").unwrap());
static RE_UNIT_LINE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(.+?)\s*\[\s*(\d+)\s*pts?\s*\](?:\s*:\s*(.*))?$").unwrap());
static RE_BULLET: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^\s*•\s*(\d+)x\s+(.+?)(?:\s*\[\s*(\d+)\s*pts?\s*\])?(?:\s*:\s*(.*))?\s*$",
    )
    .unwrap()
});

#[derive(Default)]
struct UnitBuilder {
    raw_name: String,
    is_character: bool,
    is_warlord: bool,
    enhancement_raw_name: Option<String>,
    enhancement_pts: u64,
    displayed_pts: Option<u64>,
    model_count: u64,
    wargear: Vec<(String, u64)>,
}

impl UnitBuilder {
    fn new(name: String, displayed_pts: Option<u64>) -> Self {
        Self {
            raw_name: name,
            displayed_pts,
            model_count: 1,
            ..Default::default()
        }
    }

    fn add_wargear(&mut self, items: Vec<ParsedWargear>) {
        for ParsedWargear { raw_name, count } in items {
            if let Some(entry) = self.wargear.iter_mut().find(|(n, _)| n == &raw_name) {
                entry.1 += count;
            } else {
                self.wargear.push((raw_name, count));
            }
        }
    }

    fn apply_tokens(&mut self, tokens_csv: &str, multiplier: u64) {
        let tokens: Vec<&str> = split_wargear_list(tokens_csv);
        let cls = classify_wargear_list(&tokens);
        if cls.is_warlord {
            self.is_warlord = true;
        }
        if cls.is_character {
            self.is_character = true;
        }
        if let Some(name) = cls.enhancement_raw_name {
            if self.enhancement_raw_name.is_none() {
                self.enhancement_raw_name = Some(name);
                self.enhancement_pts = cls.enhancement_points.unwrap_or(0);
            }
        }
        let scaled: Vec<ParsedWargear> = cls
            .wargear
            .into_iter()
            .map(|w| ParsedWargear {
                raw_name: w.raw_name,
                count: w.count * multiplier,
            })
            .collect();
        self.add_wargear(scaled);
    }

    fn finish(self) -> (ParsedUnit, u64) {
        let points = self.displayed_pts.map(|p| p.saturating_sub(self.enhancement_pts));
        let enhancement_points = if self.enhancement_raw_name.is_some() {
            Some(self.enhancement_pts)
        } else {
            None
        };
        let wargear: Vec<ParsedWargear> = self
            .wargear
            .into_iter()
            .map(|(raw_name, count)| ParsedWargear { raw_name, count })
            .collect();
        (
            ParsedUnit {
                raw_name: self.raw_name,
                is_character: self.is_character,
                model_count: self.model_count,
                points,
                is_warlord: self.is_warlord,
                enhancement_raw_name: self.enhancement_raw_name,
                enhancement_points,
                wargear,
            },
            self.enhancement_pts,
        )
    }
}

struct FirstLine {
    name: String,
    faction: Option<String>,
    declared_limit: Option<u64>,
}

fn parse_first_line(line: &str) -> Option<FirstLine> {
    let c = RE_FIRST_LINE.captures(line)?;
    let declared_limit: u64 = c[2].parse().ok()?;
    let parts: Vec<&str> = c[1].split(" - ").map(str::trim).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    let list_name = parts[parts.len() - 1].to_string();
    let faction = if parts.len() >= 2 {
        Some(parts[parts.len() - 2].to_string())
    } else {
        None
    };
    Some(FirstLine {
        name: list_name,
        faction,
        declared_limit: Some(declared_limit),
    })
}

#[derive(Clone, Copy, PartialEq)]
enum Section {
    Preamble,
    Configuration,
    Units,
}

pub struct NewRecruitSimpleAdapter;

impl FormatAdapter for NewRecruitSimpleAdapter {
    fn format(&self) -> RosterFormat {
        RosterFormat::NewrecruitSimple
    }

    fn detect(&self, decoded: &Value) -> bool {
        let Some(text) = decoded.as_str() else {
            return false;
        };
        let first_non_blank = text
            .split('\n')
            .map(|l| l.trim_end_matches('\r').trim())
            .find(|l| !l.is_empty());
        let Some(first) = first_non_blank else {
            return false;
        };
        if !RE_FIRST_LINE.is_match(first) {
            return false;
        }
        RE_ROSTER_HEADER_SIG.is_match(text)
    }

    fn parse(&self, decoded: &Value) -> Result<ParsedRoster, ParseError> {
        let text = decoded
            .as_str()
            .ok_or_else(|| ParseError("newrecruit-simple: input is not a string".into()))?;

        let mut name = String::from("Imported roster");
        let mut faction_raw_name: Option<String> = None;
        let mut declared_limit: Option<u64> = None;
        let mut total_reported: Option<u64> = None;
        let mut detachment_raw_name: Option<String> = None;
        let mut battle_size_raw: Option<String> = None;
        let mut units: Vec<ParsedUnit> = Vec::new();
        let mut enhancement_pts: Vec<u64> = Vec::new();
        let mut current: Option<UnitBuilder> = None;
        let mut multi_force = false;
        let mut section = Section::Preamble;

        let finalize = |current: &mut Option<UnitBuilder>,
                        units: &mut Vec<ParsedUnit>,
                        enhancement_pts: &mut Vec<u64>| {
            if let Some(b) = current.take() {
                let (u, pts) = b.finish();
                enhancement_pts.push(pts);
                units.push(u);
            }
        };

        for raw in text.split('\n') {
            let raw = raw.trim_end_matches('\r');
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }

            if section == Section::Preamble && name == "Imported roster" {
                if let Some(first) = parse_first_line(line) {
                    name = first.name;
                    faction_raw_name = first.faction;
                    declared_limit = first.declared_limit;
                    continue;
                }
            }

            if let Some(c) = RE_ROSTER_HEADER.captures(line) {
                total_reported = c[1].parse().ok();
                continue;
            }

            if let Some(c) = RE_SECTION_HEADER.captures(line) {
                finalize(&mut current, &mut units, &mut enhancement_pts);
                let heading = c[1].trim().to_ascii_lowercase();
                if heading == "configuration" {
                    section = Section::Configuration;
                } else {
                    section = Section::Units;
                    if heading.contains("allied") {
                        multi_force = true;
                    }
                }
                continue;
            }

            if section == Section::Configuration {
                if let Some(idx) = line.find(':') {
                    if idx > 0 {
                        let key = line[..idx].trim().to_ascii_lowercase();
                        let value = line[idx + 1..].trim();
                        if key == "battle size" {
                            battle_size_raw = Some(value.to_string());
                        } else if key == "detachment" {
                            detachment_raw_name = Some(value.to_string());
                        }
                    }
                }
                continue;
            }

            // Unit section.
            if let Some(c) = RE_BULLET.captures(raw) {
                if let Some(b) = current.as_mut() {
                    let count: u64 = c[1].parse().unwrap_or(0);
                    if b.wargear.is_empty() && b.model_count == 1 {
                        b.model_count = count;
                    } else {
                        b.model_count += count;
                    }
                    if let Some(m) = c.get(4) {
                        b.apply_tokens(m.as_str(), count);
                    }
                    continue;
                }
            }

            if let Some(c) = RE_UNIT_LINE.captures(line) {
                finalize(&mut current, &mut units, &mut enhancement_pts);
                let unit_name = c[1].trim().to_string();
                let pts: u64 = c[2].parse().unwrap_or(0);
                let mut builder = UnitBuilder::new(unit_name, Some(pts));
                if let Some(inline) = c.get(3) {
                    let inline = inline.as_str().trim();
                    if !inline.is_empty() {
                        builder.apply_tokens(inline, 1);
                    }
                }
                current = Some(builder);
                continue;
            }
        }
        finalize(&mut current, &mut units, &mut enhancement_pts);

        let mut total_computed: u64 = 0;
        for (i, u) in units.iter().enumerate() {
            total_computed += u.points.unwrap_or(0);
            total_computed += enhancement_pts.get(i).copied().unwrap_or(0);
        }

        Ok(ParsedRoster {
            name,
            generated_by: None,
            faction_raw_name,
            detachment_raw_name,
            battle_size_raw,
            declared_limit,
            total_reported,
            total_computed,
            units,
            multi_force,
        })
    }
}
