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

        self.assertEqual(response, golden)
        self.assertEqual(self.saved_event("root", "weighted_replace"), golden)

    def test_string_choices_and_lifecycle_omissions_round_trip(self):
        app.create_node({"id": "target", "path": "target", "name": "Target"})
        goto = {
            "ID": "single_goto",
            "Name": "Single GOTO",
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

    def test_global_event_round_trip_rejects_option_trigger(self):
        golden = {
            "ID": "global_clock",
            "Name": "Global Clock",
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

        self.assertEqual(app.save_event({"node": "@global", "event": golden}), golden)
        self.assertEqual(self.saved_event("@global", "global_clock"), golden)

        invalid = dict(golden, ID="global_option", Trigger="Action:continue")
        with self.assertRaisesRegex(app.ApiError, "Global Event 不可使用 Option Trigger"):
            app.save_event({"node": "@global", "event": invalid})

        invalid_effect = dict(
            golden,
            ID="global_option_effect",
            Effects=[{
                "type": "option",
                "op": "enable",
                "target": "element",
                "node": "root",
                "element": "actions",
            }],
        )
        with self.assertRaisesRegex(app.ApiError, "Global Event 不可使用 Option Effect"):
            app.save_event({"node": "@global", "event": invalid_effect})

        cross_node_effect = {
            **invalid_effect,
            "ID": "cross_node_option_effect",
            "Effects": [{**invalid_effect["Effects"][0], "node": "other"}],
        }
        with self.assertRaisesRegex(app.ApiError, "只能控制同一個 Scene Node"):
            app.save_event({"node": "root", "event": cross_node_effect})


if __name__ == "__main__":
    unittest.main()
