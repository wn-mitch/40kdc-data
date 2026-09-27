[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ForEachUnitEffect

# Interface: ForEachUnitEffect

Defined in: [generated.ts:2645](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2645)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "for-each-unit-effect".

## Properties

### type

> **type**: `"for-each-unit"`

Defined in: [generated.ts:2646](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2646)

***

### selector

> **selector**: `object`

Defined in: [generated.ts:2647](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2647)

#### owner

> **owner**: `"friendly"` \| `"enemy"`

#### keywords?

> `optional` **keywords?**: \[`string`, `...string[]`\]

Keywords filtered against each candidate. Under the default `keyword_match` every listed keyword is required; under `any`, a candidate qualifies on any one of them.

##### Min Items

1

#### keyword\_match?

> `optional` **keyword\_match?**: `"any"` \| `"all"`

Whether `keywords` is a conjunction (the default, preserving historical AND semantics) or an honest disjunction.

#### target\_kind?

> `optional` **target\_kind?**: `"unit"` \| `"model"`

Whether each iteration binds a whole unit or one matching model.

#### within\_inches?

> `optional` **within\_inches?**: `number`

#### engagement\_relation?

> `optional` **engagement\_relation?**: `"engaged-with-bearer"` \| `"not-engaged-with-bearer"`

Candidate engagement relation to the bearer or bearer-unit.

#### reference?

> `optional` **reference?**: `"bearer"` \| `"bearer-unit"` \| `"bearer-transport"`

Origin of the engagement_relation gate.

#### member\_of?

> `optional` **member\_of?**: `"bearer-unit"`

Restrict candidates to models in the ability bearer's unit, including an Attached unit. With target_kind:model every listed keyword is tested on that individual model, never the union of unit keywords.

#### model\_names?

> `optional` **model\_names?**: \[`string`, `...string[]`\]

Exact model-profile names; alternatives. Filters individual models, never the union of unit keywords.

##### Min Items

1

#### excluded\_keywords?

> `optional` **excluded\_keywords?**: \[`string`, `...string[]`\]

A candidate with any listed keyword is excluded.

##### Min Items

1

#### bind\_as?

> `optional` **bind\_as?**: `string`

#### eligibility?

> `optional` **eligibility?**: [`AbilityDSLCondition2`](../type-aliases/AbilityDSLCondition2.md)

#### within\_objective?

> `optional` **within\_objective?**: [`SelectionReference`](SelectionReference.md)

***

### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:2692](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2692)
