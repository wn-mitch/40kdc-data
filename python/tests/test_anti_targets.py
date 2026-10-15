"""Anti targets: slash-separated keywords and "non-" keywords parse as printed and match a unit."""

from wh40kdc.cruncher.engine import _anti_target_matches
from wh40kdc.cruncher.from_dsl import parse_keyword_grant


def test_slash_and_negated_anti_targets_parse_as_printed() -> None:
    assert parse_keyword_grant("Anti-Monster/Vehicle 4+") == {
        "keyword_id": "anti",
        "parameters": {"target_keyword": "Monster/Vehicle", "threshold": 4},
    }
    assert parse_keyword_grant("Anti-Non-Vehicle 4+") == {
        "keyword_id": "anti",
        "parameters": {"target_keyword": "Non-Vehicle", "threshold": 4},
    }


def test_empty_slash_alternative_does_not_parse_as_anti() -> None:
    parsed = parse_keyword_grant("Anti-Monster/ 4+")
    assert parsed is None or parsed["keyword_id"] != "anti"


def test_anti_target_matches_any_alternative_and_negation() -> None:
    vehicle = ["vehicle", "walker"]
    infantry = ["infantry", "chaos"]
    assert _anti_target_matches("Monster/Vehicle", vehicle)
    assert not _anti_target_matches("Monster/Vehicle", infantry)
    assert not _anti_target_matches("Non-Vehicle", vehicle)
    assert _anti_target_matches("Non-Vehicle", infantry)
