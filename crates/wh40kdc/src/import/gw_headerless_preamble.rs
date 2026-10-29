//! Text framing around the headerless plain-text body ([`super::gw_headerless`]):
//! the BCP summary block, dense-line recovery, and the preamble metadata between
//! the roster title and the first unit. Mirror of the matching helpers in
//! `tools/src/import/gw-headerless.ts`.

use once_cell::sync::Lazy;
use regex::Regex;

static RE_PLUS_FENCE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\++$").unwrap());
/// A line inside the fence identifying it as BCP's (not GW's own `+ …` fence).
static RE_BCP_SUMMARY_MARKER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?im)^\s*\+?\s*(?:Player Name|Team Name|Factions? Used|Army Points)\s*:").unwrap()
});
/// The BCP summary's `WARLORD:` line, which names the warlord unit by prefix.
static RE_BCP_WARLORD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?im)^\s*\+?\s*WARLORD:\s*(.+?)\s*$").unwrap());
/// The GW app's own battle-size line, which marks GW app text embedded below a
/// fence.
pub(super) static RE_EMBEDDED_APP_BATTLE_SIZE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?im)^\s*(?:Combat Patrol|Incursion|Strike Force|Onslaught)\s*\(\s*[\d.,]+\s*Points?\s*\)\s*$",
    )
    .unwrap()
});
static RE_DENSE_ATTACHED: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(Attached Units)\s+(Attached Unit\s+\d+)$").unwrap());
static RE_DENSE_METADATA: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(.+?\(\s*\d+\s+Detachment Points?\s*\))\s+(Disruption|Priority Assets|Purge the Foe|Reconnaissance|Take and Hold)\s+((?:Combat Patrol|Incursion|Strike Force|Onslaught)\s*\(.+\))$").unwrap()
});
static RE_DENSE_COUNT_START: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+[x×]\s").unwrap());
static RE_DENSE_LEADING_BULLET: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[•◦]\s*(.+)$").unwrap());
static RE_AND_BEFORE_LAST: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\s+and\s+").unwrap());
static RE_PREAMBLE_METADATA: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^([^:]{1,32}):\s*(.+)$").unwrap());
static RE_DETACHMENT_KEY: Lazy<Regex> = Lazy::new(|| Regex::new(r"^det(?:a|at)chments?$").unwrap());
static RE_DISPOSITION_KEY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^force dispositions?$").unwrap());
static RE_SELECTED_SUFFIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s*\(selected\)\.?\s*$").unwrap());
static RE_DETACHMENT_POINTS_SUFFIX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\s*\(\s*\d*\s*(?:Detachment Points?|Detachementpoints?|DP|PD)\s*\)\s*$")
        .unwrap()
});

pub(super) const FORCE_DISPOSITION_NAMES: &[&str] = &[
    "disruption",
    "priority assets",
    "purge the foe",
    "reconnaissance",
    "recon",
    "take and hold",
];
/// Super-faction breadcrumbs the GW app prints before the real faction.
const GENERIC_FACTION_BREADCRUMBS: &[&str] = &["chaos", "imperium", "space marines", "xenos"];

fn is_disposition(line: &str) -> bool {
    FORCE_DISPOSITION_NAMES
        .iter()
        .any(|name| line.eq_ignore_ascii_case(name))
}

pub(super) fn strip_detachment_points_suffix(line: &str) -> String {
    RE_DETACHMENT_POINTS_SUFFIX.replace(line, "").to_string()
}

/// Drop the first `++…++`-fenced block when it is a BCP summary (`Player Name:`
/// / `Factions Used:` / `Army Points:` …) or when the text after it carries the
/// GW app's battle-size line, keeping the lines around it. The block is BCP
/// metadata; left in, its fence would be consumed as the roster title and the
/// real title would become a phantom unit. A framed GW export's own
/// `+ FACTION KEYWORD:` fence matches neither condition and is left intact.
pub(super) fn strip_bcp_summary(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let is_fence = |line: &&str| RE_PLUS_FENCE.is_match(line.trim());
    let Some(open) = lines.iter().position(is_fence) else {
        return text.to_string();
    };
    let Some(close) = lines[open + 1..]
        .iter()
        .position(is_fence)
        .map(|i| open + 1 + i)
    else {
        return text.to_string();
    };
    let block = lines[open + 1..close].join("\n");
    let remainder = lines[close + 1..].join("\n");
    if !RE_BCP_SUMMARY_MARKER.is_match(&block) && !RE_EMBEDDED_APP_BATTLE_SIZE.is_match(&remainder)
    {
        return text.to_string();
    }
    lines[..open]
        .iter()
        .chain(&lines[close + 1..])
        .copied()
        .collect::<Vec<_>>()
        .join("\n")
}

/// The unit name prefix on a BCP summary `WARLORD:` line, if any.
pub(super) fn summary_warlord(text: &str) -> Option<String> {
    RE_BCP_WARLORD
        .captures(text)
        .map(|c| c[1].trim().to_string())
}

/// Rewrite the ` and ` after the last comma of a wargear list to `, `
/// (`a, b and c` → `a, b, c`); a list without a comma is only trimmed. Mirror
/// of TS `replace(/\s+and\s+(?=[^,]+$)/i, ", ")`.
pub(super) fn join_final_and(list: &str) -> String {
    let Some(last_comma) = list.rfind(',') else {
        return list.trim().to_string();
    };
    let tail = &list[last_comma + 1..];
    match RE_AND_BEFORE_LAST
        .find_iter(tail)
        .find(|m| m.end() < tail.len())
    {
        Some(m) => format!(
            "{}{}, {}",
            &list[..last_comma + 1],
            &tail[..m.start()],
            &tail[m.end()..]
        )
        .trim()
        .to_string(),
        None => list.trim().to_string(),
    }
}

/// Split `s` at each run of tab/space/NBSP whose preceding char passes `before`
/// and whose remainder passes `after`, dropping the run. Mirror of the TS
/// lookbehind/lookahead splits in `expandDenseLines`.
fn split_before_runs(
    s: &str,
    before: impl Fn(char) -> bool,
    after: impl Fn(&str) -> bool,
) -> Vec<&str> {
    let is_run = |c: char| matches!(c, ' ' | '\t' | '\u{a0}');
    let chars: Vec<(usize, char)> = s.char_indices().collect();
    let mut parts = Vec::new();
    let mut start = 0;
    let mut i = 1;
    while i < chars.len() {
        if !is_run(chars[i].1) {
            i += 1;
            continue;
        }
        let mut end = i;
        while end < chars.len() && is_run(chars[end].1) {
            end += 1;
        }
        let prev = chars[i - 1].1;
        let rest_at = chars.get(end).map_or(s.len(), |c| c.0);
        if !prev.is_whitespace() && before(prev) && after(&s[rest_at..]) {
            parts.push(&s[start..chars[i].0]);
            start = rest_at;
        }
        i = end;
    }
    parts.push(&s[start..]);
    parts
}

/// Recover line breaks stripped by spreadsheet/copy-paste pipelines: a `•`/`◦`
/// bullet or an `Nx ` count after other text on the same line starts a new
/// logical line. A count right after "," or ":" stays in its `Model: a, 2x b`
/// list. Mirror of TS `expandDenseLines`.
pub(super) fn expand_dense_lines(text: &str, is_pts_line: impl Fn(&str) -> bool) -> Vec<String> {
    let mut out = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        let bullet_parts = split_before_runs(
            raw,
            |_| true,
            |rest| rest.starts_with('•') || rest.starts_with('◦'),
        );
        for bullet_part in bullet_parts {
            let trimmed = bullet_part.trim();
            if let Some(c) = RE_DENSE_ATTACHED.captures(trimmed) {
                out.extend([c[1].to_string(), c[2].to_string()]);
                continue;
            }
            if let Some(c) = RE_DENSE_METADATA.captures(trimmed) {
                out.extend([c[1].to_string(), c[2].to_string(), c[3].to_string()]);
                continue;
            }
            let count_parts = split_before_runs(
                bullet_part,
                |c| !matches!(c, '•' | '◦' | '*' | ',' | ':'),
                |rest| RE_DENSE_COUNT_START.is_match(rest),
            );
            for part in count_parts {
                match RE_DENSE_LEADING_BULLET.captures(part.trim()) {
                    Some(c) if is_pts_line(&c[1]) => out.push(c[1].to_string()),
                    _ => out.push(part.to_string()),
                }
            }
        }
    }
    out
}

/// Metadata lines between the title and the first body section or unit,
/// classified once that body opens.
pub(super) struct Preamble {
    pub open: bool,
    pub lines: Vec<String>,
    pub faction_raw_name: Option<String>,
    pub detachment_raw_names: Vec<String>,
    pub force_disposition_raw_name: Option<String>,
}

/// What a preamble `key: value` line set.
pub(super) enum Metadata {
    /// Not a recognized metadata key.
    None,
    /// `Player:` / `Team:` — skipped without consuming the title.
    Skip,
    ListName(String),
    BattleSize(String),
    /// Faction, detachment, or force disposition, recorded on the preamble.
    Recorded,
}

impl Preamble {
    pub fn new() -> Self {
        Preamble {
            open: true,
            lines: Vec::new(),
            faction_raw_name: None,
            detachment_raw_names: Vec::new(),
            force_disposition_raw_name: None,
        }
    }

    pub fn has_disposition_line(&self) -> bool {
        self.lines.iter().any(|line| is_disposition(line))
    }

    /// Apply a `key: value` preamble line (`Faction: Orks`).
    pub fn metadata(&mut self, line: &str) -> Metadata {
        let Some(c) = RE_PREAMBLE_METADATA.captures(line) else {
            return Metadata::None;
        };
        let key = c[1].trim().to_lowercase();
        let value = c[2].trim();
        match key.as_str() {
            "player" | "team" => Metadata::Skip,
            "list name" => Metadata::ListName(value.to_string()),
            "battle size" => Metadata::BattleSize(value.to_string()),
            "faction" | "factions" | "faction keyword" => {
                self.faction_raw_name = Some(value.to_string());
                Metadata::Recorded
            }
            _ if RE_DETACHMENT_KEY.is_match(&key) => {
                self.detachment_raw_names
                    .push(strip_detachment_points_suffix(value));
                Metadata::Recorded
            }
            _ if RE_DISPOSITION_KEY.is_match(&key) => {
                let value = RE_SELECTED_SUFFIX.replace(value, "");
                let first = value.split(',').next().unwrap_or_default();
                self.force_disposition_raw_name = Some(first.trim().to_string());
                Metadata::Recorded
            }
            _ => Metadata::None,
        }
    }

    /// Classify the collected lines: a force-disposition line, then the faction
    /// (skipping a super-faction breadcrumb when more lines follow), then every
    /// remaining line as a detachment with its `(N Detachment Points)` cost
    /// stripped. Values already set from `key: value` metadata are kept.
    pub fn close(&mut self) {
        if !self.open {
            return;
        }
        self.open = false;
        let mut parts = std::mem::take(&mut self.lines);
        if let Some(index) = parts.iter().position(|part| is_disposition(part)) {
            let disposition = parts.remove(index);
            self.force_disposition_raw_name.get_or_insert(disposition);
        }
        if self.faction_raw_name.is_none() && !parts.is_empty() {
            let mut faction = parts.remove(0);
            if parts.len() > 1
                && GENERIC_FACTION_BREADCRUMBS
                    .iter()
                    .any(|b| faction.eq_ignore_ascii_case(b))
            {
                faction = parts.remove(0);
            }
            self.faction_raw_name = Some(faction);
        }
        if self.detachment_raw_names.is_empty() {
            // Keep logical lines separate: the resolver has the dataset needed
            // to tell detachment metadata from event comments.
            self.detachment_raw_names.extend(
                parts
                    .iter()
                    .map(|part| strip_detachment_points_suffix(part))
                    .filter(|part| !part.is_empty()),
            );
        }
    }
}
