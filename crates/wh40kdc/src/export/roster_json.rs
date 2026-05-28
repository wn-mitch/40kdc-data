//! Canonical Roster JSON serializer — emits the [`Roster`] as 2-space JSON,
//! the same shape the importers consume. This is the lossless pivot, so the
//! pretty-printed text is exactly `roster.schema.json` shape.
//!
//! Rust mirror of `tools/src/export/roster-json.ts`.

use crate::import::Roster;

use super::helpers::pretty_json;
use super::{ExportFormat, RosterSerializer};

pub struct RosterJsonSerializer;

impl RosterSerializer for RosterJsonSerializer {
    fn id(&self) -> ExportFormat {
        ExportFormat::RosterJson
    }

    fn serialize(&self, roster: &Roster) -> String {
        pretty_json(roster)
    }
}
