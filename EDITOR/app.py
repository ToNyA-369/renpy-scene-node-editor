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
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlparse

from project_bootstrap import (
    DEFAULT_MEMORY_ID,
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
SCREEN_DIR = "SCENESCREEN"
EVENT_DIR = "EVENTPOOL"
CONTENT_DIR = "CONTENT"
OPTIONS_FILE = "Options.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".avif"}

LABEL_RE = re.compile(r"^\s*label\s+([A-Za-z_][A-Za-z0-9_.]*)\s*:", re.MULTILINE)
SCREEN_RE = re.compile(r"^\s*screen\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:", re.MULTILINE)
DISPLAY_NAME_RE = re.compile(r"^\s*#\s*@display_name:\s*(.+?)\s*$", re.MULTILINE)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def ensure_project_structure():
    for name in (DATA_DIR, NODE_DIR, SCREEN_DIR):
        (PROJECT_ROOT / name).mkdir(parents=True, exist_ok=True)

    stats_path = PROJECT_ROOT / DATA_DIR / "Stats.json"
    if not stats_path.exists():
        write_json(stats_path, {})
    initialize_scene_project(PROJECT_ROOT)


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(str(temporary), str(path))


def write_json(path, data):
    atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def read_json(path, default=None):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, f"無法讀取 {path.name}: {exc}")


def clean_file_name(value, suffix):
    name = str(value or "").strip()
    if suffix and name.endswith(suffix):
        name = name[: -len(suffix)]
    if not name or name in (".", "..") or any(char in name for char in ("/", "\\", "\0")):
        raise ApiError(HTTPStatus.BAD_REQUEST, "名稱不可為空，也不可包含路徑符號。")
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
        raise ApiError(HTTPStatus.BAD_REQUEST, "Scene Node 路徑不可為空。")
    path = PurePosixPath(raw)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Scene Node 路徑不合法。")
    return path.as_posix()


def node_path(relative):
    return PROJECT_ROOT / NODE_DIR / Path(clean_node_path(relative))


def stats_path():
    return PROJECT_ROOT / DATA_DIR / "Stats.json"


def memories_path():
    return PROJECT_ROOT / MEMORIES_RELATIVE


def scene_project_path():
    return PROJECT_ROOT / PROJECT_CONFIG_RELATIVE


def scene_project_config():
    return read_json(scene_project_path(), {}) or {}


def configured_root_node():
    return str(scene_project_config().get("Root Node") or "").strip() or None


def default_options():
    return {
        "Version": 1,
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
        raise ApiError(HTTPStatus.BAD_REQUEST, "資源路徑不合法。")
    return path.as_posix()


def number_setting(value, fallback, field, minimum=None, maximum=None, integer=False):
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 必須是數字。")
    if minimum is not None and result < minimum:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 不可小於 {minimum}。")
    if maximum is not None and result > maximum:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 不可大於 {maximum}。")
    if integer:
        return int(result)
    return int(result) if result.is_integer() else result


def validate_option_conditions(value, field):
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 必須是 object 陣列。")
    return [validate_condition(item, field) for item in value]


def validate_condition(condition, field="Condition"):
    result = dict(condition)
    condition_type = str(result.get("type") or "stat").lower()
    if condition_type == "tag":
        condition_type = "memory"
    result["type"] = condition_type

    if condition_type == "stat":
        result["id"] = clean_file_name(result.get("id"), "")
        operation = str(result.get("op") or ">=")
        if operation not in (">", ">=", "<", "<=", "==", "!="):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的 Stat 判斷不合法。")
        result["op"] = operation
        result["value"] = number_setting(result.get("value", 0), 0, f"{field} 的值")
        result.pop("bank", None)
        return result

    if condition_type == "memory":
        result["bank"] = clean_file_name(result.get("bank") or DEFAULT_MEMORY_ID, "")
        tag_id = str(result.get("id") or "").strip()
        if not tag_id:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的記憶標籤不可為空。")
        result["id"] = tag_id
        operation = str(result.get("op") or "has")
        if operation not in ("has", "not_has"):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的記憶判斷不合法。")
        result["op"] = operation
        result.pop("value", None)
        result.pop("scope", None)
        return result

    raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的類型不合法：{condition_type}。")


def validate_effect(effect, field="Effect"):
    result = dict(effect)
    effect_type = str(result.get("type") or "stat").lower()
    if effect_type == "tag":
        effect_type = "memory"
    result["type"] = effect_type

    if effect_type == "stat":
        result["id"] = clean_file_name(result.get("id"), "")
        operation = str(result.get("op") or "+")
        if operation not in ("set", "+", "-", "*", "/"):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的 Stat 操作不合法。")
        result["op"] = operation
        result["value"] = number_setting(result.get("value", 0), 0, f"{field} 的值")
        result.pop("bank", None)
        return result

    if effect_type == "memory":
        result["bank"] = clean_file_name(result.get("bank") or DEFAULT_MEMORY_ID, "")
        operation = str(result.get("op") or "add")
        if operation not in ("add", "remove", "clear"):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的記憶操作不合法。")
        result["op"] = operation
        if operation == "clear":
            result.pop("id", None)
        else:
            tag_id = str(result.get("id") or "").strip()
            if not tag_id:
                raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的記憶標籤不可為空。")
            result["id"] = tag_id
        result.pop("scope", None)
        result.pop("value", None)
        return result

    if effect_type in ("bgm", "se"):
        operation = str(result.get("op") or "play").lower()
        if operation not in ("play", "stop"):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的音效操作不合法。")
        result["op"] = operation
        if operation == "play" and not str(result.get("id") or "").strip():
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的資源 ID 不可為空。")
        return result

    raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的類型不合法：{effect_type}。")


def validate_option_style_override(value):
    if not isinstance(value, dict):
        return {}
    result = {}
    color_fields = (
        "Item Background",
        "Item Hover Background",
        "Item Disabled Background",
        "Text Color",
        "Text Hover Color",
        "Text Disabled Color",
    )
    for field in color_fields:
        if field in value:
            result[field] = str(value[field])
    if "Text Size" in value:
        result["Text Size"] = number_setting(value["Text Size"], 30, "Item Text Size", minimum=8, maximum=160, integer=True)
    if "Text Align" in value:
        result["Text Align"] = number_setting(value["Text Align"], 0.5, "Item Text Align", minimum=0, maximum=1)
    return result


def validate_option_item(item):
    if not isinstance(item, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Text Box Item 必須是 object。")
    item_id = clean_file_name(item.get("ID") or generate_id("option"), "")
    trigger = str(item.get("Trigger") or "").strip()
    if not trigger:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Text Box Item {item_id} 的 Trigger 不可為空。")
    return {
        "ID": item_id,
        "Name": str(item.get("Name") or item.get("Text") or item_id),
        "Text": str(item.get("Text") or item.get("Name") or item_id),
        "Trigger": trigger,
        "Visible Conditions": validate_option_conditions(item.get("Visible Conditions"), "Visible Conditions"),
        "Enabled Conditions": validate_option_conditions(item.get("Enabled Conditions"), "Enabled Conditions"),
        "Tooltip": str(item.get("Tooltip") or ""),
        "Icon": clean_asset_path(item.get("Icon")),
        "Style Override": validate_option_style_override(item.get("Style Override")),
    }


def validate_option_element(element):
    if not isinstance(element, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Option Element 必須是 object。")
    element_id = clean_file_name(element.get("ID") or generate_id("option_element"), "")
    element_type = str(element.get("Type") or "TEXTBOX").upper()
    if element_type not in ("TEXTBOX", "PICTURE", "HITBOX"):
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Option Element {element_id} 的 Type 不合法。")

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
        "Layout": layout,
        "Visible Conditions": validate_option_conditions(element.get("Visible Conditions"), "Visible Conditions"),
        "Enabled Conditions": validate_option_conditions(element.get("Enabled Conditions"), "Enabled Conditions"),
    }

    if element_type == "TEXTBOX":
        raw_list = element.get("List") if isinstance(element.get("List"), dict) else {}
        scrollbar = str(raw_list.get("Scrollbar") or "AUTO").upper()
        if scrollbar not in ("AUTO", "HIDDEN", "ALWAYS"):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Scrollbar 必須是 AUTO、HIDDEN 或 ALWAYS。")
        remember_scroll = str(raw_list.get("Remember Scroll") or "RESET").upper()
        if remember_scroll not in ("RESET", "NODE"):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Remember Scroll 必須是 RESET 或 NODE。")
        result["List"] = {
            "Max Visible Items": number_setting(raw_list.get("Max Visible Items", 4), 4, "Max Visible Items", minimum=1, maximum=20, integer=True),
            "Item Height": number_setting(raw_list.get("Item Height", 72), 72, "Item Height", minimum=24, maximum=300, integer=True),
            "Item Spacing": number_setting(raw_list.get("Item Spacing", 12), 12, "Item Spacing", minimum=0, maximum=100, integer=True),
            "Padding": number_setting(raw_list.get("Padding", 16), 16, "Padding", minimum=0, maximum=200, integer=True),
            "Scrollbar": scrollbar,
            "Scrollbar Width": number_setting(raw_list.get("Scrollbar Width", 18), 18, "Scrollbar Width", minimum=4, maximum=80, integer=True),
            "Scrollbar Side": "LEFT" if str(raw_list.get("Scrollbar Side")).upper() == "LEFT" else "RIGHT",
            "Mousewheel": bool(raw_list.get("Mousewheel", True)),
            "Draggable": bool(raw_list.get("Draggable", True)),
            "Remember Scroll": remember_scroll,
        }
        raw_style = element.get("Style") if isinstance(element.get("Style"), dict) else {}
        result["Style"] = {
            "Background": str(raw_style.get("Background") or "#0b1118"),
            "Item Background": str(raw_style.get("Item Background") or "#20302a"),
            "Item Hover Background": str(raw_style.get("Item Hover Background") or "#2d8068"),
            "Item Disabled Background": str(raw_style.get("Item Disabled Background") or "#29312e"),
            "Text Color": str(raw_style.get("Text Color") or "#ffffff"),
            "Text Hover Color": str(raw_style.get("Text Hover Color") or "#ffffff"),
            "Text Disabled Color": str(raw_style.get("Text Disabled Color") or "#8b948f"),
            "Text Size": number_setting(raw_style.get("Text Size", 30), 30, "Text Size", minimum=8, maximum=160, integer=True),
            "Text Align": number_setting(raw_style.get("Text Align", 0.5), 0.5, "Text Align", minimum=0, maximum=1),
        }
        items = element.get("Items") if isinstance(element.get("Items"), list) else []
        result["Items"] = [validate_option_item(item) for item in items]
        item_ids = [item["ID"] for item in result["Items"]]
        if len(item_ids) != len(set(item_ids)):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Text Box {element_id} 內有重複的 Item ID。")
    elif element_type == "PICTURE":
        raw_picture = element.get("Picture") if isinstance(element.get("Picture"), dict) else {}
        fit = str(raw_picture.get("Fit") or "CONTAIN").upper()
        if fit not in ("CONTAIN", "COVER", "STRETCH"):
            fit = "CONTAIN"
        result["Trigger"] = str(element.get("Trigger") or "").strip()
        if not result["Trigger"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Picture {element_id} 的 Trigger 不可為空。")
        result["Tooltip"] = str(element.get("Tooltip") or "")
        result["Picture"] = {
            "Idle": clean_asset_path(raw_picture.get("Idle")),
            "Hover": clean_asset_path(raw_picture.get("Hover")),
            "Pressed": clean_asset_path(raw_picture.get("Pressed")),
            "Disabled": clean_asset_path(raw_picture.get("Disabled")),
            "Fit": fit,
            "Keep Aspect": bool(raw_picture.get("Keep Aspect", True)),
            "Alpha Hit Test": bool(raw_picture.get("Alpha Hit Test", False)),
            "Opacity": number_setting(raw_picture.get("Opacity", 1), 1, "Opacity", minimum=0, maximum=1),
            "Tint": str(raw_picture.get("Tint") or "#ffffff"),
            "Hover Scale": number_setting(raw_picture.get("Hover Scale", 1), 1, "Hover Scale", minimum=0.1, maximum=5),
        }
        result["Hover Sound"] = clean_asset_path(element.get("Hover Sound"))
        result["Click Sound"] = clean_asset_path(element.get("Click Sound"))
    else:
        raw_hitbox = element.get("Hitbox") if isinstance(element.get("Hitbox"), dict) else {}
        result["Trigger"] = str(element.get("Trigger") or "").strip()
        if not result["Trigger"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Hitbox {element_id} 的 Trigger 不可為空。")
        result["Tooltip"] = str(element.get("Tooltip") or "")
        result["Hitbox"] = {
            "Editor Color": str(raw_hitbox.get("Editor Color") or "#28a47d"),
            "Editor Opacity": number_setting(raw_hitbox.get("Editor Opacity", 0.24), 0.24, "Editor Opacity", minimum=0, maximum=1),
            "Hover Image": clean_asset_path(raw_hitbox.get("Hover Image")),
            "Cursor": str(raw_hitbox.get("Cursor") or "pointer"),
        }
        result["Hover Sound"] = clean_asset_path(element.get("Hover Sound"))
        result["Click Sound"] = clean_asset_path(element.get("Click Sound"))
    return result


def validate_options(data):
    if data is None:
        return default_options()
    if not isinstance(data, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Options.json 必須是 object。")
    raw_canvas = data.get("Canvas") if isinstance(data.get("Canvas"), dict) else {}
    elements = data.get("Elements") if isinstance(data.get("Elements"), list) else []
    result = {
        "Version": 1,
        "Canvas": {
            "Width": number_setting(raw_canvas.get("Width", 1920), 1920, "Canvas Width", minimum=320, maximum=7680, integer=True),
            "Height": number_setting(raw_canvas.get("Height", 1080), 1080, "Canvas Height", minimum=180, maximum=4320, integer=True),
            "Preview Background": clean_asset_path(raw_canvas.get("Preview Background")),
        },
        "Elements": [validate_option_element(element) for element in elements],
    }
    element_ids = [element["ID"] for element in result["Elements"]]
    if len(element_ids) != len(set(element_ids)):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Options.json 內有重複的 Element ID。")
    return result


def option_triggers(options):
    triggers = []
    for element in options.get("Elements", []):
        if element.get("Type") == "TEXTBOX":
            triggers.extend(item.get("Trigger") for item in element.get("Items", []))
        else:
            triggers.append(element.get("Trigger"))
    return [trigger for trigger in triggers if trigger]


def scan_image_assets():
    ignored = {"cache", "saves", "tl"}
    assets = []
    for path in PROJECT_ROOT.rglob("*"):
        if not path.is_file() or path.suffix.casefold() not in IMAGE_EXTENSIONS:
            continue
        relative = path.relative_to(PROJECT_ROOT)
        if any(part.casefold() in ignored for part in relative.parts):
            continue
        assets.append(relative.as_posix())
    return sorted(assets, key=str.casefold)


def node_summary(directory):
    node_file = directory / "Node.json"
    parse_error = None
    try:
        data = read_json(node_file, {}) or {}
    except ApiError as exc:
        data = {}
        parse_error = exc.message
    relative = directory.relative_to(PROJECT_ROOT / NODE_DIR).as_posix()
    events = list((directory / EVENT_DIR).glob("*.json")) if (directory / EVENT_DIR).exists() else []
    contents = list((directory / CONTENT_DIR).glob("*.rpy")) if (directory / CONTENT_DIR).exists() else []
    try:
        raw_options = read_json(directory / OPTIONS_FILE, default_options()) or default_options()
    except ApiError as exc:
        raw_options = default_options()
        parse_error = f"{parse_error}; {exc.message}" if parse_error else exc.message
    option_elements = raw_options.get("Elements", []) if isinstance(raw_options, dict) else []
    return {
        "path": relative,
        "id": data.get("ID", directory.name),
        "name": data.get("Name", data.get("ID", directory.name)),
        "background": data.get("Background", ""),
        "screen": data.get("Screen", ""),
        "eventCount": len(events),
        "contentCount": len(contents),
        "optionCount": len(option_elements),
        "parseError": parse_error,
    }


def scan_nodes():
    root = PROJECT_ROOT / NODE_DIR
    nodes = [node_summary(path.parent) for path in root.rglob("Node.json")]
    try:
        root_node = configured_root_node()
    except ApiError:
        root_node = None
    for node in nodes:
        node["isRoot"] = bool(root_node and node["id"] == root_node)
    return sorted(nodes, key=lambda item: (item["path"].casefold(), item["id"].casefold()))


def scan_rpy_files(root):
    if not root.exists():
        return []
    files = []
    for path in sorted(root.glob("*.rpy"), key=lambda value: value.name.casefold()):
        source = path.read_text(encoding="utf-8")
        files.append({
            "name": path.stem,
            "displayName": source_display_name(source, path.stem),
            "file": path.name,
            "labels": LABEL_RE.findall(source),
            "screens": SCREEN_RE.findall(source),
        })
    return files


def read_node(relative):
    directory = node_path(relative)
    node_file = directory / "Node.json"
    if not node_file.exists():
        raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Scene Node。")

    events = []
    event_root = directory / EVENT_DIR
    if event_root.exists():
        for path in sorted(event_root.glob("*.json"), key=lambda value: value.name.casefold()):
            event = read_json(path, {}) or {}
            events.append({"file": path.name, "data": event})

    option_file = directory / "SCENEOPTION.rpy"
    option_source = option_file.read_text(encoding="utf-8") if option_file.exists() else ""
    options = validate_options(read_json(directory / OPTIONS_FILE, default_options()))
    return {
        "path": clean_node_path(relative),
        "node": read_json(node_file, {}) or {},
        "events": events,
        "optionSource": option_source,
        "options": options,
        "contents": scan_rpy_files(directory / CONTENT_DIR),
    }


def scan_screens():
    return scan_rpy_files(PROJECT_ROOT / SCREEN_DIR)


def read_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Content-Length 不合法。")
    raw = handler.rfile.read(length) if length else b"{}"
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ApiError(HTTPStatus.BAD_REQUEST, "請求內容不是有效的 JSON。")


def validate_stats(data):
    if not isinstance(data, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Stats 必須是 JSON object。")
    result = {}
    for raw_id, settings in data.items():
        stat_id = clean_file_name(raw_id, "")
        if not isinstance(settings, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Stat {stat_id} 的設定必須是 object。")
        try:
            minimum = float(settings.get("Min", 0))
            maximum = float(settings.get("Max", 0))
            initial = float(settings.get("Init", 0))
        except (TypeError, ValueError):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Stat {stat_id} 的 Min、Max、Init 必須是數字。")
        if minimum > maximum:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Stat {stat_id} 的 Min 不可大於 Max。")
        if not minimum <= initial <= maximum:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Stat {stat_id} 的 Init 必須位於 Min 與 Max 之間。")

        values = (settings.get("Min"), settings.get("Max"), settings.get("Init"))
        if all(isinstance(value, int) and not isinstance(value, bool) for value in values):
            minimum, maximum, initial = int(minimum), int(maximum), int(initial)
        result[stat_id] = {
            "Name": str(settings.get("Name") or stat_id),
            "Max": maximum,
            "Min": minimum,
            "Init": initial,
        }
    return result


def validate_memories(data):
    if not isinstance(data, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Memories 必須是 JSON object。")
    result = {}
    for raw_id, settings in data.items():
        bank_id = clean_file_name(raw_id, "")
        if not isinstance(settings, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"記憶庫 {bank_id} 的設定必須是 object。")
        name = str(settings.get("Name") or "").strip()
        if not name:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"記憶庫 {bank_id} 的名稱不可為空。")
        result[bank_id] = {"Name": name}
    if DEFAULT_MEMORY_ID not in result:
        raise ApiError(HTTPStatus.BAD_REQUEST, "不可移除預設 Memory 記憶庫。")
    result[DEFAULT_MEMORY_ID]["Name"] = "Memory"
    return result


def validate_weight_map(value, field):
    if value is None:
        return
    if isinstance(value, str):
        if not value.strip():
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 名稱不可為空。")
        return
    if not isinstance(value, dict) or not value:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 必須是 null、字串或非空權重表。")
    for key, weight in value.items():
        clean_file_name(key, "")
        if not isinstance(weight, (int, float)) or isinstance(weight, bool) or weight <= 0:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的權重必須大於 0。")


def validate_event(event):
    if not isinstance(event, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Event 必須是 JSON object。")
    event_id = clean_file_name(event.get("ID") or generate_id("event"), ".json")
    trigger = str(event.get("Trigger") or "").strip()
    if not trigger:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Event Trigger 不可為空。")

    priority = event.get("Priority", 5)
    weight = event.get("Weight", 1)
    if not isinstance(priority, int) or isinstance(priority, bool) or not 0 <= priority <= 5:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Priority 必須是 0 到 5 的整數。")
    if not isinstance(weight, (int, float)) or isinstance(weight, bool) or weight <= 0:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Weight 必須大於 0。")

    conditions = event.get("Conditions", [])
    effects = event.get("Effects", [])
    if not isinstance(conditions, list) or not all(isinstance(item, dict) for item in conditions):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Conditions 必須是 object 陣列。")
    if not isinstance(effects, list) or not all(isinstance(item, dict) for item in effects):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Effects 必須是 object 陣列。")

    content = event.get("Content")
    end_up = event.get("End up", "REDO")
    next_node = event.get("Next Node")
    validate_weight_map(content, "Content")
    validate_weight_map(next_node, "Next Node")
    if end_up not in ("REDO", "GOTO", "EXIT"):
        raise ApiError(HTTPStatus.BAD_REQUEST, "End up 必須是 REDO、GOTO 或 EXIT。")
    if end_up == "GOTO" and next_node is None:
        raise ApiError(HTTPStatus.BAD_REQUEST, "GOTO Event 必須設定 Next Node。")

    return {
        "ID": event_id,
        "Name": str(event.get("Name") or event_id),
        "Trigger": trigger,
        "Priority": priority,
        "Weight": weight,
        "Once": bool(event.get("Once", False)),
        "Conditions": [validate_condition(item, "Event Condition") for item in conditions],
        "Effects": [validate_effect(item, "Event Effect") for item in effects],
        "Content": content,
        "End up": end_up,
        "Next Node": next_node if end_up == "GOTO" else None,
    }


def all_rpy_symbols():
    labels = set()
    screens = set()
    for path in PROJECT_ROOT.rglob("*.rpy"):
        if EDITOR_ROOT in path.parents:
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except OSError:
            continue
        labels.update(LABEL_RE.findall(source))
        screens.update(SCREEN_RE.findall(source))
    return labels, screens


def validate_project():
    issues = []
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
    labels, screens = all_rpy_symbols()
    seen_node_ids = set()

    if scene_project_path().exists():
        try:
            root_node = configured_root_node()
        except ApiError as exc:
            issues.append({"level": "error", "location": PROJECT_CONFIG_RELATIVE.as_posix(), "message": exc.message})
            root_node = None
        if not root_node:
            issues.append({"level": "error", "location": PROJECT_CONFIG_RELATIVE.as_posix(), "message": "尚未設定 Root Node。"})
        elif root_node not in node_ids:
            issues.append({"level": "error", "location": PROJECT_CONFIG_RELATIVE.as_posix(), "message": f"找不到 Root Node：{root_node}。"})
        else:
            calls = runtime_start_calls(PROJECT_ROOT)
            if not calls["configured"] and root_node not in calls["explicitNodes"]:
                issues.append({
                    "level": "warning",
                    "location": "script.rpy",
                    "message": "Root Node 尚未連接到 scene_runtime_start()。",
                })

    for summary in nodes:
        node_id = summary["id"]
        location = f"SCENENODE/{summary['path']}"
        if summary.get("parseError"):
            issues.append({"level": "error", "location": location, "message": summary["parseError"]})
            continue
        if node_id in seen_node_ids:
            issues.append({"level": "error", "location": location, "message": f"Node ID {node_id} 重複。"})
        seen_node_ids.add(node_id)
        if summary["screen"] and summary["screen"] not in screens:
            issues.append({"level": "warning", "location": location, "message": f"找不到 Screen：{summary['screen']}。"})

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
                    "message": f"選項 Trigger {trigger} 沒有對應的 Event。",
                })

        for entry in detail["events"]:
            event_location = f"{location}/{EVENT_DIR}/{entry['file']}"
            try:
                event = validate_event(entry["data"])
            except ApiError as exc:
                issues.append({"level": "error", "location": event_location, "message": exc.message})
                continue
            if entry["file"] != event["ID"] + ".json":
                issues.append({"level": "warning", "location": event_location, "message": "檔名與 Event ID 不一致。"})

            for condition in event["Conditions"]:
                if condition.get("type") == "stat" and condition.get("id") not in stats:
                    issues.append({"level": "warning", "location": event_location, "message": f"找不到 Stat：{condition.get('id', '')}。"})
                if condition.get("type") == "memory" and condition.get("bank") not in memories:
                    issues.append({"level": "warning", "location": event_location, "message": f"找不到記憶庫：{condition.get('bank', '')}。"})
            for effect in event["Effects"]:
                if effect.get("type") == "stat" and effect.get("id") not in stats:
                    issues.append({"level": "warning", "location": event_location, "message": f"找不到 Stat：{effect.get('id', '')}。"})
                if effect.get("type") == "memory" and effect.get("bank") not in memories:
                    issues.append({"level": "warning", "location": event_location, "message": f"找不到記憶庫：{effect.get('bank', '')}。"})

            content = event["Content"]
            content_names = [content] if isinstance(content, str) else list(content or {})
            for label in content_names:
                if label not in labels:
                    issues.append({"level": "warning", "location": event_location, "message": f"找不到 Content label：{label}。"})

            target = event["Next Node"]
            target_names = [target] if isinstance(target, str) else list(target or {})
            for target_id in target_names:
                if target_id not in node_ids:
                    issues.append({"level": "warning", "location": event_location, "message": f"找不到 Next Node：{target_id}。"})

        for element in detail["options"].get("Elements", []):
            condition_groups = [
                element.get("Visible Conditions", []),
                element.get("Enabled Conditions", []),
            ]
            for item in element.get("Items", []):
                condition_groups.extend([
                    item.get("Visible Conditions", []),
                    item.get("Enabled Conditions", []),
                ])
            for condition in (item for group in condition_groups for item in group):
                if condition.get("type") == "stat" and condition.get("id") not in stats:
                    issues.append({"level": "warning", "location": f"{location}/{OPTIONS_FILE}", "message": f"找不到 Stat：{condition.get('id', '')}。"})
                if condition.get("type") == "memory" and condition.get("bank") not in memories:
                    issues.append({"level": "warning", "location": f"{location}/{OPTIONS_FILE}", "message": f"找不到記憶庫：{condition.get('bank', '')}。"})

    return issues


def create_node(payload):
    node_id = clean_file_name(payload.get("id") or generate_id("node"), "")
    relative = clean_node_path(payload.get("path") or node_id)
    directory = node_path(relative)
    if directory.exists() and any(directory.iterdir()):
        raise ApiError(HTTPStatus.CONFLICT, "這個 Scene Node 路徑已經存在。")

    node_name = str(payload.get("name") or node_id).strip() or node_id
    custom_option_screen = str(payload.get("optionScreen") or f"option_{node_id}")
    directory.mkdir(parents=True, exist_ok=True)
    (directory / EVENT_DIR).mkdir(exist_ok=True)
    (directory / CONTENT_DIR).mkdir(exist_ok=True)
    write_json(directory / "Node.json", {
        "ID": node_id,
        "Name": node_name,
        "Background": str(payload.get("background") or ""),
        "Screen": str(payload.get("screen") or ""),
        "Option Mode": "DATA",
        "Option Screen": "scene_option_renderer",
    })
    write_json(directory / OPTIONS_FILE, default_options())
    option_file = directory / "SCENEOPTION.rpy"
    if not option_file.exists():
        option_source = (
            f"screen {custom_option_screen}():\n"
            "    textbutton \"範例選項\" action Return(\"Action:example\")\n"
        )
        atomic_write(option_file, option_source)
    return node_summary(directory)


def save_node(payload):
    relative = clean_node_path(payload.get("path"))
    directory = node_path(relative)
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Scene Node。")
    node = payload.get("node") or {}
    node_id = clean_file_name(node.get("ID"), "")
    existing = read_json(directory / "Node.json", {}) or {}
    write_json(directory / "Node.json", {
        "ID": node_id,
        "Name": str(node.get("Name") or node_id),
        "Background": str(node.get("Background") or ""),
        "Screen": str(node.get("Screen") or ""),
        "Option Mode": str(node.get("Option Mode") or existing.get("Option Mode") or "DATA"),
        "Option Screen": str(node.get("Option Screen") or existing.get("Option Screen") or f"option_{node_id}"),
    })
    return node_summary(directory)


def save_root_node(payload):
    node_id = clean_file_name(payload.get("nodeId"), "")
    if node_id not in {item["id"] for item in scan_nodes()}:
        raise ApiError(HTTPStatus.NOT_FOUND, "找不到要設為 Root 的 Scene Node。")
    config = scene_project_config()
    config["Version"] = 1
    config["Root Node"] = node_id
    write_json(scene_project_path(), config)
    return {"rootNodeId": node_id, "project": config}


def save_event(payload):
    directory = node_path(payload.get("node"))
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Scene Node。")
    event = validate_event(payload.get("event"))
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
                raise ApiError(HTTPStatus.CONFLICT, "新的 Event ID 已經存在。")
            old_path_to_remove = old_path
    target = event_root / f"{event['ID']}.json"
    if not original and target.exists():
        raise ApiError(HTTPStatus.CONFLICT, "這個 Event ID 已經存在。")
    write_json(target, event)
    if old_path_to_remove and old_path_to_remove.exists():
        old_path_to_remove.unlink()
    return event


def save_source_file(root, payload, kind):
    name = clean_file_name(payload.get("id") or payload.get("name") or generate_id("content" if kind == "Content" else "screen"), ".rpy")
    original = payload.get("originalName")
    source = payload.get("source")
    if not isinstance(source, str):
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{kind} 內容必須是文字。")
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
                raise ApiError(HTTPStatus.CONFLICT, f"{kind} 名稱已經存在。")
            old_path_to_remove = old_path
    elif target.exists():
        raise ApiError(HTTPStatus.CONFLICT, f"{kind} 名稱已經存在。")
    atomic_write(target, source.rstrip() + "\n")
    if old_path_to_remove and old_path_to_remove.exists():
        old_path_to_remove.unlink()
    return {"name": name, "displayName": display_name, "file": target.name}


def node_references(relative):
    target = read_node(relative)
    target_id = target["node"].get("ID")
    references = []
    for summary in scan_nodes():
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
    return {"nodeId": target_id, "references": references}


def delete_node(relative):
    references = node_references(relative)["references"]
    if references:
        raise ApiError(HTTPStatus.CONFLICT, f"仍有 {len(references)} 個 Event 指向這個節點。")
    directory = node_path(relative)
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Scene Node。")
    node = read_json(directory / "Node.json", {}) or {}
    if node.get("ID") == configured_root_node():
        raise ApiError(HTTPStatus.CONFLICT, "請先將其他 Scene Node 設為 Root，才能刪除目前的起始節點。")
    project_base = PROJECT_ROOT.parent if PROJECT_ROOT.name.casefold() == "game" else PROJECT_ROOT
    trash_root = project_base / ".scene-node-trash"
    trash_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    target = trash_root / f"{stamp}-{node.get('ID', directory.name)}"
    shutil.move(str(directory), str(target))
    return {"deleted": True, "backup": str(target)}


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
            if parsed.path == "/api/project":
                project = scene_project_config()
                self.send_json({
                    "projectName": PROJECT_ROOT.name,
                    "projectPath": str(PROJECT_ROOT),
                    "project": project,
                    "rootNodeId": str(project.get("Root Node") or "").strip() or None,
                    "stats": read_json(stats_path(), {}) or {},
                    "memories": read_json(memories_path(), {}) or {},
                    "nodes": scan_nodes(),
                    "screens": scan_screens(),
                    "images": scan_image_assets(),
                    "issues": validate_project(),
                })
                return
            if parsed.path == "/api/nodes":
                self.send_json({"nodes": scan_nodes()})
                return
            if parsed.path == "/api/node":
                self.send_json(read_node(self.query_value("path")))
                return
            if parsed.path == "/api/node/references":
                self.send_json(node_references(self.query_value("path")))
                return
            if parsed.path == "/api/content":
                directory = node_path(self.query_value("node")) / CONTENT_DIR
                name = clean_file_name(self.query_value("name"), ".rpy")
                path = directory / f"{name}.rpy"
                if not path.exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, "找不到 Content 文件。")
                source = path.read_text(encoding="utf-8")
                self.send_json({"name": name, "displayName": source_display_name(source, name), "source": source})
                return
            if parsed.path == "/api/screen":
                name = clean_file_name(self.query_value("name"), ".rpy")
                path = PROJECT_ROOT / SCREEN_DIR / f"{name}.rpy"
                if not path.exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, "找不到 Scene Screen 文件。")
                source = path.read_text(encoding="utf-8")
                self.send_json({"name": name, "displayName": source_display_name(source, name), "source": source})
                return
            if parsed.path == "/api/validate":
                self.send_json({"issues": validate_project()})
                return
            if parsed.path == "/api/asset":
                self.serve_project_asset(self.query_value("path"))
                return
            self.serve_static(parsed.path)
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover - final safety net for a local tool
            self.send_json({"error": f"未預期的錯誤：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            payload = read_body(self)
            if parsed.path == "/api/nodes":
                self.send_json(create_node(payload), HTTPStatus.CREATED)
                return
            if parsed.path == "/api/events":
                self.send_json(save_event(payload))
                return
            if parsed.path == "/api/content":
                directory = node_path(payload.get("node"))
                if not (directory / "Node.json").exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Scene Node。")
                self.send_json(save_source_file(directory / CONTENT_DIR, payload, "Content"))
                return
            if parsed.path == "/api/screens":
                self.send_json(save_source_file(PROJECT_ROOT / SCREEN_DIR, payload, "Scene Screen"))
                return
            raise ApiError(HTTPStatus.NOT_FOUND, "找不到 API。")
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover
            self.send_json({"error": f"未預期的錯誤：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_PUT(self):
        try:
            parsed = urlparse(self.path)
            payload = read_body(self)
            if parsed.path == "/api/stats":
                stats = validate_stats(payload.get("stats"))
                write_json(stats_path(), stats)
                self.send_json({"stats": stats})
                return
            if parsed.path == "/api/state":
                stats = validate_stats(payload.get("stats"))
                memories = validate_memories(payload.get("memories"))
                write_json(stats_path(), stats)
                write_json(memories_path(), memories)
                self.send_json({"stats": stats, "memories": memories})
                return
            if parsed.path == "/api/node":
                self.send_json(save_node(payload))
                return
            if parsed.path == "/api/project/root":
                self.send_json(save_root_node(payload))
                return
            if parsed.path == "/api/options":
                directory = node_path(payload.get("node"))
                if not (directory / "Node.json").exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Scene Node。")
                result = {"saved": True}
                if "options" in payload:
                    options = validate_options(payload.get("options"))
                    write_json(directory / OPTIONS_FILE, options)
                    result["options"] = options
                if "source" in payload:
                    source = payload.get("source")
                    if not isinstance(source, str):
                        raise ApiError(HTTPStatus.BAD_REQUEST, "Scene Option 內容必須是文字。")
                    atomic_write(directory / "SCENEOPTION.rpy", source.rstrip() + "\n")
                if "optionMode" in payload or "optionScreen" in payload:
                    node_data = read_json(directory / "Node.json", {}) or {}
                    mode = str(payload.get("optionMode") or node_data.get("Option Mode") or "DATA").upper()
                    if mode not in ("DATA", "CUSTOM"):
                        raise ApiError(HTTPStatus.BAD_REQUEST, "Option Mode 必須是 DATA 或 CUSTOM。")
                    if mode == "DATA":
                        option_screen = "scene_option_renderer"
                    else:
                        option_screen = str(
                            payload.get("optionScreen")
                            if "optionScreen" in payload
                            else node_data.get("Option Screen") or ""
                        ).strip()
                        if not option_screen or option_screen == "scene_option_renderer":
                            raise ApiError(HTTPStatus.BAD_REQUEST, "CUSTOM 模式必須指定自訂 Option Screen。")
                    node_data["Option Mode"] = mode
                    node_data["Option Screen"] = option_screen
                    write_json(directory / "Node.json", node_data)
                    result["node"] = node_data
                self.send_json(result)
                return
            raise ApiError(HTTPStatus.NOT_FOUND, "找不到 API。")
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover
            self.send_json({"error": f"未預期的錯誤：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/events":
                directory = node_path(self.query_value("node")) / EVENT_DIR
                event_id = clean_file_name(self.query_value("id"), ".json")
                target = directory / f"{event_id}.json"
            elif parsed.path == "/api/nodes":
                self.send_json(delete_node(self.query_value("path")))
                return
            elif parsed.path == "/api/content":
                directory = node_path(self.query_value("node")) / CONTENT_DIR
                name = clean_file_name(self.query_value("name"), ".rpy")
                target = directory / f"{name}.rpy"
            elif parsed.path == "/api/screens":
                name = clean_file_name(self.query_value("name"), ".rpy")
                target = PROJECT_ROOT / SCREEN_DIR / f"{name}.rpy"
            else:
                raise ApiError(HTTPStatus.NOT_FOUND, "找不到 API。")
            if not target.exists():
                raise ApiError(HTTPStatus.NOT_FOUND, "找不到要刪除的文件。")
            target.unlink()
            self.send_json({"deleted": True})
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover
            self.send_json({"error": f"未預期的錯誤：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def serve_static(self, request_path):
        relative = unquote(request_path).lstrip("/") or "index.html"
        path = (STATIC_ROOT / relative).resolve()
        if STATIC_ROOT not in path.parents and path != STATIC_ROOT:
            raise ApiError(HTTPStatus.FORBIDDEN, "無法存取這個路徑。")
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
            raise ApiError(HTTPStatus.BAD_REQUEST, "資源路徑不可為空。")
        path = (PROJECT_ROOT / Path(relative)).resolve()
        if PROJECT_ROOT not in path.parents:
            raise ApiError(HTTPStatus.FORBIDDEN, "無法存取這個資源。")
        if not path.exists() or not path.is_file() or path.suffix.casefold() not in IMAGE_EXTENSIONS:
            raise ApiError(HTTPStatus.NOT_FOUND, "找不到圖片資源。")
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
