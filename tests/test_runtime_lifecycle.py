#!/usr/bin/env python3

import io
import json
import textwrap
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK" / "runtime.rpy"


class FakeRenpy:
    def __init__(self):
        self.store = types.SimpleNamespace()
        self.random = types.SimpleNamespace(random=lambda: 0.75)
        self.files = {
            "DATA/SceneProject.json": {"Root Node": "root"},
            "DATA/Stats.json": {
                "phase": {"Name": "Phase", "Min": 0, "Max": 10, "Init": 0},
            },
            "DATA/Memories.json": {"memory": {"Name": "Memory"}},
            "SCENENODE/root/Node.json": {"ID": "root", "Name": "Root"},
            "SCENENODE/parent/Node.json": {"ID": "parent", "Name": "Parent"},
            "SCENENODE/current/Node.json": {"ID": "current", "Name": "Current"},
            "SCENENODE/target/Node.json": {"ID": "target", "Name": "Target"},
            "SCENENODE/weighted_target/Node.json": {"ID": "weighted_target", "Name": "Weighted Target"},
        }

    def list_files(self):
        return list(self.files)

    def file(self, path, encoding=None):
        return io.StringIO(json.dumps(self.files[path], ensure_ascii=False))


def load_runtime_namespace():
    source = RUNTIME.read_text(encoding="utf-8")
    init_block = source.split("\ndefault scene_stats", 1)[0]
    python_source = textwrap.dedent(init_block.split("\n", 1)[1])
    renpy = FakeRenpy()
    namespace = {"renpy": renpy}
    exec(compile(python_source, str(RUNTIME), "exec"), namespace)
    namespace["scene_reset_state"]()
    return namespace


def lifecycle_event(event_id, trigger="Auto:Enter", priority=3, **overrides):
    event = {
        "ID": event_id,
        "Name": event_id,
        "Trigger": trigger,
        "Priority": priority,
        "Once": False,
        "Conditions": [],
        "Effects": [],
        "Content": None,
    }
    event.update(overrides)
    return event


class RuntimeLifecycleTest(unittest.TestCase):
    def test_condition_clauses_are_or_between_branches_and_and_within_groups(self):
        runtime = load_runtime_namespace()
        grouped = [
            {"type": "stat", "id": "phase", "op": ">=", "value": 1, "clause": "and_1"},
            {"type": "memory", "bank": "memory", "id": "member", "op": "has", "clause": "and_1"},
            {"type": "stat", "id": "phase", "op": "==", "value": 0, "clause": None},
        ]

        self.assertTrue(runtime["scene_conditions_match"](grouped))
        runtime["scene_apply_stat_effect"]({"type": "stat", "id": "phase", "op": "set", "value": 1})
        self.assertFalse(runtime["scene_conditions_match"](grouped))
        runtime["scene_memory_add"]("memory", "member")
        self.assertTrue(runtime["scene_conditions_match"](grouped))

    def test_legacy_flat_conditions_remain_all_required(self):
        runtime = load_runtime_namespace()
        legacy = [
            {"type": "stat", "id": "phase", "op": "==", "value": 0},
            {"type": "memory", "bank": "memory", "id": "member", "op": "has"},
        ]

        self.assertFalse(runtime["scene_conditions_match"](legacy))
        runtime["scene_memory_add"]("memory", "member")
        self.assertTrue(runtime["scene_conditions_match"](legacy))

    def test_lifecycle_collects_every_match_in_priority_then_id_order(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["events"]["root"] = [
            lifecycle_event("z_last", priority=4, Content="last"),
            lifecycle_event("b_second", priority=1, Content="second"),
            lifecycle_event("a_first", priority=1, Content="first"),
            lifecycle_event("wrong_phase", trigger="Auto:Exit", priority=0),
        ]

        prepared = runtime["scene_lifecycle_events"]("root", "Auto:Enter")

        self.assertEqual(
            [item["event"]["ID"] for item in prepared],
            ["a_first", "b_second", "z_last"],
        )
        self.assertEqual([item["content"] for item in prepared], ["first", "second", "last"])

    def test_lifecycle_conditions_are_evaluated_as_one_snapshot(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["events"]["root"] = [
            lifecycle_event(
                "raise_phase",
                priority=1,
                Effects=[{"type": "stat", "id": "phase", "op": "+", "value": 1}],
            ),
            lifecycle_event(
                "requires_new_phase",
                priority=2,
                Conditions=[{"type": "stat", "id": "phase", "op": ">=", "value": 1}],
            ),
        ]

        prepared = runtime["scene_lifecycle_events"]("root", "Auto:Enter")
        runtime["scene_apply_prepared"](prepared[0])

        self.assertEqual([item["event"]["ID"] for item in prepared], ["raise_phase"])
        self.assertEqual(runtime["scene_get_stat"]("phase"), 1)

    def test_lifecycle_once_event_is_excluded_after_execution(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["events"]["root"] = [
            lifecycle_event("only_once", Once=True),
        ]

        first = runtime["scene_lifecycle_events"]("root", "Auto:Enter")
        runtime["scene_apply_prepared"](first[0])
        second = runtime["scene_lifecycle_events"]("root", "Auto:Enter")

        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])

    def test_on_node_keeps_single_priority_and_weight_selection(self):
        runtime = load_runtime_namespace()
        runtime["scene_catalog"]["events"]["root"] = [
            lifecycle_event("ignored_priority", trigger="Auto:Node", priority=5, Weight=100),
            lifecycle_event("candidate_a", trigger="Auto:Node", priority=1, Weight=1),
            lifecycle_event("candidate_b", trigger="Auto:Node", priority=1, Weight=3),
        ]

        selected = runtime["scene_select_event"]("root", "Auto:Node")

        self.assertEqual(selected["ID"], "candidate_b")

    def test_runtime_places_lifecycle_calls_at_node_boundaries(self):
        source = RUNTIME.read_text(encoding="utf-8")

        self.assertIn('call scene_run_lifecycle(_scene_node_id, "Auto:Enter")', source)
        self.assertIn('$ _scene_event = scene_select_event(_scene_node_id, "Auto:Node")', source)
        lifecycle_block = source.split("label scene_run_lifecycle", 1)[1].split("label scene_runtime_start", 1)[0]
        self.assertLess(
            lifecycle_block.index('call expression _scene_lifecycle_prepared["content"]'),
            lifecycle_block.index("$ scene_apply_prepared(_scene_lifecycle_prepared)"),
        )
        runtime_block = source.split("label scene_runtime_start", 1)[1]
        content_call = runtime_block.index('call expression _scene_prepared["content"]')
        apply_call = runtime_block.index("$ scene_apply_prepared(_scene_prepared)")
        validate_call = source.index("$ scene_validate_prepared_transition(_scene_prepared)")
        exit_call = source.index('call scene_run_lifecycle(_scene_node_id, "Auto:Exit")')
        resolve_call = source.index("$ scene_resolve_prepared(_scene_prepared)")
        self.assertLess(content_call, apply_call)
        self.assertLess(apply_call, runtime_block.index("$ scene_validate_prepared_transition(_scene_prepared)"))
        self.assertLess(validate_call, exit_call)
        self.assertLess(exit_call, resolve_call)
        self.assertIn('$ _scene_enter_pending = _scene_transition in ("GOTO", "REPLACE")', source)

    def test_replace_atomically_swaps_the_stack_top_and_target_exits_to_parent(self):
        runtime = load_runtime_namespace()
        runtime["scene_stack"] = ["parent", "current"]
        prepared = {
            "node_id": "current",
            "event": {},
            "content": None,
            "end_up": "REPLACE",
            "next_node": "target",
        }

        runtime["scene_validate_prepared_transition"](prepared)
        runtime["scene_resolve_prepared"](prepared)
        self.assertEqual(runtime["scene_stack"], ["parent", "target"])

        runtime["scene_resolve_prepared"]({**prepared, "node_id": "target", "end_up": "EXIT", "next_node": None})
        self.assertEqual(runtime["scene_stack"], ["parent"])

    def test_replace_exit_conditions_see_the_main_event_effects(self):
        runtime = load_runtime_namespace()
        runtime["scene_stack"] = ["parent", "current"]
        runtime["scene_catalog"]["events"]["current"] = [
            lifecycle_event(
                "current_exit",
                trigger="Auto:Exit",
                Conditions=[{"type": "stat", "id": "phase", "op": ">=", "value": 1}],
            ),
        ]
        main = {
            "node_id": "current",
            "event": {"Effects": [{"type": "stat", "id": "phase", "op": "+", "value": 1}]},
            "content": None,
            "end_up": "REPLACE",
            "next_node": "target",
        }

        runtime["scene_apply_prepared"](main)
        exit_events = runtime["scene_lifecycle_events"]("current", "Auto:Exit")

        self.assertEqual([item["event"]["ID"] for item in exit_events], ["current_exit"])

    def test_replace_target_enter_runs_without_parent_lifecycle(self):
        runtime = load_runtime_namespace()
        runtime["scene_stack"] = ["parent", "current"]
        runtime["scene_catalog"]["events"]["parent"] = [
            lifecycle_event("parent_enter", trigger="Auto:Enter"),
            lifecycle_event("parent_exit", trigger="Auto:Exit"),
            lifecycle_event("parent_node", trigger="Auto:Node", Weight=1),
        ]
        runtime["scene_catalog"]["events"]["current"] = [
            lifecycle_event("current_exit", trigger="Auto:Exit"),
        ]
        runtime["scene_catalog"]["events"]["target"] = [
            lifecycle_event("target_enter", trigger="Auto:Enter"),
        ]
        prepared = {
            "node_id": "current",
            "event": {},
            "content": None,
            "end_up": "REPLACE",
            "next_node": "target",
        }

        current_exit = runtime["scene_lifecycle_events"]("current", "Auto:Exit")
        runtime["scene_resolve_prepared"](prepared)
        target_enter = runtime["scene_lifecycle_events"]("target", "Auto:Enter")

        self.assertEqual([item["event"]["ID"] for item in current_exit], ["current_exit"])
        self.assertEqual([item["event"]["ID"] for item in target_enter], ["target_enter"])
        self.assertEqual(runtime["scene_stack"], ["parent", "target"])

    def test_replace_requires_an_actual_parent_stack_frame(self):
        runtime = load_runtime_namespace()
        runtime["scene_stack"] = ["current"]
        prepared = {"end_up": "REPLACE", "next_node": "target"}

        with self.assertRaisesRegex(Exception, "REPLACE requires a parent Scene Node; current stack depth is 1"):
            runtime["scene_validate_prepared_transition"](prepared)

    def test_replace_rejects_an_invalid_target_before_current_on_exit(self):
        runtime = load_runtime_namespace()
        runtime["scene_stack"] = ["parent", "current"]
        prepared = {"end_up": "REPLACE", "next_node": "missing"}

        with self.assertRaisesRegex(Exception, "Unknown Scene Node ID: missing"):
            runtime["scene_validate_prepared_transition"](prepared)

        source = RUNTIME.read_text(encoding="utf-8")
        self.assertLess(
            source.index("$ scene_validate_prepared_transition(_scene_prepared)"),
            source.index('call scene_run_lifecycle(_scene_node_id, "Auto:Exit")'),
        )

    def test_replace_prepares_single_and_weighted_next_nodes(self):
        runtime = load_runtime_namespace()

        single = runtime["scene_prepare_event"]("current", {
            "End up": "REPLACE",
            "Next Node": "target",
        })
        weighted = runtime["scene_prepare_event"]("current", {
            "End up": "REPLACE",
            "Next Node": {"target": 1, "weighted_target": 3},
        })

        self.assertEqual(single["next_node"], "target")
        self.assertEqual(weighted["next_node"], "weighted_target")


if __name__ == "__main__":
    unittest.main()
