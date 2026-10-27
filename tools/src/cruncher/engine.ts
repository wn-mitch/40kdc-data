/**
 * The expected-value damage engine.
 *
 * Closed-form math over schema profiles + a flat {@link Buff} stack. No
 * sampling, no I/O. Auto-injects every weapon-keyword on the attacker's
 * profile as a buff (so callers don't have to enumerate intrinsics), then
 * resolves the stack via {@link resolveBuffs}, then walks
 * attacks → hits → wounds → unsaved → damage → after-fnp → models-killed.
 *
 * The dataset is required (and defaults to the embedded one) — without it
 * the engine can't look up weapon-keyword effects.
 */
import type { Phase, Unit, Weapon } from "../generated.js";
import {
  type Buff,
  type BuffApplicability,
  type EngineContext,
  resolveBuffs,
  type ResolvedModifiers,
  type WeaponKeywordRef,
} from "./buffs.js";
import { Dataset } from "../data/dataset.js";
import { isMeleeProfile } from "../data/weapon-profile.js";
import { damageRoll, oneDamageRerollGain } from "./damage-roll.js";

export type AttackProfileRef = { weapon: Weapon; profileIndex: number };
export type TargetProfileRef = {
  unit: Unit;
  profileIndex: number;
  /** Override target model count (otherwise read from `unit.model_count.min`). */
  modelCount?: number;
};

export type Stage = {
  name: "attacks" | "hits" | "wounds" | "unsaved" | "damage" | "after-fnp" | "models-killed";
  expected: number;
  detail: string;
};

export type EngineInput = {
  attacker: AttackProfileRef;
  target: TargetProfileRef;
  modelsFiring: number;
  /** User / ability / manual buffs. Weapon-keyword buffs are auto-injected. */
  buffs: Buff[];
  context: EngineContext;
};

export type EngineOutput = { stages: Stage[]; resolved: ResolvedModifiers };

/**
 * The per-roll parameters behind one crunch, for the discrete allocation stage
 * (`allocation.ts`): every probability is the one the expected-value stages use.
 */
export type AttackModel = {
  modelsFiring: number;
  /** One model's Attacks characteristic, before the flat additions below. */
  attacksStat: unknown;
  /** Flat attacks every model adds: the modifier and Blast. */
  attacksBonus: number;
  /** Rapid Fire's extra attacks per model when active, else null. */
  rapidFireStat: unknown;
  torrent: boolean;
  hit: { pass: number; crit: number };
  /** Sustained Hits' extra hits per critical hit, else null. */
  sustainedStat: unknown;
  lethal: boolean;
  wound: { pass: number; crit: number };
  devastating: boolean;
  /** Probability a wound that reaches the save is not saved. */
  unsaved: number;
  /** Final per-attack damage. */
  damage: Array<{ value: number; probability: number }>;
  /** Probability each wound is lost despite Feel No Pain: on every wound, and on mortal wounds only. */
  woundLost: number;
  mortalWoundLost: number;
  wounds: number;
  modelCount: number;
};


/** Whether a weapon profile may select this target under profile-level restrictions such as Hunter. */
export function profileCanTarget(profile: Weapon["profiles"][number], target: Unit): boolean {
  const restrictions = profile.target_restrictions;
  if (!restrictions) return true;
  const keywords = new Set(unitKeywordsLower(target));
  const required = restrictions.required_keywords_any ?? [];
  if (required.length > 0 && !required.some((keyword) => keywords.has(keyword.toLowerCase()))) return false;
  return !(restrictions.excluded_keywords ?? []).some((keyword) => keywords.has(keyword.toLowerCase()));
}

/**
 * Compute the expected per-stage projection for one (attacker, target, buffs)
 * triple. The dataset defaults to the embedded one — pass an alternate when
 * crunching against a different bundle (e.g. tests).
 */
export function crunch(input: EngineInput, dataset?: Dataset): EngineOutput {
  return crunchModel(input, dataset).output;
}

/** {@link crunch} with the {@link AttackModel} its stages were computed from. */
export function crunchModel(input: EngineInput, dataset?: Dataset): { output: EngineOutput; model: AttackModel } {
  const ds = dataset ?? lazyEmbeddedDataset();
  const weaponProfile = input.attacker.weapon.profiles[input.attacker.profileIndex];
  if (!weaponProfile) {
    throw new RangeError(
      `crunch: attacker.profileIndex=${input.attacker.profileIndex} is out of range for weapon ${input.attacker.weapon.id}`,
    );
  }
  const unitProfile = input.target.unit.profiles[input.target.profileIndex];
  if (!unitProfile) {
    throw new RangeError(
      `crunch: target.profileIndex=${input.target.profileIndex} is out of range for unit ${input.target.unit.id}`,
    );
  }
  if (!profileCanTarget(weaponProfile, input.target.unit)) {
    throw new RangeError(
      `crunch: weapon ${input.attacker.weapon.id} profile ${input.attacker.profileIndex} cannot target unit ${input.target.unit.id}`,
    );
  }

  const targetKeywords = unitKeywordsLower(input.target.unit);
  const ctx: EngineContext = {
    ...input.context,
    targetKeywords: input.context.targetKeywords ?? targetKeywords,
    weaponNames: input.context.weaponNames ?? [...new Set([input.attacker.weapon.name, weaponProfile.name].map((name) => name.toLowerCase()))],
    weaponKeywords: input.context.weaponKeywords ?? [...new Set((weaponProfile.keywords ?? []).map((ref) => ref.keyword_id))],
    weaponKeywordRefs: input.context.weaponKeywordRefs ?? weaponProfile.keywords,
  };

  // Auto-inject weapon-keyword buffs from the attacker profile, then append
  // the caller-supplied stack. resolveBuffs deduplicates and ranks them.
  const profileBuffs = profileBuffsFor(input.attacker, ds, ctx);
  const allBuffs = [...profileBuffs, ...input.buffs];
  let resolved = resolveBuffs(allBuffs, ctx);
  // A buff gated on the attack's Strength against the target's Toughness needs both, which the
  // buffs themselves modify: take them from the stack without the comparison-gated buffs, then
  // resolve again with them known. No comparison-gated buff feeds any comparison, which keeps a
  // rule like "while S is below T, +1 S" from flipping itself off.
  if (allBuffs.some((buff) => hasAttackComparison(buff.applicableWhen))) {
    const toughness = input.target.unit.profiles.map((profile) => profile.T + resolved.toughnessMod.value);
    ctx.attackStrength = evalStatValue(weaponProfile.stats.S) + resolved.strengthMod.value;
    ctx.targetToughness = unitProfile.T + resolved.toughnessMod.value;
    ctx.targetToughnessMax = Math.max(...toughness);
    ctx.targetToughnessMin = Math.min(...toughness);
    resolved = resolveBuffs(allBuffs, ctx);
  }

  const stages: Stage[] = [];

  // 1. Attacks
  const isMelee = isMeleeProfile(weaponProfile);
  const baseA = evalStatValue(weaponProfile.stats.A);
  const attacksPerModel = baseA + resolved.attacksMod.value;
  const rapidFire = findKeyword(resolved, "rapid-fire");
  const halfRange = ctx.withinHalfRange === true;
  const rapidFireExtraPerModel = rapidFire && halfRange ? evalStatValue(rapidFire.parameters?.value) : 0;
  const blast = findKeyword(resolved, "blast");
  const targetModelCount = input.target.modelCount ?? input.target.unit.model_count?.min ?? 1;
  const blastExtraPerModel = blast?.parameters?.value !== undefined
    ? Math.floor(targetModelCount / 5) * evalStatValue(blast.parameters.value)
    : 0;
  const attacks = input.modelsFiring * (attacksPerModel + rapidFireExtraPerModel + blastExtraPerModel);
  stages.push({
    name: "attacks",
    expected: attacks,
    detail: attacksDetail(input.modelsFiring, attacksPerModel, rapidFireExtraPerModel, blastExtraPerModel),
  });

  // 2. Hits
  // Cover (11e): the benefit of cover is -1 to the attacker's hit roll, not a
  // save bonus. Ranged-only, negated by ignores-cover, and moot for auto-hitting
  // Torrent weapons (no hit roll).
  const ignoresCover = !!findKeyword(resolved, "ignores-cover");
  // Ignoring hit modifiers also ignores the cover penalty.
  const covered =
    resolved.cover.active && !ignoresCover && !isMelee && !resolved.ignoreModifiers.hit;
  const coverHitPenalty = covered ? -1 : 0;
  const printedHitStat = isMelee ? weaponProfile.stats.WS : weaponProfile.stats.BS;
  // A WS/BS improvement changes the characteristic itself, floored at 2+.
  const skillMod = resolved.skillMod[isMelee ? "WS" : "BS"].value;
  const hitStat = typeof printedHitStat === "number" && skillMod !== 0 ? Math.max(2, printedHitStat - skillMod) : printedHitStat;
  const critHitThreshold = Math.min(6, resolved.critThresholds.hit?.value ?? 6);
  const torrent = !!findKeyword(resolved, "torrent");
  let hits: number;
  let critHits: number;
  let hitsDetail: string;
  let hitProbs = { pass: 1, crit: 0 };
  if (torrent) {
    hits = attacks;
    critHits = 0;
    hitsDetail = `Torrent: auto-hits (${attacks.toFixed(4)})`;
  } else {
    if (typeof hitStat !== "number") {
      throw new Error(
        `crunch: weapon ${input.attacker.weapon.id} profile ${input.attacker.profileIndex} missing ${isMelee ? "WS" : "BS"}`,
      );
    }
    const hitCheck = {
      unmodifiedNeeded: hitStat,
      modifier: resolved.hitMod.value + coverHitPenalty,
      autoFailOnOne: true,
      autoPassOnSix: true,
      critThreshold: critHitThreshold,
    };
    const probs = checkProbabilities({ ...hitCheck, reroll: resolved.rerolls.hit?.subset ?? "none" });
    hitProbs = probs;
    hits = attacks * probs.pass;
    critHits = attacks * probs.crit;
    hitsDetail = `${isMelee ? "WS" : "BS"}${hitStat}+ (mod ${signed(resolved.hitMod.value)}${covered ? ", cover -1" : ""}, reroll ${resolved.rerolls.hit?.subset ?? "none"}${critHitThreshold < 6 ? `, crit ${critHitThreshold}+` : ""}) → P(hit)=${probs.pass.toFixed(4)}, P(crit)=${probs.crit.toFixed(4)}`;
    if (resolved.rerollOne.hit) {
      const fresh = checkProbabilities({ ...hitCheck, reroll: "none" });
      const dice = oneRerollDice(attacks, probs.open);
      hits += dice * fresh.pass;
      critHits += dice * fresh.crit;
      hitsDetail += `; re-roll one Hit roll: ${dice.toFixed(4)} dice`;
    }
  }
  const sustained = findKeyword(resolved, "sustained-hits");
  if (sustained) {
    hits += critHits * evalStatValue(sustained.parameters?.value);
    hitsDetail += `; +Sustained Hits ${sustained.parameters?.value} on ${critHits.toFixed(4)} crits`;
  }
  stages.push({ name: "hits", expected: hits, detail: hitsDetail });

  // 3. Wounds
  const S = evalStatValue(weaponProfile.stats.S) + resolved.strengthMod.value;
  const T = unitProfile.T + resolved.toughnessMod.value;
  const stdWoundNeeded = woundThreshold(S, T);
  let antiThreshold = 7; // unreachable
  for (const { keywordRef: anti } of resolved.extraKeywords) {
    if (anti.keyword_id !== "anti") continue;
    const targetKeyword = anti.parameters?.target_keyword;
    const required = anti.parameters?.required_target_keywords_any;
    const excluded = anti.parameters?.excluded_target_keywords;
    const hasTarget = typeof targetKeyword === "string" || Array.isArray(required) || Array.isArray(excluded);
    if (!hasTarget || (typeof targetKeyword === "string" && !targetKeywords.includes(targetKeyword.toLowerCase()))) continue;
    if (Array.isArray(required) && !required.some((keyword) => typeof keyword === "string" && targetKeywords.includes(keyword.toLowerCase()))) continue;
    if (Array.isArray(excluded) && excluded.some((keyword) => typeof keyword === "string" && targetKeywords.includes(keyword.toLowerCase()))) continue;
    const threshold = Number(anti.parameters?.threshold);
    if (Number.isInteger(threshold) && threshold >= 2 && threshold <= 6) antiThreshold = Math.min(antiThreshold, threshold);
  }
  const critWoundThreshold = Math.min(6, antiThreshold, resolved.critThresholds.wound?.value ?? 6);

  const hasLethal = !!findKeyword(resolved, "lethal-hits");
  const hitsForWoundRoll = hasLethal ? hits - critHits : hits;
  const lethalAutoWounds = hasLethal ? critHits : 0;

  const woundCheck = {
    unmodifiedNeeded: stdWoundNeeded,
    modifier: resolved.woundMod.value,
    autoFailOnOne: true,
    autoPassOnSix: true,
    critThreshold: critWoundThreshold,
  };
  const woundProbs = checkProbabilities({ ...woundCheck, reroll: resolved.rerolls.wound?.subset ?? "none" });
  let regularWoundsFromRoll = hitsForWoundRoll * (woundProbs.pass - woundProbs.crit);
  let critWoundsFromRoll = hitsForWoundRoll * woundProbs.crit;
  let woundRerollOneDice = 0;
  if (resolved.rerollOne.wound) {
    const fresh = checkProbabilities({ ...woundCheck, reroll: "none" });
    woundRerollOneDice = oneRerollDice(hitsForWoundRoll, woundProbs.open);
    regularWoundsFromRoll += woundRerollOneDice * (fresh.pass - fresh.crit);
    critWoundsFromRoll += woundRerollOneDice * fresh.crit;
  }
  const totalRegularWounds = regularWoundsFromRoll + lethalAutoWounds;
  const hasDevastating = !!findKeyword(resolved, "devastating-wounds");
  const mortalWoundsStream = hasDevastating ? critWoundsFromRoll : 0;
  const regularWoundsForSaves = hasDevastating ? totalRegularWounds : totalRegularWounds + critWoundsFromRoll;
  const totalWounds = regularWoundsForSaves + mortalWoundsStream;
  stages.push({
    name: "wounds",
    expected: totalWounds,
    detail: `S${S} vs T${T} → need ${stdWoundNeeded}+, anti ${antiThreshold <= 6 ? `${antiThreshold}+ (active)` : "n/a"}, P(wound)=${woundProbs.pass.toFixed(4)} (${critWoundsFromRoll.toFixed(4)} crit), lethal ${hasLethal ? "+" + lethalAutoWounds.toFixed(4) : "—"}, devastating ${hasDevastating ? mortalWoundsStream.toFixed(4) + " MW" : "—"}${resolved.rerollOne.wound ? `; re-roll one Wound roll: ${woundRerollOneDice.toFixed(4)} dice` : ""}`,
  });

  // 4. Saves
  const apMod = resolved.apMod.value;
  // Worsening AP stops at 0.
  const AP = Math.min(0, weaponProfile.stats.AP + apMod);
  const saveMod = resolved.saveMod.value;
  const Sv0 = resolved.saveCharacteristic?.value ?? unitProfile.Sv;
  // A capped improvement never takes the Save past its cap, and never worsens a Save already
  // at or better than the cap.
  const saveImprove = resolved.saveImprove;
  const Sv = saveImprove !== null ? Math.min(Sv0, Math.max(saveImprove.best, Sv0 - saveImprove.value)) : Sv0;
  const armorTargetRaw = Sv - AP - saveMod;
  // Cover is a hit penalty (11e), applied in the hits stage above — it no
  // longer touches the save here.
  const armorFinal = clamp(armorTargetRaw, 2, 7);
  // The unit's printed invuln (from the profile) and any ability-granted
  // invuln combine best-wins (lowest threshold). Invuln bypasses AP, so the
  // final save is min(armor-after-AP, effective-invuln).
  // Attack-scoped invuln (issue #87): a ranged-/melee-only save applies only to
  // that attack type; fall back to the unconditional invuln_sv when unscoped.
  const scopedInvuln = isMelee ? unitProfile.invuln_sv_melee : unitProfile.invuln_sv_ranged;
  const printedInvuln = scopedInvuln ?? unitProfile.invuln_sv ?? null;
  const abilityInvuln = resolved.invulnerable?.threshold ?? null;
  const effectiveInvuln =
    printedInvuln !== null && abilityInvuln !== null
      ? Math.min(printedInvuln, abilityInvuln)
      : (printedInvuln ?? abilityInvuln);
  const effectiveSaveTarget =
    effectiveInvuln !== null ? Math.min(armorFinal, effectiveInvuln) : armorFinal;

  const saveProbs = checkProbabilities({
    unmodifiedNeeded: effectiveSaveTarget,
    modifier: 0,
    reroll: resolved.rerolls.save?.subset ?? "none",
    autoFailOnOne: true,
    autoPassOnSix: false,
    critThreshold: 7,
  });
  const pSaved = effectiveSaveTarget >= 7 ? 0 : saveProbs.pass;
  let unsaved = regularWoundsForSaves * (1 - pSaved);
  // "Re-roll one saving throw": one failed save no other permission re-rolled is rolled again.
  const saveRerollOneDice = resolved.rerollOne.save && effectiveSaveTarget < 7 ? oneRerollDice(regularWoundsForSaves, saveProbs.open) : 0;
  if (saveRerollOneDice > 0) {
    const fresh = checkProbabilities({ unmodifiedNeeded: effectiveSaveTarget, modifier: 0, reroll: "none", autoFailOnOne: true, autoPassOnSix: false, critThreshold: 7 });
    unsaved -= saveRerollOneDice * fresh.pass;
  }
  stages.push({
    name: "unsaved",
    expected: unsaved,
    detail: `Sv${Sv}+${Sv0 !== unitProfile.Sv ? " (set)" : ""}${Sv !== Sv0 ? ` (improved, no better than ${saveImprove?.best}+)` : ""}, AP${signed(AP)}${apMod !== 0 ? ` (apmod ${signed(apMod)})` : ""}${saveMod !== 0 ? `, savemod ${signed(saveMod)}` : ""}${abilityInvuln !== null ? `, invuln ${abilityInvuln}+ (ability)` : ""} → effective ${effectiveSaveTarget}+ (P(save)=${pSaved.toFixed(4)})${resolved.rerollOne.save ? `; re-roll one saving throw: ${saveRerollOneDice.toFixed(4)} dice` : ""}`,
  });

  // 5. Damage
  const baseD = evalStatValue(weaponProfile.stats.D);
  const melta = findKeyword(resolved, "melta");
  const meltaBonus = melta && halfRange ? evalStatValue(melta.parameters?.value) : 0;
  const damageReduction = resolved.damageReduction.value;
  // 10e damage-reduction abilities always carry the canonical "to a minimum
  // of 1" clause, so the floor lives in the math, not the data. The clause
  // only applies when damage-reduction is active — without it, a D1 weapon
  // with a -1 attacker damage-mod still produces 0 damage. Both floors act on
  // each Damage roll, as does a damage reroll.
  const damageReroll = resolved.rerolls.damage?.subset;
  const perAttack = damageRoll({
    stat: weaponProfile.stats.D,
    bonus: meltaBonus,
    modifier: resolved.damageMod.value,
    reduction: damageReduction,
    ...(damageReroll ? { reroll: damageReroll } : {}),
  });
  const damagePerHit = perAttack.expected;
  let damageMain = unsaved * damagePerHit;
  let damageMortal = mortalWoundsStream * damagePerHit;
  // "Re-roll one Damage roll" over every Damage roll, main and mortal streams alike, shared in
  // proportion to their rolls. A roll another permission already re-rolled cannot be re-rolled, so
  // beside one the single die is not priced.
  const damageRolls = unsaved + mortalWoundsStream;
  const damageRerollOne = resolved.rerollOne.damage && !damageReroll && damageRolls > 0 ? oneDamageRerollGain(perAttack.distribution, damageRolls) : 0;
  if (damageRerollOne > 0) {
    damageMain += damageRerollOne * (unsaved / damageRolls);
    damageMortal += damageRerollOne * (mortalWoundsStream / damageRolls);
  }
  const damage = damageMain + damageMortal;
  stages.push({
    name: "damage",
    expected: damage,
    detail: `D ${baseD}${meltaBonus ? ` + Melta ${meltaBonus} (half range)` : ""}${resolved.damageMod.value !== 0 ? ` ${signed(resolved.damageMod.value)} (mod)` : ""}${damageReduction > 0 ? ` -${damageReduction} (defender, min 1)` : ""}${damageReroll ? `, reroll ${damageReroll}${perAttack.rerollUsed ? "" : " (no effect)"}` : ""} = ${damagePerHit} per hit${resolved.rerollOne.damage ? `; re-roll one Damage roll: +${damageRerollOne.toFixed(4)}` : ""}; main ${damageMain.toFixed(4)}, mortal ${damageMortal.toFixed(4)}`,
  });

  // 6. FNP
  // Two scopes compose: an all-FNP fires on every unsaved wound; a mortal-FNP
  // fires only on the mortal-wound stream (e.g. Death Guard 5+ FNP vs mortals).
  // A target carrying both rolls both against mortals — independent Bernoulli
  // trials, so the surviving fractions multiply.
  const pSurviveAll = fnpSurvivalFraction(resolved.feelNoPain);
  const pSurviveMortal = fnpSurvivalFraction(resolved.feelNoPainMortal);
  const afterMain = damageMain * pSurviveAll;
  const afterMortal = damageMortal * pSurviveAll * pSurviveMortal;
  const afterFnp = afterMain + afterMortal;
  const fnpDetail = describeFnp(resolved.feelNoPain, resolved.feelNoPainMortal);
  stages.push({ name: "after-fnp", expected: afterFnp, detail: fnpDetail });

  // 7. Models killed
  const W = unitProfile.W;
  const expectedModelsKilled = W > 0 ? Math.min(targetModelCount, afterFnp / W) : 0;
  stages.push({
    name: "models-killed",
    expected: expectedModelsKilled,
    detail: `W${W} per model, ${targetModelCount} models in target; ${afterFnp.toFixed(4)} damage / ${W} = ${(afterFnp / W).toFixed(4)} (capped at ${targetModelCount})`,
  });

  const model: AttackModel = {
    modelsFiring: input.modelsFiring,
    attacksStat: weaponProfile.stats.A,
    attacksBonus: resolved.attacksMod.value + blastExtraPerModel,
    rapidFireStat: rapidFire && halfRange ? rapidFire.parameters?.value : null,
    torrent,
    hit: hitProbs,
    sustainedStat: sustained ? sustained.parameters?.value : null,
    lethal: hasLethal,
    wound: woundProbs,
    devastating: hasDevastating,
    unsaved: 1 - pSaved,
    damage: perAttack.distribution,
    woundLost: pSurviveAll,
    mortalWoundLost: pSurviveAll * pSurviveMortal,
    wounds: W,
    modelCount: targetModelCount,
  };
  return { output: { stages, resolved }, model };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lower-cased union of a unit's `keywords` + `faction_keywords`. */
function unitKeywordsLower(unit: Unit): string[] {
  const out: string[] = [];
  for (const k of unit.keywords ?? []) out.push(String(k).toLowerCase());
  for (const k of unit.faction_keywords ?? []) out.push(String(k).toLowerCase());
  return out;
}


function profileBuffsFor(
  attacker: AttackProfileRef,
  dataset: Dataset,
  ctx: EngineContext,
): Buff[] {
  // Resolve a profile's intrinsic keyword buffs from the attacker's OWN weapon
  // object — NEVER a dataset.weapons.get(id) re-lookup. A bare weapon id shared
  // across factions (close-combat-weapon, power-fist, lascannon, …) first-wins-
  // resolves to whichever faction bundled first, so re-resolving would feed the
  // WRONG faction's profile/keywords into buff math (issue #59). attacker.weapon
  // is authoritative and carries its full profiles + keyword references.
  const profile = attacker.weapon.profiles[attacker.profileIndex];
  if (!profile) return [];
  const out: Buff[] = [];
  for (const ref of profile.keywords ?? []) {
    const parameters = ref.parameters as Record<string, unknown> | undefined;
    const view = dataset.weaponKeywords.get(ref.keyword_id);
    if (!view) continue;
    out.push(
      ...view.getBuffs(
        parameters,
        attacker.weapon.id,
        ctx,
      ),
    );
  }
  return out;
}

function findKeyword(
  resolved: ResolvedModifiers,
  keywordId: string,
): WeaponKeywordRef | undefined {
  return resolved.extraKeywords.find((e) => e.keywordRef.keyword_id === keywordId)?.keywordRef;
}

/** Standard 10e S-vs-T table → unmodified wound threshold (2..6). */
function woundThreshold(S: number, T: number): number {
  if (S >= 2 * T) return 2;
  if (S > T) return 3;
  if (S === T) return 4;
  if (S * 2 > T) return 5;
  return 6;
}

/** Probability a single die check passes (and the conditional crit rate). */
function checkProbabilities(args: {
  unmodifiedNeeded: number;
  modifier: number;
  reroll: "none" | "ones" | "all-failures";
  autoFailOnOne: boolean;
  autoPassOnSix: boolean;
  /** Natural roll ≥ this is a crit. Use 7 to disable crits. */
  critThreshold: number;
}): { pass: number; crit: number; open: number } {
  function outcome(face: number): { pass: number; crit: number } {
    if (args.autoFailOnOne && face === 1) return { pass: 0, crit: 0 };
    if (face >= args.critThreshold) return { pass: 1, crit: 1 };
    if (args.autoPassOnSix && face === 6) return { pass: 1, crit: 0 };
    return (face + args.modifier) >= args.unmodifiedNeeded
      ? { pass: 1, crit: 0 }
      : { pass: 0, crit: 0 };
  }

  let pass = 0;
  let crit = 0;
  // A failed die no permission re-rolls: what a "re-roll one" can still take.
  let open = 0;
  for (let face = 1; face <= 6; face++) {
    const initial = outcome(face);
    if (initial.pass === 1) {
      pass += 1 / 6;
      crit += initial.crit / 6;
      continue;
    }
    // Failed initial — eligible for reroll?
    const eligible =
      args.reroll === "all-failures" || (args.reroll === "ones" && face === 1);
    if (!eligible) {
      open += 1 / 6;
      continue;
    }
    // Reroll: uniform over 1..6.
    let rerollPass = 0;
    let rerollCrit = 0;
    for (let f2 = 1; f2 <= 6; f2++) {
      const second = outcome(f2);
      rerollPass += second.pass / 6;
      rerollCrit += second.crit / 6;
    }
    pass += rerollPass / 6;
    crit += rerollCrit / 6;
  }
  return { pass, crit, open };
}

/**
 * Expected dice a "re-roll one" re-rolls over a pool of `pool` dice that each end failed and
 * un-rerolled with probability `open`: for a whole pool, the chance at least one does,
 * 1 - (1 - open)^pool. A pool the engine carries as an expectation is read between the whole pools
 * either side of it, which is exact when it is one of the two and never overstates a concave gain.
 */
export function oneRerollDice(pool: number, open: number): number {
  return pool > 0 && open > 0 ? betweenWholePools(pool, (dice) => 1 - Math.pow(1 - open, dice)) : 0;
}

/** `atWhole` at a fractional `pool`, read linearly between the whole pools either side. */
export function betweenWholePools(pool: number, atWhole: (dice: number) => number): number {
  const low = Math.floor(pool);
  const below = atWhole(low);
  return pool === low ? below : below + (pool - low) * (atWhole(low + 1) - below);
}

/**
 * Mean value of a stat (number or dice expression like `"D6"`, `"2D6"`,
 * `"D3+1"`, `"D6-1"`). Unrecognised strings throw — better to crash than to
 * silently return 0 and produce a confidently wrong damage projection.
 */
function evalStatValue(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") throw new Error(`evalStatValue: unresolved quantity ${JSON.stringify(v)}`);
  const trimmed = v.trim();
  if (trimmed === "") throw new Error("evalStatValue: empty quantity");
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;
  const match = /^(\d*)D(\d+)([+-]\d+)?$/i.exec(trimmed);
  if (!match) throw new Error(`evalStatValue: cannot parse "${v}"`);
  const count = match[1] === "" ? 1 : Number(match[1]);
  const die = Number(match[2]);
  const offset = match[3] ? Number(match[3]) : 0;
  return count * (die + 1) / 2 + offset;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "0";
}

/** Fraction of damage that survives a single FNP roll (1 if no FNP). */
function fnpSurvivalFraction(
  fnp: { threshold: number; dominantSource: unknown } | null,
): number {
  if (!fnp) return 1;
  const pSucc = Math.max(0, Math.min(1, (7 - fnp.threshold) / 6));
  return 1 - pSucc;
}

function describeFnp(
  all: { threshold: number; dominantSource: unknown } | null,
  mortal: { threshold: number; dominantSource: unknown } | null,
): string {
  if (!all && !mortal) return "no FNP";
  const parts: string[] = [];
  if (all) {
    const pSucc = (7 - all.threshold) / 6;
    parts.push(`FNP ${all.threshold}+ (P=${pSucc.toFixed(4)})`);
  }
  if (mortal) {
    const pSucc = (7 - mortal.threshold) / 6;
    parts.push(`FNP ${mortal.threshold}+ vs mortals (P=${pSucc.toFixed(4)})`);
  }
  return parts.join(", ");
}

function attacksDetail(
  models: number,
  per: number,
  rapidFire: number,
  blast: number,
): string {
  const parts = [`${models} × ${per}`];
  if (rapidFire) parts.push(`+ Rapid Fire ${rapidFire} (half range)`);
  if (blast) parts.push(`+ Blast ${blast}/model`);
  return parts.join(" ");
}

let _embeddedDataset: Dataset | null = null;
function lazyEmbeddedDataset(): Dataset {
  if (!_embeddedDataset) _embeddedDataset = Dataset.embedded();
  return _embeddedDataset;
}

export type { Phase };

function hasAttackComparison(gate: BuffApplicability | undefined): boolean {
  return gate !== undefined && (gate.attackComparisons !== undefined || (gate.weaponRequirements ?? []).some(hasAttackComparison));
}
