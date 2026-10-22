# MFM Legends cull — DRY RUN

Drops repo units absent from the live (non-Legends) dump and prunes their wargear-options,
unit-compositions, leader-attachment refs, and now-orphaned weapons/wargear. Abilities follow
their units: dead `unit_ids` are stripped, and an ability no surviving unit carries is removed.

| Dir | Units dropped | (legends/FW) | Wargear-opts | Comps | Leader entries | Bodyguard refs | Weapons | Wargear |
|---|--:|:--|--:|--:|--:|--:|--:|--:|
| adeptus-custodes | 6 | 4/2 | 4 | 6 | 2 | 6 | 12 | 0 |
| **TOTAL** | **6** | 4/2 | **4** | **6** | **2** | **6** | **12** | **0** |

## adeptus-custodes — dropped 6

- venerable-contemptor-dreadnought (legends)
- sagittarum-custodians (forge-world)
- aleya (legends)
- venerable-land-raider (legends)
- valerian (legends)
- custodian-guard-with-adrasite-and-pyrithite-spears (forge-world)

**Weapons removed (orphaned):** adrasite-spear, adrastus-bolt-caliver, armoured-tracks-venerable-land-raider, balistus-grenade-launcher-gilded-blades, castellan-axe-gilded-blades, contemptor-combat-weapon, gnosis, kheres-pattern-assault-cannon, misericordia-sagittarum-custodians, pyrithite-spear, somnus, storm-bolter-venerable-land-raider

## Abilities

| Dir | Removed | Unit refs stripped | Phase mappings removed |
|---|--:|--:|--:|
| adeptus-custodes | 10 | 2 | 9 |

- adeptus-custodes: assault-ramp-adeptus-custodes, custodian-guard-adeptus-custodes, disintegration-beams-adeptus-custodes, golden-laurels-adeptus-custodes, hero-of-lions-gate-adeptus-custodes, no-foe-shall-stand-adeptus-custodes, saturation-volleys-adeptus-custodes, tactical-perception-adeptus-custodes, tenacious-spirit-adeptus-custodes, unyielding-ancient-adeptus-custodes

