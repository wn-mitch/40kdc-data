//! Block translation of a container effect tree (multi-line, two-space indentation). Mirrors
//! `describeEffect` in `tools/src/translate/effect.ts`.

use serde_json::Value;

use super::designation::*;
use super::dice::*;
use super::menu::{duration_clauses, menu_block};
use super::select::*;
use super::words::*;
use super::{
    child, choice_prompt, inline, is_container, items, part_head, part_inline, stance_pick, ty,
};
use crate::translate::condition::{condition_lead_in_value, nn, obj, truthy};
use crate::translate::event_clause;

/// Block translation of a container effect tree (multi-line, two-space indentation).
pub(super) fn block(e: &Value, depth: usize, ctx: &Ctx) -> String {
    let e = obj(Some(e));
    let indent = "  ".repeat(depth);
    let arrow = if depth > 0 { "-> " } else { "" };
    match ty(e) {
        "conditional" => {
            let inner = child(e, "effect");
            let lead = capitalize(&condition_lead_in_value(child(e, "condition")));
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
            if is_container(obj(Some(inner))) {
                return format!(
                    "{indent}-> {}:\n{}",
                    capitalize(&part_head(e)),
                    block(inner, depth + 1, ctx)
                );
            }
            format!("{indent}-> {}.", capitalize(&part_inline(e, ctx)))
        }
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
            format!("{indent}{arrow}Roll {}.", dice_gated_body(e, ctx))
        }
        "dice-table" => {
            let mut lines = vec![format!(
                "{indent}{arrow}Roll one {}:",
                dice_case(e.get("dice"))
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
            let engagement = select_units_engagement(sel);
            let lead = format!(
                "Select {}{}",
                select_units_subject(sel),
                selection_binding(sel)
            );
            let header = if engagement.is_empty() {
                format!("{indent}{arrow}{lead}")
            } else {
                format!("{indent}{arrow}{lead}. {engagement}")
            };
            if is_container(obj(Some(inner))) {
                let header = header.strip_suffix('.').unwrap_or(&header);
                if select_units_plural(sel) {
                    let noun = if sv(sel, "target_kind") == Some("model") {
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
            if engagement.is_empty() {
                format!("{header}: {nested}.")
            } else {
                format!("{header} {}.", capitalize(&nested))
            }
        }
        "leader-model-ability-grant" => format!(
            "{indent}{arrow}{}.",
            capitalize(&leader_model_ability_grant_clause(e, ctx))
        ),
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
                "{indent}{arrow}{} one {}{desig}. {when_clause}",
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
            let when = match sv(e, "select") {
                Some(s) => capitalize(&event_clause(s)),
                None => "At the start of your turn".to_string(),
            };
            let consumable = if sv(e, "mode") == Some("consumable") {
                " (each may be chosen once per battle)"
            } else {
                ""
            };
            let mut lines = vec![format!(
                "{indent}{arrow}{when}, {}{consumable}:",
                stance_pick(e)
            )];
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
                .map(|r| format!(" within {}\"", jv(r)))
                .unwrap_or_default();
            let eligible = obj(nn(e, "eligible"));
            let keyword = if truthy_key(eligible, "keyword") {
                format!(" {}", jstr(eligible.get("keyword")))
            } else {
                String::new()
            };
            let mut lines = vec![format!(
                "{indent}{arrow}Issue up to {n} Orders to eligible friendly{keyword} units{range}, each one of:"
            )];
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
        "resource-action-menu" => menu_block(e, &indent, arrow, ctx),
        // Leaf at block position — render as a single capitalized sentence.
        _ => format!(
            "{indent}{arrow}{}.",
            capitalize(&inline(&Value::Object(e.clone()), ctx))
        ),
    }
}
