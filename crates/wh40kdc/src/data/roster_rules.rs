//! Enhancement and leader-attachment rules the roster validator reads from
//! record fields: non-CHARACTER eligibility, required wargear, and the
//! detachment and shared-keyword gates on conditional attachment groups.
//! Mirror of `tools/src/data/enhancement-eligibility.ts` and
//! `attachmentGatesHold` in `tools/src/data/dataset-attachments.ts`.

use std::collections::{HashMap, HashSet};

use crate::generated::{Enhancement, LeaderAttachmentConditionalGroupsItem};
use crate::Dataset;

use super::dataset::{conditional_group_applies, matches_bodyguard_keywords};

/// Whether a unit that is not a CHARACTER may be given the enhancement: an
/// Upgrade, or one the record marks equipable.
pub(crate) fn equipable_by_non_character(enhancement: &Enhancement) -> bool {
    enhancement.upgrade_tag || enhancement.equipable_by_non_character
}

/// The weapons an enhancement requires (`required_wargear_ids`) that the
/// bearer's chosen loadout `counts` does not carry, in the record's order.
pub(crate) fn missing_required_wargear<'a>(
    enhancement: &'a Enhancement,
    counts: &HashMap<String, i64>,
) -> Vec<&'a str> {
    enhancement
        .required_wargear_ids
        .iter()
        .flatten()
        .map(|id| id.as_str())
        .filter(|id| counts.get(*id).copied().unwrap_or(0) <= 0)
        .collect()
}

/// The roster facts an attachment group's detachment and shared-keyword gates read.
pub(crate) struct AttachmentGateContext<'a> {
    pub roster_unit_ids: &'a HashSet<String>,
    pub detachment_ids: &'a [String],
    pub leader_keywords: &'a HashSet<String>,
    pub bodyguard_keywords: &'a HashSet<String>,
}

fn group_gates_hold(
    group: &LeaderAttachmentConditionalGroupsItem,
    ctx: &AttachmentGateContext<'_>,
) -> bool {
    let selected = |id: &str| ctx.detachment_ids.iter().any(|d| d == id);
    if group
        .required_detachment_id
        .as_ref()
        .is_some_and(|id| !selected(id.as_str()))
    {
        return false;
    }
    if group
        .excluded_detachment_id
        .as_ref()
        .is_some_and(|id| selected(id.as_str()))
    {
        return false;
    }
    group.required_shared_keyword.as_ref().is_none_or(|k| {
        ctx.leader_keywords.contains(k.as_str()) && ctx.bodyguard_keywords.contains(k.as_str())
    })
}

/// Whether `leader_id` may join `bodyguard_id` under the roster's detachment
/// and shared-keyword gates: true when an unconditional id or keyword clause
/// admits the bodyguard or a roster-applicable conditional group listing it has
/// its gates hold; false when every such group fails a gate. A bodyguard no
/// group lists is true here (eligibility itself is checked elsewhere).
pub(crate) fn attachment_gates_hold(
    dataset: &Dataset,
    leader_id: &str,
    bodyguard_id: &str,
    ctx: &AttachmentGateContext<'_>,
) -> bool {
    let bodyguard = dataset.units.get_any(bodyguard_id);
    let mut gated = false;
    for la in &dataset.leader_attachments {
        if la.leader_id.as_str() != leader_id {
            continue;
        }
        if la
            .eligible_bodyguard_ids
            .iter()
            .any(|id| id.as_str() == bodyguard_id)
            || bodyguard.is_some_and(|b| matches_bodyguard_keywords(la, b))
        {
            return true;
        }
        for group in &la.conditional_groups {
            if !group
                .eligible_bodyguard_ids
                .iter()
                .any(|id| id.as_str() == bodyguard_id)
                || !conditional_group_applies(group, ctx.roster_unit_ids)
            {
                continue;
            }
            if group_gates_hold(group, ctx) {
                return true;
            }
            gated = true;
        }
    }
    !gated
}
