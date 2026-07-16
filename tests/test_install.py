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
            project_config = game_root / "DATA" / "SceneProject.json"
            self.assertEqual(
                json.loads(project_config.read_text(encoding="utf-8")),
                {"Version": 1, "Root Node": "root"},
            )
            memories_file = game_root / "DATA" / "Memories.json"
            self.assertEqual(
                json.loads(memories_file.read_text(encoding="utf-8")),
                {"memory": {"Name": "Memory"}},
            )
            root_node = game_root / "SCENENODE" / "root"
            self.assertTrue((root_node / "Node.json").exists())
            self.assertTrue((root_node / "Options.json").exists())
            self.assertTrue((root_node / "SCENEOPTION.rpy").exists())
            self.assertTrue((root_node / "EVENTPOOL").is_dir())
            self.assertTrue((root_node / "CONTENT").is_dir())
            script_source = (game_root / "script.rpy").read_text(encoding="utf-8")
            self.assertIn("# scene-node-editor: root-start", script_source)
            self.assertIn("call scene_runtime_start()", script_source)

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
            custom_memories = {
                "memory": {"Name": "Memory"},
                "chapter": {"Name": "章節記憶"},
            }
            memories_file.write_text(
                json.dumps(custom_memories, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

            install.install(game_root)

            self.assertEqual(json.loads(stats_file.read_text(encoding="utf-8")), custom_stats)
            self.assertEqual(content_marker.read_text(encoding="utf-8"), "preserve me\n")
            self.assertEqual(json.loads(memories_file.read_text(encoding="utf-8")), custom_memories)
            self.assertEqual(
                json.loads(project_config.read_text(encoding="utf-8")),
                {"Version": 1, "Root Node": "root"},
            )
            self.assertEqual(
                (game_root / "script.rpy").read_text(encoding="utf-8").count("call scene_runtime_start()"),
                1,
            )

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
                self.assertEqual(project_data["memories"], custom_memories)
                self.assertEqual(project_data["rootNodeId"], "root")
                self.assertEqual(len(project_data["nodes"]), 1)
                self.assertEqual(project_data["nodes"][0]["id"], "root")
                self.assertTrue(project_data["nodes"][0]["isRoot"])
                self.assertEqual(project_data["issues"], [])

                updated_memories = dict(custom_memories)
                updated_memories["daily"] = {"Name": "每日記憶"}
                state_data = self.request_json(
                    port,
                    "/api/state",
                    method="PUT",
                    payload={"stats": custom_stats, "memories": updated_memories},
                )
                self.assertEqual(state_data["memories"], updated_memories)
                self.assertEqual(json.loads(memories_file.read_text(encoding="utf-8")), updated_memories)
            finally:
                process.terminate()
                process.communicate(timeout=5)

    def test_custom_start_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="scene-node-editor-custom-") as temporary:
            project_root = (Path(temporary) / "CustomStart").resolve()
            game_root = project_root / "game"
            game_root.mkdir(parents=True)
            (game_root / "options.rpy").write_text("# options\n", encoding="utf-8")
            (game_root / "gui.rpy").write_text("# gui\n", encoding="utf-8")
            custom_script = 'label start:\n    "保留我的開場"\n    return\n'
            (game_root / "script.rpy").write_text(custom_script, encoding="utf-8")

            install.install(project_root)

            self.assertEqual((game_root / "script.rpy").read_text(encoding="utf-8"), custom_script)
            self.assertTrue((game_root / "SCENENODE" / "root" / "Node.json").exists())
            self.assertEqual(
                json.loads((game_root / "DATA" / "SceneProject.json").read_text(encoding="utf-8"))["Root Node"],
                "root",
            )

    def test_edited_default_start_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="scene-node-editor-edited-default-") as temporary:
            project_root = (Path(temporary) / "EditedDefault").resolve()
            game_root = project_root / "game"
            game_root.mkdir(parents=True)
            (game_root / "options.rpy").write_text("# options\n", encoding="utf-8")
            (game_root / "gui.rpy").write_text("# gui\n", encoding="utf-8")
            edited_script = '''label start:
    "You've created a new Ren'Py game."
    "這是我新增的開場內容。"
    return
'''
            (game_root / "script.rpy").write_text(edited_script, encoding="utf-8")

            install.install(project_root)

            self.assertEqual((game_root / "script.rpy").read_text(encoding="utf-8"), edited_script)
            self.assertFalse((game_root / ".scene-node-backups").exists())

    def test_known_blank_start_is_backed_up_and_connected(self):
        with tempfile.TemporaryDirectory(prefix="scene-node-editor-blank-start-") as temporary:
            project_root = (Path(temporary) / "BlankStart").resolve()
            game_root = project_root / "game"
            game_root.mkdir(parents=True)
            (game_root / "options.rpy").write_text("# options\n", encoding="utf-8")
            (game_root / "gui.rpy").write_text("# gui\n", encoding="utf-8")
            blank_script = 'label start:\n    "You\'ve created a new Ren\'Py game."\n    return\n'
            (game_root / "script.rpy").write_text(blank_script, encoding="utf-8")

            install.install(project_root)

            script_source = (game_root / "script.rpy").read_text(encoding="utf-8")
            self.assertIn("call scene_runtime_start()", script_source)
            backups = list((game_root / ".scene-node-backups").glob("script.rpy.*.bak"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(encoding="utf-8"), blank_script)

    def test_localized_template_is_connected_when_root_already_exists(self):
        with tempfile.TemporaryDirectory(prefix="scene-node-editor-localized-start-") as temporary:
            project_root = (Path(temporary) / "LocalizedStart").resolve()
            game_root = project_root / "game"
            game_root.mkdir(parents=True)
            (game_root / "options.rpy").write_text("# options\n", encoding="utf-8")
            (game_root / "gui.rpy").write_text("# gui\n", encoding="utf-8")
            localized_script = '''# 遊戲腳本放在這個檔案中。

define e = Character("艾琳")

label start:
    # 顯示 Ren'Py 預設的背景與角色立繪。
    scene bg room
    show eileen happy

    e "您已經建立了一個新的 Ren'Py 遊戲。"
    e "加入故事、圖片和音樂後，就可以發佈了！"

    return
'''
            (game_root / "script.rpy").write_text(localized_script, encoding="utf-8")
            existing_root = game_root / "SCENENODE" / "root"
            existing_root.mkdir(parents=True)
            (existing_root / "Node.json").write_text(
                '{"ID": "root", "Name": "ROOT"}\n',
                encoding="utf-8",
            )
            config_file = game_root / "DATA" / "SceneProject.json"
            config_file.parent.mkdir(parents=True)
            config_file.write_text('{"Version": 1, "Root Node": "root"}\n', encoding="utf-8")

            install.install(project_root)

            script_source = (game_root / "script.rpy").read_text(encoding="utf-8")
            self.assertIn("call scene_runtime_start()", script_source)
            self.assertNotIn("show eileen happy", script_source)
            backups = list((game_root / ".scene-node-backups").glob("script.rpy.*.bak"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(encoding="utf-8"), localized_script)

    def test_existing_project_without_root_config_is_not_rewired(self):
        with tempfile.TemporaryDirectory(prefix="scene-node-editor-no-root-config-") as temporary:
            project_root = (Path(temporary) / "NoRootConfig").resolve()
            game_root = project_root / "game"
            game_root.mkdir(parents=True)
            (game_root / "options.rpy").write_text("# options\n", encoding="utf-8")
            (game_root / "gui.rpy").write_text("# gui\n", encoding="utf-8")
            template_script = '''define e = Character("艾琳")

label start:
    scene bg room
    show eileen happy
    e "預設台詞一"
    e "預設台詞二"
    return
'''
            (game_root / "script.rpy").write_text(template_script, encoding="utf-8")
            existing_node = game_root / "SCENENODE" / "legacy"
            existing_node.mkdir(parents=True)
            (existing_node / "Node.json").write_text(
                '{"ID": "legacy", "Name": "既有節點"}\n',
                encoding="utf-8",
            )

            install.install(project_root)

            self.assertEqual((game_root / "script.rpy").read_text(encoding="utf-8"), template_script)
            self.assertFalse((game_root / "DATA" / "SceneProject.json").exists())
            self.assertFalse((game_root / ".scene-node-backups").exists())

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

    @staticmethod
    def request_json(port, path, method="GET", payload=None):
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            "http://127.0.0.1:{}{}".format(port, path),
            data=data,
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            return json.loads(response.read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
