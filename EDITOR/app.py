#!/usr/bin/env python3
"""Local browser editor for the Scene Node authoring format."""

import argparse
import datetime
import json
import mimetypes
import os
import re
import secrets
import shutil
import threading
from contextlib import contextmanager
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlparse

from project_bootstrap import (
    DEFAULT_MEMORY_ID,
    GLOBAL_NODE_DIRECTORY,
    GLOBAL_NODE_ID,
    MEMORIES_RELATIVE,
    PROJECT_CONFIG_RELATIVE,
    initialize_scene_project,
    runtime_start_calls,
)


EDITOR_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = EDITOR_ROOT / "static"
PROJECT_ROOT = EDITOR_ROOT.parent

DATA_DIR = "DATA"
NODE_DIR = "SCENENODE"
EVENT_DIR = "EVENTPOOL"
DEFAULT_EVENT_GROUP = "Normal"
DEFAULT_CONDITION_CLAUSE = "and_1"
CONTENT_DIR = "CONTENT"
OPTIONS_FILE = "Options.json"
TEXTBOX_PROFILE_DIR = "TEXTBOX_PROFILES"
TEXTBOX_PROFILE_VERSION = 1
GLOBAL_NODE_PATH = "@global"
EDITOR_SETTINGS_FILE = "settings.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".avif"}
AUDIO_EXTENSIONS = {".opus", ".ogg", ".mp3", ".mp2", ".flac", ".wav"}
UNDO_HISTORY_LIMIT = 100

_UNDO_HISTORY = []
_UNDO_LOCK = threading.RLock()
_UNDO_LOCAL = threading.local()

LABEL_RE = re.compile(r"^\s*label\s+([A-Za-z_][A-Za-z0-9_.]*)\s*:", re.MULTILINE)
DISPLAY_NAME_RE = re.compile(r"^\s*#\s*@display_name:\s*(.+?)\s*$", re.MULTILINE)
KEYBOARD_KEYSYM_RE = re.compile(
    r"^(?:(?:alt|meta|ctrl|osctrl|anymod|shift|noshift|caps|nocaps|num|nonum|repeat|anyrepeat|keydown|keyup)_)*"
    r"(?:K_[A-Za-z0-9_]+|KP_[A-Za-z0-9_]+|[^\s])$"
)
MOUSE_TRIGGER_VALUES = {"Left", "Middle", "Right", "WheelUp", "WheelDown"}
AUTO_TRIGGER_PHASES = {"Enter", "Node", "Exit"}
LIFECYCLE_TRIGGERS = {"Auto:Enter", "Auto:Exit"}
CONDITION_OPERATORS = {
    "stat": (">", ">=", "<", "<=", "==", "!="),
    "memory": ("has", "not_has"),
}
EFFECT_OPERATORS = {
    "stat": ("set", "+", "-", "*", "/"),
    "memory": ("add", "remove", "clear"),
    "option": ("enable", "disable"),
}
OPTION_AVAILABILITY_VALUES = ("ALWAYS", "CONTROLLED")
OPTION_EFFECT_TARGETS = ("element", "item")
TEXTBOX_STYLE_DEFAULTS = {
    "Background": "#0b1118",
    "Item Background": "#20302a",
    "Text Color": "#ffffff",
    "Text Size": 30,
    "Text Align": 0.5,
}
TEXTBOX_FEATURE_DEFAULTS = {
    "hover_accent": {"Enabled": False, "Color": "#5c7265", "Width": 6},
    "hover_text_color": {"Enabled": False, "Color": "#ffffff"},
    "item_border": {"Enabled": False, "Color": "#ffffff33", "Width": 1},
    "text_shadow": {"Enabled": False, "Color": "#00000088", "Size": 2, "X": 0, "Y": 2},
    "text_outline": {"Enabled": False, "Color": "#000000cc", "Size": 1},
    "staggered_entrance": {"Enabled": False, "Distance": 18, "Delay": 0.04, "Duration": 0.22},
}

PYTHON_EN_DICTIONARY = {
    "Editor 設定必須是 object。": "Editor settings must be an object.",
    "快捷鍵設定必須是 object。": "Shortcut settings must be an object.",
    "語言設定不合法，僅支援 zh-Hant 與 en。": "Invalid language setting, only zh-Hant and en are supported.",
    "尚未設定 Root Node。": "Root Node is not configured.",
    "找不到 Root Node：{root_node}。": "Root Node not found: {root_node}.",
    "Root Node 尚未連接到 scene_runtime_start()。": "Root Node is not connected to scene_runtime_start().",
    "Global Node ID 必須固定為 {id}。": "Global Node ID must be fixed as {id}.",
    "Scene Node 不可使用保留 ID：{id}。": "Scene Node cannot use reserved ID: {id}.",
    "Node ID {node_id} 重複。": "Duplicate Node ID: {node_id}.",
    "選項 Trigger {trigger} 沒有對應的 Event。": "Option Trigger {trigger} has no corresponding Event.",
    "檔名與 Event ID 不一致。": "Filename does not match Event ID.",
    "找不到 Stat：{id}。": "Stat not found: {id}.",
    "找不到記憶庫：{bank}。": "Memory bank not found: {bank}.",
    "找不到 Option Effect 目標：{target}。": "Option Effect target not found: {target}.",
    "Option Effect 目標必須設為 CONTROLLED：{target}。": "Option Effect target must be set to CONTROLLED: {target}.",
    "找不到 Content label：{label}。": "Content label not found: {label}.",
    "找不到 Next Node：{target}。": "Next Node not found: {target}.",
    "找不到 Content 文件。": "Content file not found.",
    "找不到指定的 Global Node。": "Specified Global Node not found.",
    "找不到指定的 Scene Node。": "Specified Scene Node not found.",
    "找不到指定的 authoring scope。": "Specified authoring scope not found.",
    "這個 ID 或路徑保留給 Global Node。": "This ID or path is reserved for Global Node.",
    "這個 Scene Node 路徑已經存在。": "This Scene Node path already exists.",
    "找不到 API。": "API not found.",
    "請求內容不是有效的 JSON。": "Request body is not valid JSON.",
    "Content-Length 不合法。": "Invalid Content-Length.",
    "名稱不可為空，也不可包含路徑符號。": "Name cannot be empty or contain path separators.",
    "Scene Node 路徑不可為空。": "Scene Node path cannot be empty.",
    "Scene Node 路徑不合法。": "Invalid Scene Node path.",
    "資源路徑不合法。": "Invalid asset path.",
    "Stats 必須是 JSON object。": "Stats must be a JSON object.",
    "Memories 必須是 JSON object。": "Memories must be a JSON object.",
    "無法讀取 {name}: {exc}": "Failed to read {name}: {exc}",
    "{field} 必須是數字。": "{field} must be a number.",
    "{field} 的值": "{field} value",
    "{field} 不可小於 {minimum}。": "{field} cannot be less than {minimum}.",
    "{field} 不可大於 {maximum}。": "{field} cannot be greater than {maximum}.",
    "{field} 的 Stat 判斷不合法。": "{field} stat operator is invalid.",
    "{field} 的記憶標籤不可為空。": "{field} memory tag cannot be empty.",
    "{field} 的記憶判斷不合法。": "{field} memory operator is invalid.",
    "{field} 的類型不合法：{condition_type}。": "{field} type is invalid: {condition_type}.",
    "{field} 的類型不合法：{effect_type}。": "{field} type is invalid: {effect_type}.",
    "{field} 的 Stat 操作不合法。": "{field} stat operation is invalid.",
    "{field} 的記憶操作不合法。": "{field} memory operation is invalid.",
    "{field} 的 Option 操作不合法。": "{field} option operation is invalid.",
    "{field} 的 Option 目標層級不合法。": "{field} option target scope is invalid.",
    "{field} 必須是 ALWAYS 或 CONTROLLED。": "{field} must be ALWAYS or CONTROLLED.",
    "Text Box Item 必須是 object。": "Text Box Item must be an object.",
    "Text Box Item {item_id} 的 Trigger 不可為空。": "Text Box Item {item_id} Trigger cannot be empty.",
    "Option Element 必須是 object。": "Option Element must be an object.",
    "Option Element {element_id} 的 Type 不合法。": "Option Element {element_id} Type is invalid.",
    "Text Box {element_id} 內有重複的 Item ID。": "Text Box {element_id} contains duplicate Item IDs.",
    "Picture {element_id} 的 Trigger 不可為空。": "Picture {element_id} Trigger cannot be empty.",
    "Hitbox {element_id} 的 Trigger 不可為空。": "Hitbox {element_id} Trigger cannot be empty.",
    "Options.json 必須是 object。": "Options.json must be an object.",
    "Options.json 內有重複的 Element ID。": "Options.json contains duplicate Element IDs.",
    "Textbox 外觀設定檔必須是 object。": "Textbox appearance profile must be an object.",
    "Textbox 外觀設定檔 {profile_id} 的檔名與 ID 不一致。": "Textbox appearance profile {profile_id} filename does not match its ID.",
    "Textbox 外觀設定檔 {profile_id} 已經存在。": "Textbox appearance profile {profile_id} already exists.",
    "找不到 Textbox 外觀設定檔：{profile_id}。": "Textbox appearance profile not found: {profile_id}.",
    "Textbox 外觀設定檔 {profile_id} 仍被 {count} 個 Textbox 使用。": "Textbox appearance profile {profile_id} is still used by {count} Textbox element(s).",
    "Textbox 外觀設定檔名稱不可為空。": "Textbox appearance profile name cannot be empty.",
    "Textbox 外觀設定檔含有不支援的特性：{feature_id}。": "Textbox appearance profile contains an unsupported feature: {feature_id}.",
    "Textbox 外觀設定檔排序必須是陣列。": "Textbox appearance profile order must be an array.",
    "Textbox 外觀設定檔排序必須包含所有設定檔。": "Textbox appearance profile order must contain every profile.",
    "Option {name} 仍被 {count} 個 Event Effect 引用。": "Option {name} is still referenced by {count} Event Effects.",
    "Stat {stat_id} 的設定必須是 object。": "Stat {stat_id} settings must be an object.",
    "Stat {stat_id} 的 Min、Max、Init 必須是數字。": "Stat {stat_id} Min, Max, and Init must be numbers.",
    "Stat {stat_id} 的 Min 不可大於 Max。": "Stat {stat_id} Min cannot be greater than Max.",
    "Stat {stat_id} 的 Init 必須位於 Min 與 Max 之間。": "Stat {stat_id} Init must be between Min and Max.",
    "記憶庫 {bank_id} 的設定必須是 object。": "Memory bank {bank_id} settings must be an object.",
    "記憶庫 {bank_id} 的名稱不可為空。": "Memory bank {bank_id} name cannot be empty.",
    "不可移除預設 Memory 記憶庫。": "Cannot remove default Memory bank.",
    "{field} 名稱不可為空。": "{field} name cannot be empty.",
    "{field} 必須是 null、字串或非空權重表。": "{field} must be null, a string, or a non-empty weight map.",
    "{field} 的權重必須大於 0。": "{field} weight must be greater than 0.",
    "Event Trigger 不可為空。": "Event Trigger cannot be empty.",
    "Event Trigger 必須使用 Source:Value 格式。": "Event Trigger must use Source:Value format.",
    "Event Trigger 來源不合法：{source}。": "Event Trigger source is invalid: {source}.",
    "{source} Trigger 不可為空。": "{source} Trigger cannot be empty.",
    "Auto Trigger 不合法：{payload}。": "Auto Trigger is invalid: {payload}.",
    "Keyboard Trigger 必須是有效的 Ren'Py keysym。": "Keyboard Trigger must be a valid Ren'Py keysym.",
    "Mouse Trigger 不合法：{payload}。": "Mouse Trigger is invalid: {payload}.",
    "Event 必須是 JSON object。": "Event must be a JSON object.",
    "Priority 必須是 0 到 5 的整數。": "Priority must be an integer between 0 and 5.",
    "Weight 必須大於 0。": "Weight must be greater than 0.",
    "Event 群組名稱不可超過 80 個字元。": "Event group names cannot exceed 80 characters.",
    "Event 群組指派必須是非空 object。": "Event group assignments must be a non-empty object.",
    "找不到 Event：{id}。": "Event not found: {id}.",
    "{field} 必須是非負整數。": "{field} must be a non-negative integer.",
    "Event 排序必須包含目前作用域的所有 Events。": "Event order must contain every Event in the current scope.",
    "Normal 是固定的預設 Event 群組。": "Normal is the fixed default Event group.",
    "Conditions 必須是 object 陣列。": "Conditions must be an array of objects.",
    "Condition clause 必須是 null 或不超過 80 個字元的字串。": "Condition clause must be null or a string of at most 80 characters.",
    "Effects 必須是 object 陣列。": "Effects must be an array of objects.",
    "Option Effect 只能控制同一個 Options 作用域內的 Option。": "Option Effect can only control Options in the same Options scope.",
    "End up 必須是 REDO、GOTO、REPLACE 或 EXIT。": "End up must be REDO, GOTO, REPLACE, or EXIT.",
    "{end_up} Event 必須設定 Next Node。": "{end_up} Event must set Next Node.",
    "找不到要設為 Root 的 Scene Node。": "Scene Node to set as Root not found.",
    "Scene Node 排序必須是陣列。": "Scene Node order must be an array.",
    "Scene Node 排序必須包含所有 Scene Nodes。": "Scene Node order must contain every Scene Node.",
    "Scene Node 群組名稱不可超過 80 個字元。": "Scene Node group names cannot exceed 80 characters.",
    "Scene Node 群組指派必須是 object。": "Scene Node group assignments must be an object.",
    "找不到 Scene Node：{path}。": "Scene Node not found: {path}.",
    "新的 Event ID 已經存在。": "New Event ID already exists.",
    "這個 Event ID 已經存在。": "This Event ID already exists.",
    "Content 內容必須是文字。": "Content body must be text.",
    "Content 名稱已經存在。": "Content name already exists.",
    "Content 排序必須是陣列。": "Content order must be an array.",
    "Content 排序必須包含目前作用域的所有文件。": "Content order must contain every file in the current scope.",
    "Global Node 是固定的全局作用域，不可刪除。": "Global Node is a fixed global scope and cannot be deleted.",
    "仍有 {count} 個 Event 指向這個節點。": "There are still {count} Events pointing to this node.",
    "請先將其他 Scene Node 設為 Root，才能刪除目前的起始節點。": "Please set another Scene Node as Root before deleting current root node.",
    "找不到要刪除的文件。": "File to delete not found.",
    "無法存取這個路徑。": "Cannot access this path.",
    "無法存取這個資源。": "Cannot access this asset.",
    "資源路徑不可為空。": "Asset path cannot be empty.",
    "找不到圖片資源。": "Image asset not found.",
    "沒有可以返回的上一步。": "There is no previous change to undo.",
    "無法返回上一步：{exc}": "Unable to undo the previous change: {exc}",
    "{id} 是 Global Node 的保留 ID。": "{id} is a reserved ID for Global Node.",
    "未預期的錯誤：{exc}": "Unexpected error: {exc}",
}


def current_editor_language():
    try:
        path = editor_settings_path()
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8")) or {}
            lang = data.get("language")
            if lang in ("zh-Hant", "en"):
                return lang
    except Exception:
        pass
    return "zh-Hant"


def tr(key, lang=None, **kwargs):
    if lang is None:
        lang = current_editor_language()
    pattern = key
    if lang == "en" and key in PYTHON_EN_DICTIONARY:
        pattern = PYTHON_EN_DICTIONARY[key]
    if kwargs:
        return pattern.format(**kwargs)
    return pattern


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def ensure_project_structure():
    for name in (DATA_DIR, NODE_DIR):
        (PROJECT_ROOT / name).mkdir(parents=True, exist_ok=True)

    stats_path = PROJECT_ROOT / DATA_DIR / "Stats.json"
    if not stats_path.exists():
        write_json(stats_path, {})
    textbox_profiles_path().mkdir(parents=True, exist_ok=True)
    initialize_scene_project(PROJECT_ROOT)


def node_trash_root():
    project_base = PROJECT_ROOT.parent if PROJECT_ROOT.name.casefold() == "game" else PROJECT_ROOT
    return project_base / ".scene-node-trash"


def _path_snapshot(path):
    return path.read_bytes() if path.exists() and path.is_file() else None


def _tree_snapshot(root):
    if not root.exists():
        return None
    if not root.is_dir():
        raise OSError(f"Undo tree is not a directory: {root}")
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _atomic_write_bytes(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".undo-tmp")
    temporary.write_bytes(content)
    os.replace(str(temporary), str(path))


class UndoTransaction:
    def __init__(self, label):
        self.label = str(label or "change")
        self.files = {}
        self.trees = {}

    def capture_file(self, path):
        resolved = Path(path).resolve()
        if any(resolved == root or root in resolved.parents for root in self.trees):
            return
        if resolved not in self.files:
            self.files[resolved] = _path_snapshot(resolved)

    def capture_tree(self, root):
        resolved = Path(root).resolve()
        if resolved in self.trees:
            return
        self.trees[resolved] = _tree_snapshot(resolved)
        self.files = {
            path: snapshot
            for path, snapshot in self.files.items()
            if path != resolved and resolved not in path.parents
        }

    def changed_paths(self):
        changed = [path for path, before in self.files.items() if _path_snapshot(path) != before]
        changed.extend(root for root, before in self.trees.items() if _tree_snapshot(root) != before)
        return sorted(set(changed), key=str)

    def restore(self):
        for root, before in sorted(self.trees.items(), key=lambda entry: len(entry[0].parts), reverse=True):
            if root.exists():
                if root.is_dir():
                    shutil.rmtree(root)
                else:
                    root.unlink()
            if before is not None:
                root.mkdir(parents=True, exist_ok=True)
                for relative, content in before.items():
                    _atomic_write_bytes(root / Path(relative), content)
        for path, before in self.files.items():
            if before is None:
                if path.exists():
                    if path.is_dir():
                        shutil.rmtree(path)
                    else:
                        path.unlink()
            else:
                _atomic_write_bytes(path, before)


def active_undo_transaction():
    return getattr(_UNDO_LOCAL, "transaction", None)


@contextmanager
def undo_transaction(label):
    with _UNDO_LOCK:
        transaction = UndoTransaction(label)
        _UNDO_LOCAL.transaction = transaction
        try:
            yield transaction
        except Exception:
            _UNDO_LOCAL.transaction = None
            transaction.restore()
            raise
        else:
            _UNDO_LOCAL.transaction = None
            if transaction.changed_paths():
                _UNDO_HISTORY.append(transaction)
                del _UNDO_HISTORY[:-UNDO_HISTORY_LIMIT]


def clear_undo_history():
    with _UNDO_LOCK:
        _UNDO_HISTORY.clear()


def perform_undo():
    with _UNDO_LOCK:
        if not _UNDO_HISTORY:
            raise ApiError(HTTPStatus.CONFLICT, tr("沒有可以返回的上一步。"))
        transaction = _UNDO_HISTORY.pop()
        changed = transaction.changed_paths()
        try:
            transaction.restore()
        except Exception as exc:
            _UNDO_HISTORY.append(transaction)
            raise ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, tr("無法返回上一步：{exc}", exc=exc)) from exc
        return {
            "undone": True,
            "paths": [str(path) for path in changed],
        }


def atomic_write(path, content):
    transaction = active_undo_transaction()
    if transaction:
        transaction.capture_file(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(str(temporary), str(path))


def write_json(path, data):
    atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def undoable_unlink(path):
    transaction = active_undo_transaction()
    if transaction:
        transaction.capture_file(path)
    path.unlink()


def read_json(path, default=None):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, tr("無法讀取 {name}: {exc}", name=path.name, exc=exc))


def clean_file_name(value, suffix):
    name = str(value or "").strip()
    if suffix and name.endswith(suffix):
        name = name[: -len(suffix)]
    if not name or name in (".", "..") or any(char in name for char in ("/", "\\", "\0")):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("名稱不可為空，也不可包含路徑符號。"))
    return name


def generate_id(prefix):
    return f"{prefix}_{secrets.token_hex(4)}"


def source_display_name(source, fallback):
    match = DISPLAY_NAME_RE.search(source)
    return match.group(1).strip() if match else fallback


def set_source_display_name(source, display_name):
    marker = f"# @display_name: {display_name.strip()}"
    if DISPLAY_NAME_RE.search(source):
        return DISPLAY_NAME_RE.sub(marker, source, count=1)
    return marker + "\n" + source.lstrip("\n")


def clean_node_path(value):
    raw = unquote(str(value or "")).strip().replace("\\", "/").strip("/")
    if not raw:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Scene Node 路徑不可為空。"))
    path = PurePosixPath(raw)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Scene Node 路徑不合法。"))
    return path.as_posix()


def node_path(relative):
    return PROJECT_ROOT / NODE_DIR / Path(clean_node_path(relative))


def is_global_node_path(relative):
    return clean_node_path(relative) == GLOBAL_NODE_PATH


def global_node_path():
    return PROJECT_ROOT / GLOBAL_NODE_DIRECTORY


def authoring_directory(relative):
    return global_node_path() if is_global_node_path(relative) else node_path(relative)


def stats_path():
    return PROJECT_ROOT / DATA_DIR / "Stats.json"


def memories_path():
    return PROJECT_ROOT / MEMORIES_RELATIVE


def textbox_profiles_path():
    return PROJECT_ROOT / DATA_DIR / TEXTBOX_PROFILE_DIR


def editor_settings_path():
    return PROJECT_ROOT.parent / ".scene-node-editor" / EDITOR_SETTINGS_FILE


def validate_editor_settings(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Editor 設定必須是 object。"))
    language = value.get("language")
    if language is not None and language not in ("zh-Hant", "en"):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("語言設定不合法，僅支援 zh-Hant 與 en。"))
    shortcuts = value.get("shortcuts")
    if shortcuts is not None and not isinstance(shortcuts, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("快捷鍵設定必須是 object。"))
    return value


def scene_project_path():
    return PROJECT_ROOT / PROJECT_CONFIG_RELATIVE


def scene_project_config():
    return read_json(scene_project_path(), {}) or {}


def project_display_name():
    """Return the Ren'Py project folder name, not its conventional game/ child."""
    if PROJECT_ROOT.name.casefold() == "game":
        return PROJECT_ROOT.parent.name or PROJECT_ROOT.name
    return PROJECT_ROOT.name


def configured_root_node():
    return str(scene_project_config().get("Root Node") or "").strip() or None


def default_options():
    return {
        "Version": 3,
        "Canvas": {
            "Width": 1920,
            "Height": 1080,
            "Preview Background": "",
        },
        "Elements": [],
    }


def clean_asset_path(value):
    raw = unquote(str(value or "")).strip().replace("\\", "/").lstrip("/")
    if not raw:
        return ""
    path = PurePosixPath(raw)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("資源路徑不合法。"))
    return path.as_posix()


def number_setting(value, fallback, field, minimum=None, maximum=None, integer=False):
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 必須是數字。", field=field))
    if minimum is not None and result < minimum:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 不可小於 {minimum}。", field=field, minimum=minimum))
    if maximum is not None and result > maximum:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 不可大於 {maximum}。", field=field, maximum=maximum))
    if integer:
        return int(result)
    return int(result) if result.is_integer() else result


def validate_textbox_style(value, partial=False):
    raw = value if isinstance(value, dict) else {}
    result = {} if partial else dict(TEXTBOX_STYLE_DEFAULTS)
    for field in ("Background", "Item Background", "Text Color"):
        if field in raw:
            result[field] = str(raw[field])
    if "Text Size" in raw:
        result["Text Size"] = number_setting(
            raw["Text Size"], 30, "Text Size", minimum=8, maximum=160, integer=True
        )
    if "Text Align" in raw:
        result["Text Align"] = number_setting(
            raw["Text Align"], 0.5, "Text Align", minimum=0, maximum=1
        )
    return result


def validate_textbox_feature(feature_id, value):
    if feature_id not in TEXTBOX_FEATURE_DEFAULTS:
        raise ApiError(
            HTTPStatus.BAD_REQUEST,
            tr("Textbox 外觀設定檔含有不支援的特性：{feature_id}。", feature_id=feature_id),
        )
    raw = value if isinstance(value, dict) else {}
    result = dict(TEXTBOX_FEATURE_DEFAULTS[feature_id])
    result["Enabled"] = bool(raw.get("Enabled", result["Enabled"]))
    if feature_id in ("hover_accent", "item_border"):
        result["Color"] = str(raw.get("Color") or result["Color"])
        field = "Hover Accent Width" if feature_id == "hover_accent" else "Item Border Width"
        result["Width"] = number_setting(raw.get("Width", result["Width"]), result["Width"], field, minimum=1, maximum=40, integer=True)
    elif feature_id == "hover_text_color":
        result["Color"] = str(raw.get("Color") or result["Color"])
    elif feature_id == "text_shadow":
        result["Color"] = str(raw.get("Color") or result["Color"])
        result["Size"] = number_setting(raw.get("Size", result["Size"]), result["Size"], "Text Shadow Size", minimum=0, maximum=20, integer=True)
        result["X"] = number_setting(raw.get("X", result["X"]), result["X"], "Text Shadow X", minimum=-40, maximum=40, integer=True)
        result["Y"] = number_setting(raw.get("Y", result["Y"]), result["Y"], "Text Shadow Y", minimum=-40, maximum=40, integer=True)
    elif feature_id == "text_outline":
        result["Color"] = str(raw.get("Color") or result["Color"])
        result["Size"] = number_setting(raw.get("Size", result["Size"]), result["Size"], "Text Outline Size", minimum=0, maximum=20, integer=True)
    else:
        result["Distance"] = number_setting(raw.get("Distance", result["Distance"]), result["Distance"], "Entrance Distance", minimum=-200, maximum=200, integer=True)
        result["Delay"] = number_setting(raw.get("Delay", result["Delay"]), result["Delay"], "Entrance Delay", minimum=0, maximum=1)
        result["Duration"] = number_setting(raw.get("Duration", result["Duration"]), result["Duration"], "Entrance Duration", minimum=0, maximum=3)
    return result


def validate_textbox_profile(value, expected_id=None):
    if not isinstance(value, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Textbox 外觀設定檔必須是 object。"))
    profile_id = clean_file_name(value.get("ID") or expected_id, "")
    if expected_id is not None and profile_id != expected_id:
        raise ApiError(
            HTTPStatus.BAD_REQUEST,
            tr("Textbox 外觀設定檔 {profile_id} 的檔名與 ID 不一致。", profile_id=profile_id),
        )
    name = str(value.get("Name") or "").strip()
    if not name:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Textbox 外觀設定檔名稱不可為空。"))
    raw_features = value.get("Features") if isinstance(value.get("Features"), dict) else {}
    unsupported = sorted(set(raw_features) - set(TEXTBOX_FEATURE_DEFAULTS))
    if unsupported:
        raise ApiError(
            HTTPStatus.BAD_REQUEST,
            tr("Textbox 外觀設定檔含有不支援的特性：{feature_id}。", feature_id=unsupported[0]),
        )
    result = {
        "Version": TEXTBOX_PROFILE_VERSION,
        "ID": profile_id,
        "Name": name,
        "Style": validate_textbox_style(value.get("Style")),
        "Features": {
            feature_id: validate_textbox_feature(feature_id, raw_features.get(feature_id))
            for feature_id in TEXTBOX_FEATURE_DEFAULTS
        },
    }
    if "Order" in value:
        result["Order"] = validate_editor_order(value.get("Order"), "Textbox Profile Order")
    return result


def textbox_profile_file(profile_id):
    profile_id = clean_file_name(profile_id, ".json")
    return textbox_profiles_path() / f"{profile_id}.json"


def scan_textbox_profiles():
    root = textbox_profiles_path()
    if not root.exists():
        return []
    profiles = []
    for fallback_order, path in enumerate(sorted(root.glob("*.json"), key=lambda item: item.name.casefold())):
        try:
            profile = validate_textbox_profile(read_json(path, {}), path.stem)
            profile["Order"] = profile.get("Order", fallback_order)
            profiles.append(profile)
        except ApiError:
            continue
    return sorted(profiles, key=lambda item: (item.get("Order", 0), item["ID"].casefold()))


def save_textbox_profile_order(payload):
    profiles = scan_textbox_profiles()
    order = payload.get("order")
    ids = [profile["ID"] for profile in profiles]
    if not isinstance(order, list) or not all(isinstance(profile_id, str) for profile_id in order):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Textbox 外觀設定檔排序必須是陣列。"))
    if len(order) != len(set(order)) or set(order) != set(ids):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Textbox 外觀設定檔排序必須包含所有設定檔。"))
    updates = []
    for index, profile_id in enumerate(order):
        profile = next(profile for profile in profiles if profile["ID"] == profile_id)
        profile["Order"] = index
        updates.append((textbox_profile_file(profile_id), validate_textbox_profile(profile, profile_id)))
    originals = {path: path.read_text(encoding="utf-8") for path, _ in updates}
    written = []
    try:
        for path, profile in updates:
            write_json(path, profile)
            written.append(path)
    except Exception:
        for path in written:
            atomic_write(path, originals[path])
        raise
    return {"profiles": [profile for _, profile in updates]}


def textbox_profile_references(profile_id):
    references = []
    for summary in [global_node_summary(False)] + scan_nodes(False):
        directory = authoring_directory(summary["path"])
        try:
            options = validate_options(read_json(directory / OPTIONS_FILE, default_options()))
        except ApiError:
            continue
        for element in options.get("Elements", []):
            if element.get("Type") != "TEXTBOX":
                continue
            if element.get("Appearance", {}).get("Profile") == profile_id:
                references.append({
                    "nodeId": summary["id"],
                    "nodeName": summary["name"],
                    "nodePath": summary["path"],
                    "elementId": element["ID"],
                    "elementName": element.get("Name") or element["ID"],
                })
    return references


def create_textbox_profile(payload):
    raw = dict(payload.get("profile") if isinstance(payload.get("profile"), dict) else payload)
    raw.setdefault("ID", generate_id("textbox_profile"))
    raw.setdefault("Name", raw["ID"])
    raw.setdefault("Order", max((-1, *(
        profile.get("Order", -1) if isinstance(profile.get("Order"), int) else -1
        for profile in scan_textbox_profiles()
    ))) + 1)
    profile = validate_textbox_profile(raw)
    path = textbox_profile_file(profile["ID"])
    if path.exists():
        raise ApiError(
            HTTPStatus.CONFLICT,
            tr("Textbox 外觀設定檔 {profile_id} 已經存在。", profile_id=profile["ID"]),
        )
    write_json(path, profile)
    return profile


def save_textbox_profile(payload):
    profile = validate_textbox_profile(payload.get("profile"))
    path = textbox_profile_file(profile["ID"])
    if not path.exists():
        raise ApiError(
            HTTPStatus.NOT_FOUND,
            tr("找不到 Textbox 外觀設定檔：{profile_id}。", profile_id=profile["ID"]),
        )
    write_json(path, profile)
    return profile


def delete_textbox_profile(profile_id):
    profile_id = clean_file_name(profile_id, ".json")
    path = textbox_profile_file(profile_id)
    if not path.exists():
        raise ApiError(
            HTTPStatus.NOT_FOUND,
            tr("找不到 Textbox 外觀設定檔：{profile_id}。", profile_id=profile_id),
        )
    references = textbox_profile_references(profile_id)
    if references:
        raise ApiError(
            HTTPStatus.CONFLICT,
            tr("Textbox 外觀設定檔 {profile_id} 仍被 {count} 個 Textbox 使用。", profile_id=profile_id, count=len(references)),
        )
    undoable_unlink(path)
    return {"deleted": True, "id": profile_id}


def validate_condition(condition, field="Condition"):
    result = dict(condition)
    condition_type = str(result.get("type") or "stat").lower()
    if condition_type == "tag":
        condition_type = "memory"
    result["type"] = condition_type

    if condition_type == "stat":
        result["id"] = clean_file_name(result.get("id"), "")
        operation = str(result.get("op") or ">=")
        if operation not in CONDITION_OPERATORS["stat"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的 Stat 判斷不合法。", field=field))
        result["op"] = operation
        result["value"] = number_setting(result.get("value", 0), 0, tr("{field} 的值", field=field))
        result.pop("bank", None)
        return result

    if condition_type == "memory":
        result["bank"] = clean_file_name(result.get("bank") or DEFAULT_MEMORY_ID, "")
        tag_id = str(result.get("id") or "").strip()
        if not tag_id:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的記憶標籤不可為空。", field=field))
        result["id"] = tag_id
        operation = str(result.get("op") or "has")
        if operation not in CONDITION_OPERATORS["memory"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的記憶判斷不合法。", field=field))
        result["op"] = operation
        result.pop("value", None)
        result.pop("scope", None)
        return result

    raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的類型不合法：{condition_type}。", field=field, condition_type=condition_type))


def validate_condition_clause(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Condition clause 必須是 null 或不超過 80 個字元的字串。"))
    clause = value.strip()
    if not clause:
        return None
    if len(clause) > 80:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Condition clause 必須是 null 或不超過 80 個字元的字串。"))
    return clause


def validate_effect(effect, field="Effect"):
    result = dict(effect)
    effect_type = str(result.get("type") or "stat").lower()
    if effect_type == "tag":
        effect_type = "memory"
    result["type"] = effect_type

    if effect_type == "stat":
        result["id"] = clean_file_name(result.get("id"), "")
        operation = str(result.get("op") or "+")
        if operation not in EFFECT_OPERATORS["stat"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的 Stat 操作不合法。", field=field))
        result["op"] = operation
        result["value"] = number_setting(result.get("value", 0), 0, tr("{field} 的值", field=field))
        result.pop("bank", None)
        return result

    if effect_type == "memory":
        result["bank"] = clean_file_name(result.get("bank") or DEFAULT_MEMORY_ID, "")
        operation = str(result.get("op") or "add")
        if operation not in EFFECT_OPERATORS["memory"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的記憶操作不合法。", field=field))
        result["op"] = operation
        if operation == "clear":
            result.pop("id", None)
        else:
            tag_id = str(result.get("id") or "").strip()
            if not tag_id:
                raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的記憶標籤不可為空。", field=field))
            result["id"] = tag_id
        result.pop("scope", None)
        result.pop("value", None)
        return result

    if effect_type == "option":
        operation = str(result.get("op") or "enable").lower()
        if operation not in EFFECT_OPERATORS["option"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的 Option 操作不合法。", field=field))
        target = str(result.get("target") or "element").lower()
        if target not in OPTION_EFFECT_TARGETS:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的 Option 目標層級不合法。", field=field))
        result = {
            "type": "option",
            "op": operation,
            "target": target,
            "node": clean_file_name(result.get("node"), ""),
            "element": clean_file_name(result.get("element"), ""),
        }
        if target == "item":
            result["item"] = clean_file_name(effect.get("item"), "")
        return result

    raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的類型不合法：{effect_type}。", field=field, effect_type=effect_type))


def validate_option_style_override(value):
    if not isinstance(value, dict):
        return {}
    result = {}
    color_fields = (
        "Item Background",
        "Text Color",
    )
    for field in color_fields:
        if field in value:
            result[field] = str(value[field])
    if "Text Size" in value:
        result["Text Size"] = number_setting(value["Text Size"], 30, "Item Text Size", minimum=8, maximum=160, integer=True)
    if "Text Align" in value:
        result["Text Align"] = number_setting(value["Text Align"], 0.5, "Item Text Align", minimum=0, maximum=1)
    return result


def validate_option_availability(value, field):
    availability = str(value or "ALWAYS").upper()
    if availability not in OPTION_AVAILABILITY_VALUES:
        raise ApiError(
            HTTPStatus.BAD_REQUEST,
            tr("{field} 必須是 ALWAYS 或 CONTROLLED。", field=field),
        )
    return availability


def validate_option_item(item):
    if not isinstance(item, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Text Box Item 必須是 object。"))
    item_id = clean_file_name(item.get("ID") or generate_id("option"), "")
    trigger = str(item.get("Trigger") or "").strip()
    if not trigger:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Text Box Item {item_id} 的 Trigger 不可為空。", item_id=item_id))
    return {
        "ID": item_id,
        "Name": str(item.get("Name") or item.get("Text") or item_id),
        "Text": str(item.get("Text") or item.get("Name") or item_id),
        "Trigger": trigger,
        "Availability": validate_option_availability(
            item.get("Availability"),
            f"Text Box Item {item_id} Availability",
        ),
        "Style Override": validate_option_style_override(item.get("Style Override")),
    }


def validate_option_element(element):
    if not isinstance(element, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Option Element 必須是 object。"))
    element_id = clean_file_name(element.get("ID") or generate_id("option_element"), "")
    element_type = str(element.get("Type") or "TEXTBOX").upper()
    if element_type not in ("TEXTBOX", "PICTURE", "HITBOX"):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Option Element {element_id} 的 Type 不合法。", element_id=element_id))

    raw_layout = element.get("Layout") if isinstance(element.get("Layout"), dict) else {}
    default_height = 360 if element_type == "TEXTBOX" else 180
    layout = {
        "X": number_setting(raw_layout.get("X", 690), 690, "X"),
        "Y": number_setting(raw_layout.get("Y", 360), 360, "Y"),
        "Width": number_setting(raw_layout.get("Width", 540), 540, "Width", minimum=24),
        "Height": number_setting(raw_layout.get("Height", default_height), default_height, "Height", minimum=24),
        "Z Order": number_setting(raw_layout.get("Z Order", 10), 10, "Z Order", integer=True),
    }
    result = {
        "ID": element_id,
        "Name": str(element.get("Name") or element_id),
        "Type": element_type,
        "Availability": validate_option_availability(
            element.get("Availability"),
            f"Option Element {element_id} Availability",
        ),
        "Layout": layout,
    }
    raw_hover = element.get("Hover") if isinstance(element.get("Hover"), dict) else {}
    result["Hover"] = {
        "Enabled": bool(raw_hover.get("Enabled", True)),
        "Color": str(raw_hover.get("Color") or "#ffffff18"),
    }
    result["Hover Sound"] = clean_asset_path(element.get("Hover Sound"))
    result["Click Sound"] = clean_asset_path(element.get("Click Sound"))

    if element_type == "TEXTBOX":
        raw_list = element.get("List") if isinstance(element.get("List"), dict) else {}
        result["List"] = {
            "Max Visible Items": number_setting(raw_list.get("Max Visible Items", 4), 4, "Max Visible Items", minimum=1, maximum=20, integer=True),
            "Item Height": number_setting(raw_list.get("Item Height", 72), 72, "Item Height", minimum=24, maximum=300, integer=True),
            "Item Spacing": number_setting(raw_list.get("Item Spacing", 12), 12, "Item Spacing", minimum=0, maximum=100, integer=True),
            "Padding": number_setting(raw_list.get("Padding", 16), 16, "Padding", minimum=0, maximum=200, integer=True),
            "Show Scrollbar": bool(raw_list.get("Show Scrollbar", True)),
        }
        result["Style"] = validate_textbox_style(element.get("Style"))
        raw_appearance = element.get("Appearance") if isinstance(element.get("Appearance"), dict) else {}
        profile_id = str(raw_appearance.get("Profile") or "").strip()
        if profile_id:
            profile_id = clean_file_name(profile_id, "")
            raw_feature_overrides = raw_appearance.get("Features") if isinstance(raw_appearance.get("Features"), dict) else {}
            result["Appearance"] = {
                "Profile": profile_id,
                "Features": {
                    feature_id: bool(enabled)
                    for feature_id, enabled in raw_feature_overrides.items()
                    if feature_id in TEXTBOX_FEATURE_DEFAULTS
                },
                "Style Overrides": validate_textbox_style(raw_appearance.get("Style Overrides"), partial=True),
            }
        items = element.get("Items") if isinstance(element.get("Items"), list) else []
        result["Items"] = [validate_option_item(item) for item in items]
        item_ids = [item["ID"] for item in result["Items"]]
        if len(item_ids) != len(set(item_ids)):
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Text Box {element_id} 內有重複的 Item ID。", element_id=element_id))
    elif element_type == "PICTURE":
        raw_picture = element.get("Picture") if isinstance(element.get("Picture"), dict) else {}
        fit = str(raw_picture.get("Fit") or "CONTAIN").upper()
        if fit not in ("CONTAIN", "COVER", "STRETCH"):
            fit = "CONTAIN"
        result["Trigger"] = str(element.get("Trigger") or "").strip()
        if not result["Trigger"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Picture {element_id} 的 Trigger 不可為空。", element_id=element_id))
        result["Picture"] = {
            "Idle": clean_asset_path(raw_picture.get("Idle")),
            "Hover": clean_asset_path(raw_picture.get("Hover")),
            "Fit": fit,
            "Keep Aspect": bool(raw_picture.get("Keep Aspect", True)),
            "Alpha Hit Test": bool(raw_picture.get("Alpha Hit Test", False)),
            "Opacity": number_setting(raw_picture.get("Opacity", 1), 1, "Opacity", minimum=0, maximum=1),
            "Tint": str(raw_picture.get("Tint") or "#ffffff"),
        }
    else:
        raw_hitbox = element.get("Hitbox") if isinstance(element.get("Hitbox"), dict) else {}
        result["Trigger"] = str(element.get("Trigger") or "").strip()
        if not result["Trigger"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Hitbox {element_id} 的 Trigger 不可為空。", element_id=element_id))
        result["Hitbox"] = {
            "Editor Color": str(raw_hitbox.get("Editor Color") or "#28a47d"),
            "Editor Opacity": number_setting(raw_hitbox.get("Editor Opacity", 0.24), 0.24, "Editor Opacity", minimum=0, maximum=1),
        }
    return result


def validate_options(data):
    if data is None:
        return default_options()
    if not isinstance(data, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Options.json 必須是 object。"))
    raw_canvas = data.get("Canvas") if isinstance(data.get("Canvas"), dict) else {}
    elements = data.get("Elements") if isinstance(data.get("Elements"), list) else []
    result = {
        "Version": 3,
        "Canvas": {
            "Width": number_setting(raw_canvas.get("Width", 1920), 1920, "Canvas Width", minimum=320, maximum=7680, integer=True),
            "Height": number_setting(raw_canvas.get("Height", 1080), 1080, "Canvas Height", minimum=180, maximum=4320, integer=True),
            "Preview Background": clean_asset_path(raw_canvas.get("Preview Background")),
        },
        "Elements": [validate_option_element(element) for element in elements],
    }
    element_ids = [element["ID"] for element in result["Elements"]]
    if len(element_ids) != len(set(element_ids)):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Options.json 內有重複的 Element ID。"))
    return result


def option_triggers(options):
    triggers = []
    for element in options.get("Elements", []):
        if element.get("Type") == "TEXTBOX":
            triggers.extend(item.get("Trigger") for item in element.get("Items", []))
        else:
            triggers.append(element.get("Trigger"))
    return [trigger for trigger in triggers if trigger]


def option_target_entries(node_id, node_name, node_path_value, options):
    targets = []
    for element in options.get("Elements", []):
        element_entry = {
            "nodeId": node_id,
            "nodeName": node_name,
            "nodePath": node_path_value,
            "target": "element",
            "elementId": element["ID"],
            "elementName": element.get("Name") or element["ID"],
            "elementType": element.get("Type"),
            "availability": element.get("Availability", "ALWAYS"),
        }
        targets.append(element_entry)
        if element.get("Type") != "TEXTBOX":
            continue
        for item in element.get("Items", []):
            targets.append({
                **element_entry,
                "target": "item",
                "itemId": item["ID"],
                "itemName": item.get("Name") or item.get("Text") or item["ID"],
                "availability": item.get("Availability", "ALWAYS"),
            })
    return targets


def scan_option_targets():
    targets = []
    for summary in [global_node_summary()] + scan_nodes():
        try:
            options = validate_options(
                read_json(authoring_directory(summary["path"]) / OPTIONS_FILE, default_options())
            )
        except ApiError:
            continue
        targets.extend(option_target_entries(
            summary["id"],
            summary.get("name") or summary["id"],
            summary["path"],
            options,
        ))
    return targets


def option_effect_references(node_id, element_id=None, item_id=None):
    references = []
    for summary in [global_node_summary()] + scan_nodes():
        try:
            detail = read_node(summary["path"])
        except ApiError:
            continue
        for entry in detail["events"]:
            for index, effect in enumerate(entry.get("data", {}).get("Effects", [])):
                if str(effect.get("type") or "").lower() != "option":
                    continue
                if effect.get("node") != node_id:
                    continue
                if element_id is not None and effect.get("element") != element_id:
                    continue
                if item_id is not None and (
                    effect.get("target") != "item" or effect.get("item") != item_id
                ):
                    continue
                references.append({
                    "nodePath": summary["path"],
                    "nodeName": summary.get("name") or summary["id"],
                    "eventId": entry.get("data", {}).get("ID", entry["file"]),
                    "eventName": entry.get("data", {}).get("Name")
                    or entry.get("data", {}).get("ID", entry["file"]),
                    "effectIndex": index,
                })
    return references


def option_target_keys(options):
    keys = set()
    for element in options.get("Elements", []):
        keys.add(("element", element["ID"], None))
        for item in element.get("Items", []):
            keys.add(("item", element["ID"], item["ID"]))
    return keys


def validate_option_target_removals(node_id, previous, updated):
    removed = option_target_keys(previous) - option_target_keys(updated)
    for target, element_id, item_id in sorted(removed):
        references = option_effect_references(node_id, element_id, item_id if target == "item" else None)
        if references:
            name = item_id if target == "item" else element_id
            raise ApiError(
                HTTPStatus.CONFLICT,
                tr("Option {name} 仍被 {count} 個 Event Effect 引用。", name=name, count=len(references)),
            )


def scan_assets(directory, extensions):
    root = PROJECT_ROOT / directory
    if not root.is_dir():
        return []
    assets = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.casefold() not in extensions:
            continue
        assets.append(path.relative_to(PROJECT_ROOT).as_posix())
    return sorted(assets, key=str.casefold)


def scan_image_assets():
    return scan_assets("images", IMAGE_EXTENSIONS)


def scan_audio_assets():
    return scan_assets("audio", AUDIO_EXTENSIONS)


def node_summary(directory, include_editor_details=True):
    node_file = directory / "Node.json"
    parse_error = None
    try:
        data = read_json(node_file, {}) or {}
    except ApiError as exc:
        data = {}
        parse_error = exc.message
    relative = directory.relative_to(PROJECT_ROOT / NODE_DIR).as_posix()
    events = list((directory / EVENT_DIR).glob("*.json")) if (directory / EVENT_DIR).exists() else []
    result = {
        "path": relative,
        "id": data.get("ID", directory.name),
        "name": data.get("Name", data.get("ID", directory.name)),
        "eventCount": len(events),
        "order": data.get("Order"),
        "group": validate_node_group(data.get("Group")),
        "parseError": parse_error,
    }
    if not include_editor_details:
        return result
    contents = list((directory / CONTENT_DIR).glob("*.rpy")) if (directory / CONTENT_DIR).exists() else []
    try:
        raw_options = read_json(directory / OPTIONS_FILE, default_options()) or default_options()
    except ApiError as exc:
        raw_options = default_options()
        parse_error = f"{parse_error}; {exc.message}" if parse_error else exc.message
    option_elements = raw_options.get("Elements", []) if isinstance(raw_options, dict) else []
    result.update({
        "contentCount": len(contents),
        "optionCount": len(option_elements),
        "parseError": parse_error,
    })
    return result


def global_node_summary(include_editor_details=True):
    directory = global_node_path()
    node_file = directory / "Node.json"
    parse_error = None
    try:
        data = read_json(node_file, {}) or {}
    except ApiError as exc:
        data = {}
        parse_error = exc.message
    events = list((directory / EVENT_DIR).glob("*.json")) if (directory / EVENT_DIR).exists() else []
    result = {
        "path": GLOBAL_NODE_PATH,
        "id": data.get("ID", GLOBAL_NODE_ID),
        "name": data.get("Name", "GLOBAL"),
        "eventCount": len(events),
        "parseError": parse_error,
        "isGlobal": True,
        "isRoot": False,
    }
    if not include_editor_details:
        return result
    contents = list((directory / CONTENT_DIR).glob("*.rpy")) if (directory / CONTENT_DIR).exists() else []
    try:
        raw_options = read_json(directory / OPTIONS_FILE, default_options()) or default_options()
    except ApiError as exc:
        raw_options = default_options()
        parse_error = f"{parse_error}; {exc.message}" if parse_error else exc.message
    option_elements = raw_options.get("Elements", []) if isinstance(raw_options, dict) else []
    result.update({
        "contentCount": len(contents),
        "optionCount": len(option_elements),
        "parseError": parse_error,
    })
    return result


def scan_nodes(include_editor_details=True):
    root = PROJECT_ROOT / NODE_DIR
    nodes = [node_summary(path.parent, include_editor_details) for path in root.rglob("Node.json")]
    try:
        root_node = configured_root_node()
    except ApiError:
        root_node = None
    for node in nodes:
        node["isRoot"] = bool(root_node and node["id"] == root_node)
    fallback = {
        node["path"]: index
        for index, node in enumerate(sorted(nodes, key=lambda item: (item["path"].casefold(), item["id"].casefold())))
    }
    return sorted(nodes, key=lambda item: (
        item["order"] if isinstance(item.get("order"), int) and item["order"] >= 0 else fallback[item["path"]],
        fallback[item["path"]],
    ))


def project_graph(node_summaries=None):
    edges = []
    nodes = scan_nodes(False) if node_summaries is None else node_summaries
    for node in [global_node_summary(False)] + list(nodes):
        event_root = authoring_directory(node["path"]) / EVENT_DIR
        if not event_root.exists():
            continue
        for path in sorted(event_root.glob("*.json"), key=lambda value: value.name.casefold()):
            try:
                event = read_json(path, {}) or {}
            except ApiError:
                continue
            end_up = str(event.get("End up") or "")
            if end_up not in ("GOTO", "REPLACE"):
                continue
            target = event.get("Next Node")
            if isinstance(target, str):
                targets = [(target, 1)]
            elif isinstance(target, dict):
                targets = list(target.items())
            else:
                targets = []
            for target_id, weight in targets:
                target_id = str(target_id or "").strip()
                if not target_id:
                    continue
                edges.append({
                    "source": str(node["id"]),
                    "target": target_id,
                    "eventId": str(event.get("ID") or path.stem),
                    "eventName": str(event.get("Name") or event.get("ID") or path.stem),
                    "trigger": str(event.get("Trigger") or ""),
                    "endUp": end_up,
                    "weight": weight,
                    "scope": "global" if node.get("isGlobal") else "node",
                })
    return {
        "edges": sorted(
            edges,
            key=lambda edge: (
                edge["source"].casefold(),
                edge["target"].casefold(),
                edge["eventId"].casefold(),
            ),
        )
    }


def graph_snapshot(project=None, include_editor_details=False):
    project = scene_project_config() if project is None else project
    nodes = scan_nodes(include_editor_details)
    return {
        "rootNodeId": str(project.get("Root Node") or "").strip() or None,
        "globalNode": global_node_summary(include_editor_details),
        "nodes": nodes,
        "graph": project_graph(nodes),
    }


def scan_content_files(root):
    if not root.exists():
        return []
    node_data = read_json(root.parent / "Node.json", {}) or {}
    saved_order = node_data.get("Content Order") if isinstance(node_data.get("Content Order"), list) else []
    order_indexes = {str(name): index for index, name in enumerate(saved_order)}
    files = []
    for path in sorted(root.glob("*.rpy"), key=lambda value: value.name.casefold()):
        source = path.read_text(encoding="utf-8")
        files.append({
            "name": path.stem,
            "displayName": source_display_name(source, path.stem),
            "file": path.name,
            "labels": LABEL_RE.findall(source),
        })
    fallback_offset = len(order_indexes)
    return sorted(files, key=lambda item: (
        order_indexes.get(item["name"], fallback_offset),
        item["name"].casefold(),
    ))


def read_node(relative):
    global_scope = is_global_node_path(relative)
    directory = authoring_directory(relative)
    node_file = directory / "Node.json"
    if not node_file.exists():
        raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到指定的 Global Node。") if global_scope else tr("找不到指定的 Scene Node。"))

    events = []
    event_root = directory / EVENT_DIR
    if event_root.exists():
        for path in sorted(event_root.glob("*.json"), key=lambda value: value.name.casefold()):
            event = read_json(path, {}) or {}
            events.append({"file": path.name, "data": event})

    options = validate_options(read_json(directory / OPTIONS_FILE, default_options()))
    return {
        "path": clean_node_path(relative),
        "node": read_json(node_file, {}) or {},
        "events": events,
        "options": options,
        "contents": scan_content_files(directory / CONTENT_DIR),
        "isGlobal": global_scope,
    }


def read_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Content-Length 不合法。"))
    raw = handler.rfile.read(length) if length else b"{}"
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("請求內容不是有效的 JSON。"))


def validate_stats(data):
    if not isinstance(data, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Stats 必須是 JSON object。"))
    result = {}
    for raw_id, settings in data.items():
        stat_id = clean_file_name(raw_id, "")
        if not isinstance(settings, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Stat {stat_id} 的設定必須是 object。", stat_id=stat_id))
        try:
            minimum = float(settings.get("Min", 0))
            maximum = float(settings.get("Max", 0))
            initial = float(settings.get("Init", 0))
        except (TypeError, ValueError):
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Stat {stat_id} 的 Min、Max、Init 必須是數字。", stat_id=stat_id))
        if minimum > maximum:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Stat {stat_id} 的 Min 不可大於 Max。", stat_id=stat_id))
        if not minimum <= initial <= maximum:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Stat {stat_id} 的 Init 必須位於 Min 與 Max 之間。", stat_id=stat_id))

        values = (settings.get("Min"), settings.get("Max"), settings.get("Init"))
        if all(isinstance(value, int) and not isinstance(value, bool) for value in values):
            minimum, maximum, initial = int(minimum), int(maximum), int(initial)
        result[stat_id] = {
            "Name": str(settings.get("Name") or stat_id),
            "Max": maximum,
            "Min": minimum,
            "Init": initial,
        }
        result[stat_id]["Group"] = str(settings.get("Group") or "Normal").strip() or "Normal"
        if "Order" in settings:
            result[stat_id]["Order"] = validate_editor_order(settings.get("Order"), f"Stat {stat_id} Order")
    return result


def validate_memories(data):
    if not isinstance(data, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Memories 必須是 JSON object。"))
    result = {}
    for raw_id, settings in data.items():
        bank_id = clean_file_name(raw_id, "")
        if not isinstance(settings, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("記憶庫 {bank_id} 的設定必須是 object。", bank_id=bank_id))
        name = str(settings.get("Name") or "").strip()
        if not name:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("記憶庫 {bank_id} 的名稱不可為空。", bank_id=bank_id))
        result[bank_id] = {"Name": name}
    if DEFAULT_MEMORY_ID not in result:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("不可移除預設 Memory 記憶庫。"))
    result[DEFAULT_MEMORY_ID]["Name"] = "Memory"
    return result


def validate_weight_map(value, field):
    if value is None:
        return
    if isinstance(value, str):
        if not value.strip():
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 名稱不可為空。", field=field))
        return
    if not isinstance(value, dict) or not value:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 必須是 null、字串或非空權重表。", field=field))
    for key, weight in value.items():
        clean_file_name(key, "")
        if not isinstance(weight, (int, float)) or isinstance(weight, bool) or weight <= 0:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 的權重必須大於 0。", field=field))


def validate_event_trigger(value):
    trigger = str(value or "").strip()
    if not trigger:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Event Trigger 不可為空。"))
    if ":" not in trigger:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Event Trigger 必須使用 Source:Value 格式。"))

    source, payload = trigger.split(":", 1)
    payload = payload.strip()
    if source not in ("Auto", "Action", "Keyboard", "Mouse"):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Event Trigger 來源不合法：{source}。", source=source))
    if not payload:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("{source} Trigger 不可為空。", source=source))
    if source == "Auto" and payload not in AUTO_TRIGGER_PHASES:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Auto Trigger 不合法：{payload}。", payload=payload))
    if source == "Keyboard" and not (
        KEYBOARD_KEYSYM_RE.fullmatch(payload) or (len(payload) == 1 and not payload.isspace())
    ):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Keyboard Trigger 必須是有效的 Ren'Py keysym。"))
    if source == "Mouse" and payload not in MOUSE_TRIGGER_VALUES:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Mouse Trigger 不合法：{payload}。", payload=payload))
    return f"{source}:{payload}"


def validate_event_group(value):
    group = str(value or DEFAULT_EVENT_GROUP).strip() or DEFAULT_EVENT_GROUP
    if len(group) > 80:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Event 群組名稱不可超過 80 個字元。"))
    return group


def validate_editor_order(value, field="Order"):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("{field} 必須是非負整數。", field=field))
    return value


def validate_event(event, global_scope=False, owner_node_id=None):
    if not isinstance(event, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Event 必須是 JSON object。"))
    if global_scope and owner_node_id is None:
        owner_node_id = GLOBAL_NODE_ID
    event_id = clean_file_name(event.get("ID") or generate_id("event"), ".json")
    trigger = validate_event_trigger(event.get("Trigger"))
    is_lifecycle = trigger in LIFECYCLE_TRIGGERS

    priority = event.get("Priority", 5)
    if not isinstance(priority, int) or isinstance(priority, bool) or not 0 <= priority <= 5:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Priority 必須是 0 到 5 的整數。"))
    weight = event.get("Weight", 1)
    if not is_lifecycle and (not isinstance(weight, (int, float)) or isinstance(weight, bool) or weight <= 0):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Weight 必須大於 0。"))

    conditions = event.get("Conditions", [])
    effects = event.get("Effects", [])
    if not isinstance(conditions, list) or not all(isinstance(item, dict) for item in conditions):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Conditions 必須是 object 陣列。"))
    if not isinstance(effects, list) or not all(isinstance(item, dict) for item in effects):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Effects 必須是 object 陣列。"))

    content = event.get("Content")
    validate_weight_map(content, "Content")
    legacy_conditions = bool(conditions) and all("clause" not in item for item in conditions)
    validated_conditions = []
    for item in conditions:
        validated = validate_condition(item, "Event Condition")
        validated["clause"] = (
            DEFAULT_CONDITION_CLAUSE
            if legacy_conditions
            else validate_condition_clause(item.get("clause"))
        )
        validated_conditions.append(validated)
    validated_effects = [validate_effect(item, "Event Effect") for item in effects]
    for effect in validated_effects:
        if (
            effect.get("type") == "option"
            and owner_node_id
            and effect.get("node") != owner_node_id
        ):
            raise ApiError(
                HTTPStatus.BAD_REQUEST,
                tr("Option Effect 只能控制同一個 Options 作用域內的 Option。"),
            )

    result = {
        "ID": event_id,
        "Name": str(event.get("Name") or event_id),
        "Group": validate_event_group(event.get("Group")),
        "Trigger": trigger,
        "Priority": priority,
        "Once": bool(event.get("Once", False)),
        "Conditions": validated_conditions,
        "Effects": validated_effects,
        "Content": content,
    }
    if "Order" in event:
        result["Order"] = validate_editor_order(event.get("Order"), "Event Order")
    if is_lifecycle:
        return result

    end_up = event.get("End up", "REDO")
    next_node = event.get("Next Node")
    validate_weight_map(next_node, "Next Node")
    if end_up not in ("REDO", "GOTO", "REPLACE", "EXIT"):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("End up 必須是 REDO、GOTO、REPLACE 或 EXIT。"))
    if end_up in ("GOTO", "REPLACE") and next_node is None:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("{end_up} Event 必須設定 Next Node。", end_up=end_up))
    result.update({
        "Weight": weight,
        "End up": end_up,
        "Next Node": next_node if end_up in ("GOTO", "REPLACE") else None,
    })
    return result


def all_rpy_symbols():
    labels = set()
    for path in PROJECT_ROOT.rglob("*.rpy"):
        if EDITOR_ROOT in path.parents:
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except OSError:
            continue
        labels.update(LABEL_RE.findall(source))
    return labels


def validate_project():
    issues = []
    textbox_profiles = {}
    profile_root = textbox_profiles_path()
    if profile_root.exists():
        for path in sorted(profile_root.glob("*.json"), key=lambda item: item.name.casefold()):
            try:
                profile = validate_textbox_profile(read_json(path, {}), path.stem)
                textbox_profiles[profile["ID"]] = profile
            except ApiError as exc:
                issues.append({
                    "level": "error",
                    "location": f"{DATA_DIR}/{TEXTBOX_PROFILE_DIR}/{path.name}",
                    "message": exc.message,
                })
    try:
        stats = read_json(stats_path(), {}) or {}
        stats = validate_stats(stats)
    except ApiError as exc:
        issues.append({"level": "error", "location": "DATA/Stats.json", "message": exc.message})
        stats = {}

    try:
        memories = read_json(memories_path(), {}) or {}
        memories = validate_memories(memories)
    except ApiError as exc:
        issues.append({"level": "error", "location": MEMORIES_RELATIVE.as_posix(), "message": exc.message})
        memories = {}

    nodes = scan_nodes()
    node_ids = {item["id"] for item in nodes}
    option_targets = {
        (
            item["nodeId"],
            item["target"],
            item["elementId"],
            item.get("itemId"),
        ): item
        for item in scan_option_targets()
    }
    global_summary = global_node_summary()
    labels = all_rpy_symbols()
    seen_node_ids = set()
    if scene_project_path().exists():
        try:
            root_node = configured_root_node()
        except ApiError as exc:
            issues.append({"level": "error", "location": PROJECT_CONFIG_RELATIVE.as_posix(), "message": exc.message})
            root_node = None
        if not root_node:
            issues.append({"level": "error", "location": PROJECT_CONFIG_RELATIVE.as_posix(), "message": tr("尚未設定 Root Node。")})
        elif root_node not in node_ids:
            issues.append({"level": "error", "location": PROJECT_CONFIG_RELATIVE.as_posix(), "message": tr("找不到 Root Node：{root_node}。", root_node=root_node)})
        else:
            calls = runtime_start_calls(PROJECT_ROOT)
            if not calls["configured"] and root_node not in calls["explicitNodes"]:
                issues.append({
                    "level": "warning",
                    "location": "script.rpy",
                    "message": tr("Root Node 尚未連接到 scene_runtime_start()。"),
                })

    for summary in [global_summary] + nodes:
        global_scope = bool(summary.get("isGlobal"))
        node_id = summary["id"]
        location = GLOBAL_NODE_DIRECTORY if global_scope else f"SCENENODE/{summary['path']}"
        if summary.get("parseError"):
            issues.append({"level": "error", "location": location, "message": summary["parseError"]})
            continue
        if global_scope and node_id != GLOBAL_NODE_ID:
            issues.append({
                "level": "error",
                "location": location,
                "message": tr("Global Node ID 必須固定為 {id}。", id=GLOBAL_NODE_ID),
            })
        if not global_scope and node_id == GLOBAL_NODE_ID:
            issues.append({
                "level": "error",
                "location": location,
                "message": tr("Scene Node 不可使用保留 ID：{id}。", id=GLOBAL_NODE_ID),
            })
        if node_id in seen_node_ids:
            issues.append({"level": "error", "location": location, "message": tr("Node ID {node_id} 重複。", node_id=node_id)})
        seen_node_ids.add(node_id)
        try:
            detail = read_node(summary["path"])
        except ApiError as exc:
            issues.append({"level": "error", "location": location, "message": exc.message})
            continue

        event_triggers = {
            entry.get("data", {}).get("Trigger")
            for entry in detail["events"]
            if entry.get("data", {}).get("Trigger")
        }
        for trigger in option_triggers(detail["options"]):
            if trigger not in event_triggers:
                issues.append({
                    "level": "warning",
                    "location": f"{location}/{OPTIONS_FILE}",
                    "message": tr("選項 Trigger {trigger} 沒有對應的 Event。", trigger=trigger),
                })

        for element in detail["options"].get("Elements", []):
            profile_id = element.get("Appearance", {}).get("Profile")
            if profile_id and profile_id not in textbox_profiles:
                issues.append({
                    "level": "warning",
                    "location": f"{location}/{OPTIONS_FILE}",
                    "message": tr("找不到 Textbox 外觀設定檔：{profile_id}。", profile_id=profile_id),
                })

        for entry in detail["events"]:
            event_location = f"{location}/{EVENT_DIR}/{entry['file']}"
            try:
                event = validate_event(
                    entry["data"],
                    global_scope=global_scope,
                    owner_node_id=node_id,
                )
            except ApiError as exc:
                issues.append({"level": "error", "location": event_location, "message": exc.message})
                continue
            if entry["file"] != event["ID"] + ".json":
                issues.append({"level": "warning", "location": event_location, "message": tr("檔名與 Event ID 不一致。")})

            for condition in event["Conditions"]:
                if condition.get("type") == "stat" and condition.get("id") not in stats:
                    issues.append({"level": "warning", "location": event_location, "message": tr("找不到 Stat：{id}。", id=condition.get('id', ''))})
                if condition.get("type") == "memory" and condition.get("bank") not in memories:
                    issues.append({"level": "warning", "location": event_location, "message": tr("找不到記憶庫：{bank}。", bank=condition.get('bank', ''))})
            for effect in event["Effects"]:
                if effect.get("type") == "stat" and effect.get("id") not in stats:
                    issues.append({"level": "warning", "location": event_location, "message": tr("找不到 Stat：{id}。", id=effect.get('id', ''))})
                if effect.get("type") == "memory" and effect.get("bank") not in memories:
                    issues.append({"level": "warning", "location": event_location, "message": tr("找不到記憶庫：{bank}。", bank=effect.get('bank', ''))})
                if effect.get("type") == "option":
                    target_key = (
                        effect.get("node"),
                        effect.get("target"),
                        effect.get("element"),
                        effect.get("item") if effect.get("target") == "item" else None,
                    )
                    option_target = option_targets.get(target_key)
                    if not option_target:
                        issues.append({
                            "level": "warning",
                            "location": event_location,
                            "message": tr(
                                "找不到 Option Effect 目標：{target}。",
                                target="/".join(str(value or "") for value in target_key if value is not None),
                            ),
                        })
                    elif option_target.get("availability") != "CONTROLLED":
                        issues.append({
                            "level": "warning",
                            "location": event_location,
                            "message": tr(
                                "Option Effect 目標必須設為 CONTROLLED：{target}。",
                                target=option_target.get("itemName") or option_target.get("elementName"),
                            ),
                        })

            content = event["Content"]
            content_names = [content] if isinstance(content, str) else list(content or {})
            for label in content_names:
                if label not in labels:
                    issues.append({"level": "warning", "location": event_location, "message": tr("找不到 Content label：{label}。", label=label)})

            target = event.get("Next Node")
            target_names = [target] if isinstance(target, str) else list(target or {})
            for target_id in target_names:
                if target_id not in node_ids:
                    issues.append({"level": "warning", "location": event_location, "message": tr("找不到 Next Node：{target}。", target=target_id)})

    return issues


def create_node(payload):
    node_id = clean_file_name(payload.get("id") or generate_id("node"), "")
    relative = clean_node_path(payload.get("path") or node_id)
    if node_id == GLOBAL_NODE_ID or relative == GLOBAL_NODE_PATH:
        raise ApiError(HTTPStatus.CONFLICT, tr("這個 ID 或路徑保留給 Global Node。"))
    directory = node_path(relative)
    if directory.exists() and any(directory.iterdir()):
        raise ApiError(HTTPStatus.CONFLICT, tr("這個 Scene Node 路徑已經存在。"))

    node_name = str(payload.get("name") or node_id).strip() or node_id
    existing_nodes = scan_nodes(False)
    next_order = max((len(existing_nodes) - 1, *(
        node.get("order", -1) if isinstance(node.get("order"), int) else -1
        for node in existing_nodes
    ))) + 1
    transaction = active_undo_transaction()
    if transaction:
        transaction.capture_tree(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / EVENT_DIR).mkdir(exist_ok=True)
    (directory / CONTENT_DIR).mkdir(exist_ok=True)
    write_json(directory / "Node.json", {
        "ID": node_id,
        "Name": node_name,
        "Group": DEFAULT_EVENT_GROUP,
        "Order": next_order,
    })
    write_json(directory / OPTIONS_FILE, default_options())
    return node_summary(directory)


def save_node(payload):
    relative = clean_node_path(payload.get("path"))
    global_scope = is_global_node_path(relative)
    directory = authoring_directory(relative)
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到指定的 Global Node。") if global_scope else tr("找不到指定的 Scene Node。"))
    node = payload.get("node") or {}
    node_id = GLOBAL_NODE_ID if global_scope else clean_file_name(node.get("ID"), "")
    if not global_scope and node_id == GLOBAL_NODE_ID:
        raise ApiError(HTTPStatus.CONFLICT, tr("{id} 是 Global Node 的保留 ID。", id=GLOBAL_NODE_ID))
    previous = read_json(directory / "Node.json", {}) or {}
    updated = {
        "ID": node_id,
        "Name": str(node.get("Name") or node_id),
    }
    if "Order" in previous:
        updated["Order"] = validate_editor_order(previous.get("Order"), "Scene Node Order")
    if "Group" in previous:
        updated["Group"] = validate_node_group(previous.get("Group"))
    if isinstance(previous.get("Content Order"), list):
        updated["Content Order"] = previous["Content Order"]
    write_json(directory / "Node.json", updated)
    return global_node_summary() if global_scope else node_summary(directory)


def save_node_order(payload):
    nodes = scan_nodes(False)
    order = payload.get("order")
    paths = [node["path"] for node in nodes]
    if not isinstance(order, list) or not all(isinstance(path, str) for path in order):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Scene Node 排序必須是陣列。"))
    if len(order) != len(set(order)) or set(order) != set(paths):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Scene Node 排序必須包含所有 Scene Nodes。"))
    updates = []
    for index, relative in enumerate(order):
        path = node_path(relative) / "Node.json"
        data = read_json(path, {}) or {}
        data["Order"] = index
        updates.append((path, data))
    write_event_updates(updates)
    return {"nodes": scan_nodes()}


def validate_node_group(value):
    group = str(value or DEFAULT_EVENT_GROUP).strip() or DEFAULT_EVENT_GROUP
    if len(group) > 80:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Scene Node 群組名稱不可超過 80 個字元。"))
    return group


def save_node_groups(payload):
    nodes = scan_nodes(False)
    paths = {node["path"] for node in nodes}
    assignments = payload.get("assignments", {})
    order = payload.get("order")
    if not isinstance(assignments, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Scene Node 群組指派必須是 object。"))
    order_indexes = {}
    if order is not None:
        if (
            not isinstance(order, list)
            or not all(isinstance(path, str) for path in order)
            or len(order) != len(set(order))
            or set(order) != paths
        ):
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Scene Node 排序必須包含所有 Scene Nodes。"))
        order_indexes = {path: index for index, path in enumerate(order)}
    updates = []
    for raw_path in set(assignments) | set(order_indexes):
        relative = clean_node_path(raw_path)
        if relative not in paths:
            raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到 Scene Node：{path}。", path=relative))
        path = node_path(relative) / "Node.json"
        data = read_json(path, {}) or {}
        if raw_path in assignments:
            data["Group"] = validate_node_group(assignments[raw_path])
        if relative in order_indexes:
            data["Order"] = order_indexes[relative]
        updates.append((path, data))
    write_event_updates(updates)
    return {"nodes": scan_nodes()}


def dissolve_singleton_node_groups():
    grouped = {}
    for node in scan_nodes(False):
        group = validate_node_group(node.get("group"))
        if group != DEFAULT_EVENT_GROUP:
            grouped.setdefault(group, []).append(node)
    updates = []
    for entries in grouped.values():
        if len(entries) != 1:
            continue
        path = node_path(entries[0]["path"]) / "Node.json"
        data = read_json(path, {}) or {}
        data["Group"] = DEFAULT_EVENT_GROUP
        updates.append((path, data))
    write_event_updates(updates)
    return scan_nodes()


def save_content_order(payload):
    directory = authoring_directory(payload.get("node"))
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到指定的 authoring scope。"))
    files = scan_content_files(directory / CONTENT_DIR)
    names = [file["name"] for file in files]
    order = payload.get("order")
    if not isinstance(order, list) or not all(isinstance(name, str) for name in order):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Content 排序必須是陣列。"))
    if len(order) != len(set(order)) or set(order) != set(names):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Content 排序必須包含目前作用域的所有文件。"))
    node_file = directory / "Node.json"
    node = read_json(node_file, {}) or {}
    node["Content Order"] = order
    write_json(node_file, node)
    return {"contents": scan_content_files(directory / CONTENT_DIR)}


def save_root_node(payload):
    node_id = clean_file_name(payload.get("nodeId"), "")
    if node_id not in {item["id"] for item in scan_nodes()}:
        raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到要設為 Root 的 Scene Node。"))
    config = scene_project_config()
    config["Version"] = 1
    config["Root Node"] = node_id
    write_json(scene_project_path(), config)
    return {"rootNodeId": node_id, "project": config}


def save_event(payload):
    global_scope = is_global_node_path(payload.get("node"))
    directory = authoring_directory(payload.get("node"))
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到指定的 Global Node。") if global_scope else tr("找不到指定的 Scene Node。"))
    node = read_json(directory / "Node.json", {}) or {}
    event = validate_event(
        payload.get("event"),
        global_scope=global_scope,
        owner_node_id=GLOBAL_NODE_ID if global_scope else node.get("ID"),
    )
    event_root = directory / EVENT_DIR
    event_root.mkdir(exist_ok=True)
    original = payload.get("originalId")
    old_path_to_remove = None
    if original:
        original_name = clean_file_name(original, ".json")
        old_path = event_root / f"{original_name}.json"
        if original_name != event["ID"] and old_path.exists():
            new_path = event_root / f"{event['ID']}.json"
            if new_path.exists():
                raise ApiError(HTTPStatus.CONFLICT, tr("新的 Event ID 已經存在。"))
            old_path_to_remove = old_path
    target = event_root / f"{event['ID']}.json"
    if not original and target.exists():
        raise ApiError(HTTPStatus.CONFLICT, tr("這個 Event ID 已經存在。"))
    write_json(target, event)
    if old_path_to_remove and old_path_to_remove.exists():
        undoable_unlink(old_path_to_remove)
    return event


def write_event_updates(updates):
    originals = {path: path.read_text(encoding="utf-8") for path, _ in updates}
    written = []
    try:
        for path, event in updates:
            write_json(path, event)
            written.append(path)
    except Exception:
        for path in written:
            atomic_write(path, originals[path])
        raise


def rename_event_group(payload):
    directory = authoring_directory(payload.get("node"))
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到指定的 authoring scope。"))
    assignments = payload.get("assignments", {})
    order = payload.get("order")
    if assignments or order is not None:
        if not isinstance(assignments, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("Event 群組指派必須是非空 object。"))
        global_scope = is_global_node_path(payload.get("node"))
        node = read_json(directory / "Node.json", {}) or {}
        owner_node_id = GLOBAL_NODE_ID if global_scope else node.get("ID")
        event_root = directory / EVENT_DIR
        paths = {
            path.stem: path
            for path in sorted(event_root.glob("*.json"), key=lambda value: value.name.casefold())
        }
        order_indexes = {}
        if order is not None:
            if (
                not isinstance(order, list)
                or not all(isinstance(event_id, str) for event_id in order)
                or len(order) != len(set(order))
                or set(order) != set(paths)
            ):
                raise ApiError(HTTPStatus.BAD_REQUEST, tr("Event 排序必須包含目前作用域的所有 Events。"))
            order_indexes = {event_id: index for index, event_id in enumerate(order)}
        updates = []
        update_ids = set(assignments) | set(order_indexes)
        for raw_event_id in update_ids:
            event_id = clean_file_name(raw_event_id, ".json")
            path = paths.get(event_id)
            if path is None:
                raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到 Event：{id}。", id=event_id))
            raw_event = read_json(path, {}) or {}
            updated = dict(raw_event)
            if raw_event_id in assignments:
                updated["Group"] = validate_event_group(assignments[raw_event_id])
            if event_id in order_indexes:
                updated["Order"] = order_indexes[event_id]
            validated = validate_event(
                updated,
                global_scope=global_scope,
                owner_node_id=owner_node_id,
            )
            updates.append((path, validated))
        updates.sort(key=lambda entry: entry[1].get("Order", 0))
        write_event_updates(updates)
        return {"events": [event for _, event in updates], "order": order}

    source = validate_event_group(payload.get("source"))
    target = validate_event_group(payload.get("target"))
    if source == DEFAULT_EVENT_GROUP:
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Normal 是固定的預設 Event 群組。"))

    global_scope = is_global_node_path(payload.get("node"))
    node = read_json(directory / "Node.json", {}) or {}
    owner_node_id = GLOBAL_NODE_ID if global_scope else node.get("ID")
    updates = []
    event_root = directory / EVENT_DIR
    if event_root.exists():
        for path in sorted(event_root.glob("*.json"), key=lambda value: value.name.casefold()):
            raw_event = read_json(path, {}) or {}
            if validate_event_group(raw_event.get("Group")) != source:
                continue
            validated = validate_event(
                {**raw_event, "Group": target},
                global_scope=global_scope,
                owner_node_id=owner_node_id,
            )
            updates.append((path, validated))

    write_event_updates(updates)
    return {"source": source, "target": target, "events": [event for _, event in updates]}


def dissolve_singleton_event_groups(directory):
    event_root = directory / EVENT_DIR
    grouped = {}
    if not event_root.exists():
        return []
    for path in sorted(event_root.glob("*.json"), key=lambda value: value.name.casefold()):
        event = read_json(path, {}) or {}
        group = validate_event_group(event.get("Group"))
        if group != DEFAULT_EVENT_GROUP:
            grouped.setdefault(group, []).append((path, event))
    updates = []
    for entries in grouped.values():
        if len(entries) != 1:
            continue
        path, event = entries[0]
        event = {**event, "Group": DEFAULT_EVENT_GROUP}
        write_json(path, event)
        updates.append(event)
    return updates


def save_content_file(root, payload):
    name = clean_file_name(payload.get("id") or payload.get("name") or generate_id("content"), ".rpy")
    original = payload.get("originalName")
    source = payload.get("source")
    if not isinstance(source, str):
        raise ApiError(HTTPStatus.BAD_REQUEST, tr("Content 內容必須是文字。"))
    display_name = str(payload.get("displayName") or name).strip() or name
    source = set_source_display_name(source, display_name)
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"{name}.rpy"
    old_path_to_remove = None
    if original:
        old_name = clean_file_name(original, ".rpy")
        old_path = root / f"{old_name}.rpy"
        if old_name != name:
            if target.exists():
                raise ApiError(HTTPStatus.CONFLICT, tr("Content 名稱已經存在。"))
            old_path_to_remove = old_path
    elif target.exists():
        raise ApiError(HTTPStatus.CONFLICT, tr("Content 名稱已經存在。"))
    atomic_write(target, source.rstrip() + "\n")
    if old_path_to_remove and old_path_to_remove.exists():
        undoable_unlink(old_path_to_remove)
    node_file = root.parent / "Node.json"
    node = read_json(node_file, {}) or {}
    existing_order = node.get("Content Order") if isinstance(node.get("Content Order"), list) else []
    normalized_order = []
    old_name = clean_file_name(original, ".rpy") if original else None
    for entry in existing_order:
        entry = str(entry)
        if old_name and entry == old_name:
            entry = name
        if entry not in normalized_order:
            normalized_order.append(entry)
    if name not in normalized_order:
        normalized_order.append(name)
    existing_names = {path.stem for path in root.glob("*.rpy")}
    node["Content Order"] = [entry for entry in normalized_order if entry in existing_names]
    write_json(node_file, node)
    return {"name": name, "displayName": display_name, "file": target.name}


def node_references(relative):
    target = read_node(relative)
    if target.get("isGlobal"):
        return {"nodeId": GLOBAL_NODE_ID, "references": []}
    target_id = target["node"].get("ID")
    references = []
    for summary in [global_node_summary()] + scan_nodes():
        if summary["path"] == clean_node_path(relative):
            continue
        try:
            detail = read_node(summary["path"])
        except ApiError:
            continue
        for entry in detail["events"]:
            event = entry["data"]
            next_node = event.get("Next Node")
            targets = [next_node] if isinstance(next_node, str) else list(next_node or {})
            if target_id in targets:
                references.append({
                    "nodePath": summary["path"],
                    "nodeName": summary.get("name") or summary["id"],
                    "eventId": event.get("ID", entry["file"]),
                    "eventName": event.get("Name", event.get("ID", entry["file"])),
                })
            for index, effect in enumerate(event.get("Effects", [])):
                if str(effect.get("type") or "").lower() != "option":
                    continue
                if effect.get("node") != target_id:
                    continue
                references.append({
                    "nodePath": summary["path"],
                    "nodeName": summary.get("name") or summary["id"],
                    "eventId": event.get("ID", entry["file"]),
                    "eventName": event.get("Name", event.get("ID", entry["file"])),
                    "effectIndex": index,
                    "referenceType": "option-effect",
                })
    return {"nodeId": target_id, "references": references}


def delete_node(relative):
    if is_global_node_path(relative):
        raise ApiError(HTTPStatus.CONFLICT, tr("Global Node 是固定的全局作用域，不可刪除。"))
    references = node_references(relative)["references"]
    if references:
        raise ApiError(HTTPStatus.CONFLICT, tr("仍有 {count} 個 Event 指向這個節點。", count=len(references)))
    directory = node_path(relative)
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到指定的 Scene Node。"))
    node = read_json(directory / "Node.json", {}) or {}
    if node.get("ID") == configured_root_node():
        raise ApiError(HTTPStatus.CONFLICT, tr("請先將其他 Scene Node 設為 Root，才能刪除目前的起始節點。"))
    trash_root = node_trash_root()
    trash_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    target = trash_root / f"{stamp}-{node.get('ID', directory.name)}"
    transaction = active_undo_transaction()
    if transaction:
        transaction.capture_tree(directory)
        transaction.capture_tree(target)
    shutil.move(str(directory), str(target))
    return {"deleted": True, "backup": str(target), "nodes": dissolve_singleton_node_groups()}


class EditorHandler(BaseHTTPRequestHandler):
    server_version = "SceneNodeEditor/0.1"

    def log_message(self, format_, *args):
        print(f"[{self.log_date_time_string()}] {format_ % args}")

    def send_json(self, data, status=HTTPStatus.OK):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def send_error_json(self, error):
        self.send_json({"error": error.message}, error.status)

    def query(self):
        return parse_qs(urlparse(self.path).query)

    def query_value(self, name, default=""):
        return self.query().get(name, [default])[0]

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/editor-settings":
                self.send_json(validate_editor_settings(read_json(editor_settings_path(), {}) or {}))
                return
            if parsed.path == "/api/project":
                project = scene_project_config()
                graph_data = graph_snapshot(project, include_editor_details=True)
                self.send_json({
                    "projectName": project_display_name(),
                    "projectPath": str(PROJECT_ROOT),
                    "project": project,
                    **graph_data,
                    "stats": read_json(stats_path(), {}) or {},
                    "memories": read_json(memories_path(), {}) or {},
                    "images": scan_image_assets(),
                    "audio": scan_audio_assets(),
                    "textboxProfiles": scan_textbox_profiles(),
                    "optionTargets": scan_option_targets(),
                    "issues": validate_project(),
                })
                return
            if parsed.path == "/api/graph":
                self.send_json(graph_snapshot())
                return
            if parsed.path == "/api/nodes":
                self.send_json({"nodes": scan_nodes()})
                return
            if parsed.path == "/api/textbox-profiles":
                self.send_json({"profiles": scan_textbox_profiles()})
                return
            if parsed.path == "/api/node":
                self.send_json(read_node(self.query_value("path")))
                return
            if parsed.path == "/api/node/references":
                self.send_json(node_references(self.query_value("path")))
                return
            if parsed.path == "/api/options/references":
                detail = read_node(self.query_value("node"))
                node_id = detail.get("node", {}).get("ID")
                element_id = clean_file_name(self.query_value("element"), "")
                item_value = self.query_value("item")
                item_id = clean_file_name(item_value, "") if item_value else None
                self.send_json({
                    "nodeId": node_id,
                    "elementId": element_id,
                    "itemId": item_id,
                    "references": option_effect_references(node_id, element_id, item_id),
                })
                return
            if parsed.path == "/api/content":
                directory = authoring_directory(self.query_value("node")) / CONTENT_DIR
                name = clean_file_name(self.query_value("name"), ".rpy")
                path = directory / f"{name}.rpy"
                if not path.exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到 Content 文件。"))
                source = path.read_text(encoding="utf-8")
                self.send_json({"name": name, "displayName": source_display_name(source, name), "source": source})
                return
            if parsed.path == "/api/validate":
                self.send_json({"issues": validate_project()})
                return
            if parsed.path == "/api/asset":
                self.serve_project_asset(self.query_value("path"))
                return
            if parsed.path.startswith("/api/"):
                raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到 API。"))
            self.serve_static(parsed.path)
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover - final safety net for a local tool
            self.send_json({"error": tr("未預期的錯誤：{exc}", exc=exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            payload = read_body(self)
            if parsed.path == "/api/undo":
                self.send_json(perform_undo())
                return
            if parsed.path == "/api/nodes":
                with undo_transaction(parsed.path):
                    result = create_node(payload)
                self.send_json(result, HTTPStatus.CREATED)
                return
            if parsed.path == "/api/events":
                with undo_transaction(parsed.path):
                    result = save_event(payload)
                self.send_json(result)
                return
            if parsed.path == "/api/textbox-profiles":
                with undo_transaction(parsed.path):
                    result = create_textbox_profile(payload)
                self.send_json(result, HTTPStatus.CREATED)
                return
            if parsed.path == "/api/content":
                directory = authoring_directory(payload.get("node"))
                if not (directory / "Node.json").exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到指定的 authoring scope。"))
                with undo_transaction(parsed.path):
                    result = save_content_file(directory / CONTENT_DIR, payload)
                self.send_json(result)
                return
            raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到 API。"))
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover
            self.send_json({"error": tr("未預期的錯誤：{exc}", exc=exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_PUT(self):
        try:
            parsed = urlparse(self.path)
            payload = read_body(self)
            if parsed.path == "/api/editor-settings":
                settings = validate_editor_settings(payload)
                write_json(editor_settings_path(), settings)
                self.send_json(settings)
                return
            if parsed.path == "/api/stats":
                stats = validate_stats(payload.get("stats"))
                with undo_transaction(parsed.path):
                    write_json(stats_path(), stats)
                self.send_json({"stats": stats})
                return
            if parsed.path == "/api/state":
                stats = validate_stats(payload.get("stats"))
                memories = validate_memories(payload.get("memories"))
                with undo_transaction(parsed.path):
                    write_json(stats_path(), stats)
                    write_json(memories_path(), memories)
                self.send_json({"stats": stats, "memories": memories})
                return
            if parsed.path == "/api/node":
                with undo_transaction(parsed.path):
                    result = save_node(payload)
                self.send_json(result)
                return
            if parsed.path == "/api/nodes/order":
                with undo_transaction(parsed.path):
                    result = save_node_order(payload)
                self.send_json(result)
                return
            if parsed.path == "/api/node-groups":
                with undo_transaction(parsed.path):
                    result = save_node_groups(payload)
                self.send_json(result)
                return
            if parsed.path == "/api/project/root":
                with undo_transaction(parsed.path):
                    result = save_root_node(payload)
                self.send_json(result)
                return
            if parsed.path == "/api/options":
                global_scope = is_global_node_path(payload.get("node"))
                directory = authoring_directory(payload.get("node"))
                if not (directory / "Node.json").exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到指定的 authoring scope。"))
                with undo_transaction(parsed.path):
                    result = {"saved": True}
                    if "options" in payload:
                        previous = validate_options(read_json(directory / OPTIONS_FILE, default_options()))
                        options = validate_options(payload.get("options"))
                        node = read_json(directory / "Node.json", {}) or {}
                        node_id = GLOBAL_NODE_ID if global_scope else node.get("ID")
                        validate_option_target_removals(node_id, previous, options)
                        write_json(directory / OPTIONS_FILE, options)
                        result["options"] = options
                        result["optionTargets"] = scan_option_targets()
                self.send_json(result)
                return
            if parsed.path == "/api/textbox-profiles":
                with undo_transaction(parsed.path):
                    result = save_textbox_profile(payload)
                self.send_json(result)
                return
            if parsed.path == "/api/textbox-profiles/order":
                with undo_transaction(parsed.path):
                    result = save_textbox_profile_order(payload)
                self.send_json(result)
                return
            if parsed.path == "/api/content/order":
                with undo_transaction(parsed.path):
                    result = save_content_order(payload)
                self.send_json(result)
                return
            if parsed.path == "/api/event-groups":
                with undo_transaction(parsed.path):
                    result = rename_event_group(payload)
                self.send_json(result)
                return
            raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到 API。"))
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover
            self.send_json({"error": tr("未預期的錯誤：{exc}", exc=exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/events":
                directory = authoring_directory(self.query_value("node")) / EVENT_DIR
                event_id = clean_file_name(self.query_value("id"), ".json")
                target = directory / f"{event_id}.json"
            elif parsed.path == "/api/nodes":
                with undo_transaction(parsed.path):
                    result = delete_node(self.query_value("path"))
                self.send_json(result)
                return
            elif parsed.path == "/api/textbox-profiles":
                with undo_transaction(parsed.path):
                    result = delete_textbox_profile(self.query_value("id"))
                self.send_json(result)
                return
            elif parsed.path == "/api/content":
                directory = authoring_directory(self.query_value("node")) / CONTENT_DIR
                name = clean_file_name(self.query_value("name"), ".rpy")
                target = directory / f"{name}.rpy"
            else:
                raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到 API。"))
            if not target.exists():
                raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到要刪除的文件。"))
            with undo_transaction(parsed.path):
                undoable_unlink(target)
                if parsed.path == "/api/content":
                    node_file = directory.parent / "Node.json"
                    node = read_json(node_file, {}) or {}
                    order = node.get("Content Order") if isinstance(node.get("Content Order"), list) else []
                    node["Content Order"] = [entry for entry in order if entry != name]
                    write_json(node_file, node)
                response = {"deleted": True}
                if parsed.path == "/api/events":
                    response["events"] = dissolve_singleton_event_groups(directory.parent)
            self.send_json(response)
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover
            self.send_json({"error": tr("未預期的錯誤：{exc}", exc=exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def serve_static(self, request_path):
        relative = unquote(request_path).lstrip("/") or "index.html"
        path = (STATIC_ROOT / relative).resolve()
        if STATIC_ROOT not in path.parents and path != STATIC_ROOT:
            raise ApiError(HTTPStatus.FORBIDDEN, tr("無法存取這個路徑。"))
        if not path.exists() or not path.is_file():
            path = STATIC_ROOT / "index.html"
        content = path.read_bytes()
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def serve_project_asset(self, raw_path):
        relative = clean_asset_path(raw_path)
        if not relative:
            raise ApiError(HTTPStatus.BAD_REQUEST, tr("資源路徑不可為空。"))
        path = (PROJECT_ROOT / Path(relative)).resolve()
        if PROJECT_ROOT not in path.parents:
            raise ApiError(HTTPStatus.FORBIDDEN, tr("無法存取這個資源。"))
        if not path.exists() or not path.is_file() or path.suffix.casefold() not in IMAGE_EXTENSIONS:
            raise ApiError(HTTPStatus.NOT_FOUND, tr("找不到圖片資源。"))
        content = path.read_bytes()
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)


def parse_args():
    parser = argparse.ArgumentParser(description="Scene Node browser editor")
    parser.add_argument("--project", default=str(EDITOR_ROOT.parent), help="Ren'Py project content root")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args()


def main():
    global PROJECT_ROOT
    args = parse_args()
    PROJECT_ROOT = Path(args.project).expanduser().resolve()
    PROJECT_ROOT.mkdir(parents=True, exist_ok=True)
    ensure_project_structure()
    server = ThreadingHTTPServer((args.host, args.port), EditorHandler)
    print(f"Scene Node Editor: http://{args.host}:{args.port}")
    print(f"Project: {PROJECT_ROOT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
