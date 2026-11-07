/**
 * Conformance rows for {@link Dataset.defensiveLeversFor}: the defending unit's opt-in levers, read
 * from each port's embedded dataset. Rows pin an optional ability behind a roll (undecided, held,
 * failed), a usage pool, a `choice` pool, a stance pool, and a Stratagem's lever with and without
 * the opt-in.
 */
import type { EngineContext } from "./cruncher/buffs.js";
import { conditionFactKey } from "./cruncher/condition-facts.js";
import type { Dataset } from "./data/dataset.js";

type DefensiveLeverRow = {
  caseId: string;
  input: { unitId: string; factionId: string; detachmentId?: string; optedInStratagemIds?: string[] };
  context: EngineContext;
};

const psyker = { unitId: "primaris-psyker", factionId: "astra-militarum" };
const barrierRoll = conditionFactKey(
  { type: "dice-table-result", parameters: { ability: "psychic-barrier-astra-militarum", dice: "D6", results: [2, 3, 4, 5, 6] } },
  "target",
);
const mortifiers = { unitId: "mortifiers", factionId: "adepta-sororitas", detachmentId: "penitent-host" };

/** Every defensive-levers row with its expectation. */
export function canonicalDefensiveLeverCases(ds: Dataset): (DefensiveLeverRow & { expected: unknown })[] {
  const rows: DefensiveLeverRow[] = [
    { caseId: "optional-roll-undecided", input: psyker, context: { phase: "shooting" } },
    { caseId: "optional-roll-holds", input: psyker, context: { phase: "shooting", conditionFacts: { [barrierRoll]: true } } },
    { caseId: "optional-roll-fails", input: psyker, context: { phase: "shooting", conditionFacts: { [barrierRoll]: false } } },
    { caseId: "usage-pool", input: { unitId: "canoness", factionId: "adepta-sororitas" }, context: { phase: "shooting" } },
    { caseId: "choice-pool", input: { unitId: "trajann-valoris", factionId: "adeptus-custodes" }, context: { phase: "fight" } },
    { caseId: "stance-pool", input: { unitId: "telemon-heavy-dreadnought", factionId: "adeptus-custodes" }, context: { phase: "shooting" } },
    { caseId: "stratagem-not-opted-in", input: mortifiers, context: { phase: "shooting" } },
    {
      caseId: "stratagem-opted-in",
      input: { ...mortifiers, optedInStratagemIds: ["purity-of-suffering-penitent-host-adepta-sororitas"] },
      context: { phase: "shooting" },
    },
  ];
  return rows.map((row) => {
    const { buffs, groups } = ds.defensiveLeversFor(row.input, row.context);
    return {
      ...row,
      expected: {
        levers: buffs.map((lever) => ({
          id: lever.id,
          label: lever.label,
          enabled: lever.enabled,
          source: lever.source,
          group: lever.group ?? null,
          groups: lever.groups ?? null,
          requires: lever.requires ?? null,
          buffs: lever.buffs.map((buff) => buff.contribution),
        })),
        groups,
      },
    };
  });
}
