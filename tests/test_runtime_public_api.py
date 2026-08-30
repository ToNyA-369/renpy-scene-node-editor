#!/usr/bin/env python3

import unittest

from tests.test_runtime_lifecycle import load_runtime_namespace


class RuntimePublicApiTest(unittest.TestCase):
    def runtime_with_stat(self, initial=4, minimum=0, maximum=10):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["stats"] = {
            "phase": {
                "Name": "Phase",
                "Min": minimum,
                "Init": initial,
                "Max": maximum,
            },
        }
        runtime["scene_reset_state"]()
        return runtime

    def test_change_stat_matches_event_effect_for_every_operation(self):
        cases = (
            ("set", 7),
            ("+", 3),
            ("-", 3),
            ("*", 3),
            ("/", 2),
        )

        for operation, operand in cases:
            with self.subTest(operation=operation):
                runtime = self.runtime_with_stat()
                final_value = runtime["scene_change_stat"]("phase", operation, operand)
                public_result = runtime["scene_get_stat"]("phase")

                runtime["scene_reset_state"]()
                runtime["scene_apply_stat_effect"]({
                    "type": "stat",
                    "id": "phase",
                    "op": operation,
                    "value": operand,
                })

                self.assertEqual(final_value, public_result)
                self.assertEqual(runtime["scene_get_stat"]("phase"), public_result)

    def test_change_stat_clamps_and_returns_the_final_value(self):
        runtime = self.runtime_with_stat()

        self.assertEqual(runtime["scene_change_stat"]("phase", "+", 100), 10)
        self.assertEqual(runtime["scene_change_stat"]("phase", "-", 100), 0)
        self.assertEqual(runtime["scene_get_stat"]("phase"), 0)

    def test_change_stat_failures_are_atomic(self):
        invalid_calls = (
            ("phase", "bogus", 1),
            ("phase", "+", True),
            ("phase", "+", "1"),
            ("phase", "+", float("inf")),
            ("phase", "+", float("nan")),
            ("phase", "/", 0),
            ("missing", "+", 1),
        )

        for stat_id, operation, operand in invalid_calls:
            with self.subTest(stat_id=stat_id, operation=operation, operand=operand):
                runtime = self.runtime_with_stat()
                original_state = dict(runtime["scene_stats"])

                with self.assertRaises(Exception):
                    runtime["scene_change_stat"](stat_id, operation, operand)

                self.assertEqual(runtime["scene_stats"], original_state)

    def test_current_node_queries_do_not_expose_mutable_catalog_state(self):
        runtime = load_runtime_namespace()

        self.assertIsNone(runtime["scene_current_node_id"]())
        self.assertEqual(runtime["scene_current_node_name"]("Unknown"), "Unknown")

        runtime["scene_stack"] = ["root"]
        self.assertEqual(runtime["scene_current_node_id"](), "root")
        self.assertEqual(runtime["scene_current_node_name"](), "Root")

        runtime["scene_catalog"]["nodes"]["root"] = {"ID": "root", "Name": ""}
        self.assertEqual(runtime["scene_current_node_name"](), "root")

        runtime["scene_stack"] = []
        self.assertEqual(runtime["scene_current_node_name"](), "")

    def test_memory_tags_returns_an_ordered_immutable_snapshot(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["memories"]["quests"] = {"Name": "Quests"}
        runtime["scene_reset_state"]()
        runtime["scene_memory_add"]("quests", "accepted")
        runtime["scene_memory_add"]("quests", "complete")

        snapshot = runtime["scene_memory_tags"]("quests")

        self.assertEqual(snapshot, ("accepted", "complete"))
        self.assertIsInstance(snapshot, tuple)
        with self.assertRaises(AttributeError):
            snapshot.append("hidden")
        self.assertEqual(runtime["scene_memory_tags"]("quests"), snapshot)

    def test_memory_tags_rejects_an_unknown_bank_without_mutation(self):
        runtime = load_runtime_namespace()
        original_state = dict(runtime["scene_memories"])

        with self.assertRaisesRegex(Exception, "Unknown Memory bank"):
            runtime["scene_memory_tags"]("missing")

        self.assertEqual(runtime["scene_memories"], original_state)


if __name__ == "__main__":
    unittest.main()
