[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityDSLEntry

# Interface: AbilityDSLEntry

Defined in: [generated.ts:7123](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7123)

Community-authored structured representation of what a game ability does. NOT GW text.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability".

## Properties

### ability\_id

> **ability\_id**: `string`

Defined in: [generated.ts:7124](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7124)

***

### name

> **name**: `string`

Defined in: [generated.ts:7125](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7125)

***

### authored\_by

> **authored\_by**: `string`

Defined in: [generated.ts:7126](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7126)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:7127](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7127)

***

### source\_digest?

> `optional` **source\_digest?**: `string`

Defined in: [generated.ts:7131](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7131)

SHA-256 of the NORMALISED printed rule this annotation was authored against — one-way, so the rule text itself stays outside this repository. Normalisation (defined once in tools/src/source-digest.ts) casefolds, folds Unicode, keeps the rule-significant operators + - = < > / % and replaces other punctuation with spaces, so reprint noise and quote style leave the digest unchanged while a changed value or an added condition changes it. Optional: absent means the source was never fingerprinted, which `npm run audit:source-digest` reports as untracked rather than current. Records source-content identity, not release history — consumers must not select, order or supersede abilities by it.

***

### version?

> `optional` **version?**: `string`

Defined in: [generated.ts:7132](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7132)

***

### stub?

> `optional` **stub?**: `true`

Defined in: [generated.ts:7136](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7136)

A seeded placeholder awaiting authoring: its effect is not the ability's mechanics. Removed when an authored effect replaces it.

***

### supersedes?

> `optional` **supersedes?**: `string` \| `null`

Defined in: [generated.ts:7137](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7137)

***

### unit\_ids?

> `optional` **unit\_ids?**: `string`[]

Defined in: [generated.ts:7138](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7138)

***

### faction\_id?

> `optional` **faction\_id?**: `string` \| `null`

Defined in: [generated.ts:7142](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7142)

Owning faction. Authored explicitly on faction/detachment-scoped abilities; otherwise stamped at bundle time from the ability's data/enrichment/<faction>/ directory (records in the shared _core pool stay null). Enables faction-scoped resolution of a unit's ability_ids so an ability_id shared across factions resolves to the unit's own faction's copy rather than whichever faction bundled first.

***

### detachment\_id?

> `optional` **detachment\_id?**: `string` \| `null`

Defined in: [generated.ts:7146](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7146)

For detachment/enhancement/stratagem-type abilities, the associated detachment

***

### ability\_type?

> `optional` **ability\_type?**: `"stratagem"` \| `"enhancement"` \| `"unit"` \| `"core"` \| `"detachment"` \| `"faction"`

Defined in: [generated.ts:7147](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7147)

***

### behavior?

> `optional` **behavior?**: `"aura"` \| `"passive"` \| `"activated"` \| `"reactive"`

Defined in: [generated.ts:7151](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7151)

How this ability interacts with the game flow — not a runtime predicate

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md)

Defined in: [generated.ts:7152](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7152)

***

### trigger?

> `optional` **trigger?**: [`AbilityTrigger`](../type-aliases/AbilityTrigger.md)

Defined in: [generated.ts:7153](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7153)

***

### scope

> **scope**: [`AbilityScope`](AbilityScope.md)

Defined in: [generated.ts:7154](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7154)

***

### usage?

> `optional` **usage?**: [`AbilityUsage`](../type-aliases/AbilityUsage.md)

Defined in: [generated.ts:7155](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7155)

***

### applies\_to?

> `optional` **applies\_to?**: [`KeywordPredicate`](KeywordPredicate.md) \| `null`

Defined in: [generated.ts:7159](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7159)

Static, human-curated keyword predicate naming which datasheet units this ability benefits, for roster-side highlighting. Null or absence means no resolvable scope; {} matches every unit. This projection is distinct from runtime effect conditions.

***

### interactions?

> `optional` **interactions?**: `object`[]

Defined in: [generated.ts:7160](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7160)

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

Defined in: [generated.ts:7166](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7166)

***

### dispute\_notes?

> `optional` **dispute\_notes?**: `string`

Defined in: [generated.ts:7167](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7167)

***

### community\_notes?

> `optional` **community\_notes?**: `string`

Defined in: [generated.ts:7168](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7168)
