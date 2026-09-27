[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Enhancement

# Interface: Enhancement

Defined in: [generated.ts:1343](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1343)

A purchasable upgrade for a character unit, provided by a detachment.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "enhancement".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1344](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1344)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:1345](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1345)

***

### name

> **name**: `string`

Defined in: [generated.ts:1346](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1346)

***

### detachment\_id

> **detachment\_id**: `string`

Defined in: [generated.ts:1347](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1347)

***

### cost

> **cost**: `number`

Defined in: [generated.ts:1348](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1348)

***

### points\_provisional?

> `optional` **points\_provisional?**: `boolean`

Defined in: [generated.ts:1352](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1352)

True when the cost is carried over provisionally (e.g. seeded from a prior edition during migration) and not yet confirmed against the current dataslate.

***

### upgrade\_tag?

> `optional` **upgrade\_tag?**: `boolean`

Defined in: [generated.ts:1356](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1356)

11e: when true, this enhancement applies to up to `max_targets` non-character units while counting as a single Enhancement choice.

***

### max\_targets?

> `optional` **max\_targets?**: `number`

Defined in: [generated.ts:1360](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1360)

Number of units this enhancement may be applied to. Only meaningful when `upgrade_tag` is true; defaults to 1.

***

### keyword\_restrictions?

> `optional` **keyword\_restrictions?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:1361](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1361)

***

### keyword\_restriction\_groups?

> `optional` **keyword\_restriction\_groups?**: \[\[`string`, `...string[]`\], `...[string, ...string[]][]`\]

Defined in: [generated.ts:1367](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1367)

Alternative bearer eligibility groups. Every keyword in one group is required (AND), while satisfying any group is sufficient (OR). When present, this supersedes the legacy flat `keyword_restrictions` field.

#### Min Items

1

***

### exclusion\_keywords?

> `optional` **exclusion\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md) \| `null`

Defined in: [generated.ts:1368](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1368)

***

### attachment\_bodyguard\_ids?

> `optional` **attachment\_bodyguard\_ids?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1374](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1374)

Additional bodyguard units the bearer may attach to because it carries this enhancement.

#### Min Items

1

***

### ability\_id?

> `optional` **ability\_id?**: `string` \| `null`

Defined in: [generated.ts:1375](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1375)

***

### is\_unique?

> `optional` **is\_unique?**: `boolean`

Defined in: [generated.ts:1376](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1376)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1377](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1377)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes2`](../type-aliases/GameModes2.md)

Defined in: [generated.ts:1378](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1378)
