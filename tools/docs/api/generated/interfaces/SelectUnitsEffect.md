[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / SelectUnitsEffect

# Interface: SelectUnitsEffect

Defined in: [generated.ts:2630](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2630)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "select-units-effect".

## Indexable

> \[`k`: `string`\]: `unknown`

## Properties

### type

> **type**: `"select-units"`

Defined in: [generated.ts:2631](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2631)

***

### selector

> **selector**: `object`

Defined in: [generated.ts:2635](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2635)

Legacy selectors omit min_count and retain up-to semantics. Bounded authoring requires min_count, max_count, and owner, with min_count <= max_count.

#### Index Signature

\[`k`: `string`\]: `unknown`

***

### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:2638](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2638)
