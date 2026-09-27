[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Scaling

# Interface: Scaling

Defined in: [generated.ts:2247](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2247)

Scales the effect's numeric `modifier.value`: it applies once per `per` of `of` (rounding `round`, default down), optionally capped at `max_value`. E.g. '+2 to the Attacks characteristic for every 5 enemy models within 6\"' → modifier.value 2 with scaling { per: 5, of: 'enemy-models-in-range', within_inches: 6 }.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "scaling".

## Properties

### per

> **per**: `number`

Defined in: [generated.ts:2248](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2248)

***

### of

> **of**: `"enemy-models-in-range"` \| `"friendly-models-in-range"` \| `"models-in-bearer-unit"` \| `"models-in-or-embarked-in-bearer"` \| `"enemy-units-in-range"` \| `"wounds-lost"`

Defined in: [generated.ts:2249](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2249)

***

### within\_inches?

> `optional` **within\_inches?**: `number`

Defined in: [generated.ts:2256](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2256)

***

### round?

> `optional` **round?**: `"down"` \| `"up"`

Defined in: [generated.ts:2257](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2257)

***

### max\_value?

> `optional` **max\_value?**: `number`

Defined in: [generated.ts:2258](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2258)
