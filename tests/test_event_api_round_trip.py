#!/usr/bin/env python3

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
import project_bootstrap  # noqa: E402


class EventApiRoundTripTest(unittest.TestCase):
    def test_numeric_expressions_round_trip_and_upgrade_only_used_events(self):
        calc = {"type": "calc", "op": "*", "left": {"type": "stat", "id": "price"}, "right": 3}
        event = {
            "ID": "arithmetic", "Trigger": "Auto:Enter", "Conditions": [
                {"type": "stat", "left": calc, "op": "<=", "value": {"type": "stat", "id": "money"}},
            ], "Effects": [{"type": "stat", "id": "money", "op": "-", "value": calc}],
        }
        saved = app.save_event({"node": "root", "event": event})
        self.assertEqual(saved["Version"], 2)
        self.assertEqual(saved["Conditions"][0]["left"], calc)
        self.assertEqual(saved["Conditions"][0]["clause"], "and_1")
        self.assertEqual(saved, self.saved_event("root", "arithmetic"))
        self.assertEqual(app.validate_event(saved), saved)
        self.assertNotIn("Version", app.validate_event({"ID": "old", "Trigger": "Auto:Enter"}))
        self.assertEqual(app.validate_event({"ID": "old", "Trigger": "Auto:Enter", "Version": 2})["Version"], 2)

    def test_numeric_validation_rejects_code_nesting_nonfinite_and_zero_divisors(self):
        leaf = {"type": "stat", "id": "money"}
        calc = {"type": "calc", "op": "+", "left": leaf, "right": 1}
        invalid = [True, None, "money + 1", float("nan"), float("inf"),
                   {**leaf, "code": "x"}, {**calc, "left": calc}, {**calc, "right": calc},
                   {**calc, "op": "**"}, {**calc, "op": "/", "right": 0},
                   {**calc, "op": "%", "right": 0}, {"type": "stat", "id": ""}]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(app.ApiError):
                app.validate_condition({"type": "stat", "id": "money", "value": value})
            with self.subTest(effect=value), self.assertRaises(app.ApiError):
                app.validate_effect({"type": "stat", "id": "money", "value": value})
        for version in [True, 0, 4, "2"]:
            with self.subTest(version=version), self.assertRaises(app.ApiError):
                app.validate_event({"Version": version, "Trigger": "Auto:Enter"})
        with self.assertRaises(app.ApiError):
            app.validate_effect({"type": "stat", "left": calc, "id": "money", "value": 1})

    def test_numeric_references_are_checked_on_both_sides_in_local_and_global_events(self):
        for node in ("root", app.GLOBAL_NODE_PATH):
            app.save_event({"node": node, "event": {
                "ID": "references", "Trigger": "Auto:Enter", "Conditions": [
                    {"type": "stat", "left": {"type": "calc", "op": "+", "left": {"type": "stat", "id": "left_ref"}, "right": 1}, "op": "==", "value": {"type": "stat", "id": "right_ref"}},
                ], "Effects": [{"type": "stat", "id": "target_ref", "op": "set", "value": {"type": "stat", "id": "effect_ref"}}],
            }})
        issues = app.validate_project()
        for ref in ("left_ref", "right_ref", "target_ref", "effect_ref"):
            matching = [issue for issue in issues if ref in issue["message"]]
            self.assertEqual(len(matching), 2, (ref, issues))

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="scene-event-api-round-trip-")
        self.project_root = Path(self.temporary.name)
        project_bootstrap.initialize_scene_project(self.project_root, connect_script=False)
        self.project_patch = mock.patch.object(app, "PROJECT_ROOT", self.project_root)
        self.project_patch.start()

    def tearDown(self):
        self.project_patch.stop()
        self.temporary.cleanup()

    def saved_event(self, node_path, event_id):
        detail = app.read_node(node_path)
        return next(item["data"] for item in detail["events"] if item["data"]["ID"] == event_id)

    def test_normal_event_round_trips_as_golden_json(self):
        app.create_node({"id": "branch_a", "path": "branch_a", "name": "Branch A"})
        app.create_node({"id": "branch_b", "path": "branch_b", "name": "Branch B"})
        golden = {
            "ID": "weighted_replace",
            "Name": "Weighted Replace",
            "Group": "Normal",
            "Trigger": "Keyboard:ctrl_K_RETURN",
            "Priority": 2,
            "Once": True,
            "Conditions": [
                {"type": "stat", "id": "money", "op": ">=", "value": 10},
                {"type": "memory", "bank": "memory", "id": "visited", "op": "not_has"},
            ],
            "Effects": [
                {"type": "stat", "id": "money", "op": "-", "value": 10},
                {"type": "memory", "bank": "memory", "id": "visited", "op": "add"},
                {"type": "memory", "bank": "memory", "op": "clear"},
                {"type": "option", "op": "enable", "target": "item", "node": "root", "element": "actions", "item": "buy"},
            ],
            "Content": {"show_purchase": 3, "show_discount": 1},
            "Weight": 2.5,
            "End up": "REPLACE",
            "Next Node": {"branch_a": 3, "branch_b": 1},
        }

        response = app.save_event({"node": "root", "event": golden})
        normalized = {
            **golden,
            "Conditions": [{**condition, "clause": "and_1"} for condition in golden["Conditions"]],
        }

        self.assertEqual(response, normalized)
        self.assertEqual(self.saved_event("root", "weighted_replace"), normalized)

    def test_whole_bank_memory_conditions_round_trip_without_a_tag(self):
        event = {
            "ID": "memory_bank_state",
            "Trigger": "Auto:Enter",
            "Conditions": [
                {"type": "memory", "bank": "memory", "id": "stale", "op": "empty"},
                {"type": "memory", "bank": "memory", "op": "not_empty", "clause": None},
            ],
        }

        saved = app.save_event({"node": "root", "event": event})
        self.assertEqual(saved["Conditions"], [
            {"type": "memory", "bank": "memory", "op": "empty", "clause": None},
            {"type": "memory", "bank": "memory", "op": "not_empty", "clause": None},
        ])
        self.assertEqual(self.saved_event("root", "memory_bank_state"), saved)

    def test_string_choices_and_lifecycle_omissions_round_trip(self):
        app.create_node({"id": "target", "path": "target", "name": "Target"})
        goto = {
            "ID": "single_goto",
            "Name": "Single GOTO",
            "Group": "Normal",
            "Trigger": "Auto:Node",
            "Priority": 5,
            "Once": False,
            "Conditions": [],
            "Effects": [],
            "Content": "show_intro",
            "Weight": 1,
            "End up": "GOTO",
            "Next Node": "target",
        }
        lifecycle_input = {
            "ID": "enter_scene",
            "Name": "Enter Scene",
            "Group": "Normal",
            "Trigger": "Auto:Enter",
            "Priority": 1,
            "Once": False,
            "Conditions": [],
            "Effects": [],
            "Content": "show_scene",
            "Weight": 99,
            "End up": "REPLACE",
            "Next Node": "target",
        }
        lifecycle_golden = {
            "ID": "enter_scene",
            "Name": "Enter Scene",
            "Group": "Normal",
            "Trigger": "Auto:Enter",
            "Priority": 1,
            "Once": False,
            "Conditions": [],
            "Effects": [],
            "Content": "show_scene",
        }

        self.assertEqual(app.save_event({"node": "root", "event": goto}), goto)
        self.assertEqual(app.save_event({"node": "root", "event": lifecycle_input}), lifecycle_golden)
        self.assertEqual(self.saved_event("root", "single_goto"), goto)
        self.assertEqual(self.saved_event("root", "enter_scene"), lifecycle_golden)

    def test_priority_accepts_zero_through_nine_and_rejects_values_outside_the_range(self):
        base = {
            "ID": "priority_nine",
            "Name": "Priority Nine",
            "Group": "Normal",
            "Trigger": "Auto:Node",
            "Priority": 9,
            "Once": False,
            "Conditions": [],
            "Effects": [],
            "Content": None,
            "Weight": 1,
            "End up": "REDO",
            "Next Node": None,
        }
        self.assertEqual(app.save_event({"node": "root", "event": base})["Priority"], 9)
        for invalid_priority in (-1, 10):
            invalid = {**base, "ID": f"priority_{invalid_priority}", "Priority": invalid_priority}
            with self.assertRaisesRegex(app.ApiError, "0 到 9"):
                app.save_event({"node": "root", "event": invalid})

    def test_project_memory_tag_scan_groups_registered_add_effects_by_bank(self):
        base = {
            "Name": "Memory Tags",
            "Group": "Normal",
            "Trigger": "Auto:Node",
            "Priority": 5,
            "Once": False,
            "Conditions": [],
            "Content": None,
            "Weight": 1,
            "End up": "REDO",
            "Next Node": None,
        }
        app.save_event({
            "node": "root",
            "event": {
                **base,
                "ID": "registered_tags",
                "Effects": [
                    {"type": "memory", "bank": "memory", "id": "test_key", "op": "add"},
                    {"type": "memory", "bank": "memory", "id": "ignored_remove", "op": "remove"},
                    {"type": "memory", "bank": "daily", "id": "visited", "op": "add"},
                ],
            },
        })
        app.save_event({
            "node": "root",
            "event": {
                **base,
                "ID": "deduplicated_tags",
                "Effects": [
                    {"type": "memory", "bank": "memory", "id": "test_key", "op": "add"},
                    {"type": "memory", "bank": "memory", "op": "clear"},
                ],
            },
        })

        self.assertEqual(app.scan_memory_tags(), {
            "daily": ["visited"],
            "memory": ["test_key"],
        })

    def test_global_event_round_trips_option_trigger_and_scope_owned_effect(self):
        golden = {
            "ID": "global_clock",
            "Name": "Global Clock",
            "Group": "Normal",
            "Trigger": "Mouse:WheelDown",
            "Priority": 0,
            "Once": False,
            "Conditions": [{"type": "stat", "id": "minute", "op": ">=", "value": 60}],
            "Effects": [{"type": "stat", "id": "hour", "op": "+", "value": 1}],
            "Content": None,
            "Weight": 1,
            "End up": "REDO",
            "Next Node": None,
        }

        normalized = {
            **golden,
            "Conditions": [{**golden["Conditions"][0], "clause": "and_1"}],
        }
        self.assertEqual(app.save_event({"node": "@global", "event": golden}), normalized)
        self.assertEqual(self.saved_event("@global", "global_clock"), normalized)

        global_option = dict(
            golden,
            ID="global_option",
            Trigger="Action:continue",
            Effects=[{
                "type": "option",
                "op": "enable",
                "target": "element",
                "node": "__global__",
                "element": "actions",
            }],
        )
        normalized_option = {**global_option, "Conditions": normalized["Conditions"]}
        self.assertEqual(app.save_event({"node": "@global", "event": global_option}), normalized_option)
        self.assertEqual(self.saved_event("@global", "global_option"), normalized_option)

        cross_node_effect = {
            **global_option,
            "ID": "cross_node_option_effect",
            "Effects": [{**global_option["Effects"][0], "node": "root"}],
        }
        with self.assertRaisesRegex(app.ApiError, "只能控制同一個 Options 作用域"):
            app.save_event({"node": "@global", "event": cross_node_effect})

    def test_condition_clauses_preserve_and_groups_and_independent_or_branches(self):
        event = {
            "ID": "condition_logic",
            "Name": "Condition Logic",
            "Group": "Normal",
            "Trigger": "Auto:Node",
            "Priority": 5,
            "Once": False,
            "Conditions": [
                {"type": "stat", "id": "money", "op": ">=", "value": 10, "clause": "and_1"},
                {"type": "memory", "bank": "memory", "id": "member", "op": "has", "clause": "and_1"},
                {"type": "stat", "id": "hour", "op": ">=", "value": 18, "clause": None},
            ],
            "Effects": [],
            "Content": None,
            "Weight": 1,
            "End up": "REDO",
            "Next Node": None,
        }

        self.assertEqual(app.save_event({"node": "root", "event": event}), event)
        invalid = {**event, "ID": "invalid_clause", "Conditions": [{**event["Conditions"][0], "clause": 3}]}
        with self.assertRaisesRegex(app.ApiError, "Condition clause"):
            app.save_event({"node": "root", "event": invalid})

    def test_event_groups_normalize_and_rename_without_changing_runtime_fields(self):
        base = {
            "ID": "grouped_event",
            "Name": "Grouped Event",
            "Group": "  Story  ",
            "Trigger": "Auto:Node",
            "Priority": 5,
            "Once": False,
            "Conditions": [],
            "Effects": [],
            "Content": None,
            "Weight": 1,
            "End up": "REDO",
            "Next Node": None,
        }
        normal = {**base, "ID": "normal_event", "Group": ""}

        self.assertEqual(app.save_event({"node": "root", "event": base})["Group"], "Story")
        self.assertEqual(app.save_event({"node": "root", "event": normal})["Group"], "Normal")

        result = app.rename_event_group({"node": "root", "source": "Story", "target": "Narrative"})

        self.assertEqual([event["ID"] for event in result["events"]], ["grouped_event"])
        self.assertEqual(self.saved_event("root", "grouped_event")["Group"], "Narrative")
        self.assertEqual(self.saved_event("root", "normal_event")["Group"], "Normal")
        assigned = app.rename_event_group({
            "node": "root",
            "assignments": {"grouped_event": "Quest", "normal_event": "Quest"},
        })
        self.assertEqual({event["ID"] for event in assigned["events"]}, {"grouped_event", "normal_event"})
        self.assertEqual(self.saved_event("root", "grouped_event")["Group"], "Quest")
        self.assertEqual(self.saved_event("root", "normal_event")["Group"], "Quest")
        ordered = app.rename_event_group({
            "node": "root",
            "order": ["normal_event", "grouped_event"],
        })
        self.assertEqual(ordered["order"], ["normal_event", "grouped_event"])
        self.assertEqual(self.saved_event("root", "normal_event")["Order"], 0)
        self.assertEqual(self.saved_event("root", "grouped_event")["Order"], 1)

        result = app.rename_event_group({"node": "root", "source": "Quest", "target": "Narrative"})
        self.assertEqual({event["ID"] for event in result["events"]}, {"grouped_event", "normal_event"})
        with self.assertRaisesRegex(app.ApiError, "Normal 是固定"):
            app.rename_event_group({"node": "root", "source": "Normal", "target": "Other"})
        with self.assertRaisesRegex(app.ApiError, "所有 Events"):
            app.rename_event_group({"node": "root", "order": ["normal_event"]})

    def test_event_group_batch_restores_earlier_files_when_a_write_fails(self):
        base = {
            "Name": "Grouped Event",
            "Group": "Normal",
            "Trigger": "Auto:Node",
            "Priority": 5,
            "Once": False,
            "Conditions": [],
            "Effects": [],
            "Content": None,
            "Weight": 1,
            "End up": "REDO",
            "Next Node": None,
        }
        app.save_event({"node": "root", "event": {**base, "ID": "first"}})
        app.save_event({"node": "root", "event": {**base, "ID": "second"}})
        real_write_json = app.write_json
        event_write_count = 0

        def fail_second_event_write(path, data):
            nonlocal event_write_count
            if path.parent.name == app.EVENT_DIR:
                event_write_count += 1
                if event_write_count == 2:
                    raise OSError("simulated write failure")
            return real_write_json(path, data)

        with mock.patch.object(app, "write_json", side_effect=fail_second_event_write):
            with self.assertRaisesRegex(OSError, "simulated write failure"):
                app.rename_event_group({
                    "node": "root",
                    "assignments": {"first": "Story", "second": "Story"},
                })

        self.assertEqual(self.saved_event("root", "first")["Group"], "Normal")
        self.assertEqual(self.saved_event("root", "second")["Group"], "Normal")


if __name__ == "__main__":
    unittest.main()
