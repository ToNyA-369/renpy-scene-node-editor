#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
import project_bootstrap  # noqa: E402
from tests.test_runtime_lifecycle import load_runtime_namespace  # noqa: E402


class GroupPathContractTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="scene-group-path-")
        self.project_root = Path(self.temporary.name)
        project_bootstrap.initialize_scene_project(self.project_root, connect_script=False)
        self.project_patch = mock.patch.object(app, "PROJECT_ROOT", self.project_root)
        self.project_patch.start()
        app.clear_undo_history()
        app.create_node({"id": "other", "path": "other", "name": "Other"})

    def tearDown(self):
        self.project_patch.stop()
        self.temporary.cleanup()

    @staticmethod
    def event(event_id, **extra):
        return {
            "ID": event_id, "Name": event_id, "Trigger": "Auto:Node", "Priority": 5,
            "Once": False, "Conditions": [], "Effects": [], "Content": None,
            "Weight": 1, "End up": "REDO", "Next Node": None, **extra,
        }

    def read_event(self, event_id):
        return app.read_json(self.project_root / "SCENENODE" / "root" / "EVENTPOOL" / f"{event_id}.json")

    def test_legacy_defaults_and_explicit_three_level_paths_round_trip(self):
        legacy = app.validate_event(self.event("legacy", Group="  Story  "))
        normal = app.validate_event(self.event("normal"))
        nested = app.save_event({"node": "root", "event": self.event(
            "nested", **{"Group Path": [" Act I ", "Arrival", "Opening"]}
        )})

        self.assertEqual(legacy["Group"], "Story")
        self.assertNotIn("Group Path", legacy)
        self.assertEqual(normal["Group"], "Normal")
        self.assertNotIn("Group Path", normal)
        self.assertEqual(nested["Group Path"], ["Act I", "Arrival", "Opening"])
        self.assertEqual(nested["Group"], "Opening")
        self.assertEqual(self.read_event("nested"), nested)

    def test_path_is_authoritative_and_components_are_never_split(self):
        event = app.validate_event(self.event(
            "slashes", Group="Ignored", **{"Group Path": ["Chapter/One", "Ending"]}
        ))
        self.assertEqual(event["Group Path"], ["Chapter/One", "Ending"])
        self.assertEqual(event["Group"], "Ending")
        for invalid in (["Normal"], ["one", "two", "three", "four"], ["", "two"], [3]):
            with self.subTest(invalid=invalid), self.assertRaises(app.ApiError):
                app.validate_event(self.event("invalid", **{"Group Path": invalid}))

    def test_same_leaf_paths_are_distinct_and_move_to_root_clears_path(self):
        app.save_event({"node": "root", "event": self.event("first", **{"Group Path": ["A", "Shared"]})})
        app.save_event({"node": "root", "event": self.event("second", **{"Group Path": ["B", "Shared"]})})
        app.rename_event_group({"node": "root", "assignments": {"first": []}})

        self.assertEqual(self.read_event("first")["Group Path"], [])
        self.assertEqual(self.read_event("first")["Group"], "Normal")
        self.assertEqual(self.read_event("second")["Group Path"], ["B", "Shared"])

    def test_invalid_fourth_depth_is_atomic_for_node_and_event_batches(self):
        before_node = app.read_json(self.project_root / "SCENENODE" / "other" / "Node.json")
        app.save_event({"node": "root", "event": self.event("first")})
        app.save_event({"node": "root", "event": self.event("second")})
        before_first = self.read_event("first")
        with self.assertRaises(app.ApiError):
            app.save_node_groups({"assignments": {"other": ["one", "two", "three", "four"]}})
        with self.assertRaises(app.ApiError):
            app.rename_event_group({"node": "root", "assignments": {
                "first": ["Story"], "second": ["one", "two", "three", "four"],
            }})
        self.assertEqual(app.read_json(self.project_root / "SCENENODE" / "other" / "Node.json"), before_node)
        self.assertEqual(self.read_event("first"), before_first)
        self.assertNotIn("Group Path", self.read_event("second"))

    def test_ordinary_event_and_node_saves_preserve_explicit_paths(self):
        app.save_event({"node": "root", "event": self.event("nested", **{"Group Path": ["Story", "Act"]})})
        app.save_event({"node": "root", "originalId": "nested", "event": self.event("nested", Name="Edited")})
        self.assertEqual(self.read_event("nested")["Group Path"], ["Story", "Act"])

        app.save_node_groups({"assignments": {"other": ["Chapter", "Branch"]}})
        app.save_node({"path": "other", "node": {"ID": "other", "Name": "Renamed"}})
        saved_node = app.read_json(self.project_root / "SCENENODE" / "other" / "Node.json")
        self.assertEqual(saved_node["Group Path"], ["Chapter", "Branch"])
        summary = next(node for node in app.scan_nodes(False) if node["path"] == "other")
        self.assertEqual(summary["groupPath"], ["Chapter", "Branch"])

    def test_legacy_string_assignment_clears_stale_path_and_undo_restores_batch(self):
        app.save_event({"node": "root", "event": self.event("nested", **{"Group Path": ["Story", "Act"]})})
        app.clear_undo_history()
        with app.undo_transaction("group paths"):
            app.rename_event_group({"node": "root", "assignments": {"nested": "Quest"}})
        moved = self.read_event("nested")
        self.assertEqual(moved["Group"], "Quest")
        self.assertNotIn("Group Path", moved)
        app.perform_undo()
        self.assertEqual(self.read_event("nested")["Group Path"], ["Story", "Act"])

    def test_event_singleton_survives_move_and_delete(self):
        app.save_event({"node": "root", "event": self.event("grouped", **{"Group Path": ["Only"]})})
        app.save_event({"node": "root", "event": self.event("other_event", **{"Group Path": ["Other"]})})
        app.rename_event_group({"node": "root", "assignments": {"other_event": []}})
        self.assertEqual(self.read_event("grouped")["Group Path"], ["Only"])
        app.save_event({"node": "root", "event": self.event("deleted", **{"Group Path": ["Only"]})})
        handler = mock.Mock(spec=app.EditorHandler)
        handler.path = "/api/events?node=root&id=deleted"
        handler.query_value.side_effect = {"node": "root", "id": "deleted"}.get
        app.EditorHandler.do_DELETE(handler)
        handler.send_error_json.assert_not_called()
        handler.send_json.assert_called_once_with({"deleted": True})
        self.assertEqual(self.read_event("grouped")["Group Path"], ["Only"])
        self.assertFalse((self.project_root / "SCENENODE/root/EVENTPOOL/deleted.json").exists())

    def test_node_delete_retains_singleton_and_undo_restores_nested_paths(self):
        app.create_node({"id": "deleted", "path": "deleted", "name": "Deleted"})
        paths = {"other": ["Chapter", "Town", "Inn"], "deleted": ["Chapter", "Town", "Inn"]}
        app.save_node_groups({"assignments": paths})
        with app.undo_transaction("node groups"):
            app.save_node_groups({"assignments": {"other": []}})
        app.perform_undo()
        self.assertEqual(app.read_node("other")["node"]["Group Path"], paths["other"])
        with app.undo_transaction("node deletion"):
            app.delete_node("deleted")
        self.assertEqual(app.read_node("other")["node"]["Group Path"], paths["other"])
        app.perform_undo()
        self.assertEqual(app.read_node("deleted")["node"]["Group Path"], paths["deleted"])

    def test_legacy_ungroup_updates_explicit_path(self):
        app.save_event({"node": "root", "event": self.event("nested", **{"Group Path": ["Old"]})})
        app.rename_event_group({"node": "root", "source": "Old", "target": "Normal"})
        self.assertEqual(self.read_event("nested")["Group Path"], [])
        self.assertEqual(self.read_event("nested")["Group"], "Normal")

    def test_legacy_lowercase_normal_is_a_real_group_not_the_reserved_sentinel(self):
        app.save_event({"node": "root", "event": self.event("lowercase", Group="normal")})
        app.rename_event_group({"node": "root", "assignments": {"lowercase": ["normal", "Child"]}})
        self.assertEqual(self.read_event("lowercase")["Group Path"], ["normal", "Child"])

    def test_runtime_selection_ignores_group_path_metadata(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["events"] = {
            "root": [self.event("runtime_nested", **{"Group Path": ["Story", "Act"]})],
        }
        runtime["scene_catalog"]["global_events"] = []
        self.assertEqual(runtime["scene_select_event"]("root", "Auto:Node")["ID"], "runtime_nested")


if __name__ == "__main__":
    unittest.main()
