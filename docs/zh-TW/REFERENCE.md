# Scene Node Editor 技術參考

[繁體中文](REFERENCE.md) · [English](../en/REFERENCE.md) · [回到首頁](../../README.md)

這份文件定義目前公開 alpha 的資料與 Runtime 契約。一般操作請閱讀 [User Guide](USER_GUIDE.md)。

## 專案結構

```text
<RenPy Project>/
  .scene-node-editor/             Editor、設定與安裝資訊
  啟動 Scene Node 編輯器.command
  game/
    FRAMEWORK/                    Installer 管理的 Runtime
    DATA/
      SceneProject.json
      Stats.json
      Memories.json
    SCENENODE/
      <node_path>/
        Node.json
        Options.json
        EVENTPOOL/<event_id>.json
        CONTENT/<file>.rpy
```

`gui.rpy`、`screens.rpy`、其他創作者 `.rpy` 與素材不屬於框架管理檔案。

## SceneProject.json

```json
{
  "Version": 1,
  "Root Node": "root"
}
```

`Root Node` 是全遊戲唯一的 Runtime 預設入口。也可顯式呼叫 `scene_runtime_start("node_id")` 覆蓋它。

## Node.json

```json
{
  "ID": "room",
  "Name": "我的房間"
}
```

- `ID`：穩定技術 ID。
- `Name`：可修改的顯示名稱。

## Options.json

```json
{
  "Version": 1,
  "Canvas": {
    "Width": 1920,
    "Height": 1080,
    "Preview Background": ""
  },
  "Elements": []
}
```

`Preview Background` 只影響 Editor 的 Options 畫布預覽；空字串代表不顯示預覽底圖，不會改變遊戲場景。

### Text Box

```json
{
  "ID": "actions",
  "Name": "行動",
  "Type": "TEXTBOX",
  "Layout": { "X": 600, "Y": 300, "Width": 720, "Height": 400, "Z Order": 10 },
  "List": {
    "Max Visible Items": 4,
    "Item Height": 72,
    "Item Spacing": 12,
    "Padding": 16,
    "Show Scrollbar": true
  },
  "Style": {
    "Background": "#0b1118e8",
    "Item Background": "#20302a",
    "Text Color": "#ffffff",
    "Text Size": 30,
    "Text Align": 0.5
  },
  "Hover": { "Enabled": true, "Color": "#ffffff18" },
  "Hover Sound": "",
  "Click Sound": "",
  "Items": [
    {
      "ID": "continue",
      "Name": "繼續",
      "Text": "繼續",
      "Trigger": "Action:continue",
      "Style Override": {}
    }
  ]
}
```

### Picture

Picture 使用相同的 `ID`、`Name`、`Layout`、`Hover` 與聲音欄位，並增加：

```json
{
  "Type": "PICTURE",
  "Trigger": "Action:picture",
  "Picture": {
    "Idle": "images/button.png",
    "Hover": "images/button_hover.png",
    "Fit": "CONTAIN",
    "Keep Aspect": true,
    "Opacity": 1,
    "Tint": "#ffffff",
    "Alpha Hit Test": false
  }
}
```

### Hitbox

```json
{
  "Type": "HITBOX",
  "Trigger": "Action:door",
  "Hitbox": {
    "Editor Color": "#28a47d",
    "Editor Opacity": 0.24
  }
}
```

Options 沒有生命週期、個別顯示條件或自訂 Screen 來源。所有顯示的 Options 都可操作。

## Event

```json
{
  "ID": "open_door",
  "Name": "打開門",
  "Trigger": "Action:open_door",
  "Priority": 3,
  "Weight": 1,
  "Once": false,
  "Conditions": [],
  "Effects": [],
  "Content": "content_open_door",
  "End up": "GOTO",
  "Next Node": "hall"
}
```

`Content` 與 `Next Node` 可為 `null`、單一字串或權重物件：

```json
{
  "content_day": 3,
  "content_night": 1
}
```

權重必須大於 0。

一般 Event 的 `End up` 可為 `REDO`、`GOTO`、`REPLACE` 或 `EXIT`。`GOTO` 與 `REPLACE` 必須提供 `Next Node`；Editor 顯示 Node Name，但 JSON 保存穩定 Node ID。REPLACE 範例：

```json
{
  "End up": "REPLACE",
  "Next Node": "adjacent_scene"
}
```

`Auto:Enter` 與 `Auto:Exit` 是生命週期 Event，不含 `Weight`、`End up` 或 `Next Node`：

```json
{
  "ID": "room_enter",
  "Name": "進入房間",
  "Trigger": "Auto:Enter",
  "Priority": 1,
  "Once": false,
  "Conditions": [],
  "Effects": [],
  "Content": "room_enter_presentation"
}
```

## Triggers

```text
Auto:Enter
Auto:Node
Auto:Exit
Action:<option_id>
Keyboard:<Ren'Py keysym>
Mouse:<Left|Middle|Right|WheelUp|WheelDown>
```

Mouse 會映射為 Ren'Py keysyms：左／中／右鍵為 `mouseup_1/2/3`，滾輪上下為 `mousedown_4/5`。

- `Auto:Enter`：ROOT 啟動或 GOTO／REPLACE 進入節點時執行。
- `Auto:Node`：每輪互動前檢查，語意等同原本的 Auto。
- `Auto:Exit`：EXIT／REPLACE 將目前節點移出 Stack 之前執行。

子節點 EXIT 回到父節點時，不會再次觸發父節點的 `Auto:Enter`；GOTO 子節點也不會觸發父節點的 `Auto:Exit`。

## Conditions

Stat：

```json
{ "type": "stat", "id": "money", "op": ">=", "value": 10 }
```

支援 `>`、`>=`、`<`、`<=`、`==`、`!=`。

Memory：

```json
{ "type": "memory", "bank": "memory", "id": "has_key", "op": "has" }
```

支援 `has`、`not_has`。Event 的所有 Conditions 都必須通過。

## Effects

Stat：

```json
{ "type": "stat", "id": "money", "op": "-", "value": 10 }
```

支援 `set`、`+`、`-`、`*`、`/`，結果受 Stat Min／Max 限制。

Memory：

```json
{ "type": "memory", "bank": "memory", "id": "has_key", "op": "add" }
```

支援 `add`、`remove`、`clear`；`clear` 不使用 `id`。

Event Effects 只處理 Stat 與 Memory。背景、音樂、音效、轉場與淡入淡出由 Content label 使用原生 Ren'Py 語法完成。Options 的 Hover Sound／Click Sound 仍可從 `game/audio/` 選擇。

## Stats 與 Memories

`Stats.json`：

```json
{
  "money": { "Name": "金錢", "Init": 0, "Min": 0, "Max": 999 }
}
```

`Memories.json`：

```json
{
  "memory": { "Name": "Memory" },
  "daily": { "Name": "每日記憶" }
}
```

`memory` 是必要預設 Bank。Runtime 將 Once Event 記錄為 `once:<event_id>`。

## Event 決策

`Auto:Node`、Option、Keyboard 與 Mouse 使用單一選擇流程：

1. 取得目前 Node 中 Trigger 相同的 Events。
2. 排除 Conditions 失敗及已完成的 Once Events。
3. 找出最小 Priority。
4. 只在該 Priority 中依 Weight 選出一個 Event。
5. 套用 Effects。
6. 選擇並呼叫 Content。
7. 在 prepare 階段選定 GOTO／REPLACE 的單一或權重 Next Node；Content 返回後、任何 On Exit 之前確認目標存在。
8. 執行 End up。

`Auto:Enter`／`Auto:Exit` 使用批次生命週期流程：

1. 在任何 Effects 執行前，以同一份狀態快照檢查所有 Conditions 與 Once。
2. 將所有符合的 Events 依 Priority 由小到大、再依 Event ID 排序。
3. 依序套用每個 Event 的 Effects 並呼叫 Content。

生命週期 Event 不做 Weight 抽選，也不改變 Scene Stack。

## Scene Stack

- `REDO`：留在目前 Node，開始下一輪。
- `GOTO`：將目標 Node push 到 stack。
- `REPLACE`：需要實際 Stack 深度大於 1，將頂端原子替換為目標 Node：`[父, 目前] → [父, 目標]`。
- `EXIT`：pop 目前 Node；有父節點時回到父節點，ROOT 時結束 Runner。

Effects 先於 Content 執行。Content label 必須 `return`，才能讓 Runner 繼續處理 End up。

REPLACE 的順序是 Event Effects、Event Content、目標有效性檢查、目前節點 On Exit、原子替換、目標 On Enter，最後進入目標 On Node／Options。Conditions 因此能看見主 Event Effects 與 Content 造成的狀態改變。父節點在整個過程中不執行 On Enter、On Exit、On Node 或 Options；目標之後 EXIT 會回到原本父節點，不會回到被替換的節點。

REPLACE 的父層限制以目前執行中的實際 Stack 深度判斷，不以專案 Root Node ID 判斷。因此 `scene_runtime_start("node_id")` 將任意節點作為第一層時，該節點也不能執行 REPLACE；Runtime 會回報明確錯誤。REPLACE 不依資料夾或靜態 Parent 欄位限制目標。

需要場景與音訊演出時，建議由生命週期 Content 使用 Ren'Py 原生語法：

```renpy
label room_enter_presentation:
    scene room with dissolve
    play music "audio/room.ogg" fadein 1.0
    return
```

## 公開 Runtime 入口

```renpy
call scene_runtime_start()
call scene_runtime_start("node_id")
```

可在創作者 Ren'Py 程式中使用：

```renpy
$ value = scene_get_stat("money", 0)
$ scene_memory_has("memory", "has_key")
$ scene_memory_add("memory", "has_key")
$ scene_memory_remove("memory", "has_key")
$ scene_memory_clear("daily")
```

不要從遊戲內容直接呼叫其他 `scene_*` 內部輔助函式。

## Ren'Py Screen

Screen 與 HUD 屬於原生 Ren'Py 演出，不保存在 Node Schema。由 Content 明確顯示、關閉或呼叫：

```renpy
screen room_hud():
    text "Money: [scene_get_stat('money', 0)]"

label room_enter_presentation:
    show screen room_hud
    return

label room_exit_presentation:
    hide screen room_hud
    return
```

玩家輸入仍由資料化 Options、Keyboard 或 Mouse Trigger 提供。

## 儲存與更新契約

Installer 可更新：

```text
.scene-node-editor/EDITOR/
.scene-node-editor/AI_CONTEXT.md
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
啟動 Scene Node 編輯器.command
```

它不得覆寫 `DATA/`、`SCENENODE/`、創作者 `.rpy` 或素材。
