# MFM enhancement reconcile — APPLIED

Reconciles source-owned fields and seeds source-complete matched-play
enhancements whose detachment already exists. `keyword_restriction_groups`
preserves exact OR-of-AND eligibility. Eligibility and exclusions are
authoritative when all source keywords resolve: they replace stale core
values and absent source relations clear them. Prose is never read or written.

| Dir | Matched | Cost | upgrade | max_tgt | eligibility | exclusions | Repo-only |
|---|--:|--:|--:|--:|--:|--:|--:|
| adepta-sororitas | 27 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-astartes | 61 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-custodes | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-mechanicus | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| aeldari | 54 | 0 | 0 | 0 | 0 | 0 | 0 |
| agents-of-the-imperium | 22 | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-militarum | 40 | 0 | 0 | 0 | 0 | 0 | 0 |
| black-templars | 75 | 0 | 0 | 0 | 0 | 0 | 0 |
| blood-angels | 84 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-daemons | 29 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-knights | 28 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 64 | 0 | 0 | 0 | 0 | 0 | 0 |
| crimson-fists | 56 | 0 | 0 | 0 | 0 | 0 | 0 |
| dark-angels | 84 | 0 | 0 | 0 | 0 | 0 | 0 |
| death-guard | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| deathwatch | 60 | 0 | 0 | 0 | 0 | 0 | 0 |
| drukhari | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| emperors-children | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| genestealer-cults | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| grey-knights | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 60 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-knights | 26 | 0 | 0 | 0 | 0 | 0 | 0 |
| iron-hands | 60 | 0 | 0 | 0 | 0 | 0 | 0 |
| leagues-of-votann | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| necrons | 44 | 0 | 0 | 0 | 0 | 0 | 0 |
| orks | 29 | 1 | 1 | 1 | 0 | 0 | 0 |
| raven-guard | 59 | 0 | 0 | 0 | 0 | 0 | 0 |
| salamanders | 57 | 0 | 0 | 0 | 0 | 0 | 0 |
| space-wolves | 80 | 0 | 0 | 0 | 0 | 0 | 0 |
| tau-empire | 25 | 0 | 0 | 0 | 0 | 0 | 0 |
| thousand-sons | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| tyranids | 36 | 0 | 0 | 0 | 0 | 0 | 0 |
| ultramarines | 64 | 0 | 0 | 0 | 0 | 0 | 0 |
| white-scars | 60 | 0 | 0 | 0 | 0 | 0 | 0 |
| world-eaters | 28 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **1612** | **1** | **1** | **1** | **0** | **0** | **0** |

## orks

**Cost changes** (old → new):
- ardboyz-upgrade-green-tide-orks: 0 → 25

**upgrade_tag changes:**
- ardboyz-upgrade-green-tide-orks: false → true

**max_targets changes:**
- ardboyz-upgrade-green-tide-orks: 1 → 3

## Seeded matched-play enhancements (9)

- orks/boss-boomer-upgrade-blitz-brigade-orks (Boss Boomer (Upgrade)) → blitz-brigade
- orks/cybork-boosta-dread-mob-orks (Cybork Boosta) → dread-mob
- orks/ferocious-show-off-green-tide-orks (Ferocious Show-off) → green-tide
- orks/follow-me-ladz-war-horde-orks (Follow Me Ladz) → war-horde
- orks/glory-hog-da-big-hunt-orks (Glory Hog) → da-big-hunt
- orks/headwoppas-killchoppa-war-horde-orks (Headwoppa's Killchoppa) → war-horde
- orks/kill-kommanda-taktikal-brigade-orks (Kill Kommanda) → taktikal-brigade
- orks/kunnin-but-brutal-war-horde-orks (Kunnin’ But Brutal) → war-horde
- orks/targetin-gizmos-upgrade-blitz-brigade-orks (Targetin’ Gizmos (Upgrade)) → blitz-brigade

## Combat-Patrol enhancements held back (2 — pass --include-combat-patrol to author)

- extra-platin-ardmob-orks
- rallying-war-cry-ardmob-orks

