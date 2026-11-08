[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WithinCondition

# Interface: WithinCondition

Defined in: [generated.ts:2452](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2452)

[position] The subject is within `range` of `of`. `models` quantifies the subject's models (`every` requires all); `count` bounds how many subject models are within range. `wholly` requires the subject footprint to be inside the range. `at` reads the position at an earlier point: the start of the phase, or of the move that triggered the ability.

## Properties

### type

> **type**: `"within"`

Defined in: [generated.ts:2453](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2453)

***

### parameters

> **parameters**: \{\[`k`: `string`\]: `unknown`; `at`: `"phase-start"` \| `"move-start"`; \} \| \{\[`k`: `string`\]: `unknown`; \}

Defined in: [generated.ts:2454](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2454)
