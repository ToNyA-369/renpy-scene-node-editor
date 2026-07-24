#!/usr/bin/env python3
"""Create a disposable Ren'Py project for broad Scene Node Editor testing."""

import argparse
import base64
import io
import json
import math
import os
import platform
import struct
import subprocess
import sys
import wave
from pathlib import Path

import install


TEST_UI_FILE = "scene_editor_test_ui.rpy"
TEST_IMAGE_FILE = "images/scene_editor_test_picture.png"
TEST_IMAGE_GALLERY = tuple(
    "images/editor_test/gallery/set_{}/asset_{:02d}.png".format("a" if index < 10 else "b", index + 1)
    for index in range(18)
)
TEST_AUDIO_FILES = {
    "audio/editor_test/music/theme_a.wav": (220.0, 1.0),
    "audio/editor_test/music/theme_b.wav": (329.63, 1.0),
    "audio/editor_test/sfx/layer_low.wav": (440.0, 0.45),
    "audio/editor_test/sfx/ui/layer_high.wav": (659.25, 0.45),
    "audio/editor_test/sfx/ui/deep/fourth_level.wav": (783.99, 0.45),
}
TEST_MANIFEST_FILE = "SCENE_EDITOR_TEST_UNIT.json"
ROOT_NODE = "root"
OPTIONS_NODE = "options_lab"
BRANCH_NODE = "branch_lab"
SUCCESS_NODE = "outcome_success"
FALLBACK_NODE = "outcome_fallback"
REPLACE_PARENT_NODE = "replace_parent"
REPLACE_CHILD_A_NODE = "replace_child_a"
REPLACE_CHILD_B_NODE = "replace_child_b"
TEST_NODES = (
    ROOT_NODE,
    OPTIONS_NODE,
    BRANCH_NODE,
    SUCCESS_NODE,
    FALLBACK_NODE,
    REPLACE_PARENT_NODE,
    REPLACE_CHILD_A_NODE,
    REPLACE_CHILD_B_NODE,
)

# A tiny valid PNG which the DATA Picture option stretches and tints.
TEST_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def test_wav(frequency, duration, sample_rate=22050):
    frames = bytearray()
    for index in range(int(sample_rate * duration)):
        envelope = min(1.0, index / 400.0, (sample_rate * duration - index) / 800.0)
        sample = int(7000 * envelope * math.sin(2 * math.pi * frequency * index / sample_rate))
        frames.extend(struct.pack("<h", sample))
    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(bytes(frames))
    return output.getvalue()


class EditorTestUnitError(Exception):
    pass


def write_text(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(str(temporary), str(path))


def write_binary(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(content)
    os.replace(str(temporary), str(path))


def write_json(path, data):
    write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def assert_disposable_blank_project(project_root, game_root):
    missing_markers = [
        marker
        for marker in install.PROJECT_MARKERS
        if not (game_root / marker).is_file()
    ]
    if missing_markers:
        raise EditorTestUnitError(
            "測試單元只接受 Ren'Py Launcher 建立的空白專案；缺少：{}。".format(
                ", ".join(missing_markers)
            )
        )

    protected_paths = (
        project_root / ".scene-node-editor",
        project_root / install.PROJECT_LAUNCHER,
        game_root / "DATA",
        game_root / "SCENENODE",
        game_root / "FRAMEWORK" / "runtime.rpy",
        game_root / "FRAMEWORK" / "option_renderer.rpy",
        game_root / TEST_UI_FILE,
        game_root / TEST_MANIFEST_FILE,
        game_root / TEST_IMAGE_FILE,
    ) + tuple(game_root / path for path in TEST_IMAGE_GALLERY) + tuple(game_root / path for path in TEST_AUDIO_FILES)
    existing = [path for path in protected_paths if path.exists()]
    if existing:
        relative = [path.relative_to(project_root).as_posix() for path in existing]
        raise EditorTestUnitError(
            "目標已有 Scene Node Editor 或測試資料：{}。"
            "請另建一個空白 Ren'Py 專案，避免覆寫正式內容。".format(
                ", ".join(relative)
            )
        )


def stat_condition(stat_id, operation, value):
    return {"type": "stat", "id": stat_id, "op": operation, "value": value}


def memory_condition(bank, tag, operation="has"):
    return {"type": "memory", "bank": bank, "id": tag, "op": operation}


def stat_effect(stat_id, operation, value):
    return {"type": "stat", "id": stat_id, "op": operation, "value": value}


def memory_effect(bank, operation, tag=None):
    result = {"type": "memory", "bank": bank, "op": operation}
    if operation != "clear":
        result["id"] = tag
    return result


def event_data(
    event_id,
    name,
    trigger,
    *,
    priority=3,
    weight=1,
    once=False,
    conditions=None,
    effects=None,
    content=None,
    end_up="REDO",
    next_node=None,
):
    result = {
        "ID": event_id,
        "Name": name,
        "Trigger": trigger,
        "Priority": priority,
        "Once": once,
        "Conditions": conditions or [],
        "Effects": effects or [],
        "Content": content,
    }
    if trigger not in ("Auto:Enter", "Auto:Exit"):
        result.update({
            "Weight": weight,
            "End up": end_up,
            "Next Node": next_node if end_up in ("GOTO", "REPLACE") else None,
        })
    return result


def option_item(item_id, text, trigger):
    return {
        "ID": item_id,
        "Name": text,
        "Text": text,
        "Trigger": trigger,
        "Style Override": {},
    }


def textbox_element(
    element_id,
    name,
    items,
    *,
    x=500,
    y=210,
    width=920,
    height=580,
    hover_sound="",
    click_sound="",
):
    return {
        "ID": element_id,
        "Name": name,
        "Type": "TEXTBOX",
        "Layout": {
            "X": x,
            "Y": y,
            "Width": width,
            "Height": height,
            "Z Order": 10,
        },
        "List": {
            "Max Visible Items": 4,
            "Item Height": 84,
            "Item Spacing": 14,
            "Padding": 20,
            "Show Scrollbar": True,
        },
        "Style": {
            "Background": "#111827e8",
            "Item Background": "#1f6f5b",
            "Text Color": "#ffffff",
            "Text Size": 30,
            "Text Align": 0.5,
        },
        "Hover": {"Enabled": True, "Color": "#35c99155"},
        "Hover Sound": hover_sound,
        "Click Sound": click_sound,
        "Items": items,
    }


def options_document(elements=None):
    return {
        "Version": 1,
        "Canvas": {
            "Width": 1920,
            "Height": 1080,
            "Preview Background": "",
        },
        "Elements": elements or [],
    }


def root_options_data():
    items = [
        option_item("earn", "取得 10 點（隨機 Content）", "Action:earn"),
        option_item("spend", "花費 15 點（條件＋fallback）", "Action:spend"),
        option_item("once_bonus", "領取一次性 25 點獎勵", "Action:once_bonus"),
        option_item("open_options", "前往 Options 元件實驗室", "Action:open_options"),
        option_item("open_replace", "前往 REPLACE Stack 實驗室", "Action:open_replace"),
        option_item("finish", "結束這次 Runtime 測試", "Action:finish"),
    ]
    return options_document([
        textbox_element(
            "root_actions",
            "綜合測試入口",
            items,
            x=600,
            y=260,
            width=720,
            height=520,
            hover_sound="audio/editor_test/sfx/layer_low.wav",
            click_sound="audio/editor_test/sfx/ui/layer_high.wav",
        )
    ])


def outcome_options_data(success):
    name = "成功結果" if success else "Fallback 結果"
    return options_document([
        textbox_element(
            "result_actions",
            name,
            [option_item("return", "EXIT 回到上一個節點", "Action:return")],
            x=630,
            y=390,
            width=660,
            height=180,
        )
    ])


def options_lab_data():
    items = [
        option_item(
            "gain_one",
            "取得 1 點（REDO）",
            "Action:data_gain",
        ),
        option_item(
            "get_key",
            "取得測試鑰匙",
            "Action:get_key",
        ),
        option_item(
            "use_key",
            "使用測試鑰匙（需至少 5 點）",
            "Action:use_key",
        ),
        option_item(
            "open_branch",
            "前往條件分支實驗室",
            "Action:open_branch",
        ),
        option_item(
            "random_result",
            "隨機前往兩個結果節點",
            "Action:random_result",
        ),
        option_item(
            "data_back",
            "返回測試入口",
            "Action:data_back",
        ),
    ]
    picture = {
        "ID": "picture_bonus",
        "Name": "Picture 點擊測試",
        "Type": "PICTURE",
        "Layout": {"X": 80, "Y": 820, "Width": 300, "Height": 130, "Z Order": 20},
        "Trigger": "Action:picture_bonus",
        "Hover": {"Enabled": True, "Color": "#ffffff24"},
        "Picture": {
            "Idle": TEST_IMAGE_FILE,
            "Hover": TEST_IMAGE_FILE,
            "Fit": "STRETCH",
            "Keep Aspect": False,
            "Alpha Hit Test": False,
            "Opacity": 1,
            "Tint": "#35c991",
        },
        "Hover Sound": "audio/editor_test/sfx/layer_low.wav",
        "Click Sound": "audio/editor_test/sfx/ui/layer_high.wav",
    }
    hitbox = {
        "ID": "hitbox_mark",
        "Name": "Hitbox 點擊測試",
        "Type": "HITBOX",
        "Layout": {"X": 1540, "Y": 820, "Width": 300, "Height": 130, "Z Order": 20},
        "Trigger": "Action:hitbox_mark",
        "Hover": {"Enabled": True, "Color": "#ffffff30"},
        "Hitbox": {
            "Editor Color": "#28a47d",
            "Editor Opacity": 0.28,
        },
        "Hover Sound": "audio/editor_test/sfx/layer_low.wav",
        "Click Sound": "audio/editor_test/sfx/ui/layer_high.wav",
    }
    result = options_document([textbox_element("data_actions", "DATA Options 綜合測試", items), picture, hitbox])
    result["Canvas"]["Preview Background"] = TEST_IMAGE_FILE
    return result


def branch_lab_data():
    items = [
        option_item(
            "resolve_branch",
            "依條件前往結果（30 點以上成功）",
            "Action:resolve_branch",
        ),
        option_item(
            "random_branch",
            "權重隨機結果",
            "Action:random_branch",
        ),
        option_item(
            "branch_back",
            "返回 DATA Options",
            "Action:branch_back",
        ),
    ]
    return options_document([
        textbox_element(
            "branch_actions",
            "條件與權重分支",
            items,
            x=530,
            y=310,
            width=860,
            height=390,
        )
    ])


def replace_parent_options_data():
    return options_document([
        textbox_element(
            "replace_parent_actions",
            "REPLACE Parent",
            [
                option_item("enter_child_a", "GOTO Child A", "Action:enter_child_a"),
                option_item("replace_parent_back", "EXIT 回到 ROOT", "Action:replace_parent_back"),
            ],
            x=610,
            y=360,
            width=700,
            height=270,
        )
    ])


def replace_child_a_options_data():
    return options_document([
        textbox_element(
            "replace_child_a_actions",
            "REPLACE Child A",
            [option_item("replace_child", "REPLACE 至 Child B", "Action:replace_child")],
            x=610,
            y=400,
            width=700,
            height=180,
        )
    ])


def replace_child_b_options_data():
    return options_document([
        textbox_element(
            "replace_child_b_actions",
            "REPLACE Child B",
            [option_item("exit_child_b", "EXIT 回到 Parent", "Action:exit_child_b")],
            x=610,
            y=400,
            width=700,
            height=180,
        )
    ])


def screen_source():
    return '''# @display_name: Scene Editor 綜合測試介面
# 這個文件由創作者自行維護，並由 Content 使用原生 Ren'Py 語法顯示。

screen scene_editor_test_hud():
    zorder 20
    $ test_node_id = scene_current_node_id()
    $ test_points = scene_get_stat("test_points")
    $ test_actions = scene_get_stat("test_actions")
    $ test_has_key = scene_memory_has("memory", "test_key")
    $ test_hitbox = scene_memory_has("test_session", "hitbox_clicked")

    frame:
        xalign 0.98
        yalign 0.03
        padding (24, 18)

        vbox:
            spacing 5
            text "外部 Screen HUD" size 28
            text "Node：[test_node_id]" size 20
            text "點數：[test_points]　操作：[test_actions]" size 20
            text "鑰匙：[test_has_key]　Hitbox：[test_hitbox]" size 18

    if test_node_id == "options_lab":
        text "左下綠色區塊：Picture　｜　右下透明區塊：Hitbox（移入會發亮）":
            xalign 0.5
            yalign 0.94
            size 20
'''


def root_reward_source():
    return '''# @display_name: 01 獎勵與權重內容

label test_earned_direct:
    "權重 Content A：點數增加 10。"
    return

label test_earned_lucky:
    "權重 Content B：這次抽到另一段台詞，點數同樣增加 10。"
    return

label test_once_bonus:
    "Once Event：獲得一次性 25 點。"
    return

label test_once_used:
    "Once Event 已經使用過；這次由 fallback Event 接手。"
    return

label test_keyboard_input:
    "Keyboard Trigger：按下 K 鍵觸發 Event，點數增加 2。"
    return

label test_mouse_input:
    "Mouse Trigger：按下滑鼠右鍵觸發 Event，點數增加 4。"
    return
'''


def root_flow_source():
    return '''# @display_name: 02 條件與流程內容

label test_spent:
    "條件成立：成功花費 15 點。"
    return

label test_insufficient:
    "條件不成立：由低優先順位 fallback Event 顯示這段內容。"
    return

label test_finished:
    "根節點 EXIT：這次 Scene Runtime 測試結束。"
    return
'''


def lifecycle_content_source():
    return '''# @display_name: 00 節點生命週期演出
# 背景與音樂使用原生 Ren'Py 語法；Editor 只負責在節點邊界呼叫 label。

image scene_editor_test_background = "images/scene_editor_test_picture.png"

label test_enter_background:
    scene scene_editor_test_background with dissolve
    show screen scene_editor_test_hud
    "On Enter（Priority 1）：原生 Ren'Py 背景演出已執行。"
    return

label test_enter_music:
    play music "audio/editor_test/music/theme_a.wav" fadein 1.0
    "On Enter（Priority 2）：第二個生命週期 Event 也有依序執行。"
    return

label test_on_node_once:
    "On Node：沿用原本 Auto 的單一 Event 選擇，本測試只執行一次。"
    return

label test_exit_cleanup:
    "On Exit：在根節點離開前執行原生 Ren'Py 淡出。"
    hide screen scene_editor_test_hud
    stop music fadeout 1.0
    scene black with fade
    return
'''


def options_content_source():
    return '''# @display_name: DATA Options 操作結果

label test_data_gained:
    "DATA Options：點數增加 1，接著 REDO 重新顯示選項。"
    return

label test_key_acquired:
    "Memory add：取得測試鑰匙；選項仍維持顯示，條件交給 Event 判斷。"
    return

label test_key_used:
    "條件 Event 勝出：使用鑰匙並增加 5 點。"
    return

label test_key_unavailable:
    "Fallback Event 勝出：缺少鑰匙或點數不足，狀態沒有改變。"
    return

label test_picture_clicked:
    "Picture Option 已觸發：點數增加 3。"
    return

label test_hitbox_clicked:
    "Hitbox Option 已觸發：test_session 記憶庫已加入標籤。"
    return
'''


def branch_content_source():
    return '''# @display_name: 分支判定內容

label test_branch_success:
    "條件 Event 勝出：點數至少 30，前往成功節點。"
    return

label test_branch_fallback:
    "Fallback Event 勝出：點數不足 30，前往 fallback 節點。"
    return

label test_branch_random:
    "下一個節點將依 1:1 權重選擇。"
    return
'''


def outcome_content_source(success):
    if success:
        return '''# @display_name: 成功結果內容

label test_success_return:
    "從成功結果節點 EXIT，回到上一個節點。"
    return
'''
    return '''# @display_name: Fallback 結果內容

label test_fallback_return:
    "從 fallback 結果節點 EXIT，回到上一個節點。"
    return
'''


def replace_parent_content_source():
    return '''# @display_name: REPLACE Parent 生命週期

label test_replace_parent_enter:
    "Parent On Enter：整段 REPLACE 測試只應在首次 GOTO Parent 時看見。"
    return

label test_replace_parent_node:
    "Parent On Node：首次進入 Parent 時執行一次。"
    return
'''


def replace_child_a_content_source():
    return '''# @display_name: REPLACE Child A 演出

label test_replace_requested:
    "Child A Event Content：接下來應直接 REPLACE 至 Child B。"
    return

label test_replace_child_a_exit:
    "Child A On Exit：REPLACE 前的離場生命週期已執行。"
    return
'''


def replace_child_b_content_source():
    return '''# @display_name: REPLACE Child B 演出

label test_replace_child_b_enter:
    "Child B On Enter：Stack 頂端已由 Child A 原子替換。"
    return

label test_replace_child_b_exit:
    "Child B EXIT：應返回 Parent，不可返回 Child A。"
    return
'''


def write_node(game_root, relative_path, node, options, events, contents):
    node_root = game_root / "SCENENODE" / relative_path
    (node_root / "EVENTPOOL").mkdir(parents=True, exist_ok=True)
    (node_root / "CONTENT").mkdir(parents=True, exist_ok=True)
    write_json(node_root / "Node.json", node)
    write_json(node_root / "Options.json", options)
    for event in events:
        write_json(node_root / "EVENTPOOL" / (event["ID"] + ".json"), event)
    for filename, source in contents.items():
        write_text(node_root / "CONTENT" / filename, source)


def node_data(node_id, name):
    return {
        "ID": node_id,
        "Name": name,
    }


def create_editor_test_unit(raw_target):
    try:
        project_root, game_root = install.resolve_project(raw_target)
    except install.InstallError as exc:
        raise EditorTestUnitError(str(exc)) from exc

    assert_disposable_blank_project(project_root, game_root)

    try:
        project_root, game_root, launcher, version = install.install(project_root)
    except install.InstallError as exc:
        raise EditorTestUnitError(str(exc)) from exc

    write_json(
        game_root / "DATA" / "Stats.json",
        {
            "test_points": {"Name": "測試點數", "Min": 0, "Max": 100, "Init": 20},
            "test_actions": {"Name": "操作次數", "Min": 0, "Max": 999, "Init": 0},
        },
    )
    write_json(
        game_root / "DATA" / "Memories.json",
        {
            "memory": {"Name": "Memory"},
            "test_session": {"Name": "測試階段記憶"},
        },
    )
    write_text(game_root / TEST_UI_FILE, screen_source())
    write_binary(game_root / TEST_IMAGE_FILE, TEST_PNG)
    for path in TEST_IMAGE_GALLERY:
        write_binary(game_root / path, TEST_PNG)
    for path, (frequency, duration) in TEST_AUDIO_FILES.items():
        write_binary(game_root / path, test_wav(frequency, duration))
    write_json(
        game_root / TEST_MANIFEST_FILE,
        {
            "Name": "Scene Node Editor 綜合測試單元",
            "Version": 1,
            "Nodes": list(TEST_NODES),
            "Disposable": True,
        },
    )

    action_count = stat_effect("test_actions", "+", 1)
    root_events = [
        event_data(
            "root_enter_background",
            "進入節點：顯示背景",
            "Auto:Enter",
            priority=1,
            content="test_enter_background",
        ),
        event_data(
            "root_enter_music",
            "進入節點：播放音樂",
            "Auto:Enter",
            priority=2,
            content="test_enter_music",
        ),
        event_data(
            "root_on_node_once",
            "節點內自動事件",
            "Auto:Node",
            priority=0,
            once=True,
            effects=[action_count],
            content="test_on_node_once",
        ),
        event_data(
            "root_exit_cleanup",
            "離開節點：收尾演出",
            "Auto:Exit",
            priority=1,
            content="test_exit_cleanup",
        ),
        event_data(
            "earn_points",
            "取得 10 點（權重 Content）",
            "Action:earn",
            effects=[stat_effect("test_points", "+", 10), action_count],
            content={"test_earned_direct": 1, "test_earned_lucky": 1},
        ),
        event_data(
            "spend_points",
            "成功花費 15 點",
            "Action:spend",
            priority=1,
            conditions=[stat_condition("test_points", ">=", 15)],
            effects=[stat_effect("test_points", "-", 15), action_count],
            content="test_spent",
        ),
        event_data(
            "spend_fallback",
            "點數不足 fallback",
            "Action:spend",
            priority=5,
            effects=[action_count],
            content="test_insufficient",
        ),
        event_data(
            "one_time_bonus",
            "一次性 25 點獎勵",
            "Action:once_bonus",
            priority=1,
            once=True,
            effects=[stat_effect("test_points", "+", 25), action_count],
            content="test_once_bonus",
        ),
        event_data(
            "one_time_bonus_used",
            "一次性獎勵已使用 fallback",
            "Action:once_bonus",
            priority=5,
            conditions=[memory_condition("memory", "once:one_time_bonus")],
            effects=[action_count],
            content="test_once_used",
        ),
        event_data(
            "open_options_lab",
            "前往 DATA Options 實驗室",
            "Action:open_options",
            effects=[action_count],
            end_up="GOTO",
            next_node=OPTIONS_NODE,
        ),
        event_data(
            "open_replace_lab",
            "前往 REPLACE Stack 實驗室",
            "Action:open_replace",
            effects=[action_count],
            end_up="GOTO",
            next_node=REPLACE_PARENT_NODE,
        ),
        event_data(
            "keyboard_input",
            "鍵盤 K 輸入",
            "Keyboard:K_k",
            effects=[stat_effect("test_points", "+", 2), action_count],
            content="test_keyboard_input",
        ),
        event_data(
            "mouse_input",
            "滑鼠右鍵輸入",
            "Mouse:Right",
            effects=[stat_effect("test_points", "+", 4), action_count],
            content="test_mouse_input",
        ),
        event_data(
            "finish_test",
            "結束測試",
            "Action:finish",
            effects=[action_count],
            content="test_finished",
            end_up="EXIT",
        ),
    ]
    write_node(
        game_root,
        ROOT_NODE,
        node_data(ROOT_NODE, "綜合測試入口"),
        root_options_data(),
        root_events,
        {
            "00_lifecycle.rpy": lifecycle_content_source(),
            "01_rewards.rpy": root_reward_source(),
            "02_flow.rpy": root_flow_source(),
        },
    )

    options_events = [
        event_data(
            "data_gain",
            "DATA Options 取得 1 點",
            "Action:data_gain",
            effects=[stat_effect("test_points", "+", 1), action_count],
            content="test_data_gained",
        ),
        event_data(
            "get_key",
            "取得測試鑰匙",
            "Action:get_key",
            effects=[memory_effect("memory", "add", "test_key"), action_count],
            content="test_key_acquired",
        ),
        event_data(
            "use_key",
            "使用測試鑰匙",
            "Action:use_key",
            priority=1,
            conditions=[memory_condition("memory", "test_key"), stat_condition("test_points", ">=", 5)],
            effects=[memory_effect("memory", "remove", "test_key"), stat_effect("test_points", "+", 5), action_count],
            content="test_key_used",
        ),
        event_data(
            "use_key_unavailable",
            "無法使用測試鑰匙 fallback",
            "Action:use_key",
            priority=5,
            effects=[action_count],
            content="test_key_unavailable",
        ),
        event_data(
            "picture_bonus",
            "Picture 增加 3 點",
            "Action:picture_bonus",
            effects=[stat_effect("test_points", "+", 3), action_count],
            content="test_picture_clicked",
        ),
        event_data(
            "hitbox_mark",
            "Hitbox 記錄 Memory",
            "Action:hitbox_mark",
            effects=[memory_effect("test_session", "add", "hitbox_clicked"), action_count],
            content="test_hitbox_clicked",
        ),
        event_data(
            "open_branch_lab",
            "前往條件分支實驗室",
            "Action:open_branch",
            effects=[memory_effect("test_session", "add", "branch_unlocked"), action_count],
            end_up="GOTO",
            next_node=BRANCH_NODE,
        ),
        event_data(
            "random_result",
            "DATA Options 權重結果",
            "Action:random_result",
            effects=[action_count],
            end_up="GOTO",
            next_node={SUCCESS_NODE: 1, FALLBACK_NODE: 1},
        ),
        event_data(
            "data_back",
            "返回測試入口",
            "Action:data_back",
            effects=[action_count],
            end_up="EXIT",
        ),
    ]
    write_node(
        game_root,
        OPTIONS_NODE,
        node_data(OPTIONS_NODE, "Options 元件實驗室"),
        options_lab_data(),
        options_events,
        {"data_actions.rpy": options_content_source()},
    )

    branch_events = [
        event_data(
            "branch_success",
            "條件成立前往成功結果",
            "Action:resolve_branch",
            priority=1,
            conditions=[
                stat_condition("test_points", ">=", 30),
                memory_condition("test_session", "branch_unlocked"),
            ],
            effects=[action_count],
            content="test_branch_success",
            end_up="GOTO",
            next_node=SUCCESS_NODE,
        ),
        event_data(
            "branch_fallback",
            "條件不足前往 fallback",
            "Action:resolve_branch",
            priority=5,
            effects=[action_count],
            content="test_branch_fallback",
            end_up="GOTO",
            next_node=FALLBACK_NODE,
        ),
        event_data(
            "branch_random",
            "分支權重結果",
            "Action:random_branch",
            effects=[action_count],
            content="test_branch_random",
            end_up="GOTO",
            next_node={SUCCESS_NODE: 1, FALLBACK_NODE: 1},
        ),
        event_data(
            "branch_back",
            "返回 DATA Options",
            "Action:branch_back",
            effects=[action_count],
            end_up="EXIT",
        ),
    ]
    write_node(
        game_root,
        BRANCH_NODE,
        node_data(BRANCH_NODE, "條件與權重分支"),
        branch_lab_data(),
        branch_events,
        {"branch_results.rpy": branch_content_source()},
    )

    for node_id, name, label, success in (
        (SUCCESS_NODE, "成功結果", "test_success_return", True),
        (FALLBACK_NODE, "Fallback 結果", "test_fallback_return", False),
    ):
        write_node(
            game_root,
            node_id,
            node_data(node_id, name),
            outcome_options_data(success),
            [
                event_data(
                    "{}_return".format(node_id),
                    "返回上一個節點",
                    "Action:return",
                    effects=[action_count],
                    content=label,
                    end_up="EXIT",
                )
            ],
            {"result.rpy": outcome_content_source(success)},
        )

    write_node(
        game_root,
        REPLACE_PARENT_NODE,
        node_data(REPLACE_PARENT_NODE, "REPLACE Parent"),
        replace_parent_options_data(),
        [
            event_data(
                "replace_parent_enter",
                "Parent 進入",
                "Auto:Enter",
                content="test_replace_parent_enter",
            ),
            event_data(
                "replace_parent_node",
                "Parent 節點內事件",
                "Auto:Node",
                priority=0,
                once=True,
                content="test_replace_parent_node",
            ),
            event_data(
                "enter_replace_child_a",
                "GOTO Child A",
                "Action:enter_child_a",
                effects=[action_count],
                end_up="GOTO",
                next_node=REPLACE_CHILD_A_NODE,
            ),
            event_data(
                "replace_parent_back",
                "返回 ROOT",
                "Action:replace_parent_back",
                effects=[action_count],
                end_up="EXIT",
            ),
        ],
        {"replace_parent.rpy": replace_parent_content_source()},
    )

    write_node(
        game_root,
        REPLACE_CHILD_A_NODE,
        node_data(REPLACE_CHILD_A_NODE, "REPLACE Child A"),
        replace_child_a_options_data(),
        [
            event_data(
                "replace_child_a_exit",
                "Child A 離場",
                "Auto:Exit",
                content="test_replace_child_a_exit",
            ),
            event_data(
                "replace_child_a_with_b",
                "REPLACE 至 Child B",
                "Action:replace_child",
                effects=[action_count],
                content="test_replace_requested",
                end_up="REPLACE",
                next_node=REPLACE_CHILD_B_NODE,
            ),
        ],
        {"replace_child_a.rpy": replace_child_a_content_source()},
    )

    write_node(
        game_root,
        REPLACE_CHILD_B_NODE,
        node_data(REPLACE_CHILD_B_NODE, "REPLACE Child B"),
        replace_child_b_options_data(),
        [
            event_data(
                "replace_child_b_enter",
                "Child B 進入",
                "Auto:Enter",
                content="test_replace_child_b_enter",
            ),
            event_data(
                "replace_child_b_exit",
                "Child B 返回 Parent",
                "Action:exit_child_b",
                effects=[action_count],
                content="test_replace_child_b_exit",
                end_up="EXIT",
            ),
        ],
        {"replace_child_b.rpy": replace_child_b_content_source()},
    )

    return {
        "project_root": project_root,
        "game_root": game_root,
        "launcher": launcher,
        "version": version,
        "screen_file": game_root / TEST_UI_FILE,
        "manifest": game_root / TEST_MANIFEST_FILE,
        "nodes": list(TEST_NODES),
    }


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create a disposable Ren'Py project for comprehensive Scene Node Editor testing"
    )
    parser.add_argument("target", help="A blank Ren'Py project root or its game directory")
    parser.add_argument(
        "--launch-editor",
        action="store_true",
        help="Open the generated Scene Node Editor launcher on macOS",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        result = create_editor_test_unit(args.target)
    except EditorTestUnitError as exc:
        print("建立測試單元失敗：{}".format(exc), file=sys.stderr)
        return 1

    print("Scene Node Editor 綜合測試單元建立完成（版本 {}）。".format(result["version"]))
    print("Ren'Py 專案：{}".format(result["project_root"]))
    print("測試節點：{}".format(", ".join(result["nodes"])))
    print("外部介面：{}".format(result["screen_file"]))
    print("Editor 啟動器：{}".format(result["launcher"]))
    print("下一步：先在 Editor 執行『檢查專案』，再依操作指南逐項測試。")

    if args.launch_editor:
        if platform.system() != "Darwin":
            print("目前只有 macOS 支援自動開啟，請手動執行 Editor 啟動器。")
        else:
            subprocess.Popen(["open", str(result["launcher"])])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
