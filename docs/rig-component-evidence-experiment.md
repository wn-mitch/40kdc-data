# Rig component-evidence experiment

## Decision

**Run a bounded, read-only comparison. Do not implement a new authoring stage, registry, ontology, UI, or promotion path.**

Rig already retains intermediate evidence. The unproven benefit is whether independently reviewed, source-bound component occurrences are safer and cheaper to reuse than Rig's retained architecture, decomposition, `NeedsSchema`, and review artifacts.

## What this is testing

Three separate claims must not be conflated:

1. **Durable decomposition** already exists in Rig.
2. **Accepted occurrences inside incomplete claim sets** already exist in the current claim graph.
3. **Useful, lower-cost cross-ability reuse before whole-ability convergence** is unproven.

Only the third claim justifies new work.

## Existing boundaries

| Boundary | Existing behavior | Experimental rule |
|---|---|---|
| Durability | Rig retains CAS evidence, architecture, decompositions, rejected proposals, reviews, and honest `NeedsSchema` results. | Compare against those intermediates, not an empty baseline. |
| Full acceptance | Rig requires exact coverage of every mechanical clause for an accepted ability. | An occurrence may be reviewed while whole-ability coverage remains incomplete. |
| Registry promotion | Only `Converged` abilities from `CloseVerified` campaigns become promoted members/templates. | Do not change promotion. |
| Claim graph | Accepted occurrences can coexist with open residuals. | Use existing claim, evidence, review, and unresolved-item primitives. |
| Construction authority | Incomplete claim sets cannot authorize retrieval or representation. | Keep this gate unchanged. No partial evidence authorizes DSL, a patch, or runtime behavior. |

Automatic validator acceptance establishes eligible evidence binding, not independent semantic interpretation. The experiment requires an independent source reviewer.

## First set

Freeze source bytes, provenance, current DSL snapshots, schema/adapter versions, Rig artifact identities, reviewer contract, and decision rubric for:

1. `adeptus-mechanicus/noospheric-transference`
2. `chaos-space-marines/experimental-augmentations`
3. `drukhari/combat-drugs`
4. `chaos-daemons/daemonic-allegiance`
5. `chaos-space-marines/daemonic-allegiance`
6. `aeldari/battle-focus`
7. `grey-knights/channelled-force`
8. `adepta-sororitas/ministorum-sermon`

The first five are the executed v23 Rig stress worklist. They retain different degrees of usable architecture and decomposition, so the experiment must compare directly with that material.

## Second set

Freeze this held-out set before first-set review:

- `world-eaters/blessings-of-khorne`
- `adeptus-mechanicus/battle-protocols`
- `adeptus-mechanicus/doctrina-imperatives`
- `adeptus-custodes/martial-mastery`
- `grey-knights/attuned-onslaught-psychic`
- `grey-knights/warrior-strategist`

Treat source omissions as `incomplete_source`. Do not fill absent source mechanics from authored DSL.

## First-set procedure

For each ability:

1. Read the entire frozen source once for context and unexamined regions.
2. Extract bounded semantic occurrences, not a complete AST.
3. Bind each occurrence to its leaf span and every relevant contextual span.
4. Separate the fixed pattern, occurrence-specific parameters, and enclosing obligations.
5. Obtain independent source review: accept, reject, or leave proposed, with rationale and a boundary example.
6. Record all unexamined, ambiguous, unsupported, contradictory, and incomplete-source content as explicit residuals.
7. Freeze the resulting packet before work begins on the second set.

Unsupported parent representation is not the same as unknown parent meaning. A conditional effect may be accepted if its source meaning is clear even when no DSL parent can represent it. If unresolved parent semantics change whether the effect occurs or whom it affects, the occurrence remains proposed.

## Minimal artifact

Use existing private claim-graph primitives only:

- source snapshot and `claim-origin`
- extraction identity and independence group
- `semantic-claim`, `claim-occurrence`, and `claim-assertion`
- exact source-span evidence bindings
- independent `claim-review-decision`
- `unresolved-item`
- an incomplete `claim-set`

Each occurrence must preserve actor, beneficiary, target, option/branch, parameters, condition, timing, duration, scope, exclusions, and dependencies where relevant.

If the existing proposition contract cannot faithfully preserve required context, record `ontology_gap`. Do not create a new fragment type to make the pilot pass.

The artifact must never imply:

- complete source coverage;
- whole-ability fidelity;
- valid DSL;
- a patch authorization;
- runtime authority.

## Controlled second-set comparison

Run all held-out abilities through three arms with identical source access, output requirements, and review standards:

| Arm | Available first-set material |
|---|---|
| Fresh narrow analysis | None. Performs the same bounded evidence task. |
| Rig-intermediate reuse | Existing evidence, architecture, WHO/WHEN/WHAT, `NeedsSchema`, proposals, and review artifacts. |
| Reviewed-occurrence reuse | Frozen reviewed occurrences, residuals, negative boundaries, and context. |

Every arm reads the held-out source and verifies its own parameters and context. A precedent may avoid re-deriving an established pattern or exclusion; it cannot transfer authority to a new source occurrence.

Use fresh model sessions and counterbalanced independent reviewers. Blind adjudication compares the three outputs.

For every reuse decision, record:

- cited precedent;
- exact match, substitution, or rejected match;
- checked parameters and context differences;
- residual obligations;
- reasoning step actually avoided;
- resulting human decision.

Measure source reading, extraction, lookup, rechecking, review, corrections, model work, and adjudication. Report both second-set marginal cost and first-plus-second-set total cost.

No arm assembles a full DSL ability. Savings must not come from skipping whole-ability gates.

## Predeclared success criteria

The pilot succeeds only if all conditions hold:

1. At least two hard first-set abilities yield independently accepted, context-complete occurrences while whole-ability coverage remains incomplete.
2. At least one positive pattern and one negative boundary survive adjudication. Shared keywords alone do not count.
3. Zero accepted errors in actor, beneficiary, option binding, weapon scope, parameter, threshold, duration, exclusion, ordering, or source identity. Zero partial-to-complete or partial-to-construction authority leaks.
4. Useful reuse appears in at least three of six held-out abilities, including one changed human decision: rejecting an unsafe match, narrowing a correction scope, or resolving a disputed parameter from cited evidence.
5. Reviewed-occurrence reuse improves median second-set active-review time by at least 20% against Rig-intermediate reuse and fresh narrow analysis, without worse correctness, missing residuals, or offsetting model work.

Count first-set packaging and independent review. If those costs are not recovered across the two sets, do not claim amortization.

## Failure interpretation

| Observed result | Actual bottleneck |
|---|---|
| Same reasoning cost in every arm | Contextual source interpretation dominates; serialization moved work. |
| Rig intermediates work equally well | Existing evidence retrieval is sufficient; no distinct stage is justified. |
| Most leaves cannot be accepted independently | Parent semantics are genuinely inseparable from leaf meaning. |
| Source gaps or binding defects dominate | Source completeness, segmentation, or provenance needs work. |
| Partial evidence helps but authoring still stalls | Parent representation, reviewer binding, family evidence, or execution reliability remains the blocker. |

## Implementation boundary

**No implementation now.**

If the pilot passes, add only the smallest missing read-only claim-tool query/export that returns selected occurrences together with source identity, independent review evidence, parent context, and unresolved obligations. If existing queries suffice, add nothing.

Do not change schema, Rig convergence, registry promotion, certified retrieval, patching, or runtime authority.
