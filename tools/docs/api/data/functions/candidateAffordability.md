[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / candidateAffordability

# Function: candidateAffordability()

> **candidateAffordability**(`spec`, `dataset`): [`CandidateCost`](../interfaces/CandidateCost.md)[]

Defined in: [data/affordability.ts:74](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/affordability.ts#L74)

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
