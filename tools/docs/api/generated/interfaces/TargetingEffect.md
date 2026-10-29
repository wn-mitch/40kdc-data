[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TargetingEffect

# Interface: TargetingEffect

Defined in: [generated.ts:4893](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4893)

[permission] Who may, may not or must target whom, under which limit.

## Properties

### type

> **type**: `"targeting"`

Defined in: [generated.ts:4894](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4894)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4895](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4895)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4896](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4896)

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

#### ability?

> `optional` **ability?**: `string`

Kebab-case identifier

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

#### target\_condition?

> `optional` **target\_condition?**: [`AbilityDSLCondition5`](../type-aliases/AbilityDSLCondition5.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4947](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4947)
