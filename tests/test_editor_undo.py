#!/usr/bin/env python3

import sys
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402
import project_bootstrap  # noqa: E402


class EditorUndoTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="scene-editor-undo-")
        self.project_root = Path(self.temporary.name) / "game"
        self.project_root.mkdir(parents=True)
        project_bootstrap.initialize_scene_project(self.project_root, connect_script=False)
        self.project_patch = mock.patch.object(app, "PROJECT_ROOT", self.project_root)
        self.project_patch.start()
        app.ensure_project_structure()
        app.clear_undo_history()

    def tearDown(self):
        app.clear_undo_history()
        self.project_patch.stop()
        self.temporary.cleanup()

    def test_undo_restores_file_transactions_in_lifo_order(self):
        app.write_json(app.stats_path(), {})
        with app.undo_transaction("first"):
            app.write_json(app.stats_path(), {"money": {"Name": "Money", "Init": 1, "Min": 0, "Max": 9}})
        with app.undo_transaction("second"):
            app.write_json(app.stats_path(), {"money": {"Name": "Money", "Init": 2, "Min": 0, "Max": 9}})

        app.perform_undo()
        self.assertEqual(app.read_json(app.stats_path())["money"]["Init"], 1)
        app.perform_undo()
        self.assertEqual(app.read_json(app.stats_path()), {})
        with self.assertRaises(app.ApiError) as empty:
            app.perform_undo()
        self.assertEqual(empty.exception.status, HTTPStatus.CONFLICT)

    def test_failed_transaction_rolls_back_without_entering_history(self):
        app.write_json(app.memories_path(), {"memory": {"Name": "Memory"}})
        with self.assertRaisesRegex(RuntimeError, "stop"):
            with app.undo_transaction("failed"):
                app.write_json(app.memories_path(), {"memory": {"Name": "Changed"}})
                raise RuntimeError("stop")

        self.assertEqual(app.read_json(app.memories_path()), {"memory": {"Name": "Memory"}})
        with self.assertRaises(app.ApiError):
            app.perform_undo()

    def test_created_and_deleted_node_trees_are_restored_exactly(self):
        with app.undo_transaction("create"):
            app.create_node({"id": "temporary", "path": "temporary", "name": "Temporary"})
        self.assertTrue(app.node_path("temporary").exists())
        app.perform_undo()
        self.assertFalse(app.node_path("temporary").exists())

        app.create_node({"id": "deletable", "path": "deletable", "name": "Deletable"})
        app.clear_undo_history()
        with app.undo_transaction("delete"):
            result = app.delete_node("deletable")
        backup = Path(result["backup"])
        self.assertFalse(app.node_path("deletable").exists())
        self.assertTrue(backup.exists())

        app.perform_undo()
        self.assertTrue(app.node_path("deletable").exists())
        self.assertFalse(backup.exists())

    def test_writing_identical_content_does_not_create_an_undo_step(self):
        current = app.read_json(app.stats_path(), {})
        with app.undo_transaction("no-op"):
            app.write_json(app.stats_path(), current)
        with self.assertRaises(app.ApiError):
            app.perform_undo()


if __name__ == "__main__":
    unittest.main()
