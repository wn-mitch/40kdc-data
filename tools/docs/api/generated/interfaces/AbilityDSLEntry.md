[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityDSLEntry

# Interface: AbilityDSLEntry

Defined in: [generated.ts:8352](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8352)

Community-authored structured representation of what a game ability does. NOT GW text.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability".

## Properties

### ability\_id

> **ability\_id**: `string`

Defined in: [generated.ts:8353](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8353)

***

### name

> **name**: `string`

Defined in: [generated.ts:8354](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8354)

***

### authored\_by

> **authored\_by**: `string`

Defined in: [generated.ts:8355](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8355)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:8356](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8356)

***

### source\_digest?

> `optional` **source\_digest?**: `string`

Defined in: [generated.ts:8360](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8360)

SHA-256 of the NORMALISED printed rule this annotation was authored against — one-way, so the rule text itself stays outside this repository. Normalisation (defined once in tools/src/source-digest.ts) casefolds, folds Unicode, keeps the rule-significant operators + - = < > / % and replaces other punctuation with spaces, so reprint noise and quote style leave the digest unchanged while a changed value or an added condition changes it. Optional: absent means the source was never fingerprinted, which `npm run audit:source-digest` reports as untracked rather than current. Records source-content identity, not release history — consumers must not select, order or supersede abilities by it.

***

### version?

> `optional` **version?**: `string`

Defined in: [generated.ts:8361](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8361)

***

### stub?

> `optional` **stub?**: `true`

Defined in: [generated.ts:8365](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8365)

A seeded placeholder awaiting authoring: its effect is not the ability's mechanics. Removed when an authored effect replaces it.

***

### supersedes?

> `optional` **supersedes?**: `string` \| `null`

Defined in: [generated.ts:8366](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8366)

***

### unit\_ids?

> `optional` **unit\_ids?**: `string`[]

Defined in: [generated.ts:8367](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8367)

***

### faction\_id?

> `optional` **faction\_id?**: `string` \| `null`

Defined in: [generated.ts:8371](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8371)

Owning faction. Authored explicitly on faction/detachment-scoped abilities; otherwise stamped at bundle time from the ability's data/enrichment/<faction>/ directory (records in the shared _core pool stay null). Enables faction-scoped resolution of a unit's ability_ids so an ability_id shared across factions resolves to the unit's own faction's copy rather than whichever faction bundled first.

***

### detachment\_id?

> `optional` **detachment\_id?**: `string` \| `null`

Defined in: [generated.ts:8375](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8375)

The detachment a detachment-, enhancement- or stratagem-type ability belongs to. On a faction-type ability it names the Combat Patrol detachment whose box prints this copy of an army rule: the copy applies only in that detachment, where `interactions` entries of type `replaces` name the codex army rules it stands in for. Null on a codex army rule, which applies in every detachment except a Combat Patrol detachment whose `detachment_rule_ids` omit it.

***

### ability\_type?

> `optional` **ability\_type?**: `"stratagem"` \| `"enhancement"` \| `"unit"` \| `"core"` \| `"detachment"` \| `"faction"`

Defined in: [generated.ts:8376](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8376)

***

### behavior?

> `optional` **behavior?**: `"aura"` \| `"passive"` \| `"activated"` \| `"reactive"`

Defined in: [generated.ts:8380](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8380)

How this ability interacts with the game flow — not a runtime predicate

***

### optional?

> `optional` **optional?**: `true`

Defined in: [generated.ts:8384](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8384)

The player chooses whether to use this ability, which has no trigger. Absent when the ability always applies, when a trigger decides when it is used, or for a Stratagem, which is always the player's choice.

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md)

Defined in: [generated.ts:8385](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8385)

***

### trigger?

> `optional` **trigger?**: [`AbilityTrigger`](../type-aliases/AbilityTrigger.md)

Defined in: [generated.ts:8386](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8386)

***

### scope

> **scope**: [`AbilityScope`](AbilityScope.md)

Defined in: [generated.ts:8387](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8387)

***

### usage?

> `optional` **usage?**: [`AbilityUsage`](../type-aliases/AbilityUsage.md)

Defined in: [generated.ts:8388](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8388)

***

### applies\_to?

> `optional` **applies\_to?**: [`KeywordPredicate`](KeywordPredicate.md) \| `null`

Defined in: [generated.ts:8392](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8392)

Static, human-curated keyword predicate naming which datasheet units this ability benefits, for roster-side highlighting. Null or absence means no resolvable scope; {} matches every unit. This projection is distinct from runtime effect conditions.

***

### interactions?

> `optional` **interactions?**: `object`[]

Defined in: [generated.ts:8393](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8393)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### ability\_ref

> **ability\_ref**: `string`

#### type

> **type**: `"conflicts-with"` \| `"combos-with"` \| `"superseded-by"` \| `"requires"` \| `"replaces"`

#### notes?

> `optional` **notes?**: `string`

***

### disputed?

> `optional` **disputed?**: `boolean`

Defined in: [generated.ts:8399](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8399)

***

### dispute\_notes?

> `optional` **dispute\_notes?**: `string`

Defined in: [generated.ts:8400](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8400)

***

### community\_notes?

> `optional` **community\_notes?**: `string`

Defined in: [generated.ts:8401](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8401)
