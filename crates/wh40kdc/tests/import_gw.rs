//! GW framed-export parsing: `(N Points)` unit headers, hollow `◦` model
//! children, the force-disposition header, and the `Attached Unit N` pairing
//! fence. Mirror of the TS `gwAdapter` tests in tools/test/import/gw.test.ts.

use serde_json::json;
use wh40kdc::import::{AttachmentRole, FormatAdapter, GwAdapter, ParsedRoster};

fn parse(text: &str) -> ParsedRoster {
    GwAdapter.parse(&json!(text)).expect("gw parse")
}

const ATTACHED: &str = "+++++++++++++++++++++++++++++++++++++++++++++++
+ FACTION KEYWORD: Chaos - Chaos Knights
+ DETACHMENT: Houndpack Lance (Marked Prey)
+ FORCE DISPOSITION: Disruption
+ TOTAL ARMY POINTS: 2000pts
+++++++++++++++++++++++++++++++++++++++++++++++

Attached Units
Attached Unit 1

War Dog Karnivore (165 Points)
• Attached as: Leader (Character)
• 1x Reaper chaintalon

Nurglings (40 pts)
• Attached as: Bodyguard
• 3x Nurgling Swarm
    • 3x Diseased claws and teeth

Attached Unit 2

War Dog Executioner (130 pts)
• Attached as: Support (Character)
• 1x Armoured feet

Beasts of Nurgle (140 pts)
• Attached as: Bodyguard
• 3x Beast of Nurgle
    • 3x Fleshy Claws

BATTLELINE

War Dog Brigand (140 pts)
• 1x Armoured feet
";

#[test]
fn reads_points_headers_and_force_disposition() {
    let parsed = parse(ATTACHED);
    assert_eq!(parsed.units.len(), 5);
    assert_eq!(parsed.units[0].raw_name, "War Dog Karnivore");
    assert_eq!(parsed.units[0].points, Some(165));
    assert_eq!(
        parsed.force_disposition_raw_name,
        Some(Some("Disruption".to_string()))
    );
}

#[test]
fn pairs_each_attached_unit_block_separately() {
    let parsed = parse(ATTACHED);
    let karnivore = &parsed.units[0];
    let attachment = karnivore.leader_attachment.clone().flatten().unwrap();
    assert_eq!(attachment.bodyguard_raw_name, "Nurglings");
    assert_eq!(attachment.role, AttachmentRole::Leader);
    assert!(karnivore.is_character);
    assert!(karnivore
        .wargear
        .iter()
        .all(|w| !w.raw_name.contains("Attached")));

    let executioner = &parsed.units[2];
    let attachment = executioner.leader_attachment.clone().flatten().unwrap();
    assert_eq!(attachment.bodyguard_raw_name, "Beasts of Nurgle");
    assert_eq!(attachment.role, AttachmentRole::Support);

    assert_eq!(parsed.units[1].leader_attachment, None);
    assert_eq!(parsed.units[4].leader_attachment, None);
}

#[test]
fn uses_hollow_bullets_as_child_depth() {
    let parsed = parse(
        "++++++++++++++++++++++++++++++++
+ FACTION KEYWORD: Orks
+ DETACHMENT: Bully Boyz
+ TOTAL ARMY POINTS: 105pts
+++++++++++++++++++++++++++++++

OTHER DATASHEETS

Nobz (105 Points)
• 1x Boss Nob
◦ 1x Power klaw
• 4x Nob
◦ 4x Power klaw
",
    );
    let nobz = &parsed.units[0];
    assert_eq!(nobz.model_count, 5);
    assert_eq!(nobz.wargear.len(), 1);
    assert_eq!(nobz.wargear[0].raw_name, "Power klaw");
    assert_eq!(nobz.wargear[0].count, 5);
}
