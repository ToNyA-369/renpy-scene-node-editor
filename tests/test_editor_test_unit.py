#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
import create_editor_test_unit  # noqa: E402
import install  # noqa: E402


class EditorTestUnitTest(unittest.TestCase):
    def blank_project(self, temporary, name="EditorTest"):
        project_root = (Path(temporary) / name).resolve()
        game_root = project_root / "game"
        game_root.mkdir(parents=True)
        for marker in install.PROJECT_MARKERS:
            (game_root / marker).write_text("# blank Ren'Py project\n", encoding="utf-8")
        return project_root, game_root

    def test_generates_valid_comprehensive_project(self):
        with tempfile.TemporaryDirectory(prefix="scene-editor-test-unit-") as temporary:
            project_root, game_root = self.blank_project(temporary)

            result = create_editor_test_unit.create_editor_test_unit(project_root)

            self.assertEqual(result["project_root"], project_root)
            self.assertEqual(result["game_root"], game_root)
            self.assertEqual(result["nodes"], list(create_editor_test_unit.TEST_NODES))
            self.assertTrue(result["launcher"].exists())
            self.assertFalse((game_root / "SCENESCREEN").exists())
            self.assertTrue((game_root / create_editor_test_unit.TEST_IMAGE_FILE).is_file())
            self.assertTrue((game_root / create_editor_test_unit.TEST_MANIFEST_FILE).is_file())

            renderer = (game_root / "FRAMEWORK" / "option_renderer.rpy").read_text(encoding="utf-8")
            self.assertIn(
                'focus_mask (True if picture.get("Alpha Hit Test", False) else None)',
                renderer,
            )

            screen_source = (game_root / create_editor_test_unit.TEST_UI_FILE).read_text(encoding="utf-8")
            self.assertIn("screen scene_editor_test_hud():", screen_source)
            self.assertNotIn("scene_editor_test_root_actions", screen_source)
            self.assertNotIn("scene_editor_test_result_actions", screen_source)

            stats = json.loads((game_root / "DATA" / "Stats.json").read_text(encoding="utf-8"))
            memories = json.loads((game_root / "DATA" / "Memories.json").read_text(encoding="utf-8"))
            self.assertEqual(stats["test_points"]["Init"], 20)
            self.assertEqual(set(stats), {"test_points", "test_actions"})
            self.assertEqual(set(memories), {"memory", "test_session"})

            root_node = json.loads(
                (game_root / "SCENENODE" / "root" / "Node.json").read_text(encoding="utf-8")
            )
            self.assertEqual(root_node["Screen"], "scene_editor_test_hud")
            self.assertNotIn("Option Mode", root_node)
            self.assertNotIn("Option Screen", root_node)
            self.assertFalse((game_root / "SCENENODE" / "root" / "SCENEOPTION.rpy").exists())

            once_event = json.loads(
                (
                    game_root
                    / "SCENENODE"
                    / "root"
                    / "EVENTPOOL"
                    / "one_time_bonus.json"
                ).read_text(encoding="utf-8")
            )
            once_fallback = json.loads(
                (
                    game_root
                    / "SCENENODE"
                    / "root"
                    / "EVENTPOOL"
                    / "one_time_bonus_used.json"
                ).read_text(encoding="utf-8")
            )
            self.assertTrue(once_event["Once"])
            self.assertEqual(once_fallback["Conditions"][0]["id"], "once:one_time_bonus")
            self.assertLess(once_event["Priority"], once_fallback["Priority"])

            keyboard_event = json.loads(
                (
                    game_root
                    / "SCENENODE"
                    / "root"
                    / "EVENTPOOL"
                    / "keyboard_input.json"
                ).read_text(encoding="utf-8")
            )
            mouse_event = json.loads(
                (
                    game_root
                    / "SCENENODE"
                    / "root"
                    / "EVENTPOOL"
                    / "mouse_input.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(keyboard_event["Trigger"], "Keyboard:K_k")
            self.assertEqual(mouse_event["Trigger"], "Mouse:Right")

            options = json.loads(
                (game_root / "SCENENODE" / "options_lab" / "Options.json").read_text(encoding="utf-8")
            )
            self.assertEqual([element["Type"] for element in options["Elements"]], ["TEXTBOX", "PICTURE", "HITBOX"])
            textbox = options["Elements"][0]
            self.assertEqual(textbox["List"]["Max Visible Items"], 4)
            self.assertEqual(len(textbox["Items"]), 6)
            self.assertTrue(textbox["List"]["Show Scrollbar"])
            self.assertTrue(textbox["Hover"]["Enabled"])
            self.assertIn("Hover Sound", textbox)
            self.assertNotIn("Mousewheel", textbox["List"])
            self.assertNotIn("Remember Scroll", textbox["List"])
            self.assertNotIn("Visible Conditions", textbox)
            self.assertNotIn("Enabled Conditions", textbox["Items"][1])

            random_event = json.loads(
                (
                    game_root
                    / "SCENENODE"
                    / "options_lab"
                    / "EVENTPOOL"
                    / "random_result.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(random_event["Next Node"], {"outcome_success": 1, "outcome_fallback": 1})

            previous_project_root = app.PROJECT_ROOT
            try:
                app.PROJECT_ROOT = game_root
                self.assertEqual(set(app.scan_screen_names()), {
                    "scene_editor_test_hud",
                    "scene_option_hitbox",
                    "scene_option_picture",
                    "scene_option_renderer",
                    "scene_option_textbox",
                })
                root_detail = app.read_node("root")
                self.assertEqual(
                    [(item["file"], item["labels"]) for item in root_detail["contents"]],
                    [
                        (
                            "01_rewards.rpy",
                            [
                                "test_earned_direct",
                                "test_earned_lucky",
                                "test_once_bonus",
                                "test_once_used",
                                "test_keyboard_input",
                                "test_mouse_input",
                            ],
                        ),
                        (
                            "02_flow.rpy",
                            ["test_spent", "test_insufficient", "test_finished"],
                        ),
                    ],
                )
                edges = app.project_graph()["edges"]
                self.assertEqual(len(edges), 8)
                self.assertEqual(
                    {(edge["source"], edge["target"]) for edge in edges},
                    {
                        ("root", "options_lab"),
                        ("options_lab", "branch_lab"),
                        ("options_lab", "outcome_success"),
                        ("options_lab", "outcome_fallback"),
                        ("branch_lab", "outcome_success"),
                        ("branch_lab", "outcome_fallback"),
                    },
                )
                self.assertEqual(app.validate_project(), [])
            finally:
                app.PROJECT_ROOT = previous_project_root

    def test_refuses_project_with_existing_editor_data(self):
        with tempfile.TemporaryDirectory(prefix="scene-editor-test-refusal-") as temporary:
            project_root, game_root = self.blank_project(temporary)
            data_root = game_root / "DATA"
            data_root.mkdir()
            marker = data_root / "creator-data.txt"
            marker.write_text("preserve me\n", encoding="utf-8")

            with self.assertRaises(create_editor_test_unit.EditorTestUnitError) as error:
                create_editor_test_unit.create_editor_test_unit(project_root)

            self.assertIn("避免覆寫正式內容", str(error.exception))
            self.assertEqual(marker.read_text(encoding="utf-8"), "preserve me\n")
            self.assertFalse((project_root / ".scene-node-editor").exists())


if __name__ == "__main__":
    unittest.main()
