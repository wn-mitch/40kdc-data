/**
 * Stack damage search: hill-climb every legal stack for one faction against one
 * target profile, and print the winner's weapons, stacked abilities and
 * per-weapon damage.
 *
 * \`npm run damage:stack\` — environment knobs: HC_CHAPTERS (comma-separated
 * chapter ids), HC_BODYGUARDS (cap the bodyguard scan), HC_TOP (attachments kept
 * per role), HC_DEEP (finalists re-optimised over every detachment combination),
 * HC_DETAIL=1 (print the winner's full breakdown + verify it), HC_DEBUG=1,
 * HC_DROP_RULE=<ids> (remove faction rules from the stack),
 * HC_PROBE=1 (print each winner's detachment marginal values).
 *
 * Stage 1 — legal maximal wargear loadout per unit: hill-climb from the base
 *           bag, applying one instance of an option branch at a time, gated by
 *           `data/loadout.ts`'s bounds/budget predicate and confirmed by
 *           `validateLoadout`.
 * Stage 2 — chapter-coherent stack search vs the `meq-intercessors` target:
 *           bodyguard + leader + support, <=3 detachment points of detachment
 *           rules, one enhancement per CHARACTER, at most one stratagem, and
 *           every friendly aura the chapter can field.
 *
 * The engine's `after-fnp` stage is exactly linear in `modelsFiring`, so a
 * weapon's contribution is `perModel × count` and bag scoring is a dot product.
 */
import { Dataset } from "./data/dataset.js";
import { crunch, profileCanTarget, type Buff, type BuffSource, type EngineContext } from "./cruncher/index.js";
import { resolveTarget, type ComparePhase } from "./compare.js";
import { isMeleeProfile } from "./data/weapon-profile.js";
import {
  baseLoadout,
  optionCap,
  validateLoadout,
  weaponBounds,
  type LoadoutModel,
  type LoadoutTier,
  type WeaponBound,
} from "./data/loadout.js";
import type { Phase, Unit, WargearOption, Weapon } from "./generated.js";

const ds = Dataset.embedded();
const ROOT_FACTION = "adeptus-astartes";
const DP_BUDGET = 3;
const MAX_DETACHMENTS = 3;
/** How many of each attachment role survive the marginal-gain prefilter (plus "none"). */
const TOP_ATTACHMENTS = Number(process.env.HC_TOP ?? 3);
const DEBUG = process.env.HC_DEBUG === "1";

// ---------------------------------------------------------------------------
// MEQ target
// ---------------------------------------------------------------------------
const meq = resolveTarget(ds, ds.targetProfiles.get("meq-intercessors")!)!;
const meqProfile = meq.unitRaw.profiles[0];
const MEQ_LABEL = `${meq.unitRaw.name} ×${meq.modelCount} (T${meqProfile.T}/W${meqProfile.W}/Sv${meqProfile.Sv}+)`;

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------
const CHAPTER_IDS: string[] = [ROOT_FACTION];
for (const f of ds.factions.all) {
  if (f.raw.parent_faction_id === ROOT_FACTION) CHAPTER_IDS.push(f.id);
}

/**
 * Chapter ids are kebab-case (`blood-angels`); `faction_keywords` carries the
 * display form (`Blood Angels`). Map between them via each faction's own
 * keyword list, minus the two that every Adeptus Astartes unit shares.
 */
const CHAPTER_KEYWORD = new Map<string, string>();
const CHAPTER_FOR_KEYWORD = new Map<string, string>();
for (const id of CHAPTER_IDS) {
  const keyword = (ds.factions.get(id)?.raw.keywords ?? []).find(
    (k) => k !== "Imperium" && k !== "Adeptus Astartes",
  );
  if (!keyword) continue;
  CHAPTER_KEYWORD.set(id, keyword);
  CHAPTER_FOR_KEYWORD.set(keyword, id);
}

/** The chapter display keywords a unit carries (empty for a chapter-neutral unit). */
function chapterKeywordsOf(unit: Unit): string[] {
  return (unit.faction_keywords ?? []).filter((k) => CHAPTER_FOR_KEYWORD.has(k));
}

/** A unit is legal in chapter C when every chapter keyword it carries is C. */
function legalInChapter(unit: Unit, chapter: string): boolean {
  return chapterKeywordsOf(unit).every((k) => CHAPTER_FOR_KEYWORD.get(k) === chapter);
}

function isCharacter(unit: Unit): boolean {
  return (unit.keywords ?? []).some((k) => k.toLowerCase() === "character");
}

const ALL_UNITS = ds.units.all.filter((u) => u.raw.faction_id === ROOT_FACTION);

/**
 * Units whose `unit-compositions.json` rows each carry the UNION of every row's
 * `default_weapon_ids`, so every model is credited with every distinct model
 * type's wargear. Detected as: >=3 composition rows, all with an identical
 * non-empty weapon set, whose names are distinct model types (not a
 * "<Unit> Sergeant" + bulk pair). Excluded from ranking and reported separately.
 */
const UNION_FLATTENED_COMPOSITIONS = new Set(["wardens-of-ultramar", "victrix-honour-guard", "company-heroes"]);

// ---------------------------------------------------------------------------
// Weapon scoring
// ---------------------------------------------------------------------------
interface WeaponScore {
  profileIndex: number;
  profileName: string;
  perModel: number;
  stages: { name: string; expected: number }[];
}

function resolveWeapon(unit: Unit, weaponId: string): Weapon | undefined {
  return ds.weapons.getInFaction(weaponId, unit.faction_id)?.raw ?? ds.weapons.getAny(weaponId)?.raw;
}

function buffKey(buffs: Buff[]): string {
  return buffs
    .map(
      (b) =>
        `${b.source.kind}:${"abilityId" in b.source ? b.source.abilityId : ""}:${JSON.stringify(b.contribution)}:${JSON.stringify(b.applicableWhen ?? null)}`,
    )
    .join("|");
}

const scoreCache = new Map<string, WeaponScore | null>();
let crunchCount = 0;

function weaponScore(unit: Unit, weaponId: string, phase: ComparePhase, buffs: Buff[], key: string): WeaponScore | null {
  const cacheKey = `${unit.id}|${weaponId}|${phase}|${key}`;
  const hit = scoreCache.get(cacheKey);
  if (hit !== undefined) return hit;
  const raw = resolveWeapon(unit, weaponId);
  if (!raw) {
    scoreCache.set(cacheKey, null);
    return null;
  }
  const wantMelee = phase === "fight";
  let best: WeaponScore | null = null;
  for (let i = 0; i < raw.profiles.length; i++) {
    const profile = raw.profiles[i];
    if (isMeleeProfile(profile) !== wantMelee) continue;
    if (!profileCanTarget(profile, meq.unitRaw)) continue;
    crunchCount += 1;
    const out = crunch(
      {
        attacker: { weapon: raw, profileIndex: i },
        target: { unit: meq.unitRaw, profileIndex: 0, modelCount: meq.modelCount },
        modelsFiring: 1,
        buffs,
        context: { phase } as EngineContext,
      },
      ds,
    );
    const perModel = out.stages.find((s) => s.name === "after-fnp")!.expected;
    if (!best || perModel > best.perModel) {
      best = {
        profileIndex: i,
        profileName: profile.name ?? "",
        perModel,
        stages: out.stages.map((s) => ({ name: s.name, expected: s.expected })),
      };
    }
  }
  scoreCache.set(cacheKey, best);
  return best;
}

function scoreTable(unit: Unit, phase: ComparePhase, buffs: Buff[], key: string): Map<string, WeaponScore> {
  const table = new Map<string, WeaponScore>();
  for (const id of unit.weapon_ids ?? []) {
    const s = weaponScore(unit, id, phase, buffs, key);
    if (s && s.perModel > 0) table.set(id, s);
  }
  return table;
}

function bagFrom(table: Map<string, WeaponScore>, counts: Map<string, number>): number {
  let total = 0;
  for (const [id, n] of counts) {
    const s = table.get(id);
    if (s) total += s.perModel * n;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Legal maximal loadout
// ---------------------------------------------------------------------------
function loadoutShape(unit: Unit): { models: LoadoutModel[]; modelCount: number } {
  const comp = ds.unitCompositionOf(unit) as unknown as
    | { models?: LoadoutModel[]; tiers?: LoadoutTier[] }
    | undefined;
  const models = comp?.models ?? [];
  const tiers = comp?.tiers ?? [];
  let modelCount = unit.model_count?.max ?? unit.model_count?.min ?? 1;
  if (tiers.length > 0) {
    let biggest = -1;
    for (const t of tiers) {
      const total = t.models.reduce((s, m) => s + (m.max ?? m.min), 0);
      if (total > biggest) biggest = total;
    }
    if (biggest > 0) modelCount = biggest;
  }
  return { models, modelCount };
}

/** In-loop legality predicate: per-weapon bounds plus the shared-allowance budgets. */
function makeFastLegal(unit: Unit, modelCount: number, bounds: Map<string, WeaponBound>) {
  const budgets =
    (unit as unknown as {
      wargear_budgets?: { items: string[]; count: number; per_models: number; duplicate_limit?: number | null }[] | null;
    }).wargear_budgets ?? [];
  return (counts: Map<string, number>): boolean => {
    for (const [id, n] of counts) {
      const bound = bounds.get(id);
      if (bound && n > bound.max) return false;
    }
    for (const budget of budgets) {
      const used = budget.items.reduce((s, id) => s + (counts.get(id) ?? 0), 0);
      const cap = budget.per_models ? Math.floor((modelCount * budget.count) / budget.per_models) : budget.count;
      if (used > cap) return false;
      if (budget.duplicate_limit != null) {
        const dupCap = budget.per_models
          ? Math.floor((modelCount * budget.duplicate_limit) / budget.per_models)
          : budget.duplicate_limit;
        for (const id of budget.items) if ((counts.get(id) ?? 0) > dupCap) return false;
      }
    }
    return true;
  };
}

function applyOptionOnce(counts: Map<string, number>, option: WargearOption, branch: number): Map<string, number> | null {
  const added = option.replacement ?? option.replacement_choice?.[branch] ?? [];
  const next = new Map(counts);
  for (const id of option.replaces ?? []) {
    const have = next.get(id) ?? 0;
    if (have <= 0) return null;
    next.set(id, have - 1);
  }
  for (const id of added) next.set(id, (next.get(id) ?? 0) + 1);
  for (const [id, n] of next) if (n === 0) next.delete(id);
  return next;
}

function optionBranchCount(option: WargearOption): number {
  return option.replacement ? 1 : option.replacement_choice?.length ?? 1;
}

export interface Loadout {
  counts: Map<string, number>;
  modelCount: number;
  total: number;
}

/** Per-unit loadout scaffolding. Bounds/caps are buff- and phase-independent. */
interface LoadoutScaffold {
  models: LoadoutModel[];
  modelCount: number;
  options: WargearOption[];
  bounds: Map<string, WeaponBound>;
  fastLegal: (counts: Map<string, number>) => boolean;
  caps: number[];
}

/**
 * Sensitivity knob (`HC_PER5=1`). Several swap options are authored with
 * `model_constraint.any_number: true` — "once per model" — while sibling
 * branches of the *same* option are capped by the unit's `wargear_budgets`
 * (e.g. Crusader Squad caps the power-fist/pyreblaster branches at 4 per 20
 * models but leaves the heavy-bolt-pistol+chainsword branch uncapped). This
 * mode rewrites every such swap to GW's near-universal "1 per 5 models" so the
 * two readings can be compared.
 */
function perFiveOptions(options: readonly WargearOption[]): WargearOption[] {
  return options.map((o) =>
    o.replaces && (o.model_constraint as { any_number?: boolean } | undefined)?.any_number
      ? { ...o, model_constraint: { ...o.model_constraint, any_number: undefined, per_n_models: 5 } }
      : o,
  );
}

const scaffoldCache = new Map<string, LoadoutScaffold>();
function scaffoldFor(unit: Unit): LoadoutScaffold {
  const hit = scaffoldCache.get(unit.id);
  if (hit) return hit;
  const { models, modelCount } = loadoutShape(unit);
  const authored = ds.wargearOptionsOf(unit);
  const options = process.env.HC_PER5 === "1" ? perFiveOptions(authored) : authored;
  const bounds = weaponBounds(unit, modelCount, options, models);
  const scaffold: LoadoutScaffold = {
    models,
    modelCount,
    options,
    bounds,
    fastLegal: makeFastLegal(unit, modelCount, bounds),
    caps: options.map((o) => optionCap(o, modelCount, models)),
  };
  scaffoldCache.set(unit.id, scaffold);
  return scaffold;
}

const loadoutCache = new Map<string, Loadout>();

/** An option application plan: for each option, one chosen branch and how many times. */
interface OptionPlan {
  branch: number;
  count: number;
}

function countsFromPlan(
  base: Map<string, number>,
  options: readonly WargearOption[],
  plan: readonly OptionPlan[],
): Map<string, number> | null {
  let counts = new Map(base);
  for (let i = 0; i < options.length; i++) {
    const chosen = plan[i];
    if (!chosen || chosen.count === 0) continue;
    for (let k = 0; k < chosen.count; k++) {
      const next = applyOptionOnce(counts, options[i], chosen.branch);
      if (!next) return null;
      counts = next;
    }
  }
  return counts;
}

/**
 * Hill-climb to the highest-scoring legal loadout. The plan is the decision
 * vector, so branches of one `replacement_choice` are mutually exclusive and an
 * option's {@link optionCap} bounds its total applications across sweeps.
 */
function bestLoadout(unit: Unit, phase: ComparePhase, buffs: Buff[], key: string): Loadout {
  const cacheKey = `${unit.id}|${phase}|${key}`;
  const hit = loadoutCache.get(cacheKey);
  if (hit) return hit;

  const { modelCount, options, fastLegal, caps, models } = scaffoldFor(unit);
  const table = scoreTable(unit, phase, buffs, key);
  const base = baseLoadout(unit, modelCount, options, models).counts;

  let plan: OptionPlan[] = options.map(() => ({ branch: 0, count: 0 }));
  let counts = base;
  let total = bagFrom(table, counts);

  for (let sweep = 0; sweep < 4; sweep++) {
    let improved = false;
    for (let i = 0; i < options.length; i++) {
      const cap = caps[i];
      if (cap === 0) continue;
      const branches = optionBranchCount(options[i]);
      for (let b = 0; b < branches; b++) {
        for (let n = 0; n <= cap; n++) {
          if (n === plan[i].count && b === plan[i].branch) continue;
          const trial = plan.map((p, j) => (j === i ? { branch: b, count: n } : p));
          const trialCounts = countsFromPlan(base, options, trial);
          if (!trialCounts || !fastLegal(trialCounts)) continue;
          const trialTotal = bagFrom(table, trialCounts);
          if (trialTotal > total + 1e-9) {
            plan = trial;
            counts = trialCounts;
            total = trialTotal;
            improved = true;
          }
        }
      }
    }
    if (!improved) break;
  }

  const result: Loadout = { counts, modelCount, total };
  loadoutCache.set(cacheKey, result);
  return result;
}

/** Authoritative legality check, run once per reported stack rather than per candidate. */
function legalityOf(unit: Unit, counts: Map<string, number>): string[] {
  const { modelCount, options, models } = scaffoldFor(unit);
  return validateLoadout(unit, modelCount, options, counts, models).map((v) => v.code);
}

// ---------------------------------------------------------------------------
// Stack model
// ---------------------------------------------------------------------------
interface Member {
  unit: Unit;
  role: "bodyguard" | "leader" | "support";
}

interface StackSpec {
  chapter: string;
  members: Member[];
  detachmentIds: string[];
  /** enhancement ability id per CHARACTER unit id. */
  enhancements: Map<string, string>;
  stratagemAbilityId: string | null;
  /** Ids of the opt-in {@link Lever}s the stack activates. */
  levers: string[];
}

interface StackResult {
  spec: StackSpec;
  total: number;
  byMember: { unit: Unit; role: string; count: number; total: number }[];
}

function memberKeywords(members: Member[]): string[] {
  const out = new Set<string>();
  for (const m of members) {
    for (const k of m.unit.keywords ?? []) out.add(k.toLowerCase());
    for (const k of m.unit.faction_keywords ?? []) out.add(k.toLowerCase());
  }
  return [...out].sort();
}

function abilityView(abilityId: string) {
  return ds.abilities.getInFaction(abilityId, ROOT_FACTION) ?? ds.abilities.getAny(abilityId);
}

function isAuraRange(range: unknown): boolean {
  return typeof range === "string" && /^aura/.test(range);
}

function armyRuleAbilityIds(chapter: string): string[] {
  const faction = ds.factions.get(chapter);
  const ruleIds = (faction?.raw as unknown as { faction_rule_ids?: string[] } | undefined)?.faction_rule_ids ?? [];
  // HC_DROP_RULE=<id,id> removes specific faction rules from the stack, so the
  // cost of a since-replaced army rule can be measured against the ranking.
  const drop = process.env.HC_DROP_RULE;
  if (!drop) return ruleIds;
  const dropped = new Set(drop.split(","));
  return ruleIds.filter((id) => !dropped.has(id));
}

const detRuleCache = new Map<string, string[]>();
function detachmentAbilityIds(detachmentId: string): string[] {
  const hit = detRuleCache.get(detachmentId);
  if (hit) return hit;
  const out: string[] = [];
  for (const a of ds.abilities.all) {
    if (a.raw.ability_type === "detachment" && a.raw.detachment_id === detachmentId) out.push(a.raw.ability_id);
  }
  detRuleCache.set(detachmentId, out);
  return out;
}

function makeContext(spec: StackSpec, phase: Phase): EngineContext {
  return {
    phase,
    attackerStationary: true,
    withinHalfRange: true,
    attackerAttached: spec.members.length > 1,
    attackerKeywords: memberKeywords(spec.members),
  };
}

/** Every aura-scoped ability the chapter can field from outside the stack. */
const auraViewCache = new Map<string, { unitId: string; viewId: string }[]>();
function auraCandidateViews(chapter: string, phase: Phase): { unitId: string; viewId: string }[] {
  const key = `${chapter}|${phase}`;
  const hit = auraViewCache.get(key);
  if (hit) return hit;
  const out: { unitId: string; viewId: string }[] = [];
  const seen = new Set<string>();
  for (const u of ALL_UNITS) {
    if (!legalInChapter(u.raw, chapter)) continue;
    for (const view of u.abilities) {
      if (seen.has(view.id) || !isAuraRange(view.raw.scope?.range)) continue;
      if (view.phases.length > 0 && !view.phases.includes(phase)) continue;
      seen.add(view.id);
      out.push({ unitId: u.id, viewId: view.id });
    }
  }
  auraViewCache.set(key, out);
  return out;
}

/**
 * A buff-bearing player decision the cruncher will not apply on its own — a
 * `choice` branch, a dice-pool option, or a timing-gated activation. These are
 * the search space: `getBuffs` returns only the auto-applied half.
 */
interface Lever {
  key: string;
  label: string;
  group: string | null;
  maxActivations: number;
  perMember: Map<string, Buff[]>;
}

interface BufferPool {
  applied: Map<string, Buff[]>;
  levers: Lever[];
  unsupported: { label: string; reason: string }[];
}

interface SourceRef {
  tag: string;
  label: string;
  view: NonNullable<ReturnType<typeof abilityView>>;
  /** The BuffSource to attribute this ability to, from member `m`'s perspective. */
  sourceFor: (m: Member) => BuffSource;
}

const translationCache = new Map<string, ReturnType<NonNullable<ReturnType<typeof abilityView>>["describeBuffs"]>>();

function translate(ref: SourceRef, m: Member, ctx: EngineContext, ctxKey: string) {
  const source = ref.sourceFor(m);
  const key = `${ref.tag}|${JSON.stringify(source)}|${ctxKey}`;
  const hit = translationCache.get(key);
  if (hit) return hit;
  const out = ref.view.describeBuffs(source, ctx, "attacker");
  translationCache.set(key, out);
  return out;
}

function poolSources(spec: StackSpec, phase: Phase): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const abilityId of armyRuleAbilityIds(spec.chapter)) {
    const view = abilityView(abilityId);
    if (view) refs.push({ tag: abilityId, label: view.name, view, sourceFor: () => ({ kind: "ability", abilityId, abilityKind: "army" }) });
  }
  for (const detId of spec.detachmentIds) {
    for (const abilityId of detachmentAbilityIds(detId)) {
      const view = abilityView(abilityId);
      if (view) {
        refs.push({
          tag: abilityId,
          label: view.name,
          view,
          sourceFor: () => ({ kind: "ability", abilityId, abilityKind: "detachment" }),
        });
      }
    }
  }
  if (spec.stratagemAbilityId) {
    const abilityId = spec.stratagemAbilityId;
    const view = abilityView(abilityId);
    if (view) {
      refs.push({
        tag: abilityId,
        label: view.name,
        view,
        sourceFor: () => ({ kind: "ability", abilityId, abilityKind: "detachment-stratagem" }),
      });
    }
  }
  // Enhancements. A CHARACTER's own enhancement is read as that model's `unit`
  // ability; from another member it is `attached`, so the translator drops its
  // `self`/`bearer`-scoped half (core rule 19.04) while the unit half still lands.
  for (const [charId, abilityId] of spec.enhancements) {
    const view = abilityView(abilityId);
    if (!view) continue;
    refs.push({
      tag: `enh:${charId}:${abilityId}`,
      label: `${view.name} → ${ds.units.getAny(charId)?.name ?? charId}`,
      view,
      sourceFor: (m) =>
        charId === m.unit.id
          ? { kind: "ability", abilityId, abilityKind: "unit" }
          : { kind: "ability", abilityId, abilityKind: "attached", sourceUnitId: charId },
    });
  }
  for (const other of spec.members) {
    const member = other;
    for (const view of ds.units.getInFaction(other.unit.id, ROOT_FACTION)!.abilities) {
      if (view.phases.length > 0 && !view.phases.includes(phase)) continue;
      refs.push({
        tag: `unit:${member.unit.id}:${view.id}`,
        label: `${view.name} [${member.unit.name}]`,
        view,
        sourceFor: (m) =>
          member.unit.id === m.unit.id
            ? { kind: "ability", abilityId: view.id, abilityKind: "unit" }
            : { kind: "ability", abilityId: view.id, abilityKind: "attached", sourceUnitId: member.unit.id },
      });
    }
  }
  for (const cand of auraCandidateViews(spec.chapter, phase)) {
    if (spec.members.some((m) => m.unit.id === cand.unitId)) continue;
    const view = abilityView(cand.viewId);
    if (!view) continue;
    refs.push({
      tag: `aura:${cand.viewId}`,
      label: `${view.name} [${ds.units.getAny(cand.unitId)?.name ?? cand.unitId}]`,
      view,
      sourceFor: () => ({ kind: "ability", abilityId: cand.viewId, abilityKind: "support", sourceUnitId: cand.unitId }),
    });
  }
  return refs;
}

function ctxKeyOf(spec: StackSpec, phase: Phase): string {
  return `${phase}|${spec.members.length > 1 ? "attached" : "solo"}|${memberKeywords(spec.members).join(",")}`;
}

const poolCache = new Map<string, BufferPool>();

/** Auto-applied buffs plus the opt-in levers, for every member. */
function bufferPool(spec: StackSpec, phase: Phase): BufferPool {
  const key = `${phase}|${spec.chapter}|${spec.members.map((m) => m.unit.id).join("+")}|${[...spec.detachmentIds].sort().join("+")}|${[...spec.enhancements].sort().join("+")}|${spec.stratagemAbilityId ?? ""}`;
  const hit = poolCache.get(key);
  if (hit) return hit;

  const ctx = makeContext(spec, phase);
  const ctxKey = ctxKeyOf(spec, phase);
  const applied = new Map<string, Buff[]>();
  const levers = new Map<string, Lever>();
  const unsupported: { label: string; reason: string }[] = [];

  for (const m of spec.members) applied.set(m.unit.id, []);
  for (const ref of poolSources(spec, phase)) {
    for (const m of spec.members) {
      const t = translate(ref, m, ctx, ctxKey);
      applied.get(m.unit.id)!.push(...t.applied);
      for (const u of t.unsupported) {
        const reason = (u as unknown as { reason?: string }).reason ?? "unsupported";
        unsupported.push({ label: ref.label, reason });
      }
      for (const lever of t.activatable) {
        const leverKey = `${ref.tag}#${lever.id}`;
        let entry = levers.get(leverKey);
        if (!entry) {
          entry = {
            key: leverKey,
            label: `${ref.label} — ${lever.label}`,
            group: lever.group?.id ?? null,
            maxActivations: lever.group?.maxActivations ?? Infinity,
            perMember: new Map(),
          };
          levers.set(leverKey, entry);
        }
        entry.perMember.set(m.unit.id, [...(entry.perMember.get(m.unit.id) ?? []), ...lever.buffs]);
      }
    }
  }
  const pool: BufferPool = { applied, levers: [...levers.values()], unsupported };
  poolCache.set(key, pool);
  return pool;
}

/** Applied buffs plus whichever levers `spec.levers` activates, for member `m`. */
function stackBuffs(spec: StackSpec, m: Member, phase: Phase): Buff[] {
  const pool = bufferPool(spec, phase);
  const out = [...(pool.applied.get(m.unit.id) ?? [])];
  const selected = new Set(spec.levers);
  for (const lever of pool.levers) {
    if (selected.has(lever.key)) out.push(...(lever.perMember.get(m.unit.id) ?? []));
  }
  return out;
}

const stackScoreCache = new Map<string, StackResult>();
let stackEvals = 0;

function scoreStack(spec: StackSpec, phase: ComparePhase): StackResult {
  const key = `${phase}|${spec.chapter}|${spec.members.map((m) => m.unit.id).join("+")}|${[...spec.detachmentIds].sort().join("+")}|${[...spec.enhancements].sort().join("+")}|${spec.stratagemAbilityId ?? ""}|${[...spec.levers].sort().join("+")}`;
  const hit = stackScoreCache.get(key);
  if (hit) return hit;
  stackEvals += 1;
  const byMember: StackResult["byMember"] = [];
  let total = 0;
  for (const m of spec.members) {
    const buffs = stackBuffs(spec, m, phase);
    const lo = bestLoadout(m.unit, phase, buffs, buffKey(buffs));
    byMember.push({ unit: m.unit, role: m.role, count: lo.modelCount, total: lo.total });
    total += lo.total;
  }
  const result: StackResult = { spec, total, byMember };
  stackScoreCache.set(key, result);
  return result;
}

/** Greedily activate the levers that most raise the stack's total, honouring group caps. */
function selectLevers(spec: StackSpec, phase: ComparePhase): StackSpec {
  const pool = bufferPool(spec, phase);
  if (pool.levers.length === 0) return spec;
  let selected: string[] = [];
  let best = scoreStack({ ...spec, levers: [] }, phase).total;

  for (let round = 0; round < 2; round++) {
    let improved = false;
    for (const lever of pool.levers) {
      if (selected.includes(lever.key)) continue;
      if (lever.group) {
        const inGroup = selected.filter((k) => pool.levers.find((l) => l.key === k)?.group === lever.group);
        const cap = pool.levers.find((l) => l.key === lever.key)!.maxActivations;
        if (inGroup.length >= cap) continue;
      }
      const trial = { ...spec, levers: [...selected, lever.key] };
      const score = scoreStack(trial, phase).total;
      if (score > best + 1e-9) {
        selected = trial.levers;
        best = score;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return { ...spec, levers: selected };
}

// ---------------------------------------------------------------------------
// Detachment / enhancement / stratagem candidates
// ---------------------------------------------------------------------------
const chapterDetsCache = new Map<string, { id: string; dp: number }[]>();
function chapterDetachments(chapter: string): { id: string; dp: number }[] {
  const hit = chapterDetsCache.get(chapter);
  if (hit) return hit;
  const out = ds.detachments.all
    .filter((d) => d.faction_id === chapter)
    .map((d) => ({ id: d.id, dp: d.detachment_points ?? 0 }));
  chapterDetsCache.set(chapter, out);
  return out;
}

interface EnhCandidate {
  abilityId: string;
  cost: number;
}

/** Enhancements available from the chosen detachments, restricted to that detachment's own list. */
function enhancementCandidates(chapter: string, detachments: string[]): EnhCandidate[] {
  const out: EnhCandidate[] = [];
  for (const detId of detachments) {
    const det = ds.detachments.getInFaction(detId, chapter) ?? ds.detachments.getAny(detId);
    for (const enhId of det?.enhancement_ids ?? []) {
      const enh = ds.enhancements.get(enhId) as unknown as
        | { detachment_id?: string; ability_id?: string | null; cost?: number }
        | undefined;
      if (!enh || enh.detachment_id !== detId || !enh.ability_id) continue;
      out.push({ abilityId: enh.ability_id, cost: enh.cost ?? 0 });
    }
  }
  return out;
}

/** Stratagems from the chosen detachments that can act in this phase. */
function stratagemCandidates(chapter: string, detachments: string[], phase: ComparePhase): string[] {
  const out = new Set<string>();
  for (const detId of detachments) {
    const det = ds.detachments.getInFaction(detId, chapter) ?? ds.detachments.getAny(detId);
    for (const stratId of det?.stratagem_ids ?? []) {
      const strat = ds.stratagems.get(stratId) as unknown as
        | { detachment_id?: string; phases?: string[]; ability_id?: string | null }
        | undefined;
      if (!strat || strat.detachment_id !== detId || !strat.ability_id) continue;
      if (!(strat.phases ?? []).includes(phase)) continue;
      out.add(strat.ability_id);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function attachableFor(chapter: string, bodyguard: Unit): { leaders: Unit[]; supports: Unit[] } {
  const attachable = ds
    .leadersAttachableTo(bodyguard.id)
    .map((u) => ds.units.getInFaction(u.id, ROOT_FACTION))
    .filter((u): u is NonNullable<typeof u> => u !== undefined)
    .filter(
      (u) =>
        legalInChapter(u.raw, chapter) &&
        u.id !== bodyguard.id &&
        !UNION_FLATTENED_COMPOSITIONS.has(u.id),
    );
  const roleOf = (u: (typeof attachable)[number]) =>
    (u.raw as unknown as { attachment_role?: string | null }).attachment_role;
  return {
    leaders: attachable.filter((u) => roleOf(u) === "leader").map((u) => u.raw),
    supports: attachable.filter((u) => roleOf(u) === "support").map((u) => u.raw),
  };
}

/** The stacks the search will actually evaluate for one bodyguard. */
function buildMemberChoices(
  chapter: string,
  bodyguard: Unit,
  phase: ComparePhase,
  detachmentIds: string[],
): Member[][] {
  const { leaders, supports } = attachableFor(chapter, bodyguard);
  const empty: StackSpec = { chapter, members: [], detachmentIds, enhancements: new Map(), stratagemAbilityId: null, levers: [] };
  const solo = (unit: Unit, role: Member["role"]) =>
    scoreStack({ ...empty, members: [{ unit: bodyguard, role: "bodyguard" }, { unit, role }] }, phase).total;
  const baseline = scoreStack({ ...empty, members: [{ unit: bodyguard, role: "bodyguard" }] }, phase).total;
  const top = (units: Unit[], role: Member["role"]) =>
    units
      .map((unit) => ({ unit, gain: solo(unit, role) - baseline }))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, TOP_ATTACHMENTS)
      .map((x) => x.unit);

  const bestLeaders: (Unit | null)[] = [null, ...top(leaders, "leader")];
  const bestSupports: (Unit | null)[] = [null, ...top(supports, "support")];
  const out: Member[][] = [];
  for (const leader of bestLeaders) {
    for (const support of bestSupports) {
      if (leader && support && leader.id === support.id) continue;
      const members: Member[] = [{ unit: bodyguard, role: "bodyguard" }];
      if (leader) members.push({ unit: leader, role: "leader" });
      if (support) members.push({ unit: support, role: "support" });
      out.push(members);
    }
  }
  return out;
}

/** Enhancements + stratagem + levers for a fixed detachment set — a detachment's
 * real value is its rule *plus* the enhancements and stratagems it unlocks. */
function optimiseWithDetachments(
  chapter: string,
  members: Member[],
  phase: ComparePhase,
  detachmentIds: string[],
): StackSpec {
  const characters = members.filter((m) => isCharacter(m.unit));
  const enhs = enhancementCandidates(chapter, detachmentIds);
  const assigned = new Map<string, string>();
  const specWith = (e: Map<string, string>): StackSpec => ({
    chapter, members, detachmentIds, enhancements: e, stratagemAbilityId: null, levers: [],
  });
  for (const m of characters) {
    let bestEnh: string | null = null;
    let bestTotal = scoreStack(specWith(assigned), phase).total;
    for (const cand of enhs) {
      if ([...assigned.values()].includes(cand.abilityId)) continue;
      const trial = new Map(assigned);
      trial.set(m.unit.id, cand.abilityId);
      const score = scoreStack(specWith(trial), phase).total;
      if (score > bestTotal + 1e-9) {
        bestTotal = score;
        bestEnh = cand.abilityId;
      }
    }
    if (bestEnh) assigned.set(m.unit.id, bestEnh);
  }

  let best: StackSpec = {
    chapter, members, detachmentIds, enhancements: assigned, stratagemAbilityId: null, levers: [],
  };
  let bestResult = scoreStack(best, phase);
  // The user's list-building rule: at most ONE stratagem on the unit.
  for (const strat of stratagemCandidates(chapter, detachmentIds, phase)) {
    const trial: StackSpec = { ...best, stratagemAbilityId: strat, levers: [] };
    const result = scoreStack(trial, phase);
    if (result.total > bestResult.total) {
      best = trial;
      bestResult = result;
    }
  }
  return selectLevers(best, phase);
}

/** Every detachment combination within the DP budget, largest first. */
function detachmentCombos(chapter: string): string[][] {
  const dets = chapterDetachments(chapter);
  const out: string[][] = [];
  const walk = (start: number, picked: string[], dp: number): void => {
    if (picked.length > 0) out.push([...picked]);
    if (picked.length >= MAX_DETACHMENTS) return;
    for (let i = start; i < dets.length; i++) {
      if (dp + dets[i].dp > DP_BUDGET) continue;
      picked.push(dets[i].id);
      walk(i + 1, picked, dp + dets[i].dp);
      picked.pop();
    }
  };
  walk(0, [], 0);
  return out;
}

/** Broad-pass score: no detachments — cheap enough to rank every stack. */
function optimiseStack(chapter: string, members: Member[], phase: ComparePhase): StackResult {
  return scoreStack(optimiseWithDetachments(chapter, members, phase, []), phase);
}

function dpOf(chapter: string, detachmentIds: string[]): number {
  const dets = chapterDetachments(chapter);
  return detachmentIds.reduce((sum, id) => sum + (dets.find((d) => d.id === id)?.dp ?? 0), 0);
}

/**
 * Deep pass: exhaustive detachment combination search for one finalist stack.
 * Ties break toward the cheaper combination — a detachment that adds nothing
 * must not be reported as part of the best stack just because it was enumerated
 * first.
 */
function deepOptimise(chapter: string, members: Member[], phase: ComparePhase): StackResult {
  let best = optimiseStack(chapter, members, phase);
  for (const combo of detachmentCombos(chapter)) {
    const result = scoreStack(optimiseWithDetachments(chapter, members, phase, combo), phase);
    const better =
      result.total > best.total + 1e-9 ||
      (Math.abs(result.total - best.total) <= 1e-9 &&
        dpOf(chapter, result.spec.detachmentIds) < dpOf(chapter, best.spec.detachmentIds));
    if (better) best = result;
  }
  return best;
}

/** Plan + optimise every stack this bodyguard can field in `phase`. */
function optimiseBodyguard(chapter: string, bodyguard: Unit, phase: ComparePhase): StackResult[] {
  // Member-choice prefilter runs with no detachments (cheap); each surviving choice
  // then gets its own detachment plan, enhancement assignment and lever set.
  return buildMemberChoices(chapter, bodyguard, phase, []).map((members) =>
    optimiseStack(chapter, members, phase),
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const CHAPTER_FILTER = process.env.HC_CHAPTERS ? new Set(process.env.HC_CHAPTERS.split(",")) : null;
const BODYGUARD_LIMIT = process.env.HC_BODYGUARDS ? Number(process.env.HC_BODYGUARDS) : Infinity;

console.log(`MEQ target: ${MEQ_LABEL}`);
console.log(`chapters: ${CHAPTER_IDS.join(", ")}`);
console.log(`ALL_UNITS: ${ALL_UNITS.length}`);

export interface PhaseReport {
  phase: ComparePhase;
  results: StackResult[];
}

const reports: PhaseReport[] = [];

for (const phase of ["shooting", "fight"] as ComparePhase[]) {
  const t0 = Date.now();
  const results: StackResult[] = [];
  for (const chapter of CHAPTER_IDS) {
    if (CHAPTER_FILTER && !CHAPTER_FILTER.has(chapter)) continue;
    const legal = ALL_UNITS.filter(
      (u) => legalInChapter(u.raw, chapter) && !UNION_FLATTENED_COMPOSITIONS.has(u.id),
    ).slice(0, BODYGUARD_LIMIT);
    for (const bodyguard of legal) {
      results.push(...optimiseBodyguard(chapter, bodyguard.raw, phase));
    }
  }
  results.sort((a, b) => b.total - a.total);
  // Deep pass: re-optimise the top finalists over every legal detachment combination.
  const DEEP = Number(process.env.HC_DEEP ?? 60);
  const seen = new Set<string>();
  const finalists: { chapter: string; members: Member[] }[] = [];
  for (const r of results) {
    const sig = `${r.spec.chapter}|${r.spec.members.map((m) => m.unit.id).join("+")}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    finalists.push({ chapter: r.spec.chapter, members: r.spec.members });
    if (finalists.length >= DEEP) break;
  }
  for (const f of finalists) results.push(deepOptimise(f.chapter, f.members, phase));
  results.sort((a, b) => b.total - a.total);
  reports.push({ phase, results });
  console.log(
    `\n[${phase}] ${results.length} stacks in ${((Date.now() - t0) / 1000).toFixed(1)}s (unique evals ${stackEvals}, crunches ${crunchCount})`,
  );
  for (const r of results.slice(0, 12)) {
    const label = r.spec.members.map((m) => `${m.unit.name}(${m.role})`).join(" + ");
    console.log(`  ${r.total.toFixed(2).padStart(8)}  [${r.spec.chapter}] ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Detailed report
// ---------------------------------------------------------------------------
function labelFor(source: BuffSource): string {
  if (source.kind === "manual") return `manual: ${source.label}`;
  if (source.kind === "weapon-keyword") return `weapon ${source.keywordId}`;
  const view = abilityView(source.abilityId);
  const name = view?.name ?? source.abilityId;
  if (source.abilityKind === "attached" && source.sourceUnitId) {
    return `${name} [from ${ds.units.getAny(source.sourceUnitId)?.name ?? source.sourceUnitId}]`;
  }
  return `${name} [${source.abilityKind}]`;
}

function printStack(r: StackResult, phase: ComparePhase): void {
  const spec = r.spec;
  const line = "─".repeat(78);
  console.log(`\n${line}`);
  console.log(`${phase.toUpperCase()} — ${r.total.toFixed(2)} expected damage vs ${MEQ_LABEL}`);
  console.log(line);
  console.log(`chapter       : ${spec.chapter}`);
  console.log(`army rule     : ${armyRuleAbilityIds(spec.chapter).map((id) => abilityView(id)?.name ?? id).join(", ") || "(none)"}`);
  console.log(
    `detachments   : ${
      spec.detachmentIds
        .map((id) => {
          const det = ds.detachments.getInFaction(id, spec.chapter) ?? ds.detachments.getAny(id);
          return `${det?.name ?? id} (${det?.detachment_points ?? "?"} DP)`;
        })
        .join(" + ") || "(none)"
    }`,
  );
  console.log(
    `enhancements  : ${
      [...spec.enhancements].map(([unitId, abilityId]) => {
        const enh = ds.enhancements.get(abilityId);
        return `${enh?.name ?? abilityId} → ${ds.units.getAny(unitId)?.name ?? unitId}`;
      }).join("; ") || "(none)"
    }`,
  );
  const strat = spec.stratagemAbilityId ? ds.stratagems.get(spec.stratagemAbilityId) : undefined;
  console.log(`stratagem     : ${strat ? `${strat.name} (${strat.cp_cost} CP)` : "(none)"}`);

  for (const m of spec.members) {
    const buffs = stackBuffs(spec, m, phase);
    const lo = bestLoadout(m.unit, phase, buffs, buffKey(buffs));
    const legality = legalityOf(m.unit, lo.counts);
    console.log(`\n── ${m.role.toUpperCase()}: ${m.unit.name} (${lo.modelCount} models) — ${lo.total.toFixed(2)} dmg${legality.length ? `  [ILLEGAL: ${legality.join(",")}]` : ""}`);
    const rows = [...lo.counts.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    console.log(`   loadout: ${rows.map(([id, n]) => `${n}× ${resolveWeapon(m.unit, id)?.name ?? id}`).join(", ")}`);

    // Group contributions by source, in the resolver's precedence order.
    const groups = new Map<string, string[]>();
    for (const b of buffs) {
      const key = labelFor(b.source);
      const list = groups.get(key) ?? [];
      list.push(`${b.contribution.type}${renderContribution(b.contribution)}`);
      groups.set(key, list);
    }
    console.log(`   abilities stacked (${groups.size} sources, ${buffs.length} contributions):`);
    for (const [key, contribs] of groups) console.log(`     • ${key}: ${contribs.join(", ")}`);

    const ctx = makeContext(spec, phase);
    const table = scoreTable(m.unit, phase, buffs, buffKey(buffs));
    console.log(`   weapons:`);
    console.log(`     ${"weapon".padEnd(38)}${"n".padStart(3)}${"att".padStart(8)}${"hit".padStart(8)}${"wnd".padStart(8)}${"unsv".padStart(8)}${"dmg".padStart(9)}`);
    for (const [weaponId, count] of rows) {
      const score = table.get(weaponId);
      if (!score) continue;
      const raw = resolveWeapon(m.unit, weaponId)!;
      const st = new Map(score.stages.map((s) => [s.name, s.expected * count]));
      console.log(
        `     ${`${raw.name}${score.profileName ? ` (${score.profileName})` : ""}`.slice(0, 37).padEnd(38)}${String(count).padStart(3)}${(st.get("attacks") ?? 0).toFixed(2).padStart(8)}${(st.get("hits") ?? 0).toFixed(2).padStart(8)}${(st.get("wounds") ?? 0).toFixed(2).padStart(8)}${(st.get("unsaved") ?? 0).toFixed(2).padStart(8)}${(st.get("after-fnp") ?? 0).toFixed(2).padStart(9)}`,
      );
    }
    void ctx;
  }
}

function renderContribution(c: Buff["contribution"]): string {
  switch (c.type) {
    case "hit-mod":
    case "wound-mod":
    case "save-mod":
    case "damage-mod":
    case "attacks-mod":
    case "strength-mod":
    case "toughness-mod":
    case "ap-mod":
    case "damage-reduction":
      return ` ${c.value > 0 ? "+" : ""}${c.value}`;
    case "reroll":
      return ` ${c.roll}/${c.subset}`;
    case "extra-keyword":
      return ` ${c.keywordRef.keyword_id}${c.keywordRef.parameters ? ` ${JSON.stringify(c.keywordRef.parameters)}` : ""}`;
    case "feel-no-pain":
      return ` ${c.threshold}+${c.scope ? ` (${c.scope})` : ""}`;
    case "invulnerable-save":
      return ` ${c.threshold}+`;
    default:
      return "";
  }
}

/**
 * Proof that the per-model shortcut is faithful: recompute the winning stack with
 * `modelsFiring = count` (the engine's own path) and compare against the totals
 * the optimiser reported, which were built as `perModel × count`.
 */
function verifyStack(r: StackResult, phase: ComparePhase): string[] {
  const problems: string[] = [];
  let direct = 0;
  for (const m of r.spec.members) {
    const buffs = stackBuffs(r.spec, m, phase);
    const lo = bestLoadout(m.unit, phase, buffs, buffKey(buffs));
    for (const [weaponId, count] of lo.counts) {
      if (count <= 0) continue;
      const raw = resolveWeapon(m.unit, weaponId);
      if (!raw) continue;
      const table = scoreTable(m.unit, phase, buffs, buffKey(buffs));
      const score = table.get(weaponId);
      if (!score) continue;
      const out = crunch(
        {
          attacker: { weapon: raw, profileIndex: score.profileIndex },
          target: { unit: meq.unitRaw, profileIndex: 0, modelCount: meq.modelCount },
          modelsFiring: count,
          buffs,
          context: { phase } as EngineContext,
        },
        ds,
      );
      direct += out.stages.find((x) => x.name === "after-fnp")!.expected;
    }
  }
  if (Math.abs(direct - r.total) > 1e-6) {
    problems.push(`linearity: aggregated ${r.total.toFixed(6)} vs direct ${direct.toFixed(6)}`);
  }
  for (const m of r.spec.members) {
    const bad = legalityOf(m.unit, bestLoadout(m.unit, phase, stackBuffs(r.spec, m, phase), buffKey(stackBuffs(r.spec, m, phase))).counts);
    if (bad.length > 0) problems.push(`legality ${m.unit.id}: ${bad.join(",")}`);
  }
  return problems;
}

if (process.env.HC_DETAIL === "1") {
  for (const rep of reports) {
    const top = rep.results[0];
    if (top) {
      printStack(top, rep.phase);
      const problems = verifyStack(top, rep.phase);
      console.log(
        `\nVERIFY (${rep.phase}): ${
          problems.length === 0
            ? "aggregated total matches direct engine evaluation; every member loadout passes validateLoadout"
            : problems.join("; ")
        }`,
      );
    }
  }
}

// Temporary probe: marginal value of each detachment on the reported winner.
if (process.env.HC_PROBE === "1") {
  for (const rep of reports) {
    const top = rep.results[0];
    if (!top) continue;
    const { chapter, members } = top.spec;
    console.log(`\n[probe ${rep.phase}] ${chapter} ${members.map((m) => m.unit.id).join("+")}`);
    const base = scoreStack(optimiseWithDetachments(chapter, members, rep.phase, []), rep.phase);
    console.log(`  no detachments          : ${base.total.toFixed(4)}  enh=${[...base.spec.enhancements].join(",") || "-"} strat=${base.spec.stratagemAbilityId ?? "-"} levers=${base.spec.levers.length}`);
    for (const ds of [top.spec.detachmentIds, top.spec.detachmentIds.slice(-1)]) {
      const r = scoreStack(optimiseWithDetachments(chapter, members, rep.phase, ds), rep.phase);
      console.log(`  ${ds.join("+").padEnd(23)}: ${r.total.toFixed(4)}  enh=${[...r.spec.enhancements].map(([k, v]) => `${k}=${v}`).join(",") || "-"} strat=${r.spec.stratagemAbilityId ?? "-"} levers=${r.spec.levers.length}`);
    }
  }
}
