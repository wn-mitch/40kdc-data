# Progressive partial DSL pilot

## Status

Private machine experiment complete. Human source-to-render review remains pending.

No production data, schemas, describers, runtime consumers, or generated artifacts changed. The private experiment materials contain source text and must remain outside this repository.

## Question

Can an ability yield useful, faithful DSL components before every mechanic is modeled, without weakening full-ability certification or allowing unresolved details to broaden a component?

The pilot tests semantic coverage, not model confidence. A retained component must be independently true under its own retained controls. It is not an estimate of the whole ability and it is not a numerical lower or upper bound.

## Safety rule

A component is eligible only when its beneficiary, activation, applicability, magnitude, duration, usage limit, cost, and relevant consequences are fixed by the source. Any unresolved selector, condition, resource, choice, reference, cost, drawback, or parent state that can change the retained mechanic blocks that component.

In particular:

- `applies_to` is static roster highlighting, not a runtime recipient filter.
- A model-level beneficiary cannot become a unit-level beneficiary.
- A selected target, persistent designation, or named-rule dependency must remain bound.
- A choice cannot become one unconditional option.
- A movement permission remains coupled to a resulting restriction when the source couples them.
- Opaque `ability-grant` labels do not count as modeled mechanics merely because they render.

Full certification remains unchanged: a complete ability must still pass schema validation, canonical-key checks, and the existing faithful verifier gate. Partial review does not set `final_faithful`.

## Frozen cohort

The cohort contains 36 current, faction-qualified ability records:

- 24 abilities containing `ability-grant` mechanics.
- 12 structured but materially incomplete abilities.
- Each record is frozen with its current DSL and one corresponding sibling-store source record.
- Every identity uses `(faction_id, ability_id)` because bare ability IDs can collide.

The cohort mixes opaque grants, recipient filters, referenced rules, conditional effects, selection, resource mechanics, choice, deployment, reactive movement, and damage-class-qualified defensive effects.

## Method

1. Freeze source and current DSL digests for every cohort member.
2. Enumerate meaningful source obligations per ability.
3. Propose maximum dependency-closed components using existing DSL shapes only.
4. Put unrepresented obligations into a private residual sidecar with missing slots and dependencies.
5. Run the real TypeScript repair assembler, AJV ability validation, canonical-key lint, and describer.
6. Reject candidates when actual render output exposes semantic loss, even when schema-valid.
7. Generate private source/current-render/candidate/residual review pairs.
8. Exercise only explicitly selected, source-checked, scenario-qualified components through the real cruncher.

The sidecar binds every candidate to source, base-entry, candidate, and render digests. It records review status separately from schema validity and full certification.

## Results

| Measure | Observed |
| --- | ---: |
| Frozen abilities | 36 |
| Candidate components after repair and quarantine | 16 across 15 abilities |
| Whole-source candidate coverage | 10 abilities |
| Partial candidate coverage | 5 abilities |
| Blocked abilities | 21 |
| Schema-valid components | 16 / 16 |
| Components passing existing canonical-key lint | 11 / 16 |
| Human approvals | 0 |
| Production applications | 0 |

Every provisional ledger accounts for all enumerated source obligations: represented components, residuals, or explicit blocks. This does **not** establish a cohort-wide semantic-coverage percentage. Human review is still required to determine whether the retained components are useful and faithfully scoped.

### Render-driven rejections

The real describer exposed failures that schema validation alone did not:

- A unit keyword was rendered as a weapon keyword.
- An invulnerable-save-only reroll rendered as an unrestricted saving-throw reroll.
- A stat-halving proposal rendered as an unknown numeric addition.
- An attached-unit target rendered the inverse leader/bodyguard relationship.
- A copied referenced rule omitted load-bearing issuance, range, expiry, and cancellation controls.
- Opaque labels rendered as prose but did not expose their mechanics.

Those components were repaired only where an existing shape preserved the missing semantics. Otherwise they were quarantined.

### Retained partial examples

- **Shock Charge:** retains a self-scoped zero-cost modification; model-only repeated-target permission remains blocked.
- **Enemy Within:** retains a typed, guarded reserves-placement component; construction legality remains residual.
- **Master of Deceit:** retains bounded recipient selection and redeployment; the reserves-limit exception remains residual.
- **Shrouding:** retains the beneficiary-bound Stealth component; attacker-model distance targeting remains blocked.
- **Gravitic Pulse:** retains selected-target Advance and Charge roll halves; Move halving and a selected-target follow-up remain blocked.
- **The Lion Helm:** retains a passive invulnerable save independently of a separately activated mortal-wound FNP component.

## Canonical FNP scope incompatibility

Five source-correct Feel No Pain components fail the existing canonical-key lint because it permits only `threshold` while the schema, describer, and runtime also support `modifier.scope`.

The pilot did not remove the scope, relax the lint, or modify production code. The incompatibility is evidence for a future narrowly scoped tooling decision, not approval to bypass the current gate.

## Bounded Luna classification trial

The narrow task was to classify FNP damage scope using exactly:

```text
all | mortal | psychic | psychic-and-mortal | OTHER | UNCERTAIN
```

Results:

- 6 of 6 frozen source-reference classifications matched.
- 4 of 4 fabricated controls matched, including unrestricted `all`, non-representable `OTHER`, and missing-evidence `UNCERTAIN`.
- No patches were applied.

The classifier job timings include whole-agent execution and file I/O. They are not human review times or model-only timings.

The trial does not establish bulk-completion savings. Phase A had already resolved five relevant scopes, while the sixth candidate was blocked by activation semantics rather than damage scope. No natural scope-fill workload remained.

## Explicit damage diagnostics

Ten profile-only scenarios ran through the real TypeScript translator and expected-value engine. Each scenario fixed profile, phase, distance, attachment state, activation assumption, and included contributions.

Examples:

- A passive invulnerable save changed the ordinary benchmark's expected post-FNP damage from `2.083333` to `1.250000`.
- A mortal-only FNP changed a fabricated Devastating Wounds benchmark from `2.166667` to `1.916667`; ordinary non-Psychic damage was unchanged.
- Psychic-only FNP emitted an unsupported diagnostic rather than being applied to a non-Psychic scenario.

These are diagnostics, not legal-roster claims, whole-rule estimates, optimizer inputs, or human approvals. The cruncher does not itself enforce all ability-level activation, usage, resource, and selection state.

## Existing consumer boundaries

Safe now:

- Describer review of a schema-valid, dependency-closed candidate.
- Structural retrieval that distinguishes represented components from residuals.
- Explicit scenario comparisons for supported contributions with fully supplied context.

Not safe now:

- Treating all partial candidates as ordinary eligible ability buffs.
- Unqualified optimizer use.
- Auto-applying unspecified choices, resource spends, selection bindings, or usage limits.
- Treating omitted mechanics as zero effect.

Notable current runtime behavior:

- Unknown range is permissive in buff applicability.
- Some ability-level trigger and usage metadata is not enforced by direct buff translation.
- Unsupported output is not a completeness ledger because perspective-inapplicable effects can be intentionally omitted.

## Decision

**GO:** private human review of the 16 digest-bound candidate components.

**NO-GO:** production partial-authoring infrastructure, a claim of 60–80% semantic coverage, or a claim of human-time savings.

The pilot demonstrates that existing schemas and describers can represent reviewable closed components. It does not yet establish that the workflow reduces end-to-end work or that humans accept the components as useful.

## Next review protocol

For each pending component, compare the private frozen source, candidate render, and residuals together. Approve or reject only that component. Do not infer whole-ability approval from a component decision.

An approval must remain bound to:

- Source digest.
- Base-entry digest.
- Candidate-entry digest.
- Render digest.
- Residual ledger.

A changed source, candidate, or render requires re-review. Complete abilities continue through the existing full-certification path.

## Private artifacts

The private experiment directory contains:

- `review.html`: source, current render, candidate render, and residual review pairs.
- `human-review.json`: digest-bound pending component decisions.
- `assembled.json`: candidate DSL, validation results, renders, and obligation accounting.
- `scenario-results.json`: explicit context and expected-value outputs.
- `fnp-classification-evaluation.json` and `fnp-control-evaluation.json`: classifier measurements.
- `fnp-gate-probe.json`: reproduction of the canonical FNP scope incompatibility.
- `quarantined-components.json`: candidate components rejected after render inspection.

None of these private artifacts should be committed because they include or derive from source-rule text.
