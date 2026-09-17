import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "extract_terrain_layouts", Path(__file__).parents[1] / "extract-terrain-layouts.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ExtractionSelectionTests(unittest.TestCase):
    def test_selected_pages_preserve_exact_page_layout_pairing(self):
        self.assertEqual(
            MODULE.parse_page_layout_selection(
                "12,13,14,27,28,29,39,41",
                "take-and-hold-vs-purge-the-foe-1,take-and-hold-vs-purge-the-foe-2,"
                "take-and-hold-vs-purge-the-foe-3,disruption-vs-purge-the-foe-1,"
                "disruption-vs-purge-the-foe-2,disruption-vs-purge-the-foe-3,"
                "disruption-vs-reconnaissance-1,disruption-vs-reconnaissance-3",
            ),
            [
                (12, "take-and-hold-vs-purge-the-foe-1"),
                (13, "take-and-hold-vs-purge-the-foe-2"),
                (14, "take-and-hold-vs-purge-the-foe-3"),
                (27, "disruption-vs-purge-the-foe-1"),
                (28, "disruption-vs-purge-the-foe-2"),
                (29, "disruption-vs-purge-the-foe-3"),
                (39, "disruption-vs-reconnaissance-1"),
                (41, "disruption-vs-reconnaissance-3"),
            ],
        )

    def test_semantic_seed_labels_name_the_four_corner_ruin_templates(self):
        self.assertEqual(
            MODULE.SEMANTIC_TEMPLATE_SEEDS,
            {
                "AB": "corner-ruin-balanced-left",
                "CD": "corner-ruin-balanced-right",
                "EF": "corner-ruin-left",
                "GH": "corner-ruin-right",
            },
        )

    def test_ambiguous_orientation_is_not_accepted(self):
        self.assertFalse(
            MODULE.has_unique_orientation(
                {"orientation": "identity", "orientation_scores": {"identity": 8, "flip-x": 8}}
            )
        )


if __name__ == "__main__":
    unittest.main()
