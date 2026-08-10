#!/usr/bin/env python3

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
from tests.test_runtime_lifecycle import load_runtime_namespace  # noqa: E402


class StatGroupContractTest(unittest.TestCase):
    def test_group_metadata_is_normalized_without_nesting_stat_ids(self):
        result = app.validate_stats({
            "money": {"Name": "Money", "Group": "  Resources  ", "Order": 2, "Min": 0, "Init": 5, "Max": 99},
            "legacy": {"Name": "Legacy", "Group": "", "Min": 0, "Init": 0, "Max": 1},
        })

        self.assertEqual(result["money"]["Group"], "Resources")
        self.assertEqual(result["money"]["Order"], 2)
        self.assertEqual(result["legacy"]["Group"], "Normal")
        self.assertEqual(set(result), {"money", "legacy"})

    def test_runtime_state_remains_flat_and_uses_stable_stat_id(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["stats"] = app.validate_stats({
            "money": {"Name": "Money", "Group": "Resources", "Min": 0, "Init": 5, "Max": 99},
        })

        runtime["scene_reset_state"]()

        self.assertEqual(runtime["scene_stats"], {"money": 5})
        self.assertEqual(runtime["scene_get_stat"]("money"), 5)


if __name__ == "__main__":
    unittest.main()
