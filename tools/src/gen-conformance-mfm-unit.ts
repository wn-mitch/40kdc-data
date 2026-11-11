/**
 * The `mfm_loadout` unit corpus: a unit at a total model count under its MFM loadout, pinned
 * through the runner's `mfm_unit`, `mfm_assignment` and `check_mfm_unit` ops.
 *
 * Every unit with a lifted loadout contributes `mfm_unit` at its smallest and largest size, and
 * at the first size between them no tier builds when there is one; its base loadout's assignment
 * and check at its smallest size, with one copy of its first item more and one fewer, and its
 * first candidate configuration's. Hand-picked
 * units list deeper candidate lists, a few are pinned at every size, and fabricated compositions
 * (passed inline as `composition`) pin the split and base rules no real unit separates.
 */
import type { Dataset } from "./data/dataset.js";
import type { MfmComposition } from "./data/mfm-loadout-unit.js";
import { createRunnerState, dispatch, type RunnerState } from "./runner.js";
import type { MfmLoadoutCase } from "./gen-conformance-mfm-loadout.js";

type Composition = MfmComposition & { unit_id: string; faction_id: string };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function run(state: RunnerState, op: string, args: Record<string, unknown>): unknown {
  const response = dispatch(state, { op, args });
  if (!response.ok) throw new Error(`${op} ${JSON.stringify(args)}: ${JSON.stringify(response)}`);
  return response.value;
}

/** The smallest and largest sizes any tier builds. */
function sizeRange(composition: Composition): { low: number; high: number } {
  const tiers = composition.tiers && composition.tiers.length > 0 ? composition.tiers.map((tier) => tier.models) : [composition.models];
  const lows = tiers.map((tier) => tier.reduce((sum, model) => sum + model.min, 0));
  const highs = tiers.map((tier) => tier.reduce((sum, model) => sum + model.max, 0));
  return { low: Math.max(1, Math.min(...lows)), high: Math.max(...highs) };
}

/** Units listed 32 candidates deep: pooled specials, uniform sets, swaps and unit-wide picks. */
const DEEP: [string, string, number][] = [
  ["orks", "boyz", 10],
  ["astra-militarum", "cadian-shock-troops", 20],
  ["chaos-space-marines", "legionaries", 10],
  ["grey-knights", "purifier-squad", 7],
  ["aeldari", "corsair-voidscarred", 7],
  ["necrons", "immortals", 10],
  ["astra-militarum", "death-korps-of-krieg", 20],
  ["tau-empire", "commander-in-coldstar-battlesuit", 1],
];

/** Units pinned at every size their range spans. */
const EVERY_SIZE: [string, string][] = [
  ["chaos-space-marines", "accursed-cultists"],
  ["agents-of-the-imperium", "voidsmen-at-arms"],
  ["astra-militarum", "cadian-command-squad"],
];

/** A fabricated loadout with stock rows only; slots and the rest default to empty. */
const loadout = (stock: { model?: string; models: number; items?: { id: string; count: number }[] }[], extra: Record<string, unknown> = {}) => ({
  stock: stock.map((row) => ({ ...row, items: row.items ?? [] })),
  templates: [],
  slots: [],
  limits: [],
  options: [],
  uniform: [],
  ...extra,
});

/**
 * Fabricated compositions for the split and base rules no real unit separates: [name, model
 * counts, composition].
 */
const FABRICATED: [string, number[], Record<string, unknown>][] = [
  // Two rows tie on default models: the first in stock order grows first.
  ["tied rows", [5, 9], {
    models: [{ name: "Left", min: 2, max: 5 }, { name: "Right", min: 2, max: 5 }],
    loadout: loadout([{ model: "Left", models: 2 }, { model: "Right", models: 2 }]),
  }],
  // A default above its tier's range is clamped down; one inside it is kept.
  ["clamped defaults", [4, 6], {
    models: [{ name: "Adept", min: 0, max: 1 }, { name: "Trooper", min: 3, max: 6 }],
    tiers: [{ models: [{ name: "Adept", min: 0, max: 0 }, { name: "Trooper", min: 3, max: 4 }] }, { models: [{ name: "Adept", min: 1, max: 1 }, { name: "Trooper", min: 5, max: 6 }] }],
    loadout: loadout([{ model: "Adept", models: 1 }, { model: "Trooper", models: 4 }]),
  }],
  // Rows start from their defaults, not their minimums: at the default size nothing moves.
  ["defaults kept", [7, 9], {
    models: [{ name: "Left", min: 1, max: 6 }, { name: "Right", min: 1, max: 6 }],
    loadout: loadout([{ model: "Left", models: 4 }, { model: "Right", models: 3 }]),
  }],
  // An optional row sorted first has room too, but the row with the most default models grows.
  ["bulk after specialist", [5, 10], {
    models: [{ name: "Adept", min: 0, max: 1 }, { name: "Trooper", min: 4, max: 9 }],
    loadout: loadout([{ model: "Adept", models: 0 }, { model: "Trooper", models: 4 }]),
  }],
  // name#k reads the k-th row of that name, not their sum: only the second row can grow.
  ["numbered rows", [2, 4, 5], {
    models: [{ name: "Guard", min: 1, max: 1 }, { name: "Guard", min: 1, max: 3 }],
    loadout: loadout([{ model: "Guard#1", models: 1 }, { model: "Guard#2", models: 1 }]),
  }],
  // A unit-wide limit whose only choice is two copies, filled one copy per row: the first row
  // alone holds one copy, which no sum of choices equals but one choice covers, so a partial
  // total is cut only when no sum can cover it.
  ["unit limit across rows", [2], {
    models: [{ name: "Left", min: 1, max: 1 }, { name: "Right", min: 1, max: 1 }],
    loadout: loadout([{ model: "Left", models: 1 }, { model: "Right", models: 1 }], {
      slots: [
        { model: "Left", picks: 1, repeats: false, alternate: false, choices: [[{ id: "pair-gun", count: 1 }]] },
        { model: "Right", picks: 1, repeats: false, alternate: false, choices: [[{ id: "pair-gun", count: 1 }]] },
      ],
      limits: [{ breakpoints: [{ models: 0, choices: 1 }], choices: [[{ id: "pair-gun", count: 2 }]] }],
    }),
  }],
  // Neither the resized nor the scaled default fits the only slot: the resized one is reported.
  ["illegal fallback", [2, 3], {
    models: [{ name: "Trooper", min: 2, max: 3 }],
    loadout: loadout([{ model: "Trooper", models: 2, items: [{ id: "old-gun", count: 2 }] }], {
      templates: [{ model: "Trooper", items: [{ id: "new-gun", count: 1 }] }],
      slots: [{ model: "Trooper", picks: 1, repeats: false, alternate: false, choices: [[{ id: "only-gun", count: 1 }]] }],
    }),
  }],
];

/** All three corpora, every expected value read back from the TS runner. */
export function canonicalMfmUnitCases(
  dataset: Dataset,
  specVersion: number,
): { units: MfmLoadoutCase[]; assignments: MfmLoadoutCase[]; unitChecks: MfmLoadoutCase[] } {
  const state = createRunnerState();
  run(state, "init", { spec_version: specVersion, locale: "C", tz: "UTC", seed: 0 });
  const units: MfmLoadoutCase[] = [];
  const assignments: MfmLoadoutCase[] = [];
  const unitChecks: MfmLoadoutCase[] = [];
  const compositions = (dataset.forGameMode("all").unitCompositions as readonly Composition[])
    .filter((composition) => composition.loadout)
    .sort((a, b) => byCodeUnit(a.faction_id, b.faction_id) || byCodeUnit(a.unit_id, b.unit_id));
  const unitCase = (composition: Composition, modelCount: number, limit: number, suffix = "") => {
    const args = { unitId: composition.unit_id, factionId: composition.faction_id, modelCount, limit };
    units.push({ name: `${composition.faction_id}/${composition.unit_id}@${modelCount}${suffix}`, args, expected: run(state, "mfm_unit", args) });
  };
  for (const composition of compositions) {
    const { low, high } = sizeRange(composition);
    const sizes = [...new Set([low, high])];
    for (const n of sizes) unitCase(composition, n, 2);
    for (let n = low + 1; n < high; n++) {
      const probe = run(state, "mfm_unit", { unitId: composition.unit_id, factionId: composition.faction_id, modelCount: n, limit: 0 }) as { rows: unknown } | null;
      if (probe?.rows === null) {
        unitCase(composition, n, 2);
        break;
      }
    }

    const at = run(state, "mfm_unit", { unitId: composition.unit_id, factionId: composition.faction_id, modelCount: low, limit: 1 }) as {
      base: { counts: Record<string, number> } | null;
      candidates: string[];
    } | null;
    const base = at?.base?.counts;
    if (!base) continue;
    const first = Object.keys(base).sort(byCodeUnit)[0];
    const variants: [string, Record<string, number>][] = [["base", base]];
    if (first !== undefined) {
      variants.push([`${first}+1`, { ...base, [first]: base[first] + 1 }]);
      variants.push([`${first}-1`, { ...base, [first]: base[first] - 1 }]);
    }
    // The search's first configuration: legal, and usually not the base.
    const candidate = at?.candidates[0]?.split(" => ")[1];
    if (candidate) {
      variants.push(["first-candidate", Object.fromEntries(candidate.split(",").map((pair) => {
        const [id, n] = pair.split(":");
        return [id, Number(n)];
      }))]);
    }
    for (const [suffix, counts] of variants) {
      const args = { unitId: composition.unit_id, factionId: composition.faction_id, modelCount: low, counts };
      const name = `${composition.faction_id}/${composition.unit_id}@${low} ${suffix}`;
      assignments.push({ name, args, expected: run(state, "mfm_assignment", args) });
      unitChecks.push({ name, args, expected: run(state, "check_mfm_unit", args) });
    }
  }
  const find = (factionId: string, unitId: string) => {
    const found = compositions.find((composition) => composition.faction_id === factionId && composition.unit_id === unitId);
    if (!found) throw new Error(`mfm_loadout: ${factionId}/${unitId} has no lifted loadout`);
    return found;
  };
  for (const [factionId, unitId, n] of DEEP) unitCase(find(factionId, unitId), n, 32, " deep");
  // Without `limit`, the runner lists 4 candidates.
  units.push({ name: "orks/boyz@10 default limit", args: { unitId: "boyz", factionId: "orks", modelCount: 10 }, expected: run(state, "mfm_unit", { unitId: "boyz", factionId: "orks", modelCount: 10 }) });
  for (const [factionId, unitId] of EVERY_SIZE) {
    const composition = find(factionId, unitId);
    const { low, high } = sizeRange(composition);
    for (let n = low; n <= high; n++) unitCase(composition, n, 2, " sized");
  }
  for (const [name, sizes, composition] of FABRICATED) {
    for (const modelCount of sizes) {
      const args = { composition, modelCount, limit: 2 };
      units.push({ name: `fabricated ${name}@${modelCount}`, args, expected: run(state, "mfm_unit", args) });
    }
  }
  const args = { unitId: "deff-dread", factionId: "orks", modelCount: 1, counts: { lascannon: 1 } };
  unitChecks.push({ name: "orks/deff-dread@1 foreign lascannon", args, expected: run(state, "check_mfm_unit", args) });
  return { units, assignments, unitChecks };
}
