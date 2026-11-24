package wh40kdc

import "strings"

// Orders (Astra Militarum Voice of Command) beyond the issue-orders menu itself: a change to how a
// unit issues Orders (orders-modifier), Orders shared between two units (order-share), and the
// phrases an issue-orders adds for the phase it acts as, an Order's own recipients and a repeat of
// the Order just issued. Mirrors tools/src/translate/effect-orders.ts.

// ordersFriendlyUnits renders "friendly ASTRA MILITARUM TRANSPORT units (excluding TITANIC units)".
func ordersFriendlyUnits(keywords any, ctx effCtx) string {
	f := map[string]any{"owner": "friendly"}
	for k, v := range mapOr(keywords) {
		f[k] = v
	}
	return strings.TrimPrefix(filterSubject(f, ctx), "all ")
}

// ordersPhrase names the Orders an orders-modifier changes: "the Move Move Move Order", or every Order.
func ordersPhrase(only any) string {
	list, ok := only.([]any)
	if !ok || len(list) == 0 {
		return "Orders"
	}
	names := make([]string, 0, len(list))
	for _, option := range list {
		names = append(names, titleCase(ejstr(mapOr(option)["option_id"])))
	}
	noun := "Orders"
	if len(names) == 1 {
		noun = "Order"
	}
	return "the " + andList(names) + " " + noun
}

// ordersModifierLeaf renders orders-modifier: how its target issues Orders, to whom, how many and
// from how far.
func ordersModifierLeaf(m map[string]any, subj string, ctx effCtx) string {
	adds := m["adds_recipients"] == true
	anyCount := m["count"] == "any"
	anyNumber := ""
	if anyCount {
		anyNumber = "any number of "
	}
	to := ""
	if m["recipients"] != nil {
		eligible := "eligible "
		if adds {
			eligible = ""
		}
		to = " to " + anyNumber + eligible + ordersFriendlyUnits(m["recipients"], ctx)
	} else if anyCount {
		to = " to any number of eligible units"
	}
	if m["range_proxy"] != nil {
		proxy := mapOr(m["range_proxy"])
		inches := ejstr(proxy["inches"]) + "\""
		to += " within " + inches + " of the " + titleCase(ejstr(proxy["marker"])) + " token, as if within " + inches + " of them"
	}
	off := ""
	if m["off_battlefield"] == true {
		off = " even while not on the battlefield"
	}
	rng := ""
	if m["range"] == "unlimited" {
		rng = ", regardless of range"
	}
	also := ""
	if adds {
		also = "also "
	}
	return subj + " can " + also + "issue " + ordersPhrase(m["only_options"]) + to + off + rng
}

// orderShareLeaf renders order-share: Orders affecting its target also affect the other unit.
func orderShareLeaf(m map[string]any, subj string, ctx effCtx) string {
	mutual := ""
	if m["mutual"] == true {
		mutual = ", and vice versa"
	}
	return "Orders affecting " + subj + " also affect " + effectSubject(m["with"], ctx) + mutual
}

// asIfPhase renders " as if it were your Command phase": the phase an issue-orders issues its Orders as.
func asIfPhase(e map[string]any) string {
	if e["as_if_phase"] == nil {
		return ""
	}
	return " as if it were your " + capitalize(ejstr(e["as_if_phase"])) + " phase"
}

// optionRecipients renders " (only to friendly … units)": the units one Order of a menu can be issued to.
func optionRecipients(option map[string]any, ctx effCtx) string {
	if option["eligible"] == nil {
		return ""
	}
	return " (only to " + ordersFriendlyUnits(option["eligible"], ctx) + ")"
}

// sameOrderTarget renders "the same Order to one other of the eligible …": a repeat of the Order the
// triggering use issued.
func sameOrderTarget(count any, units string) string {
	n := "one other of the"
	if c, ok := count.(float64); count != nil && !(ok && c == 1) {
		n = "up to " + ejstr(count) + " other"
	}
	return "the same Order to " + n + " eligible " + units
}

// addedOptionRecipients renders "only to friendly … units: ": the units an Order added to a menu can be issued to.
func addedOptionRecipients(option map[string]any, ctx effCtx) string {
	if option["eligible"] == nil {
		return ""
	}
	return "only to " + ordersFriendlyUnits(option["eligible"], ctx) + ": "
}
