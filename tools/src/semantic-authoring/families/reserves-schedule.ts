import { enumValue, exactKeys } from "../family-validation.js";
import { present, type Params } from "./containers-and-abilities-shared.js";
import type { FlatFamily } from "./types.js";

/** Where a scheduled unit must be set up when it arrives from Strategic Reserves. */
const ARRIVAL_PLACEMENTS = ["wholly-within-deployment-zone"] as const;

function reservesSchedule(input: Params): Params {
  exactKeys(input, present(input, ["set_up"]), "reserves-schedule");
  const result: Params = {};
  if ("set_up" in input) result.set_up = enumValue(input.set_up, ARRIVAL_PLACEMENTS, "reserves-schedule.set_up");
  return result;
}

export const RESERVES_SCHEDULE_FAMILIES: readonly FlatFamily[] = [
  {
    id: "reserves-schedule",
    version: 1,
    role: "EFFECT",
    label: "Reserves arrival schedule",
    description: "The listed units must start the battle in Strategic Reserves and cannot be set up on the battlefield before the battle round each row states (\"the following friendly units must start the battle in strategic reserves and cannot be set up on the battlefield before the battle round stated\"). The rows follow the leaf: each is a unit-filter naming one datasheet (datasheets, the reviewed unit id; or unit_names when the printed name is the datasheet's exact name) and a battle-round with min, the first round the units can arrive (\"Emperor's Champion: Battle round 2\"). set_up wholly-within-deployment-zone: when they arrive they must be set up wholly within your deployment zone.",
    starter: {},
    parameterSchema: { type: "object", required: [], properties: { set_up: { enum: [...ARRIVAL_PLACEMENTS], "x-optional": true } }, additionalProperties: false },
    normalize: reservesSchedule,
  },
];
