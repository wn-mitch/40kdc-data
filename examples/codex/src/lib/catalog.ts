import { factions } from "@alpaca-software/40kdc-data";
import type { FactionView, UnitView } from "@alpaca-software/40kdc-data";
import {
  detachmentsForFaction,
  resolveAbility,
  type ResolvedAbility,
  type ResolvedDetachment,
} from "../../../data-explorer/src/lib/detachments.js";
import type { CodexRoute } from "./routes.js";

export interface DirectoryPage {
  kind: "directory";
  factions: FactionView[];
}

export interface FactionPage {
  kind: "faction";
  faction: FactionView;
  factionRules: ResolvedAbility[];
  units: UnitView[];
  detachments: ResolvedDetachment[];
}

export interface UnitPage {
  kind: "unit";
  faction: FactionView;
  unit: UnitView;
  factionRules: ResolvedAbility[];
  units: UnitView[];
  detachments: ResolvedDetachment[];
}

export interface DetachmentPage {
  kind: "detachment";
  faction: FactionView;
  detachment: ResolvedDetachment;
  factionRules: ResolvedAbility[];
  units: UnitView[];
  detachments: ResolvedDetachment[];
}

export interface NotFoundPage {
  kind: "not-found";
}

export type CodexPage =
  | DirectoryPage
  | FactionPage
  | UnitPage
  | DetachmentPage
  | NotFoundPage;

function factionPageData(faction: FactionView) {
  return {
    factionRules: faction.raw.faction_rule_ids
      .map((ruleId) => resolveAbility(ruleId, faction.id))
      .filter((rule): rule is ResolvedAbility => rule !== undefined),
    units: [...faction.units].sort((left, right) => left.name.localeCompare(right.name)),
    detachments: detachmentsForFaction(faction.id),
  };
}

/** Resolve a route through faction-scoped linked views. */
export function resolveCodexRoute(route: CodexRoute): CodexPage {
  if (route.kind === "home") {
    return {
      kind: "directory",
      factions: [...factions].sort((left, right) => left.name.localeCompare(right.name)),
    };
  }
  if (route.kind === "not-found") return { kind: "not-found" };

  const faction = factions.getAny(route.factionId);
  if (!faction) return { kind: "not-found" };
  const data = factionPageData(faction);

  if (route.kind === "faction") return { kind: "faction", faction, ...data };
  if (route.kind === "unit") {
    const unit = data.units.find((candidate) => candidate.id === route.unitId);
    return unit ? { kind: "unit", faction, unit, ...data } : { kind: "not-found" };
  }

  const detachment = data.detachments.find(
    (candidate) => candidate.raw.id === route.detachmentId,
  );
  return detachment
    ? { kind: "detachment", faction, detachment, ...data }
    : { kind: "not-found" };
}
