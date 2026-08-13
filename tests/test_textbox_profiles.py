#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from collections import UserDict
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
from tests.test_runtime_lifecycle import load_runtime_namespace  # noqa: E402


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def profile(profile_id="glass"):
    return {
        "Version": 1,
        "ID": profile_id,
        "Name": "Glass",
        "Style": {
            "Background": "#102030cc",
            "Item Background": "#203040dd",
            "Text Color": "#fefefe",
            "Text Size": 34,
            "Text Align": 0,
        },
        "Features": {
            "hover_accent": {"Enabled": True, "Color": "#5c7265", "Width": 8},
            "text_shadow": {"Enabled": True, "Color": "#00000088", "Size": 3, "X": 1, "Y": 2},
            "staggered_entrance": {"Enabled": True, "Distance": 20, "Delay": 0.05, "Duration": 0.2},
        },
    }


def textbox(profile_id="glass"):
    return {
        "ID": "actions",
        "Name": "Actions",
        "Type": "TEXTBOX",
        "Style": {"Background": "#111111", "Text Size": 28},
        "Appearance": {
            "Profile": profile_id,
            "Features": {"text_shadow": False},
            "Style Overrides": {"Text Size": 40},
        },
        "Items": [{"ID": "continue", "Trigger": "Action:continue"}],
    }


class TextboxProfileSchemaTest(unittest.TestCase):
    def test_profile_and_version_two_options_normalize_to_version_three(self):
        validated_profile = app.validate_textbox_profile(profile())
        options = app.validate_options({"Version": 2, "Elements": [textbox()]})

        self.assertEqual(validated_profile["Features"]["hover_accent"]["Width"], 8)
        self.assertFalse(validated_profile["Features"]["hover_text_color"]["Enabled"])
        self.assertEqual(validated_profile["Features"]["item_border"]["Width"], 1)
        self.assertEqual(validated_profile["Features"]["text_outline"]["Size"], 1)
        self.assertEqual(options["Version"], 3)
        self.assertEqual(options["Elements"][0]["Appearance"], {
            "Profile": "glass",
            "Features": {"text_shadow": False},
            "Style Overrides": {"Text Size": 40},
        })

    def test_unknown_profile_feature_is_rejected(self):
        value = profile()
        value["Features"]["unknown"] = {"Enabled": True}
        with self.assertRaisesRegex(app.ApiError, "不支援的特性"):
            app.validate_textbox_profile(value)


class TextboxProfileProjectTest(unittest.TestCase):
    def test_profiles_are_independent_files_and_referenced_delete_is_blocked(self):
        with tempfile.TemporaryDirectory(prefix="scene-textbox-profile-") as temporary:
            project_root = Path(temporary)
            write_json(project_root / "DATA" / "SceneProject.json", {"Version": 1, "Root Node": "root"})
            write_json(project_root / "DATA" / "Stats.json", {})
            write_json(project_root / "DATA" / "Memories.json", {"memory": {"Name": "Memory"}})
            write_json(project_root / "GLOBALNODE" / "Node.json", {"ID": "__global__", "Name": "GLOBAL"})
            write_json(project_root / "SCENENODE" / "root" / "Node.json", {"ID": "root", "Name": "Root"})
            write_json(project_root / "SCENENODE" / "root" / "Options.json", {
                "Version": 3,
                "Elements": [textbox()],
            })
            previous = app.PROJECT_ROOT
            try:
                app.PROJECT_ROOT = project_root
                created = app.create_textbox_profile({"profile": profile()})
                self.assertEqual(created["ID"], "glass")
                self.assertTrue(project_root.joinpath("DATA", "TEXTBOX_PROFILES", "glass.json").exists())
                self.assertEqual(app.scan_textbox_profiles(), [created])
                with self.assertRaisesRegex(app.ApiError, "仍被 1 個 Textbox 使用"):
                    app.delete_textbox_profile("glass")

                write_json(project_root / "SCENENODE" / "root" / "Options.json", app.default_options())
                self.assertTrue(app.delete_textbox_profile("glass")["deleted"])
            finally:
                app.PROJECT_ROOT = previous

    def test_malformed_and_missing_profiles_do_not_block_options_loading(self):
        with tempfile.TemporaryDirectory(prefix="scene-textbox-profile-invalid-") as temporary:
            project_root = Path(temporary)
            write_json(project_root / "DATA" / "SceneProject.json", {"Version": 1, "Root Node": "root"})
            write_json(project_root / "DATA" / "Stats.json", {})
            write_json(project_root / "DATA" / "Memories.json", {"memory": {"Name": "Memory"}})
            write_json(project_root / "GLOBALNODE" / "Node.json", {"ID": "__global__", "Name": "GLOBAL"})
            write_json(project_root / "SCENENODE" / "root" / "Node.json", {"ID": "root", "Name": "Root"})
            write_json(project_root / "SCENENODE" / "root" / "Options.json", {"Elements": [textbox("missing")]})
            bad_path = project_root / "DATA" / "TEXTBOX_PROFILES" / "broken.json"
            bad_path.parent.mkdir(parents=True)
            bad_path.write_text("{broken", encoding="utf-8")
            (project_root / "script.rpy").write_text("label start:\n    call scene_runtime_start()\n", encoding="utf-8")
            previous = app.PROJECT_ROOT
            try:
                app.PROJECT_ROOT = project_root
                self.assertEqual(app.scan_textbox_profiles(), [])
                detail = app.read_node("root")
                self.assertEqual(detail["options"]["Elements"][0]["Appearance"]["Profile"], "missing")
                issues = app.validate_project()
                self.assertTrue(any("broken.json" in issue["location"] for issue in issues))
                self.assertTrue(any("missing" in issue["message"] for issue in issues))
            finally:
                app.PROJECT_ROOT = previous


class TextboxProfileRuntimeTest(unittest.TestCase):
    def test_runtime_accepts_mapping_objects_that_are_not_the_active_dict_class(self):
        runtime = load_runtime_namespace()
        value = profile()
        value["Style"] = UserDict(value["Style"])
        value["Features"] = UserDict({
            feature_id: UserDict(settings)
            for feature_id, settings in value["Features"].items()
        })

        normalized = runtime["scene_normalize_textbox_profile"](UserDict(value), "glass")
        self.assertEqual(normalized["ID"], "glass")
        self.assertTrue(normalized["Features"]["hover_accent"]["Enabled"])

    def test_new_runtime_session_reloads_profiles_created_after_init(self):
        runtime = load_runtime_namespace()
        runtime["renpy"].files["DATA/TEXTBOX_PROFILES/glass.json"] = profile()

        self.assertNotIn("glass", runtime["scene_catalog"]["textbox_profiles"])
        runtime["scene_begin"]()
        self.assertIn("glass", runtime["scene_catalog"]["textbox_profiles"])

    def test_runtime_skips_wrong_filenames_and_invalid_numeric_values(self):
        runtime = load_runtime_namespace()
        self.assertIsNone(runtime["scene_normalize_textbox_profile"](profile(), "wrong_filename"))
        invalid = profile()
        invalid["Features"]["staggered_entrance"]["Duration"] = "fast"
        self.assertIsNone(runtime["scene_normalize_textbox_profile"](invalid, "glass"))

    def test_runtime_resolves_profile_then_element_and_item_overrides(self):
        runtime = load_runtime_namespace()
        element = app.validate_option_element(textbox())
        item = element["Items"][0]
        item["Style Override"] = {"Text Color": "#abcdef"}
        runtime["scene_catalog"]["textbox_profiles"] = {"glass": profile()}

        self.assertEqual(runtime["scene_option_textbox_style"](element)["Text Size"], 40)
        self.assertEqual(runtime["scene_option_item_style"](element, item, "Text Color", "#ffffff"), "#abcdef")
        self.assertTrue(runtime["scene_option_textbox_feature"](element, "hover_accent")["Enabled"])
        self.assertFalse(runtime["scene_option_textbox_feature"](element, "text_shadow")["Enabled"])
        self.assertFalse(runtime["scene_option_textbox_feature"](element, "item_border")["Enabled"])

        element["Appearance"]["Profile"] = "missing"
        self.assertEqual(runtime["scene_option_textbox_style"](element)["Background"], "#111111")
        self.assertFalse(runtime["scene_option_textbox_feature"](element, "hover_accent")["Enabled"])

    def test_renderer_contains_all_supported_visual_features(self):
        source = (ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK" / "option_renderer.rpy").read_text(encoding="utf-8")
        runtime_source = (ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK" / "runtime.rpy").read_text(encoding="utf-8")
        self.assertIn("scene_option_item_entrance", source)
        self.assertIn('scene_option_textbox_feature(element, "hover_accent")', source)
        self.assertIn('scene_option_textbox_feature(element, "hover_text_color")', source)
        self.assertIn('scene_option_textbox_feature(element, "item_border")', source)
        self.assertIn("scene_option_text_outlines(element)", source)
        self.assertIn('scene_option_textbox_feature(element, "text_shadow")', runtime_source)
        self.assertIn('scene_option_textbox_feature(element, "text_outline")', runtime_source)


if __name__ == "__main__":
    unittest.main()
