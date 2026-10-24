import type { Dataset } from "../data/dataset.js";
import {
  completeLoadout,
  validateLoadout,
  type LoadoutGroup,
  type LoadoutModel,
  type Violation as LoadoutViolation,
} from "../data/loadout.js";
import { hostPointsTiers, hostUnitPoints, wargearPoints } from "../data/pricing.js";
import {
  validateRosterCore,
  type RosterViolation,
} from "../data/roster-resolve.js";
import type {
  Detachment,
  Enhancement,
  Faction,
  Unit,
  WargearOption,
} from "../generated.js";

export type LegalityStatus = "legal" | "illegal" | "unsupported";

export interface LegalityIssue {
  code: string;
  id: string;
  message: string;
}

export interface LegalityResult {
  status: LegalityStatus;
  issues: LegalityIssue[];
}

export interface CandidateLoadoutLegality {
  legal: boolean;
  violations: LoadoutViolation[];
  /** Per-model loadouts of a legal candidate, when whole-model completion applies. */
  groups: LoadoutGroup[] | null;
}

export interface LocalStackMember {
  unit: Unit;
  modelCount: number;
  loadout: ReadonlyMap<string, number>;
  enhancementId?: string | null;
  leaderBodyguardId?: string | null;
  keywordOverrides?: readonly string[];
}

function issueOf(violation: RosterViolation): LegalityIssue {
  return {
    code: violation.code,
    id: violation.id,
    message: violation.message,
  };
}

function rosterSpec(input: {
  factionId: string;
  detachmentIds: readonly string[];
  members: readonly LocalStackMember[];
}) {
  return {
    factionId: input.factionId,
    battleSize: null,
    forceDisposition: null,
    detachmentIds: [...input.detachmentIds],
    units: input.members.map((member) => ({
      unitId: member.unit.id,
      modelCount: member.modelCount,
      isWarlord: false,
      keywordOverrides: member.keywordOverrides
        ? [...member.keywordOverrides]
        : undefined,
      enhancementId: member.enhancementId ?? null,
      leaderBodyguardId: member.leaderBodyguardId ?? null,
      counts: new Map(member.loadout),
    })),
  };
}

function sameCounts(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  const ids = new Set([...left.keys(), ...right.keys()]);
  return [...ids].every((id) => (left.get(id) ?? 0) === (right.get(id) ?? 0));
}

/**
 * Authoritative in-loop loadout gate; callers must reject every nonempty result.
 * A candidate is an exact whole-unit loadout, not an importer's sparse selection,
 * so when whole-model completion applies it must reproduce these counts exactly.
 * Completion otherwise tolerates exporter double-counting by dropping the lower
 * bound on items shared by several bundled branches, which would accept any
 * count of such an item.
 */
export function validateCandidateLoadout(input: {
  unit: Unit;
  modelCount: number;
  options: readonly WargearOption[];
  counts: ReadonlyMap<string, number>;
  models: readonly LoadoutModel[];
}): CandidateLoadoutLegality {
  const violations = validateLoadout(
    input.unit,
    input.modelCount,
    input.options,
    new Map(input.counts),
    input.models,
  );
  let groups: LoadoutGroup[] | null = null;
  if (violations.length === 0) {
    const completed = completeLoadout(input.unit, input.modelCount, input.options, input.models, new Map(input.counts));
    if (completed && !sameCounts(completed.counts, input.counts)) {
      violations.push({
        id: input.unit.id,
        code: "swap-conflict",
        message: `${input.unit.id}: no legal whole-model assignment carries exactly these counts`,
      });
    } else {
      groups = completed?.groups ?? null;
    }
  }
  return { legal: violations.length === 0, violations, groups };
}

const ENHANCEMENT_CODES: Record<string, true> = {
  "enhancement-wrong-detachment": true,
  "enhancement-on-non-character": true,
  "enhancement-on-epic-hero": true,
  "enhancement-on-excluded-model": true,
  "enhancement-keyword-mismatch": true,
  "enhancement-excluded-keyword": true,
  "enhancement-over-max-targets": true,
  "ally-cannot-take-enhancements": true,
};

/**
 * Uses the repository's roster validator as the authority for enhancement
 * assignment. Upgrade tags are supported for non-Character targets; a Character
 * upgrade-tag target is reported as unsupported because the local-stack search
 * cannot safely reinterpret that distinct roster mechanism as an Enhancement.
 */
export function assessEnhancementAssignment(input: {
  dataset: Dataset;
  factionId: string;
  detachmentIds: readonly string[];
  members: readonly LocalStackMember[];
  bearerIndex: number;
  enhancement: Enhancement;
}): LegalityResult {
  const bearer = input.members[input.bearerIndex];
  if (!bearer) {
    return {
      status: "illegal",
      issues: [{
        code: "enhancement-bearer-missing",
        id: input.enhancement.id,
        message: `No stack member exists at bearer index ${input.bearerIndex}`,
      }],
    };
  }
  if (input.dataset.enhancements.get(input.enhancement.id) === undefined) {
    return {
      status: "unsupported",
      issues: [{
        code: "enhancement-not-in-dataset",
        id: input.enhancement.id,
        message: `${input.enhancement.id} cannot be checked by the authoritative roster validator`,
      }],
    };
  }

  const members = input.members.map((member, index) => ({
    ...member,
    enhancementId:
      index === input.bearerIndex
        ? input.enhancement.id
        : member.enhancementId,
  }));
  const legality = validateRosterCore(
    rosterSpec({ ...input, members }),
    input.dataset,
  );
  const issues = legality.army
    .filter(
      (violation) =>
        violation.severity === "error" && ENHANCEMENT_CODES[violation.code] === true,
    )
    .map(issueOf);
  if (issues.length > 0) return { status: "illegal", issues };

  const bearerKeywords = new Set([
    ...(bearer.unit.keywords ?? []),
    ...(bearer.unit.faction_keywords ?? []),
    ...(bearer.keywordOverrides ?? []),
  ]);
  const character =
    bearer.unit.role === "character" ||
    bearer.unit.role === "epic-hero" ||
    [...bearerKeywords].some(
      (keyword) => keyword.toLocaleLowerCase() === "character",
    );
  if (input.enhancement.upgrade_tag === true && character) {
    return {
      status: "unsupported",
      issues: [{
        code: "upgrade-tag-character-target",
        id: input.enhancement.id,
        message: `${input.enhancement.id} is an upgrade tag, but ${bearer.unit.id} is a Character`,
      }],
    };
  }
  return { status: "legal", issues: [] };
}

const LOCAL_DETACHMENT_CODES: Record<string, true> = {
  "detachment-tag-conflict": true,
  "detachment-restriction-required": true,
  "detachment-restriction-excluded": true,
  "detachment-excluded-datasheet": true,
  "unit-excluded-from-faction": true,
};

/**
 * Checks every local member through the existing roster validator. Whole-army
 * constraints that a local attached-unit stack cannot prove are never called
 * legal: they produce an explicit unsupported result.
 */
export function assessDetachmentSelection(input: {
  dataset: Dataset;
  factionId: string;
  detachment: Detachment;
  selectedDetachmentIds: readonly string[];
  members: readonly LocalStackMember[];
}): LegalityResult {
  if (
    input.dataset.detachments.getInFaction(
      input.detachment.id,
      input.factionId,
    ) === undefined &&
    input.dataset.detachments.getAny(input.detachment.id) === undefined
  ) {
    return {
      status: "unsupported",
      issues: [{
        code: "detachment-not-in-dataset",
        id: input.detachment.id,
        message: `${input.detachment.id} cannot be checked by the authoritative roster validator`,
      }],
    };
  }
  const detachmentIds = input.selectedDetachmentIds.includes(input.detachment.id)
    ? [...input.selectedDetachmentIds]
    : [...input.selectedDetachmentIds, input.detachment.id];
  const legality = validateRosterCore(
    rosterSpec({ ...input, detachmentIds }),
    input.dataset,
  );
  const illegal = legality.army
    .filter(
      (violation) =>
        violation.severity === "error" && LOCAL_DETACHMENT_CODES[violation.code] === true,
    )
    .map(issueOf);
  if (illegal.length > 0) return { status: "illegal", issues: illegal };

  const unsupported: LegalityIssue[] = [];
  if ((input.detachment.unit_minimums ?? []).length > 0) {
    unsupported.push({
      code: "detachment-unit-minimum-requires-roster",
      id: input.detachment.id,
      message: `${input.detachment.id} has unit minimums that a local stack cannot prove`,
    });
  }
  if ((input.detachment.mandatory_warlord_datasheet_ids ?? []).length > 0) {
    unsupported.push({
      code: "detachment-warlord-requires-roster",
      id: input.detachment.id,
      message: `${input.detachment.id} has a Warlord requirement that a local stack cannot prove`,
    });
  }
  if ((input.detachment.keyword_limit_overrides ?? []).length > 0) {
    unsupported.push({
      code: "detachment-keyword-limit-requires-roster",
      id: input.detachment.id,
      message: `${input.detachment.id} changes army-wide keyword limits`,
    });
  }
  return unsupported.length > 0
    ? { status: "unsupported", issues: unsupported }
    : { status: "legal", issues: [] };
}

export interface SupportCostEntry {
  unitId: string;
  modelCount: number;
  unitPoints: number | null;
  wargearPoints: number;
  enhancementPoints: number;
  totalPoints: number | null;
}

export interface SupportCostSummary {
  status: "priced" | "incomplete";
  totalPoints: number | null;
  entries: SupportCostEntry[];
  issues: LegalityIssue[];
}

function tierSupports(
  unit: Unit,
  modelCount: number,
  ordinal: number,
  hostFaction: Faction | null | undefined,
  detachmentIds: readonly string[],
): boolean {
  return hostPointsTiers(unit, hostFaction, detachmentIds).some((tier) => {
    const ordinalMin = tier.unit_count_min;
    if (ordinalMin != null && ordinal < ordinalMin) return false;
    if (tier.unit_count_max != null && ordinal > tier.unit_count_max) return false;
    return tier.models <= modelCount && modelCount <= (tier.models_max ?? tier.models);
  });
}

/** Reports actual unit, wargear and enhancement costs for external supporters. */
export function summarizeSupportCosts(input: {
  members: readonly {
    unit: Unit;
    modelCount: number;
    ordinal?: number;
    loadout: ReadonlyMap<string, number>;
    enhancement?: Enhancement | null;
  }[];
  hostFaction?: Faction | null;
  detachmentIds?: readonly string[];
}): SupportCostSummary {
  const detachmentIds = input.detachmentIds ?? [];
  const issues: LegalityIssue[] = [];
  const entries = input.members.map((member): SupportCostEntry => {
    const ordinal = member.ordinal ?? 1;
    const supported = tierSupports(
      member.unit,
      member.modelCount,
      ordinal,
      input.hostFaction,
      detachmentIds,
    );
    const unitPoints = supported
      ? hostUnitPoints(
          member.unit,
          member.modelCount,
          ordinal,
          input.hostFaction,
          detachmentIds,
        )
      : null;
    const equipment = wargearPoints(member.unit, member.loadout);
    const enhancement = member.enhancement?.cost ?? 0;
    if (unitPoints === null) {
      issues.push({
        code: "support-points-unresolved",
        id: member.unit.id,
        message: `${member.unit.id} has no applicable points tier for ${member.modelCount} models at ordinal ${ordinal}`,
      });
    }
    return {
      unitId: member.unit.id,
      modelCount: member.modelCount,
      unitPoints,
      wargearPoints: equipment,
      enhancementPoints: enhancement,
      totalPoints:
        unitPoints === null ? null : unitPoints + equipment + enhancement,
    };
  });
  return {
    status: issues.length > 0 ? "incomplete" : "priced",
    totalPoints:
      issues.length > 0
        ? null
        : entries.reduce((sum, entry) => sum + (entry.totalPoints ?? 0), 0),
    entries,
    issues,
  };
}
