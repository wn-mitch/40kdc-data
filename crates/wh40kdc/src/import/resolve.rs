//! Resolve a [`ParsedRoster`] onto 40kdc entity ids, producing a [`Roster`].
//!
//! Resolution is lenient: a name that doesn't match a 40kdc entity yields a
//! [`ResolvedRef`] with `id: None`, `resolved: false`, and up to five candidate
//! suggestions — the roster is never dropped or rejected. Everything that didn't
//! resolve cleanly is summarised in the [`Diagnostics`] block.
//!
//! Matching reuses the dataset's own lookups ([`Dataset::find_*`], `find_all`,
//! `by_faction`) and [`normalize_name`](crate::normalize_name); there is no
//! bespoke fuzzy matcher. Faction is resolved first so unit/detachment/
//! enhancement lookups can be scoped to it — the same unit id can appear under
//! several factions, so scoping disambiguates.
//!
//! Rust mirror of `tools/src/import/resolve.ts`.

use crate::data::{normalize_name, Dataset};

use super::types::{
    BattleSize, Candidate, Diagnostics, ParsedRoster, ParsedUnit, ResolvedRef, Roster,
    RosterLeaderAttachment, RosterPoints, RosterSource, RosterUnit, RosterWargear, Warning,
    WarningCode,
};

/// The dataset edition/dataslate stamped onto an imported roster.
const ROSTER_EDITION: &str = "11th";
const ROSTER_DATASLATE: &str = "pre-launch-provisional";

const MAX_CANDIDATES: usize = 5;

/// Accumulates warnings and resolved/unresolved tallies during an import.
#[derive(Default)]
struct DiagnosticsBuilder {
    resolved_units: u64,
    unresolved_units: u64,
    resolved_weapons: u64,
    unresolved_weapons: u64,
    warnings: Vec<Warning>,
}

impl DiagnosticsBuilder {
    fn warn(&mut self, code: WarningCode, message: &str, raw_name: Option<&str>) {
        self.warnings.push(Warning {
            code,
            message: message.to_string(),
            raw_name: raw_name.map(str::to_string),
        });
    }

    fn build(self) -> Diagnostics {
        Diagnostics {
            resolved_units: self.resolved_units,
            unresolved_units: self.unresolved_units,
            resolved_weapons: self.resolved_weapons,
            unresolved_weapons: self.unresolved_weapons,
            warnings: self.warnings,
        }
    }
}

fn unresolved(raw_name: &str, candidates: Vec<Candidate>) -> ResolvedRef {
    ResolvedRef {
        id: None,
        raw_name: raw_name.to_string(),
        resolved: false,
        candidates,
    }
}

fn resolved(id: &str, raw_name: &str) -> ResolvedRef {
    ResolvedRef {
        id: Some(id.to_string()),
        raw_name: raw_name.to_string(),
        resolved: true,
        candidates: Vec::new(),
    }
}

/// Map a source battle-size label to the 40kdc enum, if recognisable.
fn map_battle_size(raw: Option<&str>) -> Option<BattleSize> {
    let key = normalize_name(raw?);
    if key.contains("strike force") {
        Some(BattleSize::StrikeForce)
    } else if key.contains("incursion") {
        Some(BattleSize::Incursion)
    } else {
        None
    }
}

/// Resolve a [`ParsedRoster`] against the dataset.
///
/// # Examples
///
/// ```
/// use wh40kdc::Dataset;
/// use wh40kdc::import::{import_roster, decode_listforge};
///
/// let payload = decode_listforge(r#"{
///     "name": "Demo",
///     "roster": { "name": "Demo", "forces": [] }
/// }"#).unwrap();
/// let roster = import_roster(&payload, Dataset::embedded()).unwrap();
/// assert_eq!(roster.source.format, "listforge");
/// ```
pub fn resolve(parsed: &ParsedRoster, ds: &Dataset, format: &str) -> Roster {
    let mut diag = DiagnosticsBuilder::default();

    if parsed.multi_force {
        diag.warn(
            WarningCode::MultiForce,
            "Source list contains more than one faction; the primary faction was used for scoping.",
            None,
        );
    }

    // --- Faction (resolved first so other lookups can scope to it). ---------
    let mut faction_id: Option<String> = None;
    if let Some(raw) = &parsed.faction_raw_name {
        if let Some(hit) = ds.factions.find(raw) {
            faction_id = Some(hit.id.as_str().to_string());
        } else {
            diag.warn(
                WarningCode::FactionUnresolved,
                "Faction name did not match any 40kdc faction.",
                Some(raw),
            );
        }
    }

    // --- Detachment (scoped to faction, then global fallback). --------------
    let mut detachment_id: Option<String> = None;
    if let Some(raw) = &parsed.detachment_raw_name {
        let key = normalize_name(raw);
        let scoped = faction_id.as_deref().and_then(|f| {
            ds.detachments
                .by_faction(f)
                .into_iter()
                .find(|d| normalize_name(&d.name) == key)
        });
        let hit = scoped.or_else(|| ds.detachments.find(raw));
        if let Some(hit) = hit {
            detachment_id = Some(hit.id.as_str().to_string());
        } else {
            diag.warn(
                WarningCode::DetachmentUnresolved,
                "Detachment name did not match any 40kdc detachment.",
                Some(raw),
            );
        }
    }

    // --- Battle size. -------------------------------------------------------
    let battle_size = map_battle_size(parsed.battle_size_raw.as_deref());
    if parsed.battle_size_raw.is_some() && battle_size.is_none() {
        diag.warn(
            WarningCode::BattleSizeUnmapped,
            "Battle size label could not be mapped.",
            parsed.battle_size_raw.as_deref(),
        );
    }

    // --- Units (and their enhancements / wargear). --------------------------
    let mut units: Vec<RosterUnit> = parsed
        .units
        .iter()
        .map(|u| {
            resolve_unit(
                u,
                faction_id.as_deref(),
                detachment_id.as_deref(),
                ds,
                &mut diag,
            )
        })
        .collect();

    // --- Leader attachments (second pass: needs all resolved unit ids). -----
    infer_leader_attachments(&parsed.units, &mut units, ds, &mut diag);

    // --- Points reconciliation (reported vs computed kept distinct). --------
    if let Some(reported) = parsed.total_reported {
        if reported != parsed.total_computed {
            diag.warn(
                WarningCode::PointsMismatch,
                &format!(
                    "Source-reported total ({reported}) differs from the sum of cost lines ({}).",
                    parsed.total_computed
                ),
                None,
            );
        }
    }

    Roster {
        name: parsed.name.clone(),
        source: RosterSource {
            format: format.to_string(),
            generated_by: parsed.generated_by.clone(),
        },
        faction_id,
        detachment_id,
        battle_size,
        points: RosterPoints {
            declared_limit: parsed.declared_limit,
            total_reported: parsed.total_reported,
            total_computed: parsed.total_computed,
        },
        units,
        game_version: super::types::GameVersionRef {
            edition: ROSTER_EDITION.to_string(),
            dataslate: ROSTER_DATASLATE.to_string(),
        },
        diagnostics: diag.build(),
    }
}

fn resolve_unit(
    parsed: &ParsedUnit,
    faction_id: Option<&str>,
    detachment_id: Option<&str>,
    ds: &Dataset,
    diag: &mut DiagnosticsBuilder,
) -> RosterUnit {
    // Prefer a faction-scoped match (the same unit id recurs across factions),
    // then fall back to a global name lookup.
    let key = normalize_name(&parsed.raw_name);
    let all = ds.units.find_all(&parsed.raw_name);
    let scoped_id = faction_id.and_then(|f| {
        ds.units
            .by_faction(f)
            .into_iter()
            .find(|u| normalize_name(&u.name) == key)
            .map(|u| u.id.as_str().to_string())
    });
    let hit_id = scoped_id.or_else(|| all.first().map(|u| u.id.as_str().to_string()));

    let ref_ = if let Some(id) = &hit_id {
        diag.resolved_units += 1;
        resolved(id, &parsed.raw_name)
    } else {
        diag.unresolved_units += 1;
        diag.warn(
            WarningCode::UnitUnresolved,
            "Unit name did not match any 40kdc unit.",
            Some(&parsed.raw_name),
        );
        unresolved(&parsed.raw_name, unit_candidates(&all))
    };

    let enhancement = parsed
        .enhancement_raw_name
        .as_deref()
        .map(|name| resolve_enhancement(name, detachment_id, ds, diag));
    let enhancement_points = if enhancement.is_some() {
        parsed.enhancement_points
    } else {
        None
    };

    let wargear = parsed
        .wargear
        .iter()
        .map(|w| {
            let hits = ds.weapons.find_all(&w.raw_name);
            if let Some(first) = hits.first() {
                diag.resolved_weapons += 1;
                RosterWargear {
                    ref_: resolved(first.id.as_str(), &w.raw_name),
                    count: w.count,
                }
            } else {
                diag.unresolved_weapons += 1;
                diag.warn(
                    WarningCode::WeaponUnresolved,
                    "Weapon name did not match any 40kdc weapon.",
                    Some(&w.raw_name),
                );
                RosterWargear {
                    ref_: unresolved(&w.raw_name, weapon_candidates(&hits)),
                    count: w.count,
                }
            }
        })
        .collect();

    RosterUnit {
        ref_,
        model_count: parsed.model_count,
        points: parsed.points,
        is_warlord: parsed.is_warlord,
        enhancement,
        enhancement_points,
        wargear,
        leader_attachment: None,
    }
}

fn resolve_enhancement(
    raw_name: &str,
    detachment_id: Option<&str>,
    ds: &Dataset,
    diag: &mut DiagnosticsBuilder,
) -> ResolvedRef {
    let key = normalize_name(raw_name);
    // Enhancements belong to a detachment, not a faction — scope by detachment_id.
    let scoped = detachment_id.and_then(|det| {
        ds.enhancements
            .all()
            .iter()
            .find(|e| e.detachment_id.as_str() == det && normalize_name(&e.name) == key)
    });
    let hit = scoped.or_else(|| ds.enhancements.find(raw_name));
    if let Some(hit) = hit {
        return resolved(hit.id.as_str(), raw_name);
    }
    diag.warn(
        WarningCode::EnhancementUnresolved,
        "Enhancement name did not match any 40kdc enhancement.",
        Some(raw_name),
    );
    let candidates = ds
        .enhancements
        .find_all(raw_name)
        .iter()
        .take(MAX_CANDIDATES)
        .map(|e| Candidate {
            id: e.id.as_str().to_string(),
            name: e.name.to_string(),
        })
        .collect();
    unresolved(raw_name, candidates)
}

/// Infer leader→bodyguard attachments. The source format does not encode an
/// unambiguous attachment, so each inferred link is marked provisional: a
/// resolved character unit is matched against a resolved non-character unit in
/// the same roster using the dataset's leader-attachment data.
fn infer_leader_attachments(
    parsed_units: &[ParsedUnit],
    units: &mut [RosterUnit],
    ds: &Dataset,
    diag: &mut DiagnosticsBuilder,
) {
    let bodyguard_ids: std::collections::HashSet<String> = units
        .iter()
        .zip(parsed_units)
        .filter(|(u, p)| u.ref_.id.is_some() && !p.is_character)
        .filter_map(|(u, _)| u.ref_.id.clone())
        .collect();

    // First compute the attachments (immutable borrow of units), then apply
    // them (mutable borrow) to avoid overlapping borrows.
    let mut planned: Vec<(usize, String, String)> = Vec::new(); // (leader idx, bodyguard id, bodyguard raw name)
    for (i, (unit, parsed)) in units.iter().zip(parsed_units).enumerate() {
        let Some(leader_id) = &unit.ref_.id else {
            continue;
        };
        if !parsed.is_character {
            continue;
        }
        let Some(attachment) = ds
            .leader_attachments
            .iter()
            .find(|la| la.leader_id.as_str() == leader_id)
        else {
            continue;
        };
        let Some(bodyguard_id) = attachment
            .eligible_bodyguard_ids
            .iter()
            .map(|e| e.as_str())
            .find(|id| bodyguard_ids.contains(*id))
        else {
            continue;
        };
        let Some(bodyguard) = units
            .iter()
            .find(|u| u.ref_.id.as_deref() == Some(bodyguard_id))
        else {
            continue;
        };
        planned.push((i, bodyguard_id.to_string(), bodyguard.ref_.raw_name.clone()));
    }

    for (idx, bodyguard_id, bodyguard_raw_name) in planned {
        units[idx].leader_attachment = Some(RosterLeaderAttachment {
            bodyguard_ref: resolved(&bodyguard_id, &bodyguard_raw_name),
            provisional: true,
        });
        let leader_raw = units[idx].ref_.raw_name.clone();
        diag.warn(
            WarningCode::LeaderAttachmentInferred,
            "Leader attachment was inferred from leader-attachment data and is provisional.",
            Some(&leader_raw),
        );
    }
}

fn unit_candidates(records: &[&crate::Unit]) -> Vec<Candidate> {
    records
        .iter()
        .take(MAX_CANDIDATES)
        .map(|u| Candidate {
            id: u.id.as_str().to_string(),
            name: u.name.to_string(),
        })
        .collect()
}

fn weapon_candidates(records: &[&crate::Weapon]) -> Vec<Candidate> {
    records
        .iter()
        .take(MAX_CANDIDATES)
        .map(|w| Candidate {
            id: w.id.as_str().to_string(),
            name: w.name.to_string(),
        })
        .collect()
}
