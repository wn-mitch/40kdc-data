[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TargetingEffect

# Interface: TargetingEffect

Defined in: [generated.ts:4292](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4292)

[permission] Who may, may not or must target whom, under which limit.

## Properties

### type

> **type**: `"targeting"`

Defined in: [generated.ts:4293](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4293)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4294](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4294)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4295](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4295)

#### by?

> `optional` **by?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### may

> **may**: `"target"` \| `"cannot-target"` \| `"must-target"` \| `"redirect"`

#### target?

> `optional` **target?**: [`UnitRef`](../type-aliases/UnitRef.md) \| `"every-eligible"`

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### kind?

> `optional` **kind?**: `"charge"` \| `"fight"` \| `"ability"` \| `"stratagem"` \| `"shoot"` \| `"attack"`

#### stratagem?

> `optional` **stratagem?**: `string`

#### only\_if\_none?

> `optional` **only\_if\_none?**: [`UnitFilter`](UnitFilter.md)

#### to?

> `optional` **to?**: `"this-unit"` \| `"this-model"` \| `"model-in-this-unit"` \| `"attacker"` \| `"defender"` \| `"event-subject"` \| `"event-object"` \| `"stratagem-target"` \| `"selected-unit"` \| `"recipient"` \| `"bearer-transport"` \| `"ability-unit"` \| [`UnitFilter`](UnitFilter.md) \| \{ `event_var`: `string`; \} \| \{ `selection_var`: `string`; \} \| \{ `stratagem_target`: `string`; \}

Which unit a predicate or trigger talks about. A fixed role, a filter for 'any unit that…', or a unit bound by an earlier trigger or selection.

#### if\_eligible?

> `optional` **if\_eligible?**: `true`

redirect: only if `to` is an eligible target.

#### except?

> `optional` **except?**: `"core-stratagems"`

cannot-target with Stratagems: Core Stratagems can still target it.

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4341](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4341)
