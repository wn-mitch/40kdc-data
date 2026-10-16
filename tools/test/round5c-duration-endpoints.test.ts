import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compileLeaves, type CompileLeaf } from "../src/round5c/compile.js";
import { currentFamilyVersion, familyRole, normalizeFingerprintParameters as normalizeAt } from "../src/round5c/contracts.js";
import { expiryTrail } from "../src/translate/expiry.js";

/** Leaves on their own wording in `text`, in order (fabricated wording, not rules text). */
function placed(text: string, ...items: Array<[string, string, Record<string, unknown>]>): CompileLeaf[] {
  const bytes = Buffer.from(text, "utf8");
  let from = 0;
  return items.map(([wording, family, parameters]) => {
    const start = bytes.indexOf(Buffer.from(wording, "utf8"), from);
    if (start < 0) throw new Error(`"${wording}" is not in the text`);
    from = start + Buffer.byteLength(wording, "utf8");
    const version = currentFamilyVersion(family);
    return { role: familyRole(family, version), family_id: family, family_version: version, parameters, start_byte: start, end_byte: from, fragment: "RAW_TEXT" };
  });
}

function resultOf(list: CompileLeaf[], text: string) {
  return compileLeaves(list, text);
}

function mechanicsOf(list: CompileLeaf[], text: string): Record<string, any> {
  const result = resultOf(list, text);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.mechanics as unknown as Record<string, any>;
}

/** A parameter set checked against the duration family's current version. */
const checkDuration = (parameters: Record<string, unknown>) => normalizeAt("duration", parameters, currentFamilyVersion("duration"));

const V3_ENDPOINTS = [
  "end-of-phase", "end-of-turn", "end-of-battle-round", "end-of-battle",
  "start-of-next-turn", "start-of-next-command-phase", "start-of-next-movement-phase", "start-of-next-battle-round",
  "end-of-attack-sequence", "end-of-this-use", "start-of-next-shooting-phase", "end-of-your-next-turn",
  "end-of-opponents-next-turn", "this-unit-has-shot", "control-lost",
];

/** One designation with no applier and one printed duration (fabricated wording). */
const DEFAULT_WORDING = "until the end of the phase";
const designationText = (wording: string) => `That unit is wracked with agonies ${wording}.`;
function withDuration(parameters: Record<string, unknown>, wording = DEFAULT_WORDING): { text: string; leaves: CompileLeaf[] } {
  const text = designationText(wording);
  return {
    text,
    leaves: placed(text,
      ["That unit is wracked with agonies", "apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }],
      [wording, "duration", parameters],
    ),
  };
}
const compileWithDuration = (parameters: Record<string, unknown>, wording = DEFAULT_WORDING) => {
  const { text, leaves } = withDuration(parameters, wording);
  return mechanicsOf(leaves, text);
};

describe("duration@4 phase-edge endpoints: parameters", () => {
  it("accepts an end edge for each official phase and each owner", () => {
    for (const phase of ["command", "movement", "shooting", "charge", "fight"]) {
      for (const turn of ["your", "opponent"]) {
        expect(checkDuration({ endpoint: "end-of-next-phase", phase, turn })).toEqual({ endpoint: "end-of-next-phase", phase, turn });
      }
    }
  });

  it("refuses an end edge with a missing phase, the event value any, a missing owner, or either", () => {
    expect(() => checkDuration({ endpoint: "end-of-next-phase", turn: "your" })).toThrow(/names a phase/u);
    expect(() => checkDuration({ endpoint: "end-of-next-phase", phase: "any", turn: "your" })).toThrow(/duration.phase/u);
    expect(() => checkDuration({ endpoint: "end-of-next-phase", phase: "fight" })).toThrow(/names whose phase/u);
    expect(() => checkDuration({ endpoint: "end-of-next-phase", phase: "fight", turn: "either" })).toThrow(/duration.turn/u);
  });

  it("refuses phase and turn on every endpoint that does not take them", () => {
    expect(() => checkDuration({ endpoint: "end-of-phase", phase: "fight" })).toThrow(/phase-edge endpoints only/u);
    expect(() => checkDuration({ endpoint: "end-of-turn", turn: "your" })).toThrow(/phase-edge endpoints only/u);
  });

  it("accepts start-of-next-phase only as the opponent's next Command phase", () => {
    expect(checkDuration({ endpoint: "start-of-next-phase", phase: "command", turn: "opponent" })).toEqual({ endpoint: "start-of-next-phase", phase: "command", turn: "opponent" });
    expect(() => checkDuration({ endpoint: "start-of-next-phase", phase: "movement", turn: "opponent" })).toThrow(/not phase-edge endpoints/u);
    expect(() => checkDuration({ endpoint: "start-of-next-phase", phase: "fight", turn: "opponent" })).toThrow(/not phase-edge endpoints/u);
  });

  it("names the v3 endpoint when start-of-next-phase is asked for the player's own turn", () => {
    expect(() => checkDuration({ endpoint: "start-of-next-phase", phase: "command", turn: "your" })).toThrow(/start-of-next-command-phase/u);
    expect(() => checkDuration({ endpoint: "start-of-next-phase", phase: "movement", turn: "your" })).toThrow(/start-of-next-movement-phase/u);
    expect(() => checkDuration({ endpoint: "start-of-next-phase", phase: "shooting", turn: "your" })).toThrow(/start-of-next-shooting-phase/u);
    expect(() => checkDuration({ endpoint: "start-of-next-phase", phase: "fight", turn: "your" })).toThrow(/other starts are not phase-edge endpoints/u);
  });

  it("keeps every v3 endpoint's parameters unchanged under version 4", () => {
    for (const endpoint of V3_ENDPOINTS) {
      expect(checkDuration({ endpoint })).toEqual(normalizeAt("duration", { endpoint }, 3));
    }
  });
});

describe("duration@4 phase-edge endpoints: scope.duration", () => {
  const rows: Array<[Record<string, string>, string]> = [
    [{ endpoint: "end-of-next-phase", phase: "fight", turn: "your" }, "until-end-of-your-next-fight-phase"],
    [{ endpoint: "end-of-next-phase", phase: "shooting", turn: "your" }, "until-end-of-your-next-shooting-phase"],
    [{ endpoint: "end-of-next-phase", phase: "movement", turn: "your" }, "until-end-of-your-next-movement-phase"],
    [{ endpoint: "end-of-next-phase", phase: "movement", turn: "opponent" }, "until-end-of-opponent-next-movement-phase"],
    [{ endpoint: "start-of-next-phase", phase: "command", turn: "opponent" }, "until-start-of-opponent-next-command-phase"],
  ];

  for (const [parameters, scope] of rows) {
    it(`compiles ${parameters.endpoint} ${parameters.phase} ${parameters.turn} to ${scope}`, () => {
      expect(compileWithDuration(parameters).scope).toEqual({ duration: scope });
    });
  }

  it("refuses the phase-edge combinations with no DSL value, naming the combination", () => {
    const refused: Array<Record<string, string>> = [
      { endpoint: "end-of-next-phase", phase: "command", turn: "your" },
      { endpoint: "end-of-next-phase", phase: "command", turn: "opponent" },
      { endpoint: "end-of-next-phase", phase: "charge", turn: "your" },
      { endpoint: "end-of-next-phase", phase: "charge", turn: "opponent" },
      { endpoint: "end-of-next-phase", phase: "fight", turn: "opponent" },
      { endpoint: "end-of-next-phase", phase: "shooting", turn: "opponent" },
    ];
    for (const parameters of refused) {
      const { text, leaves } = withDuration(parameters);
      const result = resultOf(leaves, text);
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toContain(`Duration ${parameters.endpoint} ${parameters.phase} ${parameters.turn} has no DSL scope yet.`);
    }
  });

  it("keeps a start edge and an end edge of the same phase apart", () => {
    expect(compileWithDuration({ endpoint: "start-of-next-command-phase" }).scope).toEqual({ duration: "until-next-command-phase" });
    expect(compileWithDuration({ endpoint: "end-of-next-phase", phase: "fight", turn: "your" }).scope).toEqual({ duration: "until-end-of-your-next-fight-phase" });
  });

  it("refuses a record that prints two different phase-edge durations", () => {
    const text = "That unit is wracked with agonies until the end of your next Fight phase. Until the end of your next Shooting phase, it is also Battle-shocked.";
    const result = resultOf(placed(text,
      ["That unit is wracked with agonies", "apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }],
      ["until the end of your next Fight phase", "duration", { endpoint: "end-of-next-phase", phase: "fight", turn: "your" }],
      ["Until the end of your next Shooting phase", "duration", { endpoint: "end-of-next-phase", phase: "shooting", turn: "your" }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Conflicting durations.");
  });

  it("compiles the opponent's Command-phase start edge on a record whose effect starts at that edge", () => {
    const text = "At the start of your opponent's turn, that unit is wracked with agonies until the start of your opponent's next Command phase.";
    const mechanics = mechanicsOf(placed(text,
      ["At the start of your opponent's turn", "turn-start", { turn: "opponent-turn" }],
      ["that unit is wracked with agonies", "apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }],
      ["until the start of your opponent's next Command phase", "duration", { endpoint: "start-of-next-phase", phase: "command", turn: "opponent" }],
    ), text);
    expect(mechanics.scope).toEqual({ duration: "until-start-of-opponent-next-command-phase" });
  });

  // The effect starts inside the named phase (the Command phase starts, the effect applies, and the
  // duration names the next start of that phase). The compiler maps the leaf to the start-edge
  // value only; it cannot evaluate which phase is in progress when the effect applies. That rule is
  // the scope-duration description, which the consumers of the DSL apply. A regression that maps this
  // record to an end edge, or to the v3 next-phase value, fails here.
  it("does not map a start edge inside the named phase to an end edge or to the v3 next-phase value", () => {
    const text = "At the start of your opponent's Command phase, that unit is wracked with agonies until the start of your opponent's next Command phase.";
    const mechanics = mechanicsOf(placed(text,
      ["At the start of your opponent's Command phase", "event", { kind: "phase-start", phase: "command", turn: "opponent" }],
      ["that unit is wracked with agonies", "apply-mark", { subject: "this-unit", tag: "wracked-with-agonies" }],
      ["until the start of your opponent's next Command phase", "duration", { endpoint: "start-of-next-phase", phase: "command", turn: "opponent" }],
    ), text);
    expect(mechanics.scope).toEqual({ duration: "until-start-of-opponent-next-command-phase" });
  });

  it("maps the v3 attack-sequence endpoint to attack-sequence", () => {
    expect(compileWithDuration({ endpoint: "end-of-attack-sequence" }, "until the attacking unit has resolved all of its attacks").scope).toEqual({ duration: "attack-sequence" });
  });

  // Fabricated wording with the shape of record 2546: an attack-sequence duration and a trailing
  // attacks-resolved moment with no effect after it. The two errors are the gaps the design names
  // for that record; the duration is not one of them. A later fix that changes these messages fails
  // here, and the record's status must be re-checked then.
  it("keeps the two named gap errors for an attack-sequence duration with a trailing moment", () => {
    const text = "Each time this unit shoots, that unit is wracked with agonies until the attacking unit has resolved all of its attacks. When the attacking unit has resolved all of its attacks, it is battle-shocked.";
    const result = resultOf(placed(text,
      ["Each time this unit shoots", "event", { kind: "targets-selected", action_kind: "shoot" }],
      ["that unit is wracked with agonies", "apply-mark", { subject: "selected-unit", tag: "wracked-with-agonies" }],
      ["until the attacking unit has resolved all of its attacks", "duration", { endpoint: "end-of-attack-sequence" }],
      ["When the attacking unit has resolved all of its attacks", "event", { kind: "attacks-resolved" }],
    ), text);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("A moment ends the ability with no effect after it.");
    expect(result.errors).toContain("An effect names \"that unit\", but no select-unit leaf says which unit.");
  });
});

describe("designation expiry with a phase-edge duration", () => {
  const TEXT = "This unit applies the mark until the end of your opponent's next Movement phase.";
  const applier = (by: boolean): Array<[string, string, Record<string, unknown>]> => [
    ["This unit applies the mark", "apply-mark", by ? { subject: "this-unit", tag: "bondsman-affected", by: "this-unit" } : { subject: "this-unit", tag: "bondsman-affected" }],
    ["until the end of your opponent's next Movement phase", "duration", { endpoint: "end-of-next-phase", phase: "movement", turn: "opponent" }],
  ];

  it("sets the designation's clears_on to the phase-edge DSL value when the applier is named", () => {
    const modifier = mechanicsOf(placed(TEXT, ...applier(true)), TEXT).effect.modifier;
    expect(modifier).toEqual({ tag: "bondsman-affected", by: "this-unit", clears_on: "until-end-of-opponent-next-movement-phase" });
  });

  it("leaves clears_on off a designation with no applier", () => {
    const modifier = mechanicsOf(placed(TEXT, ...applier(false)), TEXT).effect.modifier;
    expect(modifier).toEqual({ tag: "bondsman-affected" });
  });

  it("refuses an applier when the record prints no duration", () => {
    const text = "This unit applies the mark.";
    expect(() => mechanicsOf(placed(text, ["This unit applies the mark", "apply-mark", { subject: "this-unit", tag: "bondsman-affected", by: "this-unit" }]), text))
      .toThrow(/needs its duration printed/u);
  });
});

describe("expiry describer for the phase-edge values", () => {
  it("renders each new value as its English trailer", () => {
    expect(expiryTrail("until-end-of-your-next-fight-phase")).toBe("until the end of your next Fight phase");
    expect(expiryTrail("until-end-of-your-next-shooting-phase")).toBe("until the end of your next Shooting phase");
    expect(expiryTrail("until-end-of-your-next-movement-phase")).toBe("until the end of your next Movement phase");
    expect(expiryTrail("until-end-of-opponent-next-movement-phase")).toBe("until the end of your opponent's next Movement phase");
    expect(expiryTrail("until-start-of-opponent-next-command-phase")).toBe("until the start of your opponent's next Command phase");
  });
});

describe("scope-duration schema", () => {
  it("accepts every phase-edge duration emitted by the compiler", () => {
    const schema = JSON.parse(readFileSync(new URL("../../schemas/enrichment/ability-dsl/scope.schema.json", import.meta.url), "utf8"));
    const duration = schema.$defs["scope-duration"];
    expect(duration.enum).toEqual(expect.arrayContaining([
      "until-end-of-your-next-fight-phase",
      "until-end-of-your-next-shooting-phase",
      "until-end-of-your-next-movement-phase",
      "until-end-of-opponent-next-movement-phase",
      "until-start-of-opponent-next-command-phase",
    ]));
  });
});
