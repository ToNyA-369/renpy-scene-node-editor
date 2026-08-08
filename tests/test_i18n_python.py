import http
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "EDITOR") not in sys.path:
    sys.path.insert(0, str(ROOT / "EDITOR"))

from EDITOR import app


class EditorI18nPythonTests(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="editor-i18n-test-"))
        self.game_dir = self.test_dir / "game"
        self.game_dir.mkdir(parents=True, exist_ok=True)

        self.original_root = app.PROJECT_ROOT
        app.PROJECT_ROOT = self.game_dir
        app.ensure_project_structure()

    def tearDown(self):
        app.PROJECT_ROOT = self.original_root
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_validate_editor_settings_language(self):
        self.assertEqual(app.validate_editor_settings({"language": "zh-Hant"}), {"language": "zh-Hant"})
        self.assertEqual(app.validate_editor_settings({"language": "en"}), {"language": "en"})

        with self.assertRaises(app.ApiError) as ctx:
            app.validate_editor_settings({"language": "fr"})
        self.assertEqual(ctx.exception.status, http.HTTPStatus.BAD_REQUEST)
        self.assertIn("語言設定不合法", ctx.exception.message)

    def test_python_tr_helper(self):
        self.assertEqual(app.tr("尚未設定 Root Node。", lang="zh-Hant"), "尚未設定 Root Node。")
        self.assertEqual(app.tr("尚未設定 Root Node。", lang="en"), "Root Node is not configured.")
        self.assertEqual(
            app.tr("找不到 Root Node：{root_node}。", lang="en", root_node="ROOT_DEMO"),
            "Root Node not found: ROOT_DEMO."
        )

    def test_current_editor_language_resilience(self):
        settings_path = app.editor_settings_path()
        settings_path.parent.mkdir(parents=True, exist_ok=True)

        # Non-existent settings -> fallback to zh-Hant
        if settings_path.exists():
            settings_path.unlink()
        self.assertEqual(app.current_editor_language(), "zh-Hant")

        # Invalid JSON -> fallback to zh-Hant without raising or looping
        settings_path.write_text("invalid json {{{", encoding="utf-8")
        self.assertEqual(app.current_editor_language(), "zh-Hant")

        # Valid language en
        settings_path.write_text(json.dumps({"language": "en"}), encoding="utf-8")
        self.assertEqual(app.current_editor_language(), "en")

        # Unknown language -> fallback to zh-Hant
        settings_path.write_text(json.dumps({"language": "fr"}), encoding="utf-8")
        self.assertEqual(app.current_editor_language(), "zh-Hant")

    def test_all_python_en_dictionary_keys_are_valid(self):
        for key, value in app.PYTHON_EN_DICTIONARY.items():
            self.assertTrue(bool(key), "Key must be non-empty")
            self.assertTrue(bool(value), "Value must be non-empty")

    def test_validate_project_returns_english_when_language_is_en(self):
        # Set invalid root node in SceneProject.json to trigger a validation issue
        project_config = app.scene_project_path()
        app.write_json(project_config, {"Root Node": ""})

        # Default Chinese test
        issues_zh = app.validate_project()
        self.assertTrue(any("尚未設定 Root Node" in issue["message"] for issue in issues_zh))

        # Write language: en to settings.json
        settings_path = app.editor_settings_path()
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(json.dumps({"language": "en"}), encoding="utf-8")

        issues_en = app.validate_project()
        self.assertTrue(any("Root Node is not configured" in issue["message"] for issue in issues_en))


if __name__ == "__main__":
    unittest.main()
