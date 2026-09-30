#![cfg(feature = "bundled-data")]

use std::collections::HashSet;

use serde_json::json;
use wh40kdc::{Dataset, RawData};

fn dataset(overlap: bool) -> Dataset {
    let unit = |id: &str| {
        json!({
            "id": id,
            "name": id,
            "faction_id": "example-faction",
            "game_version": { "edition": "11th", "dataslate": "example" },
            "profiles": [{ "M": 6, "T": 4, "Sv": 3, "W": 1, "Ld": 6, "OC": 1 }]
        })
    };
    let mut groups = vec![
        json!({
            "role": "support",
            "eligible_bodyguard_ids": ["example-other-bodyguard", "example-bodyguard"],
            "required_roster_unit_ids": ["example-gate"]
        }),
        json!({
            "role": "leader", "eligible_bodyguard_ids": ["example-other-bodyguard"],
            "excluded_roster_unit_ids": ["example-gate"]
        }),
    ];
    if overlap {
        groups.push(json!({
            "role": "leader", "eligible_bodyguard_ids": ["example-bodyguard"],
            "required_roster_unit_ids": ["example-gate"]
        }));
    }
    let raw: RawData = serde_json::from_value(json!({
        "units": [unit("example-leader"), unit("example-bodyguard"),
                  unit("example-other-bodyguard"), unit("example-gate")],
        "leader_attachments": [{
            "leader_id": "example-leader", "eligible_bodyguard_ids": [],
            "conditional_groups": groups,
            "game_version": { "edition": "11th", "dataslate": "example" }
        }]
    }))
    .expect("fabricated attachment dataset deserializes");
    Dataset::from_raw(raw)
}

#[test]
fn conditional_attachment_requires_roster_context_and_leader_wins_overlap() {
    let ds = dataset(false);
    let without_gate = HashSet::new();
    let with_gate = HashSet::from(["example-gate".to_string()]);
    assert_eq!(ds.bodyguards_attachable_from("example-leader").len(), 2);
    assert!(ds
        .leaders_attachable_to_in_roster("example-bodyguard", Some(&without_gate))
        .is_empty());
    assert!(ds
        .leaders_attachable_to_in_roster("example-bodyguard", Some(&with_gate))
        .iter()
        .any(|unit| unit.id.as_str() == "example-leader"));
    assert!(ds
        .bodyguards_attachable_from_in_roster("example-leader", Some(&without_gate))
        .iter()
        .any(|unit| unit.id.as_str() == "example-other-bodyguard"));
    assert_eq!(
        ds.bodyguard_ids_attachable_from_in_roster("example-leader", &with_gate)
            .collect::<Vec<_>>(),
        vec!["example-other-bodyguard", "example-bodyguard"]
    );
    assert_eq!(
        ds.effective_attachment_role("example-leader", None, &with_gate)
            .map(|role| role.to_string()),
        Some("support".to_string())
    );
    assert_eq!(
        dataset(true)
            .effective_attachment_role("example-leader", None, &with_gate)
            .map(|role| role.to_string()),
        Some("leader".to_string())
    );
}
