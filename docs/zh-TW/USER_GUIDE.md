# Scene Node Editor 使用指南

[繁體中文](USER_GUIDE.md) · [English](../en/USER_GUIDE.md) · [回到首頁](../../README.md)

這份指南說明 Editor 的工作範圍與七個功能區。若尚未完成可玩流程，先閱讀 [建立第一個專案](FIRST_PROJECT.md)。

## 工作模型

```text
輸入來源 → Trigger → Event → Effects → Content → End up
```

輸入來源包含 Option、Keyboard、Mouse 與 Auto。Trigger 只描述「發生了什麼」；目前 Scene Node 的 Event Pool 才決定反應。

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
- `game/images/` 中的 Background，或 `None`。
- 一個無參數 Scene Screen。
- 自己的 Options、Event Pool 與 Content 文件。

ROOT 是 Runtime 的起點。要刪除 ROOT，必須先將另一個節點設為起始節點。仍被 Event 的 Next Node 引用的節點不能刪除。

Scene Screen 適合 HUD 或場景外殼。它不選 Event、不執行 GOTO，也不取代 Options Renderer。

## 事件

Event 是目前節點對 Trigger 的反應。主要欄位：

- `Trigger`：Auto、Option、Keyboard 或 Mouse。
- `Priority`：數字越小越優先；只在最低 Priority 層中選擇。
- `Weight`：同 Trigger、同 Priority 且 Conditions 都通過時的相對機率。
- `Once`：全遊戲只成功觸發一次。
- `Conditions`：Event 是否能成為候選。
- `Effects`：選中 Event 後先套用的狀態或音效改變。
- `Content`：接著呼叫的 Ren'Py label，可使用權重。
- `End up`：Content 返回後執行 REDO、GOTO 或 EXIT。

UI 中的 `Option` 技術格式仍是 `Action:<id>`。Event 選擇器會列出目前節點 Options 已註冊的 Triggers。

### Fallback

如果同一 Trigger 的條件 Event 可能全部失敗，請建立一個較低優先、無 Conditions 的 fallback。否則玩家輸入後 Runtime 找不到 Event，會顯示錯誤。

### 輸入來源

| UI | 保存格式 | 用途 |
| --- | --- | --- |
| Auto | `Auto` | 每輪先由 Runner 主動檢查 |
| Option | `Action:<id>` | 由資料化 Option 回傳 |
| Keyboard | `Keyboard:<keysym>` | 在 Options 互動期間監聽鍵盤 |
| Mouse | `Mouse:<button>` | 左、中、右鍵或滾輪 |

Keyboard 欄位聚焦後直接按下按鍵或組合鍵即可錄製。

## 選項

Options 是固定資料化的玩家互動介面。所有顯示的選項都可操作；個別顯示條件、可用條件與分流應使用不同 Scene Nodes 或 Events 表達。

支援三種 Element：

- `TEXTBOX`：垂直 Item 清單，可限制可見列數並捲動。
- `PICTURE`：圖片按鈕，可指定 Idle／Hover 圖片與 alpha hit test。
- `HITBOX`：場景上的透明互動區域。

表單模式負責 Name、Text、Trigger、圖片與聲音。畫布模式負責位置、尺寸、圖層、Hover、顏色與視覺細節。

畫布 Preview Background 預設繼承 Node Background；自選圖片只改變該 Options 文件的預覽。

Options 使用單一 Interaction 生命週期：玩家輸入 Trigger 後 Screen 結束；若 Event 使用 REDO，Runner 會重新呼叫它。

## 演出 Content

Content 是 Editor 管理位置與引用的原生 `.rpy` 文件。創作者仍在 label 中撰寫對話、角色、轉場、ATL 或自訂 Python。

```renpy
label content_example:
    "這是一段演出。"
    return
```

Content label 應返回 Runner。不要在一般 Content 中自行複製 Event Effects 或直接改寫 Scene Stack。

## 狀態

### Stats

Stats 是有 `Init`、`Min`、`Max` 的數值。Conditions 可比較數值，Effects 可 `set`、`+`、`-`、`*`、`/`。

### Memory Banks

Memory Banks 保存標籤。Conditions 使用 `has`／`not_has`，Effects 使用 `add`／`remove`／`clear`。

預設 `Memory` 不可刪除，也用來記錄 Once Events。自訂 Bank 不會自動每日或每週重設；請由遊戲自己的換日流程明確執行 clear。

## 關聯圖

關聯圖依 GOTO／Next Node 產生唯讀有向圖。它不直接建立或修改 Event。

- 滾輪或觸控板雙指上下移動：以游標位置縮放。
- 拖曳空白處：平移。
- 搜尋：淡化不符合的節點。
- 圓形按鈕：重新置中。
- 點擊節點：切換 Editor 目前節點。

## 檢查專案

在執行遊戲或提交版本前，使用「檢查」確認：

- JSON 與 Schema 合法。
- Stat、Memory、Content、Screen 與 Next Node 引用存在。
- ROOT 與 Runtime 入口已設定。

檢查通過不代表遊戲設計必然正確；Conditions、權重與劇情結果仍需實際遊玩驗證。

## 自訂 Ren'Py 介面

`gui.rpy` 適合全域尺寸、字型與樣式變數；`screens.rpy` 或其他 `.rpy` 適合 Screen 結構。Editor 會掃描 Screen 名稱供節點引用，但不修改這些文件。

若需要 Editor 尚未資料化的系統，例如背包、日曆或地圖，請在創作者 `.rpy` 中實作，再透過 Content、Stats、Memories 或公開 Runtime API 連接。不要把它藏進 Options Renderer。

## 儲存、更新與復原

- Editor 預設自動儲存；切換節點或分頁前會完成待處理寫入。
- 快捷鍵與 Editor 設定存於專案根目錄 `.scene-node-editor/settings.json`。
- 重新執行 Installer 只更新受管理 Editor／Runtime。
- 刪除的節點移至 `.scene-node-trash/`，不會由 Ren'Py 載入。

技術格式與 Runtime API 請閱讀 [Reference](REFERENCE.md)。
