# MFM stratagems — APPLIED

APPLIED (first-class dump columns): `cp_cost` ← cpCost, `player_turn` ← key,
`type` ← category (fill-only), `category` ← detachmentId presence.
REVIEW ONLY (not written): `phases`, prose-derived — the structured
`stratagem_phase` table is a buggy index (Insane Bravery→charge, Holy
Avarice→command, Scriptural Prognosis→all-five), so authored phases win.
`timing` + `game_version` left authored.

| Dir | Matched | cp | turn | type fill | type conflict | category | phases (review) | repo-only |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| (core) | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adepta-sororitas | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-astartes | 42 | 0 | 0 | 0 | 0 | 0 | 1 | 79 |
| adeptus-custodes | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-mechanicus | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| aeldari | 81 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| agents-of-the-imperium | 33 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-militarum | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| black-templars | 17 | 0 | 0 | 0 | 0 | 0 | 1 | 85 |
| blood-angels | 16 | 0 | 0 | 0 | 0 | 0 | 1 | 90 |
| chaos-daemons | 45 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| chaos-knights | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 96 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| crimson-fists | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 63 |
| dark-angels | 15 | 0 | 0 | 0 | 0 | 0 | 3 | 91 |
| death-guard | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| deathwatch | 12 | 0 | 0 | 0 | 0 | 0 | 1 | 63 |
| drukhari | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| emperors-children | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| genestealer-cults | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| grey-knights | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 69 |
| imperial-knights | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| iron-hands | 8 | 0 | 0 | 0 | 0 | 0 | 1 | 69 |
| leagues-of-votann | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| necrons | 66 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| orks | 40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| raven-guard | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 69 |
| salamanders | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 66 |
| space-wolves | 10 | 0 | 0 | 0 | 0 | 0 | 3 | 92 |
| tau-empire | 34 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| thousand-sons | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tyranids | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ultramarines | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 75 |
| white-scars | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 69 |
| world-eaters | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **1260** | **0** | **0** | **0** | **0** | **0** | **17** | **981** |

## adeptus-astartes

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## black-templars

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## blood-angels

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## crimson-fists

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## dark-angels

**Phases — authored vs prose-derived (review only, NOT applied):**
- inescapable-justice-wrath-of-the-rock-dark-angels: [command,movement,shooting,charge,fight] vs [fight]
- tactical-mastery-wrath-of-the-rock-dark-angels: [movement] vs [command]
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## deathwatch

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## imperial-fists

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## iron-hands

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## raven-guard

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## salamanders

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## space-wolves

**Phases — authored vs prose-derived (review only, NOT applied):**
- eye-of-the-pack-saga-of-the-great-wolf-space-wolves: [shooting] vs [shooting,fight]
- fenrisian-ferocity-saga-of-the-great-wolf-space-wolves: [movement,charge] vs [charge]
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## ultramarines

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

## white-scars

**Phases — authored vs prose-derived (review only, NOT applied):**
- wind-swift-evasion-stormlance-task-force-adeptus-astartes: [movement] vs [fight]

Stratagems in dump with no repo match (author via faction-pack flow): 53

