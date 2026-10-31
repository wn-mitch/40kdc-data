[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / LOADOUT\_CANDIDATES\_TRUNCATED

# Variable: LOADOUT\_CANDIDATES\_TRUNCATED

> `const` **LOADOUT\_CANDIDATES\_TRUNCATED**: `"…truncated"` = `"…truncated"`

Defined in: [data/loadout.ts:1761](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/loadout.ts#L1761)

The sentinel appended as the final entry when [loadoutCandidates](../functions/loadoutCandidates.md) dropped
candidates to honour `limit`. It is never a candidate encoding (no `" => "`),
so a consumer can test for it by equality.
