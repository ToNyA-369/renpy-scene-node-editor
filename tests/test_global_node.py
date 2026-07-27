#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "EDITOR" / "static" / "app.js"
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
import project_bootstrap  # noqa: E402
from tests.test_runtime_lifecycle import lifecycle_event, load_runtime_namespace  # noqa: E402


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def global_event(event_id, end_up="REDO", next_node=None, **overrides):
    event = lifecycle_event(event_id, trigger="Auto:Node", priority=1, Weight=1)
    event.update({
        "End up": end_up,
        "Next Node": next_node if end_up in ("GOTO", "REPLACE") else None,
    })
    event.update(overrides)
    return event


class GlobalNodeContractTest(unittest.TestCase):
    def test_bootstrap_creates_the_fixed_global_authoring_scope(self):
        with tempfile.TemporaryDirectory(prefix="scene-global-bootstrap-") as temporary:
            game_root = Path(temporary)

            project_bootstrap.initialize_scene_project(game_root, connect_script=False)

            self.assertEqual(
                json.loads((game_root / "GLOBALNODE" / "Node.json").read_text(encoding="utf-8")),
                {"ID": "__global__", "Name": "GLOBAL"},
            )
            self.assertTrue((game_root / "GLOBALNODE" / "EVENTPOOL").is_dir())
            self.assertTrue((game_root / "GLOBALNODE" / "CONTENT").is_dir())
            self.assertFalse((game_root / "GLOBALNODE" / "Options.json").exists())

    def test_global_schema_rejects_option_triggers(self):
        event = global_event("invalid_option", Trigger="Action:continue")

        with self.assertRaisesRegex(app.ApiError, "Global Event 不可使用 Option Trigger"):
            app.validate_event(event, global_scope=True)

        for trigger in ("Auto:Enter", "Auto:Node", "Auto:Exit", "Keyboard:K_g", "Mouse:Right"):
            with self.subTest(trigger=trigger):
                validated = app.validate_event(
                    global_event("allowed", Trigger=trigger),
                    global_scope=True,
                )
                self.assertEqual(validated["Trigger"], trigger)

    def test_global_events_are_graph_references_but_global_is_not_a_real_node(self):
        with tempfile.TemporaryDirectory(prefix="scene-global-project-") as temporary:
            project_root = Path(temporary)
            write_json(project_root / "DATA" / "SceneProject.json", {"Version": 1, "Root Node": "root"})
            write_json(project_root / "DATA" / "Stats.json", {})
            write_json(project_root / "DATA" / "Memories.json", {"memory": {"Name": "Memory"}})
            (project_root / "script.rpy").write_text(
                "label start:\n    call scene_runtime_start()\n    return\n",
                encoding="utf-8",
            )
            write_json(project_root / "GLOBALNODE" / "Node.json", {"ID": "__global__", "Name": "World Systems"})
            write_json(project_root / "SCENENODE" / "root" / "Node.json", {"ID": "root", "Name": "Root"})
            write_json(project_root / "SCENENODE" / "target" / "Node.json", {"ID": "target", "Name": "Target"})
            write_json(
                project_root / "GLOBALNODE" / "EVENTPOOL" / "world_jump.json",
                global_event("world_jump", end_up="GOTO", next_node="target"),
            )
            previous_project_root = app.PROJECT_ROOT
            try:
                app.PROJECT_ROOT = project_root

                detail = app.read_node("@global")
                graph = app.project_graph()
                references = app.node_references("target")

                self.assertTrue(detail["isGlobal"])
                self.assertEqual(detail["node"]["ID"], "__global__")
                self.assertEqual([node["id"] for node in app.scan_nodes()], ["root", "target"])
                self.assertEqual(graph["edges"][0]["source"], "__global__")
                self.assertEqual(graph["edges"][0]["scope"], "global")
                self.assertEqual(references["references"][0]["nodePath"], "@global")
                self.assertEqual(app.validate_project(), [])
                with self.assertRaisesRegex(app.ApiError, "不可刪除"):
                    app.delete_node("@global")
            finally:
                app.PROJECT_ROOT = previous_project_root

    def test_global_and_local_on_node_events_share_priority_and_weight(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["events"]["root"] = [
            global_event("local", Priority=2, Weight=100),
        ]
        runtime["scene_catalog"]["global_events"] = [
            global_event("global", Priority=0, Weight=1),
        ]

        selected = runtime["scene_select_event"]("root", "Auto:Node")
        prepared = runtime["scene_prepare_event"]("root", selected)

        self.assertEqual(selected["ID"], "global")
        self.assertEqual(prepared["owner_node_id"], "__global__")
        self.assertEqual(prepared["node_id"], "root")

    def test_global_end_up_operates_on_the_current_stack_node(self):
        runtime = load_runtime_namespace()
        runtime["scene_stack"] = ["parent", "current"]
        event = global_event("global_replace", end_up="REPLACE", next_node="target")
        runtime["scene_catalog"]["global_events"] = [event]

        selected = runtime["scene_select_event"]("current", "Auto:Node")
        prepared = runtime["scene_prepare_event"]("current", selected)
        runtime["scene_validate_prepared_transition"](prepared)
        runtime["scene_resolve_prepared"](prepared)

        self.assertEqual(prepared["owner_node_id"], "__global__")
        self.assertEqual(prepared["node_id"], "current")
        self.assertEqual(runtime["scene_stack"], ["parent", "target"])

    def test_global_lifecycle_and_input_events_are_merged(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["events"]["root"] = [
            lifecycle_event("local_enter", trigger="Auto:Enter", priority=2),
            global_event("local_key", Trigger="Keyboard:K_l"),
        ]
        runtime["scene_catalog"]["global_events"] = [
            lifecycle_event("global_enter", trigger="Auto:Enter", priority=1),
            global_event("global_key", Trigger="Keyboard:K_g"),
            global_event("forbidden_option", Trigger="Action:forbidden", Priority=0),
        ]

        lifecycle = runtime["scene_lifecycle_events"]("root", "Auto:Enter")
        bindings = runtime["scene_input_bindings"]("root")
        option = runtime["scene_select_event"]("root", "Action:forbidden")

        self.assertEqual(
            [(item["event"]["ID"], item["owner_node_id"], item["node_id"]) for item in lifecycle],
            [
                ("global_enter", "__global__", "root"),
                ("local_enter", "root", "root"),
            ],
        )
        self.assertIn(("K_l", "Keyboard:K_l"), bindings)
        self.assertIn(("K_g", "Keyboard:K_g"), bindings)
        self.assertIsNone(option)

    def test_global_once_memory_is_namespaced(self):
        runtime = load_runtime_namespace()
        event = global_event("checkpoint", Once=True)
        runtime["scene_catalog"]["global_events"] = [event]

        prepared = runtime["scene_prepare_event"]("root", event)
        runtime["scene_apply_prepared"](prepared)

        self.assertTrue(runtime["scene_memory_has"]("memory", "once:global:checkpoint"))
        self.assertFalse(runtime["scene_memory_has"]("memory", "once:checkpoint"))
        self.assertIsNone(runtime["scene_select_event"]("root", "Auto:Node"))

    def test_frontend_keeps_global_out_of_options_and_next_node_choices(self):
        source = FRONTEND.read_text(encoding="utf-8")

        self.assertIn('const GLOBAL_NODE_PATH = "@global"', source)
        self.assertIn('EVENT_TRIGGER_MODES.filter((item) => item.id !== "Action")', source)
        self.assertIn('optionsTab.disabled = isGlobalNode()', source)
        self.assertIn('return state.nodes.map((node)', source)
        self.assertIn('scope === "global"', source)


if __name__ == "__main__":
    unittest.main()
