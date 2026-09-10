# Grey Knights DSL fidelity repair — 2026-09-04

## Scope and source provenance

This is a fidelity repair, not a damage-optimizer approximation. Twenty-four
reviewed abilities are represented, one obsolete active entry is removed, and
Prescient Redeployment uses an explicit typed historical ability-window record.
No unsupported clause is moved into new community notes. The current schema is
extended where a small reusable semantic distinction was missing; `conformance/SPEC_VERSION`
must be advanced by the integration owner.

Baseline: `a8d7ec3a4ba7e0e7f6dedf62d2f91ef8bfa61a3d` on the isolated repair
branch. The sibling raw-text file `40kdc-abilities/grey-knights.json` was inspected
at blob `b04aef93c9be16dc691964cd4f9503f7df08c11c`. Its provisional-edition
metadata does not make the older rule text current. Supplied review text is the
starting authority; raw text and current source updates resolve discrepancies.

The current MFM snapshot, version 946, was also checked directly for the
Sanctuary, Warrior Strategist, Personal Teleporters, and Venerable Dreadnought
relationships described below.

Source locators (not reproduced rule paragraphs):

* Sanctuary: the July 22, 2026, version 909 Voldus update on
  `https://www.40k.app/879/factions/grey-knights/units/grand-master-voldus/updates`,
  corroborated by the current Voldus entry and the 11e datasheet compilation at
  `https://wahapedia.ru/wh40k11ed/factions/grey-knights/datasheets.html`.
  The current effect is unit Stealth plus an incoming melee Hit penalty. The old
  requirement to lead a unit is absent; retaining it would also be a fidelity bug.
* Personal Teleporters: the datasheet still contains the post-shooting movement
  permission. The ingress exclusion follows core rule 20.04 (movement barred
  until the next Charge phase), with Deep Strike an ingress method under 24.09.
  Do not falsely attribute an explicit new exclusion sentence to that datasheet,
  or copy the separate Echojump rule into it. Core text can be located at
  `https://wahapedia.ru/wh40k11ed/the-rules/core-rules/` and the rulebook mirror
  `https://anyflip.com/fpxga/xnwm/basic/51-88`, printed pages 68–69.
  The official explanation of ingress is at
  `https://www.warhammer-community.com/en-gb/articles/m3son4il/new40k-combat-changes-shake-up-fighting-in-the-new-edition/`.
* Guardians of the Machine: the current source reduces Heroic Intervention by
  1CP. Its special use remains legal after a different unit's use and does not
  prevent a later use on a different unit in the same phase.
* Warrior Strategist: the current Grand Master and Grand Master in Nemesis
  Dreadknight datasheet entries both carry the army-shared battle-round reduction.
  An enrichment `unit_ids` list is not a substitute for actual core `ability_ids`.
* Wisdom of the Ancients: no longer the active Venerable Dreadnought rule. The
  similarly named Legends Grey Knights Dreadnought still has a historical/current
  Legends source entry, but that datasheet is not in this active core corpus.
  This repair removes the stale active enrichment record and active references;
  it does not claim that the rule vanished from every historical/Legends source.
* Prescient Redeployment: the supplied wording is corroborated by
  `https://www.40k.app/factions/grey-knights/detachments/augurium-task-force` and
  the official detachment preview at
  `https://www.warhammer-community.com/en-gb/articles/ntzalchg/grey-knights-moving-and-shaking-with-the-knights-of-titan/`.

## Mechanical claim ledger

The exact structures are checked by `tools/test/grey-knights-fidelity.test.ts`.
All 23 repaired entries are explicitly selected from the faction file for the
shared effect-translation corpus; global duplicate-id resolution cannot substitute
another faction's copy. Generated descriptions are in
`conformance/effect-translation/cases.json`, case ids `grey-knights-fidelity/*`.

| Ability id | Disposition | Preserved claims and structural witnesses |
|---|---|---|
| dauntless-champions | fixed-existing-schema | Friendly Paladin unit selected to fight; per-attack S<T; melee Wound +1; current attack sequence only. |
| attuned-onslaught-psychic | fixed-existing-schema | Charge completion; bearer-unit member **models** with PALADIN SQUAD; melee D+1; turn duration. Attached Leaders lacking that model keyword do not qualify. |
| blessing-of-the-omnissiah | fixed-existing-schema | Own Command phase; optional single friendly GK Vehicle model within 3 inches; D3 healing then Hit +1; next own Command start expiration; separate bearer phase use and army-shared per-target turn cap. |
| guardians-of-the-machine | fixed-existing-schema | Enemy charge completion; enemy within 6 inches of bearer's unit and engaged with friendly GK Vehicle unit; optional Heroic Intervention cost reduced by 1CP plus only its different-unit repeat exception. |
| techmarine | fixed-existing-schema | Bearer model within 3 inches of a friendly unit having both GK and Vehicle keywords; self Lone Operative while true. |
| force-edge-psychic | fixed-existing-schema | Melee attacks of models in the unit; target neither Monster nor Vehicle; AP improved by one, without an invented Fight-phase gate. |
| champion-of-the-order-of-purifiers-psychic | fixed-existing-schema | Leading condition; A+1 only on Purifying Flame weapons of models in the led unit. |
| might-of-titan-psychic | fixed-existing-schema | Optional Fight-phase start; one battle use per model; this model's melee A+3 AND S+3; phase expiration. |
| warrior-strategist | fixed-existing-schema | Own unit targeted by a Stratagem; optional one army-shared use per battle round; that use costs one CP less before payment, never a refund or a set-to-zero. |
| surge-of-wrath-psychic | fixed-existing-schema | This model's melee attacks against Monster OR Vehicle targets; optional any-result Hit, Wound AND Damage rerolls. |
| sanctuary-psychic | fixed-existing-schema | Current unconditional unit Stealth AND incoming melee Hit -1; no obsolete leading condition. |
| hammer-aflame-psychic | fixed-existing-schema | Optional fight selection; one enemy engaged with bearer's unit; one D6 with complete bands: 1 none, 2–3 one mortal, 4–5 D3, 6 D3+3. |
| personal-teleporters | fixed-existing-schema | After own shooting sequence; unengaged and no ingress this turn; optional Normal move up to 6 inches; only actually moving causes the remaining-turn charge prohibition. |
| indomitable-spirit-psychic | fixed-existing-schema | This model can shoot AND charge after Advance OR Fall Back. |
| righteous-persecution | fixed-existing-schema | After own shooting; one enemy hit in that bound sequence, excluding Monster/Vehicle; pinned plus M-2 AND Charge -2; next own turn start expiration. |
| sanctity-of-purpose | fixed-existing-schema | Target not in objective range: mandatory Wound ones; target in objective range: any-result Wound reroll replaces the baseline. |
| sanctifying-ritual-psychic | fixed-existing-schema | Own Command-phase end; unit in range of the SAME friendly-controlled objective; sticky retention until opponent has greater Level of Control at a phase end. |
| guidance-of-the-ancients-psychic | fixed-existing-schema | After own shooting; designate one enemy hit in that sequence; Hit +1 for each friendly **GK attacking model** against it; phase duration. |
| wisdom-of-the-ancients-aura | removed-obsolete | Removed from active enrichment and datasheet references; historical share-index slots remain append-only. |
| litanies-of-sanctity | fixed-existing-schema | Optional start of any phase; one use per battle per bearer; one friendly GK Battle-shocked unit within 12 inches; remove Battle-shock. |
| prescient-redeployment | fixed-new-history-shape | Second battle round onward at own Movement-phase start; optional one current on-battlefield friendly GK unit to Strategic Reserves only if Gate of Infinity had unused capacity at the end of the opponent's previous turn and that candidate was eligible in that same past window. |
| channelled-force | fixed-existing-schema | Friendly GK unit selected to fight; optional actual Leadership test at current Ld; on pass choose Sustained Hits 1 OR Lethal Hits, only Psychic melee weapons; phase duration. |
| hallowed-ground | fixed-existing-schema | Own deployment always; continuous 6-inch Purifier-unit areas; separate >=half objective phase-start snapshots for NML/opponent deployment; phase expiry; GK melee or visible ranged attacks; Hit ones upgraded to any-result for Purifiers OR whole-unit membership. |
| fury-of-titan | fixed-existing-schema | Friendly unit actually set up by Deep Strike; Hit ones AND Wound ones; expires this turn, not the next turn after Rapid Ingress. |
| searing-soulflame | fixed-existing-schema | Enemy selected by friendly Purgation Squad's Righteous Persecution; actual Battle-shock test with roll -1; source unit and selected enemy are different roles. |

`fixed-existing-schema` means fixed in the resulting current schema. Some rows use
extensions implemented by this same change; it does not claim all shapes existed
in the baseline schema.

## Reusable extensions and nearest corpus patterns

* Model membership: `for-each-unit.selector.member_of:"bearer-unit"`, restricted
  to friendly `target_kind:"model"`. The existing Ork `powers-of-da-waaagh-wurrband`
  model iterator is the near example; membership is the missing conjunct, not a
  whole-unit keyword predicate. Nested `target:"unit"` binds to the selected model.
* Selections: `reference` identifies model versus unit distance origin;
  `selection_limit` keys a recipient counter by army, ability, target and period.
  Healing families include `master-of-mechanisms`, `omnissiah-s-blessing`,
  `clever-know-wots`, and `divine-miracle-sanctuary-guardians`. They are reuse
  candidates, not additional abilities silently rewritten by this repair.
* Cost: `decrease` with `amount` and `triggering-stratagem-use`. Existing cost-tax
  leaves are the arithmetic family; `rites-of-battle` is a candidate for current
  source review. Named repeated-target permission is distinct from both the tax
  leaf and `the-lord-s-will`'s Battle-shock targeting exception.
* Cross-ability selection: `ability-target-selected` and closed `source_ability`
  identify the named selecting ability, its owner and source-unit keywords.
  Reference validation resolves the source id. `stratagem-targeted` binds one
  Stratagem use, without spending/refunding CP as a surrogate.
* Tests and empty outcomes: `dice-gated.test` identifies an actual Leadership
  test; `no-effect` provides an honest miss band. `the-betrayer` supplies the near
  current-Ld dice gate, but an arbitrary 2D6 comparison is not itself a test.
* Exact predicates: same-unit conjunctive proximity keywords and subject;
  objective subject/control on one marker; target visibility to the attacking
  model; designation candidate history and per-attacker-model keyword filters.
* Consequences: `movement-modifier.after_move` only resolves after a move actually
  occurs; `objective-control-modifier.retake` specifies phase-end greater control;
  `re-roll.optional:false` preserves mandatory rerolls. `attack-sequence` and
  `resolution` durations do not encode a once-per-battle limit.
* Regions: reuse `power-matrix`'s typed zone snapshots and `flow-of-magic`'s consumer
  machinery. Add continuous `unit-proximity` contributions with `radius_inches`
  and `activation:{event:"continuous"}`. `consumer.attack_condition` gates both
  branches, not the independent region producer. Existing snapshot kind labels
  remain canonical; their explicit fraction/comparison are authoritative.

The TypeScript, Rust, Python and Go describers render structure only. There are
no ability-id special cases. Generic weapon and trigger rendering corrections
also improve descriptions outside this worklist; generated roster/conformance
changes are expected output changes, not unrelated hand-edited game data. This is
not represented as an orchestrated 16-agent campaign or a zero-drift campaign.
The available deterministic buff adapters fail closed on the newly bound
selection/history/model/visibility forms rather than discarding their gates.
They do not implement a full battlefield event/state simulator.

## Historical ability-window shape: Prescient Redeployment

Prescient Redeployment requires two distinct historical facts: unused selection
capacity in the relevant prior Gate of Infinity window, and whether a candidate
could have been selected in that same window. Current state is neither
substitute. The minimal typed conditions are:

* `ability-window-capacity` with a friendly source ability, the closed
  `end-of-opponents-previous-turn` locator, and
  `less-than-maximum` comparison.
* `candidate-eligible-in-ability-window` with the same friendly source ability
  and locator, evaluated as the candidate eligibility snapshot.

The current on-battlefield restriction remains a separate predicate. The four
describers render both historical facts generically; the buff adapter already
fails closed for `select-units` eligibility bindings, so Prescient does not
need an adapter approximation.

## Verification entrypoints

`tools/test/grey-knights-fidelity.test.ts` checks all 25 dispositions, 23
diagnostic description contracts, Prescient's historical capacity and candidate
snapshot distinctions, model/weapon/target/timing constraints, negative schema
cases, source references, faction-local same-ID routing, and fail-closed buff
adapters. Five synthetic conformance cases cover no-op results, a model
Leadership test with failure, friendly selected targets, variable weapon
characteristics, and non-attack rolls.

Run `just regen`, `just fmt`, stage the intended generated artifacts, then
`just preflight` to prove repeatable regeneration and the normal language suites.
Build the release Rust and Go runners before the six pairwise corpus replays in
`.github/workflows/parity.yml`; use that workflow's deterministic normalization
and combat fuzz commands as well. Validation results belong to the run logs and
final repair report, not an unverified assertion in this document.
