[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / candidateAffordability

# Function: candidateAffordability()

> **candidateAffordability**(`spec`, `dataset`): [`CandidateCost`](../interfaces/CandidateCost.md)[]

Defined in: [data/affordability.ts:74](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/affordability.ts#L74)

Price the cheapest next copy of each candidate and flag affordability against
the remaining budget. Returns one [CandidateCost](../interfaces/CandidateCost.md) per candidate that
resolves in the dataset, sorted ascending by `(nextCopyCost, unitId)` —
deterministic for conformance.

## Parameters

### spec

[`AffordabilitySpec`](../interfaces/AffordabilitySpec.md)

### dataset

[`Dataset`](../classes/Dataset.md)

## Returns

[`CandidateCost`](../interfaces/CandidateCost.md)[]
