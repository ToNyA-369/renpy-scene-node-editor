#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class EditorOrderingContractTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="scene-editor-order-")
        self.project_root = Path(self.temporary.name)
        self.previous_root = app.PROJECT_ROOT
        app.PROJECT_ROOT = self.project_root
        write_json(self.project_root / "DATA" / "SceneProject.json", {"Version": 1, "Root Node": "alpha"})
        write_json(self.project_root / "GLOBALNODE" / "Node.json", {"ID": "__global__", "Name": "GLOBAL"})

    def tearDown(self):
        app.PROJECT_ROOT = self.previous_root
        self.temporary.cleanup()

    def create_node(self, node_id, order=None, group=None):
        value = {"ID": node_id, "Name": node_id.title()}
        if order is not None:
            value["Order"] = order
        if group is not None:
            value["Group"] = group
        write_json(self.project_root / "SCENENODE" / node_id / "Node.json", value)
        write_json(self.project_root / "SCENENODE" / node_id / "Options.json", app.default_options())

    def test_scene_node_order_is_editor_only_and_persists(self):
        self.create_node("alpha")
        self.create_node("beta")

        result = app.save_node_order({"order": ["beta", "alpha"]})

        self.assertEqual([node["path"] for node in result["nodes"]], ["beta", "alpha"])
        self.assertEqual(json.loads((self.project_root / "SCENENODE" / "beta" / "Node.json").read_text())["Order"], 0)
        self.assertEqual(json.loads((self.project_root / "SCENENODE" / "alpha" / "Node.json").read_text())["Order"], 1)

    def test_new_scene_node_appends_after_legacy_nodes_without_order(self):
        self.create_node("alpha")
        self.create_node("beta")

        app.create_node({"id": "gamma", "name": "Gamma", "path": "gamma"})

        self.assertEqual([node["path"] for node in app.scan_nodes()], ["alpha", "beta", "gamma"])
        gamma = json.loads((self.project_root / "SCENENODE" / "gamma" / "Node.json").read_text())
        self.assertEqual(gamma["Order"], 2)
        self.assertEqual(gamma["Group"], "Normal")

    def test_scene_node_groups_and_order_are_authoring_metadata(self):
        self.create_node("alpha")
        self.create_node("beta")
        self.create_node("gamma")

        result = app.save_node_groups({
            "assignments": {"alpha": "Chapter One", "beta": "Chapter One"},
            "order": ["gamma", "alpha", "beta"],
        })

        self.assertEqual([node["path"] for node in result["nodes"]], ["gamma", "alpha", "beta"])
        self.assertEqual(result["nodes"][1]["group"], "Chapter One")
        alpha = json.loads((self.project_root / "SCENENODE" / "alpha" / "Node.json").read_text())
        self.assertEqual(alpha["Group"], "Chapter One")
        self.assertEqual(alpha["Order"], 1)

        app.save_node({"path": "alpha", "node": {"ID": "alpha", "Name": "Renamed"}})
        preserved = json.loads((self.project_root / "SCENENODE" / "alpha" / "Node.json").read_text())
        self.assertEqual(preserved["Group"], "Chapter One")
        self.assertEqual(preserved["Order"], 1)

    def test_scene_node_group_update_rejects_partial_order_without_writing(self):
        self.create_node("alpha", order=0)
        self.create_node("beta", order=1)

        with self.assertRaises(app.ApiError):
            app.save_node_groups({
                "assignments": {"alpha": "Chapter One"},
                "order": ["alpha"],
            })

        alpha = json.loads((self.project_root / "SCENENODE" / "alpha" / "Node.json").read_text())
        self.assertNotIn("Group", alpha)

    def test_content_order_lives_in_node_authoring_metadata(self):
        self.create_node("alpha")
        content_root = self.project_root / "SCENENODE" / "alpha" / "CONTENT"
        content_root.mkdir(parents=True)
        (content_root / "first.rpy").write_text("label first:\n    return\n", encoding="utf-8")
        (content_root / "second.rpy").write_text("label second:\n    return\n", encoding="utf-8")

        result = app.save_content_order({"node": "alpha", "order": ["second", "first"]})

        self.assertEqual([entry["name"] for entry in result["contents"]], ["second", "first"])
        node = json.loads((self.project_root / "SCENENODE" / "alpha" / "Node.json").read_text())
        self.assertEqual(node["Content Order"], ["second", "first"])

    def test_textbox_profile_order_is_optional_and_round_trips(self):
        first = app.create_textbox_profile({"profile": {"ID": "first", "Name": "First"}})
        second = app.create_textbox_profile({"profile": {"ID": "second", "Name": "Second"}})
        self.assertLess(first["Order"], second["Order"])

        result = app.save_textbox_profile_order({"order": ["second", "first"]})

        self.assertEqual([profile["ID"] for profile in result["profiles"]], ["second", "first"])
        self.assertEqual([profile["ID"] for profile in app.scan_textbox_profiles()], ["second", "first"])


if __name__ == "__main__":
    unittest.main()
