# MFM faction fields — DRY RUN

Fill-only reconcile of `faction_rule_ids` (all owned army rules), `parent_faction_id`
(dump faction hierarchy), and `aliases` (localized common name, additive). Authored
values are compared as sets and surfaced for review on mismatch, never overwritten. Prose untouched.

| Dir | rule-fill | rule-ok | rule-rev | parent-fill | parent-ok | parent-rev | aliases+ |
|---|--:|--:|--:|--:|--:|--:|--:|
| adepta-sororitas | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| adeptus-astartes | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| adeptus-custodes | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| adeptus-mechanicus | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| agents-of-the-imperium | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| astra-militarum | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| black-templars | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| blood-angels | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| chaos-knights | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| dark-angels | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| death-guard | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| deathwatch | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| drukhari | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| emperors-children | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| genestealer-cults | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| grey-knights | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| imperial-knights | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| iron-hands | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| leagues-of-votann | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| necrons | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| orks | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| raven-guard | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| salamanders | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| space-wolves | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| tau-empire | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| thousand-sons | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| tyranids | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| ultramarines | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| white-scars | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| world-eaters | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## adeptus-astartes
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [oath-of-moment, space-marine-chapters]

## adeptus-custodes
- faction_rule_ids REVIEW: authored [martial-ka-tah] vs owned [martial-katah]

## black-templars
- faction_rule_ids REVIEW: authored [templar-vows] vs owned [space-marine-chapters, templar-vows, heirs-of-sigismund]

## blood-angels
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [oath-of-moment, space-marine-chapters, the-sons-of-sanguinius]

## chaos-knights
- faction_rule_ids REVIEW: authored [harbingers-of-dread] vs owned [harbingers-of-dread, dreadblades, super-heavy-walker]

## chaos-space-marines
- faction_rule_ids REVIEW: authored [dark-pacts] vs owned [cults-of-the-dark-gods, dark-pacts]

## dark-angels
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [the-ravenwing, oath-of-moment, space-marine-chapters, the-unforgiven, the-deathwing]

## death-guard
- faction_rule_ids REVIEW: authored [nurgle-s-gift-aura] vs owned [nurgles-gift, pact-of-decay]

## deathwatch
- faction_rule_ids REVIEW: authored [mission-tactics] vs owned [kill-teams, oath-of-moment, space-marine-chapters]

## drukhari
- faction_rule_ids REVIEW: authored [power-from-pain] vs owned [power-from-pain, corsairs-and-travelling-players]

## emperors-children
- faction_rule_ids REVIEW: authored [thrill-seekers] vs owned [thrill-seekers, pact-of-excess]

## imperial-fists
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [oath-of-moment, space-marine-chapters]

## imperial-knights
- faction_rule_ids REVIEW: authored [code-chivalric] vs owned [bondsman, super-heavy-walker, code-chivalric, freeblades]

## iron-hands
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [oath-of-moment, space-marine-chapters]

## orks
- faction_rule_ids REVIEW: authored [waaagh] vs owned [da-boss, unstable-energies]

## raven-guard
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [oath-of-moment, space-marine-chapters]

## space-wolves
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [oath-of-moment, sagas, sons-of-russ, curse-of-the-wulfen]

## tau-empire
- faction_rule_ids REVIEW: authored [for-the-greater-good] vs owned [drones, for-the-greater-good]

## thousand-sons
- faction_rule_ids REVIEW: authored [cabal-of-sorcerers] vs owned [cabal-of-sorcerers, pact-of-sorcery]

## ultramarines
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [oath-of-moment, space-marine-chapters]

## white-scars
- faction_rule_ids REVIEW: authored [oath-of-moment] vs owned [oath-of-moment, space-marine-chapters]

## Repo faction dirs with no dump faction keyword (left as-is): 3

- aeldari
- chaos-daemons
- crimson-fists

