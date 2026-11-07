[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RitualMenuEffect

# Interface: RitualMenuEffect

Defined in: [generated.ts:4949](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4949)

Rituals attempted with a Psychic test. Each attempt picks one Ritual (ritual_limit: each Ritual once per turn across the army) and takes the test: roll `dice` (and optionally `extra_die`), bound as `roll_var`; when any two of its dice show the same result (perils on double) the perils effect resolves. If the attempting model (this-model) is not destroyed and the total of all the test's dice equals or exceeds the Ritual's warp_charge, the model manifests that Ritual and its effect resolves. Inside a Ritual's effect, a roll-total condition on roll_var reads the test result.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ritual-menu-effect".

## Properties

### type

> **type**: `"ritual-menu"`

Defined in: [generated.ts:4950](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4950)

***

### test

> **test**: `object`

Defined in: [generated.ts:4951](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4951)

#### dice

> **dice**: `string`

#### kind?

> `optional` **kind?**: [`RollKind`](../type-aliases/RollKind.md)

#### extra\_die?

> `optional` **extra\_die?**: `object`

One more die the player can add to the test ("Optionally, you can roll one additional D6"); its result counts toward the total.

##### extra\_die.dice

> **dice**: `string`

##### extra\_die.optional?

> `optional` **optional?**: `true`

#### roll\_var

> **roll\_var**: `string`

#### perils?

> `optional` **perils?**: `object`

What happens when the test's dice match ("if one or more doubles or triples were rolled": a triple holds a double).

##### perils.on

> **on**: `"double"`

##### perils.effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

***

### ritual\_limit

> **ritual\_limit**: `object`

Defined in: [generated.ts:4973](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4973)

How often each Ritual can be attempted ("select one Ritual no model from your army has attempted to manifest this turn").

#### frequency

> **frequency**: `"once-per-turn"`

#### per

> **per**: `"army"`

***

### rituals

> **rituals**: \[\{ `id`: `string`; `name`: `string`; `warp_charge`: `number`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, `...{ id: string; name: string; warp_charge: number; effect: EffectNode }[]`\]

Defined in: [generated.ts:4980](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4980)

#### Min Items

1
