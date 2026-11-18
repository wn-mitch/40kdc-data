import {
  enumOrSource, enumValue, exactKeys, keySet,
} from "../family-validation.js";
import {
  type Params, ANTECEDENT, ENTITY_ID, MOVE_SUBJECTS, MOVE_ACTOR_SUBJECTS, subjectOrSource,
} from "./movement-and-units-shared.js";
import type { FlatFamily } from "./types.js";

/** Set-up, battlefield markers, the deployment window and engaged-only qualifiers. */

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${label} must be a non-negative integer.`);
}

const SETUP_TO = ["battlefield", "strategic-reserves"] as const;
const SETUP_FROM = ["strategic-reserves", "transport", "battlefield"] as const;
const SETUP_PLACEMENTS = ["closest-to-destruction", "closest-to-original", "deployment-zone", "wholly-within", "anywhere"] as const;
/** set-up parameters that place a permitted set-up; a forbidden one names its zone through a folded limit. */
const SETUP_PLACING_KEYS = ["via", "marker_inches", "marker_wholly", "placement", "ignore_limits", "min_enemy_distance", "within_edge"] as const;

function setUp(input: Params): Params {
  keySet(input, ["subject", "to"], [
    "from", "min_enemy_distance", "within_edge", "round_offset", "placement", "ignore_limits", "via", "marker_inches", "marker_wholly", "allow", "mandatory",
  ], "set-up");
  const { placement, ignore_limits: ignore, via, marker_inches: inches, marker_wholly: wholly, allow, mandatory, ...rest } = input;
  if (allow !== undefined && allow !== false) throw new TypeError("set-up.allow is false or absent.");
  if (mandatory !== undefined && mandatory !== true) throw new TypeError("set-up.mandatory is true or absent.");
  if (allow === false && mandatory === true) throw new TypeError("set-up cannot be both forbidden (allow false) and required (mandatory).");
  if (allow === false) {
    const placing = SETUP_PLACING_KEYS.find((key) => key in input);
    if (placing) throw new TypeError(`set-up.${placing} places a permitted set-up; a forbidden set-up (allow false) names its zone through the placement limit after it.`);
  }
  if (via !== undefined || inches !== undefined || wholly !== undefined) {
    if (via !== "cult-ambush-marker") throw new TypeError("set-up.via is cult-ambush-marker or absent; marker_inches and marker_wholly need it.");
    if (inches === undefined && wholly !== undefined) throw new TypeError("set-up.marker_wholly needs marker_inches.");
    if (inches !== undefined && (!Number.isInteger(inches) || (inches as number) < 1)) throw new TypeError("set-up.marker_inches is a whole number of inches, at least 1.");
    if (wholly !== undefined && wholly !== true) throw new TypeError("set-up.marker_wholly is true or absent.");
  }
  const result: Params = {
    subject: subjectOrSource(rest.subject, MOVE_SUBJECTS, [ANTECEDENT], "set-up.subject"),
    to: enumOrSource(rest.to, SETUP_TO, "set-up.to"),
  };
  if (rest.from !== undefined) result.from = enumOrSource(rest.from, SETUP_FROM, "set-up.from");
  if (rest.min_enemy_distance !== undefined) result.min_enemy_distance = nonNegativeInteger(rest.min_enemy_distance, "set-up.min_enemy_distance");
  if (rest.within_edge !== undefined) result.within_edge = nonNegativeInteger(rest.within_edge, "set-up.within_edge");
  if (rest.round_offset !== undefined) {
    if (typeof rest.round_offset !== "number" || !Number.isSafeInteger(rest.round_offset)) throw new TypeError("set-up.round_offset must be an integer.");
    result.round_offset = rest.round_offset;
  }
  if ("placement" in input) {
    if (placement === "within") {
      if (result.from !== "transport" || result.to !== "battlefield") throw new TypeError("set-up.placement within is the set-up distance of a Transport; it needs from transport and to battlefield.");
      result.placement = "within";
    } else result.placement = enumValue(placement, SETUP_PLACEMENTS, "set-up.placement");
  }
  if ("ignore_limits" in input) {
    if (ignore !== true) throw new TypeError("set-up.ignore_limits is true or absent.");
    result.ignore_limits = true;
  }
  if (via !== undefined) {
    result.via = via;
    if (inches !== undefined) result.marker_inches = inches;
    if (wholly === true) result.marker_wholly = true;
  }
  if (allow === false) result.allow = false;
  if (mandatory === true) result.mandatory = true;
  return result;
}

const MARKER_NEAR_OF = ["this-unit", "this-model", "event-subject"] as const;

function battlefieldMarker(input: Params): Params {
  keySet(input, ["subject", "label"], ["operation", "distance", "not_moved_this_turn", "min_enemy_distance", "near_inches", "near_of", "near_wholly", "size_mm"], "battlefield-marker");
  const { size_mm: size, near_inches: nearInches, near_of: nearOf, near_wholly: nearWholly, min_enemy_distance: away, not_moved_this_turn: unmoved, ...rest } = input;
  const operation = rest.operation ?? "place";
  if (size !== undefined) {
    if (operation !== "place") throw new TypeError("battlefield-marker.size_mm sizes a placed marker.");
    if (!Number.isInteger(size) || (size as number) < 1) throw new TypeError("battlefield-marker.size_mm is a whole number of millimetres, at least 1.");
  }
  const near = nearInches !== undefined || nearOf !== undefined || nearWholly !== undefined;
  if (near) {
    if (operation !== "place") throw new TypeError("battlefield-marker.near_inches limits a place.");
    if (!Number.isInteger(nearInches) || (nearInches as number) < 1) throw new TypeError("battlefield-marker.near_inches is a whole number of inches, at least 1, with near_of.");
    if (!(MARKER_NEAR_OF as readonly unknown[]).includes(nearOf)) throw new TypeError(`battlefield-marker.near_of is one of ${MARKER_NEAR_OF.join(", ")}.`);
    if (nearWholly !== undefined && nearWholly !== true) throw new TypeError("battlefield-marker.near_wholly is true or absent.");
    if (rest.distance !== undefined) throw new TypeError("battlefield-marker: a place with near_inches takes no distance.");
  }
  if (away !== undefined) {
    if (operation !== "place") throw new TypeError("battlefield-marker.min_enemy_distance limits a place.");
    if (!Number.isInteger(away) || (away as number) < 1) throw new TypeError("battlefield-marker.min_enemy_distance is a whole number of inches, at least 1.");
  }
  if (operation === "remove") {
    if (rest.distance !== undefined || unmoved !== undefined) throw new TypeError("battlefield-marker remove takes no distance or not_moved_this_turn.");
  } else if (unmoved !== undefined) {
    if (unmoved !== true) throw new TypeError("battlefield-marker.not_moved_this_turn is true or absent.");
    if (rest.operation !== "relocate") throw new TypeError("battlefield-marker.not_moved_this_turn qualifies a relocate.");
  }
  const label = rest.label;
  if (typeof label !== "string" || label.trim().length === 0) throw new TypeError("battlefield-marker.label must be a nonblank string.");
  const result: Params = { subject: enumOrSource(rest.subject, MOVE_ACTOR_SUBJECTS, "battlefield-marker.subject"), label };
  if (operation === "remove") result.operation = "remove";
  else if (rest.operation !== undefined) result.operation = enumValue(rest.operation, ["place", "relocate"], "battlefield-marker.operation");
  if (rest.distance !== undefined) result.distance = nonNegativeInteger(rest.distance, "battlefield-marker.distance");
  if (unmoved === true) result.not_moved_this_turn = true;
  if (away !== undefined) result.min_enemy_distance = away;
  if (near) {
    result.near_inches = nearInches;
    result.near_of = nearOf;
    if (nearWholly === true) result.near_wholly = true;
  }
  if (size !== undefined) result.size_mm = size;
  return result;
}

function deploymentWindow(input: Params): Params {
  exactKeys(input, ["during"], "deployment-window");
  return { during: enumValue(input.during, ["deployment"], "deployment-window.during") };
}

function countByMarkers(input: Params): Params {
  if (Object.keys(input).join() !== "marker") throw new TypeError("count-by-markers parameters must be exactly: marker.");
  if (typeof input.marker !== "string" || !ENTITY_ID.test(input.marker)) throw new TypeError("count-by-markers.marker is a kebab-case marker label.");
  return { marker: input.marker };
}

function engagementExclusive(input: Params): Params {
  if (Object.keys(input).length > 0) throw new TypeError("engagement-exclusive takes no parameters.");
  return {};
}

export const SET_UP_AND_MARKERS_FAMILIES: readonly FlatFamily[] = [
  {
    id: "battlefield-marker",
    version: 5,
    role: "EFFECT",
    label: "Place or relocate a marker",
    description: "Place a named marker, relocate it up to a distance, or remove it (the marker the record's condition names is removed from the battlefield); operation (place by default) and distance are optional. not_moved_this_turn: a relocate takes only a marker that has not been moved this turn. A placed marker can go more than min_enemy_distance inches horizontally away from all enemy units, and (wholly, with near_wholly) within near_inches of near_of (this-unit, this-model, or event-subject: the moment's unit, \"that unit\"); a place with near_inches takes no distance. size_mm: a placed marker is circular with that diameter in millimetres. A size the rule states in another sentence (\"Use a circular 32mm diameter marker for Cult Ambush markers\") still belongs on the place leaf.",
    starter: {"subject":"this-unit","label":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "subject",
        "label"
      ],
      "properties": {
        "subject": {
          "anyOf": [
            {
              "enum": [
                "this-unit",
                "this-model"
              ]
            },
            {
              "type": "object",
              "required": [
                "source"
              ],
              "properties": {
                "source": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "additionalProperties": false
            }
          ]
        },
        "label": {
          "anyOf": [
            {
              "enum": [
                "cult-ambush-marker",
                "beacon-marker"
              ]
            },
            {
              "type": "string",
              "minLength": 1
            }
          ]
        },
        "operation": {
          "enum": [
            "place",
            "relocate",
            "remove"
          ]
        },
        "distance": {
          "type": "integer",
          "minimum": 0
        },
        "not_moved_this_turn": {
          "const": true,
          "x-optional": true
        },
        "min_enemy_distance": {
          "type": "integer",
          "minimum": 1,
          "x-optional": true
        },
        "near_inches": {
          "type": "integer",
          "minimum": 1,
          "x-optional": true
        },
        "near_of": {
          "enum": [
            "this-unit",
            "this-model",
            "event-subject"
          ],
          "x-optional": true
        },
        "near_wholly": {
          "const": true,
          "x-optional": true
        },
        "size_mm": {
          "type": "integer",
          "minimum": 1,
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: battlefieldMarker,
  },
  {
    id: "set-up",
    version: 6,
    role: "EFFECT",
    label: "Set up",
    description: "Set the target up on the battlefield or into Strategic Reserves; from, min_enemy_distance, within_edge and round_offset are optional. The target can be the unit an earlier leaf introduced (antecedent). placement says where: as close as possible to where it was destroyed or to where it was, wholly within its deployment zone, anywhere, or (within, on a disembark from transport to battlefield) within the set-up distance of the Transport instead of wholly within it. ignore_limits: the set-up ignores the limits on units in or arriving from Strategic Reserves. via cult-ambush-marker sets the unit up using a Cult Ambush marker (touching it, and the marker is removed), or with marker_inches and marker_wholly (wholly) within that many inches of the marker. allow false (\"cannot be set up\") forbids the set-up this leaf names, with any placement limit after it, and takes no placing parameters; mandatory (\"must be set up\") requires it.",
    starter: {"subject":"this-unit","to":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "subject",
        "to"
      ],
      "properties": {
        "subject": {
          "anyOf": [
            {
              "enum": [
                "this-unit",
                "this-model",
                "selected-unit",
                "antecedent"
              ]
            },
            {
              "type": "object",
              "required": [
                "source"
              ],
              "properties": {
                "source": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "additionalProperties": false
            }
          ]
        },
        "to": {
          "anyOf": [
            {
              "enum": [
                "battlefield",
                "strategic-reserves"
              ]
            },
            {
              "type": "object",
              "required": [
                "source"
              ],
              "properties": {
                "source": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "additionalProperties": false
            }
          ]
        },
        "from": {
          "anyOf": [
            {
              "enum": [
                "strategic-reserves",
                "transport",
                "battlefield"
              ]
            },
            {
              "type": "object",
              "required": [
                "source"
              ],
              "properties": {
                "source": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "additionalProperties": false
            }
          ]
        },
        "min_enemy_distance": {
          "type": "integer",
          "minimum": 0
        },
        "within_edge": {
          "type": "integer",
          "minimum": 0
        },
        "round_offset": {
          "type": "integer"
        },
        "placement": {
          "enum": [
            "closest-to-destruction",
            "closest-to-original",
            "deployment-zone",
            "wholly-within",
            "anywhere",
            "within"
          ],
          "x-optional": true
        },
        "ignore_limits": {
          "const": true,
          "x-optional": true
        },
        "via": {
          "enum": [
            "cult-ambush-marker"
          ],
          "x-optional": true
        },
        "marker_inches": {
          "type": "integer",
          "minimum": 1,
          "x-optional": true
        },
        "marker_wholly": {
          "const": true,
          "x-optional": true
        },
        "allow": {
          "const": false,
          "x-optional": true
        },
        "mandatory": {
          "const": true,
          "x-optional": true
        }
      },
      "additionalProperties": false
    },
    normalize: setUp,
  },
  {
    id: "engagement-exclusive",
    version: 1,
    role: "CONDITION",
    label: "Engaged with only",
    description: "Qualifies the engaged state that follows: engaged with the named units and no others (\"only within Engagement Range of one or more FORTIFICATIONS from your army\"). Takes no parameters.",
    starter: {},
    parameterSchema: {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    normalize: engagementExclusive,
  },
  {
    id: "count-by-markers",
    version: 1,
    role: "RESTRICTION",
    label: "How many, one per marker",
    description: "\"For each of your Cult Ambush markers still on the battlefield, you can select one unit\": the most units the selection can take is the number of your markers of this label on the battlefield.",
    starter: {"marker":""},
    parameterSchema: {
      "type": "object",
      "required": [
        "marker"
      ],
      "properties": {
        "marker": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$"
        }
      },
      "additionalProperties": false
    },
    normalize: countByMarkers,
  },
  {
    id: "deployment-window",
    version: 1,
    role: "CONDITION",
    label: "During deployment",
    description: "Gates an effect to the deployment step, before the battle starts (\"during deployment\").",
    starter: {"during":"deployment"},
    parameterSchema: {
      "type": "object",
      "required": [
        "during"
      ],
      "properties": {
        "during": {
          "enum": [
            "deployment"
          ]
        }
      },
      "additionalProperties": false
    },
    normalize: deploymentWindow,
  },
];
