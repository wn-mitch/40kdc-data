[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / TransportCapacityEffect

# Interface: TransportCapacityEffect

Defined in: [generated.ts:5603](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5603)

[placement] How models count against a Transport's capacity: grouped models, fixed spaces per model, an equivalent model, or the Transport's own capacity with per-model spaces.

## Properties

### type

> **type**: `"transport-capacity"`

Defined in: [generated.ts:5604](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5604)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5605](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5605)

***

### modifier

> **modifier**: \{ `occupancy_kind`: `"grouped-models"`; `subject_kind`: [`TransportOccupancySubjectKind`](../type-aliases/TransportOccupancySubjectKind.md); `model_keyword?`: `string`; `transport_eligibility?`: [`TransportEligibility`](../type-aliases/TransportEligibility.md); `models_per_group`: `number`; `spaces_per_group`: `number`; `rounding`: `"down"` \| `"up"`; \} \| \{ `occupancy_kind`: `"fixed-model-spaces"`; `subject_kind`: [`TransportOccupancySubjectKind`](../type-aliases/TransportOccupancySubjectKind.md); `model_keyword?`: `string`; `transport_eligibility?`: [`TransportEligibility`](../type-aliases/TransportEligibility.md); `spaces_per_model`: `number`; \} \| \{\[`k`: `string`\]: `unknown`; \} \| \{ `capacity`: `number`; `eligible?`: [`UnitFilter`](UnitFilter.md); `space_per_model?`: \[\{ `all_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `any_of?`: [`KeywordList`](../type-aliases/KeywordList.md); `slots`: `number`; \}, `...{ all_of?: KeywordList; any_of?: KeywordList; slots: number }[]`\]; \}

Defined in: [generated.ts:5606](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5606)

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

Defined in: [generated.ts:5645](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5645)
