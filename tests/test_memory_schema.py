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

    def test_memory_bank_insertion_order_is_preserved_for_editor_sorting(self):
        validated = app.validate_memories({
            "chapter": {"Name": "章節"},
            "memory": {"Name": "會被正規化"},
            "session": {"Name": "階段"},
        })

        self.assertEqual(list(validated), ["chapter", "memory", "session"])

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

    def test_memory_empty_conditions_do_not_require_or_keep_a_tag(self):
        self.assertEqual(app.validate_condition({
            "type": "memory",
            "bank": "chapter",
            "id": "不應保留",
            "op": "empty",
        }), {
            "type": "memory",
            "bank": "chapter",
            "op": "empty",
        })
        self.assertEqual(app.validate_condition({
            "type": "memory",
            "bank": "chapter",
            "op": "not_empty",
        }), {
            "type": "memory",
            "bank": "chapter",
            "op": "not_empty",
        })

        for operation in ("has", "not_has"):
            with self.subTest(operation=operation), self.assertRaises(app.ApiError):
                app.validate_condition({
                    "type": "memory",
                    "bank": "chapter",
                    "op": operation,
                })


if __name__ == "__main__":
    unittest.main()
