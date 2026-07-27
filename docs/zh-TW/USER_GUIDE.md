# Scene Node Editor 使用指南

[繁體中文](USER_GUIDE.md) · [English](../en/USER_GUIDE.md) · [回到首頁](../../README.md)

這份指南說明 Editor 的工作範圍與七個功能區。若尚未完成可玩流程，先閱讀 [建立第一個專案](FIRST_PROJECT.md)。

## 工作模型

```text
輸入來源 → Trigger → Event → Effects → Content → End up
```

輸入來源包含 Option、Keyboard、Mouse 與三種 Auto 時機。Trigger 只描述「發生了什麼」；目前 Scene Node 與 Global Node 的 Event Pool 共同決定反應。

## 責任邊界

| Editor／Runtime | 創作者 |
| --- | --- |
| 管理節點、選項、事件與狀態資料 | 設計遊戲規則、劇情與玩家體驗 |
| 選擇符合 Trigger／Conditions 的 Event | 撰寫 Content label 內的 Ren'Py |
| 套用 Effects 並控制 Scene Stack | 建立圖片、音效、字型與動畫 |
| 顯示資料化 Options | 撰寫 `gui.rpy`、`screens.rpy` 與 HUD |
| 檢查引用與資料格式 | 實作道具、時間、任務等專屬系統 |

一般遊戲內容不應直接修改 `game/FRAMEWORK/runtime.rpy` 或 `option_renderer.rpy`。更新時這兩個檔案會由 Installer 管理。

## 節點

Scene Node 是一個玩家互動單位。每個節點可設定：

- Name 與穩定 ID。
- 自己的 Options、Event Pool 與 Content 文件。

ROOT 是 Runtime 的起點。要刪除 ROOT，必須先將另一個節點設為起始節點。仍被 Event 的 Next Node 引用的節點不能刪除。

Node 不保存 Screen。HUD、場景外殼與其他 Screen 由創作者在 `.rpy` 中定義，再由 Content 使用 Ren'Py 原生 `show screen`、`hide screen` 或 `call screen` 控制。

### Global Node

節點列表頂端固定有一個不可刪除的 Global Node。它是全局 Event 與 Content 的編輯作用域，不是真實 Scene Node：

- 不進入 Scene Stack，不能成為 ROOT、GOTO 或 REPLACE 的目標。
- 沒有 Options 工作區，Global Event 不能使用 Option Trigger。
- On Node、Keyboard、Mouse Event 會與目前實際節點的同 Trigger Events 合併，再一起比較 Conditions、Priority 與 Weight。
- On Enter／On Exit 會在每個實際節點的對應生命週期中與本地 Events 一起依序執行。
- Global Event 的 REDO、GOTO、REPLACE、EXIT 都作用於當時的實際 Stack 頂端節點。
- Global Once 以 `once:global:<event_id>` 記錄，不會與一般節點的 Once 混用。

Global On Node 會在下一次節點互動循環檢查。若本地 Event 先增加時間再 GOTO，換日 Event 會在目標節點的 On Enter 之後、On Node 之前執行；它不是原 Event Content 與 End up 之間的同步 hook。

## 事件

Event 是目前節點對 Trigger 的反應。主要欄位：

- `Trigger`：On Enter、On Node、On Exit、Option、Keyboard 或 Mouse。
- `Priority`：數字越小越優先；只在最低 Priority 層中選擇。
- `Weight`：On Node／玩家輸入中，同 Trigger、同 Priority且 Conditions 都通過時的相對機率。
- `Once`：全遊戲只成功觸發一次。
- `Conditions`：Event 是否能成為候選。
- `Effects`：Event 執行時先套用的 Stat 或 Memory 改變。
- `Content`：接著呼叫的 Ren'Py label，可使用權重。
- `End up`：Content 返回後執行 REDO、GOTO、REPLACE 或 EXIT。GOTO／REPLACE 都可使用單一或權重 Next Node。

UI 中的 `Option` 技術格式仍是 `Action:<id>`。Event 選擇器會列出目前節點 Options 已註冊的 Triggers。

Picture 與 Preview Background 只列出 `game/images/`；Options 的 Hover Sound／Click Sound 只列出 `game/audio/`。資源可用子資料夾整理，Editor 會保留其階層供選擇，但選定欄位只顯示檔名。遊戲場景、BGM、SE 與轉場請在 Content 使用 Ren'Py 原生語法。

### Fallback

如果同一 Trigger 的條件 Event 可能全部失敗，請建立一個較低優先、無 Conditions 的 fallback。否則玩家輸入後 Runtime 找不到 Event，會顯示錯誤。

### 輸入來源

| UI | 保存格式 | 用途 |
| --- | --- | --- |
| On Enter | `Auto:Enter` | ROOT 啟動或 GOTO／REPLACE 進入節點時執行全部符合事件 |
| On Node | `Auto:Node` | 每輪互動前沿用原 Auto 的單一事件選擇 |
| On Exit | `Auto:Exit` | EXIT／REPLACE 將目前節點移出 Stack 前執行全部符合事件 |
| Option | `Action:<id>` | 由資料化 Option 回傳 |
| Keyboard | `Keyboard:<keysym>` | 在 Options 互動期間監聽鍵盤 |
| Mouse | `Mouse:<button>` | 左、中、右鍵或滾輪 |

Keyboard 欄位聚焦後直接按下按鍵或組合鍵即可錄製。

On Enter／On Exit 會先以同一份狀態快照判斷 Conditions，再依 Priority、Event ID 執行所有符合 Events；它們沒有 Weight、End up 或 Next Node。GOTO 子節點不算父節點退出，而子節點 EXIT 回到父節點也不算重新進入父節點。REPLACE 則執行目前節點的 On Exit，再直接進入目標節點的 On Enter；中間的父節點不會執行生命週期、On Node 或 Options。

## 選項

Options 是固定資料化的玩家互動介面。所有顯示的選項都可操作；個別顯示條件、可用條件與分流應使用不同 Scene Nodes 或 Events 表達。

支援三種 Element：

- `TEXTBOX`：垂直 Item 清單，可限制可見列數並捲動。
- `PICTURE`：圖片按鈕，可指定 Idle／Hover 圖片與 alpha hit test。
- `HITBOX`：場景上的透明互動區域。

表單模式負責 Name、Text、Trigger、圖片與聲音。畫布模式負責位置、尺寸、圖層、Hover、顏色與視覺細節。

畫布 Preview Background 只改變該 Options 文件的 Editor 預覽；留空代表沒有預覽底圖，不影響遊戲畫面。

Options 使用單一 Interaction 生命週期：玩家輸入 Trigger 後 Screen 結束；若 Event 使用 REDO，Runner 會重新呼叫它。

## 演出 Content

Content 是 Editor 管理位置與引用的原生 `.rpy` 文件。創作者仍在 label 中撰寫對話、角色、背景、音訊、轉場、ATL 或自訂 Python。

```renpy
label content_example:
    scene room with dissolve
    play music "audio/room.ogg" fadein 1.0
    "這是一段演出。"
    return
```

要在進入節點時顯示背景或播放音樂，可讓 `Auto:Enter` Event 指向這個 label；離開時的淡出或清理則使用 `Auto:Exit` Content。

Content label 應返回 Runner。不要在一般 Content 中自行複製 Event Effects 或直接改寫 Scene Stack。

## 狀態

### Stats

Stats 是有 `Init`、`Min`、`Max` 的數值。Conditions 可比較數值，Effects 可 `set`、`+`、`-`、`*`、`/`。

### Memory Banks

Memory Banks 保存標籤。Conditions 使用 `has`／`not_has`，Effects 使用 `add`／`remove`／`clear`。

預設 `Memory` 不可刪除，也用來記錄 Once Events。自訂 Bank 不會自動每日或每週重設；請由遊戲自己的換日流程明確執行 clear。

## 關聯圖

關聯圖依 GOTO／REPLACE 的 Next Node 產生唯讀有向圖。GOTO 使用實線，REPLACE 使用同色虛線；若 `Parent → A` 是 GOTO 且 `A → B` 是 REPLACE，圖上另以較透明的實線顯示推導出的 `Parent → B` 管理關係。Global Event 的線條標示為 Contextual Transition，表示實際來源是觸發當下的 Stack 頂端，不代表 Runtime 進入 Global Node。關聯圖不建立 Schema Parent，也不直接修改 Event。

- 滾輪或觸控板雙指上下移動：以游標位置縮放。
- 拖曳空白處：平移。
- 搜尋：淡化不符合的節點。
- 圓形按鈕：重新置中。
- 點擊節點：切換 Editor 目前節點。

## 檢查專案

在執行遊戲或提交版本前，使用「檢查」確認：

- JSON 與 Schema 合法。
- Stat、Memory、Content 與 Next Node 引用存在。
- ROOT 與 Runtime 入口已設定。

檢查通過不代表遊戲設計必然正確；Conditions、權重與劇情結果仍需實際遊玩驗證。

## 自訂 Ren'Py 介面

`gui.rpy` 適合全域尺寸、字型與樣式變數；`screens.rpy` 或其他 `.rpy` 適合 Screen 結構。Editor 不掃描或保存 Screen 引用；顯示與關閉時機由 Content 的原生 Ren'Py 語法決定。

若需要 Editor 尚未資料化的系統，例如背包、日曆或地圖，請在創作者 `.rpy` 中實作，再透過 Content、Stats、Memories 或公開 Runtime API 連接。不要把它藏進 Options Renderer。

## 儲存、更新與復原

- Editor 預設自動儲存；較舊的儲存回應不會覆蓋較新的修改，切換節點或分頁前會完成目前待處理寫入。
- 階層下拉選單可用 `↑`／`↓` 巡覽、`→` 進入子層、`←` 返回父層、Enter 選取及 Esc 關閉。
- 快捷鍵與 Editor 設定存於專案根目錄 `.scene-node-editor/settings.json`。
- 重新執行 Installer 只更新受管理 Editor／Runtime。
- 刪除的節點移至 `.scene-node-trash/`，不會由 Ren'Py 載入。

技術格式與 Runtime API 請閱讀 [Reference](REFERENCE.md)。
