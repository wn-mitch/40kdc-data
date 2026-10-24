[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Enhancement

# Interface: Enhancement

Defined in: [generated.ts:2672](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2672)

A purchasable upgrade for a character unit, provided by a detachment.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "enhancement".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:2673](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2673)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:2674](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2674)

***

### name

> **name**: `string`

Defined in: [generated.ts:2675](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2675)

***

### detachment\_id

> **detachment\_id**: `string`

Defined in: [generated.ts:2676](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2676)

***

### cost

> **cost**: `number`

Defined in: [generated.ts:2677](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2677)

***

### points\_provisional?

> `optional` **points\_provisional?**: `boolean`

Defined in: [generated.ts:2681](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2681)

True when the cost is carried over provisionally (e.g. seeded from a prior edition during migration) and not yet confirmed against the current dataslate.

***

### upgrade\_tag?

> `optional` **upgrade\_tag?**: `boolean`

Defined in: [generated.ts:2685](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2685)

11e: when true, this enhancement applies to up to `max_targets` non-character units while counting as a single Enhancement choice.

***

### max\_targets?

> `optional` **max\_targets?**: `number`

Defined in: [generated.ts:2689](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2689)

Number of units this enhancement may be applied to. Only meaningful when `upgrade_tag` is true; defaults to 1.

***

### keyword\_restrictions?

> `optional` **keyword\_restrictions?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:2690](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2690)

***

### keyword\_restriction\_groups?

> `optional` **keyword\_restriction\_groups?**: \[\[`string`, `...string[]`\], `...[string, ...string[]][]`\]

Defined in: [generated.ts:2696](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2696)

Alternative bearer eligibility groups. Every keyword in one group is required (AND), while satisfying any group is sufficient (OR). When present, this supersedes the legacy flat `keyword_restrictions` field.

#### Min Items

1

***

### exclusion\_keywords?

> `optional` **exclusion\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md) \| `null`

Defined in: [generated.ts:2697](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2697)

***

### attachment\_bodyguard\_ids?

> `optional` **attachment\_bodyguard\_ids?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:2703](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2703)

Additional bodyguard units the bearer may attach to because it carries this enhancement.

#### Min Items

1

***

### ability\_id?

> `optional` **ability\_id?**: `string` \| `null`

Defined in: [generated.ts:2704](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2704)

***

### is\_unique?

> `optional` **is\_unique?**: `boolean`

Defined in: [generated.ts:2705](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2705)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:2706](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2706)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes2`](../type-aliases/GameModes2.md)

Defined in: [generated.ts:2707](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2707)
