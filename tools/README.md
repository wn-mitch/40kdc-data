# @alpaca-software/40kdc-data

Published by [Alpaca Software](https://alpacasoft.dev).

TypeScript/JavaScript package for the [40kdc](https://40kdc.alpacasoft.dev) Warhammer 40,000 dataset. It embeds the complete dataset behind a typed, linked API — resolving units to their weapons, abilities, active phases, and faction with no database, network calls, or runtime filesystem access. It runs in Node (20+), bundlers, and browsers.

```ts
import { units } from "@alpaca-software/40kdc-data";

units.find("Kharn")!.abilities
  .filter(a => a.phases.includes("fight"))
  .map(a => a.id); // ["berzerker-frenzy-world-eaters", "legendary-killer-world-eaters"]
```

## Installation

```bash
npm install @alpaca-software/40kdc-data
```

Requires Node 20 or later.

## Dataset API

Top-level exports (`units`, `weapons`, `factions`, `abilities`, `detachments`, `stratagems`, and related collections) wrap the default embedded [`Dataset`](docs/api/data/classes/Dataset.md). Every collection is iterable and provides:

| Method | Returns |
| --- | --- |
| `.all` | All records in the view (deduplicated) |
| `.get(id)` | Record by exact ID |
| `.find(nameOrId)` | First match by ID or normalized name |
| `.findAll(nameOrId)` | All matches (useful for names shared across factions) |
| `.byFaction(id)` | Records belonging to a faction |

Entity views resolve relationships lazily:

- `unit.faction`, `unit.weapons`, `unit.abilities`
- `ability.phases` (joined from `phase-mappings`), `ability.units`
- `weapon.units`
- `faction.units`, `faction.abilities`, `faction.weapons`

The underlying JSON record is always accessible via `.raw`.

### Game Modes

Each `Dataset` is a view over one game mode (`dataset.gameMode`). The default embedded `dataset` and top-level collections use the **matched-play** view:

- Listings and name searches (`all`, iteration, `find`, `findAll`, `byFaction`, and reverse lookups such as `unitsWithKeyword`) skip records whose `game_modes` exclude the active mode (applies to units, weapons, detachments, enhancements, stratagems, wargear options, and unit compositions).
- Exact ID lookups (`get`, `has`, `byExternalRef`) and per-record links resolve every record regardless of view, keeping share tokens and saved rosters resolvable.

```ts
import { dataset } from "@alpaca-software/40kdc-data";

const combatPatrol = dataset.forGameMode("combat-patrol");
const everything = dataset.forGameMode("all");
```

`forGameMode` caches views and throws on unknown mode IDs.

### Name Normalization

`find` and `findAll` ignore case, diacritics, and apostrophe/dash variants (`find("Kharn")` matches `"Khârn the Betrayer"`; `find("Belakor")` matches `"Be'lakor"`). The normalization function is exported as `normalizeName` for reuse in search UIs.

### API Reference and Guides

- [Abilities, DSL, and Descriptions](../docs/guides/abilities.md)
- [Army Lists, Legality, and Share Tokens](../docs/guides/rosters.md)
- [Damage Projection (Crunching)](../docs/guides/crunching.md)
- [Mission Scoring, Terrain, and Validation](../docs/guides/scoring-terrain-validation.md)
- Auto-generated TypeDoc reference: [`docs/api/`](docs/api/README.md)

## Example Applications

Open-source web apps built on this package:

- [List Builder](https://list-builder.alpacasoft.dev) — army list builder with ListForge and NewRecruit import/export.
- [Salvo](https://salvo.alpacasoft.dev) — damage calculator over the cruncher and abilities resolver.
- [Mission Matrix](https://mission-matrix.alpacasoft.dev) — 11th edition Force Disposition matchup grid.
- [Layout Editor](https://layout-editor.alpacasoft.dev) — terrain layout editor exporting terrain-layout JSON.
- [Hull Tracer](https://hull-tracer.alpacasoft.dev) — collision-hull tracer exporting geometry-only hull-shape JSON.

## Damage Calculation and Buff Resolution

### Validating Lever Selections

`Dataset.stackableBuffsFor` returns activatable levers with stable IDs, intersecting activation pools, provider dependencies, and capacity-raise metadata. Validate a proposed lever set with `isLegalLeverSelection` before passing its buffs to `crunch`; summing pool caps independently is not equivalent when pools overlap or a capacity raise applies only to a subset of options.

```ts
import { dataset, isLegalLeverSelection } from "@alpaca-software/40kdc-data";

const { buffs, groups } = dataset.stackableBuffsFor(input, context);
const selectedIds = new Set(buffs.filter(b => b.enabled).map(b => b.id));
if (isLegalLeverSelection(buffs, groups, selectedIds)) {
  // Pass only contributions from a complete, legal selection to crunch().
}
```

Use `id` and `{ ability_id, option_id }` as stable references; display labels and option names are for presentation only.

### Undecided Conditions and Mortal Wounds

Rules that depend on board or game state absent from the engine context (such as whether the target is Below Half-strength or the unit charged this turn) are returned in `needs` by `stackableBuffsFor` (and `defensiveNeedsFor` for defenders). Each need carries a stable `key`; supply answers through `context.conditionFacts[key] = true | false`. Omitted keys remain undecided.

```ts
const { needs } = dataset.stackableBuffsFor(input, context);
const answered = {
  ...context,
  conditionFacts: Object.fromEntries(needs.map(n => [n.key, true])),
};
const { buffs, groups } = dataset.stackableBuffsFor(input, answered);
```

Mortal wounds inflicted on hit or wound rolls translate directly into attack buffs. For mortal wounds inflicted outside an attack (for example, after a Charge move or at the start of a phase), call `Dataset.mortalWoundSourcesFor(input, context)`, which returns each source's timing moment, expected mortal wounds before Feel No Pain, and assumed `needs`.

Every fragment the buff layer cannot model carries a `scope`:

- `out-of-scope` — no damage impact on the attack (movement, Objective Control, etc.).
- `encounter-layer` — acts outside the attack sequence (deaths, out-of-attack mortal wounds, healing, or a later moment).
- `unresolved` — could affect attack damage, but cannot be evaluated by the engine.

## Local-Stack Damage Matrix

`npm run damage:stack` runs a batch damage matrix over the same public APIs as Salvo (`stackableBuffsFor`, `isLegalLeverSelection`, `defensiveBuffsFor`, shared loadout helpers, and `crunch`). It evaluates local combined units (bodyguard plus legal leader/support attachments), up to three detachments within three detachment points, legal enhancements, at most one stratagem, and supporting abilities. It is a per-unit combat evaluator, not a full-army roster optimizer.

By default it runs over `chaos-space-marines,adeptus-mechanicus,death-guard,tau-empire`, all target profiles, and `shooting,fight`. Environment overrides:

- `HC_FACTIONS`, `HC_TARGETS` (`all` or comma-separated IDs), `HC_PHASES`
- `HC_OUTPUT` — path to the JSON report (resumes existing cells only when config, scenario, and a fingerprint of `tools/src` match)
- `HC_SCENARIO` — JSON file specifying board and game state assumed for every cell
- `HC_BODYGUARDS`, `HC_TOP`, `HC_DEEP` — positive integers or `Infinity` (default `Infinity`, preventing silent truncation)

Loadout legality remains exhaustive. Reports include limits, assumptions, lever requirements and costs, supporting units, legal loadouts, defensive warnings, and unsupported mechanics, without embedding source rules text.

## Schema Validation

The package also exports the canonical JSON Schemas and an AJV validator (`createValidator`, `listSchemaIds`) along with the `40kdc-validate` CLI. See the [repository root README](../README.md) for schema details.

## Licensing and Attribution

- **Code (`tools/`):** MIT with attribution requirement — see [`LICENSE-TOOLS`](../LICENSE-TOOLS).
- **Embedded enrichment data (`data/enrichment/`):** CC BY 4.0 — attribute *Alpaca Software and the 40kdc community contributors* (<https://github.com/wn-mitch/40kdc-data>).
- **JSON Schemas:** CC0.

**Public deployment attribution:** Publicly accessible applications or services shipping this package must display a visible credit reading **"Powered by 40kdc-data"** linking to <https://40kdc.alpacasoft.dev> in a user-accessible location (footer, about page, or credits). Private use and library redistribution are exempt.

Stat lines and point costs are numerical facts. Rules text and ability prose are never stored; abilities are community-authored structured mechanics rendered from the Ability DSL.
