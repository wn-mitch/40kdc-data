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

mod adapter;
mod decode;
mod listforge;
mod resolve;
mod types;

pub use adapter::{select_adapter, FormatAdapter, ParseError};
pub use decode::{decode_listforge, DecodeError};
pub use listforge::ListForgeAdapter;
pub use resolve::resolve;
pub use types::{
    BattleSize, Candidate, Diagnostics, GameVersionRef, ParsedRoster, ParsedUnit, ParsedWargear,
    ResolvedRef, Roster, RosterLeaderAttachment, RosterPoints, RosterSource, RosterUnit,
    RosterWargear, Warning, WarningCode,
};

use crate::data::Dataset;

/// An error importing an army list.
#[derive(Debug)]
pub enum ImportError {
    /// The share payload could not be decoded.
    Decode(DecodeError),
    /// No registered adapter recognised the payload, or it failed to parse.
    Parse(ParseError),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportError::Decode(e) => write!(f, "{e}"),
            ImportError::Parse(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ImportError {}

impl From<DecodeError> for ImportError {
    fn from(e: DecodeError) -> Self {
        ImportError::Decode(e)
    }
}

impl From<ParseError> for ImportError {
    fn from(e: ParseError) -> Self {
        ImportError::Parse(e)
    }
}

/// The adapters available to [`import_roster`], in match-priority order.
fn adapters() -> Vec<Box<dyn FormatAdapter>> {
    vec![Box::new(ListForgeAdapter)]
}

/// Import a ListForge army-list export into a resolved 40kdc [`Roster`].
///
/// `input` may be a full ListForge URL, a bare base64 segment, or an
/// already-decoded JSON string — all are handled transparently.
pub fn import_listforge(input: &str, ds: &Dataset) -> Result<Roster, ImportError> {
    let decoded = decode_listforge(input)?;
    import_roster(&decoded, ds)
}

/// Import an already-decoded payload. Selects the matching format adapter and
/// resolves the result against the dataset.
pub fn import_roster(decoded: &serde_json::Value, ds: &Dataset) -> Result<Roster, ImportError> {
    let registry = adapters();
    let adapter = select_adapter(decoded, &registry)?;
    let parsed = adapter.parse(decoded)?;
    Ok(resolve(&parsed, ds, adapter.format()))
}
