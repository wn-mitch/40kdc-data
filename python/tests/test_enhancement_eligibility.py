from wh40kdc.data.enhancement_eligibility import meets_enhancement_groups


def holds(*keywords: str):
    return lambda keyword: keyword in keywords


def test_no_groups_admits_any_bearer() -> None:
    assert meets_enhancement_groups({}, "any-unit", holds())


def test_datasheet_only_record_stays_restricted() -> None:
    record = {"datasheet_restriction_groups": [{"unit_id": "squad-a", "keywords": ["Faction"]}]}
    assert not meets_enhancement_groups(record, "squad-b", holds("Faction", "Squad A"))
    assert not meets_enhancement_groups(record, "squad-a", holds())
    assert meets_enhancement_groups(record, "squad-a", holds("Faction"))


def test_datasheet_and_keyword_groups_are_alternatives() -> None:
    record = {
        "keyword_restrictions": ["Infantry", "Leader"],
        "datasheet_restriction_groups": [{"unit_id": "squad-a"}],
    }
    assert meets_enhancement_groups(record, "squad-a", holds())
    assert meets_enhancement_groups(record, "squad-b", holds("Infantry", "Leader"))
    assert not meets_enhancement_groups(record, "squad-b", holds("Infantry"))
