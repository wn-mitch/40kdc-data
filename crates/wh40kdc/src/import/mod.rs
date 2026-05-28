//! Army-list importer: turn an external list-builder export into a resolved
//! 40kdc [`Roster`].
//!
//! v1 supports ListForge's "share JSON" payload. The output is a [`Roster`]
//! keyed on 40kdc entity ids and validatable against
//! `schemas/core/roster.schema.json`. Resolution is lenient — unmatched names
//! are retained with candidate suggestions and summarised in diagnostics.
//!
//! The pipeline is three reusable stages: [`decode_listforge`] (share payload →
//! JSON), a [`FormatAdapter`] (JSON → [`ParsedRoster`]), and [`resolve`]
//! ([`ParsedRoster`] → [`Roster`]). Only the adapter is format-specific, so
//! supporting a new source format (New Recruit, Rosterizer, a native 40kdc
//! export) is one new [`FormatAdapter`] — `decode` and `resolve` are unchanged.
//!
//! ```no_run
//! use wh40kdc::Dataset;
//! use wh40kdc::import::import_listforge;
//!
//! // `input` is a ListForge URL, a bare base64 segment, or raw JSON.
//! # let input = "https://listforge.app/#/listforge/H4sIA…";
//! let roster = import_listforge(input, Dataset::embedded()).unwrap();
//! println!("resolved {} units", roster.diagnostics.resolved_units);
//! ```

// types are always compiled when this module is visible — both `import` and
// `export` features need them. The actual importer machinery (decode, the
// adapters, resolve) only compiles under `feature = "import"` since those
// pull in base64/flate2/regex/Dataset.
mod types;

#[cfg(feature = "import")]
mod adapter;
#[cfg(feature = "import")]
mod decode;
#[cfg(feature = "import")]
mod listforge;
#[cfg(feature = "import")]
mod newrecruit_json;
#[cfg(feature = "import")]
mod newrecruit_simple;
#[cfg(feature = "import")]
mod newrecruit_text;
#[cfg(feature = "import")]
mod newrecruit_wtc;
#[cfg(feature = "import")]
mod resolve;

pub use types::{
    BattleSize, Candidate, Diagnostics, GameVersionRef, ParsedRoster, ParsedUnit, ParsedWargear,
    ResolvedRef, Roster, RosterFormat, RosterLeaderAttachment, RosterPoints, RosterSource,
    RosterUnit, RosterWargear, Warning, WarningCode,
};

#[cfg(feature = "import")]
pub use adapter::{format_id, select_adapter, FormatAdapter, ParseError};
#[cfg(feature = "import")]
pub use decode::{decode_listforge, DecodeError};
#[cfg(feature = "import")]
pub use listforge::ListForgeAdapter;
#[cfg(feature = "import")]
pub use newrecruit_json::NewRecruitJsonAdapter;
#[cfg(feature = "import")]
pub use newrecruit_simple::NewRecruitSimpleAdapter;
#[cfg(feature = "import")]
pub use newrecruit_wtc::{NewRecruitWtcCompactAdapter, NewRecruitWtcFullAdapter};
#[cfg(feature = "import")]
pub use resolve::resolve;

#[cfg(feature = "import")]
use crate::data::Dataset;

/// An error importing an army list.
#[cfg(feature = "import")]
#[derive(Debug)]
pub enum ImportError {
    /// The share payload could not be decoded.
    Decode(DecodeError),
    /// No registered adapter recognised the payload, or it failed to parse.
    Parse(ParseError),
}

#[cfg(feature = "import")]
impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportError::Decode(e) => write!(f, "{e}"),
            ImportError::Parse(e) => write!(f, "{e}"),
        }
    }
}

#[cfg(feature = "import")]
impl std::error::Error for ImportError {}

#[cfg(feature = "import")]
impl From<DecodeError> for ImportError {
    fn from(e: DecodeError) -> Self {
        ImportError::Decode(e)
    }
}

#[cfg(feature = "import")]
impl From<ParseError> for ImportError {
    fn from(e: ParseError) -> Self {
        ImportError::Parse(e)
    }
}

/// The adapters available to [`import_roster`], in match-priority order.
///
/// NewRecruit-JSON runs ahead of ListForge because both recognise a
/// `roster.forces` BattleScribe payload; the NewRecruit signature is more
/// specific (xmlns or `generatedBy: newrecruit.eu`). The text adapters
/// (wtc-full / wtc-compact / simple) only match `Value::String` payloads and
/// disambiguate among themselves via structural cues — wtc-full goes before
/// wtc-compact because its matcher is the more specific of the two.
#[cfg(feature = "import")]
fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    vec![
        Box::new(NewRecruitJsonAdapter),
        Box::new(NewRecruitWtcFullAdapter),
        Box::new(NewRecruitWtcCompactAdapter),
        Box::new(NewRecruitSimpleAdapter),
        Box::new(ListForgeAdapter),
    ]
}

/// Import a ListForge army-list export into a resolved 40kdc [`Roster`].
///
/// `input` may be a full ListForge URL, a bare base64 segment, or an
/// already-decoded JSON string — all are handled transparently.
#[cfg(feature = "import")]
pub fn import_listforge(input: &str, ds: &Dataset) -> Result<Roster, ImportError> {
    let decoded = decode_listforge(input)?;
    import_roster(&decoded, ds)
}

/// Import an already-decoded payload. Selects the matching format adapter and
/// resolves the result against the dataset.
///
/// Accepts either a parsed JSON tree (NewRecruit JSON, ListForge) or
/// [`serde_json::Value::String`] wrapping raw text (the three NewRecruit
/// text formats). Most callers will use [`import_roster_text`] for the
/// string case.
#[cfg(feature = "import")]
pub fn import_roster(decoded: &serde_json::Value, ds: &Dataset) -> Result<Roster, ImportError> {
    let registry = adapters();
    let adapter = select_adapter(decoded, &registry)?;
    let parsed = adapter.parse(decoded)?;
    Ok(resolve(&parsed, ds, adapter.format()))
}

/// Import a raw text NewRecruit export (wtc-compact, wtc-full, or simple).
/// Wraps the string as [`serde_json::Value::String`] and dispatches through
/// the normal adapter registry.
#[cfg(feature = "import")]
pub fn import_roster_text(input: &str, ds: &Dataset) -> Result<Roster, ImportError> {
    let wrapped = serde_json::Value::String(input.to_string());
    import_roster(&wrapped, ds)
}
