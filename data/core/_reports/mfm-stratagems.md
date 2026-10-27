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
| adeptus-astartes | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-custodes | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adeptus-mechanicus | 54 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| aeldari | 81 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| agents-of-the-imperium | 33 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-militarum | 60 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| black-templars | 17 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| blood-angels | 17 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-daemons | 46 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-knights | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 96 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dark-angels | 17 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| death-guard | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| deathwatch | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| drukhari | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| emperors-children | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| genestealer-cults | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| grey-knights | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| imperial-knights | 39 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| iron-hands | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| leagues-of-votann | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| necrons | 66 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| orks | 43 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| raven-guard | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| salamanders | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| space-wolves | 17 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tau-empire | 34 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| thousand-sons | 48 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| tyranids | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ultramarines | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| white-scars | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| world-eaters | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **TOTAL** | **1313** | **0** | **1** | **0** | **0** | **0** | **0** | **0** |

## adeptus-mechanicus

**Player-turn ← key (applied):**
- overloaded-safeguards-lords-of-the-forge-adeptus-mechanicus: either → your-turn

## agents-of-the-imperium

**Player-turn ← either over the key (the WHEN line names a phase in either turn):**
- selfless-bodyguard-imperialis-fleet-agents-of-the-imperium: key said opponent-turn

## chaos-daemons

**Player-turn ← either over the key (the WHEN line names a phase in either turn):**
- overwhelming-excess-legion-of-excess-chaos-daemons: key said opponent-turn
- from-beyond-the-veil-cavalcade-of-chaos-chaos-daemons: key said your-turn

## chaos-knights

**Player-turn ← either over the key (the WHEN line names a phase in either turn):**
- storm-of-darkness-traitoris-lance-chaos-knights: key said opponent-turn

## death-guard

**Player-turn ← either over the key (the WHEN line names a phase in either turn):**
- territorial-infection-paragons-of-putrescence-death-guard: key said your-turn

Stratagems in dump with no repo match (author via faction-pack flow): 0

