# MFM base sizes — APPLIED

Reconciles `base_size_mm` on units and unit-composition models from the dump's datasheet
baseSize label. A single clean round/oval is authoritative at both levels (a value within
1 mm on the same shape is kept — the GW app rounds oval dimensions). Labelled per-model
strings are mapped onto composition models by name. A bare list attributes nothing, but
authored bases it contradicts are marked draft. Categories and null strings are reported,
never guessed. A parsed dump value carries no `draft` flag.

| Metric | Count |
|---|--:|
| Filled | 28 |
| Corrected | 15 |
| De-drafted | 26 |
| Rounding kept (authored kept) | 5 |
| Confirmed (units) | 889 |
| Confirmed (models) | 1254 |
| Unmatched labels | 14 |
| Conflicting labels | 2 |
| Representative unresolved | 2 |
| Unresolved (list/category/null) | 182 |
| Drafted (contradicts a bare list) | 0 |
| Attributed bare lists (reviewed) | 16 |
| Attributions refused / unused | 0 / 0 |

## Filled (was empty)

- adeptus-astartes/wardens-of-ultramar :: Ancient Gadriel: none → round 40
- adeptus-astartes/wardens-of-ultramar :: Veteran Sergeant Metaurus: none → round 40
- adeptus-astartes/wardens-of-ultramar :: Gaius Silva: none → round 28.5
- adeptus-astartes/wardens-of-ultramar :: Aemelia Minervas: none → round 28.5
- adeptus-astartes/wardens-of-ultramar :: Dainal Komelius: none → round 28.5
- adeptus-astartes/wardens-of-ultramar :: Lucia Vestha: none → round 28.5
- adeptus-astartes/wardens-of-ultramar: none → round 28.5
- adeptus-astartes/vow-sworn-crusader-squad :: Initiate with Heavy Bolt Pistol and Chainsword: none → round 32
- adeptus-astartes/vow-sworn-crusader-squad :: Initiate with Bolt Pistol, Bolt Rifle and Knives and Fists: none → round 32
- adeptus-astartes/vow-sworn-crusader-squad :: Sword Brother: none → round 40
- adeptus-astartes/vow-sworn-crusader-squad :: Initiate with Pyreblaster, Bolt Pistol and Knives and Fists: none → round 32
- adeptus-astartes/vow-sworn-crusader-squad :: Neophyte with Neophyte Firearm and Knives and Fists: none → round 28.5
- adeptus-astartes/vow-sworn-crusader-squad :: Neophyte with Bolt Pistol and Chainsword: none → round 28.5
- adeptus-astartes/vow-sworn-crusader-squad: none → round 32
- genestealer-cults/claw-of-ascension-atalan-jackals: none → oval 60x35.5
- orks/boyz :: Nob: none → round 40
- orks/boyz :: Boy: none → round 32
- orks/ardmob-boyz :: Boss Nob: none → round 40
- orks/ardmob-boyz :: Boyz: none → round 32
- orks/ardmob-boyz: none → round 32
- orks/ardmob-boyz-2 :: Boss Nob: none → round 40
- orks/ardmob-boyz-2 :: Boyz: none → round 32
- orks/ardmob-boyz-2: none → round 32
- world-eaters/frenzied-reavers-jakhals :: Dishonoured: none → round 40
- world-eaters/frenzied-reavers-jakhals :: Jakhal with Autopistol and Chainblade: none → round 28.5
- world-eaters/frenzied-reavers-jakhals :: Jakhal with Autopistol and Mauler Chainblade: none → round 28.5
- world-eaters/frenzied-reavers-jakhals :: Jakhal Pack Leader: none → round 28.5
- world-eaters/frenzied-reavers-jakhals: none → round 28.5

## Corrected (dump authoritative)

- adeptus-astartes/crusader-squad :: Initiate: round 40 → round 32
- adeptus-astartes/crusader-squad :: Neophyte: round 40 → round 28.5
- adeptus-astartes/crusader-squad: round 40 → round 32
- adeptus-astartes/chaplain-grimaldus :: Cenobyte Servitor: round 40 → round 28.5
- adeptus-astartes/chaplain-grimaldus: round 40 → round 28.5
- adeptus-astartes/wolf-guard-headtakers :: Hunting Wolf: round 40 → oval 60x35.5
- adeptus-astartes/decimus-kill-team :: Gravis Veteran: round 32 → round 40
- adeptus-astartes/talonstrike-kill-team :: Kill Team Heavy Intercessor with Jump Pack: round 32 → round 40
- adeptus-astartes/wolf-scouts :: Wolf Scout Pack Leader: oval 60x35.5 → round 32
- adeptus-astartes/wolf-scouts :: Wolf Scout: oval 60x35.5 → round 32
- adeptus-astartes/wolf-scouts: oval 60x35.5 → round 32
- agents-of-the-imperium/aquila-kill-team :: Gravis Veteran: round 32 → round 40
- genestealer-cults/claw-of-ascension-atalan-jackals :: Atalan Wolfquad: oval 60x35.5 → round 60
- orks/breaka-boyz :: Nob: round 32 → round 40
- orks/tankbustas :: Nob: round 32 → round 40

## De-drafted (dump confirmed a provisional value)

- adeptus-astartes/crusader-squad :: Sword Brother: round 40 → round 40
- adeptus-astartes/chaplain-grimaldus :: Chaplain Grimaldus: round 40 → round 40
- adeptus-astartes/wolf-guard-headtakers :: Wolf Guard Headtaker: round 40 → round 40
- adeptus-astartes/wolf-guard-headtakers: round 40 → round 40
- adeptus-astartes/decimus-kill-team :: Kill Team Sergeant: round 32 → round 32
- adeptus-astartes/decimus-kill-team :: Deathwatch Veteran with Heavy Thunder Hammer and Bolt Pistol: round 32 → round 32
- adeptus-astartes/decimus-kill-team :: Deathwatch Veteran with Deathwatch Marksman Bolt Carbine, Special-issue Bolt Pistol and Knives and Fists: round 32 → round 32
- adeptus-astartes/decimus-kill-team :: Deathwatch Veteran with Stalker Bolt Rifle, Bolt Pistol and Knives and Fists: round 32 → round 32
- adeptus-astartes/decimus-kill-team :: Deathwatch Veteran with Xenophase Blade and Special-issue Bolt Pistol: round 32 → round 32
- adeptus-astartes/decimus-kill-team: round 32 → round 32
- adeptus-astartes/talonstrike-kill-team :: Kill Team Sergeant with Jump Pack: round 32 → round 32
- adeptus-astartes/talonstrike-kill-team :: Kill Team Intercessor with Jump Pack: round 32 → round 32
- adeptus-astartes/talonstrike-kill-team: round 32 → round 32
- adeptus-astartes/wolf-scouts :: Hunting Wolf: oval 60x35.5 → oval 60x35.5
- agents-of-the-imperium/aquila-kill-team :: Kill Team Sergeant: round 32 → round 32
- agents-of-the-imperium/aquila-kill-team :: Deathwatch Veteran with Heavy Thunder Hammer and Bolt Pistol: round 32 → round 32
- agents-of-the-imperium/aquila-kill-team :: Deathwatch Veteran with Deathwatch Marksman Bolt Carbine, Special-issue Bolt Pistol and Knives and Fists: round 32 → round 32
- agents-of-the-imperium/aquila-kill-team :: Deathwatch Veteran with Stalker Bolt Rifle, Bolt Pistol and Knives and Fists: round 32 → round 32
- agents-of-the-imperium/aquila-kill-team :: Deathwatch Veteran with Xenophase Blade and Special-issue Bolt Pistol: round 32 → round 32
- agents-of-the-imperium/aquila-kill-team: round 32 → round 32
- genestealer-cults/claw-of-ascension-atalan-jackals :: Atalan Jackal with Power Weapon: oval 60x35.5 → oval 60x35.5
- genestealer-cults/claw-of-ascension-atalan-jackals :: Atalan Jackal: oval 60x35.5 → oval 60x35.5
- orks/breaka-boyz :: Breaka Boy: round 32 → round 32
- orks/breaka-boyz: round 32 → round 32
- orks/tankbustas :: Tankbusta: round 32 → round 32
- orks/tankbustas: round 32 → round 32

## Rounding kept (authored value kept — within 1 mm of the dump)

- aeldari/yvraine: authored oval 75x42 vs dump oval 74x42
- aeldari/yvraine :: Yvraine: authored oval 75x42 vs dump oval 74x42
- astra-militarum/attilan-rough-riders: authored oval 60x35.5 vs dump oval 60x35
- astra-militarum/attilan-rough-riders :: Rough Rider Sergeant: authored oval 60x35.5 vs dump oval 60x35
- astra-militarum/attilan-rough-riders :: Rough Rider: authored oval 60x35.5 vs dump oval 60x35

## Unmatched labels (not attributed)

- adeptus-mechanicus/skitarii-vanguard: "Transuranic Arquebus" (oval 60x35.5)
- adeptus-mechanicus/skitarii-rangers: "Transuranic Arquebus" (oval 60x35.5)
- agents-of-the-imperium/imperial-navy-breachers: "Imperial Navy Breachers" (round 25)
- agents-of-the-imperium/imperial-navy-breachers: "Navis las-volley" (round 28.5)
- agents-of-the-imperium/imperial-navy-breachers: "endurant shield" (round 28.5)
- astra-militarum/ratlings: "Tankstopper Rifle" (round 28.5)
- astra-militarum/krieg-heavy-weapons-squad: "Heavy Weapons Squad" (round 50)
- chaos-space-marines/dark-commune: "Mindwhich" (round 32)
- genestealer-cults/neophyte-hybrids: "Heavy Stubber" (round 32)
- genestealer-cults/neophyte-hybrids: "Mining Laser" (round 32)
- genestealer-cults/neophyte-hybrids: "Seismic Cannon" (round 32)
- leagues-of-votann/cthonian-beserks: "Mole grenade launcher" (round 50)
- necrons/the-silent-king: "The Silent King" (round 100)
- tau-empire/the-twin-lance: "MV15 gun drone" (round 32)

## Conflicting labels (two labels disagree on one model — not changed)

- astra-militarum/ratlings :: Ratling Sniper: round 25 vs round 28.5
- tyranids/neurogaunts :: Neurogaunt Nodebeast: round 25 vs round 28.5

## Representative unresolved (labelled datasheet — unit base not derived)

- agents-of-the-imperium/imperial-navy-breachers: authored round 25, labelled none
- astra-militarum/krieg-heavy-weapons-squad: authored round 50, labelled round 25

## Unresolved datasheets (not attributed)

- adepta-sororitas/immolator [category]: "Hull"
- adepta-sororitas/exorcist [category]: "Hull"
- adepta-sororitas/castigator [category]: "Hull"
- adepta-sororitas/sororitas-rhino [category]: "Hull"
- adeptus-astartes/thunderhawk-gunship [category]: "Unique"
- adeptus-astartes/astraeus [category]: "Hull"
- adeptus-astartes/land-raider [category]: "None"
- adeptus-astartes/land-raider-crusader [category]: "None"
- adeptus-astartes/rhino [category]: "None"
- adeptus-astartes/land-raider-redeemer [category]: "None"
- adeptus-astartes/drop-pod [category]: "Custom"
- adeptus-astartes/invader-atvs [category]: "None"
- adeptus-astartes/sammael [category]: "Large Flying Base"
- adeptus-astartes/ravenwing-darkshroud [category]: "Large Flying Base"
- adeptus-astartes/baal-predator [category]: "Hull"
- adeptus-astartes/land-speeder-vengeance [category]: "Large Flying Base"
- adeptus-custodes/anathema-psykana-rhino [null]: null
- adeptus-mechanicus/skorpius-disintegrator [category]: "Hull"
- adeptus-mechanicus/skorpius-dunerider [category]: "Hull"
- adeptus-titanicus/warhound-titan [category]: "Hull"
- adeptus-titanicus/warlord-titan [category]: "Hull"
- adeptus-titanicus/reaver-titan [category]: "Hull"
- adeptus-titanicus/warbringer-nemesis-titan [category]: "Hull"
- aeldari/warlock-skyrunners [category]: "Small Flying Base"
- aeldari/ynnari-venom [category]: "Large Flying Base"
- aeldari/skyweavers [category]: "Large Flying Base"
- aeldari/ynnari-reavers [category]: "Small Flying Base"
- aeldari/farseer-skyrunner [category]: "Small Flying Base"
- aeldari/wave-serpent [category]: "Large Flying Base"
- aeldari/windriders [category]: "Small Flying Base"
- aeldari/dragon-knights [null]: null
- aeldari/leystalker [null]: null
- aeldari/starweaver [category]: "Large Flying Base"
- aeldari/falcon [category]: "Large Flying Base"
- aeldari/shroud-runners [category]: "Large Flying Base"
- aeldari/voidweaver [category]: "Large Flying Base"
- aeldari/night-spinner [category]: "Large Flying Base"
- aeldari/stonesinger [null]: null
- aeldari/clanblade [null]: null
- aeldari/ynnari-raider [category]: "Large Flying Base"
- aeldari/phantom-titan [category]: "Hull"
- aeldari/fire-prism [category]: "Large Flying Base"
- aeldari/shining-spears [category]: "Large Flying Base"
- aeldari/revenant-titan [category]: "Hull"
- agents-of-the-imperium/sisters-of-battle-immolator [category]: "Hull"
- agents-of-the-imperium/imperial-rhino [category]: "Hull"
- agents-of-the-imperium/inquisitorial-chimera [category]: "Hull"
- agents-of-the-imperium/inquisitors-hand-vigilant-squad [list]: "25mm, 28.5mm"
- agents-of-the-imperium/inquisitors-hand-inquisitorial-agents [list]: "25mm, 32mm"
- astra-militarum/leman-russ-battle-tank [category]: "Hull"
- astra-militarum/hydra [category]: "Hull"
- astra-militarum/stormlord [category]: "Hull"
- astra-militarum/hippogriff-afv [category]: "Hull"
- astra-militarum/leman-russ-eradicator [category]: "Hull"
- astra-militarum/leman-russ-executioner [category]: "Hull"
- astra-militarum/basilisk [category]: "Hull"
- astra-militarum/deathstrike [category]: "Hull"
- astra-militarum/rogal-dorn-battle-tank [category]: "Hull"
- astra-militarum/hellhammer [category]: "Hull"
- astra-militarum/baneblade [category]: "Hull"
- astra-militarum/shadowsword [category]: "Hull"
- astra-militarum/banesword [category]: "Hull"
- astra-militarum/taurox [category]: "Hull"
- astra-militarum/wyvern [category]: "Hull"
- astra-militarum/taurox-prime [category]: "Hull"
- astra-militarum/leman-russ-demolisher [category]: "Hull"
- astra-militarum/banehammer [category]: "Hull"
- astra-militarum/doomhammer [category]: "Hull"
- astra-militarum/stormsword [category]: "Hull"
- astra-militarum/centaur-rsv [null]: null
- astra-militarum/leman-russ-exterminator [category]: "Hull"
- astra-militarum/manticore [category]: "Hull"
- astra-militarum/chimera [category]: "Hull"
- astra-militarum/leman-russ-vanquisher [category]: "Hull"
- astra-militarum/hellhound [category]: "Hull"
- astra-militarum/leman-russ-commander [category]: "Hull"
- astra-militarum/aegis-defence-line [category]: "Hull"
- astra-militarum/commissar-graves [category]: "Hull"
- astra-militarum/leman-russ-punisher [category]: "Hull"
- astra-militarum/rogal-dorn-commander [category]: "Hull"
- astra-militarum/cyclops-demolition-vehicle [category]: "Hull"
- chaos-daemons/feculent-gnarlmaw [category]: "Hull"
- chaos-daemons/screamers [category]: "Small Flying Base"
- chaos-daemons/fluxmaster [category]: "Large Flying Base"
- chaos-daemons/the-blue-scribes [category]: "Large Flying Base"
- chaos-daemons/plague-drones [category]: "Large Flying Base"
- chaos-daemons/skull-altar [category]: "Hull"
- chaos-knights/chaos-acastus-knight-porphyrion [category]: "Hull"
- chaos-knights/chaos-acastus-knight-asterius [category]: "Hull"
- chaos-space-marines/chaos-vindicator [category]: "Hull"
- chaos-space-marines/chaos-predator-destructor [category]: "Hull"
- chaos-space-marines/noctilith-crown [category]: "Hull"
- chaos-space-marines/khorne-lord-of-skulls [category]: "Hull"
- chaos-space-marines/chaos-land-raider [category]: "Hull"
- chaos-space-marines/chaos-rhino [category]: "Hull"
- chaos-space-marines/chaos-predator-annihilator [category]: "Hull"
- death-guard/maggot-lords-chaos-rhino [category]: "None"
- death-guard/plague-drones [category]: "Large Flying Base"
- death-guard/chaos-land-raider [category]: "Hull"
- death-guard/miasmic-malignifier [category]: "Hull"
- death-guard/chaos-predator-annihilator [category]: "Hull"
- death-guard/chaos-predator-destructor [category]: "Hull"
- death-guard/plagueburst-crawler [category]: "Hull"
- death-guard/chaos-rhino [category]: "Hull"
- drukhari/ravager [category]: "Large Flying Base"
- drukhari/hellions [category]: "Small Flying Base"
- drukhari/cronos [category]: "Large Flying Base"
- drukhari/coven-of-agonies-talos [category]: "Large Flying Base"
- drukhari/talos [category]: "Large Flying Base"
- drukhari/raider [category]: "Large Flying Base"
- drukhari/coven-of-agonies-cronos [category]: "Large Flying Base"
- drukhari/venom [category]: "Large Flying Base"
- drukhari/reavers [category]: "Small Flying Base"
- emperors-children/chaos-rhino [category]: "Hull"
- emperors-children/chaos-land-raider [category]: "Hull"
- genestealer-cults/goliath-rockgrinder [category]: "Hull"
- genestealer-cults/goliath-truck [category]: "Hull"
- grey-knights/land-raider [category]: "Hull"
- grey-knights/grey-knights-thunderhawk-gunship [category]: "Unique"
- grey-knights/land-raider-redeemer [category]: "Hull"
- grey-knights/rhino [category]: "Hull"
- grey-knights/razorback [category]: "Hull"
- grey-knights/land-raider-crusader [category]: "Hull"
- imperial-knights/acastus-knight-porphyrion [category]: "Hull"
- imperial-knights/acastus-knight-asterius [category]: "Hull"
- leagues-of-votann/sagitaur [category]: "Hull"
- leagues-of-votann/hekaton-land-fortress [category]: "Hull"
- necrons/tomb-blades [category]: "Small Flying Base"
- necrons/seraptek-heavy-construct [category]: "Hull"
- necrons/overlord-amonhotekh [null]: null
- necrons/lokhust-destroyers [category]: "Large Flying Base"
- necrons/ghost-ark [category]: "Large Flying Base"
- necrons/annihilation-barge [category]: "Large Flying Base"
- necrons/doomsday-ark [category]: "Large Flying Base"
- necrons/lokhust-lord [category]: "Large Flying Base"
- necrons/convergence-of-dominion [category]: "Hull"
- necrons/catacomb-command-barge [category]: "Large Flying Base"
- necrons/triarch-stalker [category]: "Hull"
- orks/wazdakka-gutsmek [null]: null
- orks/big-mek-dakkarig [null]: null
- orks/battlewagon [null]: null
- orks/squighog-boyz [list]: "75mm, 90x52.5mm Oval Base"
- orks/deffkilla-wartrike [null]: null
- orks/biged-bossbunka [null]: null
- orks/mek-gunz [category]: "None"
- orks/gargantuan-squiggoth [category]: "Hull"
- orks/warbikers [null]: null
- orks/wartrakks [null]: null
- orks/bigboss [null]: null
- orks/morkanaut [null]: null
- orks/trukk [null]: null
- orks/gunwagon [category]: "None"
- orks/gorkanaut [null]: null
- orks/stompa [category]: "None"
- tau-empire/tidewall-shieldline [category]: "Hull"
- tau-empire/manta [category]: "Unique"
- tau-empire/sudden-dawn-cadre-devilfish [category]: "Large Flying Base"
- tau-empire/tidewall-droneport [category]: "Hull"
- tau-empire/hammerhead-gunship [category]: "Large Flying Base"
- tau-empire/devilfish [category]: "Large Flying Base"
- tau-empire/piranhas [category]: "Large Flying Base"
- tau-empire/sky-ray-gunship [category]: "Large Flying Base"
- tau-empire/tidewall-gunrig [category]: "Hull"
- thousand-sons/chaos-predator-annihilator [category]: "Hull"
- thousand-sons/screamers [category]: "Small Flying Base"
- thousand-sons/chaos-vindicator [category]: "Hull"
- thousand-sons/chaos-rhino [category]: "Hull"
- thousand-sons/chaos-land-raider [category]: "Hull"
- thousand-sons/chaos-predator-destructor [category]: "Hull"
- titanicus-traitoris/chaos-warbringer-nemesis-titan [category]: "Hull"
- titanicus-traitoris/chaos-warhound-titan [category]: "Hull"
- titanicus-traitoris/chaos-reaver-titan [category]: "Hull"
- titanicus-traitoris/chaos-warlord-titan [category]: "Hull"
- tyranids/sporocyst [category]: "Hull"
- tyranids/gargoyles [category]: "Small Flying Base"
- tyranids/harridan [category]: "Unique"
- tyranids/hierophant [category]: "Hull"
- world-eaters/chaos-predator-annihilator [category]: "Hull"
- world-eaters/chaos-rhino [category]: "Hull"
- world-eaters/chaos-predator-destructor [category]: "Hull"
- world-eaters/khorne-lord-of-skulls [category]: "Hull"
- world-eaters/chaos-land-raider [category]: "Hull"

