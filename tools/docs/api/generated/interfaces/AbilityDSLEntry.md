[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityDSLEntry

# Interface: AbilityDSLEntry

Defined in: [generated.ts:4404](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4404)

Community-authored structured representation of what a game ability does. NOT GW text.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability".

## Properties

### ability\_id

> **ability\_id**: `string`

Defined in: [generated.ts:4405](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4405)

***

### name

> **name**: `string`

Defined in: [generated.ts:4406](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4406)

***

### authored\_by

> **authored\_by**: `string`

Defined in: [generated.ts:4407](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4407)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:4408](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4408)

***

### source\_digest?

> `optional` **source\_digest?**: `string`

Defined in: [generated.ts:4412](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4412)

SHA-256 of the NORMALISED printed rule this annotation was authored against — one-way, so the rule text itself stays outside this repository. Normalisation (defined once in tools/src/source-digest.ts) casefolds, folds Unicode, keeps the rule-significant operators + - = < > / % and replaces other punctuation with spaces, so reprint noise and quote style leave the digest unchanged while a changed value or an added condition changes it. Optional: absent means the source was never fingerprinted, which `npm run audit:source-digest` reports as untracked rather than current. Records source-content identity, not release history — consumers must not select, order or supersede abilities by it.

***

### version?

> `optional` **version?**: `string`

Defined in: [generated.ts:4413](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4413)

***

### supersedes?

> `optional` **supersedes?**: `string` \| `null`

Defined in: [generated.ts:4414](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4414)

***

### unit\_ids?

> `optional` **unit\_ids?**: `string`[]

Defined in: [generated.ts:4415](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4415)

***

### faction\_id?

> `optional` **faction\_id?**: `string` \| `null`

Defined in: [generated.ts:4419](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4419)

Owning faction. Authored explicitly on faction/detachment-scoped abilities; otherwise stamped at bundle time from the ability's data/enrichment/<faction>/ directory (records in the shared _core pool stay null). Enables faction-scoped resolution of a unit's ability_ids so an ability_id shared across factions resolves to the unit's own faction's copy rather than whichever faction bundled first.

***

### detachment\_id?

> `optional` **detachment\_id?**: `string` \| `null`

Defined in: [generated.ts:4423](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4423)

For detachment/enhancement/stratagem-type abilities, the associated detachment

***

### ability\_type?

> `optional` **ability\_type?**: `"stratagem"` \| `"enhancement"` \| `"unit"` \| `"core"` \| `"detachment"` \| `"faction"`

Defined in: [generated.ts:4424](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4424)

***

### behavior?

> `optional` **behavior?**: `"aura"` \| `"reactive"` \| `"passive"` \| `"activated"`

Defined in: [generated.ts:4428](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4428)

How this ability interacts with the game flow — not a runtime predicate

***

### effect

> **effect**: [`AbilityEffect1`](../type-aliases/AbilityEffect1.md)

Defined in: [generated.ts:4429](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4429)

***

### trigger?

> `optional` **trigger?**: [`AbilityTrigger`](../type-aliases/AbilityTrigger.md)

Defined in: [generated.ts:4430](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4430)

***

### scope

> **scope**: [`AbilityScope`](AbilityScope.md)

Defined in: [generated.ts:4431](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4431)

***

### usage?

> `optional` **usage?**: [`AbilityUsage1`](AbilityUsage1.md)

Defined in: [generated.ts:4432](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4432)

***

### applies\_to?

> `optional` **applies\_to?**: \{ `required_keywords?`: [`KeywordList`](../type-aliases/KeywordList.md); `excluded_keywords?`: [`KeywordList`](../type-aliases/KeywordList.md); \} \| `null`

Defined in: [generated.ts:4436](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4436)

Static, human-curated keyword filter naming which datasheet units this ability benefits, for roster-side highlighting. A unit matches when it carries every keyword in `required_keywords` (across its `keywords` + `faction_keywords`) and none in `excluded_keywords`. This is a denormalized projection distinct from the runtime `effect` condition tree (which mixes static class, runtime-granted markers, and timing gates and must not be scraped for scope). Absent/null means no resolvable unit scope — consumers render no highlight rather than guess.

***

### interactions?

> `optional` **interactions?**: `object`[]

Defined in: [generated.ts:4440](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4440)

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

Defined in: [generated.ts:4446](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4446)

***

### dispute\_notes?

> `optional` **dispute\_notes?**: `string`

Defined in: [generated.ts:4447](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4447)

***

### community\_notes?

> `optional` **community\_notes?**: `string`

Defined in: [generated.ts:4448](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4448)
