[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ScoringTrigger

# Interface: ScoringTrigger

Defined in: [generated.ts:1583](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1583)

When a VP award is evaluated. A bare `phase` is the legacy shorthand for 'during this phase'; richer triggers add `timing` (the moment within a phase/turn/game), `player_turn`, and a `battle_round` window. A card's section headers map onto these: 'ANY BATTLE ROUND' omits `battle_round`; 'SECOND BATTLE ROUND ONWARDS' is { min: 2 }; 'END OF THE BATTLE' is timing: end-of-battle.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "scoring-trigger".

## Properties

### phase?

> `optional` **phase?**: `"command"` \| `"movement"` \| `"shooting"` \| `"charge"` \| `"fight"`

Defined in: [generated.ts:1587](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1587)

The five official game phases. Unchanged between 10th and 11th edition — 11e reorders Pile In timing within the Fight phase but adds no top-level phase.

***

### timing?

> `optional` **timing?**: `"start-of-turn"` \| `"end-of-turn"` \| `"start-of-phase"` \| `"end-of-phase"` \| `"end-of-battle"`

Defined in: [generated.ts:1591](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1591)

The moment the award is checked. 'End of your turn' = end-of-turn; 'End of your Command phase' = end-of-phase with phase: command; 'End of the battle' = end-of-battle.

***

### player\_turn?

> `optional` **player\_turn?**: [`PlayerTurn`](../type-aliases/PlayerTurn.md)

Defined in: [generated.ts:1592](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1592)

***

### battle\_round?

> `optional` **battle\_round?**: `object`

Defined in: [generated.ts:1596](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1596)

Battle-round window in which the trigger is active. Absent means any battle round (1-5). 'Second battle round onwards' is { min: 2 }.

#### min?

> `optional` **min?**: `number`

#### max?

> `optional` **max?**: `number`
