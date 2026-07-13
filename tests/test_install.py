#!/usr/bin/env python3

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import install  # noqa: E402


class InstallerTest(unittest.TestCase):
    def test_clean_install_update_and_editor_start(self):
        with tempfile.TemporaryDirectory(prefix="scene-node-editor-") as temporary:
            project_root = (Path(temporary) / "FriendTest").resolve()
            game_root = project_root / "game"
            game_root.mkdir(parents=True)
            for marker in install.PROJECT_MARKERS:
                (game_root / marker).write_text("# blank Ren'Py project\n", encoding="utf-8")

            resolved_project, resolved_game, launcher, version = install.install(project_root)

            self.assertEqual(resolved_project, project_root)
            self.assertEqual(resolved_game, game_root)
            self.assertEqual(version, "0.1.0-alpha")
            self.assertTrue(launcher.exists())
            self.assertTrue(os.access(launcher, os.X_OK))
            self.assertTrue((project_root / ".scene-node-editor" / "EDITOR" / "app.py").exists())
            self.assertTrue((game_root / "FRAMEWORK" / "runtime.rpy").exists())
            self.assertTrue((game_root / "FRAMEWORK" / "option_renderer.rpy").exists())
            self.assertFalse((game_root / "FRAMEWORK" / "runtime_test.rpy").exists())

            launcher_source = launcher.read_text(encoding="utf-8")
            self.assertNotIn(str(ROOT), launcher_source)
            self.assertNotIn(str(project_root), launcher_source)
            syntax_environment = dict(os.environ)
            syntax_environment["SCENE_EDITOR_PORT"] = "8765"
            subprocess.run(["zsh", "-n", str(launcher)], check=True, env=syntax_environment)

            custom_stats = {
                "stat_friend": {
                    "Name": "朋友測試數值",
                    "Min": 0,
                    "Max": 10,
                    "Init": 3,
                }
            }
            stats_file = game_root / "DATA" / "Stats.json"
            stats_file.write_text(
                json.dumps(custom_stats, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            content_marker = game_root / "SCENENODE" / "keep" / "creator-data.txt"
            content_marker.parent.mkdir(parents=True)
            content_marker.write_text("preserve me\n", encoding="utf-8")

            install.install(game_root)

            self.assertEqual(json.loads(stats_file.read_text(encoding="utf-8")), custom_stats)
            self.assertEqual(content_marker.read_text(encoding="utf-8"), "preserve me\n")

            manifest = json.loads(
                (project_root / ".scene-node-editor" / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["version"], "0.1.0-alpha")
            self.assertEqual(manifest["managed_runtime_files"], list(install.RUNTIME_FILES))

            port = self.available_port()
            editor_app = project_root / ".scene-node-editor" / "EDITOR" / "app.py"
            environment = dict(os.environ)
            environment["PYTHONPYCACHEPREFIX"] = str(Path(temporary) / "pycache")
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(editor_app),
                    "--project",
                    str(game_root),
                    "--port",
                    str(port),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=environment,
            )
            try:
                project_data = self.wait_for_project(port, process)
                self.assertEqual(project_data["projectName"], "game")
                self.assertEqual(project_data["stats"], custom_stats)
                self.assertEqual(project_data["nodes"], [])
                self.assertEqual(project_data["issues"], [])
            finally:
                process.terminate()
                process.communicate(timeout=5)

    @staticmethod
    def available_port():
        with socket.socket() as handle:
            handle.bind(("127.0.0.1", 0))
            return handle.getsockname()[1]

    @staticmethod
    def wait_for_project(port, process):
        url = "http://127.0.0.1:{}/api/project".format(port)
        for _attempt in range(50):
            if process.poll() is not None:
                stdout, stderr = process.communicate()
                raise AssertionError("Editor stopped early:\n{}\n{}".format(stdout, stderr))
            try:
                with urllib.request.urlopen(url, timeout=0.2) as response:
                    return json.loads(response.read().decode("utf-8"))
            except OSError:
                time.sleep(0.05)
        raise AssertionError("Editor did not become ready: {}".format(url))


if __name__ == "__main__":
    unittest.main()
