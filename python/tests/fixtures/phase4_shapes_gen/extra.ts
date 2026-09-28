// ---- extra parity cases (port coverage beyond the TS test) ----
{
  const R = (e: unknown, x: Record<string, unknown> = {}) => render(e, x);
  const L = leaf;
  const not = (c: unknown) => ({ operator: "not", operands: [c] });
  const C = (c: unknown) => describeCondition(c as never);
  const conds = [
    { type: "within", parameters: { of: { owner: "friendly", has_ability: ["deep-strike", "infiltrators"], member_of: "this-unit" }, range: { inches: 6 } } },
    { type: "within", parameters: { of: { owner: "enemy", engaged_with: { owner: "friendly", all_of: ["INFANTRY"] }, not_engaged_with: { owner: "friendly" } }, range: { inches: 6 } } },
    { type: "within", parameters: { of: { owner: "enemy", designated: "spotted", designated_by: "this-unit", not_designated: "afflicted", embarked_in: "bearer-transport" }, range: { inches: 9 } } },
    { type: "within", parameters: { of: { owner: "enemy", within: { range: { inches: 6 }, of: "this-unit", wholly: true } }, range: { inches: 12 } } },
    { type: "within", parameters: { of: { stratagem_target: "war-dogs" }, range: { inches: 6 } } },
    { type: "within", parameters: { subject: "this-unit", of: { objective: { selection_var: "o" } }, range: "objective-control" } },
    { type: "within", parameters: { of: "battlefield-centre", range: { inches: 9 }, wholly: true } },
    { type: "within", parameters: { of: { marker: "teleport-homer" }, range: { inches: 3 } } },
    { type: "within", parameters: { of: "ability-unit", range: { inches: 3 } } },
    { type: "happened", parameters: { event: "after-roll", filter: { roll: { of_ability: "reanimation-protocols" }, result: "success" }, window: "phase" } },
    { type: "happened", parameters: { event: "after-roll", subject: "ability-unit", object: "this-unit", filter: { roll: "hit", result: "success" }, window: "turn" } },
    { type: "happened", parameters: { event: "after-roll", subject: "bearer-transport", filter: { roll: "hit", result: "success" }, window: "phase" } },
    { type: "happened", parameters: { event: "used", filter: { kind: "stratagem", same_rule_as: { event_var: "b" } }, window: "phase" } },
    { type: "happened", parameters: { event: "used", filter: { kind: "ability", ability_keyword: "BONDSMAN" }, window: "turn" } },
    { type: "roll-result", parameters: { roll: { of_ability: "reanimation-protocols" }, result: "success" } },
    { type: "roll-result", parameters: { roll: "manoeuvre", result: 6 } },
    { type: "battle-size", parameters: { size: "strike-force" } },
    { type: "army-faction", parameters: { faction: "adeptus-custodes" } },
    { type: "moved-over", parameters: { by: "this-unit", subject: "event-subject", window: "turn" } },
    { type: "moved-over", parameters: { by: "this-model", window: "event" } },
    { type: "guided", parameters: { subject: "this-unit" } },
    { type: "designated", parameters: { tag: "observer" } },
    { type: "designated", parameters: { tag: "riled-up", by: "this-unit" } },
    { type: "designated", parameters: { tag: "MARKED FOR DEATH" } },
    { type: "designated", parameters: { tag: "empowered", by: { selection_var: "spotter" } } },
  ];
  for (const c of conds) { C(c); C(not(c)); }
  for (const t of [
    { event: "before-roll", subject: "this-unit", filter: { roll: { of_ability: "reanimation-protocols" } } },
    { event: "after-roll", subject: "this-unit", filter: { roll: "manoeuvre" } },
    { event: "after-roll", subject: "this-unit", filter: { roll: "channelling", result: "success" } },
    { event: "used", subject: "this-unit", filter: { kind: "stratagem", same_rule_as: { event_var: "x" } } },
    { event: "used", subject: { owner: "enemy" }, filter: { kind: "ability", ability_keyword: "PSYCHIC" } },
  ]) describeTrigger(t as never);

  const effects: unknown[] = [
    { type: "conditional", condition: { type: "guided", parameters: {} }, effect: { type: "roll", dice: "D6", roll_var: "r", kind: "psychic", effect: L("mortal-wounds", { count: { roll_var: "r", successes_on: 4 } }, "selected-unit") } },
    { type: "roll", dice: "3D6", roll_var: "r", effect: L("heal", { amount: { roll_var: "r" } }) },
    { type: "roll", dice: "D6+1", roll_var: "r", kind: "battle-shock", effect: { type: "dice-gated", from: { roll_var: "r" }, threshold: 4, on_success: L("cp-gain", { amount: 1 }), on_fail: L("mortal-wounds", { count: 1 }) } },
    { type: "roll", dice: "2D6", roll_var: "r", effect: { type: "dice-gated", from: { roll_var: "r", successes_on: 5 }, threshold: 2, comparison: "gte", on_success: { type: "no-effect" } } },
    { type: "sequence", steps: [{ type: "roll", dice: "D3", roll_var: "q", effect: L("mortal-wounds", { count: { roll_var: "q" } }, "selected-unit") }, L("heal", { amount: 1 })] },
    { type: "select-objective", selector: { count: "each", range_inches: 6, origin: "bearer", controlled_by: "opponent", bind_as: "o", selection_limit: { count: 1, period: "turn" } }, effect: L("objective-sticky", {}) },
    { type: "select-objective", selector: { count: 2, range: { inches: 12 }, bind_as: "o", filter: { in_no_mans_land: true }, requires_unit: { owner: "enemy", requires_ability: "infiltrators" }, selection_limit: { count: 2, period: "battle-round" } }, effect: { type: "sequence", steps: [L("designate", { subject: { objective: { selection_var: "o" } }, tag: "secured" }), L("cp-gain", { amount: 1 })] } },
    { type: "conditional", condition: { type: "battle-size", parameters: { size: "onslaught" } }, effect: { type: "select-objective", selector: { count: 1, bind_as: "o" }, effect: L("designate", { subject: { objective: { selection_var: "o" } }, tag: "held", clears_on: "turn-rollover" }) } },
    L("mortal-wounds", { count: { incursion: 1, "strike-force": 2, onslaught: 3 } }, "selected-unit"),
    L("mortal-wounds", { count: { count_of: "enemy-models-in-range", within_inches: 6 }, roll: { dice: "D6", threshold: 4 } }, "selected-unit"),
    L("heal", { amount: { incursion: 1, "strike-force": 2, onslaught: 3 }, per: "model" }),
    L("add-unit", { datasheet: "blue-horrors", join: "this-unit", model_count: 2 }),
    L("add-unit", { datasheet: "spore-mines", model_count: { count_of: "models-in-bearer-unit" }, near: [{ of: "this-model", range: { inches: 48 }, wholly: true }], away_from: [{ of: { owner: "enemy" }, range: { inches: 8 } }] }),
    L("add-unit", { datasheet: "poxwalkers", count: 2, allow_engagement_with: "event-subject", placement: ["within", "unengaged"], range: { inches: 6 } }),
    L("add-unit", { copy_of: "this-unit", count: { count_of: "battle-round" } }),
    L("add-unit", { copy_of: "this-unit", count: 3 }),
    L("add-unit", { datasheet: "cultists", count: { incursion: 1, "strike-force": 2, onslaught: 3 }, in_region: { region: { deployment_zone: "yours" } } }),
    L("move", { move_type: "normal", distance: 6, mode: "desperate-escape", counts_as_move: "advance" }),
    L("move", { move_type: "normal", distance: "D6", ends_within: { range: { inches: 3 }, of: { marker: "teleport-homer-marker" } } }),
    L("move", { move_type: "normal", ends_within: { range: { inches: 3 }, of: { objective: { selection_var: "o" } } } }),
    L("move", { move_type: "normal", ends_within: { range: { inches: 9 }, of: "battlefield-edge" } }),
    L("move", { move_type: "normal", ends_within: { range: { inches: 9 }, of: { objective: {} } } }),
    L("move", { move_type: "normal", passthrough: [{ kind: "models", owner: "enemy", all_of: ["INFANTRY", "SWARM"] }, { kind: "terrain", height: "over-4" }, { kind: "terrain" }, "enemy-models"] }),
    L("set-up", { to: "battlefield", from: "transport", mode: "emergency" }),
    L("set-up", { to: "battlefield", from: "strategic-reserves", counts_as_move: "remain-stationary", allow_engagement: true, placement: ["anywhere", "on-terrain"], near: [{ of: { objective: {} }, range: { inches: 3 } }] }),
    L("set-up", { to: "battlefield", from: "battlefield", placement: "closest-to-original", away_from: [{ of: "this-model", range: { inches: 9 } }, { of: "battlefield-edge", range: { inches: 6 } }] }),
    L("resource-die", { pool: "fate-dice-pool", op: "add", count: { incursion: 3, "strike-force": 6, onslaught: 9 }, value: "rolled" }),
    L("resource-die", { pool: "fate-dice-pool", op: "add", count: { count_of: "battle-round" }, value: 6 }),
    L("resource-gain", { pool: "cp", amount: { count_of: "models-in-bearer-unit" } }),
    L("resource-spend", { pool: "miracle-dice-pool", amount: 2, requirement: { any_of: [{ type: "pair", min_value: 3 }, { type: "triple", min_value: 1 }] } }),
    L("resource-spend", { pool: "fate-dice-pool", amount: 2, face: 6 }),
    L("designate", { subject: "selected-unit", tag: "spotted", by: { selection_var: "observer" }, clears_on: "battle" }),
    L("designate", { subject: "selected-unit", tag: "observer", clears_on: "turn" }),
    L("designate", { subject: "selected-unit", tag: "RILED UP", clears_on: "phase-end" }),
    L("designate", { subject: { owner: "enemy", within: { range: { inches: 6 } } }, tag: "empowered", clears_on: "until-this-unit-has-shot" }),
    L("army-rule", { rule: "single-chapter" }),
    L("army-rule", { rule: "detachment-tag-exclusive", tag: "flyblown" }),
    L("army-rule", { rule: "composition", with: { any_of: ["HARLEQUINS", "ANHRATHE"] }, max: { incursion: 250, "strike-force": 500, onslaught: 750 }, measure: "points" }),
    L("army-rule", { rule: "composition", with: { all_of: ["SERVITORS"] }, max: 3, measure: "models" }),
    L("army-rule", { rule: "composition", with: { all_of: ["ASSASSIN"] }, max: 1 }),
    L("army-rule", { rule: "composition", with: { all_of: ["ASSASSIN"] }, exempt_from: ["rule-of-three"] }),
    L("re-roll", { roll: "hit", subset: "all-failures", count: { count_of: "models-equipped-with", wargear: "cluster-caltrops" } }),
    L("re-roll", { roll: "wound", subset: "ones", count: { count_of: "models-in-bearer-unit" }, mandatory: true, incoming: true }),
    L("re-roll", { roll: { of_ability: "reanimation-protocols" }, subset: "all" }),
    L("roll-result", { roll: "hit", fails_on: 1 }, "this-model"),
    L("roll-result", { roll: "wound", fails_on: 2, weapon_type: "melee" }, { owner: "enemy", within: { range: { inches: 6 } } }),
    L("roll-result", { roll: "channelling", result: "pass" }),
    L("ability-modifier", { ability: "overkill", aspect: "uses", operation: "add", value: 1, cap_per: { count: 2, period: "turn" }, consumes_shared_use: false }),
    L("ability-activate", { ability: "blessings-of-khorne", select: { by: "player" }, ignore_consumed: true }, "this-model"),
    L("ability-activate", { ability: "blessings-of-khorne", option: "warp-blades", exclusive: true, ignore_consumed: true }),
    L("permission", { activity: "shoot", allow: true, after: ["fall-back"], counts_as_move: "remain-stationary", consumes_shared_use: false }, { owner: "friendly", all_of: ["INFANTRY"] }),
    L("targeting", { may: "redirect", target: { owner: "friendly", all_of: ["CHARACTER"] }, to: "this-model", kind: "stratagem" }, "attacker"),
    L("targeting", { by: { owner: "enemy" }, may: "redirect", target: "selected-unit", to: "this-unit", kind: "shoot" }, "attacker"),
    L("targeting", { by: { owner: "enemy" }, may: "redirect", target: { owner: "friendly", all_of: ["INFANTRY"], within: { range: { inches: 6 } } }, to: "this-unit", kind: "fight", if_eligible: true }, "attacker"),
    L("rule-state", { direction: "granted", rule_kind: "core-rule", rule: "charge-bonus" }, { owner: "friendly", all_of: ["INFANTRY"] }),
    L("rule-state", { direction: "suppressed", rule_kind: "core-rule", rule: "charge-bonus" }, { owner: "friendly", all_of: ["INFANTRY"] }),
    L("rule-state", { direction: "suppressed", rule_kind: "core-rule", rule: "hidden" }, "this-unit"),
    L("rule-state", { direction: "granted", rule_kind: "core-rule", rule: "hidden" }, "this-unit"),
    L("rule-state", { direction: "granted", rule_kind: "core-rule", rule: "orders-end-on-battle-shock" }, { owner: "friendly" }),
    L("rule-state", { direction: "granted", rule_kind: "core-rule", rule: "engaged-shooting-hit-penalty" }, { owner: "enemy" }),
    L("stat-modifier", { stat: "A", operation: "add", value: 1 }, "this-unit", { scaling: { per: 5, of: "models-equipped-with", wargear: "power-klaw" } }),
    L("stat-modifier", { stat: "A", operation: "add", value: 1 }, "this-unit", { scaling: { per: 1, of: "battle-round", max_value: 3 } }),
    L("stat-modifier", { stat: "OC", operation: "add", value: 1 }, "this-unit", { scaling: { per: 2, of: "embarked-models-oc", max_value: 5 } }),
    L("stat-modifier", { stat: "OC", operation: "add", value: 1 }, "this-unit", { scaling: { per: 10, of: "enemy-models-in-range", within_inches: 6, keyword: "INFANTRY", round: "up" } }),
    L("stat-modifier", { stat: "A", operation: "add", value: { incursion: 1, "strike-force": 2, onslaught: 3 } }),
    L("stat-modifier", { stat: "psyker-level", operation: "set", value: 2 }, "this-model"),
    L("select-weapon", { count: 2, weapon_type: "ranged", weapon_keyword: "heavy", bind_as: "w" }, "this-model"),
    L("select-weapon", { bind_as: "w" }),
    L("roll-modifier", { roll: "wound", operation: "add", value: 1, weapon_ref: { weapon_var: "w" } }, "this-model"),
    L("weapon-ability-grant", { abilities: ["Lethal Hits"], weapon_ref: { weapon_var: "w" }, weapon_type: "melee" }, "this-model"),
    L("characteristic-resolution", { stat: "Sv", rule: "highest", applies_to: "all" }),
    L("characteristic-resolution", { stat: "T", rule: "lowest", applies_to: "wound-roll" }, { owner: "friendly", all_of: ["INFANTRY"] }),
    L("characteristic-resolution", { stat: "T", rule: "majority", tie: "lowest", applies_to: "all" }, "this-model"),
    L("borrow-weapons", { max_models: { incursion: 1, "strike-force": 2, onslaught: 3 } }, "this-model"),
    L("borrow-weapons", { from: { owner: "friendly", all_of: ["INFANTRY"], embarked_in: "this-model" }, max_models: 10, exclude_weapon_keyword: ["ONE SHOT", "HAZARDOUS"], until: "phase" }),
    L("test-exemption", { test: "desperate-escape", window: "battle-round" }, { owner: "friendly" }),
    L("datasheet-swap", { datasheet: "brimstone-horrors" }, { owner: "friendly", all_of: ["PINK HORRORS"] }),
    { type: "aura", target: "friendly-within-aura", modifier: { range_bonus: 3, range_cap: 12, of: "contagion" } },
    { type: "aura", target: "friendly-within-aura", modifier: { range: 6, range_cap: 9, effect: L("feel-no-pain", { threshold: 5 }, "recipient") } },
    { type: "select-units", selector: { owner: "enemy", max_count: { count_of: "models-in-bearer-unit", keyword: "OBSERVER" }, range_inches: 18, wholly: true, reference: "this-unit" }, effect: L("designate", { subject: "selected-unit", tag: "spotted" }, "selected-unit") },
    { type: "select-units", selector: { owner: "friendly", count: 2, within_inches: 12, wholly: true }, effect: L("designate", { subject: "selected-unit", tag: "observer" }, "selected-unit") },
    { type: "select-units", selector: { owner: "enemy", count: 1 }, effect: L("targeting", { by: { owner: "friendly", designated: "observer" }, may: "target", target: "selected-unit" }, { owner: "friendly", designated: "observer" }) },
    L("feel-no-pain", { threshold: 5 }, { owner: "friendly", has_ability: ["deep-strike"], lacks_ability: ["lone-operative", "stealth"], member_of: { selection_var: "army_unit" } }),
    L("feel-no-pain", { threshold: 5 }, { owner: "friendly", engaged_with: { owner: "enemy", all_of: ["MONSTER"] } }),
    L("feel-no-pain", { threshold: 5 }, { owner: "friendly", engaged_with: { owner: "friendly", excluding: "this-model" } }),
    L("feel-no-pain", { threshold: 5 }, { owner: "enemy", designated: "spotted", designated_by: { selection_var: "observer" } }),
    L("feel-no-pain", { threshold: 5 }, { owner: "enemy", not_designated: "observer" }),
    L("feel-no-pain", { threshold: 5 }, { owner: "enemy", designated: "observer" }),
    L("feel-no-pain", { threshold: 5 }, "ability-unit"),
    L("return-models", { count: "all", bodyguard_only: true, exclude_model_keyword: ["SUPPORT WEAPON", "CHARACTER"], near: [{ of: "this-model", range: { inches: 6 } }] }),
    L("return-models", { count: "D3+1", bodyguard_only: true, exclude_model_keyword: ["SUPPORT WEAPON"] }),
    L("return-models", { count: 1, placement: "wholly-within", range: { inches: 3 } }),
    L("return-models", { count: 1, wounds_remaining: { roll_var: "r" }, detach: true }, "this-model"),
    L("counts-as", { within: "aura", of: { stratagem_target: "the-lure" } }, "this-unit"),
  ];
  for (const e of effects) R(e);
  for (const d of ["until-next-shooting-phase", "until-end-of-your-next-turn", "until-end-of-opponent-next-turn", "until-this-unit-has-shot", "control-lost", "one-use", "battle", "permanent"]) R(L("stat-modifier", { stat: "Ld", operation: "add", value: 1 }), { scope: { duration: d } });
  R(L("mortal-wounds", { count: 1 }, "event-subject"), { usage: [{ frequency: "once-per-turn" }, { frequency: "n-per-battle", count: 2 }], scope: { duration: "one-use" } });

  const cr = (e: unknown, c: Record<string, unknown> = ctx) => effectToBuffs(e, source, c as never);
  cr(L("re-roll", { roll: { of_ability: "reanimation-protocols" }, subset: "all" }));
  cr(L("roll-modifier", { roll: "hit", operation: "add", value: 1 }, "ability-unit"));
  cr({ type: "roll", dice: "D6", roll_var: "r", effect: L("roll-modifier", { roll: "hit", operation: "add", value: 1 }) });
  cr({ type: "roll", dice: "8D6", roll_var: "r", effect: { type: "choice", options: [{ type: "dice-gated", from: { roll_var: "r" }, requirement: { type: "pair", min_value: 4 }, on_success: L("roll-modifier", { roll: "hit", operation: "add", value: 1 }) }, { type: "dice-gated", from: { roll_var: "r" }, requirement: { type: "pair", min_value: 6 }, on_success: { type: "no-effect" } }] } });
  cr({ type: "roll", dice: "8D6", roll_var: "r", effect: { type: "choice", options: [{ type: "dice-gated", from: { roll_var: "other" }, requirement: { type: "pair", min_value: 4 }, on_success: L("roll-modifier", { roll: "hit", operation: "add", value: 1 }) }] } });
  cr(L("stat-modifier", { stat: "A", operation: "add", value: 1, count: { count_of: "battle-round" } }));
  cr(L("mortal-wounds", { count: { roll_var: "r" } }));
  cr(L("weapon-ability-grant", { abilities: ["Lethal Hits"], weapon_ref: { selected_by: { ability: "firing-deck" } } }));
  cr(L("select-weapon", { bind_as: "w" }));
  cr({ type: "conditional", condition: { type: "guided", parameters: { subject: "event-subject" } }, effect: L("roll-modifier", { roll: "hit", operation: "add", value: 1 }) }, { ...ctx, attackerGuided: true });
  cr({ type: "conditional", condition: { type: "army-faction", parameters: {} }, effect: L("roll-modifier", { roll: "hit", operation: "add", value: 1 }) }, { ...ctx, armyFaction: "x" });
  cr({ type: "conditional", condition: { type: "battle-size", parameters: { size: "onslaught" } }, effect: L("roll-modifier", { roll: "hit", operation: "add", value: 1 }) });
  usageGated("unit", [{ frequency: "once-per-turn" }], L("cp-gain", { amount: 1 }));
  usageGated("stratagem", [{ frequency: "once-per-turn" }, { frequency: "once-per-battle" }], L("cp-gain", { amount: 1 }));
  usageGated("unit", [], L("cp-gain", { amount: 1 }));
}
// ---- rated rules ({rating: true}) and faction-suffixed ids (mirror follow-up) ----
{
  const L = leaf;
  const fnp = L("feel-no-pain", { threshold: { rating: true } });
  for (const e of [
    fnp,
    L("feel-no-pain", { threshold: { rating: true }, against: "mortal" }, { owner: "friendly", all_of: ["INFANTRY"] }),
    L("ability-grant", { ability: "scouts", value: { rating: true } }),
    L("ability-grant", { ability: "firing-deck", value: { rating: true } }, "this-model"),
    L("mortal-wounds", { count: { rating: true } }, { owner: "enemy", within: { range: { inches: 6 } } }),
    L("rule-state", { direction: "granted", rule_kind: "faction-rule", rule: "blessings-of-khorne-world-eaters" }),
    L("rule-state", { direction: "suppressed", rule_kind: "ability", rule: "oath-of-moment-adeptus-astartes" }),
    L("rule-state", { direction: "suppressed", rule_kind: "keyword", rule: "oath-of-moment-adeptus-astartes" }),
    L("cost-modifier", { of: "stratagem", id: "armour-of-contempt-adeptus-astartes", operation: "decrease", amount: 1 }),
    L("permission", { activity: "use-stratagem", stratagem: "fire-overwatch", allow: false }),
    L("targeting", { by: { owner: "enemy" }, may: "cannot-target", target: "this-unit", kind: "stratagem", stratagem: "heroic-intervention-world-eaters" }),
    L("roll-modifier", { roll: { of_ability: "reanimation-protocols-necrons" }, operation: "add", value: 1 }),
    L("feel-no-pain", { threshold: 5 }, { owner: "friendly", has_ability: ["lone-operative-adeptus-astartes"] }),
    { type: "select-objective", selector: { count: 1, bind_as: "o", requires_unit: { owner: "enemy", requires_ability: "infiltrators-orks" } }, effect: { type: "no-effect" } },
    { type: "conditional", condition: { type: "rule-active", parameters: { rule: "waaagh-orks" } }, effect: L("cp-gain", { amount: 1 }) },
    { type: "conditional", condition: { type: "has-ability", parameters: { ability: "lord-of-the-death-guard" } }, effect: L("cp-gain", { amount: 1 }) },
    { type: "conditional", condition: { type: "happened", parameters: { event: "used", filter: { kind: "stratagem", id: "grenade-adeptus-astartes" }, window: "turn" } }, effect: L("cp-gain", { amount: 1 }) },
    { type: "conditional", condition: { type: "within", parameters: { range: { aura_of: "nurgles-gift-death-guard" } } }, effect: L("cp-gain", { amount: 1 }) },
    { type: "conditional", condition: { type: "within", parameters: { range: { aura_of: "vile-contagion-death-guard" } } }, effect: L("cp-gain", { amount: 1 }) },
  ]) render(e);
  describeCondition({ type: "rule-active", parameters: { rule: "acts-of-faith-adepta-sororitas" } } as never);
  describeCondition({ operator: "not", operands: [{ type: "rule-active", parameters: { rule: "orks" } }] } as never);
  const def = (e: unknown) => effectToBuffs(e, { kind: "ability", abilityId: "feel-no-pain", abilityKind: "unit" }, { phase: "shooting" } as never, "target");
  def(fnp);
  def({ ...fnp, modifier: { threshold: 5 } });
}
