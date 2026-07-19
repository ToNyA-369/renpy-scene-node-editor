#!/usr/bin/env python3

import io
import json
import sys
import textwrap
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK" / "runtime.rpy"
RENDERER = ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK" / "option_renderer.rpy"
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402


def event_document(trigger):
    return {
        "ID": "input_event",
        "Name": "輸入事件",
        "Trigger": trigger,
        "Priority": 3,
        "Weight": 1,
        "Once": False,
        "Conditions": [],
        "Effects": [],
        "Content": None,
        "End up": "REDO",
        "Next Node": None,
    }


class FakeRenpy:
    def __init__(self):
        self.store = types.SimpleNamespace()
        self.random = types.SimpleNamespace(random=lambda: 0.5)
        self.files = {
            "DATA/SceneProject.json": {"Root Node": "root"},
            "DATA/Stats.json": {},
            "DATA/Memories.json": {"memory": {"Name": "Memory"}},
            "SCENENODE/root/Node.json": {
                "ID": "root",
                "Name": "ROOT",
                "Background": "images/room.png",
            },
            "SCENENODE/root/Options.json": {"Version": 1, "Canvas": {}, "Elements": []},
            "SCENENODE/root/EVENTPOOL/keyboard.json": event_document("Keyboard:shift_K_k"),
            "SCENENODE/root/EVENTPOOL/mouse.json": event_document("Mouse:Right"),
            "SCENENODE/root/EVENTPOOL/action.json": event_document("Action:continue"),
        }
        self.call = None
        self.scene_calls = 0
        self.show_calls = []

    def list_files(self):
        return list(self.files)

    def file(self, path, encoding=None):
        return io.StringIO(json.dumps(self.files[path], ensure_ascii=False))

    def call_screen(self, name, **kwargs):
        self.call = (name, kwargs)
        return "Keyboard:shift_K_k"

    def scene(self):
        self.scene_calls += 1

    def has_image(self, name):
        return False

    def loadable(self, filename):
        return filename == "images/room.png"

    def show(self, name, **kwargs):
        self.show_calls.append((name, kwargs))

    def show_screen(self, *args, **kwargs):
        pass

    def hide_screen(self, *args, **kwargs):
        pass


def load_runtime_namespace():
    source = RUNTIME.read_text(encoding="utf-8")
    init_block = source.split("\ndefault scene_stats", 1)[0]
    python_source = textwrap.dedent(init_block.split("\n", 1)[1])
    renpy = FakeRenpy()
    namespace = {"renpy": renpy, "ui": types.SimpleNamespace(adjustment=lambda: object())}
    exec(compile(python_source, str(RUNTIME), "exec"), namespace)
    namespace["scene_reset_state"]()
    return namespace, renpy


class EventInputTriggerTest(unittest.TestCase):
    def test_event_schema_accepts_four_trigger_sources(self):
        for trigger in (
            "Auto",
            "Action:continue",
            "Keyboard:meta_shift_K_k",
            "Mouse:Left",
            "Mouse:WheelDown",
        ):
            self.assertEqual(app.validate_event(event_document(trigger))["Trigger"], trigger)

    def test_event_schema_rejects_invalid_input_triggers(self):
        for trigger in (
            "Keyboard:",
            "Keyboard:not a keysym",
            "Keyboard:banana",
            "Mouse:Button8",
            "Gamepad:A",
            "custom_trigger",
        ):
            with self.subTest(trigger=trigger):
                with self.assertRaises(app.ApiError):
                    app.validate_event(event_document(trigger))

    def test_runtime_maps_keyboard_and_mouse_events_to_keysyms(self):
        runtime, renpy = load_runtime_namespace()

        self.assertEqual(
            runtime["scene_input_bindings"]("root"),
            [("shift_K_k", "Keyboard:shift_K_k"), ("mouseup_3", "Mouse:Right")],
        )
        self.assertEqual(
            runtime["SCENE_MOUSE_KEYSYMS"],
            {
                "Left": "mouseup_1",
                "Middle": "mouseup_2",
                "Right": "mouseup_3",
                "WheelUp": "mousedown_4",
                "WheelDown": "mousedown_5",
            },
        )
        self.assertEqual(runtime["scene_call_option_screen"]("root"), "Keyboard:shift_K_k")
        self.assertEqual(renpy.call[0], "scene_option_renderer")
        self.assertEqual(
            renpy.call[1]["input_bindings"],
            [("shift_K_k", "Keyboard:shift_K_k"), ("mouseup_3", "Mouse:Right")],
        )

    def test_option_renderer_routes_input_bindings(self):
        source = RENDERER.read_text(encoding="utf-8")

        self.assertIn("screen scene_option_renderer(node_id, input_bindings=None):", source)
        self.assertIn("for keysym, trigger in (input_bindings or []):", source)
        self.assertIn("key keysym action Return(trigger)", source)

    def test_runtime_accepts_node_background_file_paths(self):
        runtime, renpy = load_runtime_namespace()

        runtime["scene_begin"]("root")
        runtime["scene_show_current_node"]()

        self.assertEqual(renpy.scene_calls, 1)
        self.assertEqual(
            renpy.show_calls,
            [("scene_node_background", {"what": "images/room.png"})],
        )


if __name__ == "__main__":
    unittest.main()
