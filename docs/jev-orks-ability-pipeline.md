# JEV → Ork ability pipeline (master)

Source text in, DSL out, with a fidelity check that attributes any gap to either the
authored record or the describer. This is the working reference for the Ork pass.

Source prose lives in `_private/jev-orks/` (gitignored), so this document cites ability
ids, counts, hashes, and field names only — never rule text.

## Where it stands

The Ork corpus is fully examined. Of the 245 abilities with source text, 12 form the
supervised cohort, 15 are a legacy cohort examined before slicing existed, and the
remaining 218 are the slice pool — 15 slices of 15, the last of 8. The **build** half
works end to end: every ability yields confident, source-bound claims. The gap is
**construction**, and it is structural rather than a matter of tuning.

| Measure | Value |
| --- | --- |
| Ork abilities with source text | 245 (12 supervised + 15 legacy + 218 sliced) |
| Slices recorded | 15 / 15 (14 × 15, then 8) |
| Question banks / cached responses | 245 banks / 3,439 response files |
| Claims proposed | 13,065 (min 11, max 119, mean 53.3 per ability) |
| Candidates **constructed** | 47 (9 accepted, 38 verification-rejected) |
| Candidates **incomplete** | 198 |
| Round-trip buckets (245) | divergence 146, delegated 97, declared-approximation 2 |
| Two-leg localiser (33 adjudicated) | exact 20, consistent 29 (see Stage 6) |
| Repeatability | 1 ability × 3 runs: selection and construction stable, distribution not |
| Observed cost | $0.294 of cache — 7,003,878 in / 2,046,149 out; budget $2 |

Construction is no longer the whole gap. The four hand-written pilots remain
(`bomb-squig`, `try-dat-button-dread-mob`, `waaagh-banner`,
`where-dya-fink-youre-going-da-big-hunt`), and the family registry adds 43 more from the
generic slots; the remaining 198 candidates each name the slot that blocked them.

## Pipeline

### Stage 0 — source state

`_private/jev-orks/source-corpus.json` holds per-faction ability source text. For each
ability a **state** is assembled at `_private/jev-orks/source-state/<ability>.json` with
the keys `ability`, `hierarchy`, `entity_context`, `literal_candidates`, `source_text`.

State is the TypeSafe sense of the word: the fixed context a typed question is evaluated
*against*. Nothing interpretive is pre-computed into it.

### Stage 1 — extraction

`extractionQuestions` asks eleven classification slots in one packet:

```
composition  primary_effect  has_condition  has_deliberate_choice
has_keyword_eligibility  has_multiple_effects  has_random_resolution
has_target_selection  has_trigger  has_usage_limit  likely_ontology_gap
```

Every answer carries a probability, and the probabilities are the point — they are what
the closure and acceptance gates read. `composition` and `primary_effect` together are
the **family** the constructor dispatches on, so both vocabularies are frozen to the DSL's
own effect partition (`CANONICAL_EFFECT_LEAVES` / `STRUCTURED_EFFECT_NODES`) and a test
derives them from `effect.schema.json`, so the classifier can never emit a label the schema
does not define. See N1c for the drift this closed and what it did not fix.

### Stage 2 — decomposition and refinement

`decompositionQuestions` / `genericDecompositionQuestions` / `genericRefinementQuestions`
open recursive question packets, one per unsettled slot, bounded at roughly three stages
and steered by `decompositionEvidence`, `slotEvidence`, `slotOf`, and `leafSettled`.

Closure is evaluated **per slot, not per question** — see Design law 1, which is the
single most expensive thing the experiment learned.

The generic packet asks four semantic slots (`semantic_subject`, `semantic_timing`,
`semantic_duration`, `semantic_structure`), the two effect-recipient slots
(`recipient`, `turn_is_your` / `turn_is_opponent`), the gated slots (`trigger_event`,
`condition_relation`, `selection_*`, the per-effect slots), and one **literal-role**
question per integer, die, distance, and named keyword in the source. A slot that comes
back unsettled is refined into one proposition per option, and those propositions are what
`readSlots` reads.

The named-keyword list comes from the dataset: `keywordCatalog()` reads every
`data/core/*/units.json` for its `keywords` and `faction_keywords` (985 keywords) and
`literals()` matches them against the source longest-first. It was a hard-coded
seven-entry literal, which silently capped every keyword gate the source states in any
other keyword.

### Stage 3 — claims

`claimsFromResponse` turns settled answers into claims, written to
`_private/jev-orks/claims/<ability>.json`:

```json
{
  "id": "eb4b5ea6…0e730",
  "ability_id": "adrenaline-junkies-kult-of-speed",
  "question_id": "composition",
  "predicate": "jev.composition",
  "value": "conditional",
  "probability": 0.56,
  "selected": true,
  "source_digest": "063bbe2c…b1572",
  "state": "proposed"
}
```

`source_digest` binds every claim to the exact source revision it was read from, so a
claim cannot silently outlive the text that justified it.

#### Reading a claim set

`readSlots(claims)` turns a claim set into one reading per slot — the vocabulary the
family registry reads. A refined slot is read from its propositions; an unrefined one
from its own answer. Two rules matter:

- **A confident false is an answer, not a blank.** Proposition slots (`turn_is_your`,
  `selection_requires_visibility`) carry `["true"]` only when settled true; otherwise the
  slot's value is "the rule does not state this", and it is not reported as a blocker.
- **A slot whose affirmative never clears the threshold is read by selection.** The
  negative propositions settle while the affirmative sits in the ambiguous band, which is
  the ordinary shape of a slot whose options co-occur in one clause. The reading carries
  the leading option with its probability and is marked `selected`, so the constructor
  reads the selection rather than the threshold and reports how thin the support was.
  Below `SELECTION_FLOOR = 0.5` there is no leading candidate and the slot stays
  `undetermined`.

### Stage 4 — construction

`constructCandidate(abilityId, current, claims, state)` produces
`_private/jev-orks/candidates/<ability>.json` with either

- `constructed` — a candidate effect tree plus `consumed_claim_ids`,
  `unconsumed_claim_ids`, and `findings` (a candidate may carry findings: a thin
  reading, or a slot answered by its leading option, is reported rather than hidden), or
- `incomplete` — the claims it managed to consume plus one finding per blocking slot.

Dispatch is a **registry keyed by the family**, the `(composition, primary_effect)` pair
the classifier already emits:

```ts
const FAMILY_CONSTRUCTORS = new Map<string, FamilyConstructor>();
for (const [effectKind, build] of Object.entries(EFFECT_BUILDERS)) {
  for (const composition of WRAPPING_COMPOSITIONS) {          // leaf | conditional | selection
    FAMILY_CONSTRUCTORS.set(`${composition}/${effectKind}`, …);
  }
}
```

Four effect builders (roll-modifier, stat-modifier, keyword-grant, mortal-wounds) × three
compositions = **12 registered families**, covering the families the generic slots can
actually determine. `registeredFamilies()` is the contract.

A constructor authors only what a settled slot determines, and reports the rest:

- an effect slot that settles no value (`effect_stat: other does not name a modifiable
  characteristic`), or a role no integer claims (`modifier-value: no integer is settled
  as the modifier magnitude`);
- a `conditional` whose condition compiles to no operand;
- `has_multiple_effects` when the source states several effects and the family composes
  one — **the flattening guard**: emitting the single effect the family understands would
  change play, not wording;
- a mortal-wound test that cannot be assembled (`test-roll` dies or `threshold` integers
  that do not resolve to exactly one each), because dropping the gate flattens randomness.

The four supervised abilities keep their ability-id constructors as an override, tried
first: they are asked per-ability question packets rather than the generic slots, so a
family constructor would report every slot blocking for them.

Everything else still reports
`unsupported family: composition=<c>; primary_effect=<p>; ontology_gap=<g>` — now against
136 abilities instead of 241.

### Stage 5 — verification and acceptance

A verification pass asks the aggregate question, four preservation propositions
(`preserves_effects`, `preserves_conditions`, `preserves_quantities`,
`preserves_recipients`) and four defect probes against the constructed candidate.

Acceptance at `ACCEPTANCE_CONFIDENCE = 0.8`: the **aggregate** must be confident, no
defect probe may be confidently asserted, and no preservation proposition may be
confidently denied. The atomic propositions are **vetoes, not conjunctive requirements** —
requiring every one of up to thirteen to clear the threshold measures how many questions
were asked rather than whether the candidate is right (design law 1), so an unconfident
proposition is "don't know" and decides nothing.

### Stage 6 — round-trip fidelity

Two independent instruments, deliberately different in kind.

**Fact report** (`round-trip-report.ts`) — `facts` / `factDiff` over rendered text versus
source text, scored with `jaccard` and `cosine`, classified by `defectClasses` into
buckets `divergence` / `declared-approximation` / `delegated`.

**Two-leg localiser** (`jev-round-trip.ts`) — asks JEV literal propositions about each
end of the pipeline and attributes the fault:

- **Leg one** — source text versus record. It is given the source and the record's
  mechanics, and **not** the rendered prose: the prose is leg two's candidate, and letting
  leg one see it attributes a prose defect to authoring (measured on
  `never-too-busy-to-fight` and `sneaky-gitz`, whose records are right and whose renders
  are wrong).
- **Leg two** — record plus rendered prose. A failure here is a describer defect.

A proposition that does not clear the threshold splits in two, and the split is the
instrument:

| proposition | meaning | effect on the leg |
| --- | --- | --- |
| confidently true (`>= 0.8`) | the claim holds | none |
| **refuted** (`<= 0.2`) | the model denies it | the leg is **faulted** |
| mid-band | don't know | the leg is **unproven**, not faulted |

`randomness_preserved` is gated out of the packet entirely when the source states no die
(`state.literal_candidates.dice` is empty), because a rule with no roll cannot fail to
preserve one — law 4 applied to the localiser. A vacuity clause was not enough: six of
eight remaining misattributions were this proposition refuting a no-dice record.

`localise(leg1, leg2)` then yields:

| leg one | leg two | verdict |
| --- | --- | --- |
| refuted | any | `authoring` — the record is wrong first, so prose graded against it is not independent evidence |
| not refuted | refuted | `describer` |
| not refuted | not refuted, either leg unproven | `unresolved` |
| proven | proven | `clean` |

A leg's **named defect** (`primary_defect`) is the diagnosis the report groups by — it is
not a verdict trigger. Five adjudicated-clean records name one with nothing refuted, so
treating it as a fault attributes a defect the evidence does not support.

Measured against the adjudicated 33 (`_private/jev-orks/round-trip-semantic-labels.json`):

| localiser revision | exact | consistent |
| --- | --- | --- |
| as inherited | 2 / 33 | 2 / 33 |
| refuted/unproven split only | 2 / 33 | 2 / 33 |
| + fault on refutation, leg-one precedence | 18 / 33 | 25 / 33 |
| + gated `randomness_preserved`, leg one blind to the prose | **20 / 33** | **29 / 33** |

Four contradictions remain, each with a named cause: `feel-no-pain-5`/`-6` refute
`every_quantity_preserved` on the two core-ability template texts; `sneaky-gitz`'s
`rule-state` encoding is correct but leg one cannot read a bespoke type's meaning from its
JSON; `thatll-learn-ya` is refuted by leg two on a render that is faithful.

### Reproducibility and cost

Requests are content-addressed — `hash({version, request})` — and responses are cached at
`_private/jev-orks/responses/<hash>.repeat-<n>.json`. A cache miss throws unless `--live`
is passed, so an ordinary run is offline and cannot silently spend money.

**Stability is barely measured.** 2,275 responses are cached, and exactly one
ability was run three times (`try-dat-button-dread-mob`). On that one, selection and
construction were identical across all three runs while the probability distribution was
not — so a gate that reads probabilities rather than selection can flip on a re-run.
Every other ability has a single recorded run, and its "identical" flags are trivially
true rather than evidence of determinism. Nothing here yet licenses trusting
`ACCEPTANCE_CONFIDENCE` as a stable boundary.

Changing the question bank invalidates the cache: the request hash covers the state and
the packet, so adding a slot or a keyword makes every affected request miss and the
offline replay fail closed. A full re-population of the 245-ability corpus after a bank
change cost **$0.113** across four passes; a re-run with an unchanged bank replays offline
in about 1.5 seconds and spends nothing.

Pricing is modelled at `INPUT_PRICE_PER_MILLION_USD = 0.042` with a scheduling reserve,
under a `--budget` ceiling. The model prices input only — the `$0.205` above is the
modelled input cost of the whole cache, not the bill.

## Design laws

Earned from the experiment, with the evidence that forced each one.

1. **Closure is per slot, not per question.** Conjunctive closure over a flat question
   list scored 1/15. Re-scoring the same answers per slot scored 12/15. Raising per-leaf
   reliability 76% → 85% while growing leaves 13 → 32 moved closure 1/15 → 0/15 — better
   answers, worse score, the signature of a gate measuring the wrong quantity.
2. **A forced choice cannot describe a multi-valued or unstated slot.** 5 of 6
   single-choice slots produced mid-band answers by construction; `condition_relation`
   failed 11 of 15 abilities because its predicates co-occur in one source clause.
3. **Derive absence; never ask for it.** `semantic_duration=none` was ambiguous in 8 of 15
   abilities, and the last remaining blocker after 12/15 was a negation-flavoured boolean
   (`controller_choice_present`) sitting at 0.53–0.59. Omitting the question and deriving
   the field from clause structure closed all 15.
4. **Gate generation on confident answers only.** `has_trigger` at 0.51 spawned a
   `trigger_event` slot whose emptiness then counted against closure.
5. **Slots are per clause.** `semantic_subject` held both `this-unit` and `selected-unit`
   in the ambiguous band for 6 of 15 abilities. Selection sentences and effect sentences
   have different subjects, so one per-rule slot cannot hold the value. *Partially
   repaired: `recipient` now asks the effect's recipient separately, and the selection
   composition reads its own subject from `selection_owner`.*
6. **A fact the source can stay silent about must be asked as a proposition.** `turn_owner`
   as a forced choice over `{your, opponent, either}` cannot answer "the source states no
   turn at all", which is law 2's structural objection. It is asked as two propositions
   (`turn_is_your`, `turn_is_opponent`) instead, each with silence spelled out as its false
   case.
   *The evidence first recorded here was wrong and is corrected:* the original claim was
   that the forced choice "produced a turn gate the independent authored records did not
   have 35 times against 2 omissions". Those records are **not** ground truth for their own
   sources. Spot-checking the seven residual cases shows every one of them states
   "your … phase" in the source while the record carries only the phase gate:
   `dakkablitz`, `strafing-run`, `deff-from-above`, `kustom-dakka-shoota-boyz`,
   `blitz-dem-gitz`, `ere-we-go-green-tide`, `fungus-fuel-injection-war-horde`. The
   count is also not small: **of the 114 Ork records whose source mentions a turn, only 29
   encode a turn gate.** The compiler was correcting the corpus, not over-asserting.
   Two real defects did sit in this area, and both are fixed: a refined proposition could
   be *promoted to a settled value by the leading-option fallback* (a 0.52 "truth" became a
   turn gate on `headwoppas-killchoppa-war-horde`), and refinement re-asks a proposition as
   itself. A proposition now has no leading option to fall back to.
7. **A constructor that cannot refuse will flatten.** The first registry pass authored the
   one effect its family understood for rules the classifier called multi-effect, and
   dropped the dice-gate in front of mortal wounds. Both are `flattened-randomness` — the
   highest-severity class, because collapsing a table or a test changes play rather than
   wording. Both were caught by diffing candidates against the independent authored
   records, **not** by the round trip. Declining with a named reason is part of the
   contract.
8. **Extraction is a prerequisite of construction, not a sibling stage.** Three of the four
   blockers that survived the registry were extraction gaps the DSL could already express:
   the keyword vocabulary was a seven-entry literal rather than the dataset's 985 keywords;
   turn ownership was never asked; the effect recipient had no slot. Construction quality
   cannot exceed the question bank, so a family's blockers are a question-bank worklist
   first and an ontology decision only when the DSL genuinely cannot say it.

## Next steps

Ordered by how much of the corpus each unblocks.

### N1 — Replace per-ability constructors with a family registry — **done**

The registry is in place: 12 families keyed by `(composition, primary_effect)`, each
reading the shared slots, each returning per-slot findings. Construction went from **4 to
44** candidates (8 accepted, 36 verification-rejected), all schema-valid.

### N1b — Close the extraction gaps the registry exposed

**P0.** Abilities that land in a registered family and still fail to construct, with what
is left:

| Abilities | Blocker | Where the fix lives |
| --- | --- | --- |
| 14 | condition compiles to no operand although `has_condition` is 1 | `condition_relation` (law 2) — the largest remaining class |
| 10 | `recipient: no settled recipient` — every option below the coin-flip floor | `recipient` wording, or a per-clause split |
| 9 | `semantic_timing: no settled option` | `semantic_timing` |
| 9 | refused: `has_multiple_effects` (correct refusal; needs a multi-effect composer) | new composition |
| 6 | `modifier-value` — no integer claims the magnitude | integer-role question |

**Done in this round, both from measured blockers:** a `roll_subset` slot
(`reroll_subset_is_ones`, a proposition, because a forced choice cannot say "there is no
re-roll here") now lets `roll-modifier` emit the `re-roll` effect type its own subset of 8
abilities needed; and `selected-unit` was missing from the recipient→target mapping, which
blocked 34 abilities and *misreported* them as "no settled recipient". The remaining
classes are the same forced-choice disease as law 6, so the fix is a question-shape change,
not a threshold move.

### N1c — Register the `ability-grant` families

**P0 — and the measurement moved the fix upstream twice.**

81 abilities are still `unsupported family`, 75 of them `*/ability-grant`. The payload
question ("delegate the grant, or derive it?") is the wrong one: only **7 of the 75 records
are literally `ability-grant`**. 40 are a `conditional` wrapping a real leaf (10
`ability-grant`, 8 `keyword-grant`, 7 `sequence`, 4 `re-roll`, 3 `select-units`, 8
singletons), 10 more are a bare `sequence`, 4 `keyword-grant`, 4 `movement-modifier`, 2
`stat-modifier`, and the rest singletons. `primary_effect=ability-grant` is correct for
about 17 of them.

#### The vocabulary drifts from the schema in both directions

`composition` and `primary_effect` are hand-written option sets. Checked against
`effect.schema.json`'s own partition (62 canonical `single-effect` leaves after excluding
the four declared migrations, 26 structured nodes, zero overlap):

| classifier label | status |
| --- | --- |
| `composition`: `conditional`, `sequence`, `choice`, `dice-table` | real nodes |
| `composition`: `leaf`, `other` | meta-values ("no wrapper", "none of the above") |
| `composition`: `selection`, `dice-count-choice` | **not schema types at all** (the nodes are `select-units`, `dice-pool-allocation`) |
| `composition` missing | 14+ real nodes the corpus uses, incl. `for-each-unit`, `aura`, `designate-target`, `movement-modifier`, `dice-gated`, `rules-bundle`, `no-effect` |
| `primary_effect`: `roll-modifier`, `stat-modifier`, `keyword-grant`, `ability-grant`, `hazard-rolls`, `mortal-wounds` | canonical leaves |
| `primary_effect`: `restriction` | **neither a leaf nor a node** — the schema has `attack-restriction`, `targeting-permission`, `fight-eligibility-extension` |
| `primary_effect` missing | 56 of the 62 canonical leaves |

`CANONICAL_EFFECT_LEAVES`, `STRUCTURED_EFFECT_NODES` and `LEGACY_EFFECT_ALIASES` freeze the
schema's partition, and a test derives both lists from `effect.schema.json` and asserts
that every label the classifier can emit is a node, a canonical leaf, or a meta-value. A
schema change now fails the suite instead of widening the drift.

The three invented labels were replaced with real ones (`selection` → `select-units`,
`dice-count-choice` → `dice-pool-allocation`, `restriction` dropped) and the corpus
re-run. Construction went **44 → 47**, registered-family abilities **109 → 111** — and
`conditional/ability-grant` went **up**, 54 → 59.

#### What that tells us

`ability-grant` is a *semantic* label competing with structural ones, so it absorbs
whatever the structural vocabulary cannot name: with `restriction` removed, five of its
abilities moved to `ability-grant` rather than to a leaf. Correcting the labels is
necessary but not sufficient — the vocabulary has to grow the nodes the corpus actually
uses before the attractor loses:

| node the classifier cannot name | corpus uses |
| --- | --- |
| `dice-gated` | 34 |
| `movement-modifier` | 15 |
| `rules-bundle` | 4-6 |
| `aura`, `for-each-unit`, `designate-target`, `no-effect` | 2-6 each |

#### The vocabulary has to grow with its builders

Adding the six structural nodes the corpus uses but the classifier could not name
(`movement-modifier`, `aura`, `for-each-unit`, `designate-target`, `rules-bundle`,
`no-effect`) did shrink the semantic attractor exactly as predicted —
`conditional/ability-grant` **59 → 49**, `conditional/other` **22 → 14** — and cost 9
constructions (47 → 38), because those rules relocated into labels that have no builder.
**Reverted.** The rule this earns: a vocabulary value is only added once a family can
consume it, one node at a time, measuring each.

`dice-gated` looked like the exception, because it *has* a builder — the gate assembly the
mortal-wound compiler already used, extracted into `diceGate()`/`gated()`. Isolated by
removing only the vocabulary value and diffing per ability: **six abilities change status —
one gained, five lost.** Four of the five that stop constructing have **no die in their
source at all**, and none has a `dice-gated` node in its authored record, so they are
mislabels the new value induced rather than flattened candidates. **Reverted**; the helpers
stay, because the mortal-wound guard uses them.

So the lesson is wider than builder availability: **a new vocabulary value costs coverage
whenever the classifier over-applies it**, whether or not a builder exists. Both
experiments lost coverage for exactly that reason — the six builder-less nodes by
relocating rules into unbuildable labels, `dice-gated` by mislabelling five rules that are
not die-gated. The vocabulary only grows where a value's *application* can be measured as
neutral-or-better, and the measurement has to be per-ability, not an aggregate: the first
draft of this section claimed the four lost constructions were flattened randomness, and
the per-ability diff refuted it.

#### The vocabulary is an escape rope, not a partition

Registering an `ability-grant` family was attempted from the last run's artifacts and
abandoned before any code — and the measurement reframes *why*. The 380 `grant_type` slugs
are not a vocabulary the payload slot fails to address; they are largely not a vocabulary
at all:

| measure | value |
| --- | --- |
| distinct `grant_type` slugs | 379 (593 uses) |
| slugs used **exactly once** | **321 (84%)** |
| distinct `ability_id` grants | 32 (291 uses, ~9 uses each) |
| `grant_type` slugs that are *also* an ability id in the dataset | **19** |

The last row needs care, and a first reading of it was wrong. Those 19 are **not** invented
labels: `stealth` (8 uses) is granted by rules like Harbingers of Dread, `deep-strike` (4)
by Fury From The Délve and Fire Riders, and `battle-focus` by Shepherds of the Dead as a
friendly-within-aura grant — every one is a rule granting an ability that exists as an
entity, which is exactly the pattern an aura like the Venomthropes' Stealth is meant to
express. The defect is not the label. It is that **the schema has no field for it**:
`#/$defs/grant-type` is a **379-value closed enum with no description** (it records usage
rather than modelling it), the `ability-grant` branch declares only `grant_type`, and
`modifier.ability_id` — used 130 times — is undeclared but permitted, so it is never
validated against the dataset and never resolved.

So the honest statement is three-part, and none of it is mechanical:

1. **Declare and validate the reference form.** Add a modelled field for "grants the ability
   with id X" (resolving in the same faction, like every other `ability_id` reference) and
   re-encode the 19 that fit — they are the *best-aged* part of the vocabulary, not the worst.
2. **Work the 321 singletons** (84%) as an authoring or deletion worklist: each is either a
   real rule that should be authored in DSL or a label to drop. That is the escape rope, and
   the singleton list is the worklist.
3. **Then** an `ability-grant` family has a small honest vocabulary to consume, and the
   objection that a builder would collapse 380 meanings into six disappears.

This is N6 (authoring-and-deletion) plus a small schema addition — not a question-shape
change, and not a bulk re-encode.

### N1b-ii — `condition_relation` is asked, answered, and never read

**P0.** The condition compiler assembles operands from five sources — `trigger_event`,
`semantic_timing`, the turn flags, `keyword` literals, and `selection-range` distances — and
**never reads `condition_relation`**. The slot is asked for every `has_condition=1` ability,
its answers are cached, and nothing consumes them, so its much-discussed ambiguous band is
irrelevant to construction.

Wiring it is not mechanical, because the relation is one-to-many against the operand
vocabulary — and that vocabulary is far larger than the schema's `const` values suggest.
Corpus usage, top operand types:

| operand | uses | operand | uses |
| --- | --- | --- | --- |
| `phase-is` | 764 | `unit-below-starting-strength` | 51 |
| `timing-is` | 401 | `unit-below-half-strength` | 49 |
| `unit-has-keyword` | 320 | `charged-this-turn` | 45 |
| `is-attached` | 286 | `disposition-matches` | 44 |
| `target-has-keyword` | 228 | `model-is-leader` | 41 |
| `player-turn-is` | 104 | `within-range-of-objective` | 33 |
| `unit-within-range-of` | 63 | `opponent-unit-within-range` | 26 |
| `attack-is-type` | 58 | `engagement-state` / `is-battle-shocked` | 23 / 22 |
| `attack-stat-compare` | 19 | `was-hit-by-attack` | 19 |

Only three of the seven relations map cleanly (`keyword` → `unit-has-keyword`, `position` →
`unit-within-range-of`, `engagement` → `engagement-state`); `state`, `target`, `comparison`
and `leadership` each fan out across many operands, and several operands need parameters the
bank does not carry (`attack-stat-compare` wants attacker stat, comparison and target stat).

**And most of the 13 blocked candidates are label errors, not payload errors.** Checked
against their authored records: `dead-brutal`, `ramshackle-but-rugged` and `special-dose`
author **no condition at all** (so `has_condition=1` is wrong), while `beastboss` authors
`phase-is` + `is-attached` and was labelled `leadership`. Only four — `hardy-bioniks` and
`spiteful-power-trip` (`attack-stat-compare`), `mobile-fortress` (`attack-is-type`) and
`nowhere-to-hide` (`target-has-keyword`) — state a condition the compiler cannot build but
could, given the operand and its parameters.

**So the lever is the label layer first.** A pass that re-asks `has_condition` and
`condition_relation` per ability against the authored clause is cheaper than an operand
mechanism that would fix four, and it is a prerequisite for one: an operand question asks
"which state predicate?" of ten abilities where no state predicate exists. Two constraints
for whenever that mechanism lands: an operand **choice** would confabulate (a forced choice
cannot say "none", per law 2), so operands must be independent propositions; and propositions
cost roughly one question per candidate operand per conditional ability.

#### `names-existing-effect` is a hint, not a migration recipe

The audit's second bucket names seven grant types that duplicate a declared effect node, which
reads as a mechanical swap. Two are, and they are done: `battle-shock-test` (13 records) and
`reactive-charge` (6). The rest are per-record contract work — `heal-wounds` (10) carries
`amount`, `models`, `trigger`, `frequency`, `requires` and `amount_if_soul_forge` across its
records, and `detection-range-modifier` (10) carries `value`, `unit`, `operation`,
`range_inches` and `target_scope`. Moving those means deciding what the node owns, one type at
a time.

Migrating `reactive-charge` also showed why the bucket is worth doing even when it is not
mechanical: the label hid **two** defects. The describer arm emitted its threshold clause
unconditionally, so a rule with no threshold rendered `?` placeholders; and the schema
*required* `charge_roll_max_after_modifiers`, though rules like Heroic Intervention state no
threshold at all. Both are fixed — the arm now takes the absent branch, and the requirement is
relaxed (widen-only; `modifier` itself is still required). Neither defect was visible while the
rule was expressed as a grant label, which is the general argument for working this list.

### N2 — Calibrate the localiser — **done for this round**

The instrument now separates *refuted* from *unproven*, faults on refutation only, takes
leg one's fault as `authoring` even when leg two also fails, gates `randomness_preserved`
on the source stating a die, and keeps the rendered prose out of leg one. Against the
hand-adjudicated 33 that moved agreement from **2 / 33 to 20 / 33 exact (29 / 33
consistent)**. The four remaining contradictions are named in Stage 6.

The labelled set itself was the first thing to fix. The 33 entries in
`round-trip-labels.json` are **lexical** — the file's own `_note` says they came from the
fact-diff report and "cannot adjudicate the semantic leg-1 verdicts" — and adjudicating
each record by hand against its source disagreed with them on **12 of 33**:

| adjudicated | n | lexical label said |
| --- | --- | --- |
| `clean` | 11 | clean 4, authoring 7 |
| `authoring` | 18 | authoring 16, clean 2 |
| `describer` | 4 | describer 2, authoring 2 |

`round-trip-semantic-labels.json` holds the adjudicated set with a defect class and a
field-level reason per ability, citing DSL field names and clause shapes only. Re-run it
whenever the leg questions change.

**Next iteration**, in evidence order: (1) leg one cannot read a bespoke DSL type's
meaning from its JSON (`sneaky-gitz`'s `rule-state`, `krushin-impetus`'s `select-units`),
so `every_effect_represented` and `adds_nothing` refute faithful encodings — give leg one
the type's own description, not the render; (2) the two core-ability templates
(`feel-no-pain-5`/`-6`) refute `every_quantity_preserved`, so either exclude template
definitions from the corpus or ask it differently; (3) one leg-two false positive on a
faithful render (`thatll-learn-ya`).

### N2b — Widen the repeat cohort before trusting any threshold

**P0.** Both gates read probabilities, and stability is measured on a single ability. Run
a representative cohort (say one per family, plus everything accepted) at three repeats
and re-derive the flags. If distributions move materially on re-run, the fix is to make
the gate read **selection** where it currently reads a probability, or to require
agreement across repeats — not to move the threshold until the flakiness hides. Cheap:
each ability's cached run costs fractions of a cent, and repeated requests are cached
under their own `repeat-<n>` files.

### N3 — Work the authoring defect queue

Counted from the **adjudicated** labels, not from the localiser's own defect field:

| defect | n | abilities |
| --- | --- | --- |
| `omitted-effect` | 5 | `fix-dat-armour-up`, `grot-assistant`, `buzzer-squigs`, `da-grand-warlords-ladz`, `makari-hoist-dat-banner` |
| `flattened-randomness` | 5 | `bomb-squig`, `drill-through`, `piston-driven-brutality`, `shooty-power-trip`, `spirit-of-gork-psychic` |
| `omitted-condition` | 4 | `dat-s-our-loot`, `get-da-good-bitz`, `splat`, `squig-mine` |
| `wrong-recipient` | 2 | `rivetin-dakka`, `roar-of-mork-psychic` |
| `invented-effect` | 2 | `too-arrogant-to-die-bully-boyz`, `try-dat-button-dread-mob` |

The lexical labels put `omitted-condition` first at 11; the adjudicated set ties
`flattened-randomness` with `omitted-effect` at the top. That reordering matters — a table
or a die test collapsed into one unconditional effect changes play, not wording, and five
of eight authoring faults of that shape are die-band tables where every band was emitted
as an unconditional step. It is also the shape the registry now refuses to emit.

### N3b — Audit the turn gates the corpus omits

**P1, and it is a data defect rather than a pipeline gap.** Of the 114 Ork records whose
source mentions a turn, only **29 encode a `player-turn-is` gate**. Spot-checking seven of
the records the compiler added a turn gate to shows the source states "your … phase" and
the record carries only its phase gate, so the constructed candidate is the more faithful
of the two. This is also what made the original design-law-6 evidence look like
over-assertion; the law is corrected above.

### N3c — Retire `disposition-matches` from ability records — **routed, not yet done**

46 ability operands use the type corpus-wide and **not one is a Force Disposition**:
`friendly` 33, `enemy` 5, `riled-up` 4, `closest-eligible-target` 2, `fell-back` 1, null 1.
Dispositions are a real dataset concept with a closed five-value vocabulary
(`take-and-hold`, `priority-assets`, `reconnaissance`, `disruption`, `purge-the-foe`) living
in mission and detachment data, so an ability record keyed on `friendly` is simply invalid.
The four misuses route as:

| misuse | home |
| --- | --- |
| `friendly`, `enemy` (38) | side is carried by `select-units.owner`, the effect `target`, and `applies_to` — most are redundant deletions, and the 71 condition operands have no side type at all |
| `closest-eligible-target` (2) | `unit-within-range-of {target_type: "closest-eligible"}`, which already exists |
| `fell-back` (1) | `fell-back-this-turn`, the missing fourth sibling of `advanced-this-turn` / `charged-this-turn` / `remained-stationary` — **queued**; `advanced-this-turn` lives in all four ports and a conformance case, so it is a schema + 4 describer + SPEC_VERSION change |
| `riled-up` (4) | see below |

#### Riled up is a named state, and the machinery already exists — scoped to regions

Riled up is a **named state applied to units whose effects are defined once and referenced
by consumers**, the same shape as a combat doctrine. The DSL already has that apparatus in
`named-region-state` = `{region_ref, producer, consumer, branch_precedence}`, with
`producer` carrying `baseline {kind, zone, activation, expiry}` and `consumer` carrying
`{state_ref, beneficiary_gate, membership {unit_scope, relation}, qualified_condition,
default_branch, qualified_branch, attack_condition}`. The Waaagh ability maps onto it
directly: the War Cry activation is the **producer** (once per battle per army, start of
the Command phase, applied to a filtered unit set, expiring at the end of the next turn),
the state's consequences are the **consumer's branches**, and membership is "carries the
state" rather than "is inside a region".

The region-specific parts are `region_ref` / `zone` / `range_to_marker_inches`. So this is
**not a new shape and not `unit-tag`** — a tag carries no effects, so every consumer would
restate the state's consequences and they would drift. It is the existing named-state
machinery with **scope widened from region to unit**. It is a schema-shape change (the same
four-port ceremony as `fell-back-this-turn`) and belongs in the shape-design process rather
than in this pipeline.

Current encodings of the state, for the re-authoring pass: granted as an opaque
`ability-grant` in 9 records, tested as `unit-has-keyword: "Riled Up"` in 5, and encoded as
`disposition-matches` in 4.

### N3d — Queued data fixes (decided 2026-09-17)

Folded into the next authoring pass rather than done standalone: the 46
`disposition-matches` misuse retirements above, and the `target-has-keyword: "A"`
corruption (52 occurrences corpus-wide, 5 in Orks) where a characteristic was read as a
keyword. Both are cross-faction data changes needing generated-artifact regeneration and
`just preflight`.

### N4 — Work the describer defect queue

Four, all adjudicated, and all the kind that gets misread as an authoring fault:

| ability | what the prose does |
| --- | --- |
| `never-too-busy-to-fight` | renders an engagement passthrough as a movement trait |
| `sneaky-gitz` | suppresses the *bearer's* Overwatch where the source restricts enemy targeting (the record's own `rule-state.direction` is ambiguous and should be re-authored too) |
| `beast-snagga-following`, `boss-of-da-hunt` | render a `keyword-grant` of Lone Operative as a weapons keyword |

`boss-of-da-hunt` also spells its selector keyword `BEAST-SNAGGA` where
`beast-snagga-following` spells `BEAST SNAGGA`.

### N5 — Repair design law 5 (slots are per clause) — **partly done**

`recipient` now carries the effect's recipient separately from `semantic_subject`, and a
`selection` composition takes its subject from `selection_owner`. The remaining work is
splitting `semantic_subject` for rules with more than one operative clause.

### N6 — Shrink the opaque-grant tail

The grant-type vocabulary is 379 entries, frozen from usage. An `ability-grant` carrying
only a `grant_type` string and no other parameter asserts a label rather than a rule: 374
of the 3,920 enrichment records corpus-wide (9.5%), and **46 of the 294 Ork records
(15.6%)**. Each removal is an authoring job, and the vocabulary is the worklist. The
Ork share being higher than the corpus average is expected — the Ork pass is the one
that surfaced them.

### N7 — Decide the family tail

Nine families have ≤3 abilities (`sequence/keyword-grant`, `dice-table/stat-modifier`,
`dice-table/mortal-wounds`, `leaf/other`, `leaf/restriction`, `selection/restriction`,
`conditional/hazard-rolls`, `dice-count-choice/stat-modifier`, `sequence/stat-modifier`).
Folding several into a generic shape may be cheaper than nine constructors; leaving them
unencoded is also defensible if the shapes are genuinely irreducible. Either way, record
the decision rather than letting the tail sit in `incomplete` forever.

## Running it

```sh
npm run experiment:jev-orks                            # replay cache, offline
npm run experiment:jev-orks -- --live --budget 2        # real calls under a ceiling
npm run experiment:jev-orks -- --slice 15               # one slice of the corpus
npm run experiment:jev-orks -- --corpus <path> --dump <path> --private-root <path>
```

The round trip is its own runner, and defaults to every ability with source text:

```sh
npx tsx tools/src/jev-round-trip.ts --live --budget 2              # all 245, two legs each
npx tsx tools/src/jev-round-trip.ts --live --ids-file _private/jev-orks/semantic-label-ids.json
```

That second form is the calibration run: `--ids-file` takes a JSON array of ability ids,
and `semantic-label-ids.json` holds exactly the 33 adjudicated abilities. After changing
any leg question, re-run it and re-score against
`round-trip-semantic-labels.json` before trusting a verdict.

Artifacts land in `_private/jev-orks/`: `source-state/`, `question-bank/`, `responses/`,
`claims/`, `candidates/`, `comparisons/`, plus the rollups `run-summary.json`,
`slice-runs.json`, `slices.json`, `design-laws.json`, `question-refinement-ledger.json`,
`round-trip.json`, `jev-round-trip.json`, `round-trip-labels.json` (lexical, from the
fact diff), `round-trip-semantic-labels.json` (adjudicated, the localiser's calibration),
`source-provenance.json`.

`_private/` is gitignored and absent from a fresh clone. Tests that need it skip rather
than fail, so the suite is green everywhere.

## Verification entrypoints

| Concern | Test |
| --- | --- |
| Construction, slices, closure, cost | `tools/test/jev-orks-experiment.test.ts` |
| Two-leg localiser and verdict attribution | `tools/test/jev-round-trip.test.ts` |
| Fact report, buckets, defect classes | `tools/test/round-trip-report.test.ts` |
| Grant-type vocabulary freeze | `tools/test/grant-type-vocabulary.test.ts` |
| Core ability catalog encoding | `tools/test/core-abilities.test.ts` |
| Rule text resolves to the right faction | `tools/test/source-provenance.test.ts` |

Reproducibility gate for any schema or data change: `just verify-regen-stable`.
