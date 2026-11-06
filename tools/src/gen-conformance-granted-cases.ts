import type { EngineContext } from "./cruncher/index.js";
import { resolveGrantedRecords, type GrantedRecord } from "./cruncher/granted-records.js";
import { dslExpectation, type DslInput } from "./gen-conformance-cruncher-cases.js";

export const GRANTED_RECORD_CASE_PREFIX = "canonical/granted-record/";

/**
 * A row's effect with the ability records it grants resolved from its `grantedRecords`, the
 * granting ability's own id excluded. Rows without `grantedRecords` translate their effect as is.
 */
export function withGrantedRecords(row: { effect?: unknown; source: { kind: string; abilityId?: string }; grantedRecords?: Record<string, GrantedRecord> }): unknown {
  const records = row.grantedRecords;
  if (records === undefined) return row.effect;
  const own = row.source.kind === "ability" && row.source.abilityId !== undefined ? [row.source.abilityId] : [];
  return resolveGrantedRecords(row.effect, (id) => records[id], new Set(own));
}

/**
 * Fabricated grants of ability records, translated as the printed rule each names: the record's
 * effect for its holders, a friendly filter deciding who holds it, the record's usage carried
 * along, and a grant of the granting ability itself, a cycle, an unknown record or a model-only
 * holder left as the translator reports it.
 */
export function canonicalGrantedRecordCases() {
  const source = { kind: "ability", abilityId: "fabricated-grantor", abilityKind: "unit" } as const;
  const hitPlus = { type: "roll-modifier", target: "this-unit", modifier: { roll: "hit", operation: "add", value: 1 } };
  const woundPlus = { type: "roll-modifier", target: "this-unit", modifier: { roll: "wound", operation: "add", value: 1 } };
  const grant = (target: unknown, ability: string) => ({ type: "ability-grant", target, modifier: { ability } });
  const friendly = { owner: "friendly", all_of: ["EXAMPLE"] };
  const grantedRecords: Record<string, GrantedRecord> = {
    "fabricated-war-rite": { effect: hitPlus },
    "fabricated-army-rite": { effect: { type: "conditional", condition: { type: "army-faction", parameters: { faction: "example" } }, effect: woundPlus } },
    "fabricated-once-rite": { effect: { type: "stat-modifier", target: "this-unit", modifier: { stat: "AP", operation: "improve", value: 1 } }, usage: { frequency: "once-per-battle", per: "unit" } },
    "fabricated-loop-a": { effect: { type: "sequence", steps: [grant("this-unit", "fabricated-loop-b"), hitPlus] } },
    "fabricated-loop-b": { effect: { type: "sequence", steps: [grant("this-unit", "fabricated-loop-a"), woundPlus] } },
    "fabricated-grantor": { effect: hitPlus },
    "fabricated-ward": { effect: { type: "roll-modifier", target: "attacker", modifier: { roll: "hit", operation: "subtract", value: 1 } } },
  };
  const inputs: Array<{ id: string; effect: unknown; context: Partial<EngineContext>; perspective?: DslInput["perspective"] }> = [
    { id: "own-unit", effect: grant("this-unit", "fabricated-war-rite"), context: {} },
    { id: "friendly-filter", effect: grant(friendly, "fabricated-army-rite"), context: { armyFaction: "example", attackerKeywords: ["EXAMPLE", "INFANTRY"] } },
    { id: "friendly-filter-excluded", effect: grant(friendly, "fabricated-army-rite"), context: { armyFaction: "example", attackerKeywords: ["OTHER"] } },
    { id: "army-undeclared", effect: grant(friendly, "fabricated-army-rite"), context: { attackerKeywords: ["EXAMPLE"] } },
    { id: "record-usage", effect: grant("this-unit", "fabricated-once-rite"), context: {} },
    { id: "cycle", effect: grant("this-unit", "fabricated-loop-a"), context: {} },
    { id: "granting-ability-itself", effect: grant("this-unit", "fabricated-grantor"), context: {} },
    { id: "unknown-record", effect: grant("this-unit", "fabricated-missing"), context: {} },
    { id: "model-holder", effect: grant("this-model", "fabricated-war-rite"), context: {} },
    { id: "defender-side", effect: grant("this-unit", "fabricated-ward"), context: {}, perspective: "target" },
  ];
  // Each row carries only the records its grants reach.
  const reached = (effect: unknown, into: Record<string, GrantedRecord>): Record<string, GrantedRecord> => {
    const ids = JSON.stringify(effect).match(/"ability":"[^"]+"/g) ?? [];
    for (const id of ids.map((match) => match.slice('"ability":"'.length, -1))) {
      const record = grantedRecords[id];
      if (record !== undefined && into[id] === undefined) reached(record.effect, Object.assign(into, { [id]: record }));
    }
    return into;
  };
  return inputs.map((input) => {
    const row = {
      caseId: `${GRANTED_RECORD_CASE_PREFIX}${input.id}`,
      abilityId: source.abilityId,
      source,
      effect: input.effect,
      grantedRecords: reached(input.effect, {}),
      context: { phase: input.context.phase ?? "shooting", ...input.context },
      perspective: input.perspective ?? "attacker",
    };
    const { expected } = dslExpectation({ ...row, effect: withGrantedRecords(row) });
    return { ...row, expected };
  });
}

export const OWN_DEFINITION_CASE_PREFIX = "canonical/own-definition/";

/**
 * Fabricated grants that name, without printing it, an ability their own record prints in another
 * grant: the reference translates as that printed body. A definition the record does not print,
 * or the same effect read as another record's, stays unresolved.
 */
export function canonicalOwnDefinitionCases() {
  const source = { kind: "ability", abilityId: "fabricated-printer", abilityKind: "unit" } as const;
  const named = { ability_id: "fabricated-printer" };
  const lethal = { type: "weapon-ability-grant", target: "this-unit", modifier: { keywords: [{ keyword_id: "lethal-hits" }] } };
  const printed = { type: "ability-grant", target: { owner: "friendly", all_of: ["NOT THIS UNIT"] }, modifier: { ability: { ...named, definition_id: "fabricated-part" }, definition: { type: "ability-part", name: "Fabricated Part", effect: lethal } } };
  const reference = (definition_id: string) => ({ type: "ability-grant", target: "this-unit", modifier: { ability: { ...named, definition_id } } });
  const inputs: Array<{ id: string; effect: unknown; abilityId?: string }> = [
    { id: "self-reference", effect: { type: "sequence", steps: [printed, reference("fabricated-part")] } },
    { id: "unprinted-definition", effect: { type: "sequence", steps: [printed, reference("fabricated-unprinted")] } },
    { id: "another-record", effect: { type: "sequence", steps: [printed, reference("fabricated-part")] }, abilityId: "fabricated-other-record" },
  ];
  return inputs.map((input) => {
    const rowSource = { ...source, abilityId: input.abilityId ?? source.abilityId };
    const row: DslInput = {
      caseId: `${OWN_DEFINITION_CASE_PREFIX}${input.id}`,
      abilityId: rowSource.abilityId,
      source: rowSource,
      effect: input.effect,
      context: { phase: "shooting" },
      perspective: "attacker",
    };
    return dslExpectation(row);
  });
}
