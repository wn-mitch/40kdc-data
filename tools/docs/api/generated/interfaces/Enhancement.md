[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Enhancement

# Interface: Enhancement

Defined in: [generated.ts:2996](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2996)

A purchasable upgrade for a character unit, provided by a detachment.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "enhancement".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:2997](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2997)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:2998](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2998)

***

### name

> **name**: `string`

Defined in: [generated.ts:2999](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2999)

***

### detachment\_id

> **detachment\_id**: `string`

Defined in: [generated.ts:3000](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3000)

***

### cost

> **cost**: `number`

Defined in: [generated.ts:3001](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3001)

***

### points\_provisional?

> `optional` **points\_provisional?**: `boolean`

Defined in: [generated.ts:3005](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3005)

True when the cost is carried over provisionally (e.g. seeded from a prior edition during migration) and not yet confirmed against the current dataslate.

***

### upgrade\_tag?

> `optional` **upgrade\_tag?**: `boolean`

Defined in: [generated.ts:3009](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3009)

11e: when true, this enhancement applies to up to `max_targets` non-character units while counting as a single Enhancement choice.

***

### max\_targets?

> `optional` **max\_targets?**: `number`

Defined in: [generated.ts:3013](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3013)

Number of units this enhancement may be applied to. Only meaningful when `upgrade_tag` is true; defaults to 1.

***

### keyword\_restrictions?

> `optional` **keyword\_restrictions?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:3014](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3014)

***

### keyword\_restriction\_groups?

> `optional` **keyword\_restriction\_groups?**: \[\[`string`, `...string[]`\], `...[string, ...string[]][]`\]

Defined in: [generated.ts:3020](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3020)

Alternative bearer eligibility groups. Every keyword in one group is required (AND), while satisfying any group is sufficient (OR). When present, this supersedes the legacy flat `keyword_restrictions` field.

#### Min Items

1

***

### datasheet\_restriction\_groups?

> `optional` **datasheet\_restriction\_groups?**: \[\{ `unit_id`: `string`; `keywords?`: \[`string`, `...string[]`\]; \}, `...{ unit_id: string; keywords?: [string, ...string[]] }[]`\]

Defined in: [generated.ts:3026](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3026)

Datasheet-scoped bearer eligibility groups: a bearer whose unit is `unit_id` and carries every listed keyword is eligible. Each group is a further alternative (OR) to the keyword groups in `keyword_restrictions` / `keyword_restriction_groups`. A datasheet group admits only that datasheet, never another unit that carries the datasheet's name as a keyword. `exclusion_keywords` still applies.

#### Min Items

1

***

### exclusion\_keywords?

> `optional` **exclusion\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md) \| `null`

Defined in: [generated.ts:3042](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3042)

***

### attachment\_bodyguard\_ids?

> `optional` **attachment\_bodyguard\_ids?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:3048](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3048)

Additional bodyguard units the bearer may attach to because it carries this enhancement.

#### Min Items

1

***

### ability\_id?

> `optional` **ability\_id?**: `string` \| `null`

Defined in: [generated.ts:3049](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3049)

***

### is\_unique?

> `optional` **is\_unique?**: `boolean`

Defined in: [generated.ts:3050](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3050)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3051](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3051)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes2`](../type-aliases/GameModes2.md)

Defined in: [generated.ts:3052](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3052)
