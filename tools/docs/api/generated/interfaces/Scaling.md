[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Scaling

# Interface: Scaling

Defined in: [generated.ts:3533](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3533)

Scales a numeric modifier field (`field`, default `value`): it applies once per `per` of `of` (rounding `round`, default down), optionally capped at `max_value`. E.g. '+2 to the Attacks characteristic for every 5 enemy models within 6"' -> modifier.value 2 with scaling { per: 5, of: 'enemy-models-in-range', within: { inches: 6 } }.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "scaling".

## Properties

### per

> **per**: `number`

Defined in: [generated.ts:3534](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3534)

***

### of

> **of**: [`ScalingSource`](../type-aliases/ScalingSource.md)

Defined in: [generated.ts:3535](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3535)

***

### round?

> `optional` **round?**: `"down"` \| `"up"`

Defined in: [generated.ts:3536](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3536)

***

### max\_value?

> `optional` **max\_value?**: `number`

Defined in: [generated.ts:3537](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3537)

***

### field?

> `optional` **field?**: `"value"` \| `"count"` \| `"amount"` \| `"distance"` \| `"modifier"` \| `"max_models"`

Defined in: [generated.ts:3541](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3541)

The modifier field the scaling multiplies (default value): count for re-roll/return-models, modifier for a test's penalty.

***

### keyword?

> `optional` **keyword?**: `string`

Defined in: [generated.ts:3545](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3545)

Only models with this keyword are counted.

***

### wargear?

> `optional` **wargear?**: `string`

Defined in: [generated.ts:3549](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3549)

Kebab-case identifier

***

### evaluated?

> `optional` **evaluated?**: `"live"` \| `"on-apply"`

Defined in: [generated.ts:3553](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3553)

When the count is taken. live (absent): at each use of the effect. on-apply: once, when the rule applies, and fixed for the rule's duration (a count in a rule that starts at a moment and lasts).

***

### within?

> `optional` **within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:3554](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3554)
