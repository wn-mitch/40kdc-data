/**
 * The points-value audit: fit the price model to every measured datasheet and judge each unit
 * against it, then render the price list, per-stat and per-keyword prices, and the unit tables.
 *
 * @packageDocumentation
 */
import { DURABILITY_TWEAKS, WEAPON_TWEAKS } from "./marginal.js";
import { CORE_FLAGS, UTILITY_FLAGS, type UnitFeatures } from "./features.js";
import { VALUE_FEATURES, bootstrap, chooseAura, crossValidate, featureNames, featureRow, fitModel, measureFeatures, predict, tweakPoints, type CrossValidation, type PriceModel } from "./fit.js";

export type Chassis = "infantry" | "character" | "vehicle" | "monster";

export function chassisOf(unit: Pick<UnitFeatures, "keywords">): Chassis {
  const has = (keyword: string) => unit.keywords.includes(keyword);
  if (has("Vehicle")) return "vehicle";
  if (has("Monster")) return "monster";
  if (has("Character")) return "character";
  return "infantry";
}

export interface UnitVerdict {
  unitId: string;
  unitName: string;
  factionId: string;
  role: UnitFeatures["role"];
  chassis: Chassis;
  attachedTo?: string;
  /** The nearby unit its rules are priced as reaching, when they reach any. */
  auraNeighbour?: string;
  points: number;
  modelCount: number;
  /** The fitted price of the full datasheet. */
  predicted: number;
  /** The fitted price from a model that never saw this unit (cross-validation). */
  heldOut: number;
  /** The fitted price of the stat line, weapons and chassis alone. */
  statPrice: number;
  /**
   * What the datasheet abilities add to the fitted price, by kind: to the unit's own offense and
   * durability, to the nearby unit's (`aura`), through flags (`utility`) and resources generated.
   */
  abilities: { offense: number; durability: number; aura: number; utility: number; resources: number; total: number };
  /** points − heldOut, and its share of heldOut: positive is overcosted, negative undercosted. */
  residual: number;
  residualShare: number;
  verdict: "undercosted" | "fair" | "overcosted";
  /** Points each what-if change is worth on this unit, by tweak id. */
  tweaks: Record<string, number>;
}

export interface PointsValueReport {
  generatedAt: string;
  units: number;
  model: PriceModel & { low: number[]; high: number[] };
  crossValidation: Omit<CrossValidation, "predictions">;
  verdicts: UnitVerdict[];
}

/** A held-out residual this large a share of the unit's points marks it over- or undercosted. */
export const VERDICT_SHARE = 0.2;

export function priceUnit(model: PriceModel, unit: UnitFeatures, heldOut?: number, aura = chooseAura(model, unit)): Omit<UnitVerdict, "points" | "residual" | "residualShare" | "verdict" | "heldOut"> & { heldOut: number } {
  const own = featureRow(unit, model.names, "full");
  const full = featureRow(unit, model.names, "full", aura?.delta);
  const bare = featureRow(unit, model.names, "bare");
  const contribution = (row: readonly number[], test: (name: string) => boolean) =>
    row.reduce((sum, value, j) => sum + (test(model.names[j]) ? value * model.coefficients[j] : 0), 0);
  const isOffense = (name: string) => name.startsWith("shoot-") || name.startsWith("fight-");
  const isDurability = (name: string) => name.startsWith("dur-");
  const isFlag = (name: string) => name.startsWith("flag:");
  const isResource = (name: string) => name === "cp" || name === "resource";
  const offense = contribution(own, isOffense) - contribution(bare, isOffense);
  const durability = contribution(own, isDurability) - contribution(bare, isDurability);
  const auraPoints = predict(model, full) - predict(model, own);
  const utility = contribution(full, isFlag) - contribution(bare, isFlag);
  const resources = contribution(full, isResource);
  const predicted = predict(model, full);
  return {
    unitId: unit.unitId,
    unitName: unit.unitName,
    factionId: unit.factionId,
    role: unit.role,
    chassis: chassisOf(unit),
    ...(unit.attachedTo ? { attachedTo: unit.attachedTo } : {}),
    ...(aura ? { auraNeighbour: aura.neighbourId } : {}),
    modelCount: unit.modelCount,
    predicted,
    heldOut: heldOut ?? predicted,
    statPrice: predict(model, bare),
    abilities: { offense, durability, aura: auraPoints, utility, resources, total: offense + durability + auraPoints + utility + resources },
    tweaks: Object.fromEntries(Object.entries(unit.tweaks).map(([id, delta]) => [id, tweakPoints(model, delta)])),
  };
}

export function buildReport(units: readonly UnitFeatures[]): PointsValueReport {
  const priced = units.filter((unit): unit is UnitFeatures & { points: number } => unit.points !== null && unit.points > 0);
  const names = featureNames(priced);
  const points = priced.map((unit) => unit.points);
  // Which nearby unit a provider's rules are worth the most on depends on the prices, so a first
  // fit without auras picks each provider's neighbour, and the model is fitted again with it.
  const first = fitModel(names, priced.map((unit) => featureRow(unit, names, "full")), points);
  const titanic = new Set(units.filter((unit) => unit.keywords.includes("Titanic")).map((unit) => unit.unitId));
  const auras = priced.map((unit) => chooseAura(first, unit, titanic));
  const rows = priced.map((unit, i) => featureRow(unit, names, "full", auras[i]?.delta));
  const model = fitModel(names, rows, points);
  const interval = bootstrap(names, rows, points);
  const cv = crossValidate(names, rows, points);
  const verdicts = priced.map((unit, i): UnitVerdict => {
    const priced = priceUnit(model, unit, cv.predictions[i], auras[i]);
    const residual = unit.points - priced.heldOut;
    const residualShare = residual / Math.max(1, priced.heldOut);
    return {
      ...priced,
      points: unit.points,
      residual,
      residualShare,
      verdict: residualShare > VERDICT_SHARE ? "overcosted" : residualShare < -VERDICT_SHARE ? "undercosted" : "fair",
    };
  });
  const { predictions: _predictions, ...crossValidation } = cv;
  return { generatedAt: new Date().toISOString(), units: priced.length, model: { ...model, ...interval }, crossValidation, verdicts };
}

const round = (value: number, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const signed = (value: number, digits = 0) => `${value >= 0 ? "+" : ""}${round(value, digits)}`;
const pct = (value: number) => `${signed(value * 100)}%`;

function quantiles(values: readonly number[]): { n: number; median: number; p25: number; p75: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
  return { n: sorted.length, median: at(0.5), p25: at(0.25), p75: at(0.75) };
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

const CHASSIS: readonly Chassis[] = ["infantry", "character", "vehicle", "monster"];

function tweakTable(report: PointsValueReport, tweaks: readonly { id: string; label: string }[]): string {
  return table(
    ["Change", ...CHASSIS.map((c) => `${c} (median, IQR)`)],
    tweaks.map((tweak) => [tweak.label, ...CHASSIS.map((chassis) => {
      const values = report.verdicts.filter((v) => v.chassis === chassis && tweak.id in v.tweaks).map((v) => v.tweaks[tweak.id]);
      const q = quantiles(values);
      return q.n === 0 ? "—" : `${round(q.median)} (${round(q.p25)}–${round(q.p75)}), n=${q.n}`;
    })]),
  );
}

function unitRows(verdicts: readonly UnitVerdict[]): string[][] {
  return verdicts.map((v) => [
    `${v.unitName}${v.attachedTo ? ` (on ${v.attachedTo})` : ""}`,
    v.factionId,
    String(v.points),
    round(v.heldOut),
    pct(v.residualShare),
    round(v.statPrice),
    signed(v.abilities.total),
  ]);
}

const UNIT_HEADER = ["Unit", "Faction", "Pts", "Fair price", "Pts vs fair price", "Stat-line price", "Abilities add"];

export function renderMarkdown(report: PointsValueReport): string {
  const { model, crossValidation: cv } = report;
  const coefficient = (name: string) => {
    const j = model.names.indexOf(name);
    return j < 0 ? "—" : `${round(model.coefficients[j], 2)} (${round(model.low[j], 2)} to ${round(model.high[j], 2)})`;
  };
  const byResidual = [...report.verdicts].sort((a, b) => a.residualShare - b.residualShare);
  const under = byResidual.filter((v) => v.verdict === "undercosted").slice(0, 30);
  const over = byResidual.filter((v) => v.verdict === "overcosted").reverse().slice(0, 30);
  const abilityShare = (v: UnitVerdict) => v.abilities.total / Math.max(1, v.predicted);
  const abilitiesCarry = report.verdicts
    .filter((v) => v.statPrice < 0.75 * v.points && v.verdict !== "overcosted")
    .sort((a, b) => abilityShare(b) - abilityShare(a)).slice(0, 25);
  const statsCarry = report.verdicts
    .filter((v) => v.statPrice >= v.points && v.abilities.total < 0.1 * v.points)
    .sort((a, b) => b.statPrice / b.points - a.statPrice / a.points).slice(0, 25);
  const keywordIds = [...new Set(report.verdicts.flatMap((v) => Object.keys(v.tweaks).filter((id) => id.startsWith("drop:"))))].sort();
  const worth = keywordIds.map((id) => {
    const values = report.verdicts.filter((v) => id in v.tweaks).map((v) => -v.tweaks[id]);
    const shares = report.verdicts.filter((v) => id in v.tweaks).map((v) => -v.tweaks[id] / v.points);
    return { id: id.slice(5), q: quantiles(values), share: quantiles(shares).median };
  }).filter((entry) => entry.q.n >= 5).sort((a, b) => b.q.median - a.q.median);
  const headToHead = report.verdicts.filter((v) => "add:lethal-hits" in v.tweaks && "add:sustained-hits" in v.tweaks);
  const lethalWins = headToHead.filter((v) => v.tweaks["add:lethal-hits"] > v.tweaks["add:sustained-hits"]).length;

  return `# Points per datasheet item

Generated by \`npm run audit:points-value\` on ${report.generatedAt.slice(0, 10)}. Every current, priced, matched-play
datasheet (${report.units} units) is priced at its first copy and its full model count, at the most efficient setup
the damage hill climb finds: its best legal wargear and its own datasheet levers, and for a Leader or Support unit the
bodyguard it adds the most to. Army rules, detachments, Stratagems and other units' auras are left out, so this prices
the datasheet alone; the faction terms absorb what each army's rules are worth on average.

**What the numbers are:** a robust linear fit of GW's points on what each datasheet measurably does. A unit's
"fair price" is what the fit charges for it when the unit is left out of the fit. "Over/under" compares its real
points to that price. This shows how GW appears to price things and where a unit departs from it, not how strong it
is in play.

## Fit quality

${table(["Held-out folds", "Mean abs error", "Median error share", "R²"], [[String(cv.folds), `${round(cv.mae)} pts`, pct(cv.medianRelativeError).replace("+", "±"), round(cv.r2, 2)]])}

A unit is marked over- or undercosted when its points are more than ${VERDICT_SHARE * 100}% above or below its fair price.
Typical error is ±${round(cv.mae)} pts, so treat a cheap unit's percentage with care.

## Price list

Points per unit of each measured feature, with its 90% bootstrap interval.

${table(["Feature", "Points per", "Pts (90% interval)"], VALUE_FEATURES.map((feature) => [feature.label, feature.per, coefficient(feature.id)]))}

${table(["Rule or keyword", "Pts (90% interval)"], [
    ...[...CORE_FLAGS, ...UTILITY_FLAGS].map((flag) => [`Has ${flag}`, coefficient(`flag:${flag}`)]),
    ["Leader role", coefficient("role:leader")],
    ["Support role", coefficient("role:support")],
  ])}

Utility flags (mobility, control, aura and so on) mark datasheet abilities whose effect no damage number captures;
their prices are the average across very different rules and have wide intervals.

## What a stat is worth

Points one change adds to a unit under the price list, measured by re-crunching that unit with the change. Weapon
changes apply to every weapon its best setup fires.

### Durability

${tweakTable(report, DURABILITY_TWEAKS)}

### Weapons

${tweakTable(report, WEAPON_TWEAKS)}

Adding Lethal Hits is worth more than adding Sustained Hits 1 on ${lethalWins} of ${headToHead.length} units.

### What the keywords a unit already has are worth

${table(["Keyword", "Units", "Median pts", "IQR", "Median share of unit cost"], worth.map((entry) => [entry.id, String(entry.q.n), round(entry.q.median), `${round(entry.q.p25)}–${round(entry.q.p75)}`, pct(entry.share)]))}

## Undercosted

${table(UNIT_HEADER, unitRows(under))}

## Overcosted

${table(UNIT_HEADER, unitRows(over))}

## Priced mostly for its abilities

Units whose stat line, weapons and chassis alone are worth under 75% of their points and are not overcosted: their
datasheet abilities carry the price.

${table(UNIT_HEADER, unitRows(abilitiesCarry))}

## Strong stat line, little from abilities

Units whose stat line alone already covers their points and whose abilities add under 10%.

${table(UNIT_HEADER, unitRows(statsCarry))}

## Caveats

- Offense is expected wounds against six reference targets in favourable conditions (within half range, stationary or
  charging), with no army rules; durability is reference attacks to destroy the unit, with its own datasheet
  defences.
- Rules with no damage effect are priced only by the flag they raise, so a unique ability's real worth hides in the
  residual.
- Weapon what-ifs are crunched without ability buffs.
- Per-unit numbers for every unit, and the full coefficient list, are in \`points-value.json\`.
`;
}

/** The `count` measured units nearest `unit` in value features, as a sanity anchor for a custom price. */
export function nearestUnits(units: readonly UnitFeatures[], unit: UnitFeatures, count = 5): UnitFeatures[] {
  const vector = (u: UnitFeatures) => ({ ...measureFeatures(u.full), M: u.M, OC: u.OC });
  const all = units.filter((u) => u.points !== null).map(vector);
  const keys = Object.keys(vector(unit));
  const scale = Object.fromEntries(keys.map((key) => {
    const values = all.map((v) => v[key as keyof typeof v]);
    const m = values.reduce((s, x) => s + x, 0) / values.length;
    return [key, Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length) || 1];
  }));
  const target = vector(unit);
  const distance = (u: UnitFeatures) => {
    const v = vector(u);
    return keys.reduce((sum, key) => sum + ((v[key as keyof typeof v] - target[key as keyof typeof v]) / scale[key]) ** 2, 0)
      + (chassisOf(u) === chassisOf(unit) ? 0 : 4);
  };
  return units.filter((u) => u.points !== null && u.unitId !== unit.unitId).sort((a, b) => distance(a) - distance(b)).slice(0, count);
}
