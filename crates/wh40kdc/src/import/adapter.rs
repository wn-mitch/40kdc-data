//! The format-adapter seam.
//!
//! Each supported source format implements [`FormatAdapter`]: it recognises a
//! decoded payload ([`detect`](FormatAdapter::detect)) and lowers it to the
//! format-agnostic [`ParsedRoster`] ([`parse`](FormatAdapter::parse)).
//! Resolution onto 40kdc entity ids happens once, downstream, against any
//! `ParsedRoster` — so adding a new source format (New Recruit, Rosterizer, a
//! native 40kdc export, …) means writing one adapter, not touching
//! [`decode`](super::decode_listforge) or [`resolve`](super::resolve).
//!
//! v1 registers only [`ListForgeAdapter`](super::ListForgeAdapter).

use serde_json::Value;

use super::types::{ParsedRoster, RosterFormat};

/// Recognises and parses one source list-export format.
///
/// A `decoded` payload is either a parsed JSON tree (NewRecruit JSON,
/// ListForge) or a `Value::String` wrapping raw text (the three NewRecruit
/// WTC / simple text formats). Adapters that only handle one shape can
/// short-circuit in [`detect`](FormatAdapter::detect).
pub trait FormatAdapter {
    /// Stable identifier for the format. Carries through to
    /// [`Roster.source.format`](super::types::Roster).
    fn format(&self) -> RosterFormat;

    /// Whether this adapter can parse the given decoded payload. Should be a
    /// cheap structural sniff, not a full parse.
    fn detect(&self, decoded: &Value) -> bool;

    /// Lower a recognised payload to the format-agnostic intermediate.
    fn parse(&self, decoded: &Value) -> Result<ParsedRoster, ParseError>;
}

/// An error lowering a payload to a [`ParsedRoster`].
#[derive(Debug)]
pub struct ParseError(pub String);

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ParseError {}

/// Pick the first registered adapter whose [`detect`](FormatAdapter::detect)
/// recognises the payload.
pub fn select_adapter<'a>(
    decoded: &Value,
    adapters: &'a [Box<dyn FormatAdapter>],
) -> Result<&'a dyn FormatAdapter, ParseError> {
    adapters
        .iter()
        .map(AsRef::as_ref)
        .find(|a| a.detect(decoded))
        .ok_or_else(|| {
            let tried: Vec<String> = adapters
                .iter()
                .map(|a| format_id(a.format()).to_string())
                .collect();
            let tried = if tried.is_empty() {
                "none".to_string()
            } else {
                tried.join(", ")
            };
            ParseError(format!(
                "no registered import adapter recognises this payload (tried: {tried})"
            ))
        })
}

/// Stable kebab-case identifier for a [`RosterFormat`] — matches the schema's
/// `source.format` enum members and the TS `RosterFormat` union strings.
pub fn format_id(fmt: RosterFormat) -> &'static str {
    match fmt {
        RosterFormat::Listforge => "listforge",
        RosterFormat::NewrecruitJson => "newrecruit-json",
        RosterFormat::NewrecruitWtcCompact => "newrecruit-wtc-compact",
        RosterFormat::NewrecruitWtcFull => "newrecruit-wtc-full",
        RosterFormat::NewrecruitSimple => "newrecruit-simple",
        RosterFormat::Rosterizer => "rosterizer",
        RosterFormat::Gw => "gw",
        RosterFormat::ListforgeText => "listforge-text",
    }
}
