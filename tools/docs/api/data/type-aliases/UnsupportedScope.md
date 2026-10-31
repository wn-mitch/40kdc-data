[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / UnsupportedScope

# Type Alias: UnsupportedScope

> **UnsupportedScope** = `"out-of-scope"` \| `"encounter-layer"` \| `"unresolved"`

Defined in: [cruncher/unsupported-scope.ts:16](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/unsupported-scope.ts#L16)

- `out-of-scope`: no damage content for this attack (a move, a charge re-roll, Scouts, an
  Objective Control change, or a defender-side stat seen from the attacker);
- `encounter-layer`: acts outside the attack, through deaths, mortal wounds, healing,
  designations, or a moment after the unit's own attacks;
- `unresolved`: could change the attack's damage, but the engine cannot evaluate it.
