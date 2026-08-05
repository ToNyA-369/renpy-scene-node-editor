#!/usr/bin/env python3

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
from tests.test_runtime_lifecycle import load_runtime_namespace  # noqa: E402


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def textbox(availability="CONTROLLED", item_availability="CONTROLLED"):
    return {
        "ID": "actions",
        "Name": "Actions",
        "Type": "TEXTBOX",
        "Availability": availability,
        "Items": [{
            "ID": "buy",
            "Name": "Buy",
            "Text": "Buy",
            "Trigger": "Action:buy",
            "Availability": item_availability,
        }],
    }


def option_effect(target="item", **overrides):
    effect = {
        "type": "option",
        "op": "enable",
        "target": target,
        "node": "shop",
        "element": "actions",
    }
    if target == "item":
        effect["item"] = "buy"
    effect.update(overrides)
    return effect


class OptionAvailabilitySchemaTest(unittest.TestCase):
    def test_version_one_and_missing_availability_migrate_to_always(self):
        result = app.validate_options({
            "Version": 1,
            "Canvas": {},
            "Elements": [textbox(availability=None, item_availability=None)],
        })

        self.assertEqual(result["Version"], 2)
        self.assertEqual(result["Elements"][0]["Availability"], "ALWAYS")
        self.assertEqual(result["Elements"][0]["Items"][0]["Availability"], "ALWAYS")

    def test_controlled_availability_and_option_effect_use_stable_ids(self):
        result = app.validate_options({"Canvas": {}, "Elements": [textbox()]})
        effect = app.validate_effect(option_effect(extra="discarded"))

        self.assertEqual(result["Elements"][0]["Availability"], "CONTROLLED")
        self.assertEqual(result["Elements"][0]["Items"][0]["Availability"], "CONTROLLED")
        self.assertEqual(effect, option_effect())

    def test_invalid_availability_and_incomplete_effect_are_rejected(self):
        with self.assertRaisesRegex(app.ApiError, "ALWAYS 或 CONTROLLED"):
            app.validate_options({"Elements": [textbox(availability="MAYBE")]})
        with self.assertRaisesRegex(app.ApiError, "名稱不可為空"):
            app.validate_effect(option_effect(node=""))


class OptionAvailabilityProjectTest(unittest.TestCase):
    def build_project(self, root, availability="CONTROLLED"):
        write_json(root / "DATA" / "SceneProject.json", {"Version": 1, "Root Node": "shop"})
        write_json(root / "DATA" / "Stats.json", {})
        write_json(root / "DATA" / "Memories.json", {"memory": {"Name": "Memory"}})
        write_json(root / "GLOBALNODE" / "Node.json", {"ID": "__global__", "Name": "GLOBAL"})
        (root / "script.rpy").write_text(
            "label start:\n    call scene_runtime_start()\n    return\n",
            encoding="utf-8",
        )
        write_json(root / "SCENENODE" / "shop" / "Node.json", {"ID": "shop", "Name": "Shop"})
        write_json(root / "SCENENODE" / "shop" / "Options.json", {
            "Version": 2,
            "Canvas": {},
            "Elements": [textbox(availability=availability, item_availability=availability)],
        })
        write_json(root / "SCENENODE" / "controller" / "Node.json", {"ID": "controller", "Name": "Controller"})
        event = {
            "ID": "unlock_buy",
            "Name": "Unlock Buy",
            "Trigger": "Auto:Node",
            "Priority": 1,
            "Weight": 1,
            "Once": False,
            "Conditions": [],
            "Effects": [option_effect()],
            "Content": None,
            "End up": "REDO",
            "Next Node": None,
        }
        write_json(root / "SCENENODE" / "shop" / "EVENTPOOL" / "unlock_buy.json", event)
        event.update({
            "ID": "buy",
            "Name": "Buy",
            "Trigger": "Action:buy",
            "Effects": [],
        })
        write_json(root / "SCENENODE" / "shop" / "EVENTPOOL" / "buy.json", event)

    def test_targets_references_validation_and_removal_guard_include_option_effects(self):
        with tempfile.TemporaryDirectory(prefix="scene-option-targets-") as temporary:
            project_root = Path(temporary)
            self.build_project(project_root)
            previous = app.PROJECT_ROOT
            try:
                app.PROJECT_ROOT = project_root
                targets = app.scan_option_targets()
                references = app.option_effect_references("shop", "actions", "buy")
                node_references = app.node_references("shop")["references"]

                self.assertEqual(len(targets), 2)
                self.assertEqual(targets[1]["itemName"], "Buy")
                self.assertEqual(references[0]["eventId"], "unlock_buy")
                self.assertEqual(node_references, [])
                self.assertEqual(app.validate_project(), [])
                with self.assertRaisesRegex(app.ApiError, "仍被 1 個 Event Effect 引用"):
                    app.validate_option_target_removals(
                        "shop",
                        app.validate_options({"Elements": [textbox()]}),
                        app.validate_options({"Elements": []}),
                    )
            finally:
                app.PROJECT_ROOT = previous

    def test_project_validation_reports_missing_or_noncontrolled_targets(self):
        with tempfile.TemporaryDirectory(prefix="scene-option-validation-") as temporary:
            project_root = Path(temporary)
            self.build_project(project_root, availability="ALWAYS")
            previous = app.PROJECT_ROOT
            try:
                app.PROJECT_ROOT = project_root
                issues = app.validate_project()
                self.assertTrue(any("必須設為 CONTROLLED" in issue["message"] for issue in issues))

                event_path = project_root / "SCENENODE" / "shop" / "EVENTPOOL" / "unlock_buy.json"
                event = json.loads(event_path.read_text(encoding="utf-8"))
                event["Effects"][0]["item"] = "missing"
                write_json(event_path, event)
                issues = app.validate_project()
                self.assertTrue(any("找不到 Option Effect 目標" in issue["message"] for issue in issues))

                event["Effects"][0]["item"] = "buy"
                write_json(event_path, event)
                write_json(project_root / "GLOBALNODE" / "EVENTPOOL" / "invalid_option_effect.json", event)
                issues = app.validate_project()
                self.assertTrue(any("Global Event 不可使用 Option Effect" in issue["message"] for issue in issues))

                (project_root / "GLOBALNODE" / "EVENTPOOL" / "invalid_option_effect.json").unlink()
                write_json(project_root / "SCENENODE" / "controller" / "EVENTPOOL" / "cross_node.json", event)
                issues = app.validate_project()
                self.assertTrue(any("只能控制同一個 Scene Node" in issue["message"] for issue in issues))
            finally:
                app.PROJECT_ROOT = previous


class OptionAvailabilityRuntimeTest(unittest.TestCase):
    def runtime(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["nodes"]["shop"] = {"ID": "shop", "Name": "Shop"}
        runtime["scene_catalog"]["options"]["shop"] = app.validate_options({
            "Elements": [textbox()],
        })
        runtime["scene_reset_state"]()
        return runtime

    def test_element_and_item_state_compose_and_item_state_survives_parent_disable(self):
        runtime = self.runtime()
        element = runtime["scene_option_data"]("shop")["Elements"][0]
        item = element["Items"][0]

        self.assertFalse(runtime["scene_option_is_available"]("shop", element))
        self.assertEqual(runtime["scene_option_visible_items"]("shop", element), [])

        runtime["scene_apply_effect"]("shop", option_effect("element"))
        self.assertTrue(runtime["scene_option_is_available"]("shop", element))
        self.assertEqual(runtime["scene_option_visible_items"]("shop", element), [])

        runtime["scene_apply_effect"]("shop", option_effect())
        runtime["scene_apply_effect"]("shop", option_effect())
        self.assertEqual(runtime["scene_option_visible_items"]("shop", element), [item])

        runtime["scene_apply_effect"]("shop", option_effect("element", op="disable"))
        self.assertEqual(runtime["scene_option_visible_items"]("shop", element), [])
        runtime["scene_apply_effect"]("shop", option_effect("element"))
        self.assertEqual(runtime["scene_option_visible_items"]("shop", element), [item])

    def test_disable_is_idempotent_and_invalid_targets_are_explicit(self):
        runtime = self.runtime()
        runtime["scene_apply_effect"]("shop", option_effect(op="disable"))
        runtime["scene_apply_effect"]("shop", option_effect(op="disable"))
        self.assertEqual(runtime["scene_enabled_options"], [])

        with self.assertRaisesRegex(Exception, "Unknown Option Item"):
            runtime["scene_apply_effect"]("shop", option_effect(item="missing"))

        runtime["scene_catalog"]["options"]["shop"]["Elements"][0]["Availability"] = "ALWAYS"
        with self.assertRaisesRegex(Exception, "not CONTROLLED"):
            runtime["scene_apply_effect"]("shop", option_effect("element"))

        with self.assertRaisesRegex(Exception, "must target its owning Scene Node"):
            runtime["scene_apply_effect"]("other", option_effect("element"))

    def test_prepared_global_event_rejects_option_effect(self):
        runtime = self.runtime()
        prepared = {
            "owner_node_id": "__global__",
            "node_id": "shop",
            "event": {"Once": False, "Effects": [option_effect("element")]},
        }

        with self.assertRaisesRegex(Exception, "Global Event cannot use an Option Effect"):
            runtime["scene_apply_prepared"](prepared)


if __name__ == "__main__":
    unittest.main()
