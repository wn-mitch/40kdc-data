# MFM enhancement reconcile — APPLIED

Reconciles source-owned fields and seeds source-complete matched-play
enhancements whose detachment already exists. `keyword_restriction_groups`
preserves exact OR-of-AND eligibility. Eligibility and exclusions are
authoritative when all source keywords resolve: they replace stale core
values and absent source relations clear them. Prose is never read or written.

| Dir | Matched | Cost | upgrade | max_tgt | eligibility | exclusions | Repo-only |
|---|--:|--:|--:|--:|--:|--:|--:|
| adepta-sororitas | 27 | 0 | 0 | 0 | 4 | 0 | 0 |
| adeptus-astartes | 34 | 0 | 0 | 0 | 7 | 0 | 0 |
| adeptus-custodes | 35 | 0 | 0 | 0 | 9 | 0 | 0 |
| adeptus-mechanicus | 36 | 0 | 0 | 0 | 5 | 0 | 0 |
| aeldari | 54 | 0 | 0 | 0 | 7 | 0 | 0 |
| agents-of-the-imperium | 22 | 0 | 0 | 0 | 1 | 0 | 0 |
| astra-militarum | 40 | 0 | 0 | 0 | 3 | 0 | 0 |
| black-templars | 12 | 0 | 0 | 0 | 6 | 0 | 0 |
| blood-angels | 12 | 0 | 0 | 0 | 2 | 0 | 0 |
| chaos-daemons | 29 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-knights | 28 | 0 | 0 | 0 | 2 | 0 | 0 |
| chaos-space-marines | 64 | 0 | 0 | 0 | 3 | 0 | 0 |
| dark-angels | 12 | 0 | 0 | 0 | 3 | 0 | 0 |
| death-guard | 32 | 0 | 0 | 0 | 3 | 0 | 0 |
| deathwatch | 6 | 0 | 0 | 0 | 4 | 0 | 0 |
| drukhari | 32 | 0 | 0 | 0 | 7 | 0 | 0 |
| emperors-children | 36 | 0 | 0 | 0 | 6 | 0 | 0 |
| genestealer-cults | 32 | 0 | 0 | 0 | 7 | 0 | 0 |
| grey-knights | 32 | 0 | 0 | 0 | 4 | 0 | 0 |
| imperial-fists | 6 | 0 | 0 | 0 | 1 | 0 | 0 |
| imperial-knights | 26 | 0 | 0 | 0 | 0 | 0 | 0 |
| iron-hands | 6 | 0 | 0 | 0 | 3 | 0 | 0 |
| leagues-of-votann | 36 | 0 | 0 | 0 | 3 | 0 | 0 |
| necrons | 44 | 0 | 0 | 0 | 6 | 0 | 0 |
| orks | 40 | 0 | 1 | 0 | 18 | 0 | 0 |
| raven-guard | 6 | 0 | 0 | 0 | 1 | 0 | 0 |
| salamanders | 6 | 0 | 0 | 0 | 1 | 0 | 0 |
| space-wolves | 12 | 0 | 0 | 0 | 4 | 0 | 0 |
| tau-empire | 25 | 0 | 0 | 0 | 4 | 0 | 0 |
| thousand-sons | 32 | 0 | 0 | 0 | 1 | 0 | 0 |
| tyranids | 36 | 0 | 0 | 0 | 7 | 0 | 0 |
| ultramarines | 6 | 0 | 0 | 0 | 2 | 0 | 0 |
| white-scars | 6 | 0 | 0 | 0 | 1 | 0 | 0 |
| world-eaters | 28 | 0 | 0 | 0 | 2 | 0 | 0 |
| **TOTAL** | **890** | **0** | **1** | **0** | **137** | **0** | **0** |

## adepta-sororitas

**Eligibility changes:**
- clarion-of-urgency-chorus-of-condemnation-adepta-sororitas: {"keyword_restrictions":["Adepta Sororitas","Canoness with Jump Pack"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"canoness-with-jump-pack","keywords":["Adepta Sororitas"]}]}
- symphonic-payload-upgrade-chorus-of-condemnation-adepta-sororitas: {"keyword_restrictions":["Adepta Sororitas","Exorcist"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"exorcist","keywords":["Adepta Sororitas"]}]}
- writ-of-compunction-upgrade-sacred-champions-adepta-sororitas: {"keyword_restrictions":["Adepta Sororitas","Celestian Sacresants"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"celestian-sacresants","keywords":["Adepta Sororitas"]}]}
- divine-miracle-sanctuary-guardians-adepta-sororitas: {"keyword_restrictions":["Adepta Sororitas","Sanctuary Guardians Battle Sisters Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"sanctuary-guardians-battle-sisters-squad","keywords":["Adepta Sororitas"]}]}

## adeptus-astartes

**Eligibility changes:**
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- battle-line-veterans-assault-force-adeptus-astartes: {"keyword_restrictions":["Adeptus Astartes","Assault Force Intercessor Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"assault-force-intercessor-squad","keywords":["Adeptus Astartes"]}]}
- blade-masters-assault-force-adeptus-astartes: {"keyword_restrictions":["Adeptus Astartes","Assault Force Vanguard Veteran Squad With Jump Packs"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"assault-force-vanguard-veteran-squad-with-jump-packs","keywords":["Adeptus Astartes"]}]}
- tactical-insight-tactical-brethren-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- narthecis-gauntlet-gravis-siege-force-adeptus-astartes: {"keyword_restrictions":["Apothecary Biologis"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"apothecary-biologis"}]}
- damocles-class-uplink-gauntlet-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- standard-of-the-emperor-ascendant-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Ancient"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Ancient"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"ancient"}]}

## adeptus-custodes

**Eligibility changes:**
- comrades-in-wrath-tristraens-gilded-blades-adeptus-custodes: {"keyword_restrictions":["Adeptus Custodes","Gilded Blades Allarus Custodians"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"gilded-blades-allarus-custodians","keywords":["Adeptus Custodes"]}]}
- shattering-charge-tristraens-gilded-blades-adeptus-custodes: {"keyword_restrictions":["Adeptus Custodes","Tristraen of the Gilded Blades"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"tristraen-of-the-gilded-blades","keywords":["Adeptus Custodes"]}]}
- coronal-plate-aquilan-talon-adeptus-custodes: {"keyword_restrictions":["Aquilan Talon Shield-Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"aquilan-talon-shield-captain"}]}
- goldenwrath-upgrade-aquilan-talon-adeptus-custodes: {"keyword_restrictions":["Aquilan Talon Contemptor-Achillus Dreadnought"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"aquilan-talon-contemptor-achillus-dreadnought"}]}
- eagles-pinions-upgrade-aquilan-wing-adeptus-custodes: {"keyword_restrictions":["Aquilan Wing Venatari with Kinetic Destroyers"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"aquilan-wing-venatari-with-kinetic-destroyers"}]}
- will-of-auramite-aquilan-wing-adeptus-custodes: {"keyword_restrictions":["Aquilan Wing Shield-Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"aquilan-wing-shield-captain"}]}
- sally-forth-solar-watch-adeptus-custodes: {"keyword_restrictions":null,"keyword_restriction_groups":[["Adeptus Custodes","Shield-Captain"],["Shield‑Captain"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":["Adeptus Custodes","Shield-Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"shield-captain"}]}
- lightning-descent-lions-of-the-emperor-adeptus-custodes: {"keyword_restrictions":["Shield‑Captain in Allarus Terminator Armour"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"shield-captain-in-allarus-terminator-armour"}]}
- leonine-ferocity-lions-of-the-emperor-adeptus-custodes: {"keyword_restrictions":["Shield‑Captain in Allarus Terminator Armour"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"shield-captain-in-allarus-terminator-armour"}]}

## adeptus-mechanicus

**Eligibility changes:**
- explorator-dispensation-cohort-acquisitus-adeptus-mechanicus: {"keyword_restrictions":["Adeptus Mechanicus","Skitarii Marshal"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"skitarii-marshal","keywords":["Adeptus Mechanicus"]}]}
- stealth-screened-cybercanids-upgrade-cohort-acquisitus-adeptus-mechanicus: {"keyword_restrictions":["Adeptus Mechanicus","Serberys Raiders"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"serberys-raiders","keywords":["Adeptus Mechanicus"]}]}
- vinghs-wafers-of-dynamism-lords-of-the-forge-adeptus-mechanicus: {"keyword_restrictions":["Adeptus Mechanicus","Cybernetica Datasmith"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"cybernetica-datasmith","keywords":["Adeptus Mechanicus"]}]}
- empowered-mechanisms-purge-corps-deltic-9-adeptus-mechanicus: {"keyword_restrictions":["Purge Corps Serberys Sulphurhounds"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"purge-corps-serberys-sulphurhounds"}]}
- miniaturised-autosimulacra-purge-corps-deltic-9-adeptus-mechanicus: {"keyword_restrictions":["Manipulus Skand"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"manipulus-skand"}]}

## aeldari

**Eligibility changes:**
- a-foot-in-the-future-fateful-performance-aeldari: {"keyword_restrictions":["Harlequins","Troupe Master"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"troupe-master","keywords":["Harlequins"]}]}
- mistweave-fateful-performance-aeldari: {"keyword_restrictions":["Harlequins","Shadowseer"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"shadowseer","keywords":["Harlequins"]}]}
- camouflaged-snipers-upgrade-path-of-the-outcast-aeldari: {"keyword_restrictions":["Asuryani","Rangers"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"rangers","keywords":["Asuryani"]}]}
- shadowfall-masks-upgrade-twilight-flickers-aeldari: {"keyword_restrictions":["Harlequins","Troupe"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"troupe","keywords":["Harlequins"]}]}
- guided-jump-kygharils-protectors-aeldari: {"keyword_restrictions":["Kygharil's Protectors Warp Spiders"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"kygharils-protectors-warp-spiders"}]}
- seers-hand-kygharils-protectors-aeldari: {"keyword_restrictions":["Spiritseer Kygharil"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"spiritseer-kygharil"}]}
- assassins-eye-upgrade-path-of-the-outcast-aeldari: {"keyword_restrictions":null,"keyword_restriction_groups":[["Asuryani","Rangers"],["Asuryani","Shroud Runners"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"rangers","keywords":["Asuryani"]},{"unit_id":"shroud-runners","keywords":["Asuryani"]}]}

## agents-of-the-imperium

**Eligibility changes:**
- killer-reflexes-inquisitors-hand-agents-of-the-imperium: {"keyword_restrictions":["Inquisitor's Hand Eversor Assassin"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"inquisitors-hand-eversor-assassin"}]}

## astra-militarum

**Eligibility changes:**
- long-range-scout-upgrade-designation-force-astra-militarum: {"keyword_restrictions":["Astra Militarum","Scout Sentinels"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"scout-sentinels","keywords":["Astra Militarum"]}]}
- draydens-drill-draydens-lance-astra-militarum: {"keyword_restrictions":["Drayden's Lance Kasrkin"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"draydens-lance-kasrkin"}]}
- sharp-eyes-upgrade-abhuman-auxiliaries-astra-militarum: {"keyword_restrictions":["Astra Militarum","Ratlings"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"ratlings","keywords":["Astra Militarum"]}]}

## black-templars

**Eligibility changes:**
- fervent-exemplars-upgrade-marshals-household-black-templars: {"keyword_restrictions":["Sword Brethren Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Sword Brethren Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"sword-brethren-squad"}]}
- inheritors-of-sigismund-upgrade-marshals-household-black-templars: {"keyword_restrictions":["Sword Brethren Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Sword Brethren Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"sword-brethren-squad"}]}
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- divine-protection-vow-sworn-of-vedrenn-black-templars: {"keyword_restrictions":["Vow-Sworn Sword Brethren Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"vow-sworn-sword-brethren-squad"}]}
- incendiary-animus-vow-sworn-crusaders-black-templars: {"keyword_restrictions":null,"keyword_restriction_groups":[["Chaplain"],["Judiciar"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":["Chaplain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"chaplain"},{"unit_id":"judiciar"}]}
- righteous-fervour-upgrade-fist-of-the-god-emperor-black-templars: {"keyword_restrictions":["Crusader Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Crusader Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"crusader-squad"}]}

## blood-angels

**Eligibility changes:**
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- overwhelming-charge-sanguinary-spearhead-blood-angels: {"keyword_restrictions":["Sanguinary Spearhead Assault Intercessor Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"sanguinary-spearhead-assault-intercessor-squad"}]}

## chaos-knights

**Eligibility changes:**
- pterrorshade-rookery-bastions-of-tyranny-chaos-knights: {"keyword_restrictions":["Chaos Knights","Knight Tyrant"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"knight-tyrant","keywords":["Chaos Knights"]}]}
- hate-filled-dominion-bastions-of-tyranny-chaos-knights: {"keyword_restrictions":["Chaos Knights","Knight Tyrant"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"knight-tyrant","keywords":["Chaos Knights"]}]}

## chaos-space-marines

**Eligibility changes:**
- shadowcowl-talisman-murdertalon-raiders-chaos-space-marines: {"keyword_restrictions":["Chaos Lord with Jump Pack","Heretic Astartes"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"chaos-lord-with-jump-pack","keywords":["Heretic Astartes"]}]}
- pact-of-cursed-pinions-murdertalon-raiders-chaos-space-marines: {"keyword_restrictions":["Chaos Lord with Jump Pack","Heretic Astartes"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"chaos-lord-with-jump-pack","keywords":["Heretic Astartes"]}]}
- prey-on-the-weak-zarkans-daemonkin-chaos-space-marines: {"keyword_restrictions":["Zarkan's Daemonkin Possessed"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"zarkans-daemonkin-possessed"}]}

## dark-angels

**Eligibility changes:**
- nightforged-battery-upgrade-darkflight-pursuit-dark-angels: {"keyword_restrictions":["Land Speeder Vengeance"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"land-speeder-vengeance"}]}
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- dutiful-defenders-the-vengeful-brethren-dark-angels: {"keyword_restrictions":["Vengeful Brethren Bladeguard Veteran Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"vengeful-brethren-bladeguard-veteran-squad"}]}

## death-guard

**Eligibility changes:**
- insectile-murmuration-upgrade-flyblown-host-death-guard: {"keyword_restrictions":["Death Guard","Plague Marines"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"plague-marines","keywords":["Death Guard"]}]}
- plagueveil-upgrade-flyblown-host-death-guard: {"keyword_restrictions":["Death Guard","Plague Marines"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"plague-marines","keywords":["Death Guard"]}]}
- lancet-of-the-worldsore-upgrade-contagion-engines-death-guard: {"keyword_restrictions":null,"keyword_restriction_groups":[["Death Guard","Helbrute"],["Death Guard","Myphitic Blight-haulers"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"helbrute","keywords":["Death Guard"]},{"unit_id":"myphitic-blight-haulers","keywords":["Death Guard"]}]}

## deathwatch

**Eligibility changes:**
- osseus-key-aura-black-spear-task-force-deathwatch: {"keyword_restrictions":null,"keyword_restriction_groups":[["Watch Master"],["Techmarine"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":[["Watch Master"],["Techmarine"]],"datasheet_restriction_groups":[{"unit_id":"techmarine"},{"unit_id":"watch-master"}]}
- the-tome-of-ectoclades-black-spear-task-force-deathwatch: {"keyword_restrictions":null,"keyword_restriction_groups":[["Watch Master"],["Captain"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":[["Watch Master"],["Captain"]],"datasheet_restriction_groups":[{"unit_id":"captain"},{"unit_id":"watch-master"}]}
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- the-thief-of-secrets-black-spear-task-force-deathwatch: {"keyword_restrictions":null,"keyword_restriction_groups":[["Watch Master"],["Captain"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":[["Watch Master"],["Captain"]],"datasheet_restriction_groups":[{"unit_id":"captain"},{"unit_id":"watch-master"}]}

## drukhari

**Eligibility changes:**
- periapt-of-torments-exhibition-of-slaughter-drukhari: {"keyword_restrictions":["Drukhari","Succubus"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"succubus","keywords":["Drukhari"]}]}
- hyperstimm-trafficker-exhibition-of-slaughter-drukhari: {"keyword_restrictions":["Drukhari","Succubus"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"succubus","keywords":["Drukhari"]}]}
- towering-arrogance-kabalite-agonysts-drukhari: {"keyword_restrictions":["Archon","Drukhari"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"archon","keywords":["Drukhari"]}]}
- contempt-for-rivals-kabalite-agonysts-drukhari: {"keyword_restrictions":["Archon","Drukhari"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"archon","keywords":["Drukhari"]}]}
- gnarlskin-experimentor-tools-of-torment-drukhari: {"keyword_restrictions":["Drukhari","Haemonculus"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"haemonculus","keywords":["Drukhari"]}]}
- elixir-of-the-corpse-courts-upgrade-tools-of-torment-drukhari: {"keyword_restrictions":null,"keyword_restriction_groups":[["Cronos","Drukhari"],["Drukhari","Talos"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"cronos","keywords":["Drukhari"]},{"unit_id":"talos","keywords":["Drukhari"]}]}
- superior-soulcraft-coven-of-agonies-drukhari: {"keyword_restrictions":["Coven of Agonies Cronos"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"coven-of-agonies-cronos"}]}

## emperors-children

**Eligibility changes:**
- cacophonic-accompaniment-elegant-brutes-emperors-children: {"keyword_restrictions":["Emperor’s Children","Lord Kakophonist"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"lord-kakophonist","keywords":["Emperor’s Children"]}]}
- euphoric-crown-frenzied-host-emperors-children: {"keyword_restrictions":["Emperor’s Children","Lord Exultant"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"lord-exultant","keywords":["Emperor’s Children"]}]}
- howling-plate-frenzied-host-emperors-children: {"keyword_restrictions":["Emperor’s Children","Lord Exultant"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"lord-exultant","keywords":["Emperor’s Children"]}]}
- eager-patrons-upgrade-spectacle-of-slaughter-emperors-children: {"keyword_restrictions":["Emperor’s Children","Flawless Blades"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"flawless-blades","keywords":["Emperor’s Children"]}]}
- beguiling-grotesquerie-upgrade-spectacle-of-slaughter-emperors-children: {"keyword_restrictions":["Emperor’s Children","Flawless Blades"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"flawless-blades","keywords":["Emperor’s Children"]}]}
- martial-perfection-callous-blades-emperors-children: {"keyword_restrictions":["Callous Blades Infractors"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"callous-blades-infractors"}]}

## genestealer-cults

**Eligibility changes:**
- gene-tailored-toxins-heroes-of-the-uprising-genestealer-cults: {"keyword_restrictions":null,"keyword_restriction_groups":[["Genestealer Cults","Locus"],["Genestealer Cults","Sanctus"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"locus","keywords":["Genestealer Cults"]},{"unit_id":"sanctus","keywords":["Genestealer Cults"]}]}
- contraband-munitions-heroes-of-the-uprising-genestealer-cults: {"keyword_restrictions":null,"keyword_restriction_groups":[["Genestealer Cults","Kelermorph"],["Genestealer Cults","Reductus Saboteur"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"kelermorph","keywords":["Genestealer Cults"]},{"unit_id":"reductus-saboteur","keywords":["Genestealer Cults"]}]}
- mark-of-the-star-children-upgrade-purestrain-broodswarm-genestealer-cults: {"keyword_restrictions":["Genestealer Cults","Purestrain Genestealers"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"purestrain-genestealers","keywords":["Genestealer Cults"]}]}
- talons-of-the-sire-purestrain-broodswarm-genestealer-cults: {"keyword_restrictions":["Genestealer Cults","Patriarch"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"patriarch","keywords":["Genestealer Cults"]}]}
- inspired-to-greatness-xenocult-masses-genestealer-cults: {"keyword_restrictions":null,"keyword_restriction_groups":[["Genestealer Cults","Magus"],["Genestealer Cults","Primus"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"magus","keywords":["Genestealer Cults"]},{"unit_id":"primus","keywords":["Genestealer Cults"]}]}
- devious-disguises-upgrade-xenocult-masses-genestealer-cults: {"keyword_restrictions":["Genestealer Cults","Neophyte Hybrids"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"neophyte-hybrids","keywords":["Genestealer Cults"]}]}
- heavy-munitions-claw-of-ascension-genestealer-cults: {"keyword_restrictions":["Claw of Ascension Achilles Ridgerunner"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"claw-of-ascension-achilles-ridgerunner"}]}

## grey-knights

**Eligibility changes:**
- precognicient-volleys-upgrade-fires-of-purgation-grey-knights: {"keyword_restrictions":["Grey Knights","Purgation Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"purgation-squad","keywords":["Grey Knights"]}]}
- boons-of-deimos-upgrade-fires-of-purgation-grey-knights: {"keyword_restrictions":["Grey Knights","Purgation Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"purgation-squad","keywords":["Grey Knights"]}]}
- predestined-coordinates-upgrade-immaterial-interdiction-grey-knights: {"keyword_restrictions":["Grey Knights","Interceptor Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"interceptor-squad","keywords":["Grey Knights"]}]}
- astral-overlap-upgrade-immaterial-interdiction-grey-knights: {"keyword_restrictions":["Grey Knights","Interceptor Squad"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"interceptor-squad","keywords":["Grey Knights"]}]}

## imperial-fists

**Eligibility changes:**
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}

## iron-hands

**Eligibility changes:**
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- target-augury-web-medusas-wrath-iron-hands: {"keyword_restrictions":["Techmarine"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Techmarine"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"techmarine"}]}
- adept-of-the-omnissiah-medusas-wrath-iron-hands: {"keyword_restrictions":["Techmarine"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Techmarine"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"techmarine"}]}

## leagues-of-votann

**Eligibility changes:**
- saturation-rounds-upgrade-armoured-trailblazers-leagues-of-votann: {"keyword_restrictions":["Leagues of Votann","Sagitaur"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"sagitaur","keywords":["Leagues of Votann"]}]}
- optimised-attack-lines-upgrade-armoured-trailblazers-leagues-of-votann: {"keyword_restrictions":["Leagues of Votann","Sagitaur"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"sagitaur","keywords":["Leagues of Votann"]}]}
- brokhyr-barrage-bane-slayers-bulwark-leagues-of-votann: {"keyword_restrictions":["Bane Slayer's Bulwark Brokhyr Thunderkyn"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"bane-slayers-bulwark-brokhyr-thunderkyn"}]}

## necrons

**Eligibility changes:**
- enlivened-sentinels-upgrade-hand-of-the-dynasty-necrons: {"keyword_restrictions":["Necron Warriors","Necrons"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"necron-warriors","keywords":["Necrons"]}]}
- tools-of-dominion-upgrade-hand-of-the-dynasty-necrons: {"keyword_restrictions":["Immortals","Necrons"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"immortals","keywords":["Necrons"]}]}
- recursive-reanimation-upgrade-skyshroud-spearhead-necrons: {"keyword_restrictions":["Necrons","Tomb Blades"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"tomb-blades","keywords":["Necrons"]}]}
- metalline-might-amonhotekhs-guard-necrons: {"keyword_restrictions":["Overlord Amonhotekh"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"overlord-amonhotekh"}]}
- unblemished-legions-amonhotekhs-guard-necrons: {"keyword_restrictions":["Amonhotekh's Guard Necron Warriors"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"amonhotekhs-guard-necron-warriors"}]}
- mortality-shroud-aura-upgrade-the-phaerons-armoury-necrons: {"keyword_restrictions":["Necrons","Obelisk"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"obelisk","keywords":["Necrons"]}]}

## orks

**upgrade_tag changes:**
- extra-platin-ardmob-orks: false → true

**Eligibility changes:**
- dreadherder-dread-mob-orks: {"keyword_restrictions":["Big Mek"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Big Mek"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"big-mek"}]}
- ardboyz-upgrade-green-tide-orks: {"keyword_restrictions":["Boyz"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"boyz"}]}
- competitive-streak-kult-of-speed-orks: {"keyword_restrictions":["Deffkilla Wartrike"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"deffkilla-wartrike"}]}
- enhanced-runt-maw-upgrade-madcap-meks-orks: {"keyword_restrictions":["Big Mek with Shokk Attack Gun"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"big-mek-with-shokk-attack-gun"}]}
- extra-sneaky-upgrade-runt-swarm-orks: {"keyword_restrictions":["Gretchin"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"gretchin"}]}
- it-came-from-da-drops-da-big-hunt-orks: {"keyword_restrictions":["Beastboss on Squigosaur"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"beastboss-on-squigosaur"}]}
- kaptins-hat-wreckas-orks: {"keyword_restrictions":null,"keyword_restriction_groups":[["Big Mek"],["Infantry","Warboss"],["Big Mek","Infantry"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":[["Infantry","Warboss"],["Big Mek","Infantry"]],"datasheet_restriction_groups":[{"unit_id":"big-mek"}]}
- mekwaaagh-mastermind-madcap-meks-orks: {"keyword_restrictions":["Big Mek"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Big Mek"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"big-mek"}]}
- minefield-detail-upgrade-runt-swarm-orks: {"keyword_restrictions":["Gretchin"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"gretchin"}]}
- supa-snazz-dakka-upgrade-wreckas-orks: {"keyword_restrictions":["Flash Gitz"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"flash-gitz"}]}
- targetin-squigs-shoota-boyz-orks: {"keyword_restrictions":null,"keyword_restriction_groups":[["Big Mek"],["Bigboss"],["Warboss"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":[["Big Mek"],["Warboss"]],"datasheet_restriction_groups":[{"unit_id":"big-mek"},{"unit_id":"bigboss"}]}
- temperamental-shokka-upgrade-madcap-meks-orks: {"keyword_restrictions":["Big Mek with Shokk Attack Gun"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"big-mek-with-shokk-attack-gun"}]}
- throat-slittas-upgrade-taktikal-brigade-orks: {"keyword_restrictions":null,"keyword_restriction_groups":[["Kommandos"],["Stormboyz"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"kommandos"},{"unit_id":"stormboyz"}]}
- wimp-kickaz-upgrade-bully-boyz-orks: {"keyword_restrictions":["Nobz"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"nobz"}]}
- kill-kommanda-taktikal-brigade-orks: {"keyword_restrictions":null,"keyword_restriction_groups":[["Big Mek"],["Infantry","Warboss"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":[["Big Mek"],["Infantry","Warboss"]],"datasheet_restriction_groups":[{"unit_id":"big-mek"}]}
- cybork-boosta-dread-mob-orks: {"keyword_restrictions":null,"keyword_restriction_groups":[["Big Mek"],["Mek"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":["Big Mek"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"big-mek"},{"unit_id":"mek"}]}
- extra-platin-ardmob-orks: {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"ardmob-wartrakk","keywords":["Orks"]}]}
- rallying-war-cry-ardmob-orks: {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"ardmob-warboss","keywords":["Orks"]}]}

## raven-guard

**Eligibility changes:**
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}

## salamanders

**Eligibility changes:**
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}

## space-wolves

**Eligibility changes:**
- grimnars-mark-saga-of-the-great-wolf-space-wolves: {"keyword_restrictions":null,"keyword_restriction_groups":[["Captain in Terminator Armour"],["Adeptus Astartes","Captain","Terminator"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":["Adeptus Astartes","Captain","Terminator"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain-in-terminator-armour"}]}
- howlmaw-saga-of-the-great-wolf-space-wolves: {"keyword_restrictions":["Wolf Priest"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Wolf Priest"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"wolf-priest"}]}
- skjalds-foretelling-saga-of-the-great-wolf-space-wolves: {"keyword_restrictions":null,"keyword_restriction_groups":[["Battle Leader","Wolf Guard"],["Wolf Guard Battle Leader"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":["Battle Leader","Wolf Guard"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"wolf-guard-battle-leader"}]}
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}

## tau-empire

**Eligibility changes:**
- negation-emitters-upgrade-advanced-acquisition-cadre-tau-empire: {"keyword_restrictions":["Stealth Battlesuits","T’au Empire"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"stealth-battlesuits","keywords":["T’au Empire"]}]}
- unmasking-suite-upgrade-advanced-acquisition-cadre-tau-empire: {"keyword_restrictions":null,"keyword_restriction_groups":[["Ghostkeel"],["Pathfinder Team"],["Stealth Battlesuits"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":[["Pathfinder Team"],["Ghostkeel"]],"datasheet_restriction_groups":[{"unit_id":"stealth-battlesuits"}]}
- earth-caste-modifications-sudden-dawn-cadre-tau-empire: {"keyword_restrictions":["Commander Cloudspear"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"commander-cloudspear"}]}
- proximity-scanners-sudden-dawn-cadre-tau-empire: {"keyword_restrictions":["Sudden Dawn Cadre Devilfish"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"sudden-dawn-cadre-devilfish"}]}

## thousand-sons

**Eligibility changes:**
- unravelled-fates-servants-of-change-thousand-sons: {"keyword_restrictions":["Thousand Sons","Tzaangor Shaman"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"tzaangor-shaman","keywords":["Thousand Sons"]}]}

## tyranids

**Eligibility changes:**
- ocular-adaptation-warrior-bioform-onslaught-tyranids: {"keyword_restrictions":null,"keyword_restriction_groups":[["Tyranid Prime with Lash Whip","Tyranids"],["Tyranids","Winged Tyranid Prime"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"tyranid-prime-with-lash-whip","keywords":["Tyranids"]},{"unit_id":"winged-tyranid-prime","keywords":["Tyranids"]}]}
- elevated-might-warrior-bioform-onslaught-tyranids: {"keyword_restrictions":null,"keyword_restriction_groups":[["Tyranids","Winged Tyranid Prime"],["Tyranid Prime with Lash Whip","Tyranids"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"tyranid-prime-with-lash-whip","keywords":["Tyranids"]},{"unit_id":"winged-tyranid-prime","keywords":["Tyranids"]}]}
- encircling-horrors-upgrade-ambush-predators-tyranids: {"keyword_restrictions":null,"keyword_restriction_groups":[["Neurolictor","Tyranids"],["Lictor","Tyranids"],["Tyranids","Von Ryan’s Leapers"]],"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"lictor","keywords":["Tyranids"]},{"unit_id":"neurolictor","keywords":["Tyranids"]},{"unit_id":"von-ryans-leapers","keywords":["Tyranids"]}]}
- cryptophotaic-camouflage-upgrade-ambush-predators-tyranids: {"keyword_restrictions":["Tyranids","Von Ryan’s Leapers"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"von-ryans-leapers","keywords":["Tyranids"]}]}
- destabilising-predation-upgrade-talons-of-the-norn-queen-tyranids: {"keyword_restrictions":["Norn Emissary","Tyranids"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"norn-emissary","keywords":["Tyranids"]}]}
- synaptoprescience-upgrade-talons-of-the-norn-queen-tyranids: {"keyword_restrictions":["Norn Assimilator","Tyranids"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"norn-assimilator","keywords":["Tyranids"]}]}
- psychoclastic-overload-the-vardenghast-swarm-tyranids: {"keyword_restrictions":["Vardenghast Swarm Psychophage"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"vardenghast-swarm-psychophage"}]}

## ultramarines

**Eligibility changes:**
- student-of-the-codex-blade-of-ultramar-ultramarines: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}

## white-scars

**Eligibility changes:**
- adept-of-the-codex-gladius-task-force-adeptus-astartes: {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":["Captain"],"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"captain"}]}

## world-eaters

**Eligibility changes:**
- talons-of-butchery-upgrade-brazen-engines-world-eaters: {"keyword_restrictions":["Maulerfiend","World Eaters"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"maulerfiend","keywords":["World Eaters"]}]}
- bane-of-the-craven-frenzied-reavers-world-eaters: {"keyword_restrictions":["Frenzied Reavers Master of Executions"],"keyword_restriction_groups":null,"datasheet_restriction_groups":null} → {"keyword_restrictions":null,"keyword_restriction_groups":null,"datasheet_restriction_groups":[{"unit_id":"frenzied-reavers-master-of-executions"}]}

## Enhancement seeds skipped (1)

- beacon-angelis-deathwatch-support-deathwatch: detachment deathwatch-support is ambiguous across adeptus-astartes, black-templars, blood-angels, dark-angels, imperial-fists, iron-hands, raven-guard, salamanders, space-wolves, ultramarines, white-scars

## Unresolved enhancements in dump (no unambiguous repo detachment)

- beacon-angelis-deathwatch-support-deathwatch

