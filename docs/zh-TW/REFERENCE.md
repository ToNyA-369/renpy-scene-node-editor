# Scene Node Editor 技術參考

[繁體中文](REFERENCE.md) · [English](../en/REFERENCE.md) · [回到首頁](../../EDITOR/README.md)

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
      TEXTBOX_PROFILES/<profile_id>.json
    GLOBALNODE/
      Node.json
      Options.json
      EVENTPOOL/<event_id>.json
      CONTENT/<file>.rpy
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
  "Group": "第一章",
  "Order": 2,
  "Content Order": ["room_enter", "room_options"]
}
```

- `ID`：穩定技術 ID。
- `Name`：可修改的顯示名稱。
- `Group`：可選的單層 Editor 群組名稱；省略或留空時正規化為 `Normal`。
- `Order`：可選的非負整數，只保存 Scene Node 列表拖移順序。
- `Content Order`：可選的字串陣列，只保存該 authoring scope 的 Content 文件清單順序。

`Group`、Scene Node `Order` 與 Content `Content Order` 都是 Editor-only metadata；舊資料缺值時依既有穩定掃描順序顯示，首次拖移後才寫入。Scene Node 群組沿用 Event Pool 的停留成組、跨框移入／移出、整組排序與單一成員自動解散行為；選中成員時群組保持展開，改選外部節點後則沿展開的反向路徑縮合，收合完成且 pointerleave 前不接受 hover 重新展開。整組落位保存後，只有包含目前選取節點的群組才從拖移時的標題高度重新展開。Global Node 固定在群組流之外。這些資訊不參與 ROOT、Stack、Event 選擇、關聯圖布局或 Runtime。

## Global Node

`GLOBALNODE/Node.json` 固定使用：

```json
{ "ID": "__global__", "Name": "GLOBAL" }
```

Name 可修改，ID 不可修改。Global Node 不屬於 `scene_catalog["nodes"]`，不進入 `scene_stack`，不能成為 Root 或 Next Node。它使用與 Scene Node 相同格式的 `Options.json`；這些 Options 會在任何實際節點中與當前節點 Options 一起顯示。Global Event 可使用其 `Action:<option_id>` Trigger，也可用 Option Effect 控制 `__global__` 作用域內的 `CONTROLLED` 目標。

Global Event prepare 同時保存 `owner_node_id = "__global__"` 與 `node_id = <目前 Stack 頂端>`。Once 使用 `once:global:<event_id>`；Effects 與 Content 屬於 Global Event，而非生命週期 Event 的 End up 會依目前實際 Stack 執行。

## Options.json

```json
{
  "Version": 3,
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
  "Availability": "ALWAYS",
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
  "Appearance": {
    "Profile": "glass",
    "Features": {
      "hover_accent": true,
      "text_shadow": false,
      "staggered_entrance": true
    },
    "Style Overrides": { "Text Size": 34 }
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
      "Availability": "CONTROLLED",
      "Style Override": {}
    }
  ]
}
```

`Appearance` 是 Version 3 的可選欄位。`Profile` 引用 `DATA/TEXTBOX_PROFILES/<profile_id>.json` 的穩定 ID；`Features` 只覆寫設定檔內特性的啟用狀態；`Style Overrides` 只保存這個 Text Box 與設定檔不同的欄位。解析順序固定為預設樣式 → 設定檔 → Text Box 覆寫 → Item `Style Override`。未設定 Profile 時沿用既有 `Style`；Profile 缺失或損壞時也回退 `Style`，並由專案檢查提出提醒。

外觀設定檔為專案共用的創作者資料，每個檔案格式如下：

```json
{
  "Version": 1,
  "ID": "glass",
  "Name": "Glass",
  "Order": 0,
  "Style": {
    "Background": "#102030cc",
    "Item Background": "#203040dd",
    "Text Color": "#ffffff",
    "Text Size": 30,
    "Text Align": 0.5
  },
  "Features": {
    "hover_accent": { "Enabled": true, "Color": "#5c7265", "Width": 6 },
    "hover_text_color": { "Enabled": false, "Color": "#ffffff" },
    "item_border": { "Enabled": false, "Color": "#ffffff33", "Width": 1 },
    "text_shadow": { "Enabled": false, "Color": "#00000088", "Size": 2, "X": 0, "Y": 2 },
    "text_outline": { "Enabled": false, "Color": "#000000cc", "Size": 1 },
    "staggered_entrance": { "Enabled": true, "Distance": 18, "Delay": 0.04, "Duration": 0.22 }
  }
}
```

外觀設定檔的可選 `Order` 是 Editor-only 非負整數，只決定設定檔管理清單順序；Runtime 解析外觀時忽略它。

六個特性分別控制 Hover 側邊強調條、Hover 文字色、Item 邊框、文字陰影、文字描邊，以及每次 Options interaction 開啟時的逐項進場。舊設定檔缺少新增特性時一律視為停用。編輯器與 Runtime 使用相同參數。設定檔 ID 與檔名必須一致；仍被 Text Box 引用時不可刪除。Installer 只會建立空資料夾，不會覆寫這些檔案。

### Picture

Picture 使用相同的 `ID`、`Name`、`Availability`、`Layout`、`Hover` 與聲音欄位，並增加：

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

`Availability` 可為 `ALWAYS` 或 `CONTROLLED`。`ALWAYS` 永遠顯示；`CONTROLLED` 初始隱藏，由 Option Effect 啟用後顯示、停用後隱藏。PICTURE／HITBOX 只支援 Element 層級；TEXTBOX 可分別控制整個 Element 與其中 Item。Item 只有在父 Element 與自身都可用時顯示；父 Element 關閉不會清除 Item 狀態，沒有可見 Item 的 TEXTBOX 會自動隱藏。

Options 沒有生命週期、條件運算式或自訂 Screen 來源。所有已顯示的 Options 都可操作。Version 1 或省略 `Availability` 的資料視為 `ALWAYS`；Version 1／2 在下次儲存時正規化為 Version 3，未使用外觀設定檔時的顯示不變。

`Elements` 與 TEXTBOX 的 `Items` 都是有序陣列。Editor 可由列留白以 Pointer 拖移並直接重排既有陣列，不新增 Group 或 Order 欄位。Runtime 會將目前節點與 Global Options 合併後依 `Z Order` 由小到大繪製；數字較大的 Element 位於上層，重疊時也優先接收滑鼠互動。`Z Order` 相同時保留作用域與 Element 陣列的穩定順序，陣列中較後方者位於較上層。啟用 PICTURE 的 Alpha Hit Test 時，圖片透明像素不攔截下層互動。Item 陣列順序決定顯示及逐項進場順序。

## Event

```json
{
  "ID": "open_door",
  "Name": "打開門",
  "Group": "Normal",
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

`Priority` 必須是 0–9 的整數；新 Event 缺值時預設為 5。Runtime 仍只取數字最小的符合層級，或在生命週期 Events 中依數字由小到大執行。

`Group` 是只供 Editor 整理 Event Pool 的單層創作者資訊；省略或留空時會正規化為固定的 `Normal`。`Normal` 在介面上表示未群組，不顯示群組標題。可選的非負整數 `Order` 同樣只供 Editor 保存拖曳順序；舊 Event 缺值時沿用原本的穩定讀取順序。兩者都不參與 Trigger 比對、Priority、Weight、生命週期順序、關聯圖或 Runtime 執行。Pointer 拖移預覽逐事件更新，幾何判定與 DOM 重排則以 animation frame 合併；中線遲滯避免插入位置抖動，最近的可捲動容器支援漸進邊緣自動捲動。拖移生命週期由視窗持續接收，因此元素跨容器重排不會中斷後續 pointer 事件。真實插入間隙以短促 FLIP 位移推開 Event／群組區塊；排序流有永遠存在的末端留白，跨出或跨入群組邊界即改變歸屬，不使用專用未群組按鈕。只有游標持續位於候選項目目前的幾何邊界內，500ms 停留計時才會成立；未群組候選下方會展開 48px 的群組預留空間，讓位後離開邊界則取消成組。群組預設收起為精簡名稱與數量，hover、鍵盤 focus、拖移進入或選中內部 Event 時展開；改選外部 Event 會先還原重繪前的展開幾何，再使用與展開相同的 220ms 曲線反向縮合，動畫完成且 pointerleave 前不重新接受 hover。群組內排序後保持展開至 pointerleave。名稱旁的無圖示留白是群組區塊拖移面，起拖時浮動預覽會以 220ms 縮合並以成員原順序整組移動；落位保存後，只有包含目前選取 Event 的群組才從相同標題高度展開，其他群組維持收合。只剩一個 Event 時自動解散。成功拖移不產生 Toast，失敗仍顯示錯誤。

`Content` 與 `Next Node` 可為 `null`、單一字串或權重物件：

```json
{
  "content_day": 3,
  "content_night": 1
}
```

權重必須大於 0。

`Conditions` 與 `Effects` 是有序陣列。每個 Condition 可帶 `clause: <string|null>`：相同非空 clause 的 Conditions 必須全部通過（AND），不同 clause 與 `null` 的獨立 Condition 之間只需任一分支通過（OR）。沒有任何 `clause` 欄位的舊資料維持原本的全 AND 語意，Editor 保存時會把它們正規化至單一 `and_1` 群組。Editor 以群組框表示 AND、群組／獨立條件之間顯示 OR；條件可拖入、拖出及排序，單成員 AND 群組不會自動解散。Effects 則由列留白拖移並在 Content 返回後依陣列順序執行。權重物件仍是機率映射，不提供拖移排序。

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

支援 `has`、`not_has`。例如 `(money >= 10 AND member) OR hour >= 18` 可保存為：

```json
[
  { "type": "stat", "id": "money", "op": ">=", "value": 10, "clause": "and_1" },
  { "type": "memory", "bank": "memory", "id": "member", "op": "has", "clause": "and_1" },
  { "type": "stat", "id": "hour", "op": ">=", "value": 18, "clause": null }
]
```

空 Conditions 仍代表無條件候選。條件只允許一層 OR-of-AND，不支援巢狀群組。

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

Option Element：

```json
{ "type": "option", "op": "enable", "target": "element", "node": "shop", "element": "special_actions" }
```

TEXTBOX Item：

```json
{ "type": "option", "op": "disable", "target": "item", "node": "shop", "element": "shop_actions", "item": "buy_weapon" }
```

Option Effect 支援 `enable`、`disable`，只能指向 Event 所屬 Options 作用域內的 `CONTROLLED` 目標：Scene Node Event 指向同一節點，Global Event 指向 `__global__`；兩者都不得跨作用域。操作是冪等的；狀態保存在 Ren'Py 存檔與 rollback 中，不因 REDO、GOTO、REPLACE 或 EXIT 自動重設，但新遊戲會由 `scene_reset_state()` 清空。Editor 只列出目前作用域的 Element／Item 創作者 Name，JSON 保存穩定 Node／Element／Item ID；刪除仍被 Effect 引用的 Element 或 Item 會被拒絕。

Event Effects 處理 Stat、Memory 與 Option Availability。背景、音樂、音效、轉場與淡入淡出由 Content label 使用原生 Ren'Py 語法完成。Options 的 Hover Sound／Click Sound 仍可從 `game/audio/` 選擇。

## Stats 與 Memories

`Stats.json`：

```json
{
  "money": { "Name": "金錢", "Group": "資源", "Init": 0, "Min": 0, "Max": 999 }
}
```

`Group` 是編輯管理資訊；省略或空白時會正規化為 `Normal`，但介面將其顯示為未群組 Stats，不顯示 `Normal` 標題。可選的非負整數 `Order` 只供 Editor 保存拖曳順序。狀態工作區只有一個新增 Stat 按鈕；所有 Stat 共用最上方唯一一列 Name／Min／Init／Max 欄名與相同 CSS Grid 欄寬，群組列維持欄位對齊並在群組框左右保留內距。Pointer 拖移可從整列外框或欄位間留白開始，輸入框與刪除按鈕不會啟動拖移，也不使用獨立把手；拖移期間整個排序流停用文字選取。群組名稱旁的無圖示留白會以成員原順序拖移整個群組。即時插入間隙與 Event 相同，末端留白即使在沒有未群組 Stat 時仍存在，因此可直接移出／移入群組；停留至群組框展開才建立群組，剩一個 Stat 時群組自動解散。成功拖移不產生 Toast。Event 的 Stat Condition／Effect 選單仍以「Group → Stat」顯示；JSON key、Runtime 狀態、存檔與 `scene_get_stat("money")` 只使用平面的穩定 Stat ID，不形成巢狀資料。

`Memories.json`：

```json
{
  "memory": { "Name": "Memory" },
  "daily": { "Name": "每日記憶" }
}
```

`memory` 是必要預設 Bank。一般 Once Event 記錄為 `once:<event_id>`；Global Once Event 記錄為 `once:global:<event_id>`。

Memory Banks 在 JSON 中維持物件結構；Editor 以物件鍵的插入順序保存拖移後的顯示順序，不新增 schema 欄位。順序不參與 Runtime 查找、Once key、公開 API 或 Ren'Py 存檔語意。

## Event 決策

`Auto:Node`、Option、Keyboard 與 Mouse 使用單一選擇流程：

1. 合併目前 Node 與 Global Node 中 Trigger 相同的 Events；Trigger 可由目前節點或全域 Options 回傳。
2. 排除 Conditions 失敗及已完成的 Once Events。
3. 找出最小 Priority。
4. 只在該 Priority 中依 Weight 選出一個 Event。
5. 選擇並呼叫 Content。
6. Content 返回後，寫入 Once 並套用 Effects。
7. 在 prepare 階段選定 GOTO／REPLACE 的單一或權重 Next Node；Content 返回後、任何 On Exit 之前確認目標存在。
8. 執行 End up。

`Auto:Enter`／`Auto:Exit` 使用批次生命週期流程，並合併目前 Node 與 Global Node 的 Events：

1. 在任何 Effects 執行前，以同一份狀態快照檢查所有 Conditions 與 Once。
2. 將所有符合的 Events 依 Priority 由小到大、再依 Event ID 排序。
3. 依序呼叫每個 Event 的 Content；各自返回後再寫入 Once 並套用該 Event 的 Effects。

生命週期 Event 不做 Weight 抽選，也不改變 Scene Stack。

Global On Node 在 Runner 下一次互動循環才參與選擇。若前一個本地 Event 改變狀態後使用 GOTO，目的地 On Enter 會先執行，接著才檢查 Global On Node；Global Event 不是插入主 Event Content 與 End up 之間的同步 hook。

## Scene Stack

- `REDO`：留在目前 Node，開始下一輪。
- `GOTO`：將目標 Node push 到 stack。
- `REPLACE`：需要實際 Stack 深度大於 1，將頂端原子替換為目標 Node：`[父, 目前] → [父, 目標]`。
- `EXIT`：pop 目前 Node；有父節點時回到父節點，ROOT 時結束 Runner。

Content 先於 Effects 執行。Content label 必須 `return`；返回後 Runtime 才寫入 Once、套用 Effects，並繼續處理 End up。

REPLACE 的順序是 Event Content、Once／Effects、目標有效性檢查、目前節點 On Exit、原子替換、目標 On Enter，最後進入目標 On Node／Options。目前節點的 On Exit Conditions 因此能看見主 Event Effects 與 Content 造成的狀態改變。父節點在整個過程中不執行 On Enter、On Exit、On Node 或 Options；目標之後 EXIT 會回到原本父節點，不會回到被替換的節點。

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
.scene-node-editor/docs/zh-TW/*.md
.scene-node-editor/docs/en/*.md
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
啟動 Scene Node 編輯器.command
```

它不得覆寫 `DATA/`、`SCENENODE/`、創作者 `.rpy` 或素材。
