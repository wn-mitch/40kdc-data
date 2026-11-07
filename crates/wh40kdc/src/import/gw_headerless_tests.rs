//! Unit tests for the headerless plain-text adapter ([`super`]).

use super::*;
use serde_json::json;

// GW app export (world-eaters dialect): `(N Points)`, ALL-CAPS sections,
// `◦` child wargear, single-model characters with bare/`Nx` wargear.
const GW_APP: &str = "Ding dong (1995 Points)

World Eaters
Berzerker Warband
Strike Force (2,000 Points)

CHARACTERS

Khârn the Betrayer (100 Points)
  • Warlord
  • 1x Gorechild
  • 1x Plasma pistol

Master of Executions (95 Points)
  • 1x Axe of dismemberment
  • Enhancements: Berzerker Glaive

BATTLELINE

Khorne Berzerkers (180 Points)
  • 1x Khorne Berzerker Champion
     ◦ 1x Chainblade
  • 9x Khorne Berzerker
     ◦ 8x Bolt pistol
     ◦ 7x Chainblade

Exported with App Version: v1.48.0 (1), Data Version: v750
";

// Markdown `##` fixture dialect: `(N pts)`, `• Nx Model: wargear`.
const MD_FIXTURE: &str = "Test Army - Space Marines - Gladius Task Force (300 pts)

## Battleline (200 pts)
Intercessor Squad (200 pts)
  • 4x Intercessor: Bolt rifle
  • Intercessor Sergeant: Bolt rifle
";

// NewRecruit body dialect with a bare title: `Title:` sections and
// deeper-`•` children. ListForge's three-segment first line is excluded.
const NR_TEXT: &str = "Daemon Incursion (1995 Points)

Character:
Bloodmaster (65 pts)
  • Blade of blood

Battleline:
Bloodletters (110 pts)
  • Bloodreaper
    • Hellblade
  • Instrument of Chaos
  • 9x Bloodletter
    • 9x Hellblade
";

const LISTFORGE_TEXT: &str = "all gas no breaks - Chaos Daemons - Daemonic Incursion (1995 Points)
Character:
Bloodmaster (65 pts)
  • Blade of blood
";

#[test]
fn detects_only_headerless_bullet_text() {
    assert!(GwHeaderlessAdapter.detect(&json!(GW_APP)));
    assert!(GwHeaderlessAdapter.detect(&json!(MD_FIXTURE)));
    assert!(GwHeaderlessAdapter.detect(&json!(NR_TEXT)));
    assert!(!GwHeaderlessAdapter.detect(&json!(LISTFORGE_TEXT)));
    // Framed GW export belongs to GwAdapter.
    assert!(!GwHeaderlessAdapter.detect(&json!("+ FACTION KEYWORD: X\n\nU (1 pts)\n• 1x W\n")));
    // No bullets → not this family.
    assert!(!GwHeaderlessAdapter.detect(&json!("U (100 pts)\n")));
    assert!(!GwHeaderlessAdapter.detect(&json!({"roster": {}})));
}

#[test]
fn parses_gw_app_export() {
    let p = GwHeaderlessAdapter.parse(&json!(GW_APP)).unwrap();
    assert_eq!(p.name, "Ding dong");
    // Faction / detachment are read from the bare preamble lines.
    assert_eq!(p.faction_raw_name.as_deref(), Some("World Eaters"));
    assert_eq!(
        p.detachment_raw_names,
        vec!["Berzerker Warband".to_string()]
    );
    assert_eq!(p.units.len(), 3);

    let kharn = &p.units[0];
    assert_eq!(kharn.raw_name, "Khârn the Betrayer");
    assert!(kharn.is_warlord);
    assert!(kharn.is_character); // CHARACTERS section
    assert_eq!(kharn.model_count, 1);
    assert!(kharn.wargear.iter().any(|w| w.raw_name == "Gorechild"));

    let moe = &p.units[1];
    assert_eq!(
        moe.enhancement_raw_name.as_deref(),
        Some("Berzerker Glaive")
    );

    let zerks = &p.units[2];
    assert_eq!(zerks.model_count, 10); // 1 champion + 9
    let bolt = zerks
        .wargear
        .iter()
        .find(|w| w.raw_name == "Bolt pistol")
        .unwrap();
    assert_eq!(bolt.count, 8);
}

#[test]
fn parses_md_fixture_model_count() {
    let p = GwHeaderlessAdapter.parse(&json!(MD_FIXTURE)).unwrap();
    assert_eq!(p.units.len(), 1);
    let squad = &p.units[0];
    assert_eq!(squad.raw_name, "Intercessor Squad");
    assert_eq!(squad.model_count, 5); // 4 + 1
    let bolt = squad
        .wargear
        .iter()
        .find(|w| w.raw_name == "Bolt rifle")
        .unwrap();
    assert_eq!(bolt.count, 5);
}

#[test]
fn parses_nr_text_dialect() {
    let p = GwHeaderlessAdapter.parse(&json!(NR_TEXT)).unwrap();
    assert_eq!(p.units.len(), 2);
    let bloodmaster = &p.units[0];
    assert_eq!(bloodmaster.model_count, 1);
    assert!(bloodmaster
        .wargear
        .iter()
        .any(|w| w.raw_name == "Blade of blood"));
    let letters = &p.units[1];
    assert_eq!(letters.model_count, 10); // Bloodreaper + 9 Bloodletter
    assert!(letters.wargear.iter().any(|w| w.raw_name == "Hellblade"));
}

// GW app v2.0.5 "Attached Units" export: models nest under `Attached as:`
// annotations, and each model bullets only its first weapon — the rest are
// unbulleted, deeper-indented continuation lines.
const GW_V2_ATTACHED: &str = "Test List (2275 points)

Aeldari
Armoured Warhost

Attached Units
Attached Unit 1

Warlock Conclave (120 points)
• Attached as: Leader
• Leading: Eldrad Ulthran
  • 4x Warlock
    • 4x Destructor
      4x Shuriken pistol
      4x Singing Spear

Eldrad Ulthran (130 points)
• Attached   as: Leader (Character)
• Leader: Warlock Conclave
  • Warlord
  • 1x Mind War
    1x Shuriken pistol
    1x The Staff of Ulthamar and witchblade

OTHER DATASHEETS

Fire Prism (150 points)
  • 1x Prism cannon
    1x Twin shuriken catapult
    1x Wraithbone hull

Fire Dragons (120 points)
  • 1x Fire Dragon Exarch
    • 1x Close combat weapon
      1x Firepike
  • 4x Fire Dragon
    • 4x Close combat weapon
      4x Dragon fusion gun

Exported with App Version: v2.0.5 (128), Data Version: v886
";

#[test]
fn parses_gw_v2_attached_format() {
    let p = GwHeaderlessAdapter.parse(&json!(GW_V2_ATTACHED)).unwrap();
    let unit = |name: &str| p.units.iter().find(|u| u.raw_name == name).unwrap();
    let count = |u: &ParsedUnit, name: &str| {
        u.wargear
            .iter()
            .find(|w| w.raw_name == name)
            .map(|w| w.count)
    };

    // Model group with an `Attached as:` prefix: the model line is `Warlock`,
    // and both the bulleted and the two unbulleted continuation weapons attach.
    let conclave = unit("Warlock Conclave");
    assert_eq!(conclave.model_count, 4);
    assert_eq!(count(conclave, "Destructor"), Some(4));
    assert_eq!(count(conclave, "Shuriken pistol"), Some(4)); // dropped pre-fix
    assert_eq!(count(conclave, "Singing Spear"), Some(4)); // dropped pre-fix
    assert!(!conclave.wargear.iter().any(|w| w.raw_name == "Warlock"));
    assert!(!conclave
        .wargear
        .iter()
        .any(|w| w.raw_name.to_lowercase().contains("leader")));
    assert!(!conclave
        .wargear
        .iter()
        .any(|w| w.raw_name.to_lowercase().contains("leading")));

    // `Attached as: … (Character)` flags the unit; `Warlord` is still read.
    let eldrad = unit("Eldrad Ulthran");
    assert_eq!(eldrad.model_count, 1);
    assert!(eldrad.is_character);
    assert!(eldrad.is_warlord);
    assert_eq!(count(eldrad, "Shuriken pistol"), Some(1));
    assert_eq!(
        count(eldrad, "The Staff of Ulthamar and witchblade"),
        Some(1)
    );
    assert!(!eldrad
        .wargear
        .iter()
        .any(|w| w.raw_name.to_lowercase().contains("leader")));

    // A lone bulleted weapon trailed by plain continuations is a single-model
    // unit whose bullet is wargear, not a model group.
    let prism = unit("Fire Prism");
    assert_eq!(prism.model_count, 1);
    assert_eq!(count(prism, "Prism cannon"), Some(1));
    assert_eq!(count(prism, "Twin shuriken catapult"), Some(1));
    assert_eq!(count(prism, "Wraithbone hull"), Some(1));

    // Two model groups, each `model → • weapon → plain weapon`.
    let dragons = unit("Fire Dragons");
    assert_eq!(dragons.model_count, 5); // 1 Exarch + 4
    assert_eq!(count(dragons, "Close combat weapon"), Some(5));
    assert_eq!(count(dragons, "Firepike"), Some(1));
    assert_eq!(count(dragons, "Dragon fusion gun"), Some(4));
}
#[test]
fn recovers_unframed_event_preamble_without_phantom_unit() {
    let input = "Participant
Team
Drukhari
Recon (1995 points)
Skysplinter Assault (3 Detachment Points)

1995 points

CHARACTERS

Archon (100 points)
• Warlord
• 1x Huskblade
";
    let parsed = GwHeaderlessAdapter.parse(&json!(input)).unwrap();
    assert_eq!(parsed.name, "Recon");
    assert_eq!(parsed.declared_limit, Some(1995));
    assert_eq!(parsed.faction_raw_name.as_deref(), Some("Drukhari"));
    assert_eq!(
        parsed.detachment_raw_names,
        vec!["Skysplinter Assault".to_string()]
    );
    assert_eq!(parsed.units.len(), 1);
    assert_eq!(parsed.units[0].raw_name, "Archon");
}
