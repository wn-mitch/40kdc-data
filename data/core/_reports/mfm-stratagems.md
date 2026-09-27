# MFM stratagems — DRY RUN

APPLIED (first-class dump columns): `cp_cost` ← cpCost, `player_turn` ← key,
`type` ← category (fill-only), `category` ← detachmentId presence.
REVIEW ONLY (not written): `phases`, prose-derived — the structured
`stratagem_phase` table is a buggy index (Insane Bravery→charge, Holy
Avarice→command, Scriptural Prognosis→all-five), so authored phases win.
`timing` + `game_version` left authored.

| Dir | Matched | cp | turn | type fill | type conflict | category | phases (review) | repo-only |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| (core) | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| adepta-sororitas | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-astartes | 85 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| adeptus-custodes | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-mechanicus | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| aeldari | 81 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| agents-of-the-imperium | 33 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-militarum | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| black-templars | 93 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| blood-angels | 106 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-daemons | 46 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-knights | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 96 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| crimson-fists | 65 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dark-angels | 106 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| death-guard | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| deathwatch | 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| drukhari | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| emperors-children | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| genestealer-cults | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| grey-knights | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-knights | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| iron-hands | 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| leagues-of-votann | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| necrons | 66 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| orks | 32 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| raven-guard | 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| salamanders | 68 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| space-wolves | 102 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tau-empire | 34 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| thousand-sons | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tyranids | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| ultramarines | 77 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| white-scars | 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| world-eaters | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **2177** | **0** | **0** | **0** | **0** | **0** | **0** | **37** |

Stratagems in dump with no repo match (author via faction-pack flow): 14

