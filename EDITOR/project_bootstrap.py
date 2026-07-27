"""Safe first-run setup for a Scene Node Ren'Py project."""

import datetime
import json
import os
import re
import shutil
from pathlib import Path


PROJECT_CONFIG_RELATIVE = Path("DATA") / "SceneProject.json"
MEMORIES_RELATIVE = Path("DATA") / "Memories.json"
GLOBAL_NODE_DIRECTORY = "GLOBALNODE"
GLOBAL_NODE_ID = "__global__"
ROOT_NODE_PATH = "root"
ROOT_NODE_ID = "root"
DEFAULT_MEMORY_ID = "memory"
START_MARKER = "# scene-node-editor: root-start"

START_LABEL_RE = re.compile(r"^label\s+start\s*(?:\([^)]*\))?\s*:", re.MULTILINE)
RUNTIME_CALL_RE = re.compile(
    r"\bcall\s+scene_runtime_start\s*\(\s*(?:(['\"])(.*?)\1)?\s*\)",
    re.MULTILINE,
)
TECHNICAL_ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
KNOWN_BLANK_START_MARKERS = (
    "You've created a new Ren'Py game.",
    "You have created a new Ren'Py game.",
)
TEMPLATE_SCENE_RE = re.compile(r"^scene\s+bg\s+room\s*$")
TEMPLATE_SPRITE_RE = re.compile(r"^show\s+eileen\s+happy\s*$")
TEMPLATE_DIALOGUE_RE = re.compile(r"^e\s+(?:[rRuUbBfF]*)(?:\".*\"|'.*')\s*$")
TEMPLATE_CHARACTER_RE = re.compile(r"^\s*define\s+e\s*=\s*Character\s*\(", re.MULTILINE)


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(str(temporary), str(path))


def write_json(path, data):
    atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def default_project_config(root_node=ROOT_NODE_ID):
    return {"Version": 1, "Root Node": root_node}


def default_memories():
    return {DEFAULT_MEMORY_ID: {"Name": "Memory"}}


def default_root_node(root_node=ROOT_NODE_ID):
    return {
        "ID": root_node,
        "Name": "ROOT",
    }


def default_global_node():
    return {
        "ID": GLOBAL_NODE_ID,
        "Name": "GLOBAL",
    }


def default_options():
    return {
        "Version": 1,
        "Canvas": {"Width": 1920, "Height": 1080, "Preview Background": ""},
        "Elements": [],
    }


def runtime_start_calls(game_root):
    no_argument = False
    explicit_nodes = []
    for path in Path(game_root).rglob("*.rpy"):
        try:
            source = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in source.splitlines():
            if line.lstrip().startswith("#"):
                continue
            for match in RUNTIME_CALL_RE.finditer(line):
                node_id = match.group(2)
                if node_id is None:
                    no_argument = True
                else:
                    explicit_nodes.append(node_id)
    return {"configured": no_argument, "explicitNodes": explicit_nodes}


def _start_label_bounds(source):
    lines = source.splitlines(keepends=True)
    start = next((index for index, line in enumerate(lines) if START_LABEL_RE.match(line)), None)
    if start is None:
        return lines, None, None
    end = len(lines)
    for index in range(start + 1, len(lines)):
        stripped = lines[index].strip()
        if stripped and not lines[index][0].isspace():
            end = index
            break
    return lines, start, end


def _is_localized_renpy_template(source, meaningful):
    if not TEMPLATE_CHARACTER_RE.search(source):
        return False
    if len(meaningful) not in (4, 5) or meaningful[-1] != "return":
        return False
    if not TEMPLATE_SCENE_RE.fullmatch(meaningful[0]):
        return False
    if not TEMPLATE_SPRITE_RE.fullmatch(meaningful[1]):
        return False
    return all(TEMPLATE_DIALOGUE_RE.fullmatch(line) for line in meaningful[2:-1])


def _safe_blank_start(source, start, end):
    body = "".join(source.splitlines(keepends=True)[start + 1:end])
    meaningful = [
        line.strip()
        for line in body.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    marker_only_template = bool(
        len(meaningful) == 2
        and meaningful[-1] == "return"
        and any(marker in meaningful[0] for marker in KNOWN_BLANK_START_MARKERS)
    )
    return (
        not meaningful
        or all(line in ("pass", "return") for line in meaningful)
        or marker_only_template
        or _is_localized_renpy_template(source, meaningful)
    )


def _backup_script(game_root, script_path):
    backup_root = Path(game_root) / ".scene-node-backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup = backup_root / f"script.rpy.{stamp}.bak"
    shutil.copy2(script_path, backup)
    return backup


def connect_root_script(game_root):
    game_root = Path(game_root)
    calls = runtime_start_calls(game_root)
    if calls["configured"] or calls["explicitNodes"]:
        return {"status": "connected", "backup": None}

    start_files = []
    for path in game_root.rglob("*.rpy"):
        try:
            if START_LABEL_RE.search(path.read_text(encoding="utf-8")):
                start_files.append(path)
        except OSError:
            continue

    script_path = game_root / "script.rpy"
    source = script_path.read_text(encoding="utf-8") if script_path.exists() else ""
    block = f"{START_MARKER}\nlabel start:\n    call scene_runtime_start()\n    return\n"
    if not start_files:
        separator = "" if not source.strip() else "\n\n"
        atomic_write(script_path, source.rstrip() + separator + block)
        return {"status": "connected", "backup": None}

    if start_files != [script_path]:
        return {"status": "manual", "backup": None}
    lines, start, end = _start_label_bounds(source)
    if start is None or not _safe_blank_start(source, start, end):
        return {"status": "manual", "backup": None}
    backup = _backup_script(game_root, script_path)
    replacement = [block]
    atomic_write(script_path, "".join(lines[:start] + replacement + lines[end:]).rstrip() + "\n")
    return {"status": "connected", "backup": str(backup)}


def initialize_scene_project(game_root, connect_script=True):
    game_root = Path(game_root)
    for directory in ("DATA", "SCENENODE", GLOBAL_NODE_DIRECTORY):
        (game_root / directory).mkdir(parents=True, exist_ok=True)
    memories_path = game_root / MEMORIES_RELATIVE
    if not memories_path.exists():
        write_json(memories_path, default_memories())

    global_node = game_root / GLOBAL_NODE_DIRECTORY
    (global_node / "EVENTPOOL").mkdir(parents=True, exist_ok=True)
    (global_node / "CONTENT").mkdir(parents=True, exist_ok=True)
    if not (global_node / "Node.json").exists():
        write_json(global_node / "Node.json", default_global_node())

    nodes = list((game_root / "SCENENODE").rglob("Node.json"))
    config_path = game_root / PROJECT_CONFIG_RELATIVE
    if nodes:
        configured_root_exists = False
        if config_path.exists():
            try:
                config = json.loads(config_path.read_text(encoding="utf-8"))
                configured = str(config.get("Root Node") or "").strip()
                node_ids = {
                    str(json.loads(path.read_text(encoding="utf-8")).get("ID") or "").strip()
                    for path in nodes
                }
                configured_root_exists = bool(
                    TECHNICAL_ID_RE.fullmatch(configured) and configured in node_ids
                )
            except (OSError, json.JSONDecodeError, AttributeError):
                configured_root_exists = False
        script_result = (
            connect_root_script(game_root)
            if connect_script and configured_root_exists
            else {"status": "manual", "backup": None}
        )
        return {
            "createdRoot": False,
            "rootNodeId": None,
            "scriptStatus": script_result["status"],
            "backup": script_result["backup"],
        }

    root_node = ROOT_NODE_ID
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            configured = str(config.get("Root Node") or "").strip()
            if not TECHNICAL_ID_RE.fullmatch(configured):
                return {"createdRoot": False, "rootNodeId": None, "scriptStatus": "invalid-config", "backup": None}
            root_node = configured
        except (OSError, json.JSONDecodeError, AttributeError):
            return {"createdRoot": False, "rootNodeId": None, "scriptStatus": "invalid-config", "backup": None}

    root = game_root / "SCENENODE" / ROOT_NODE_PATH
    (root / "EVENTPOOL").mkdir(parents=True, exist_ok=True)
    (root / "CONTENT").mkdir(parents=True, exist_ok=True)
    if not (root / "Node.json").exists():
        write_json(root / "Node.json", default_root_node(root_node))
    if not (root / "Options.json").exists():
        write_json(root / "Options.json", default_options())
    if not config_path.exists():
        write_json(config_path, default_project_config(root_node))

    script_result = connect_root_script(game_root) if connect_script else {"status": "manual", "backup": None}
    return {
        "createdRoot": True,
        "rootNodeId": root_node,
        "scriptStatus": script_result["status"],
        "backup": script_result["backup"],
    }
