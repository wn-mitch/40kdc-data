[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / EligibleAbilitySource

# Type Alias: EligibleAbilitySource

> **EligibleAbilitySource** = \{ `kind`: `"army"`; \} \| \{ `kind`: `"detachment"`; `detachmentId`: `string`; \} \| \{ `kind`: `"detachment-stratagem"`; `stratagemId`: `string`; `cpCost`: `number`; `selectsModel?`: `true`; \} \| \{ `kind`: `"unit"`; `unitId`: `string`; \} \| \{ `kind`: `"attached"`; `unitId`: `string`; \} \| \{ `kind`: `"support"`; `sourceUnitId`: `string`; \}

Defined in: [abilities-resolver/resolver.ts:37](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L37)

## Union Members

### Type Literal

\{ `kind`: `"army"`; \}

***

### Type Literal

\{ `kind`: `"detachment"`; `detachmentId`: `string`; \}

***

### Type Literal

\{ `kind`: `"detachment-stratagem"`; `stratagemId`: `string`; `cpCost`: `number`; `selectsModel?`: `true`; \}

`selectsModel`: the Stratagem targets one model of the unit (`target_restrictions.selects: "model"`).

***

### Type Literal

\{ `kind`: `"unit"`; `unitId`: `string`; \}

***

### Type Literal

\{ `kind`: `"attached"`; `unitId`: `string`; \}

***

### Type Literal

\{ `kind`: `"support"`; `sourceUnitId`: `string`; \}
