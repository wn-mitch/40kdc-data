# MFM faction fields — APPLIED

Fill-only reconcile of `faction_rule_ids` (all owned army rules), `parent_faction_id`
(dump faction hierarchy), and `aliases` (localized common name, additive). Authored
values are compared as sets and surfaced for review on mismatch, never overwritten. Prose untouched.

| Dir | rule-fill | rule-ok | rule-rev | parent-fill | parent-ok | parent-rev | aliases+ |
|---|--:|--:|--:|--:|--:|--:|--:|
| adepta-sororitas | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| adeptus-astartes | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| adeptus-custodes | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| adeptus-mechanicus | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| agents-of-the-imperium | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| astra-militarum | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| black-templars | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| blood-angels | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| chaos-knights | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| dark-angels | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| death-guard | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| deathwatch | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| emperors-children | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| grey-knights | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| imperial-knights | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| iron-hands | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| leagues-of-votann | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| necrons | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| orks | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| raven-guard | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| salamanders | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| space-wolves | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| tau-empire | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| thousand-sons | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| tyranids | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| ultramarines | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| white-scars | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| world-eaters | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## adeptus-astartes
- faction_rule_ids REVIEW: authored [combat-doctrines-assault-force-adeptus-astartes] vs owned [combat-doctrines-adeptus-astartes]

## black-templars
- faction_rule_ids REVIEW: authored [templar-vows-black-templars] vs owned [transhuman-strategist-black-templars, combat-doctrines-black-templars]

## blood-angels
- faction_rule_ids REVIEW: authored [combat-doctrines-assault-force-adeptus-astartes] vs owned [transhuman-strategist-blood-angels, combat-doctrines-blood-angels]

## chaos-knights
- faction_rule_ids REVIEW: authored [harbingers-of-dread-chaos-knights] vs owned [harbingers-of-dread-chaos-knights, dreadblades-chaos-knights, super-heavy-walker-chaos-knights]

## dark-angels
- faction_rule_ids REVIEW: authored [combat-doctrines-assault-force-adeptus-astartes] vs owned [combat-doctrines-dark-angels]

## death-guard
- faction_rule_ids REVIEW: authored [nurgles-gift-death-guard] vs owned [nurgles-gift-death-guard, pact-of-decay-death-guard]

## deathwatch
- faction_rule_ids REVIEW: authored [mission-tactics-deathwatch] vs owned [transhuman-strategist-deathwatch, combat-doctrines-deathwatch, veteran-recruits-deathwatch]

## emperors-children
- faction_rule_ids REVIEW: authored [thrill-seekers-emperors-children] vs owned [thrill-seekers-emperors-children, pact-of-excess-emperors-children]

## imperial-knights
- faction_rule_ids REVIEW: authored [code-chivalric-imperial-knights] vs owned [bondsman-imperial-knights, super-heavy-walker-imperial-knights, code-chivalric-imperial-knights, freeblades-imperial-knights]

## orks
- faction_rule_ids REVIEW: authored [waaagh-orks] vs owned [unstable-energies-orks, da-boss-orks]

## space-wolves
- faction_rule_ids REVIEW: authored [combat-doctrines-assault-force-adeptus-astartes] vs owned [combat-doctrines-space-wolves, transhuman-strategist-space-wolves, curse-of-the-wulfen-space-wolves]

## tau-empire
- faction_rule_ids REVIEW: authored [for-the-greater-good-tau-empire] vs owned [drones-tau-empire, for-the-greater-good-tau-empire]

## thousand-sons
- faction_rule_ids REVIEW: authored [cabal-of-sorcerers-thousand-sons] vs owned [cabal-of-sorcerers-thousand-sons, pact-of-sorcery-thousand-sons]

## Repo faction dirs with no dump faction keyword (left as-is): 3

- aeldari
- chaos-daemons
- crimson-fists

