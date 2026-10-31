[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Enhancement

# Interface: Enhancement

Defined in: [generated.ts:3117](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3117)

A purchasable upgrade for a character unit, provided by a detachment.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "enhancement".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3118](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3118)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:3119](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3119)

***

### name

> **name**: `string`

Defined in: [generated.ts:3120](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3120)

***

### detachment\_id

> **detachment\_id**: `string`

Defined in: [generated.ts:3121](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3121)

***

### cost

> **cost**: `number`

Defined in: [generated.ts:3122](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3122)

***

### points\_provisional?

> `optional` **points\_provisional?**: `boolean`

Defined in: [generated.ts:3126](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3126)

True when the cost is carried over provisionally (e.g. seeded from a prior edition during migration) and not yet confirmed against the current dataslate.

***

### upgrade\_tag?

> `optional` **upgrade\_tag?**: `boolean`

Defined in: [generated.ts:3130](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3130)

11e: when true, this enhancement applies to up to `max_targets` non-character units while counting as a single Enhancement choice.

***

### max\_targets?

> `optional` **max\_targets?**: `number`

Defined in: [generated.ts:3134](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3134)

Number of units this enhancement may be applied to. Only meaningful when `upgrade_tag` is true; defaults to 1.

***

### keyword\_restrictions?

> `optional` **keyword\_restrictions?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:3135](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3135)

***

### keyword\_restriction\_groups?

> `optional` **keyword\_restriction\_groups?**: \[\[`string`, `...string[]`\], `...[string, ...string[]][]`\]

Defined in: [generated.ts:3141](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3141)

Alternative bearer eligibility groups. Every keyword in one group is required (AND), while satisfying any group is sufficient (OR). When present, this supersedes the legacy flat `keyword_restrictions` field.

#### Min Items

1

***

### datasheet\_restriction\_groups?

> `optional` **datasheet\_restriction\_groups?**: \[\{ `unit_id`: `string`; `keywords?`: \[`string`, `...string[]`\]; \}, `...{ unit_id: string; keywords?: [string, ...string[]] }[]`\]

Defined in: [generated.ts:3147](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3147)

Datasheet-scoped bearer eligibility groups: a bearer whose unit is `unit_id` and carries every listed keyword is eligible. Each group is a further alternative (OR) to the keyword groups in `keyword_restrictions` / `keyword_restriction_groups`. A datasheet group admits only that datasheet, never another unit that carries the datasheet's name as a keyword. `exclusion_keywords` still applies.

#### Min Items

1

***

### exclusion\_keywords?

> `optional` **exclusion\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md) \| `null`

Defined in: [generated.ts:3163](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3163)

***

### required\_ability\_ids?

> `optional` **required\_ability\_ids?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:3169](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3169)

Core abilities (data/core/unit-keywords.json ids) the bearer's datasheet must have ("HERETIC ASTARTES model with the Deep Strike ability only"). Every listed ability is required, on top of the keyword and datasheet groups.

#### Min Items

1

***

### attachment\_bodyguard\_ids?

> `optional` **attachment\_bodyguard\_ids?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:3175](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3175)

Additional bodyguard units the bearer may attach to because it carries this enhancement.

#### Min Items

1

***

### ability\_id?

> `optional` **ability\_id?**: `string` \| `null`

Defined in: [generated.ts:3176](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3176)

***

### is\_unique?

> `optional` **is\_unique?**: `boolean`

Defined in: [generated.ts:3177](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3177)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3178](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3178)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes2`](../type-aliases/GameModes2.md)

Defined in: [generated.ts:3179](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3179)
