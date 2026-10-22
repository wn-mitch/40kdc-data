# MFM wargear — APPLIED

Dump-primary `default_weapon_ids` + wargear-options. BSData retained only for
dump-absent (repo-only) units. Unresolved weapon names are triaged, never guessed.

| Dir | Matched | Options | Defaults Δ | Weapon ids Δ | Weapon names Δ | Weapons + | Wargear + | Synth | Unresolved | Fuzzy | Notes | New-in-dump | Repo-only (fallback) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| adepta-sororitas | 37 | 58 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-astartes | 177 | 210 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 5 | 0 | 0 |
| adeptus-custodes | 39 | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 |
| adeptus-mechanicus | 38 | 38 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| aeldari | 80 | 106 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 0 |
| agents-of-the-imperium | 33 | 55 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 5 | 0 | 0 |
| astra-militarum | 75 | 174 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| chaos-daemons | 53 | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 92 | 0 |
| chaos-knights | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 58 | 99 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 3 | 99 | 0 |
| death-guard | 41 | 43 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| drukhari | 27 | 43 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| emperors-children | 25 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 |
| genestealer-cults | 28 | 19 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| grey-knights | 30 | 44 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| imperial-knights | 23 | 31 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| leagues-of-votann | 26 | 37 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| necrons | 57 | 28 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| orks | 60 | 52 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 |
| tau-empire | 47 | 104 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| thousand-sons | 38 | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tyranids | 57 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| world-eaters | 34 | 45 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **1103** | **1346** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **22** | **22** | **192** | **0** |

## adeptus-astartes

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Bolt Rifles` → `bolt-rifle` (was `bolt-rifles`)
- `Fragstorm Grenade Launchers` → `fragstorm-grenade-launcher` (was `fragstorm-grenade-launchers`)
- `Grapnel Launchers` → `grapnel-launcher` (was `grapnel-launchers`)
- `Ironhail Heavy Stubbers` → `ironhail-heavy-stubber` (was `ironhail-heavy-stubbers`)
- `Krakstorm Grenade Launchers` → `krakstorm-grenade-launcher` (was `krakstorm-grenade-launchers`)
- `Storm Bolters` → `storm-bolter` (was `storm-bolters`)

**Notes (cap approximations / alternates):**
- victrix-honour-guard: Chapter Ancient: no model_count — base_miniature_loadout fallback
- deathwatch-veterans: cross-product loadout set cff46176 factored into 2 independent slot swaps (Watch Sergeant)
- wolf-guard-headtakers: Hunting Wolf: no model_count — base_miniature_loadout fallback
- decimus-kill-team: Deathwatch Veteran with Xenophase Blade and Special-issue Bolt Pistol: no model_count — base_miniature_loadout fallback
- talonstrike-kill-team: cross-product loadout set 6b1bb053 factored into 2 independent slot swaps (Kill Team Sergeant with Jump Pack)

## adeptus-custodes

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Solarite Power Gauntlet` → `solerite-power-gauntlet` (was `solarite-power-gauntlet`)
- `Solarite Power Talon` → `solerite-power-talon` (was `solarite-power-talon`)
- `Tarsus Buckler` → `tarsis-buckler` (was `tarsus-buckler`)

## aeldari

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Fire Axe` → `the-fire-axe` (was `fire-axe`)
- `Kha-vir` → `kha-vir-the-sword-of-sorrows` (was `kha-vir`)

**Notes (cap approximations / alternates):**
- dark-reapers: cross-product loadout set e2b678c5 factored into 1 independent slot swap (Dark Reaper Exarch)

## agents-of-the-imperium

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Agent’s Firearm` → `agent-firearm` (was `agents-firearm`)

**Notes (cap approximations / alternates):**
- voidsmen-at-arms: Voidsman: 2 default loadout groups — base_miniature_loadout fallback
- aquila-kill-team: Deathwatch Veteran with Xenophase Blade and Special-issue Bolt Pistol: no model_count — base_miniature_loadout fallback
- imperial-navy-breachers: Navis Armsman: 3 default loadout groups — base_miniature_loadout fallback
- imperial-navy-breachers: Navis Armsman: default loadout groups split into same-named rows (1 + 1 + 7)
- deathwatch-kill-team: cross-product loadout set 2cfdee74 factored into 2 independent slot swaps (Watch Sergeant)

## astra-militarum

**Notes (cap approximations / alternates):**
- krieg-command-squad: cross-product loadout set ccf4871f factored into 1 independent slot swap (Veteran Guardsman)
- krieg-command-squad: Veteran Guardsman: 0 row(s) for 5 distinct dump loadouts — defaults left as they are

## chaos-space-marines

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Hades battle cannon` → `defiler-cannon` (was `hades-battle-cannon`)
- `Shearing claws` → `defiler-claws` (was `shearing-claws`)

**Notes (cap approximations / alternates):**
- havocs: Havoc: non-uniform default count — base_miniature_loadout fallback
- chaos-terminator-squad: alternate loadout_choice_set bbd655f9 (Chaos Terminator) — review
- chaos-terminator-squad: alternate loadout_choice_set c1fa45a8 (Terminator Champion) — review

## drukhari

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Macro-scalpel` → `maco-scalpel` (was `macro-scalpel`)

## emperors-children

**Notes (cap approximations / alternates):**
- chaos-terminators: alternate loadout_choice_set ce82b2b8 (Chaos Terminator) — review
- chaos-terminators: alternate loadout_choice_set dc056a28 (Terminator Champion) — review
- noise-marines: Noise Marine: non-uniform default count — base_miniature_loadout fallback

## genestealer-cults

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Leader’s bio-weapons` → `leaders-cult-weapons` (was `leaders-bio-weapons`)

## grey-knights

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Omnissian power axe` → `omnissiah-power-axe` (was `omnissian-power-axe`)

**Notes (cap approximations / alternates):**
- paladin-squad: cross-product loadout set f0d60da1 factored into 1 independent slot swap (Paladin)

## imperial-knights

**Notes (cap approximations / alternates):**
- sir-hekhtur: Sir Hekhtur: no model_count — base_miniature_loadout fallback

## leagues-of-votann

**Notes (cap approximations / alternates):**
- brokhyr-iron-master: E-COG: 0 row(s) for 3 distinct dump loadouts — defaults left as they are

## orks

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Choppas` → `choppa` (was `choppas`)
- `Dread Klaws` → `dread-klaw` (was `dread-klaws`)
- `Squig’s Jaws` → `squig-jaws` (was `squigs-jaws`)
- `Twin Killsaws` → `twin-killsaw` (was `twin-killsaws`)

## tyranids

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Screamer-Killer talons` → `scream-killer-talons` (was `screamer-killer-talons`)

