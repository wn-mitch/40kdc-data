[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / printedKeyword

# Function: printedKeyword()

> **printedKeyword**(`dataset`): (`keyword`) => `boolean`

Defined in: [abilities-resolver/resolver.ts:341](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/abilities-resolver/resolver.ts#L341)

Whether some datasheet prints a keyword (unit or faction keyword), memoised per lookup.
Counts every game mode's datasheets: a keyword printed only on a Combat Patrol unit is
still printed, whatever view the caller's dataset lists.

## Parameters

### dataset

[`Dataset`](../classes/Dataset.md)

## Returns

(`keyword`) => `boolean`
