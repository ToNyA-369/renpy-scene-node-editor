#!/usr/bin/env python3
"""Create a disposable Ren'Py project for broad Scene Node Editor testing."""

import argparse
import base64
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

import install


TEST_UI_FILE = "scene_editor_test_ui.rpy"
TEST_IMAGE_FILE = "images/scene_editor_test_picture.png"
TEST_MANIFEST_FILE = "SCENE_EDITOR_TEST_UNIT.json"
ROOT_NODE = "root"
OPTIONS_NODE = "options_lab"
BRANCH_NODE = "branch_lab"
SUCCESS_NODE = "outcome_success"
FALLBACK_NODE = "outcome_fallback"
TEST_NODES = (ROOT_NODE, OPTIONS_NODE, BRANCH_NODE, SUCCESS_NODE, FALLBACK_NODE)

# A tiny valid PNG which the DATA Picture option stretches and tints.
TEST_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


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
    )
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
    return {
        "ID": event_id,
        "Name": name,
        "Trigger": trigger,
        "Priority": priority,
        "Weight": weight,
        "Once": once,
        "Conditions": conditions or [],
        "Effects": effects or [],
        "Content": content,
        "End up": end_up,
        "Next Node": next_node if end_up == "GOTO" else None,
    }


def option_item(item_id, text, trigger):
    return {
        "ID": item_id,
        "Name": text,
        "Text": text,
        "Trigger": trigger,
        "Style Override": {},
    }


def textbox_element(element_id, name, items, *, x=500, y=210, width=920, height=580):
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
        "Hover Sound": "",
        "Click Sound": "",
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
        option_item("finish", "結束這次 Runtime 測試", "Action:finish"),
    ]
    return options_document([
        textbox_element("root_actions", "綜合測試入口", items, x=600, y=260, width=720, height=520)
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
        "Hover Sound": "",
        "Click Sound": "",
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
        "Hover Sound": "",
        "Click Sound": "",
    }
    return options_document([textbox_element("data_actions", "DATA Options 綜合測試", items), picture, hitbox])


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


def screen_source():
    return '''# @display_name: Scene Editor 綜合測試介面
# 這個文件由創作者自行維護；Editor 只引用 Screen 名稱。

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
        "Background": "",
        "Screen": "scene_editor_test_hud",
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
