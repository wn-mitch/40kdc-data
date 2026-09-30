# MFM enhancement reconcile — APPLIED

Reconciles source-owned fields and seeds source-complete matched-play
enhancements whose detachment already exists. `keyword_restriction_groups`
preserves exact OR-of-AND eligibility. Eligibility and exclusions are
authoritative when all source keywords resolve: they replace stale core
values and absent source relations clear them. Prose is never read or written.

| Dir | Matched | Cost | upgrade | max_tgt | eligibility | exclusions | Repo-only |
|---|--:|--:|--:|--:|--:|--:|--:|
| adepta-sororitas | 27 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-astartes | 38 | 0 | 0 | 0 | 0 | 0 | 53 |
| adeptus-custodes | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-mechanicus | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| aeldari | 54 | 0 | 0 | 0 | 0 | 0 | 0 |
| agents-of-the-imperium | 22 | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-militarum | 40 | 0 | 0 | 0 | 0 | 0 | 0 |
| black-templars | 15 | 0 | 0 | 0 | 0 | 0 | 66 |
| blood-angels | 15 | 0 | 0 | 0 | 0 | 0 | 70 |
| chaos-daemons | 29 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-knights | 28 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 64 | 0 | 0 | 0 | 0 | 0 | 0 |
| crimson-fists | 5 | 0 | 0 | 0 | 0 | 0 | 51 |
| dark-angels | 15 | 0 | 0 | 0 | 0 | 0 | 69 |
| death-guard | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| deathwatch | 9 | 0 | 0 | 0 | 0 | 0 | 52 |
| drukhari | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| emperors-children | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| genestealer-cults | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| grey-knights | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 5 | 0 | 0 | 0 | 0 | 0 | 55 |
| imperial-knights | 26 | 0 | 0 | 0 | 0 | 0 | 0 |
| iron-hands | 9 | 0 | 0 | 0 | 0 | 0 | 55 |
| leagues-of-votann | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| necrons | 44 | 0 | 0 | 0 | 0 | 0 | 0 |
| orks | 38 | 0 | 0 | 0 | 0 | 0 | 0 |
| raven-guard | 9 | 0 | 0 | 0 | 0 | 0 | 50 |
| salamanders | 9 | 0 | 0 | 0 | 0 | 0 | 48 |
| space-wolves | 15 | 0 | 0 | 0 | 0 | 0 | 65 |
| tau-empire | 25 | 0 | 0 | 0 | 0 | 0 | 0 |
| thousand-sons | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| tyranids | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| ultramarines | 9 | 0 | 0 | 0 | 0 | 0 | 55 |
| white-scars | 9 | 0 | 0 | 0 | 0 | 0 | 51 |
| world-eaters | 28 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **923** | **0** | **0** | **0** | **0** | **0** | **740** |

## adeptus-astartes

**Repo enhancements absent from dump** (left as-is):
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes
- avenging-angel-vengeful-hosts-adeptus-astartes
- orksbane-vengeful-hosts-adeptus-astartes

## black-templars

**Repo enhancements absent from dump** (left as-is):
- incendiary-animus-companions-of-vehemence-black-templars
- merciless-denunciation-companions-of-vehemence-black-templars
- zealous-vanguard-companions-of-vehemence-black-templars
- imperialis-of-the-eternal-crusade-vindication-task-force-black-templars
- consecrating-aura-vindication-task-force-black-templars
- orb-of-the-emperors-aegis-vindication-task-force-black-templars
- warden-of-honour-vindication-task-force-black-templars
- paragon-of-fury-godhammer-assault-force-black-templars
- battle-psalm-precentor-godhammer-assault-force-black-templars
- augury-servo-host-godhammer-assault-force-black-templars
- herald-of-sacred-slaughter-godhammer-assault-force-black-templars
- benediction-of-fury-wrathful-procession-black-templars
- adaptable-executioner-wrathful-procession-black-templars
- guiding-omens-the-living-miracle-black-templars
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes
- oathbound-exemplar-companions-of-vehemence-black-templars

## blood-angels

**Repo enhancements absent from dump** (left as-is):
- sanguinius-grace-the-lost-brethren-blood-angels
- blood-shard-the-lost-brethren-blood-angels
- to-slay-the-warmaster-the-lost-brethren-blood-angels
- vengeful-onslaught-the-lost-brethren-blood-angels
- artisan-of-war-the-angelic-host-blood-angels
- visage-of-death-the-angelic-host-blood-angels
- archangels-shard-the-angelic-host-blood-angels
- gleaming-pinions-the-angelic-host-blood-angels
- troubling-visions-angelic-inheritors-blood-angels
- carmine-reliquary-rage-cursed-onslaught-blood-angels
- master-of-the-red-thirst-rage-cursed-onslaught-blood-angels
- sanguinary-tear-aura-rage-cursed-onslaught-blood-angels
- angels-fang-rage-cursed-onslaught-blood-angels
- blood-boil-legacy-of-grace-blood-angels
- aureole-of-the-angel-legacy-of-grace-blood-angels
- speed-of-the-primarch-liberator-assault-group-blood-angels
- rage-fuelled-warrior-liberator-assault-group-blood-angels
- icon-of-the-angel-liberator-assault-group-blood-angels
- gift-of-foresight-liberator-assault-group-blood-angels
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## crimson-fists

**Repo enhancements absent from dump** (left as-is):
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## dark-angels

**Repo enhancements absent from dump** (left as-is):
- shroud-of-heroes-unforgiven-task-force-dark-angels
- stubborn-tenacity-unforgiven-task-force-dark-angels
- weapons-of-the-first-legion-unforgiven-task-force-dark-angels
- pennant-of-remembrance-unforgiven-task-force-dark-angels
- eye-of-the-unseen-inner-circle-task-force-dark-angels
- deathwing-assault-inner-circle-task-force-dark-angels
- calibanite-armaments-lions-blade-task-force-dark-angels
- lord-of-the-hunt-lions-blade-task-force-dark-angels
- stalwart-champion-lions-blade-task-force-dark-angels
- fulgus-magna-lions-blade-task-force-dark-angels
- petition-of-stability-upgrade-dark-age-arsenal-dark-angels
- entreaty-of-perpetual-ardour-upgrade-dark-age-arsenal-dark-angels
- limitless-zeal-interrogation-conclave-dark-angels
- inescapable-interrogation-interrogation-conclave-dark-angels
- master-crafted-weapon-company-of-hunters-dark-angels
- mounted-strategist-company-of-hunters-dark-angels
- master-of-manoeuvre-company-of-hunters-dark-angels
- recon-hunter-company-of-hunters-dark-angels
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## deathwatch

**Repo enhancements absent from dump** (left as-is):
- thief-of-secrets-black-spear-task-force-deathwatch
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## imperial-fists

**Repo enhancements absent from dump** (left as-is):
- champion-of-the-feast-emperors-shield-adeptus-astartes
- disciple-of-rhetoricus-emperors-shield-adeptus-astartes
- indomitable-champion-emperors-shield-adeptus-astartes
- malodraxian-standard-emperors-shield-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## iron-hands

**Repo enhancements absent from dump** (left as-is):
- spiritus-ferrum-hammer-of-avernii-adeptus-astartes
- medusan-roar-aura-hammer-of-avernii-adeptus-astartes
- iron-laurel-hammer-of-avernii-adeptus-astartes
- steel-font-hammer-of-avernii-adeptus-astartes
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## raven-guard

**Repo enhancements absent from dump** (left as-is):
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## salamanders

**Repo enhancements absent from dump** (left as-is):
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## space-wolves

**Repo enhancements absent from dump** (left as-is):
- swift-hunter-saga-of-the-hunter-space-wolves
- fenrisian-grit-saga-of-the-hunter-space-wolves
- wolf-master-saga-of-the-hunter-space-wolves
- feral-rage-saga-of-the-hunter-space-wolves
- braggarts-steel-saga-of-the-bold-space-wolves
- skjald-saga-of-the-bold-space-wolves
- hordeslayer-saga-of-the-bold-space-wolves
- thunderwolfs-fortitude-saga-of-the-bold-space-wolves
- elders-guidance-saga-of-the-beastslayer-space-wolves
- helm-of-the-beastslayer-saga-of-the-beastslayer-space-wolves
- thirst-for-glory-upgrade-legends-of-saga-and-song-space-wolves
- fierce-example-upgrade-legends-of-saga-and-song-space-wolves
- eye-of-the-hunter-veterans-of-the-fang-space-wolves
- weaver-of-sagas-veterans-of-the-fang-space-wolves
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## ultramarines

**Repo enhancements absent from dump** (left as-is):
- seals-of-reconquest-reclamation-force-adeptus-astartes
- avenging-avatar-aura-reclamation-force-adeptus-astartes
- scroll-of-proclamation-reclamation-force-adeptus-astartes
- liberatum-reclamation-force-adeptus-astartes
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## white-scars

**Repo enhancements absent from dump** (left as-is):
- the-imperiums-sword-1st-company-task-force-adeptus-astartes
- fear-made-manifest-aura-1st-company-task-force-adeptus-astartes
- rites-of-war-1st-company-task-force-adeptus-astartes
- iron-resolve-1st-company-task-force-adeptus-astartes
- the-honour-vehement-gladius-task-force-adeptus-astartes
- fire-discipline-gladius-task-force-adeptus-astartes
- fury-of-the-storm-stormlance-task-force-adeptus-astartes
- portents-of-wisdom-stormlance-task-force-adeptus-astartes
- feinting-withdrawal-stormlance-task-force-adeptus-astartes
- hunters-instincts-stormlance-task-force-adeptus-astartes
- celerity-librarius-conclave-adeptus-astartes
- prescience-librarius-conclave-adeptus-astartes
- obfuscation-librarius-conclave-adeptus-astartes
- temporal-corridor-librarius-conclave-adeptus-astartes
- fusillade-librarius-conclave-adeptus-astartes
- the-blade-driven-deep-vanguard-spearhead-adeptus-astartes
- ghostweave-cloak-vanguard-spearhead-adeptus-astartes
- execute-and-redeploy-vanguard-spearhead-adeptus-astartes
- shadow-war-veteran-vanguard-spearhead-adeptus-astartes
- laurels-of-thunder-orbital-assault-force-adeptus-astartes
- veteran-of-the-vanguard-orbital-assault-force-adeptus-astartes
- orbital-uplink-reliquary-orbital-assault-force-adeptus-astartes
- indomitable-fury-anvil-siege-force-adeptus-astartes
- fleet-commander-anvil-siege-force-adeptus-astartes
- stoic-defender-anvil-siege-force-adeptus-astartes
- architect-of-war-anvil-siege-force-adeptus-astartes
- champion-of-humanity-firestorm-assault-force-adeptus-astartes
- war-tempered-artifice-firestorm-assault-force-adeptus-astartes
- forged-in-battle-firestorm-assault-force-adeptus-astartes
- adamantine-mantle-firestorm-assault-force-adeptus-astartes
- target-augury-web-ironstorm-spearhead-adeptus-astartes
- the-flesh-is-weak-ironstorm-spearhead-adeptus-astartes
- adept-of-the-omnissiah-ironstorm-spearhead-adeptus-astartes
- master-of-machine-war-ironstorm-spearhead-adeptus-astartes
- bellicose-weapon-spirits-upgrade-fulguris-task-force-adeptus-astartes
- raptorial-cogitator-core-upgrade-fulguris-task-force-adeptus-astartes
- shroud-field-subversion-assets-adeptus-astartes
- death-in-the-dark-upgrade-subversion-assets-adeptus-astartes
- liberator-armoured-speartip-adeptus-astartes
- tip-of-the-spear-armoured-speartip-adeptus-astartes
- shock-deployment-armoured-speartip-adeptus-astartes
- armoured-commander-armoured-speartip-adeptus-astartes
- eye-of-the-primarch-bastion-task-force-adeptus-astartes
- hero-of-the-chapter-bastion-task-force-adeptus-astartes
- blades-of-valour-bastion-task-force-adeptus-astartes
- bombast-omnivox-bastion-task-force-adeptus-astartes
- redoubtable-machine-spirit-headhunter-task-force-adeptus-astartes
- gunnery-honours-headhunter-task-force-adeptus-astartes
- firestorm-coordinators-headhunter-task-force-adeptus-astartes
- astartes-tank-ace-aura-headhunter-task-force-adeptus-astartes
- dedicated-gunship-orbital-assault-force-adeptus-astartes

## Enhancement seeds skipped (3)

- beacon-angelis-deathwatch-support-deathwatch: detachment deathwatch-support is ambiguous across adeptus-astartes, black-templars, blood-angels, dark-angels, imperial-fists, iron-hands, raven-guard, salamanders, space-wolves, ultramarines, white-scars
- extra-platin-ardmob-orks: matched-play enhancement has no points cost
- rallying-war-cry-ardmob-orks: matched-play enhancement has no points cost

## Unresolved enhancements in dump (no unambiguous repo detachment)

- beacon-angelis-deathwatch-support-deathwatch
- extra-platin-ardmob-orks
- rallying-war-cry-ardmob-orks

