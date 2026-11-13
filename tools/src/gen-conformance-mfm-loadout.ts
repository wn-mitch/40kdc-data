/**
 * The `mfm_loadout` corpus: the default unit and wargear legality under each unit's MFM loadout
 * rules, pinned through the runner's `default_mfm_loadout` and `check_mfm_loadout` ops.
 *
 * Every unit with a lifted loadout, in any game mode, contributes its default unit and four checks of it: as is, one
 * copy of its first item more, one fewer, and one copy of that item traded for the first item it
 * can carry but does not by default. Hand-picked cases cover resized rows, checkbox caps, limits,
 * uniform sets and the violation codes.
 */
import { Dataset } from "./data/dataset.js";
import { defaultMfmLoadout, type MfmLoadoutRules } from "./data/mfm-loadout.js";
import { createRunnerState, dispatch, type RunnerState } from "./runner.js";

export interface MfmLoadoutCase {
  name: string;
  args: Record<string, unknown>;
  expected: unknown;
}

type Counts = Record<string, number>;
type Composition = { unit_id: string; faction_id: string; loadout?: MfmLoadoutRules };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (map: ReadonlyMap<string, number>): Counts =>
  Object.fromEntries([...map].sort(([a], [b]) => byCodeUnit(a, b)));

function run(state: RunnerState, op: string, args: Record<string, unknown>): unknown {
  const response = dispatch(state, { op, args });
  if (!response.ok) throw new Error(`${op} ${JSON.stringify(args)}: ${JSON.stringify(response)}`);
  return response.value;
}

/** Every item a model or the unit of `rules` can carry, in code-unit order. */
function carriable(rules: MfmLoadoutRules): string[] {
  const ids = new Set<string>();
  for (const slot of rules.slots) for (const choice of slot.choices) for (const item of choice) ids.add(item.id);
  for (const entry of [...rules.templates, ...rules.stock]) for (const item of entry.items) ids.add(item.id);
  return [...ids].sort(byCodeUnit);
}

/** The four checks of a unit's default: as is, its first item ±1, and that item traded for another. */
function sweepChecks(rules: MfmLoadoutRules): { suffix: string; models: Counts; counts: Counts }[] {
  const { models, counts } = defaultMfmLoadout(rules);
  const out = [{ suffix: "default", models: sorted(models), counts: sorted(counts) }];
  const first = [...counts.keys()].filter((id) => (counts.get(id) ?? 0) > 0).sort(byCodeUnit)[0];
  if (first === undefined) return out;
  const n = counts.get(first)!;
  out.push({ suffix: `${first}+1`, models: sorted(models), counts: sorted(new Map(counts).set(first, n + 1)) });
  out.push({ suffix: `${first}-1`, models: sorted(models), counts: sorted(new Map(counts).set(first, n - 1)) });
  const other = carriable(rules).find((id) => (counts.get(id) ?? 0) === 0);
  if (other !== undefined) {
    const traded = new Map(counts).set(first, n - 1).set(other, 1);
    out.push({ suffix: `${first}->${other}`, models: sorted(models), counts: sorted(traded) });
  }
  return out;
}

/** `[from, to, copies]`: a null `from` adds copies and a null `to` drops them. */
type Swap = [string | null, string | null, number];

/** The default unit with its rows resized (stock copies scaled per model) and `swaps` applied. */
function built(rules: MfmLoadoutRules, rows: Counts, swaps: Swap[]): { models: Counts; counts: Counts } {
  const { models, counts } = defaultMfmLoadout(rules);
  for (const [model, n] of Object.entries(rows)) models.set(model, n);
  let out = counts;
  if (Object.keys(rows).length > 0) {
    out = new Map();
    for (const row of rules.stock) {
      const n = row.model === undefined ? 1 : models.get(row.model) ?? 0;
      const per = row.model === undefined ? 1 : row.models;
      for (const item of row.items) out.set(item.id, (out.get(item.id) ?? 0) + (per > 0 ? (item.count / per) * n : 0));
    }
  }
  for (const [from, to, n] of swaps) {
    if (from !== null) {
      if ((out.get(from) ?? 0) < n) throw new Error(`mfm_loadout: the unit has fewer than ${n} ${from}`);
      out.set(from, out.get(from)! - n);
    }
    if (to !== null) out.set(to, (out.get(to) ?? 0) + n);
  }
  for (const [id, n] of out) if (!Number.isInteger(n)) throw new Error(`mfm_loadout: resizing gives ${n} ${id}`);
  return { models: sorted(models), counts: sorted(out) };
}

/** Hand-picked checks: [name, faction, unit, resized rows, swaps] built on the default unit. */
const CURATED: [string, string, string, Counts, Swap[]][] = [
  ["paladin narthecium once", "grey-knights", "paladin-squad", {}, [["storm-bolter-paladin-squad", "apothecarys-narthecium", 1]]],
  ["paladin narthecium twice", "grey-knights", "paladin-squad", {}, [["storm-bolter-paladin-squad", "apothecarys-narthecium", 2]]],
  ["paladin psycannons at 5 models", "grey-knights", "paladin-squad", { Paladin: 4 }, [["storm-bolter-paladin-squad", "psycannon", 2]]],
  ["catachan flamer and meltagun", "astra-militarum", "catachan-command-squad", {}, [["lasgun", "flamer", 1], ["lasgun", "meltagun", 1]]],
  ["catachan two flamers", "astra-militarum", "catachan-command-squad", {}, [["lasgun", "flamer", 2]]],
  ["tankbustas extra launcha", "orks", "tankbustas", {}, [[null, "busta-rokkit-launcha", 1]]],
  ["tankbustas two extra launchas", "orks", "tankbustas", {}, [[null, "busta-rokkit-launcha", 2]]],
  ["two carnifexes with bio-plasma", "tyranids", "carnifexes", { Carnifex: 2 }, [[null, "bio-plasma", 2]]],
  ["two carnifexes with three bio-plasma", "tyranids", "carnifexes", { Carnifex: 2 }, [[null, "bio-plasma", 3]]],
  ["one carnifex with two bio-plasma", "tyranids", "carnifexes", {}, [[null, "bio-plasma", 2]]],
  // An alternative wargear slot is taken only by one of its choices: no model carries nothing instead.
  ["chaos terminators one model unarmed", "chaos-space-marines", "chaos-terminator-squad", {}, [["accursed-weapon", null, 1], ["combi-bolter", null, 1]]],
  ["chaos terminators one model on paired weapons", "chaos-space-marines", "chaos-terminator-squad", {}, [["accursed-weapon", "paired-accursed-weapons-chaos-terminator-squad", 1], ["combi-bolter", null, 1]]],
  ["immortals all tesla", "necrons", "immortals", {}, [["gauss-blaster", "tesla-carbine", 5]]],
  ["immortals mixed guns", "necrons", "immortals", {}, [["gauss-blaster", "tesla-carbine", 2]]],
  ["breaka boyz pistol and tankhammer", "orks", "breaka-boyz", {}, [["smash-hammer", "rokkit-pistol", 1], ["smash-hammer", "tankhammer", 1]]],
  ["deff dread big shoota", "orks", "deff-dread", {}, [["skorcha", "big-shoota", 1]]],
  ["hive tyrant one stranglethorn", "tyranids", "hive-tyrant", {}, [["monstrous-bonesword-and-lash-whip", "stranglethorn-cannon", 1]]],
  ["hive tyrant two stranglethorns", "tyranids", "hive-tyrant", {}, [["monstrous-bonesword-and-lash-whip", "stranglethorn-cannon", 1], ["monstrous-scything-talons", "stranglethorn-cannon", 1]]],
  ["blightlords combi-weapon at 3 models", "death-guard", "blightlord-terminators", {}, [["combi-bolter", "combi-weapon", 1]]],
  ["thunderkyn two beamers", "leagues-of-votann", "brokhyr-thunderkyn", {}, [["bolt-cannon", "sp-conversion-beamer", 2]]],
  ["thunderkyn three beamers", "leagues-of-votann", "brokhyr-thunderkyn", {}, [["bolt-cannon", "sp-conversion-beamer", 3]]],
  // A limit's per-choice ceiling below its cap.
  ["kasrkin two meltaguns", "astra-militarum", "kasrkin", {}, [["hot-shot-lasgun", "meltagun-kasrkin", 2]]],
  ["kasrkin three meltaguns", "astra-militarum", "kasrkin", {}, [["hot-shot-lasgun", "meltagun-kasrkin", 3]]],
  ["kasrkin meltagun and plasma gun", "astra-militarum", "kasrkin", {}, [["hot-shot-lasgun", "meltagun-kasrkin", 1], ["hot-shot-lasgun", "plasma-gun-kasrkin", 1]]],
  ["cadians two plasma guns", "astra-militarum", "cadian-shock-troops", {}, [["lasgun", "plasma-gun", 2]]],
  ["cadians plasma gun and meltagun", "astra-militarum", "cadian-shock-troops", {}, [["lasgun", "plasma-gun", 1], ["lasgun", "meltagun", 1]]],
  ["skyreavers two fusion guns at 10 models", "aeldari", "corsair-skyreavers", { Skyreaver: 9 }, [["shuriken-pistol", "fusion-gun", 2], ["corsair-blade", "close-combat-weapon-corsair-skyreavers", 2]]],
  ["skyreavers three fusion guns at 10 models", "aeldari", "corsair-skyreavers", { Skyreaver: 9 }, [["shuriken-pistol", "fusion-gun", 3], ["corsair-blade", "close-combat-weapon-corsair-skyreavers", 3]]],
  ["skyreavers four specials at 10 models", "aeldari", "corsair-skyreavers", { Skyreaver: 9 }, [["shuriken-pistol", "fusion-gun", 2], ["shuriken-pistol", "blaster", 1], ["shuriken-pistol", "flamer", 1], ["corsair-blade", "close-combat-weapon-corsair-skyreavers", 4]]],
  ["skyreavers three specials at 5 models", "aeldari", "corsair-skyreavers", {}, [["shuriken-pistol", "fusion-gun", 1], ["shuriken-pistol", "blaster", 1], ["shuriken-pistol", "flamer", 1], ["corsair-blade", "close-combat-weapon-corsair-skyreavers", 3]]],
  // A row's stock copies that do not divide by its models still make each slot a swap.
  ["sanctifiers missionary drops the flamer", "adepta-sororitas", "sanctifiers", {}, [["ministorum-flamer", null, 1], ["sanctifier-melee-weapon", null, 1]]],
  ["sanctifiers both missionaries take plasma", "adepta-sororitas", "sanctifiers", {}, [["ministorum-flamer", "plasma-gun", 1]]],
  ["voidsmen second rotor cannon", "agents-of-the-imperium", "voidsmen-at-arms", {}, [["lasgun", "voidsman-rotor-cannon", 1]]],
  ["voidsmen drop the rotor cannon", "agents-of-the-imperium", "voidsmen-at-arms", {}, [["voidsman-rotor-cannon", null, 1], ["close-combat-weapon-voidsmen-at-arms", null, 1], ["laspistol", null, 1]]],
  ["battleclade gun servitor drops its gun", "adeptus-mechanicus", "servitor-battleclade", {}, [["heavy-bolter", null, 1], ["servo-claw", null, 1]]],
  // An add-on choice with no plain stock sibling: the unticked pistol may stay off, nothing else.
  ["purge corps sulphurhound ticks the pistol", "adeptus-mechanicus", "purge-corps-serberys-sulphurhounds", {}, [[null, "phosphor-pistol-purge-corps-serberys-sulphurhounds", 1]]],
  ["purge corps sulphurhound third extra pistol", "adeptus-mechanicus", "purge-corps-serberys-sulphurhounds", {}, [[null, "phosphor-pistol-purge-corps-serberys-sulphurhounds", 2]]],
  ["purge corps sulphurhound pistol for carbine", "adeptus-mechanicus", "purge-corps-serberys-sulphurhounds", {}, [["phosphor-blast-carbine-purge-corps-serberys-sulphurhounds", "phosphor-pistol-purge-corps-serberys-sulphurhounds", 1]]],
  ["insidiants two simulacrums", "adepta-sororitas", "celestian-insidiants", {}, [[null, "simulacrum-imperialis", 2]]],
  // The default leaves one Noise Marine bare: one may stay bare, two may not.
  ["noise marines blastmasters beside the bare model", "emperors-children", "noise-marines", {}, [["sonic-blaster", "blastmaster", 2]]],
  ["noise marines equip the bare model", "emperors-children", "noise-marines", {}, [[null, "sonic-blaster", 1], [null, "close-combat-weapon-noise-marines", 1]]],
  ["noise marines two bare models", "emperors-children", "noise-marines", {}, [["sonic-blaster", null, 1], ["close-combat-weapon-noise-marines", null, 1]]],
  ["noise marines blaster without a weapon", "emperors-children", "noise-marines", {}, [[null, "sonic-blaster", 1]]],
  // One checkbox for a whole row: one copy, matching "1 Goremonger" and "duplicates are not allowed".
  ["goremongers two blood harpoons", "world-eaters", "goremongers", {}, [["chainblade-goremongers", "blood-harpoon", 2]]],
  ["legionaries plasma gun and meltagun at 10 models", "chaos-space-marines", "legionaries", { Legionary: 9 }, [["boltgun-legionaries", "plasma-gun", 1], ["boltgun-legionaries", "meltagun", 1]]],
  ["legionaries two plasma guns at 10 models", "chaos-space-marines", "legionaries", { Legionary: 9 }, [["boltgun-legionaries", "plasma-gun", 2]]],
];

/**
 * Checks whose counts are written out: the violation codes no built unit reaches, and rows the
 * default unit has no stock for. Rows not given keep their default models.
 */
const RAW: [string, string, string, Counts, Counts?][] = [
  ["deff dread counts no assignment fits", "orks", "deff-dread", { "dread-klaw": 1, "extra-klaw": 1 }],
  ["deff dread foreign lascannon", "orks", "deff-dread", { "big-shoota": 1, "dread-klaw": 1, lascannon: 1, skorcha: 1 }],
  ["three broadsides with missiles and support", "tau-empire", "broadside-battlesuits",
    { "crushing-bulk": 3, "heavy-rail-rifle": 3, "twin-smart-missile-system-broadside-battlesuits": 3, "weapon-support-system": 3 }, { "Broadside Shas’ui": 2 }],
  ["three broadsides with four missile systems", "tau-empire", "broadside-battlesuits",
    { "crushing-bulk": 3, "heavy-rail-rifle": 3, "twin-smart-missile-system-broadside-battlesuits": 4, "weapon-support-system": 2 }, { "Broadside Shas’ui": 2 }],
];

/** Units the MFM does not cover: both ops answer null. */
const UNCOVERED: [string, string][] = [["adeptus-astartes", "vanguard-veteran-squad-with-jump-packs"]];

/** Both corpora, every expected value read back from the TS runner. */
export function canonicalMfmLoadoutCases(dataset: Dataset, specVersion: number): { defaults: MfmLoadoutCase[]; checks: MfmLoadoutCase[] } {
  const state = createRunnerState();
  run(state, "init", { spec_version: specVersion, locale: "C", tz: "UTC", seed: 0 });
  const defaults: MfmLoadoutCase[] = [];
  const checks: MfmLoadoutCase[] = [];
  const compositions = (dataset.forGameMode("all").unitCompositions as readonly Composition[])
    .filter((composition) => composition.loadout)
    .sort((a, b) => byCodeUnit(a.faction_id, b.faction_id) || byCodeUnit(a.unit_id, b.unit_id));
  for (const composition of compositions) {
    const key = { unitId: composition.unit_id, factionId: composition.faction_id };
    const name = `${composition.faction_id}/${composition.unit_id}`;
    defaults.push({ name, args: key, expected: run(state, "default_mfm_loadout", key) });
    for (const check of sweepChecks(composition.loadout!)) {
      const args = { ...key, models: check.models, counts: check.counts };
      checks.push({ name: `${name} ${check.suffix}`, args, expected: run(state, "check_mfm_loadout", args) });
    }
  }
  const rulesOf = (factionId: string, unitId: string) => {
    const rules = compositions.find((row) => row.faction_id === factionId && row.unit_id === unitId)?.loadout;
    if (!rules) throw new Error(`mfm_loadout: ${factionId}/${unitId} has no lifted loadout`);
    return rules;
  };
  for (const [name, factionId, unitId, rows, swaps] of CURATED) {
    const args = { unitId, factionId, ...built(rulesOf(factionId, unitId), rows, swaps) };
    checks.push({ name, args, expected: run(state, "check_mfm_loadout", args) });
  }
  for (const [name, factionId, unitId, counts, rows] of RAW) {
    const { models } = defaultMfmLoadout(rulesOf(factionId, unitId));
    for (const [model, n] of Object.entries(rows ?? {})) models.set(model, n);
    const args = { unitId, factionId, models: sorted(models), counts };
    checks.push({ name, args, expected: run(state, "check_mfm_loadout", args) });
  }
  for (const [factionId, unitId] of UNCOVERED) {
    const key = { unitId, factionId };
    defaults.push({ name: `${factionId}/${unitId} uncovered`, args: key, expected: run(state, "default_mfm_loadout", key) });
    const args = { ...key, models: {}, counts: {} };
    checks.push({ name: `${factionId}/${unitId} uncovered`, args, expected: run(state, "check_mfm_loadout", args) });
  }
  return { defaults, checks };
}
