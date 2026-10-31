[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Scaling

# Interface: Scaling

Defined in: [generated.ts:3660](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3660)

Scales a numeric modifier field (`field`, default `value`): it applies once per `per` of `of` (rounding `round`, default down), optionally capped at `max_value`. E.g. '+2 to the Attacks characteristic for every 5 enemy models within 6"' -> modifier.value 2 with scaling { per: 5, of: 'enemy-models-in-range', within: { inches: 6 } }.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "scaling".

## Properties

### per

> **per**: `number`

Defined in: [generated.ts:3661](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3661)

***

### of

> **of**: [`ScalingSource`](../type-aliases/ScalingSource.md)

Defined in: [generated.ts:3662](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3662)

***

### round?

> `optional` **round?**: `"down"` \| `"up"`

Defined in: [generated.ts:3663](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3663)

***

### max\_value?

> `optional` **max\_value?**: `number`

Defined in: [generated.ts:3664](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3664)

***

### field?

> `optional` **field?**: `"value"` \| `"count"` \| `"amount"` \| `"distance"` \| `"modifier"` \| `"max_models"`

Defined in: [generated.ts:3668](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3668)

The modifier field the scaling multiplies (default value): count for re-roll/return-models, modifier for a test's penalty.

***

### keyword?

> `optional` **keyword?**: `string`

Defined in: [generated.ts:3672](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3672)

Only models with this keyword are counted.

***

### wargear?

> `optional` **wargear?**: `string`

Defined in: [generated.ts:3676](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3676)

Kebab-case identifier

***

### evaluated?

> `optional` **evaluated?**: `"live"` \| `"on-apply"`

Defined in: [generated.ts:3680](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3680)

When the count is taken. live (absent): at each use of the effect. on-apply: once, when the rule applies, and fixed for the rule's duration (a count in a rule that starts at a moment and lasts).

***

### within?

> `optional` **within?**: [`RangeRef`](../type-aliases/RangeRef.md)

Defined in: [generated.ts:3681](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3681)
