# MFM wargear — DRY RUN

Dump-primary `default_weapon_ids` + wargear-options. BSData retained only for
dump-absent (repo-only) units. Unresolved weapon names are triaged, never guessed.

| Dir | Matched | Options | Defaults Δ | Weapon ids Δ | Weapon names Δ | Weapons + | Wargear + | Synth | Unresolved | Fuzzy | Notes | New-in-dump | Repo-only (fallback) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| adepta-sororitas | 37 | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 |
| adeptus-astartes | 177 | 184 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 16 | 0 | 0 |
| adeptus-custodes | 39 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 0 |
| adeptus-mechanicus | 38 | 37 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 |
| aeldari | 80 | 97 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 5 | 0 | 0 |
| agents-of-the-imperium | 33 | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 10 | 0 | 0 |
| astra-militarum | 75 | 155 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 25 | 0 | 0 |
| chaos-daemons | 53 | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 92 | 0 |
| chaos-knights | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 58 | 80 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 11 | 99 | 0 |
| death-guard | 41 | 37 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 |
| drukhari | 27 | 41 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 2 | 0 | 0 |
| emperors-children | 25 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 1 | 0 |
| genestealer-cults | 28 | 19 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| grey-knights | 30 | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 3 | 0 | 0 |
| imperial-knights | 23 | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| leagues-of-votann | 26 | 36 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| necrons | 57 | 28 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| orks | 60 | 52 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 |
| tau-empire | 47 | 103 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| thousand-sons | 38 | 43 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 |
| tyranids | 57 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| world-eaters | 34 | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| **TOTAL** | **1103** | **1234** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **22** | **100** | **192** | **0** |

## adepta-sororitas

**Notes (cap approximations / alternates):**
- celestian-insidiants: loadout set 0519b3b3 kept as one menu: its swaps do not stack freely (Celestian Insidiant)
- battle-sisters-squad: loadout set 6817334f kept as one menu: its swaps do not stack freely (Battle Sister)
- dominion-squad: loadout set 8dce5b73 kept as one menu: its swaps do not stack freely (Dominion)
- canoness: loadout set 0afca918 kept as one menu: its swaps do not stack freely (Canoness)

## adeptus-astartes

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Bolt Rifles` → `bolt-rifle` (was `bolt-rifles`)
- `Fragstorm Grenade Launchers` → `fragstorm-grenade-launcher` (was `fragstorm-grenade-launchers`)
- `Grapnel Launchers` → `grapnel-launcher` (was `grapnel-launchers`)
- `Ironhail Heavy Stubbers` → `ironhail-heavy-stubber` (was `ironhail-heavy-stubbers`)
- `Krakstorm Grenade Launchers` → `krakstorm-grenade-launcher` (was `krakstorm-grenade-launchers`)
- `Storm Bolters` → `storm-bolter` (was `storm-bolters`)

**Notes (cap approximations / alternates):**
- terminator-squad: loadout set 794a502a kept as one menu: its swaps do not stack freely (Terminator)
- captain: loadout set cac324b5 kept as one menu: its swaps do not stack freely (Captain)
- victrix-honour-guard: Chapter Ancient: no model_count — base_miniature_loadout fallback
- lieutenant: loadout set 6a05d1c5 kept as one menu: its swaps do not stack freely (Lieutenant)
- captain-with-jump-pack: loadout set 7ec2cfcc kept as one menu: its swaps do not stack freely (Captain with Jump Pack)
- fortis-kill-team: loadout set e3561615 kept as one menu: its swaps do not stack freely (Kill Team Sergeant)
- execrator: loadout set aa453e36 kept as one menu: its swaps do not stack freely (Execrator)
- deathwatch-veterans: loadout set 6361c024 kept as one menu: its swaps do not stack freely (Deathwatch Veteran)
- deathwatch-veterans: cross-product loadout set cff46176 factored into 2 independent slot swaps (Watch Sergeant)
- deathwatch-terminator-squad: loadout set ad6762a5 kept as one menu: its swaps do not stack freely (Deathwatch Terminator)
- deathwing-terminator-squad: loadout set 0365acf2 kept as one menu: its swaps do not stack freely (Deathwing Terminators)
- wolf-guard-headtakers: Hunting Wolf: no model_count — base_miniature_loadout fallback
- decimus-kill-team: Deathwatch Veteran with Xenophase Blade and Special-issue Bolt Pistol: no model_count — base_miniature_loadout fallback
- death-company-captain-with-jump-pack: loadout set b2bb8581 kept as one menu: its swaps do not stack freely (Death Company Captain with Jump Pack)
- talonstrike-kill-team: cross-product loadout set 6b1bb053 factored into 2 independent slot swaps (Kill Team Sergeant with Jump Pack)
- wolf-scouts: loadout set 4091cfd3 kept as one menu: its swaps do not stack freely (Wolf Scout)

## adeptus-custodes

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Solarite Power Gauntlet` → `solerite-power-gauntlet` (was `solarite-power-gauntlet`)
- `Solarite Power Talon` → `solerite-power-talon` (was `solarite-power-talon`)
- `Tarsus Buckler` → `tarsis-buckler` (was `tarsus-buckler`)

**Notes (cap approximations / alternates):**
- allarus-custodians: loadout set 59b68be9 kept as one menu: its swaps do not stack freely (Allarus Custodians)

## adeptus-mechanicus

**Notes (cap approximations / alternates):**
- skitarii-vanguard: loadout set b2098259 kept as one menu: its swaps do not stack freely (Skitarii Vanguard)
- onager-dunecrawler: loadout set fb58a367 kept as one menu: its swaps do not stack freely (Onager Dunecrawler)
- skitarii-rangers: loadout set f18df1b1 kept as one menu: its swaps do not stack freely (Skitarii Ranger)

## aeldari

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Fire Axe` → `the-fire-axe` (was `fire-axe`)
- `Kha-vir` → `kha-vir-the-sword-of-sorrows` (was `kha-vir`)

**Notes (cap approximations / alternates):**
- dire-avengers: loadout set 64889a5e kept as one menu: its swaps do not stack freely (Dire Avenger Exarch)
- storm-guardians: loadout set a86ec8a6 kept as one menu: its swaps do not stack freely (Storm Guardian)
- phantom-titan: loadout set 46c113db kept as one menu: its swaps do not stack freely (Phantom Titan)
- dark-reapers: cross-product loadout set e2b678c5 factored into 1 independent slot swap (Dark Reaper Exarch)
- corsair-voidscarred: loadout set daf6e125 kept as one menu: its swaps do not stack freely (Corsair Voidscarred)

## agents-of-the-imperium

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Agent’s Firearm` → `agent-firearm` (was `agents-firearm`)

**Notes (cap approximations / alternates):**
- voidsmen-at-arms: Voidsman: 2 default loadout groups — base_miniature_loadout fallback
- inquisitorial-chimera: loadout set d41ed6e5 kept as one menu: its swaps do not stack freely (Inquisitorial Chimera)
- grey-knights-terminator-squad: loadout set 273b04c3 kept as one menu: its swaps do not stack freely (Grey Knights Terminators)
- sisters-of-battle-squad: loadout set 3e6dc1a0 kept as one menu: its swaps do not stack freely (Battle Sister)
- aquila-kill-team: Deathwatch Veteran with Xenophase Blade and Special-issue Bolt Pistol: no model_count — base_miniature_loadout fallback
- imperial-navy-breachers: Navis Armsman: 3 default loadout groups — base_miniature_loadout fallback
- imperial-navy-breachers: Navis Armsman: default loadout groups split into same-named rows (1 + 1 + 7)
- exaction-squad: loadout set cbfe93c3 kept as one menu: its swaps do not stack freely (Exaction Vigilant)
- deathwatch-kill-team: cross-product loadout set 2cfdee74 factored into 2 independent slot swaps (Watch Sergeant)
- deathwatch-kill-team: loadout set 9db8f013 kept as one menu: its swaps do not stack freely (Deathwatch Veteran)

## astra-militarum

**Notes (cap approximations / alternates):**
- leman-russ-battle-tank: loadout set 79f62651 kept as one menu: its swaps do not stack freely (Leman Russ Battle Tank)
- stormlord: loadout set b56e4b17 kept as one menu: its swaps do not stack freely (Stormlord)
- leman-russ-eradicator: loadout set bfa80abe kept as one menu: its swaps do not stack freely (Leman Russ Eradicator)
- kasrkin: loadout set 16d0172d kept as one menu: its swaps do not stack freely (Kasrkin)
- leman-russ-executioner: loadout set 0bd7e60d kept as one menu: its swaps do not stack freely (Leman Russ Executioner)
- tempestus-aquilons: loadout set 8f3a1f35 kept as one menu: its swaps do not stack freely (Tempestor Aquilon)
- hellhammer: loadout set 2fb86fd8 kept as one menu: its swaps do not stack freely (Hellhammer)
- baneblade: loadout set b7a6102a kept as one menu: its swaps do not stack freely (Baneblade)
- shadowsword: loadout set aa2a349d kept as one menu: its swaps do not stack freely (Shadowsword)
- banesword: loadout set e56f9149 kept as one menu: its swaps do not stack freely (Banesword)
- catachan-jungle-fighters: loadout set 227a05c0 kept as one menu: its swaps do not stack freely (Jungle Fighter)
- leman-russ-demolisher: loadout set ffd3deb3 kept as one menu: its swaps do not stack freely (Leman Russ Demolisher)
- banehammer: loadout set 1de9fc6e kept as one menu: its swaps do not stack freely (Banehammer)
- doomhammer: loadout set 83ca6e75 kept as one menu: its swaps do not stack freely (Doomhammer)
- stormsword: loadout set 7e211a22 kept as one menu: its swaps do not stack freely (Stormsword)
- catachan-command-squad: loadout set f2080234 kept as one menu: its swaps do not stack freely (Veteran Guardsman)
- leman-russ-exterminator: loadout set 00568573 kept as one menu: its swaps do not stack freely (Leman Russ Exterminator)
- cadian-shock-troops: loadout set 50e6f5b9 kept as one menu: its swaps do not stack freely (Shock Trooper)
- leman-russ-vanquisher: loadout set 112f0f3a kept as one menu: its swaps do not stack freely (Leman Russ Vanquisher)
- leman-russ-commander: loadout set f8fefcc4 kept as one menu: its swaps do not stack freely (Leman Russ Commander)
- militarum-tempestus-command-squad: loadout set 52beeda8 kept as one menu: its swaps do not stack freely (Tempestus Scion)
- krieg-command-squad: cross-product loadout set ccf4871f factored into 1 independent slot swap (Veteran Guardsman)
- krieg-command-squad: Veteran Guardsman: 0 row(s) for 5 distinct dump loadouts — defaults left as they are
- leman-russ-punisher: loadout set 1af6fd23 kept as one menu: its swaps do not stack freely (Leman Russ Punisher)
- cadian-recon-squad: loadout set cbb8601f kept as one menu: its swaps do not stack freely (Recon Trooper)

## chaos-space-marines

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Hades battle cannon` → `defiler-cannon` (was `hades-battle-cannon`)
- `Shearing claws` → `defiler-claws` (was `shearing-claws`)

**Notes (cap approximations / alternates):**
- legionaries: loadout set 7f7654a4 kept as one menu: its swaps do not stack freely (Aspiring Champion)
- raptors: loadout set 465bd8dd kept as one menu: its swaps do not stack freely (Raptor)
- red-corsairs-raiders: loadout set 259c2cfe kept as one menu: its swaps do not stack freely (Red Corsairs Raider)
- chaos-bikers: loadout set 133f5e2f kept as one menu: its swaps do not stack freely (Chaos Biker)
- chosen: loadout set 3af583a6 kept as one menu: its swaps do not stack freely (Chosen)
- chosen: loadout set d51554a5 kept as one menu: its swaps do not stack freely (Chosen Champion)
- chaos-rhino: loadout set fc3e3b26 kept as one menu: its swaps do not stack freely (Chaos Rhino)
- havocs: Havoc: non-uniform default count — base_miniature_loadout fallback
- chaos-terminator-squad: alternate loadout_choice_set bbd655f9 (Chaos Terminator) — review
- chaos-terminator-squad: alternate loadout_choice_set c1fa45a8 (Terminator Champion) — review
- defiler: loadout set 910c8528 kept as one menu: its swaps do not stack freely (Defiler)

## death-guard

**Notes (cap approximations / alternates):**
- defiler: loadout set fd858abc kept as one menu: its swaps do not stack freely (Defiler)
- helbrute: loadout set 481305c5 kept as one menu: its swaps do not stack freely (Death Guard Helbrute)
- plague-marines: loadout set f6a08278 kept as one menu: its swaps do not stack freely (Plague Marine)
- chaos-rhino: loadout set ddbc141c kept as one menu: its swaps do not stack freely (Chaos Rhino)

## drukhari

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Macro-scalpel` → `maco-scalpel` (was `macro-scalpel`)

**Notes (cap approximations / alternates):**
- hellions: loadout set 2848f088 kept as one menu: its swaps do not stack freely (Helliarch)
- hand-of-the-archon: loadout set 1fe7e2d2 kept as one menu: its swaps do not stack freely (Kabalite Agents)

## emperors-children

**Notes (cap approximations / alternates):**
- chaos-terminators: alternate loadout_choice_set ce82b2b8 (Chaos Terminator) — review
- chaos-terminators: alternate loadout_choice_set dc056a28 (Terminator Champion) — review
- noise-marines: Noise Marine: non-uniform default count — base_miniature_loadout fallback
- chaos-rhino: loadout set 91b72180 kept as one menu: its swaps do not stack freely (Chaos Rhino)

## genestealer-cults

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Leader’s bio-weapons` → `leaders-cult-weapons` (was `leaders-bio-weapons`)

**Notes (cap approximations / alternates):**
- neophyte-hybrids: loadout set 0ce349f3 kept as one menu: its swaps do not stack freely (Neophyte Hybrid)

## grey-knights

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Omnissian power axe` → `omnissiah-power-axe` (was `omnissian-power-axe`)

**Notes (cap approximations / alternates):**
- paladin-squad: loadout set 0bfe783f kept as one menu: its swaps do not stack freely (Paladin Ancient)
- paladin-squad: cross-product loadout set f0d60da1 factored into 1 independent slot swap (Paladin)
- brotherhood-terminator-squad: loadout set 90b244e9 kept as one menu: its swaps do not stack freely (Ancient)

## imperial-knights

**Notes (cap approximations / alternates):**
- knight-destrier: loadout set 94fd693e kept as one menu: its swaps do not stack freely (Knight Destrier)
- sir-hekhtur: Sir Hekhtur: no model_count — base_miniature_loadout fallback

## leagues-of-votann

**Notes (cap approximations / alternates):**
- brokhyr-iron-master: E-COG: 0 row(s) for 3 distinct dump loadouts — defaults left as they are
- cthonian-beserks: loadout set 53d14351 kept as one menu: its swaps do not stack freely (Cthonian Beserk)

## orks

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Choppas` → `choppa` (was `choppas`)
- `Dread Klaws` → `dread-klaw` (was `dread-klaws`)
- `Squig’s Jaws` → `squig-jaws` (was `squigs-jaws`)
- `Twin Killsaws` → `twin-killsaw` (was `twin-killsaws`)

## tau-empire

**Notes (cap approximations / alternates):**
- kroot-farstalkers: loadout set 771149ec kept as one menu: its swaps do not stack freely (Kroot Farstalker)
- pathfinder-team: loadout set 6ba0c015 kept as one menu: its swaps do not stack freely (Pathfinder)

## thousand-sons

**Notes (cap approximations / alternates):**
- defiler: loadout set fced7f2a kept as one menu: its swaps do not stack freely (Defiler)
- chaos-rhino: loadout set 68144a14 kept as one menu: its swaps do not stack freely (Chaos Rhino)
- tzaangors: loadout set cf71195b kept as one menu: its swaps do not stack freely (Tzaangor)

## tyranids

**Fuzzy-resolved spelling drift (GW name → repo id, edit-distance ≤1):**
- `Screamer-Killer talons` → `scream-killer-talons` (was `screamer-killer-talons`)

## world-eaters

**Notes (cap approximations / alternates):**
- chaos-rhino: loadout set d572f2a3 kept as one menu: its swaps do not stack freely (World Eaters Rhino)
- defiler: loadout set d8ce1159 kept as one menu: its swaps do not stack freely (Defiler)

