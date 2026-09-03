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
        self.random = types.SimpleNamespace(random=lambda: 0.5)
        self.files = {
            "DATA/Stats.json": {},
            "DATA/Memories.json": {
                "memory": {"Name": "Memory"},
                "daily": {"Name": "每日記憶"},
            },
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
    return namespace, renpy


class RuntimeMemoryTest(unittest.TestCase):
    def test_memory_api_add_remove_and_clear(self):
        runtime, _renpy = load_runtime_namespace()

        runtime["scene_memory_add"]("daily", "今日已行動")
        self.assertTrue(runtime["scene_memory_has"]("daily", "今日已行動"))
        runtime["scene_memory_remove"]("daily", "今日已行動")
        self.assertFalse(runtime["scene_memory_has"]("daily", "今日已行動"))

        runtime["scene_memory_add"]("daily", "A")
        runtime["scene_memory_add"]("daily", "B")
        runtime["scene_memory_clear"]("daily")
        self.assertEqual(runtime["scene_memories"]["daily"], [])

    def test_legacy_tags_migrate_once_to_default_memory(self):
        runtime, renpy = load_runtime_namespace()
        runtime["scene_memories"] = {}
        runtime["scene_memory_legacy_migrated"] = False
        renpy.store.scene_tags_permanent = ["永久標籤"]
        renpy.store.scene_tags_daily = ["每日標籤"]
        renpy.store.scene_tags_weekly = ["永久標籤", "每週標籤"]

        runtime["scene_ensure_memory_state"]()

        self.assertEqual(
            runtime["scene_memories"]["memory"],
            ["永久標籤", "每日標籤", "每週標籤"],
        )
        self.assertTrue(runtime["scene_memory_legacy_migrated"])

    def test_legacy_tag_event_rules_use_default_memory(self):
        runtime, _renpy = load_runtime_namespace()
        legacy_effect = {
            "type": "tag",
            "op": "add",
            "id": "舊資料標籤",
            "scope": "daily",
        }

        runtime["scene_apply_effect"]("node", legacy_effect)

        self.assertTrue(runtime["scene_condition_matches"]({
            "type": "tag",
            "op": "has",
            "id": "舊資料標籤",
        }))
        self.assertTrue(runtime["scene_memory_has"]("memory", "舊資料標籤"))

    def test_memory_conditions_can_match_an_empty_or_nonempty_bank(self):
        runtime, _renpy = load_runtime_namespace()
        empty = {"type": "memory", "bank": "daily", "op": "empty"}
        not_empty = {"type": "memory", "bank": "daily", "op": "not_empty"}

        self.assertTrue(runtime["scene_condition_matches"](empty))
        self.assertFalse(runtime["scene_condition_matches"](not_empty))

        runtime["scene_memory_add"]("daily", "visited")
        self.assertFalse(runtime["scene_condition_matches"](empty))
        self.assertTrue(runtime["scene_condition_matches"](not_empty))


if __name__ == "__main__":
    unittest.main()
