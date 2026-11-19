# MFM base sizes — APPLIED

Reconciles `base_size_mm` on units and unit-composition models from the dump's datasheet
baseSize label. A single clean round/oval is authoritative at both levels (a value within
1 mm on the same shape is kept — the GW app rounds oval dimensions). Labelled per-model
strings are mapped onto composition models by name; bare lists, categories, and null
strings are reported, never guessed. A parsed dump value carries no `draft` flag.

| Metric | Count |
|---|--:|
| Filled | 0 |
| Corrected | 0 |
| De-drafted | 0 |
| Rounding kept (authored kept) | 5 |
| Confirmed (units) | 888 |
| Confirmed (models) | 1254 |
| Unmatched labels | 14 |
| Conflicting labels | 2 |
| Representative unresolved | 2 |
| Unresolved (list/category/null) | 198 |

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
- adeptus-astartes/wardens-of-ultramar [list]: "28.5mm, 40mm"
- adeptus-astartes/land-raider [category]: "None"
- adeptus-astartes/land-raider-crusader [category]: "None"
- adeptus-astartes/rhino [category]: "None"
- adeptus-astartes/land-raider-redeemer [category]: "None"
- adeptus-astartes/drop-pod [category]: "Custom"
- adeptus-astartes/invader-atvs [category]: "None"
- adeptus-astartes/sammael [category]: "Large Flying Base"
- adeptus-astartes/crusader-squad [list]: "28.5mm, 32mm, 40mm"
- adeptus-astartes/vow-sworn-crusader-squad [list]: "28.5mm, 32mm, 40mm"
- adeptus-astartes/ravenwing-darkshroud [category]: "Large Flying Base"
- adeptus-astartes/chaplain-grimaldus [list]: "28.5mm, 40mm"
- adeptus-astartes/wolf-guard-headtakers [list]: "40mm, 60x35.5mm Oval Base"
- adeptus-astartes/baal-predator [category]: "Hull"
- adeptus-astartes/decimus-kill-team [list]: "32mm, 40mm"
- adeptus-astartes/talonstrike-kill-team [list]: "32mm, 40mm"
- adeptus-astartes/land-speeder-vengeance [category]: "Large Flying Base"
- adeptus-astartes/wolf-scouts [list]: "32mm, 60x35.5mm Oval Base"
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
- agents-of-the-imperium/aquila-kill-team [list]: "32mm, 40mm"
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
- genestealer-cults/claw-of-ascension-atalan-jackals [list]: "60mm, 60x35.5mm Oval Base"
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
- orks/boyz [list]: "32mm, 40mm"
- orks/wazdakka-gutsmek [null]: null
- orks/big-mek-dakkarig [null]: null
- orks/battlewagon [null]: null
- orks/squighog-boyz [list]: "75mm, 90x52.5mm Oval Base"
- orks/deffkilla-wartrike [null]: null
- orks/ardmob-boyz [list]: "32mm, 40mm"
- orks/biged-bossbunka [null]: null
- orks/mek-gunz [category]: "None"
- orks/gargantuan-squiggoth [category]: "Hull"
- orks/warbikers [null]: null
- orks/wartrakks [null]: null
- orks/breaka-boyz [list]: "32mm, 40mm"
- orks/bigboss [null]: null
- orks/morkanaut [null]: null
- orks/trukk [null]: null
- orks/tankbustas [list]: "32mm, 40mm"
- orks/gunwagon [category]: "None"
- orks/ardmob-boyz-2 [list]: "32mm, 40mm"
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
- world-eaters/frenzied-reavers-jakhals [list]: "28.5mm, 40mm"
- world-eaters/chaos-predator-annihilator [category]: "Hull"
- world-eaters/chaos-rhino [category]: "Hull"
- world-eaters/chaos-predator-destructor [category]: "Hull"
- world-eaters/khorne-lord-of-skulls [category]: "Hull"
- world-eaters/chaos-land-raider [category]: "Hull"

