# Salvo damage coverage review

## Verdict and scope

The four-faction damage matrix is diagnostic evidence, not a certification of optimal or legal damage stacks. CSM fight rankings are invalid; other results contain demonstrated undercounts, timing errors, and missing candidates. These findings are not fixed by this report.

The run covered Chaos Space Marines, Adeptus Mechanicus, Death Guard, and T'au Empire against eleven templates in shooting and fighting: 88 scenarios. Two Sol audits reconstructed stacks, ran bounded API counterexamples, and checked owner-bound source mechanics. Raw source prose is not reproduced here.

The matrix maximizes uncapped expected damage after saves, damage reduction, and Feel No Pain. It assumes one-inch distance, half range, stationary shooting, and a successful charge. It permits up to three detachment points and one selected Stratagem. External support is assumed positioned; its cost is displayed but not penalized. There is no army points budget, exact casualty calculation, or discrete overkill allocation.

Outer candidate pools were uncapped. Inner optimization uses four loadout coordinate sweeps and two add-only lever passes: it is not exhaustive and cannot replace an already selected exclusive option.

## Selected stacks into Intercessors

### Chaos Space Marines shooting: 39.58

Defiler with ectoplasma destructor, two heavy reaper autocannons, and two magma cutters; Veterans of the Long War. Dark Pacts supplies Lethal Hits; Focus of Hatred supplies failed-hit rerolls. No enhancement, Stratagem, or external support selected.

Contribution trace: 26.29 baseline → 28.14 with Lethal Hits → 39.58 with rerolls. Replacing Lethal Hits with Sustained Hits 1 gives 46.50 for the same stack. The optimizer misses this replacement.

### Chaos Space Marines fight: 79.05, invalid

Ten Legionaries, Red Corsairs Reave-Captain, and five Masters of the Maelstrom; Soulforged Warpack. Applied Lethal Hits, wound-one rerolls, Brutal Raider's Strength/AP improvements, and Debt to the Soul Forge's additional Attacks.

Two fatal errors:

- Debt to the Soul Forge requires a Heretic Astartes Daemon Vehicle. Public DSL omits the Daemon Vehicle restriction. All eleven fight winners receive an ineligible bonus.
- Nine fight winners equip ten Legionary heavy melee weapons. The owner source permits one ordinary Legionary and the champion to take one each, at most two. Generated wargear options conflate an any-number chainsword replacement with restricted heavy/special choices. Public composition independently caps the ordinary heavy-melee variant at one.

These rankings need a corrected rerun, not a numerical patch.

### Adeptus Mechanicus shooting: 37.30

Six Kataphron Breachers with heavy arc rifles, Manipulus with magnarail lance, and Technoarcheologist; Data-Psalm Conclave. Protector improves Ballistic Skill and grants Heavy; Panegyric improves AP; Breaching Command rerolls hit ones; Galvanic Field supplies Lethal Hits. No enhancement, Stratagem, or external support selected. Baseline 17.83 rises to 37.30.

### Adeptus Mechanicus fight: 40.33

Four Kastelan Robots with twin fists and Cybernetica Datasmith with power fist; Luminen Auto Choir. Conqueror improves Weapon Skill; Echoes of the Conduit Wars rerolls hit and wound ones; Battle Protocols adds Attacks. One Stratagem, no enhancement or external support.

Trace: 16.74 → 22.22 with Conqueror → 26.21 with rerolls → 40.33 with protocols across relevant members. Repeated own-unit/attached-unit labels in these examples affect distinct members rather than double-applying to one model.

### Death Guard shooting: 38.97

Defiler with Hades battlecannon, two heavy reaper autocannons, and two magma cutters; Flyblown Host. Droning Horror rerolls hit and wound ones. External Lord of Virulence supplies Blight Bombardment's full failed-hit rerolls to Blast weapons; support costs 90 points.

Trace: 26.94 → 36.67 with Droning Horror → 38.97 with support.

### Death Guard fight: 34.22

Six Deathshroud and Lord of Contagion using manreaper strike profiles; Contagion Engines. Fresh Vectors rerolls wound ones; Vector of Disease supplies Sustained Hits 1. No enhancement or external support.

Both Death Guard examples omit Nurgle's Gift's target debuffs because the resolver cannot establish the enemy-in-range target. A diagnostic application of Toughness reduction plus the save-worsening plague raises the same MEQ stacks to 52.53 shooting and 51.29 fighting. These are counterfactual probes, not optimized replacements.

### T'au shooting: 109.02, understated

Manta with two heavy rail weapons, six overcharged ion weapons, two long-barrelled burst arrays, two missile pods, and ten seeker missiles; Retaliation Cadre. Arro'kon Protocol supplies Sustained Hits 1; Aggressive Deployment rerolls failed wounds; external Shadowsun rerolls hit ones and costs 100 points.

Drones incorrectly gives the Manta an outgoing wound penalty. The owner mechanic is Guardian Drone protection against incoming ranged attacks for an appropriately upgraded unit, not a faction-wide offensive penalty. Removing only this error raises the same stack to 125.32.

For the Greater Good is also unresolved: an eligible Observer and Guided/Spotted relationship are not established. A hit bonus must not be granted unconditionally as a substitute.

### T'au fight: 20.44

Six Krootox Rampagers with hunting blades plus fists' Extra Attacks; Auxiliary Cadre. Experimental Modifications improves AP. No enhancement or external support. Trace: 15.33 → 20.44.

The C'tan winner instead uses Farstalkers, Flesh Shaper, Borthrod Gland, and A Trap Well Laid. Its after-resolution designation incorrectly benefits the triggering attack. Removing that premature AP benefit changes 4.78 to 3.45.

## Original diagnostic outputs across profiles

These are uncapped damage, not casualties, corrected rankings, or verified legal optima. CSM fight is invalid throughout. Other rows retain the omissions described above.

| Faction / phase | Guardsmen | Intercessors | Terminators | Questoris Knight | C'tan |
|---|---:|---:|---:|---:|---:|
| CSM shooting | 56.75 | 39.58 | 24.83 | 24.19 | 9.81 |
| CSM fight — invalid | 120.32 | 79.05 | 50.99 | 55.39 | 14.90 |
| AdMech shooting | 66.05 | 37.30 | 27.42 | 29.51 | 7.88 |
| AdMech fight | 62.01 | 40.33 | 30.25 | 35.20 | 11.57 |
| Death Guard shooting | 59.63 | 38.97 | 24.39 | 19.57 | 7.81 |
| Death Guard fight | 61.54 | 34.22 | 25.67 | 26.19 | 7.26 |
| T'au shooting | 170.07 | 109.02 | 70.83 | 62.48 | 26.81 |
| T'au fight | 41.33 | 20.44 | 12.00 | 10.22 | 4.78 |

Target-dependent selections:

- AdMech Breachers remain shooting winners, but leaders, Data-Psalm versus Eradication Cohort, and Capacitor Vanes change.
- Death Guard Defiler main weapons change; Deathshroud give way to a melee Defiler against Knight/C'tan.
- T'au shooting switches from Retaliation/Arro'kon to Kauyon/A Tempting Trap against tougher targets.
- T'au melee switches from Rampagers to the critical-hit/Lethal/Sustained Farstalker combination against C'tan, subject to the timing error above.

C'tan damage reduction and Feel No Pain are applied. Profile saves and invulnerable saves are also present.

## Confirmed damage coverage gaps

### Translation or execution defects

| Mechanic | Gap |
|---|---|
| Damage rerolls | Translation produces `rerolls.damage`, but the expected-value engine does not consume it. Affects Annihilator, Threat-cogitation Targeters, and Sunforge; may produce no unsupported warning. Annihilator also lacks its Monster/Vehicle condition in public DSL. |
| Debt to the Soul Forge | Missing recipient restriction leaks Daemon Vehicle benefits to infantry. |
| Drones | Wrong attack direction and upgrade/unit scope. |
| A Trap Well Laid | After-resolution designation applies to the attack establishing it. |
| Nurgle's Gift | Target Toughness/save changes remain unresolved. |
| Blight Bombardment | Requires faithful Blast/non-Blast branching, including hit-one versus full rerolls. |
| Murderous Imperative | Selected doctrine designation does not resolve to the corresponding reroll. |
| Headlong Destruction | Closest-eligible-target condition is unresolved. |

### Source-confirmed missing or incomplete offensive candidates

This bounded audit is not an exhaustive census of every unported ability.

| Faction | Priority candidates |
|---|---|
| CSM | Desperate Pledge; Let the Galaxy Burn; Prime Test Subject; Talisman of Burning Blood; Profane Zeal; Corrupted Munitions; Ruinous Raid; Black Crusade; Never Outgunned; Mark of Legend; Warmaster's Gift |
| AdMech | Chant of the Remorseless Fist; Mechanical Guidance; Peerless Eradicator; Inloaded Lethality; Lethal Dosage; Binharic Offence; Targeting Override; Auto-Oracular Retrieval; Machine Spirit Resurgent |
| Death Guard | Death's Heads; Tendrilous Emissions; Virulent Blessing; Nurgle's Rot; Arch-Contaminator; Furnace of Plagues; Gnawing Hunger; Sorrowsyphon; Vomitous Salvoes |
| T'au | Co-ordinated Eradication; Weapon Support System; Sunforge's damage-reroll component |

These include direct Attacks/Strength/AP/Damage modifiers, hit/wound rerolls, critical thresholds, weapon abilities, enemy Toughness reduction, and offensive support. Mechanical Guidance, Death's Heads, and Tendrilous Emissions are important hidden support cases.

A no-effect enhancement or Stratagem produces no candidate lever. A no-effect support can fail provider discovery entirely. Enhancement warnings and warnings for unselected support are not fully represented in winner warnings. Therefore absence from the winners does not establish that an item was faithfully evaluated and lost.

### Missing scenario state

- For the Greater Good / Coordinate to Engage: Observer, Guided, Spotted, Markerlight relationships.
- Bonded Heroes: exact source proximity.
- Hunters' Instincts: target starting/half-strength state.
- Patient Hunter: battle round.
- Damaged profiles: attacker remaining wounds.
- Doctrina Imperatives: selected doctrine and activation legality.
- Objective-conditioned bonuses: objective position/control.

Incomplete launch duplicates include the Purge Corps Deltic-9 doctrine, Maggot Lords Nurgle's Gift, and Sudden Dawn FTGG/Drones records. Reconcile them with the primary rules rather than stacking duplicate effects.

### Defender-side gaps

The matrix uses passive defenses from a bare target, not an optimized defensive build.

- Rogal Dorn Ablative Plating: zeroing one allocated attack requires discrete damage and sequencing.
- Take Cover: needs a legal order/provider and defensive selection.
- Smokescreen: requires selection of the actual defensive Stratagem under its constraints; Veiling Smoke provides access rather than the defense itself.

Target attachments, support, enhancements, detachments, and active defensive choices are not searched.

### Encounter effects, not ordinary current-attack buffs

Analytic Reprisals, Litany of the Electromancer, Verse of Vengeance, Malign Sacrifice, Fail-safe Detonator, Unholy Resilience, and Endless Ire involve reactive attacks, mortal events, fight-on-death, explosions, restoration/future attacks, or persistent designation history. They need an event/turn layer, not unconditional addition to current-attack damage.

Movement, setup, OC, generic Leader/Support metadata, attacker-only defenses, and later healing warnings do not necessarily represent missing current-attack damage. All 88 cells are marked incomplete; that does not mean 88 distinct damage defects.

## Optimizer and Salvo integration gaps

1. Exclusive-choice replacement: Dark Pacts provides a concrete missed improvement. The combined Unshackled Wrath option is also missed; the GEQ AdMech probe rises from 66.046 to 68.682 before correcting weapon-use legality.
2. Pistol/non-pistol legality: the infantry Dominus probe sums both illegally. Removing its pistol contribution from the improved probe leaves 65.873; this is not a corrected global winner.
3. Loadout legality: Legionary weapon caps must survive ingestion and validation.
4. Salvo aggregation: source inspection shows visible alternative melee profiles can all be aggregated, whereas the matrix selects one ordinary weapon plus Extra Attacks.
5. UI context: Salvo lacks support-unit selection and complete defender-build/defensive-choice surfaces. Its current controls do not establish the full scenario state listed above.
6. Failure visibility: source-inspected UI catch paths can turn failures into empty results. No displayed buff must not imply no relevant rule exists.
7. Objective semantics: raw throughput is not points efficiency, remaining-wound-capped damage, kill probability, or a legal full-roster optimum. Seekers are available in each independent scenario; overcharge self-damage and future resources are outside the objective.

The UI findings are source-inspected, not browser-verified in this audit. Shared Dataset, translation, defense, loadout, and crunch primitives mean data/engine defects affect both the matrix and Salvo, but the two surfaces also have distinct aggregation and context behavior.

## Proposed acceptance sequence

- [ ] Correct legal builds, recipient restrictions, and timing before reranking.
- [ ] Account for every relevant offensive and defensive ability as applied, rejected with a reason, or explicitly unresolved—even when no lever can be emitted.
- [ ] Complete single-activation calculations: damage rerolls, wound allocation, overkill, one-use defenses, and weapon-use restrictions.
- [ ] Supply explicit scenario state: designations, range/visibility/cover, objectives, round, remaining wounds/models, timing, and resources.
- [ ] Compare hillclimb against exhaustive bounded examples, including exclusive-choice replacement and interacting options.
- [ ] Exercise identical scenarios through Salvo and the shared APIs with matching contribution traces.
- [ ] Keep encounter simulation distinct from ordinary attack resolution.

Source-semantic fixes must follow human-authorized leaf review and deterministic compilation, not handwritten canonical DSL overrides. Consumer changes must preserve four-port conformance.

## Evidence and verification boundaries

The private matrix is `_private/velochy/matrix-all-88.json`; it is not published with this report. The run explored 1,325,955 stacks, performed 831,607 crunch evaluations, and rejected 5,041,120 illegal loadout candidates. These counts demonstrate exercise, not correctness or optimality.

The follow-up audit was read-only: source inspection and bounded API probes, no fixes and no corrected full-matrix rerun. Earlier harness verification passed 354 test files with 5,808 tests passed and one skipped, plus TypeScript checking. Publication verification is reported separately; those prior checks do not replace the pre-push gate.

Primary implementation references: `tools/src/stack-damage/`, `tools/src/data/loadout.ts`, `tools/src/data/lever-providers.ts`, `tools/src/cruncher/engine.ts`, `tools/src/cruncher/from-dsl.ts`, and `examples/salvo/src/lib/`. Ability records are in the four factions' `data/enrichment/*/abilities.json`; CSM construction evidence is in its core composition and wargear-option files.
