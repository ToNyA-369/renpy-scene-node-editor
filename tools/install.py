#!/usr/bin/env python3
"""Install Scene Node Editor into an existing Ren'Py project."""

import argparse
import datetime
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
EDITOR_SOURCE = PACKAGE_ROOT / "EDITOR"
FRAMEWORK_SOURCE = PACKAGE_ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK"
VERSION_FILE = PACKAGE_ROOT / "VERSION"
RUNTIME_FILES = ("runtime.rpy", "option_renderer.rpy")
PROJECT_MARKERS = ("options.rpy", "gui.rpy", "script.rpy")
PROJECT_LAUNCHER = "啟動 Scene Node 編輯器.command"


class InstallError(Exception):
    pass


def resolve_project(raw_target):
    target = Path(raw_target).expanduser().resolve()
    if not target.exists() or not target.is_dir():
        raise InstallError("找不到選擇的資料夾。")

    if target.name.casefold() == "game":
        project_root = target.parent
        game_root = target
    else:
        project_root = target
        game_root = target / "game"

    if not game_root.exists() or not game_root.is_dir():
        raise InstallError("請選擇 Ren'Py 專案資料夾，或專案裡的 game 資料夾。")
    if not any((game_root / marker).exists() for marker in PROJECT_MARKERS):
        raise InstallError("選擇的 game 資料夾看起來不是 Ren'Py 專案。")
    return project_root, game_root


def ignored_editor_files(_directory, names):
    ignored = []
    for name in names:
        if name in {"__pycache__", ".DS_Store"} or name.endswith((".pyc", ".pyo", ".tmp")):
            ignored.append(name)
    return ignored


def project_launcher_source():
    return """#!/bin/zsh

set -e

PROJECT_DIR="${0:A:h}"
EDITOR_APP="$PROJECT_DIR/.scene-node-editor/EDITOR/app.py"

if [[ ! -f "$EDITOR_APP" ]]; then
  echo "找不到 Scene Node Editor，請重新執行安裝器。"
  read "?按 Enter 關閉..."
  exit 1
fi

if [[ -n "${SCENE_EDITOR_PORT:-}" ]]; then
  PORT="$SCENE_EDITOR_PORT"
else
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
fi

python3 "$EDITOR_APP" --project "$PROJECT_DIR/game" --port "$PORT" &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

for _attempt in {1..40}; do
  if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/', timeout=.2).close()" >/dev/null 2>&1; then
    break
  fi
  sleep .1
done

open "http://127.0.0.1:$PORT/"
wait "$SERVER_PID"
"""


def install(raw_target):
    project_root, game_root = resolve_project(raw_target)

    for source in (EDITOR_SOURCE, FRAMEWORK_SOURCE):
        if not source.exists():
            raise InstallError("安裝包不完整：缺少 {}。".format(source.relative_to(PACKAGE_ROOT)))
    for filename in RUNTIME_FILES:
        if not (FRAMEWORK_SOURCE / filename).exists():
            raise InstallError("安裝包不完整：缺少 FRAMEWORK/{}。".format(filename))

    install_root = project_root / ".scene-node-editor"
    installed_editor = install_root / "EDITOR"
    installed_framework = game_root / "FRAMEWORK"

    install_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        EDITOR_SOURCE,
        installed_editor,
        dirs_exist_ok=True,
        ignore=ignored_editor_files,
    )

    installed_framework.mkdir(parents=True, exist_ok=True)
    for filename in RUNTIME_FILES:
        shutil.copy2(FRAMEWORK_SOURCE / filename, installed_framework / filename)

    for directory in ("DATA", "SCENENODE", "SCENESCREEN"):
        (game_root / directory).mkdir(parents=True, exist_ok=True)
    stats_file = game_root / "DATA" / "Stats.json"
    if not stats_file.exists():
        stats_file.write_text("{}\n", encoding="utf-8")

    version = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else "development"
    manifest = {
        "name": "Scene Node Editor",
        "version": version,
        "installed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "managed_runtime_files": list(RUNTIME_FILES),
    }
    (install_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    launcher = project_root / PROJECT_LAUNCHER
    launcher.write_text(project_launcher_source(), encoding="utf-8")
    launcher.chmod(0o755)
    return project_root, game_root, launcher, version


def parse_args():
    parser = argparse.ArgumentParser(description="Install Scene Node Editor into a Ren'Py project")
    parser.add_argument("target", help="Ren'Py project root or its game directory")
    parser.add_argument("--launch", action="store_true", help="Open the installed editor after installation")
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        project_root, game_root, launcher, version = install(args.target)
    except InstallError as exc:
        print("安裝失敗：{}".format(exc), file=sys.stderr)
        return 1

    print("Scene Node Editor {} 安裝完成。".format(version))
    print("Ren'Py 專案：{}".format(project_root))
    print("內容資料夾：{}".format(game_root))
    print("啟動器：{}".format(launcher))

    if args.launch:
        if platform.system() != "Darwin":
            print("目前只有 macOS 支援自動開啟，請手動執行啟動器。")
        else:
            subprocess.Popen(["open", str(launcher)])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
