//! Block translation of a container effect tree (multi-line, two-space indentation). Mirrors
//! `describeEffect` in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::designation::*;
use super::dice::*;
use super::menu::{duration_clauses, menu_block};
use super::select::*;
use super::words::*;
use super::{
    child, choice_prompt, inline, is_container, items, part_head, part_inline, stance_additive,
    stance_initial, stance_pick, ty,
};
use crate::translate::condition::{
    condition_lead_in_for, is_defensive_effect, nn, obj, or_list, range_phrase, truthy, P,
};

/// Block translation of a container effect tree (multi-line, two-space indentation).
pub(super) fn block(e: &Value, depth: usize, ctx: &Ctx) -> String {
    let e = obj(Some(e));
    let indent = "  ".repeat(depth);
    let arrow = if depth > 0 { "-> " } else { "" };
    match ty(e) {
        "conditional" => {
            let inner = child(e, "effect");
            let lead = capitalize(&condition_lead_in_for(
                child(e, "condition"),
                is_defensive_effect(inner),
            ));
            if is_container(obj(Some(inner))) {
                return format!("{indent}{lead}:\n{}", block(inner, depth + 1, ctx));
            }
            format!("{indent}{arrow}{lead}, {}.", inline(inner, ctx))
        }
        "rules-bundle" | "sequence" => {
            let steps = items(e, "steps");
            if let Some(rider) = roll_with_rider(steps, ctx) {
                return format!("{indent}{arrow}{}.", capitalize(&rider));
            }
            steps
                .iter()
                .map(|s| block(s, depth, ctx))
                .collect::<Vec<_>>()
                .join("\n")
        }
        "ability-part" => {
            // A part is always a bullet of its ability, even at the top level.
            let inner = child(e, "effect");
            // A part with nothing to head it (a printed grant's body) lists its container's steps in its place.
            if is_container(obj(Some(inner))) {
                let head = part_head(e);
                if head.is_empty() {
                    return block(inner, depth, ctx);
                }
                return format!(
                    "{indent}-> {}:\n{}",
                    capitalize(&head),
                    block(inner, depth + 1, ctx)
                );
            }
            format!("{indent}-> {}.", capitalize(&part_inline(e, ctx)))
        }
        // A grant printed with its ability: the holder and name, then the ability one level deeper.
        "ability-grant" if super::leaf_ability::is_defined_grant(e) => format!(
            "{indent}{arrow}{}:\n{}",
            capitalize(&super::leaf_ability::defined_grant_head(e, ctx)),
            block(&super::leaf_ability::definition_part(e), depth + 1, ctx)
        ),
        "choice" => {
            let mut out = format!("{indent}{}:\n", capitalize(&choice_prompt(e)));
            out.push_str(
                &items(e, "options")
                    .iter()
                    .map(|o| format!("{indent}  - {}.", capitalize(&inline(o, ctx))))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
            out
        }
        "dice-gated" => {
            if truthy_key(e, "test") {
                return format!("{indent}{arrow}{}.", capitalize(&leadership_test(e, ctx)));
            }
            format!("{indent}{arrow}{}.", capitalize(&dice_gate(e, ctx)))
        }
        "roll" => super::bind::roll_block(e, depth, ctx),
        "select-objective" => super::bind::select_objective_block(e, depth, ctx),
        "dice-table" => {
            let mut lines = vec![format!(
                "{indent}{arrow}{}:",
                capitalize(&dice_table_head(e))
            )];
            for o in items(e, "outcomes") {
                let o = obj(Some(o));
                lines.push(format!(
                    "{indent}  - On {}: {}.",
                    dice_table_result_label(o.get("results")),
                    capitalize(&inline(child(o, "effect"), ctx))
                ));
            }
            lines.join("\n")
        }
        "dice-pool-allocation" => {
            let up_to = match nn(e, "max_activations") {
                Some(n) => format!(" to activate up to {} of the following", jv(n)),
                None => " to activate the following".to_string(),
            };
            let mut lines = vec![format!(
                "{indent}{arrow}Roll {}; allocate dice{up_to}:",
                pool_phrase(e)
            )];
            for o in items(e, "options") {
                let o = obj(Some(o));
                lines.push(format!(
                    "{indent}  - {} (requires {}): {}.",
                    jstr(o.get("name")),
                    describe_requirement(o.get("requirement")),
                    inline(child(o, "effect"), ctx)
                ));
            }
            lines.join("\n")
        }
        "select-units" => {
            let sel = obj(nn(e, "selector"));
            let inner = child(e, "effect");
            let selected = selected_context(ctx, sel);
            let lead = format!(
                "Select {}{}",
                select_units_subject(sel),
                selection_binding(sel)
            );
            let header = format!("{indent}{arrow}{lead}");
            if is_container(obj(Some(inner))) {
                let header = header.strip_suffix('.').unwrap_or(&header);
                if select_units_plural(sel) {
                    let noun = if sv(obj(sel.get("filter")), "level") == Some("model") {
                        "model"
                    } else {
                        "unit"
                    };
                    return format!(
                        "{header}:\n{indent}  -> For each selected {noun}:\n{}",
                        block(inner, depth + 2, &selected)
                    );
                }
                return format!("{header}:\n{}", block(inner, depth + 1, &selected));
            }
            let nested = selected_recipient(&inline(inner, &selected), sel);
            format!("{header}: {nested}.")
        }
        "persistent-designation" => {
            if sv(e, "operation") == Some("replace") {
                return format!("{indent}{arrow}{}.", capitalize(&persistent_replacement(e)));
            }
            if !persistent_supported(e) {
                return format!("{indent}{arrow}[persistent-designation].");
            }
            let inner = child(obj(nn(e, "consumer")), "effect");
            let head = format!(
                "{indent}{arrow}{} {}",
                capitalize(&persistent_lead(e)),
                persistent_when(e)
            );
            if is_container(obj(Some(inner))) {
                return format!("{head}:\n{}", block(inner, depth + 1, ctx));
            }
            format!("{head}, {}.", inline(inner, ctx))
        }
        "for-each-unit" => {
            let sel = obj(nn(e, "selector"));
            let inner = child(e, "effect");
            let selected = selected_context(ctx, sel);
            let lead = format!("For each {}", for_each_unit_subject(sel));
            if is_container(obj(Some(inner))) {
                return format!("{indent}{lead}:\n{}", block(inner, depth + 1, &selected));
            }
            format!("{indent}{lead}: {}.", capitalize(&inline(inner, &selected)))
        }
        "designate-target" => {
            let sel = select_of(e);
            let desig = if truthy_key(e, "designation") {
                designation_label(e.get("designation"))
            } else {
                String::new()
            };
            let applies = obj(nn(e, "applies"));
            let inner = child(applies, "effect");
            let (_, trail) = duration_clauses(e.get("duration"));
            let when = designate_when(applies, true);
            let when_clause = if trail.is_empty() {
                capitalize(&when)
            } else {
                format!("{}, {when}", capitalize(trail))
            };
            let head = format!(
                "{indent}{arrow}{} {}{desig}. {when_clause}",
                designation_select_lead(sel, true),
                designation_target_subject(sel)
            );
            let recipient = designated_recipient_context(applies, ctx);
            if is_container(obj(Some(inner))) {
                return format!("{head}:\n{}", block(inner, depth + 1, &recipient));
            }
            format!("{head}, {}.", inline(inner, &recipient))
        }
        "stance-select" => {
            let consumable = if sv(e, "mode") == Some("consumable") {
                " (each may be chosen once per battle)"
            } else {
                ""
            };
            let mut lines = vec![format!(
                "{indent}{arrow}{}{consumable}{}:",
                capitalize(&stance_pick(e)),
                stance_additive(e)
            )];
            let initial = stance_initial(e);
            if !initial.is_empty() {
                lines.insert(0, format!("{indent}{arrow}{}.", capitalize(&initial)));
            }
            for o in items(e, "options") {
                let o = obj(Some(o));
                lines.push(format!(
                    "{indent}  - {}: {}.",
                    jstr(o.get("name")),
                    inline(child(o, "effect"), ctx)
                ));
            }
            lines.join("\n")
        }
        "risk-reward" => {
            let risk = obj(nn(e, "risk"));
            let on_fail = match risk.get("on_fail").filter(|f| truthy(Some(f))) {
                Some(f) => inline(f, ctx),
                None => "there is a consequence".to_string(),
            };
            format!(
                "{indent}{arrow}First take a {} test \u{2014} on a failure, {on_fail}; then {}.",
                test_name(risk.get("test")),
                inline(child(e, "reward"), ctx)
            )
        }
        "issue-orders" => {
            let n = nn(e, "count")
                .map(jv)
                .unwrap_or_else(|| "one or more".to_string());
            let range = nn(e, "range")
                .map(|r| format!(" within {}", range_phrase(Some(r))))
                .unwrap_or_default();
            let mut eligible = P::new();
            eligible.insert("owner".into(), Value::from("friendly"));
            eligible.extend(obj(nn(e, "eligible")).clone());
            let rendered = super::subject::filter_subject(&eligible, ctx);
            let units = rendered.strip_prefix("all ").unwrap_or(&rendered);
            let not_states = e
                .get("ineligible_states")
                .and_then(Value::as_array)
                .map(|states| format!(" that are not {}", or_list(&order_states(states))))
                .unwrap_or_default();
            let issue = match nn(e, "issuer") {
                Some(issuer) => format!("{} can issue", model_subject(issuer, ctx)),
                None => "Issue".to_string(),
            };
            if let Some(menu) = nn(e, "menu_from") {
                // An officer's datasheet: how many of its army rule's Orders it issues, and to which units.
                let orders = if e.get("count").and_then(Value::as_i64) == Some(1) {
                    "Order"
                } else {
                    "Orders"
                };
                let who = if nn(e, "issuer").is_some() {
                    issue
                } else {
                    "This model can issue".to_string()
                };
                return format!(
                    "{indent}{arrow}{who} up to {n} {orders} from {} to eligible {units}{range}{not_states}{}.",
                    ability_label(Some(menu)),
                    only_orders(e)
                );
            }
            let mut lines = vec![format!(
                "{indent}{arrow}{issue} up to {n} Orders to eligible {units}{range}{not_states}, each one of:"
            )];
            for o in items(e, "options") {
                let o = obj(Some(o));
                lines.push(format!(
                    "{indent}  - {}: {}.",
                    jstr(o.get("name")),
                    inline(child(o, "effect"), ctx)
                ));
            }
            lines.extend(
                order_rule_sentences(e, ctx)
                    .into_iter()
                    .map(|rule| format!("{indent}{rule}")),
            );
            lines.join("\n")
        }
        "resource-action-menu" => menu_block(e, &indent, arrow, ctx),
        // Leaf at block position — render as a single capitalized sentence.
        _ => format!(
            "{indent}{arrow}{}.",
            capitalize(&inline(&Value::Object(e.clone()), ctx))
        ),
    }
}

/// ", only Duty and Honour or Fix Bayonets": the Orders of its menu an officer is limited to.
pub(super) fn only_orders(e: &P) -> String {
    match e.get("only_options").and_then(Value::as_array) {
        Some(ids) => format!(
            ", only {}",
            or_list(
                &ids.iter()
                    .map(|id| ability_label(Some(id)))
                    .collect::<Vec<_>>()
            )
        ),
        None => String::new(),
    }
}

/// "Battle-shocked" for each unit state an issue-orders rule names.
fn order_states(states: &[Value]) -> Vec<String> {
    states.iter().map(|s| capitalize(&jstr(Some(s)))).collect()
}

/// "OFFICER models": the models an issue-orders keyword predicate names.
fn model_subject(predicate: &Value, ctx: &Ctx) -> String {
    let mut filter = obj(Some(predicate)).clone();
    filter.insert("level".into(), Value::from("model"));
    let rendered = super::subject::filter_subject(&filter, ctx);
    rendered
        .strip_prefix("all ")
        .unwrap_or(&rendered)
        .to_string()
}

/// The issue-orders rules printed after its Orders: one at a time, what ends an Order, who benefits.
fn order_rule_sentences(e: &P, ctx: &Ctx) -> Vec<String> {
    let mut out = Vec::new();
    if e.get("one_at_a_time") == Some(&Value::Bool(true)) {
        out.push("A unit holds at most one Order; a newer Order replaces it.".to_string());
    }
    if let Some(states) = e.get("ends_on").and_then(Value::as_array) {
        out.push(format!(
            "An Order ends when its unit becomes {}.",
            or_list(&order_states(states))
        ));
    }
    if let Some(benefit) = nn(e, "benefit") {
        out.push(format!(
            "Only {} in that unit benefit from its Order.",
            model_subject(benefit, ctx)
        ));
    }
    out
}
