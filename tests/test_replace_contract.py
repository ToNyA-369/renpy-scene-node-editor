#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "EDITOR" / "static" / "app.js"
STYLES = ROOT / "EDITOR" / "static" / "styles.css"
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class ReplaceContractTest(unittest.TestCase):
    def build_project(self, root):
        write_json(root / "DATA" / "SceneProject.json", {"Version": 1, "Root Node": "source"})
        write_json(root / "DATA" / "Stats.json", {})
        write_json(root / "DATA" / "Memories.json", {"memory": {"Name": "Memory"}})
        (root / "script.rpy").write_text(
            "label start:\n    call scene_runtime_start()\n    return\n",
            encoding="utf-8",
        )
        for node_id, name in (("source", "Source"), ("target", "Target")):
            node_root = root / "SCENENODE" / node_id
            write_json(node_root / "Node.json", {"ID": node_id, "Name": name})
            write_json(node_root / "Options.json", app.default_options())
        event_path = root / "SCENENODE" / "source" / "EVENTPOOL" / "replace.json"
        write_json(event_path, {
            "ID": "replace",
            "Name": "Replace target",
            "Trigger": "Action:replace",
            "Priority": 3,
            "Weight": 1,
            "Once": False,
            "Conditions": [],
            "Effects": [],
            "Content": None,
            "End up": "REPLACE",
            "Next Node": "target",
        })
        return event_path

    def test_graph_and_node_references_include_replace(self):
        with tempfile.TemporaryDirectory(prefix="scene-replace-contract-") as temporary:
            project_root = Path(temporary)
            self.build_project(project_root)
            previous_project_root = app.PROJECT_ROOT
            try:
                app.PROJECT_ROOT = project_root

                graph = app.project_graph()
                references = app.node_references("target")

                self.assertEqual(len(graph["edges"]), 1)
                self.assertEqual(graph["edges"][0]["endUp"], "REPLACE")
                self.assertEqual(graph["edges"][0]["source"], "source")
                self.assertEqual(graph["edges"][0]["target"], "target")
                self.assertEqual([item["eventId"] for item in references["references"]], ["replace"])
                self.assertEqual(app.validate_project(), [])
            finally:
                app.PROJECT_ROOT = previous_project_root

    def test_project_validation_checks_replace_target_exists(self):
        with tempfile.TemporaryDirectory(prefix="scene-replace-validation-") as temporary:
            project_root = Path(temporary)
            event_path = self.build_project(project_root)
            event = json.loads(event_path.read_text(encoding="utf-8"))
            event["Next Node"] = "missing"
            write_json(event_path, event)
            previous_project_root = app.PROJECT_ROOT
            try:
                app.PROJECT_ROOT = project_root

                issues = app.validate_project()

                self.assertTrue(any("找不到 Next Node：missing" in issue["message"] for issue in issues))
            finally:
                app.PROJECT_ROOT = previous_project_root

    def test_graph_derives_parent_management_edges_and_reuses_goto_color(self):
        frontend = FRONTEND.read_text(encoding="utf-8")
        styles = STYLES.read_text(encoding="utf-8")

        self.assertIn('endUp: "MANAGEMENT"', frontend)
        self.assertIn("gotoParents.get(relationship.source)", frontend)
        self.assertIn('relationship.endUp === "MANAGEMENT" ? "Management" : "Goto"', frontend)
        self.assertIn(".graph-edge.is-replace path", styles)
        self.assertIn("stroke-dasharray: 8 5", styles)
        replace_rule = styles.split(".graph-edge.is-replace path", 1)[1].split("}", 1)[0]
        self.assertNotIn("stroke:", replace_rule)
        self.assertIn(".graph-edge.is-management path", styles)
        self.assertIn("#graphArrowManagement path", styles)


if __name__ == "__main__":
    unittest.main()
