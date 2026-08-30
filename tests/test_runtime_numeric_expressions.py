import unittest

from test_runtime_lifecycle import load_runtime_namespace, lifecycle_event
from test_contract_alignment import frontend_state_rule_contract
import app


def stat(stat_id="phase"):
    return {"type": "stat", "id": stat_id}


def calc(left, op, right):
    return {"type": "calc", "left": left, "op": op, "right": right}


class RuntimeNumericExpressionsTest(unittest.TestCase):
    def test_every_editor_operator_matches_schema_and_runtime(self):
        runtime = load_runtime_namespace()
        self.assertEqual(frontend_state_rule_contract("contract.NUMERIC_OPERATORS"), list(app.NUMERIC_OPERATORS))
        for op, expected in [("+", 9), ("-", 5), ("*", 14), ("/", 3.5), ("%", 1)]:
            value = calc(7, op, 2)
            self.assertEqual(app.validate_numeric_value(value), value)
            self.assertEqual(runtime["scene_numeric_value"](value), expected)
        self.assertEqual(runtime["scene_numeric_value"](calc(-7, "%", 2)), 1)

    def test_conditions_are_read_only_and_intermediates_are_not_clamped(self):
        runtime = load_runtime_namespace()
        runtime["scene_stats"]["phase"] = 8
        original = runtime["scene_stats"]
        condition = {"type": "stat", "left": calc(stat(), "*", 3), "op": "==", "value": 24}
        self.assertTrue(runtime["scene_condition_matches"](condition))
        self.assertIs(runtime["scene_stats"], original)
        self.assertEqual(original["phase"], 8)
        self.assertTrue(runtime["scene_condition_matches"]({"type": "stat", "id": "phase", "op": "<", "value": calc(stat(), "+", 1)}))

    def test_effects_resolve_in_order_with_final_write_clamping(self):
        runtime = load_runtime_namespace()
        apply = runtime["scene_apply_stat_effect"]
        apply({"id": "phase", "op": "set", "value": 3})
        apply({"id": "phase", "op": "+", "value": calc(stat(), "*", 2)})
        self.assertEqual(runtime["scene_stats"]["phase"], 9)
        apply({"id": "phase", "op": "set", "value": calc(stat(), "*", 2)})
        self.assertEqual(runtime["scene_stats"]["phase"], 10)
        apply({"id": "phase", "op": "-", "value": calc(stat(), "-", 3)})
        self.assertEqual(runtime["scene_stats"]["phase"], 3)

    def test_errors_do_not_mutate_the_failing_effect_target(self):
        runtime = load_runtime_namespace()
        invalid = [calc(1, "/", stat()), calc(1, "%", stat()), stat("missing"),
                   calc(calc(1, "+", 2), "+", 3), calc(1, "**", 3),
                   calc(1e308, "*", 1e308), "phase + 1", True]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(Exception):
                runtime["scene_apply_stat_effect"]({"id": "phase", "op": "set", "value": value})
            self.assertEqual(runtime["scene_stats"]["phase"], 0)

    def test_lifecycle_keeps_candidate_snapshot_with_dynamic_operands(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["events"]["root"] = [
            lifecycle_event("first", Effects=[{"type": "stat", "id": "phase", "op": "set", "value": 5}]),
            lifecycle_event("second", Conditions=[{"type": "stat", "id": "phase", "op": "==", "value": calc(0, "+", 0)}]),
        ]
        prepared = runtime["scene_lifecycle_events"]("root", "Auto:Enter")
        runtime["scene_apply_stat_effect"]({"id": "phase", "op": "set", "value": 5})
        self.assertEqual([item["event"]["ID"] for item in prepared], ["first", "second"])

    def test_catalog_rejects_unknown_event_version(self):
        runtime = load_runtime_namespace()
        runtime["renpy"].files["SCENENODE/root/EVENTPOOL/future.json"] = lifecycle_event("future", Version=99)
        with self.assertRaisesRegex(Exception, "Unsupported Event Version"):
            runtime["scene_load_catalog"]()
