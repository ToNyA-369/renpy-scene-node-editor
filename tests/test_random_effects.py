#!/usr/bin/env python3
"""Contract coverage for Version 3 Random Effect containers."""

import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
import project_bootstrap  # noqa: E402
from test_runtime_lifecycle import load_runtime_namespace, lifecycle_event  # noqa: E402


def random_effect(*choices):
    return {"type": "random", "choices": list(choices)}


def choice(effect, weight=1):
    return {"weight": weight, "effect": effect}


class RandomEffectEditorTest(unittest.TestCase):
    def test_groups_upgrade_to_v3_without_rewriting_legacy_versions(self):
        grouped = app.validate_event({
            "ID": "grouped", "Trigger": "Auto:Enter",
            "Effects": [random_effect(choice({"type": "memory", "id": "key", "op": "add"}))],
        })
        self.assertEqual(grouped["Version"], 3)
        self.assertEqual(grouped["Effects"][0]["choices"][0]["weight"], 1)
        self.assertNotIn("Version", app.validate_event({"ID": "legacy", "Trigger": "Auto:Enter"}))
        self.assertEqual(app.validate_event({"ID": "v2", "Version": 2, "Trigger": "Auto:Enter"})["Version"], 2)
        self.assertEqual(app.validate_event({"ID": "v3", "Version": 3, "Trigger": "Auto:Enter"})["Version"], 3)

    def test_group_schema_rejects_invalid_weights_empty_and_nested_groups(self):
        invalid = [
            {"type": "random", "choices": []},
            random_effect({"weight": 1}),
            random_effect(choice({"type": "memory", "id": "key", "op": "add"}, 0)),
            random_effect(choice({"type": "memory", "id": "key", "op": "add"}, True)),
            random_effect(choice({"type": "memory", "id": "key", "op": "add"}, float("inf"))),
            random_effect(choice({"type": "memory", "id": "key", "op": "add"}, 10 ** 10000)),
            random_effect(choice(random_effect(choice({"type": "memory", "id": "key", "op": "add"})))),
        ]
        for effect in invalid:
            with self.subTest(effect=effect):
                with self.assertRaises(app.ApiError):
                    app.validate_event({"ID": "bad", "Trigger": "Auto:Enter", "Effects": [effect]})

    def test_references_and_memory_tags_include_every_random_child(self):
        with tempfile.TemporaryDirectory(prefix="scene-random-effects-") as temporary:
            root = Path(temporary)
            previous = app.PROJECT_ROOT
            app.PROJECT_ROOT = root
            try:
                event_dir = root / "SCENENODE" / "root" / "EVENTPOOL"
                event_dir.mkdir(parents=True)
                (root / "SCENENODE" / "root" / "Node.json").write_text(json.dumps({"ID": "root", "Name": "Root"}), encoding="utf-8")
                (root / "GLOBALNODE").mkdir()
                (root / "GLOBALNODE" / "Node.json").write_text(json.dumps({"ID": "__global__", "Name": "GLOBAL"}), encoding="utf-8")
                event = {"ID": "random", "Effects": [random_effect(
                    choice({"type": "memory", "bank": "memory", "id": "rare", "op": "add"}, 0.0001),
                    choice({"type": "option", "op": "enable", "target": "element", "node": "root", "element": "hidden"}, 99),
                )]}
                (event_dir / "random.json").write_text(json.dumps(event), encoding="utf-8")
                self.assertEqual(app.scan_memory_tags(), {"memory": ["rare"]})
                references = app.option_effect_references("root", "hidden")
                self.assertEqual(len(references), 1)
                self.assertEqual(references[0]["effectIndex"], 0)
                self.assertEqual(references[0]["effectPath"], [0, 1])
            finally:
                app.PROJECT_ROOT = previous

    def test_project_validation_checks_numeric_references_inside_every_choice(self):
        with tempfile.TemporaryDirectory(prefix="scene-random-validation-") as temporary:
            root = Path(temporary)
            project_bootstrap.initialize_scene_project(root, connect_script=False)
            with mock.patch.object(app, "PROJECT_ROOT", root):
                app.save_event({"node": "root", "event": {
                    "ID": "random_refs", "Trigger": "Auto:Enter", "Effects": [random_effect(
                        choice({"type": "stat", "id": "missing_rare", "op": "set", "value": 1}, 0.01),
                        choice({"type": "stat", "id": "missing_common", "op": "set", "value": {"type": "stat", "id": "missing_value"}}, 99),
                    )],
                }})
                messages = [issue["message"] for issue in app.validate_project()]
                for stat_id in ("missing_rare", "missing_common", "missing_value"):
                    self.assertTrue(any(stat_id in message for message in messages), messages)


class RandomEffectRuntimeTest(unittest.TestCase):
    def runtime(self):
        return load_runtime_namespace()

    def test_native_json_arrays_work_when_renpy_shadows_list_and_dict(self):
        runtime = self.runtime()
        runtime["list"] = type("RevertableList", (list,), {})
        runtime["dict"] = type("RevertableDict", (dict,), {})
        effect = json.loads('{"type":"random","choices":[{"weight":1,"effect":{"type":"stat","id":"phase","op":"set","value":3}}]}')
        runtime["scene_apply_effect"]("root", effect)
        self.assertEqual(runtime["scene_stats"]["phase"], 3)

    def test_draw_happens_at_apply_in_order_and_reads_latest_state(self):
        runtime = self.runtime()
        draws = []
        runtime["renpy"].random.random = lambda: draws.append(True) or 0.9
        event = lifecycle_event("ordered", Effects=[
            {"type": "stat", "id": "phase", "op": "set", "value": 4},
            random_effect(
                choice({"type": "stat", "id": "phase", "op": "+", "value": 1}),
                choice({"type": "stat", "id": "phase", "op": "+", "value": {"type": "stat", "id": "phase"}}),
            ),
        ])
        prepared = runtime["scene_prepare_event"]("root", event)
        self.assertEqual(draws, [])
        runtime["scene_apply_prepared"](prepared)
        self.assertEqual(draws, [True])
        self.assertEqual(runtime["scene_stats"]["phase"], 8)

    def test_singleton_and_huge_relative_weights_apply_without_overflow(self):
        runtime = self.runtime()
        runtime["scene_apply_effect"]("root", random_effect(choice({"type": "stat", "id": "phase", "op": "set", "value": 3})))
        self.assertEqual(runtime["scene_stats"]["phase"], 3)
        runtime["scene_apply_effect"]("root", random_effect(
            choice({"type": "stat", "id": "phase", "op": "set", "value": 4}, 1e308),
            choice({"type": "stat", "id": "phase", "op": "set", "value": 5}, 1e308),
        ))
        self.assertIn(runtime["scene_stats"]["phase"], (4, 5))

    def test_legacy_weighted_selection_still_uses_its_original_single_draw_path(self):
        runtime = self.runtime()
        draws = []
        runtime["renpy"].random.random = lambda: draws.append(True) or 0.75
        self.assertEqual(runtime["scene_weighted_value"]({"first": 1, "second": 3}), "second")
        self.assertEqual(draws, [True])

    def test_every_child_is_validated_before_draw_or_mutation(self):
        runtime = self.runtime()
        runtime["renpy"].random.random = lambda: self.fail("invalid group must not draw")
        group = random_effect(
            choice({"type": "stat", "id": "phase", "op": "set", "value": 1}),
            choice({"type": "stat", "id": "missing", "op": "set", "value": 2}),
        )
        with self.assertRaisesRegex(Exception, "Unknown Stat ID: missing"):
            runtime["scene_apply_effect"]("root", group)
        self.assertEqual(runtime["scene_stats"]["phase"], 0)

    def test_unselected_dynamic_zero_divisor_does_not_block_the_group(self):
        runtime = self.runtime()
        runtime["renpy"].random.random = lambda: 0.9
        runtime["scene_apply_effect"]("root", random_effect(
            choice({"type": "stat", "id": "phase", "op": "set", "value": {
                "type": "calc", "op": "/", "left": 1,
                "right": {"type": "stat", "id": "phase"},
            }}),
            choice({"type": "stat", "id": "phase", "op": "set", "value": 7}),
        ))
        self.assertEqual(runtime["scene_stats"]["phase"], 7)

    def test_exact_draw_boundary_and_multiple_groups_keep_outer_order(self):
        for draw, expected in ((0, 3), (0.24999, 3), (0.25, 7), (0.99999, 7)):
            with self.subTest(draw=draw):
                runtime = self.runtime()
                runtime["renpy"].random.random = lambda: draw
                effects = [
                    random_effect(
                        choice({"type": "stat", "id": "phase", "op": "set", "value": 2}, 1),
                        choice({"type": "stat", "id": "phase", "op": "set", "value": 6}, 3)),
                    random_effect(choice({"type": "stat", "id": "phase", "op": "+", "value": 2})),
                    {"type": "stat", "id": "phase", "op": "-", "value": 1},
                ]
                runtime["scene_apply_prepared"](runtime["scene_prepare_event"]("root", lifecycle_event("boundary", Effects=effects)))
                self.assertEqual(runtime["scene_stats"]["phase"], expected)

    def test_selected_error_does_not_reroll_or_apply_following_effect(self):
        runtime = self.runtime()
        draws = []
        runtime["renpy"].random.random = lambda: draws.append(True) or 0
        effects = [
            {"type": "memory", "bank": "memory", "id": "before", "op": "add"},
            random_effect(
                choice({"type": "stat", "id": "phase", "op": "/", "value": {"type": "stat", "id": "phase"}}),
                choice({"type": "memory", "bank": "memory", "id": "alternative", "op": "add"})),
            {"type": "memory", "bank": "memory", "id": "after", "op": "add"},
        ]
        with self.assertRaisesRegex(Exception, "Effect #2: Random Effect choice #1:"):
            runtime["scene_apply_prepared"](runtime["scene_prepare_event"]("root", lifecycle_event("failure", Effects=effects)))
        self.assertEqual(draws, [True])
        self.assertEqual(runtime["scene_memory_tags"]("memory"), ("before",))

    def test_option_group_respects_owner_scope_and_memory_choice_executes(self):
        runtime = self.runtime()
        runtime["scene_catalog"]["options"]["root"] = {"Elements": [{"ID": "hidden", "Type": "PICTURE", "Availability": "CONTROLLED"}]}
        effect = {"type": "option", "op": "enable", "target": "element", "node": "root", "element": "hidden"}
        runtime["scene_apply_effect"]("root", random_effect(choice(effect)))
        self.assertTrue(runtime["scene_enabled_options"])
        with self.assertRaisesRegex(Exception, "owning Options scope"):
            runtime["scene_apply_effect"]("__global__", random_effect(choice(effect)))
        runtime["scene_apply_effect"]("root", random_effect(choice({"type": "memory", "bank": "memory", "id": "reward", "op": "add"})))
        self.assertEqual(runtime["scene_memory_tags"]("memory"), ("reward",))

    def test_runtime_errors_include_outer_effect_and_choice_indexes(self):
        runtime = self.runtime()
        prepared = runtime["scene_prepare_event"]("root", lifecycle_event("context", Effects=[random_effect(
            choice({"type": "stat", "id": "phase", "op": "set", "value": 1}),
            choice({"type": "stat", "id": "missing", "op": "set", "value": 2}),
        )]))
        with self.assertRaisesRegex(Exception, "Effect #1: Random Effect choice #2: Unknown Stat ID: missing"):
            runtime["scene_apply_prepared"](prepared)

    def test_runtime_rejects_nested_groups_and_accepts_event_v3(self):
        runtime = self.runtime()
        with self.assertRaisesRegex(Exception, "nested Random"):
            runtime["scene_apply_effect"]("root", random_effect(choice(random_effect(choice({"type": "stat", "id": "phase", "op": "set", "value": 1})))))
        runtime["renpy"].files["SCENENODE/root/EVENTPOOL/v3.json"] = lifecycle_event("v3", Version=3)
        runtime["scene_load_catalog"]()


if __name__ == "__main__":
    unittest.main()
