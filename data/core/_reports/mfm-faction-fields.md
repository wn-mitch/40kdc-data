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
| blood-angels | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| chaos-knights | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| chaos-space-marines | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| dark-angels | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| death-guard | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| deathwatch | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| emperors-children | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| grey-knights | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| imperial-fists | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| imperial-knights | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| iron-hands | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| leagues-of-votann | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| necrons | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| orks | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| raven-guard | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| salamanders | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| space-wolves | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| tau-empire | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| thousand-sons | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| tyranids | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| ultramarines | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| white-scars | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| world-eaters | 0 | 0 | 1 | 0 | 0 | 0 | 0 |

## adeptus-astartes
- faction_rule_ids REVIEW: authored [combat-doctrines-adeptus-astartes, transhuman-strategist-adeptus-astartes, librarius-adeptus-astartes, special-move-types-adeptus-astartes] vs owned [combat-doctrines-adeptus-astartes]

## black-templars
- faction_rule_ids REVIEW: authored [combat-doctrines-black-templars, transhuman-strategist-black-templars, heirs-of-sigismund-black-templars] vs owned [transhuman-strategist-black-templars, combat-doctrines-black-templars]

## chaos-space-marines
- faction_rule_ids REVIEW: authored [dark-pacts-chaos-space-marines, cults-of-the-dark-gods-chaos-space-marines] vs owned [dark-pacts-chaos-space-marines]

## dark-angels
- faction_rule_ids REVIEW: authored [combat-doctrines-dark-angels, transhuman-strategist-dark-angels, the-ravenwing-dark-angels, the-deathwing-dark-angels] vs owned [combat-doctrines-dark-angels]

## orks
- faction_rule_ids REVIEW: authored [waaagh-orks, da-boss-orks, unstable-energies-orks, special-move-types-orks] vs owned [unstable-energies-orks, da-boss-orks]

## space-wolves
- faction_rule_ids REVIEW: authored [combat-doctrines-space-wolves, curse-of-the-wulfen-space-wolves, transhuman-strategist-space-wolves, sons-of-russ-space-wolves] vs owned [combat-doctrines-space-wolves, transhuman-strategist-space-wolves, curse-of-the-wulfen-space-wolves]

## world-eaters
- faction_rule_ids REVIEW: authored [blessings-of-khorne-world-eaters, pact-of-blood-world-eaters] vs owned [blessings-of-khorne-world-eaters]

## Repo faction dirs with no dump faction keyword (left as-is): 2

- aeldari
- chaos-daemons

