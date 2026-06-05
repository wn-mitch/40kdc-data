//! Types for the army-list importer.
//!
//! Two layers live here:
//! - The **output** types ([`Roster`] and friends) mirror
//!   `schemas/core/roster.schema.json` field-for-field. They are hand-authored
//!   rather than codegen'd so importer work isn't gated on the schema→typify
//!   round-trip; the JSON Schema stays the conformance oracle (an integration
//!   test validates serialized output against it).
//! - The **intermediate** type ([`ParsedRoster`]) is format-agnostic: a
//!   [`FormatAdapter`](super::FormatAdapter) lowers a source payload to this
//!   shape (raw names + counts only, no resolved ids), and
//!   [`resolve`](super::resolve) turns it into a [`Roster`].
//!
//! Nothing here ever carries reproduced rules or ability text — only permitted
//! facts (names, counts, points, keywords, entity ids).

use serde::{Deserialize, Serialize};

/// A 40kdc battle size (mirrors the shared `battle-size` def).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BattleSize {
    Incursion,
    StrikeForce,
}

/// The source format an army list was imported from. Mirrors the
/// `source.format` enum on `schemas/core/roster.schema.json` and the
/// `RosterFormat` union on the TS side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RosterFormat {
    Listforge,
    NewrecruitJson,
    NewrecruitWtcCompact,
    NewrecruitWtcFull,
    NewrecruitSimple,
    Rosterizer,
    Gw,
    ListforgeText,
}

/// Diagnostic warning codes emitted during an import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WarningCode {
    FactionUnresolved,
    UnitUnresolved,
    WeaponUnresolved,
    EnhancementUnresolved,
    DetachmentUnresolved,
    BattleSizeUnmapped,
    PointsMismatch,
    LeaderAttachmentInferred,
    MultiForce,
    UnknownField,
}

// ---------------------------------------------------------------------------
// Output types (mirror roster.schema.json)
// ---------------------------------------------------------------------------

/// A near-match suggestion offered when resolution fails.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Candidate {
    pub id: String,
    pub name: String,
}

/// A reference to a 40kdc entity that may or may not have resolved. Retains the
/// source's raw name so the import is lossless even on a miss.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolvedRef {
    /// Resolved entity id, or `None` when no match was found.
    pub id: Option<String>,
    /// The display name exactly as it appeared in the source payload.
    pub raw_name: String,
    /// True iff [`id`](Self::id) is `Some`.
    pub resolved: bool,
    /// Up to five best-guess alternatives when resolution failed.
    pub candidates: Vec<Candidate>,
}

/// A weapon/wargear selection on a unit.
///
/// `ref` is a Rust keyword, so the field is named `ref_` and serialized as the
/// JSON key `ref` to match the schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RosterWargear {
    #[serde(rename = "ref")]
    pub ref_: ResolvedRef,
    pub count: u64,
}

/// An inferred, always-provisional leader→bodyguard attachment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RosterLeaderAttachment {
    pub bodyguard_ref: ResolvedRef,
    pub provisional: bool,
}

/// One unit entry in a roster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RosterUnit {
    #[serde(rename = "ref")]
    pub ref_: ResolvedRef,
    pub model_count: u64,
    /// Base unit cost (without the enhancement).
    pub points: Option<u64>,
    pub is_warlord: bool,
    pub enhancement: Option<ResolvedRef>,
    /// Points cost of the enhancement when the source reported one; `None`
    /// otherwise. Lets a Roster round-trip cleanly through formats that print
    /// enhancements as a separate `+N pts` line.
    pub enhancement_points: Option<u64>,
    pub wargear: Vec<RosterWargear>,
    pub leader_attachment: Option<RosterLeaderAttachment>,
}

/// Provenance of the imported list.
///
/// `format` is the stable id of the adapter that produced this roster. The
/// canonical enum lives in `schemas/core/roster.schema.json`; new adapters
/// extend [`RosterFormat`] there first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RosterSource {
    pub format: RosterFormat,
    pub generated_by: Option<String>,
}

/// Point totals; reported and computed are kept distinct, never reconciled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RosterPoints {
    pub declared_limit: Option<u64>,
    pub total_reported: Option<u64>,
    pub total_computed: u64,
}

/// A single diagnostic warning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Warning {
    pub code: WarningCode,
    pub message: String,
    pub raw_name: Option<String>,
}

/// A summary of what resolved and what did not during the import.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostics {
    pub resolved_units: u64,
    pub unresolved_units: u64,
    pub resolved_weapons: u64,
    pub unresolved_weapons: u64,
    pub warnings: Vec<Warning>,
}

/// Reference to the game edition + dataslate (mirrors `game-version-ref`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GameVersionRef {
    pub edition: String,
    pub dataslate: String,
}

/// A fully-resolved army list. Validates against `roster.schema.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Roster {
    pub name: String,
    pub source: RosterSource,
    pub faction_id: Option<String>,
    pub detachment_id: Option<String>,
    pub battle_size: Option<BattleSize>,
    pub points: RosterPoints,
    pub units: Vec<RosterUnit>,
    pub game_version: GameVersionRef,
    pub diagnostics: Diagnostics,
}

impl Roster {
    /// The roster's leader entry attached to `bodyguard_unit_id`, if any.
    /// Import stores the inferred (always-provisional) attachment on the
    /// *leader's* [`RosterUnit`], pointing down to its bodyguard via
    /// `leader_attachment.bodyguard_ref`. Selection UIs start from the body
    /// unit, so this scans for the leader whose `bodyguard_ref.id` matches.
    /// Returns `None` when no leader in the roster is attached to that unit
    /// (the common case — attachments are optional at game start).
    pub fn attached_leader_for(&self, bodyguard_unit_id: &str) -> Option<&RosterUnit> {
        self.units.iter().find(|u| {
            u.leader_attachment
                .as_ref()
                .and_then(|la| la.bodyguard_ref.id.as_deref())
                == Some(bodyguard_unit_id)
        })
    }

    /// Every roster unit attached to `unit_id`, resolved from *either* end of
    /// the attachment — a leader + bodyguard are one combined unit, so a
    /// selection UI may start from either half:
    ///   - `unit_id` is the **bodyguard** → the leader(s) pointing down at it
    ///     (the [`attached_leader_for`](Self::attached_leader_for) direction), and
    ///   - `unit_id` is the **leader** → the bodyguard its own
    ///     `leader_attachment` points to.
    ///
    /// Returns the partner [`RosterUnit`]s (deduped, source order). Empty when
    /// the unit takes part in no attachment — the common case, since
    /// attachments are optional at game start. A `Vec` to carry 11th edition's
    /// multi-member attachments without an API change.
    pub fn attachment_partners_for(&self, unit_id: &str) -> Vec<&RosterUnit> {
        let mut out: Vec<&RosterUnit> = Vec::new();
        for u in &self.units {
            // Body-first: leaders pointing down at `unit_id`.
            if u.leader_attachment
                .as_ref()
                .and_then(|la| la.bodyguard_ref.id.as_deref())
                == Some(unit_id)
                && !out.iter().any(|q| std::ptr::eq(*q, u))
            {
                out.push(u);
            }
            // Leader-first: `unit_id`'s own entry points down at a bodyguard.
            if u.ref_.id.as_deref() == Some(unit_id) {
                if let Some(la) = u.leader_attachment.as_ref() {
                    if let Some(bodyguard) = self
                        .units
                        .iter()
                        .find(|b| b.ref_.id.as_deref() == la.bodyguard_ref.id.as_deref())
                    {
                        if !out.iter().any(|q| std::ptr::eq(*q, bodyguard)) {
                            out.push(bodyguard);
                        }
                    }
                }
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Intermediate types (format-agnostic; produced by a parser adapter)
// ---------------------------------------------------------------------------

/// A weapon/wargear selection before id resolution.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ParsedWargear {
    pub raw_name: String,
    pub count: u64,
}

/// A unit selection before id resolution.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ParsedUnit {
    pub raw_name: String,
    /// True when the source classifies this as a character/leader-capable model.
    pub is_character: bool,
    pub model_count: u64,
    /// Base unit cost (without the enhancement).
    pub points: Option<u64>,
    pub is_warlord: bool,
    pub enhancement_raw_name: Option<String>,
    /// Points cost of the enhancement when the source reported one; `None`
    /// otherwise.
    pub enhancement_points: Option<u64>,
    pub wargear: Vec<ParsedWargear>,
}

/// The format-agnostic intermediate. A [`FormatAdapter`](super::FormatAdapter)
/// produces this from a decoded source payload; [`resolve`](super::resolve)
/// consumes it. Contains only raw display names and counts — never reproduced
/// rules text.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ParsedRoster {
    pub name: String,
    pub generated_by: Option<String>,
    /// Raw faction name from the source (e.g. "Grey Knights").
    pub faction_raw_name: Option<String>,
    /// Raw detachment name (e.g. "Banishers").
    pub detachment_raw_name: Option<String>,
    /// Raw battle-size label (e.g. "2. Strike Force (2000 Point limit)").
    pub battle_size_raw: Option<String>,
    /// Points limit parsed from the battle-size label, if any.
    pub declared_limit: Option<u64>,
    /// Total points reported by the source cost block.
    pub total_reported: Option<u64>,
    /// Points summed from every cost line in the source tree.
    pub total_computed: u64,
    pub units: Vec<ParsedUnit>,
    /// True when the source contained more than one distinct faction.
    pub multi_force: bool,
}
