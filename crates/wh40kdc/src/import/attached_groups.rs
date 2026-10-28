//! GW app "Attached Units" groups: `Attached Unit N` headings followed by units
//! whose `Attached as: Leader|Support|Bodyguard` annotation names their role.
//! Shared by the framed ([`super::gw`]) and headerless ([`super::gw_headerless`])
//! adapters. Mirror of the group handling in `tools/src/import/gw-headerless.ts`.

use once_cell::sync::Lazy;
use regex::Regex;

use super::types::{AttachmentRole, ParsedLeaderAttachment, ParsedUnit};

/// Role named by an `Attached as:` annotation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum AttachedAs {
    Leader,
    Support,
    Bodyguard,
}

static RE_ROLE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^(leader|support|bodyguard)\b").unwrap());
static RE_ATTACHED_UNIT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^attached unit\s+(\d+)$").unwrap());
static RE_ATTACHED_SECTION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^attached units?(?:\s+\d+)?$").unwrap());
static RE_ATTACHED_AS_SUPPORT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^attached as support\s*:?\s*$").unwrap());

/// The role at the start of an `Attached as:` annotation's value
/// (`Leader (Character)` → Leader), or None when it names no known role.
pub(super) fn attached_as_role(value: &str) -> Option<AttachedAs> {
    let c = RE_ROLE.captures(value.trim())?;
    Some(match c[1].to_ascii_lowercase().as_str() {
        "leader" => AttachedAs::Leader,
        "support" => AttachedAs::Support,
        _ => AttachedAs::Bodyguard,
    })
}

/// The group number of an `Attached Unit N` heading.
pub(super) fn attached_unit_number(line: &str) -> Option<u64> {
    RE_ATTACHED_UNIT
        .captures(line)
        .and_then(|c| c[1].parse().ok())
}

/// True for the `Attached Units` section heading (any case, optional number).
pub(super) fn is_attached_section(line: &str) -> bool {
    RE_ATTACHED_SECTION.is_match(line)
}

/// True for a bare `Attached as Support:` line, which marks the next unit.
pub(super) fn is_attached_as_support(line: &str) -> bool {
    RE_ATTACHED_AS_SUPPORT.is_match(line)
}

/// One unit inside an `Attached Unit N` group: its index in the parsed units,
/// the group number, and its role.
pub(super) struct GroupMember {
    pub unit_index: usize,
    pub group: u64,
    pub role: AttachedAs,
}

/// Point every Leader/Support member of a group at that group's first
/// Bodyguard. Groups without a Bodyguard are left unattached.
pub(super) fn pair_attached_groups(units: &mut [ParsedUnit], members: &[GroupMember]) {
    let mut groups: Vec<u64> = Vec::new();
    for member in members {
        if !groups.contains(&member.group) {
            groups.push(member.group);
        }
    }
    for group in groups {
        let in_group = || members.iter().filter(move |m| m.group == group);
        let Some(bodyguard) = in_group().find(|m| m.role == AttachedAs::Bodyguard) else {
            continue;
        };
        let bodyguard_raw_name = units[bodyguard.unit_index].raw_name.clone();
        for member in in_group().filter(|m| m.role != AttachedAs::Bodyguard) {
            units[member.unit_index].leader_attachment = Some(Some(ParsedLeaderAttachment {
                bodyguard_raw_name: bodyguard_raw_name.clone(),
                role: if member.role == AttachedAs::Support {
                    AttachmentRole::Support
                } else {
                    AttachmentRole::Leader
                },
                provisional: false,
            }));
        }
    }
}
