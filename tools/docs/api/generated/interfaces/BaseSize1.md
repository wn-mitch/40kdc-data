[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BaseSize1

# Interface: BaseSize1

Defined in: [generated.ts:4006](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4006)

This model's base. Absent when no base could be resolved for the model.

## Properties

### shape

> **shape**: `"round"` \| `"oval"` \| `"flying-base"` \| `"hull"` \| `"unique"`

Defined in: [generated.ts:4007](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4007)

***

### diameter?

> `optional` **diameter?**: `number`

Defined in: [generated.ts:4008](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4008)

***

### width?

> `optional` **width?**: `number`

Defined in: [generated.ts:4009](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4009)

***

### length?

> `optional` **length?**: `number`

Defined in: [generated.ts:4010](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4010)

***

### size?

> `optional` **size?**: `"small"` \| `"large"`

Defined in: [generated.ts:4014](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4014)

Flying-base size class, when 'shape' is 'flying-base'.

***

### draft?

> `optional` **draft?**: `boolean`

Defined in: [generated.ts:4018](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4018)

True when the entry is provisional/guessed (e.g. a category without authoritative dimensions) and should be revisited.
