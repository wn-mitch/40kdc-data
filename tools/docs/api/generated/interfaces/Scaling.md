[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Scaling

# Interface: Scaling

Defined in: [generated.ts:3169](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3169)

Scales a numeric modifier field (`field`, default `value`): it applies once per `per` of `of` (rounding `round`, default down), optionally capped at `max_value`. E.g. '+2 to the Attacks characteristic for every 5 enemy models within 6"' -> modifier.value 2 with scaling { per: 5, of: 'enemy-models-in-range', within: { inches: 6 } }.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "scaling".

## Properties

### per

> **per**: `number`

Defined in: [generated.ts:3170](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3170)

***

### of

> **of**: [`ScalingSource`](../type-aliases/ScalingSource.md)

Defined in: [generated.ts:3171](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3171)

***

### round?

> `optional` **round?**: `"down"` \| `"up"`

Defined in: [generated.ts:3172](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3172)

***

### max\_value?

> `optional` **max\_value?**: `number`

Defined in: [generated.ts:3173](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3173)

***

### field?

> `optional` **field?**: `"value"` \| `"count"` \| `"amount"` \| `"distance"` \| `"modifier"` \| `"max_models"`

Defined in: [generated.ts:3177](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3177)

The modifier field the scaling multiplies (default value): count for re-roll/return-models, modifier for a test's penalty.

***

### keyword?

> `optional` **keyword?**: `string`

Defined in: [generated.ts:3181](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3181)

Only models with this keyword are counted.

***

### wargear?

> `optional` **wargear?**: `string`

Defined in: [generated.ts:3185](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3185)

Kebab-case identifier

***

### evaluated?

> `optional` **evaluated?**: `"live"` \| `"on-apply"`

Defined in: [generated.ts:3189](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3189)

When the count is taken. live (absent): at each use of the effect. on-apply: once, when the rule applies, and fixed for the rule's duration (a count in a rule that starts at a moment and lasts).

***

### within?

> `optional` **within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:3190](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3190)
