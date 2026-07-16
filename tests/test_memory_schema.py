#!/usr/bin/env python3

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402


class MemorySchemaTest(unittest.TestCase):
    def test_default_memory_is_required_and_named_memory(self):
        validated = app.validate_memories({
            "memory": {"Name": "可被正規化"},
            "chapter": {"Name": "章節記憶"},
        })

        self.assertEqual(validated["memory"], {"Name": "Memory"})
        self.assertEqual(validated["chapter"], {"Name": "章節記憶"})
        with self.assertRaises(app.ApiError):
            app.validate_memories({"chapter": {"Name": "章節記憶"}})

    def test_legacy_tag_rules_migrate_to_default_memory(self):
        condition = app.validate_condition({
            "type": "tag",
            "id": "已看過開場",
            "op": "has",
        })
        effect = app.validate_effect({
            "type": "tag",
            "id": "今日已行動",
            "op": "add",
            "scope": "daily",
        })

        self.assertEqual(condition, {
            "type": "memory",
            "bank": "memory",
            "id": "已看過開場",
            "op": "has",
        })
        self.assertEqual(effect, {
            "type": "memory",
            "bank": "memory",
            "id": "今日已行動",
            "op": "add",
        })

    def test_memory_clear_does_not_keep_a_tag(self):
        effect = app.validate_effect({
            "type": "memory",
            "bank": "chapter",
            "id": "不應保留",
            "op": "clear",
        })

        self.assertEqual(effect, {
            "type": "memory",
            "bank": "chapter",
            "op": "clear",
        })


if __name__ == "__main__":
    unittest.main()
