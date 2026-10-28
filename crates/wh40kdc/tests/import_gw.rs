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

// Headerless GW app export: `Attached Units` is a section, not preamble, and
// each `Attached Unit N` group pairs its Leader with its Bodyguard regardless
// of their order. Mirror of the TS gw-headerless attachment pairing.
const HEADERLESS_ATTACHED: &str = "Fabricated List (300 points)

Space Marines
Fabricated Task Force

Attached Units
Attached Unit 1

Alpha Leader (90 points)
• Attached as: Leader (Character)
  • 1x Blade

Alpha Squad (85 points)
• Attached as: Bodyguard
  • 5x Trooper
    • 5x Rifle

Attached Unit 2

Beta Squad (85 points)
• Attached as: Bodyguard
  • 5x Trooper
    • 5x Rifle

Beta Leader (50 points)
• Attached as: Support (Character)
  • 1x Blade
";

#[test]
fn headerless_pairs_attached_unit_groups() {
    let parsed = wh40kdc::import::GwHeaderlessAdapter
        .parse(&json!(HEADERLESS_ATTACHED))
        .expect("headerless parse");
    assert_eq!(parsed.faction_raw_name.as_deref(), Some("Space Marines"));
    assert_eq!(parsed.detachment_raw_names, vec!["Fabricated Task Force"]);
    let unit = |name: &str| parsed.units.iter().find(|u| u.raw_name == name).unwrap();

    let alpha = unit("Alpha Leader")
        .leader_attachment
        .clone()
        .flatten()
        .unwrap();
    assert_eq!(alpha.bodyguard_raw_name, "Alpha Squad");
    assert_eq!(alpha.role, AttachmentRole::Leader);
    let beta = unit("Beta Leader")
        .leader_attachment
        .clone()
        .flatten()
        .unwrap();
    assert_eq!(beta.bodyguard_raw_name, "Beta Squad");
    assert_eq!(beta.role, AttachmentRole::Support);
    assert_eq!(unit("Alpha Squad").leader_attachment, None);
    // `Attached as: … (Character)` flags the unit but grants no keyword.
    assert!(unit("Alpha Leader").is_character);
    assert_eq!(unit("Alpha Leader").keyword_overrides, None);
}
