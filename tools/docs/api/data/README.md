[**@alpaca-software/40kdc-data**](../README.md)

***

[@alpaca-software/40kdc-data](../README.md) / data

# data

The linked, typed 40kdc dataset.

The default [dataset](variables/dataset.md) is built once from the data embedded in this
package; the top-level collections below are its accessors, re-exported for
the ergonomic one-liner form.

## Examples

```ts
import { units } from "@alpaca-software/40kdc-data";

units.find("Kharn")!.abilities
  .filter(a => a.phases.includes("shooting"))
  .map(a => a.id); // ["berzerker-frenzy"]
```

```ts
import { factions } from "@alpaca-software/40kdc-data";

factions.find("World Eaters")!.units.length;
```

## Classes

- [Collection](classes/Collection.md)
- [Dataset](classes/Dataset.md)
- [UnitView](classes/UnitView.md)
- [AbilityView](classes/AbilityView.md)
- [WeaponView](classes/WeaponView.md)
- [WeaponKeywordView](classes/WeaponKeywordView.md)
- [FactionView](classes/FactionView.md)
- [ShareRegistryIndex](classes/ShareRegistryIndex.md)

## Interfaces

- [HasBuffs](interfaces/HasBuffs.md)
- [AffordabilityUnit](interfaces/AffordabilityUnit.md)
- [AffordabilitySpec](interfaces/AffordabilitySpec.md)
- [CandidateCost](interfaces/CandidateCost.md)
- [CollectionConfig](interfaces/CollectionConfig.md)
- [WeaponBound](interfaces/WeaponBound.md)
- [Loadout](interfaces/Loadout.md)
- [Violation](interfaces/Violation.md)
- [LoadoutModel](interfaces/LoadoutModel.md)
- [LoadoutGroupWeapon](interfaces/LoadoutGroupWeapon.md)
- [LoadoutGroup](interfaces/LoadoutGroup.md)
- [CompletedLoadout](interfaces/CompletedLoadout.md)
- [UnitLegality](interfaces/UnitLegality.md)
- [RosterViolation](interfaces/RosterViolation.md)
- [RosterLegality](interfaces/RosterLegality.md)
- [NormRoster](interfaces/NormRoster.md)
- [RawData](interfaces/RawData.md)
- [ShareUnit](interfaces/ShareUnit.md)
- [ShareList](interfaces/ShareList.md)
- [ShareRegistry](interfaces/ShareRegistry.md)

## Type Aliases

- [EligibleAbilitySource](type-aliases/EligibleAbilitySource.md)
- [EligibilityInput](type-aliases/EligibilityInput.md)
- [EligibleAbility](type-aliases/EligibleAbility.md)
- [StageLift](type-aliases/StageLift.md)
- [AttributedStage](type-aliases/AttributedStage.md)
- [BuffSource](type-aliases/BuffSource.md)
- [WeaponKeywordRef](type-aliases/WeaponKeywordRef.md)
- [BuffContribution](type-aliases/BuffContribution.md)
- [BuffApplicability](type-aliases/BuffApplicability.md)
- [Buff](type-aliases/Buff.md)
- [EngineContext](type-aliases/EngineContext.md)
- [ResolveContext](type-aliases/ResolveContext.md)
- [ResolvedModifiers](type-aliases/ResolvedModifiers.md)
- [AttackProfileRef](type-aliases/AttackProfileRef.md)
- [TargetProfileRef](type-aliases/TargetProfileRef.md)
- [Stage](type-aliases/Stage.md)
- [EngineInput](type-aliases/EngineInput.md)
- [EngineOutput](type-aliases/EngineOutput.md)
- [UnsupportedFragment](type-aliases/UnsupportedFragment.md)
- [ActivatableGroupRef](type-aliases/ActivatableGroupRef.md)
- [ActivatableBuff](type-aliases/ActivatableBuff.md)
- [EffectTranslation](type-aliases/EffectTranslation.md)
- [TranslationPerspective](type-aliases/TranslationPerspective.md)
- [StackableBuff](type-aliases/StackableBuff.md)
- [StackableBuffGroup](type-aliases/StackableBuffGroup.md)
- [ReactiveTrigger](type-aliases/ReactiveTrigger.md)
- [RosterViolationCode](type-aliases/RosterViolationCode.md)
- [UnitProfile](type-aliases/UnitProfile.md)
- [WeaponProfile](type-aliases/WeaponProfile.md)
- [ShareBattleSize](type-aliases/ShareBattleSize.md)
- [ShareLoadoutEntry](type-aliases/ShareLoadoutEntry.md)
- [DecodeResult](type-aliases/DecodeResult.md)
- [ShareKind](type-aliases/ShareKind.md)

## Variables

- [dataset](variables/dataset.md)
- [units](variables/units.md)
- [targetProfiles](variables/targetProfiles.md)
- [weapons](variables/weapons.md)
- [weaponKeywords](variables/weaponKeywords.md)
- [unitKeywords](variables/unitKeywords.md)
- [factions](variables/factions.md)
- [abilities](variables/abilities.md)
- [detachments](variables/detachments.md)
- [alliedRules](variables/alliedRules.md)
- [enhancements](variables/enhancements.md)
- [stratagems](variables/stratagems.md)
- [wargearOptions](variables/wargearOptions.md)
- [wargear](variables/wargear.md)
- [missions](variables/missions.md)
- [missionMatchups](variables/missionMatchups.md)
- [missionCards](variables/missionCards.md)
- [deploymentPatterns](variables/deploymentPatterns.md)
- [forceDispositions](variables/forceDispositions.md)
- [terrainTemplates](variables/terrainTemplates.md)
- [terrainLayouts](variables/terrainLayouts.md)
- [hullShapes](variables/hullShapes.md)
- [resourcePools](variables/resourcePools.md)
- [LOADOUT\_CANDIDATES\_DEFAULT\_LIMIT](variables/LOADOUT_CANDIDATES_DEFAULT_LIMIT.md)
- [LOADOUT\_CANDIDATES\_TRUNCATED](variables/LOADOUT_CANDIDATES_TRUNCATED.md)
- [SHARE\_FORMAT\_VERSION](variables/SHARE_FORMAT_VERSION.md)
- [shareRegistryVersion](variables/shareRegistryVersion.md)
- [SHARE\_KINDS](variables/SHARE_KINDS.md)

## Functions

- [resolveEligibleAbilities](functions/resolveEligibleAbilities.md)
- [attributeStages](functions/attributeStages.md)
- [resolveBuffs](functions/resolveBuffs.md)
- [profileCanTarget](functions/profileCanTarget.md)
- [crunch](functions/crunch.md)
- [effectToBuffs](functions/effectToBuffs.md)
- [parseKeywordGrant](functions/parseKeywordGrant.md)
- [buffsFromKeyword](functions/buffsFromKeyword.md)
- [getBuffs](functions/getBuffs.md)
- [candidateAffordability](functions/candidateAffordability.md)
- [pointsLimitForBattleSize](functions/pointsLimitForBattleSize.md)
- [detachmentCapForBattleSize](functions/detachmentCapForBattleSize.md)
- [optionCap](functions/optionCap.md)
- [baseLoadout](functions/baseLoadout.md)
- [maximalLoadout](functions/maximalLoadout.md)
- [weaponBounds](functions/weaponBounds.md)
- [clampWeaponCount](functions/clampWeaponCount.md)
- [groupLoadout](functions/groupLoadout.md)
- [completeLoadout](functions/completeLoadout.md)
- [validateLoadout](functions/validateLoadout.md)
- [loadoutCandidates](functions/loadoutCandidates.md)
- [normalizeName](functions/normalizeName.md)
- [stripLeadingThe](functions/stripLeadingThe.md)
- [baseUnitPoints](functions/baseUnitPoints.md)
- [hostPointsTiers](functions/hostPointsTiers.md)
- [hostUnitPoints](functions/hostUnitPoints.md)
- [pointsTierMissing](functions/pointsTierMissing.md)
- [wargearPoints](functions/wargearPoints.md)
- [resolveRosterUnit](functions/resolveRosterUnit.md)
- [resolveRosterWargear](functions/resolveRosterWargear.md)
- [checkRosterLegality](functions/checkRosterLegality.md)
- [validateRosterCore](functions/validateRosterCore.md)
- [checkRoster](functions/checkRoster.md)
- [resolveAttachedLeader](functions/resolveAttachedLeader.md)
- [resolveAttachmentPartners](functions/resolveAttachmentPartners.md)
- [primaryDetachment](functions/primaryDetachment.md)
- [primaryDetachmentId](functions/primaryDetachmentId.md)
- [emptyRawData](functions/emptyRawData.md)
- [isMeleeProfile](functions/isMeleeProfile.md)
- [encodeShareToken](functions/encodeShareToken.md)
- [decodeShareToken](functions/decodeShareToken.md)
- [rosterToShareList](functions/rosterToShareList.md)
