//! Roster exporters — the symmetric counterpart to the importer.
//!
//! [`export_roster`] dispatches to one of five registered serializers
//! (NewRecruit JSON, the three NewRecruit text formats, and the canonical
//! Roster JSON). Each serializer is deterministic and Dataset-free, so the
//! TS and Rust mirrors can produce byte-identical output for
//! cross-implementation conformance.
//!
//! Rust mirror of `tools/src/export/`.

mod helpers;
mod newrecruit_json;
mod newrecruit_simple;
mod newrecruit_wtc;
mod roster_json;
mod rosterizer;

pub use newrecruit_json::NewRecruitJsonSerializer;
pub use newrecruit_simple::NewRecruitSimpleSerializer;
pub use newrecruit_wtc::{NewRecruitWtcCompactSerializer, NewRecruitWtcFullSerializer};
pub use roster_json::RosterJsonSerializer;
pub use rosterizer::RosterizerSerializer;

use crate::import::Roster;

/// The five formats `exportRoster` can emit. Mirrors the TS `ExportFormat`
/// union — NewRecruit ones share kebab-case names with [`RosterFormat`]
/// (so a `Roster` originally imported as one of these can round-trip back
/// out), and `roster-json` is the canonical pivot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    NewrecruitJson,
    NewrecruitWtcCompact,
    NewrecruitWtcFull,
    NewrecruitSimple,
    RosterJson,
    Rosterizer,
}

/// Symmetric counterpart to [`FormatAdapter`](crate::import::FormatAdapter):
/// turn a resolved [`Roster`] into a single target format.
pub trait RosterSerializer {
    fn id(&self) -> ExportFormat;
    fn serialize(&self, roster: &Roster) -> String;
}

/// Serialize a [`Roster`] into the named target format.
pub fn export_roster(roster: &Roster, format: ExportFormat) -> String {
    match format {
        ExportFormat::NewrecruitJson => NewRecruitJsonSerializer.serialize(roster),
        ExportFormat::NewrecruitWtcCompact => NewRecruitWtcCompactSerializer.serialize(roster),
        ExportFormat::NewrecruitWtcFull => NewRecruitWtcFullSerializer.serialize(roster),
        ExportFormat::NewrecruitSimple => NewRecruitSimpleSerializer.serialize(roster),
        ExportFormat::RosterJson => RosterJsonSerializer.serialize(roster),
        ExportFormat::Rosterizer => RosterizerSerializer.serialize(roster),
    }
}
