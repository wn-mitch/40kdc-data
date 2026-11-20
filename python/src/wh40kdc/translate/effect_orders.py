"""Orders (Astra Militarum Voice of Command) beyond the issue-orders menu itself.

A change to how a unit issues Orders (``orders-modifier``), Orders shared between two units
(``order-share``), and the phrases an issue-orders adds for the phase it acts as, an Order's own
recipients and a repeat of the Order just issued. Mirrors ``tools/src/translate/effect-orders.ts``.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.translate.condition_refs import _and_list, _obj, title_case
from wh40kdc.translate.effect_words import capitalize, effect_subject, filter_subject, jstr

P = dict[str, Any]


def _friendly_units(keywords: Any, ctx: Any) -> str:
    """"friendly ASTRA MILITARUM TRANSPORT units (excluding TITANIC units)": friendly units."""
    return filter_subject({"owner": "friendly", **_obj(keywords)}, ctx).removeprefix("all ")


def _orders_phrase(only: Any) -> str:
    """The Orders an orders-modifier changes: "the Move Move Move Order", or every Order."""
    if not isinstance(only, list) or not only:
        return "Orders"
    names = [title_case(jstr(_obj(option).get("option_id"))) for option in only]
    return f"the {_and_list(names)} {'Order' if len(names) == 1 else 'Orders'}"


def orders_modifier(m: P, subj: str, ctx: Any) -> str:
    """orders-modifier: how its target issues Orders, to whom, how many and from how far."""
    adds = m.get("adds_recipients") is True
    any_ = "any number of " if m.get("count") == "any" else ""
    to = ""
    if m.get("recipients") is not None:
        eligible = "" if adds else "eligible "
        to = f" to {any_}{eligible}{_friendly_units(m['recipients'], ctx)}"
    elif m.get("count") == "any":
        to = " to any number of eligible units"
    proxy = m.get("range_proxy")
    if proxy is not None:
        inches = f'{jstr(_obj(proxy).get("inches"))}"'
        marker = title_case(jstr(_obj(proxy).get("marker")))
        to += f" within {inches} of the {marker} token, as if within {inches} of them"
    off = " even while not on the battlefield" if m.get("off_battlefield") is True else ""
    rng = ", regardless of range" if m.get("range") == "unlimited" else ""
    also = "also " if adds else ""
    return f"{subj} can {also}issue {_orders_phrase(m.get('only_options'))}{to}{off}{rng}"


def order_share(m: P, subj: str, ctx: Any) -> str:
    """order-share: Orders affecting its target also affect the other unit."""
    mutual = ", and vice versa" if m.get("mutual") is True else ""
    return f"Orders affecting {subj} also affect {effect_subject(m.get('with'), ctx)}{mutual}"


def as_if_phase(e: P) -> str:
    """" as if it were your Command phase": the phase an issue-orders issues its Orders as."""
    phase = e.get("as_if_phase")
    return f" as if it were your {capitalize(jstr(phase))} phase" if phase is not None else ""


def option_recipients(option: P, ctx: Any) -> str:
    """" (only to friendly … units)": the units one Order of a menu can be issued to."""
    eligible = option.get("eligible")
    return f" (only to {_friendly_units(eligible, ctx)})" if eligible is not None else ""


def same_order_target(count: Any, units: str) -> str:
    """"the same Order to one other of the eligible …": a repeat of the Order just issued."""
    n = "one other of the" if count is None or count == 1 else f"up to {jstr(count)} other"
    return f"the same Order to {n} eligible {units}"


def added_option_recipients(option: P, ctx: Any) -> str:
    """"only to friendly … units: ": the units an Order added to a menu can be issued to."""
    eligible = option.get("eligible")
    return f"only to {_friendly_units(eligible, ctx)}: " if eligible is not None else ""
