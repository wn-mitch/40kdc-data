# MFM enhancement reconcile — APPLIED

Reconciles source-owned fields and seeds source-complete matched-play
enhancements whose detachment already exists. `keyword_restriction_groups`
preserves exact OR-of-AND eligibility. Eligibility and exclusions are
authoritative when all source keywords resolve: they replace stale core
values and absent source relations clear them. Prose is never read or written.

| Dir | Matched | Cost | upgrade | max_tgt | eligibility | exclusions | abilities | Repo-only |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| adepta-sororitas | 27 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-astartes | 34 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-custodes | 35 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-mechanicus | 36 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| aeldari | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| agents-of-the-imperium | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-militarum | 40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| black-templars | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| blood-angels | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-daemons | 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-knights | 28 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 64 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| dark-angels | 12 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| death-guard | 32 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| deathwatch | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| drukhari | 32 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| emperors-children | 36 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| genestealer-cults | 32 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| grey-knights | 32 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-knights | 26 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| iron-hands | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| leagues-of-votann | 36 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| necrons | 44 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| orks | 40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| raven-guard | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| salamanders | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| space-wolves | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tau-empire | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| thousand-sons | 32 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tyranids | 36 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| ultramarines | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| white-scars | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| world-eaters | 28 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **890** | **0** | **0** | **0** | **0** | **0** | **5** | **0** |

## chaos-space-marines

**required_ability_ids changes:**
- eye-of-the-warp-warpstrike-champions-chaos-space-marines: null → ["deep-strike"]
- akshurs-binding-runes-warpstrike-champions-chaos-space-marines: null → ["deep-strike"]
- tzagulla-warpstrike-champions-chaos-space-marines: null → ["deep-strike"]

## dark-angels

**required_ability_ids changes:**
- deathwing-assault-wrath-of-the-rock-dark-angels: null → ["deep-strike"]

## tyranids

**required_ability_ids changes:**
- vanguard-intellect-subterranean-assault-tyranids: null → ["deep-strike"]

## Enhancement seeds skipped (1)

- beacon-angelis-deathwatch-support-deathwatch: detachment deathwatch-support is ambiguous across adeptus-astartes, black-templars, blood-angels, dark-angels, imperial-fists, iron-hands, raven-guard, salamanders, space-wolves, ultramarines, white-scars

## Unresolved enhancements in dump (no unambiguous repo detachment)

- beacon-angelis-deathwatch-support-deathwatch

