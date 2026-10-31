[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TransportCapacityEffect

# Interface: TransportCapacityEffect

Defined in: [generated.ts:5978](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5978)

[placement] How models count against a Transport's capacity: grouped models, fixed spaces per model, an equivalent model, or the Transport's own capacity with per-model spaces.

## Properties

### type

> **type**: `"transport-capacity"`

Defined in: [generated.ts:5979](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5979)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5980](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5980)

***

### modifier

> **modifier**: \{ `occupancy_kind`: `"grouped-models"`; `subject_kind`: [`TransportOccupancySubjectKind`](../type-aliases/TransportOccupancySubjectKind.md); `model_keyword?`: `string`; `transport_eligibility?`: [`TransportEligibility`](../type-aliases/TransportEligibility.md); `models_per_group`: `number`; `spaces_per_group`: `number`; `rounding`: `"down"` \| `"up"`; \} \| \{ `occupancy_kind`: `"fixed-model-spaces"`; `subject_kind`: [`TransportOccupancySubjectKind`](../type-aliases/TransportOccupancySubjectKind.md); `model_keyword?`: `string`; `transport_eligibility?`: [`TransportEligibility`](../type-aliases/TransportEligibility.md); `spaces_per_model`: `number`; \} \| \{\[`k`: `string`\]: `unknown`; \} \| \{ `capacity`: `number`; `eligible?`: [`UnitFilter`](UnitFilter.md); `space_per_model?`: \[\{ `all_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `any_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `slots`: `number`; \}, `...{ all_of?: KeywordList; any_of?: KeywordList; slots: number }[]`\]; \}

Defined in: [generated.ts:5981](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5981)

#### Union Members

##### Type Literal

\{ `occupancy_kind`: `"grouped-models"`; `subject_kind`: [`TransportOccupancySubjectKind`](../type-aliases/TransportOccupancySubjectKind.md); `model_keyword?`: `string`; `transport_eligibility?`: [`TransportEligibility`](../type-aliases/TransportEligibility.md); `models_per_group`: `number`; `spaces_per_group`: `number`; `rounding`: `"down"` \| `"up"`; \}

***

##### Type Literal

\{ `occupancy_kind`: `"fixed-model-spaces"`; `subject_kind`: [`TransportOccupancySubjectKind`](../type-aliases/TransportOccupancySubjectKind.md); `model_keyword?`: `string`; `transport_eligibility?`: [`TransportEligibility`](../type-aliases/TransportEligibility.md); `spaces_per_model`: `number`; \}

***

##### Type Literal

\{\[`k`: `string`\]: `unknown`; \}

***

##### Type Literal

\{ `capacity`: `number`; `eligible?`: [`UnitFilter`](UnitFilter.md); `space_per_model?`: \[\{ `all_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `any_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `slots`: `number`; \}, `...{ all_of?: KeywordList; any_of?: KeywordList; slots: number }[]`\]; \}

##### capacity

> **capacity**: `number`

##### eligible?

> `optional` **eligible?**: [`UnitFilter`](UnitFilter.md)

##### space\_per\_model?

> `optional` **space\_per\_model?**: \[\{ `all_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `any_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `slots`: `number`; \}, `...{ all_of?: KeywordList; any_of?: KeywordList; slots: number }[]`\]

###### Min Items

1

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:6020](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6020)
