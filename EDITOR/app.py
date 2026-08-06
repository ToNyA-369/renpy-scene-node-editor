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
CONTENT_DIR = "CONTENT"
OPTIONS_FILE = "Options.json"
GLOBAL_NODE_PATH = "@global"
EDITOR_SETTINGS_FILE = "settings.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".avif"}
AUDIO_EXTENSIONS = {".opus", ".ogg", ".mp3", ".mp2", ".flac", ".wav"}

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


def editor_settings_path():
    return PROJECT_ROOT.parent / ".scene-node-editor" / EDITOR_SETTINGS_FILE


def validate_editor_settings(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Editor 設定必須是 object。")
    shortcuts = value.get("shortcuts")
    if shortcuts is not None and not isinstance(shortcuts, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "快捷鍵設定必須是 object。")
    return value


def scene_project_path():
    return PROJECT_ROOT / PROJECT_CONFIG_RELATIVE


def scene_project_config():
    return read_json(scene_project_path(), {}) or {}


def configured_root_node():
    return str(scene_project_config().get("Root Node") or "").strip() or None


def default_options():
    return {
        "Version": 2,
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
        if operation not in CONDITION_OPERATORS["memory"]:
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
        if operation not in EFFECT_OPERATORS["stat"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的 Stat 操作不合法。")
        result["op"] = operation
        result["value"] = number_setting(result.get("value", 0), 0, f"{field} 的值")
        result.pop("bank", None)
        return result

    if effect_type == "memory":
        result["bank"] = clean_file_name(result.get("bank") or DEFAULT_MEMORY_ID, "")
        operation = str(result.get("op") or "add")
        if operation not in EFFECT_OPERATORS["memory"]:
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

    if effect_type == "option":
        operation = str(result.get("op") or "enable").lower()
        if operation not in EFFECT_OPERATORS["option"]:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的 Option 操作不合法。")
        target = str(result.get("target") or "element").lower()
        if target not in OPTION_EFFECT_TARGETS:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的 Option 目標層級不合法。")
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

    raise ApiError(HTTPStatus.BAD_REQUEST, f"{field} 的類型不合法：{effect_type}。")


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
            f"{field} 必須是 ALWAYS 或 CONTROLLED。",
        )
    return availability


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
        "Availability": validate_option_availability(
            item.get("Availability"),
            f"Text Box Item {item_id} Availability",
        ),
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
        raw_style = element.get("Style") if isinstance(element.get("Style"), dict) else {}
        result["Style"] = {
            "Background": str(raw_style.get("Background") or "#0b1118"),
            "Item Background": str(raw_style.get("Item Background") or "#20302a"),
            "Text Color": str(raw_style.get("Text Color") or "#ffffff"),
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
            raise ApiError(HTTPStatus.BAD_REQUEST, f"Hitbox {element_id} 的 Trigger 不可為空。")
        result["Hitbox"] = {
            "Editor Color": str(raw_hitbox.get("Editor Color") or "#28a47d"),
            "Editor Opacity": number_setting(raw_hitbox.get("Editor Opacity", 0.24), 0.24, "Editor Opacity", minimum=0, maximum=1),
        }
    return result


def validate_options(data):
    if data is None:
        return default_options()
    if not isinstance(data, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Options.json 必須是 object。")
    raw_canvas = data.get("Canvas") if isinstance(data.get("Canvas"), dict) else {}
    elements = data.get("Elements") if isinstance(data.get("Elements"), list) else []
    result = {
        "Version": 2,
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
                f"Option {name} 仍被 {len(references)} 個 Event Effect 引用。",
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
        "eventCount": len(events),
        "contentCount": len(contents),
        "optionCount": len(option_elements),
        "parseError": parse_error,
    }


def global_node_summary():
    directory = global_node_path()
    node_file = directory / "Node.json"
    parse_error = None
    try:
        data = read_json(node_file, {}) or {}
    except ApiError as exc:
        data = {}
        parse_error = exc.message
    events = list((directory / EVENT_DIR).glob("*.json")) if (directory / EVENT_DIR).exists() else []
    contents = list((directory / CONTENT_DIR).glob("*.rpy")) if (directory / CONTENT_DIR).exists() else []
    try:
        raw_options = read_json(directory / OPTIONS_FILE, default_options()) or default_options()
    except ApiError as exc:
        raw_options = default_options()
        parse_error = f"{parse_error}; {exc.message}" if parse_error else exc.message
    option_elements = raw_options.get("Elements", []) if isinstance(raw_options, dict) else []
    return {
        "path": GLOBAL_NODE_PATH,
        "id": data.get("ID", GLOBAL_NODE_ID),
        "name": data.get("Name", "GLOBAL"),
        "eventCount": len(events),
        "contentCount": len(contents),
        "optionCount": len(option_elements),
        "parseError": parse_error,
        "isGlobal": True,
        "isRoot": False,
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


def project_graph():
    edges = []
    for node in [global_node_summary()] + scan_nodes():
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


def scan_content_files(root):
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
        })
    return files


def read_node(relative):
    global_scope = is_global_node_path(relative)
    directory = authoring_directory(relative)
    node_file = directory / "Node.json"
    if not node_file.exists():
        raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Global Node。" if global_scope else "找不到指定的 Scene Node。")

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
        result[stat_id]["Group"] = str(settings.get("Group") or "Normal").strip() or "Normal"
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


def validate_event_trigger(value):
    trigger = str(value or "").strip()
    if not trigger:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Event Trigger 不可為空。")
    if ":" not in trigger:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Event Trigger 必須使用 Source:Value 格式。")

    source, payload = trigger.split(":", 1)
    payload = payload.strip()
    if source not in ("Auto", "Action", "Keyboard", "Mouse"):
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Event Trigger 來源不合法：{source}。")
    if not payload:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{source} Trigger 不可為空。")
    if source == "Auto" and payload not in AUTO_TRIGGER_PHASES:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Auto Trigger 不合法：{payload}。")
    if source == "Keyboard" and not (
        KEYBOARD_KEYSYM_RE.fullmatch(payload) or (len(payload) == 1 and not payload.isspace())
    ):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Keyboard Trigger 必須是有效的 Ren'Py keysym。")
    if source == "Mouse" and payload not in MOUSE_TRIGGER_VALUES:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Mouse Trigger 不合法：{payload}。")
    return f"{source}:{payload}"


def validate_event(event, global_scope=False, owner_node_id=None):
    if not isinstance(event, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Event 必須是 JSON object。")
    if global_scope and owner_node_id is None:
        owner_node_id = GLOBAL_NODE_ID
    event_id = clean_file_name(event.get("ID") or generate_id("event"), ".json")
    trigger = validate_event_trigger(event.get("Trigger"))
    is_lifecycle = trigger in LIFECYCLE_TRIGGERS

    priority = event.get("Priority", 5)
    if not isinstance(priority, int) or isinstance(priority, bool) or not 0 <= priority <= 5:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Priority 必須是 0 到 5 的整數。")
    weight = event.get("Weight", 1)
    if not is_lifecycle and (not isinstance(weight, (int, float)) or isinstance(weight, bool) or weight <= 0):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Weight 必須大於 0。")

    conditions = event.get("Conditions", [])
    effects = event.get("Effects", [])
    if not isinstance(conditions, list) or not all(isinstance(item, dict) for item in conditions):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Conditions 必須是 object 陣列。")
    if not isinstance(effects, list) or not all(isinstance(item, dict) for item in effects):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Effects 必須是 object 陣列。")

    content = event.get("Content")
    validate_weight_map(content, "Content")
    validated_effects = [validate_effect(item, "Event Effect") for item in effects]
    for effect in validated_effects:
        if (
            effect.get("type") == "option"
            and owner_node_id
            and effect.get("node") != owner_node_id
        ):
            raise ApiError(
                HTTPStatus.BAD_REQUEST,
                "Option Effect 只能控制同一個 Options 作用域內的 Option。",
            )

    result = {
        "ID": event_id,
        "Name": str(event.get("Name") or event_id),
        "Trigger": trigger,
        "Priority": priority,
        "Once": bool(event.get("Once", False)),
        "Conditions": [validate_condition(item, "Event Condition") for item in conditions],
        "Effects": validated_effects,
        "Content": content,
    }
    if is_lifecycle:
        return result

    end_up = event.get("End up", "REDO")
    next_node = event.get("Next Node")
    validate_weight_map(next_node, "Next Node")
    if end_up not in ("REDO", "GOTO", "REPLACE", "EXIT"):
        raise ApiError(HTTPStatus.BAD_REQUEST, "End up 必須是 REDO、GOTO、REPLACE 或 EXIT。")
    if end_up in ("GOTO", "REPLACE") and next_node is None:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"{end_up} Event 必須設定 Next Node。")
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
                "message": f"Global Node ID 必須固定為 {GLOBAL_NODE_ID}。",
            })
        if not global_scope and node_id == GLOBAL_NODE_ID:
            issues.append({
                "level": "error",
                "location": location,
                "message": f"Scene Node 不可使用保留 ID：{GLOBAL_NODE_ID}。",
            })
        if node_id in seen_node_ids:
            issues.append({"level": "error", "location": location, "message": f"Node ID {node_id} 重複。"})
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
                    "message": f"選項 Trigger {trigger} 沒有對應的 Event。",
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
                            "message": "找不到 Option Effect 目標：{}。".format(
                                "/".join(str(value or "") for value in target_key if value is not None)
                            ),
                        })
                    elif option_target.get("availability") != "CONTROLLED":
                        issues.append({
                            "level": "warning",
                            "location": event_location,
                            "message": "Option Effect 目標必須設為 CONTROLLED：{}。".format(
                                option_target.get("itemName") or option_target.get("elementName")
                            ),
                        })

            content = event["Content"]
            content_names = [content] if isinstance(content, str) else list(content or {})
            for label in content_names:
                if label not in labels:
                    issues.append({"level": "warning", "location": event_location, "message": f"找不到 Content label：{label}。"})

            target = event.get("Next Node")
            target_names = [target] if isinstance(target, str) else list(target or {})
            for target_id in target_names:
                if target_id not in node_ids:
                    issues.append({"level": "warning", "location": event_location, "message": f"找不到 Next Node：{target_id}。"})

    return issues


def create_node(payload):
    node_id = clean_file_name(payload.get("id") or generate_id("node"), "")
    relative = clean_node_path(payload.get("path") or node_id)
    if node_id == GLOBAL_NODE_ID or relative == GLOBAL_NODE_PATH:
        raise ApiError(HTTPStatus.CONFLICT, "這個 ID 或路徑保留給 Global Node。")
    directory = node_path(relative)
    if directory.exists() and any(directory.iterdir()):
        raise ApiError(HTTPStatus.CONFLICT, "這個 Scene Node 路徑已經存在。")

    node_name = str(payload.get("name") or node_id).strip() or node_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / EVENT_DIR).mkdir(exist_ok=True)
    (directory / CONTENT_DIR).mkdir(exist_ok=True)
    write_json(directory / "Node.json", {
        "ID": node_id,
        "Name": node_name,
    })
    write_json(directory / OPTIONS_FILE, default_options())
    return node_summary(directory)


def save_node(payload):
    relative = clean_node_path(payload.get("path"))
    global_scope = is_global_node_path(relative)
    directory = authoring_directory(relative)
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Global Node。" if global_scope else "找不到指定的 Scene Node。")
    node = payload.get("node") or {}
    node_id = GLOBAL_NODE_ID if global_scope else clean_file_name(node.get("ID"), "")
    if not global_scope and node_id == GLOBAL_NODE_ID:
        raise ApiError(HTTPStatus.CONFLICT, f"{GLOBAL_NODE_ID} 是 Global Node 的保留 ID。")
    write_json(directory / "Node.json", {
        "ID": node_id,
        "Name": str(node.get("Name") or node_id),
    })
    return global_node_summary() if global_scope else node_summary(directory)


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
    global_scope = is_global_node_path(payload.get("node"))
    directory = authoring_directory(payload.get("node"))
    if not (directory / "Node.json").exists():
        raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 Global Node。" if global_scope else "找不到指定的 Scene Node。")
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
                raise ApiError(HTTPStatus.CONFLICT, "新的 Event ID 已經存在。")
            old_path_to_remove = old_path
    target = event_root / f"{event['ID']}.json"
    if not original and target.exists():
        raise ApiError(HTTPStatus.CONFLICT, "這個 Event ID 已經存在。")
    write_json(target, event)
    if old_path_to_remove and old_path_to_remove.exists():
        old_path_to_remove.unlink()
    return event


def save_content_file(root, payload):
    name = clean_file_name(payload.get("id") or payload.get("name") or generate_id("content"), ".rpy")
    original = payload.get("originalName")
    source = payload.get("source")
    if not isinstance(source, str):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Content 內容必須是文字。")
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
                raise ApiError(HTTPStatus.CONFLICT, "Content 名稱已經存在。")
            old_path_to_remove = old_path
    elif target.exists():
        raise ApiError(HTTPStatus.CONFLICT, "Content 名稱已經存在。")
    atomic_write(target, source.rstrip() + "\n")
    if old_path_to_remove and old_path_to_remove.exists():
        old_path_to_remove.unlink()
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
        raise ApiError(HTTPStatus.CONFLICT, "Global Node 是固定的全局作用域，不可刪除。")
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
            if parsed.path == "/api/editor-settings":
                self.send_json(validate_editor_settings(read_json(editor_settings_path(), {}) or {}))
                return
            if parsed.path == "/api/project":
                project = scene_project_config()
                self.send_json({
                    "projectName": PROJECT_ROOT.name,
                    "projectPath": str(PROJECT_ROOT),
                    "project": project,
                    "rootNodeId": str(project.get("Root Node") or "").strip() or None,
                    "stats": read_json(stats_path(), {}) or {},
                    "memories": read_json(memories_path(), {}) or {},
                    "globalNode": global_node_summary(),
                    "nodes": scan_nodes(),
                    "graph": project_graph(),
                    "images": scan_image_assets(),
                    "audio": scan_audio_assets(),
                    "optionTargets": scan_option_targets(),
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
                    raise ApiError(HTTPStatus.NOT_FOUND, "找不到 Content 文件。")
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
                raise ApiError(HTTPStatus.NOT_FOUND, "找不到 API。")
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
                directory = authoring_directory(payload.get("node"))
                if not (directory / "Node.json").exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 authoring scope。")
                self.send_json(save_content_file(directory / CONTENT_DIR, payload))
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
            if parsed.path == "/api/editor-settings":
                settings = validate_editor_settings(payload)
                write_json(editor_settings_path(), settings)
                self.send_json(settings)
                return
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
                global_scope = is_global_node_path(payload.get("node"))
                directory = authoring_directory(payload.get("node"))
                if not (directory / "Node.json").exists():
                    raise ApiError(HTTPStatus.NOT_FOUND, "找不到指定的 authoring scope。")
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
            raise ApiError(HTTPStatus.NOT_FOUND, "找不到 API。")
        except ApiError as exc:
            self.send_error_json(exc)
        except Exception as exc:  # pragma: no cover
            self.send_json({"error": f"未預期的錯誤：{exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/events":
                directory = authoring_directory(self.query_value("node")) / EVENT_DIR
                event_id = clean_file_name(self.query_value("id"), ".json")
                target = directory / f"{event_id}.json"
            elif parsed.path == "/api/nodes":
                self.send_json(delete_node(self.query_value("path")))
                return
            elif parsed.path == "/api/content":
                directory = authoring_directory(self.query_value("node")) / CONTENT_DIR
                name = clean_file_name(self.query_value("name"), ".rpy")
                target = directory / f"{name}.rpy"
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
