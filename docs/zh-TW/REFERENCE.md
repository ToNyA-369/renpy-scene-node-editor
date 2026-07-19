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
  "Name": "我的房間",
  "Background": "images/room.webp",
  "Screen": "room_hud"
}
```

- `ID`：穩定技術 ID。
- `Name`：可修改的顯示名稱。
- `Background`：`game/images/` 圖片路徑、已宣告的 Ren'Py image 名稱或空字串。
- `Screen`：無參數 Screen 名稱或空字串。

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

空白 `Preview Background` 代表繼承 Node Background。它只影響 Editor 預覽。

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

## Triggers

```text
Auto
Action:<option_id>
Keyboard:<Ren'Py keysym>
Mouse:<Left|Middle|Right|WheelUp|WheelDown>
```

Mouse 會映射為 Ren'Py keysyms：左／中／右鍵為 `mouseup_1/2/3`，滾輪上下為 `mousedown_4/5`。

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

Audio：

```json
{ "type": "bgm", "id": "audio/theme.ogg", "op": "play", "persistent": false }
```

類型為 `bgm` 或 `se`，操作為 `play`／`stop`。非 persistent 音效在離開所屬 Node 時釋放。

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

1. 取得目前 Node 中 Trigger 相同的 Events。
2. 排除 Conditions 失敗及已完成的 Once Events。
3. 找出最小 Priority。
4. 只在該 Priority 中依 Weight 選出一個 Event。
5. 套用 Effects。
6. 選擇並呼叫 Content。
7. 執行 End up。

## Scene Stack

- `REDO`：留在目前 Node，開始下一輪。
- `GOTO`：將目標 Node push 到 stack。
- `EXIT`：pop 目前 Node；有父節點時回到父節點，ROOT 時結束 Runner。

Effects 先於 Content 執行。Content label 必須 `return`，才能讓 Runner 繼續處理 End up。

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

Node 的 `Screen` 只顯示場景外殼或 HUD，不等待回傳值。Screen 應為無參數：

```renpy
screen room_hud():
    text "Money: [scene_get_stat('money', 0)]"
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
