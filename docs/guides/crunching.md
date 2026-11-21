# Damage Projection (Crunching)

`40kdc-data` includes a deterministic, closed-form expected-value combat engine — no Monte Carlo sampling, no I/O, and pinned across TypeScript, Rust, Python, and Go within `±5e-4` per stage. It connects directly to the Ability DSL so you can evaluate real unit loadouts, detachment buffs, stratagems, defensive rules, leave-one-out attribution, and exact models-destroyed distributions.

## Basic Expected-Value Crunch

`crunch` evaluates one attacking weapon profile against a target unit profile across seven ordered stages:

`attacks -> hits -> wounds -> unsaved -> damage -> after-fnp -> models-killed`

```ts
import { crunch, dataset, units, weapons } from "@alpaca-software/40kdc-data";

const weapon = weapons.find("Bolt Rifle")!;
const target = units.find("Intercessor Squad")!;

const result = crunch(
  {
    attacker: { weapon: weapon.raw, profileIndex: 0 },
    target: { unit: target.raw, profileIndex: 0 },
    modelsFiring: 5,
    buffs: [],
    context: {
      phase: "shooting",
      attackerStationary: false,
      withinHalfRange: false,
    },
  },
  dataset,
);

for (const stage of result.stages) {
  console.log(`${stage.name}: ${stage.expected.toFixed(3)}`);
}
```

Weapon keywords printed on the profile (`[LETHAL HITS]`, `[SUSTAINED HITS N]`, `[DEVASTATING WOUNDS]`, `[ANTI-X N+]`, `[TORRENT]`, `[TWIN-LINKED]`, `[RAPID FIRE N]`, `[MELTA N]`, `[BLAST]`, `[HEAVY]`, `[IGNORES COVER]`, etc.) are applied automatically.

## Pulling Buffs and Levers from the Ability DSL

Rather than hand-building `Buff` objects, use `dataset.stackableBuffsFor` (offensive) and `dataset.defensiveBuffsFor` (defensive) to translate a unit's eligible abilities, detachment rules, enhancements, attached leaders, and stratagems directly from the Ability DSL.

Because abilities can share overlapping activation pools (choices, stances, once-per-phase limits, or capacity raises), validate any proposed set of opt-in levers with `isLegalLeverSelection` before passing their contributions to `crunch`:

```ts
import { dataset, isLegalLeverSelection } from "@alpaca-software/40kdc-data";

const context = {
  phase: "shooting" as const,
  distanceInches: 18,
  attackerStationary: false,
  withinHalfRange: false,
};

const { buffs, groups } = dataset.stackableBuffsFor(
  {
    unitId: "intercessor-squad",
    factionId: "adeptus-astartes",
    detachmentId: "gladius-task-force",
    attachedLeaderIds: ["lieutenant"],
  },
  context,
);

const selectedIds = new Set(buffs.filter(b => b.enabled).map(b => b.id));
if (isLegalLeverSelection(buffs, groups, selectedIds)) {
  const offensiveBuffs = buffs
    .filter(b => selectedIds.has(b.id))
    .flatMap(b => b.contributions);

  const defensiveBuffs = dataset.defensiveBuffsFor(
    { unitId: "intercessor-squad", factionId: "adeptus-astartes" },
    context,
  );

  const allBuffs = [...offensiveBuffs, ...defensiveBuffs];
}
```

Use lever `id` and `{ ability_id, option_id }` as stable programmatic references; display labels are for UI presentation only.

## Answering Undecided Conditions (`needs`)

Board- and game-state conditions that are absent from `context` (for example, whether the target is Below Half-strength or the attacking unit charged this turn) are never guessed. Instead, `stackableBuffsFor` returns each undecided leaf condition in `needs` (and `defensiveNeedsFor` does the same for defenders), each with a stable `key`. Supply answers through `context.conditionFacts`:

```ts
const { needs } = dataset.stackableBuffsFor(input, context);

const answeredContext = {
  ...context,
  conditionFacts: Object.fromEntries(needs.map(n => [n.key, true])),
};

const resolved = dataset.stackableBuffsFor(input, answeredContext);
```

Any omitted key remains undecided.

### Unsupported Fragment Scopes

Every DSL fragment that the buff layer cannot translate into a damage modifier carries a `scope`:

- **`out-of-scope`:** Has no direct attack-damage impact (movement, Scouts, Objective Control, etc.).
- **`encounter-layer`:** Acts outside the attack sequence (out-of-attack mortal wounds, healing, post-attack triggers, designations).
- **`unresolved`:** Could affect attack damage, but cannot be evaluated by the current engine.

## Per-Buff Attribution (`attributeStages`)

`attributeStages` runs leave-one-out decomposition over the buff stack, returning each stage's baseline (intrinsic weapon keywords only), per-source lifts, and any residual from cap collisions (such as two `+1 to Hit` sources sharing the `±1` cap):

```ts
import { attributeStages } from "@alpaca-software/40kdc-data";

const stages = attributeStages(engineInput, dataset);
for (const stage of stages) {
  console.log(stage.name, {
    baseline: stage.baseline,
    expected: stage.expected,
    residual: stage.residual,
    lifts: stage.lifts,
  });
}
```

## Exact Wound Allocation (`allocate`)

While `crunch` computes fast expected values, `allocate` computes the exact sequential wound-allocation probability distribution (tracking overkill lost per model, Feel No Pain, mortal wounds on rolls, Devastating Wounds ordering, and damage zeroing):

```ts
import { allocate } from "@alpaca-software/40kdc-data";

const exact = allocate(engineInput, dataset);
console.log("Expected models destroyed:", exact.modelsDestroyed);
console.log("Probability distribution [0..N]:", exact.modelsDestroyedDistribution);
```

`allocate` returns an explicit error rather than silently approximating if an unmodelled single-die re-roll (`reroll-one`) is active or if the exact event table exceeds `MAX_EVENT_WORK` (`1,000,000`).

## Out-of-Attack Mortal Wounds

Mortal wounds triggered on hit or wound rolls are handled as attack buffs inside `crunch` and `allocate`. For mortal wounds inflicted outside an attack (such as after a Charge move or at the start of a phase), call `dataset.mortalWoundSourcesFor`:

```ts
const mortals = dataset.mortalWoundSourcesFor(
  { unitId: "screamer-killer", factionId: "tyranids" },
  { phase: "charge" },
);

for (const source of mortals.sources) {
  console.log(source.abilityId, source.moment, source.expected, source.needKeys);
}
```

## Whole-Loadout Damage and Target Profiles

When scoring an entire unit's weapon loadout rather than a single profile, total damage across all firing weapon lines before converting to models killed once (summing per-weapon kills over-counts due to per-line capping):

- `scoreLoadoutWeapons` / `unitLoadoutDamage` handle multi-weapon loadouts, Pistol rules, and single-melee-weapon selection consistently with the batch damage matrix (`npm run damage:stack`).
- `targetProfiles` provides standard benchmark defender profiles (resolved to real faction-scoped units) for cross-unit comparisons.
