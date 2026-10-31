[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / LOADOUT\_CANDIDATES\_DEFAULT\_LIMIT

# Variable: LOADOUT\_CANDIDATES\_DEFAULT\_LIMIT

> `const` **LOADOUT\_CANDIDATES\_DEFAULT\_LIMIT**: `256` = `256`

Defined in: [data/loadout.ts:1754](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/loadout.ts#L1754)

Default ceiling on how many candidates [loadoutCandidates](../functions/loadoutCandidates.md) returns.
Part of the runner contract (`conformance/RUNNER_PROTOCOL.md`) and mirrored by
every port, so a caller that omits `limit` gets the same truncation point in
TypeScript, Rust, Python and Go.
