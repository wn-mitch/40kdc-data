//! Warlord eligibility from the per-model Warlord flags on unit-composition
//! rows (`cannot_be_warlord`, `can_be_non_character_warlord`,
//! `is_supreme_commander`). The core rules select a CHARACTER model as
//! Warlord; an army that includes Supreme Commander units must pick one of
//! them; and "cannot be your Warlord" outranks "must be your Warlord".
//! Mirror of TS `tools/src/data/roster-warlord.ts`.

use std::collections::{BTreeSet, HashSet};

use super::roster::{RosterViolation, RosterViolationCode, Severity};
use crate::generated::UnitCompositionModelsItem;

/// One resolved roster unit, as the Warlord checks see it.
pub(crate) struct WarlordUnit<'a> {
    pub unit_id: &'a str,
    pub is_warlord: bool,
    /// CHARACTER by role, keyword, conditional keyword or roster override.
    pub is_character: bool,
    /// The unit composition's model rows; empty when the unit has none.
    pub rows: &'a [UnitCompositionModelsItem],
}

/// True when no model of the unit can be the Warlord.
fn cannot_lead(u: &WarlordUnit) -> bool {
    !u.rows.is_empty() && u.rows.iter().all(|m| m.cannot_be_warlord)
}

/// Warlord violations for `units` (indexed like the roster; `None` for an
/// unresolved unit). `detachment_warlords` holds the datasheets a selected
/// detachment names for Warlord; naming lifts `cannot_be_warlord`.
pub(crate) fn warlord_violations(
    units: &[Option<WarlordUnit>],
    detachment_warlords: &HashSet<&str>,
) -> Vec<RosterViolation> {
    let mut out = Vec::new();
    let barred = |u: &WarlordUnit| cannot_lead(u) && !detachment_warlords.contains(u.unit_id);
    for (idx, u) in units.iter().enumerate() {
        let Some(u) = u else { continue };
        if !u.is_warlord {
            continue;
        }
        if barred(u) {
            out.push(RosterViolation {
                code: RosterViolationCode::CannotBeWarlord,
                id: u.unit_id.to_string(),
                message: format!("{} cannot be your Warlord", u.unit_id),
                unit_index: Some(idx),
                severity: Severity::Error,
            });
        }
        if !u.is_character && !u.rows.iter().any(|m| m.can_be_non_character_warlord) {
            out.push(RosterViolation {
                code: RosterViolationCode::WarlordNotCharacter,
                id: u.unit_id.to_string(),
                message: format!(
                    "{} is not a Character and cannot be your Warlord",
                    u.unit_id
                ),
                unit_index: Some(idx),
                severity: Severity::Error,
            });
        }
    }
    // Checked only when a Warlord is chosen; a missing one is `no-warlord`.
    if !units.iter().flatten().any(|u| u.is_warlord) {
        return out;
    }
    let supreme: Vec<&WarlordUnit> = units
        .iter()
        .flatten()
        .filter(|u| {
            !barred(u)
                && u.rows
                    .iter()
                    .any(|m| m.is_supreme_commander && !m.cannot_be_warlord)
        })
        .collect();
    if !supreme.is_empty() && !supreme.iter().any(|u| u.is_warlord) {
        let ids: Vec<&str> = supreme
            .iter()
            .map(|u| u.unit_id)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        out.push(RosterViolation {
            code: RosterViolationCode::WarlordNotSupremeCommander,
            id: ids.join("+"),
            message: format!("the Warlord must be one of: {}", ids.join(", ")),
            unit_index: None,
            severity: Severity::Error,
        });
    }
    out
}
