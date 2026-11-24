//! Orders (Astra Militarum Voice of Command) beyond the issue-orders menu itself: a change to how a
//! unit issues Orders (`orders-modifier`), Orders shared between two units (`order-share`), and the
//! phrases an issue-orders adds for the phase it acts as, an Order's own recipients and a repeat of
//! the Order just issued. Mirrors `tools/src/translate/effect-orders.ts`.

use serde_json::Value;

use super::js::jstr;
use super::subject::{effect_subject, filter_subject};
use super::words::{capitalize, title_case, Ctx};
use crate::translate::condition::{and_list, nn, obj, P};

/// "friendly ASTRA MILITARUM TRANSPORT units (excluding TITANIC units)": friendly units by keyword.
fn friendly_units(keywords: Option<&Value>, ctx: &Ctx) -> String {
    let mut f = P::new();
    f.insert("owner".into(), Value::from("friendly"));
    f.extend(obj(keywords).clone());
    let rendered = filter_subject(&f, ctx);
    rendered
        .strip_prefix("all ")
        .unwrap_or(&rendered)
        .to_string()
}

/// The Orders an orders-modifier changes: "the Move Move Move Order", or every Order.
fn orders_phrase(only: Option<&Value>) -> String {
    let names: Vec<String> = only
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .map(|option| title_case(&jstr(obj(Some(option)).get("option_id"))))
                .collect()
        })
        .unwrap_or_default();
    if names.is_empty() {
        return "Orders".to_string();
    }
    let noun = if names.len() == 1 { "Order" } else { "Orders" };
    format!("the {} {noun}", and_list(&names))
}

/// orders-modifier: how its target issues Orders, to whom, how many and from how far.
pub(crate) fn orders_modifier(m: &P, subj: &str, ctx: &Ctx) -> String {
    let adds = m.get("adds_recipients") == Some(&Value::Bool(true));
    let any_count = m.get("count").and_then(Value::as_str) == Some("any");
    let any = if any_count { "any number of " } else { "" };
    let mut to = String::new();
    if let Some(recipients) = nn(m, "recipients") {
        let eligible = if adds { "" } else { "eligible " };
        to = format!(
            " to {any}{eligible}{}",
            friendly_units(Some(recipients), ctx)
        );
    } else if any_count {
        to = " to any number of eligible units".to_string();
    }
    if let Some(proxy) = nn(m, "range_proxy") {
        let proxy = obj(Some(proxy));
        let inches = format!("{}\"", jstr(proxy.get("inches")));
        to.push_str(&format!(
            " within {inches} of the {} token, as if within {inches} of them",
            title_case(&jstr(proxy.get("marker")))
        ));
    }
    let off = if m.get("off_battlefield") == Some(&Value::Bool(true)) {
        " even while not on the battlefield"
    } else {
        ""
    };
    let range = if m.get("range").and_then(Value::as_str) == Some("unlimited") {
        ", regardless of range"
    } else {
        ""
    };
    format!(
        "{subj} can {}issue {}{to}{off}{range}",
        if adds { "also " } else { "" },
        orders_phrase(m.get("only_options"))
    )
}

/// order-share: Orders affecting its target also affect the other unit.
pub(crate) fn order_share(m: &P, subj: &str, ctx: &Ctx) -> String {
    let mutual = if m.get("mutual") == Some(&Value::Bool(true)) {
        ", and vice versa"
    } else {
        ""
    };
    format!(
        "Orders affecting {subj} also affect {}{mutual}",
        effect_subject(m.get("with"), ctx)
    )
}

/// " as if it were your Command phase": the phase an issue-orders issues its Orders as.
pub(crate) fn as_if_phase(e: &P) -> String {
    match nn(e, "as_if_phase") {
        Some(phase) => format!(
            " as if it were your {} phase",
            capitalize(&jstr(Some(phase)))
        ),
        None => String::new(),
    }
}

/// " (only to friendly ARMOURED SKIRMISHER units)": the units one Order of a menu can be issued to.
pub(crate) fn option_recipients(option: &P, ctx: &Ctx) -> String {
    match nn(option, "eligible") {
        Some(eligible) => format!(" (only to {})", friendly_units(Some(eligible), ctx)),
        None => String::new(),
    }
}

/// "the same Order to one other of the eligible …": a repeat of the Order the triggering use issued.
pub(crate) fn same_order_target(count: Option<&Value>, units: &str) -> String {
    let n = match count {
        None | Some(Value::Null) => "one other of the".to_string(),
        Some(c) if c.as_i64() == Some(1) => "one other of the".to_string(),
        Some(c) => format!("up to {} other", jstr(Some(c))),
    };
    format!("the same Order to {n} eligible {units}")
}

/// "only to friendly ARMOURED SKIRMISHER units: ": the units an Order added to a menu can be issued to.
pub(crate) fn added_option_recipients(option: &P, ctx: &Ctx) -> String {
    match nn(option, "eligible") {
        Some(eligible) => format!("only to {}: ", friendly_units(Some(eligible), ctx)),
        None => String::new(),
    }
}
