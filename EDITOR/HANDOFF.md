# Scene Node Editor 專案交接

最後整理日期：2026-07-16

這份文件提供給新開啟的 Codex 對話。開始修改前，先閱讀本文件及「規格來源」列出的文件，不要重新設計已經定案的遊戲架構。

## 1. 專案目標

這是一套供 Ren'Py 8 使用的 Scene Node 遊戲架構與本機瀏覽器內容編輯器，主要面向 SLG / stat-based VN 類型。

目標是讓內容創作者透過表單與少量原生 `.rpy` 文件完成內容，不需要直接處理事件挑選、狀態管理、節點堆疊與資料驗證等底層邏輯。

編輯器直接讀寫 Ren'Py 專案中的 JSON 與 `.rpy`，不使用資料庫，也不需要第三方 Python 套件。

## 2. 規格來源

文件的優先順序如下：

1. `階段性架構規格.md`：目前遊戲架構與資料格式的主要規格。
2. `README.md`：安裝、更新與從空白 Ren'Py 專案開始使用的流程。
3. `EDITOR/README.md`：編輯器功能、啟動方式與操作說明。
4. `EDITOR/app.py`：目前編輯器真正接受的資料格式與驗證規則。
5. `INTEGRATION/TestGame/FRAMEWORK/`：目前 Ren'Py Runtime 與選項 Renderer 的實際行為。

以下文件是早期思考紀錄，適合了解設計動機，但其中舊格式不一定仍有效：

- `遊戲架構發想過程.md`
- `Event 格式構想.md`
- `其餘配置文件格式構想.md`

若早期文件與《階段性架構規格》或目前程式衝突，以後者為準。若規格與程式互相衝突，修改前先指出差異，不要默默選擇其中一方。

## 3. 已定案的遊戲架構

### 3.1 核心流程

```text
Option / Auto Trigger + Global State
-> 收集目前 Scene Node 的候選 Events
-> 檢查 Conditions
-> 選擇最低 Priority 的候選層
-> 依 Weight 選出唯一 Event
-> 播放 Content（可為 None）
-> 套用 Effects
-> 依 REDO / GOTO / EXIT 決定節點流程
```

- Option 是玩家唯一的輸入來源，只回傳 Trigger，不直接選 Event。
- State 系統全遊戲只有一份，包含 Stats 與可自訂的 Memory Banks。
- 每個 Scene Node 都有自己的 Event Pool。
- 凡是包含選項的互動單位都是 Scene Node。
- Content 由創作者自行撰寫 Ren'Py label，也可以是 `null`。
- State 的改變原則上寫在 Event Effects，而不是藏在 Content label。
- 每個玩家可選 Trigger 建議保留一個無條件 Event 作為 fallback。

### 3.2 節點流程

```text
REDO  重新執行目前節點的完整流程，包含 Auto 檢查
GOTO  將子節點推入 stack
EXIT  離開目前節點並回到父節點
```

內容設計上可以視為樹狀，但 Runtime 實際使用 stack。

### 3.3 Event 決策

- 一次 Action 只會對應到一個 Event。
- Priority 數字越小越優先，目前範圍為 0 到 5，0 和 1 保留給系統或特殊事件。
- 同 Trigger、Conditions 通過且 Priority 相同時，才使用 Weight 抽選。
- Event 的 Content 與 Next Node 都可另外使用權重物件。
- `Once: true` 等同由系統在預設 `memory` 記憶庫註冊 `once:<event_id>` 標籤。

### 3.4 Memories

`DATA/Memories.json` 定義記憶庫。新專案固定包含：

```json
{
  "memory": { "Name": "Memory" }
}
```

創作者可在編輯器「狀態」工作區新增其他記憶庫。每個庫支援檢查、新增、移除指定標籤與清空全部。記憶庫不帶硬編碼的每日／每週生命週期；換日等流程應明確呼叫 `scene_memory_clear(bank_id)`。舊 `type: "tag"` 資料在讀取時映射至預設庫，下次儲存時轉成新格式。

### 3.5 Scene Effects

BGM、SE 等效果預留在 Effects 的 `type` 中，並以 `persistent` 決定是否延續到子節點。這部分屬於可擴充能力，修改前要先確認 Runtime 現有支援程度。

## 4. 創作者會編輯的內容

```text
DATA/
  SceneProject.json
  Stats.json
  Memories.json

SCENENODE/
  <node_path>/
    Node.json
    Options.json
    SCENEOPTION.rpy
    EVENTPOOL/
      <event_id>.json
    CONTENT/
      <label_name>.rpy

SCENESCREEN/
  <screen_id>.rpy
```

- Options、Events、Stats、Memory Banks 主要透過表單與 JSON 管理。
- Content 與 Scene Screen 使用原生 `.rpy`。
- `SCENEOPTION.rpy` 位於各 Scene Node 之下，作為無法由資料化選項表達時的進階模式。
- 創作者可使用中文顯示名稱；編輯器會產生穩定 ASCII 技術 ID。
- 顯示名稱可修改，技術 ID 不應跟著改名，以保護引用與存檔。
- Trigger、記憶標籤、玩家文字可直接使用中文。

## 5. Options 的定案方向

Options 有三種資料化 Element：

```text
TEXTBOX  垂直選項清單
PICTURE  圖片按鈕
HITBOX   場景互動區域
```

TEXTBOX 支援：

- 多個 Items。
- 最多可見列數。
- 超出列數後捲動。
- 可選擇是否顯示 Scrollbar：`AUTO`、`HIDDEN`、`ALWAYS`。
- Mousewheel 與拖曳捲動。
- Item 高度、間距、Padding 與樣式。

Options 工作區具備 1920 × 1080 預覽畫布、拖曳、縮放、格線與吸附。常用設定直接顯示，低頻樣式、條件、音效與 Scrollbar 細節收進進階選項。

資料化模式無法表達的特殊 UI 使用 `CUSTOM` 模式與 `SCENEOPTION.rpy`，但仍必須只回傳 Trigger。

## 6. 編輯器目前狀態

目前已實作：

- 空白專案初始化 ROOT 節點、安全辨識各語系 Ren'Py 預設範本並接線 `script.rpy`、切換起始節點與 Root 刪除保護。
- 單一 Memory 架構：預設 `Memory`、自訂記憶庫、標籤 add/remove/clear、Runtime API 與舊 Tag 延遲遷移。
- Scene Node、Event、Stats、Memory Banks、Content、Scene Screen 的建立與編輯。
- 中文顯示名稱與穩定技術 ID 映射。
- Event Conditions、Effects、Content、Next Node 與權重表單。
- TEXTBOX、PICTURE、HITBOX 選項表單。
- Options 畫布拖曳、縮放、格線、吸附與側欄切換。
- 自動儲存；切換節點、分頁或文件前先完成待處理寫入。
- 節點刪除引用檢查與 `.scene-node-trash/` 可復原區。
- 專案引用檢查。
- 編輯器快捷鍵與自訂設定。
- 安裝到空白 Ren'Py 專案及原地更新。

最近完成的版面修正：

- Event 基本資料區塊跨滿主編輯區。
- Conditions 與 Effects 使用相同的四欄寬度。
- Conditions / Effects 的新增按鈕為靠近標題的純加號。
- 節點名稱與 ID 首列已補足上方留白。

## 7. UI 與互動規範

這次重設計只改善編輯器的舒適度、操作效率與畫面布局，不改變遊戲架構。

### 7.1 視覺方向

- Bento Grid 的區塊組織方式。
- 紙質、低飽和、簡潔，參考 Obsidian 與 Safari 精簡標籤頁的資訊密度。
- 不使用華麗行銷頁、巨大標題、裝飾性漸層或無功能卡片。
- 常用欄位直接顯示，低頻設定放入可折疊的進階區塊。
- 左右功能欄可依工作區需要展開或收合。
- 不改變既有資料格式或遊戲流程來配合版面。

指定色彩：

```text
白色  #F4F4F4
灰白  #E5E5E2
綠色  #5C7265
深灰  #464646
紅色  #AA7878
```

其餘可見色彩應由這五色調整透明度取得。紅色主要用於刪除或危險操作。

### 7.2 整體布局

- 上方左側顯示目前節點名稱與儲存狀態。
- 上方中央是同一水平的精簡功能 Bar：節點、事件、選項、演出、畫面、狀態、檢查。
- 點擊節點名稱會由左側滑入節點抽屜。
- 節點抽屜包含新增、搜尋、節點切換、遊戲名稱與設定入口。
- Event 使用左側 Event Pool 加主要編輯區。
- Options 使用左側 Elements、中央畫布、右側 Inspector。
- 其他工作區依需要使用主區域加一個或兩個可選側欄。

### 7.3 指定快捷鍵

```text
Cmd + Shift + Left / Right  切換上一個／下一個功能區
Cmd + [                  展開或收合左側欄
Cmd + ]                  展開或收合右側欄
Cmd + \                  開啟或關閉節點抽屜
Cmd + ,                  開啟設定
```

目前也保留：

```text
Cmd + S      立即儲存
Cmd + 1…7    直接前往各功能區
Option + 1   切換 Options Elements
Option + 2   切換 Options Inspector
G            顯示或隱藏格線
S            開啟或關閉吸附
Cmd + .      展開或收合目前區塊
```

快捷鍵可在設定中修改。新增資料的對話框按 Enter 應確認，不應取消。

## 8. 程式地圖

```text
EDITOR/app.py
  Python 標準函式庫 HTTP Server、檔案讀寫、資料驗證與 API。

EDITOR/static/index.html
  應用程式外殼、節點抽屜、頂部功能 Bar、對話框與設定結構。

EDITOR/static/app.js
  前端狀態、各工作區渲染、表單、自動儲存、快捷鍵及 Options 畫布互動。

EDITOR/static/styles.css
  全部版面、色彩、響應式規則與互動狀態。

INTEGRATION/TestGame/FRAMEWORK/runtime.rpy
  State、Event 選擇、Effects 與 Scene Node stack Runtime。

INTEGRATION/TestGame/FRAMEWORK/option_renderer.rpy
  Options.json 的 Ren'Py Screen Renderer。

tools/install.py
  將 Editor 與 Framework 安裝或更新到 Ren'Py 專案。

tests/test_install.py
  乾淨安裝、更新保護與 Editor 啟動測試。

tests/test_memory_schema.py
  Memory Bank schema、舊 Tag JSON 遷移與 clear Effect 測試。

tests/test_runtime_memory.py
  Runtime Memory API、舊存檔 Tag 合併與舊 Event 相容測試。
```

前端目前仍集中在單一 `app.js` 與 `styles.css`。不同對話若同時修改這兩個文件很容易衝突；平行工作應使用獨立 Git worktree，或明確切分不同檔案。

## 9. 啟動與驗證

啟動開發編輯器：

```sh
python3 EDITOR/app.py
```

預設網址：

```text
http://127.0.0.1:8765/
```

編輯指定 Ren'Py `game/`：

```sh
python3 EDITOR/app.py --project "/path/to/project/game"
```

修改 JavaScript 後至少執行：

```sh
node --check EDITOR/static/app.js
```

提交前檢查：

```sh
git diff --check
python3 -m unittest discover -s tests -v
```

UI 變更必須用瀏覽器實際操作，不只檢查靜態畫面。至少確認：

- 節點與功能區切換。
- 修改後自動儲存。
- Event 新增、Conditions / Effects 對齊與折疊。
- Options 畫布拖曳、縮放、格線與吸附。
- 指定快捷鍵。
- 桌面與窄畫面無重疊、截斷或失去操作入口。

不要為了測試而隨意覆寫 `INTEGRATION/TestGame` 的創作資料。

## 10. Git 與資料安全

開始任何工作前都要重新執行 `git status --short`。`INTEGRATION/TestGame/FRAMEWORK/` 是安裝器使用的 Runtime 來源；同層的 `DATA/`、`SCENENODE/`、`SCENESCREEN/`、`script.rpy` 與 `runtime_test.rpy` 是本機創作／測試資料，已由 `.gitignore` 排除，不屬於公開發布包。

本機測試遊戲資料不是待清理的暫存檔。除非任務明確要求，禁止還原、刪除或覆寫。

協作規則：

- 不還原自己沒有建立的變更。
- 不使用 `git reset --hard` 或類似破壞性操作。
- 修改前先閱讀相關程式與現有規格。
- 編輯器 UX 任務不得順便重設遊戲架構。
- 資料格式改動必須同步考慮 Editor、Runtime、Installer、示範資料與測試。
- 平行對話使用不同 worktree；同一工作目錄一次只由一個實作對話寫入。

## 11. 尚可繼續進行的方向

這不是固定優先序，開始前應由使用者指定當次範圍：

- 繼續迭代各功能區的密度、對齊與側欄操作。
- 改善 Options 畫布的拖曳、縮放與選取手感。
- 拆分過大的 `app.js` 與 `styles.css`，但需保持行為與資料格式不變。
- 補足 Scene Effects 的 Runtime 能力。
- 視實際遊戲需求補充時間推進 UI，並由該流程呼叫指定 Memory Bank 的 clear API。
- 擴充專案驗證與錯誤定位。
- 增加更多 Runtime 與 Editor 回歸測試。
- 研究圖形化節點關係或更完整的內容管理 GUI；這不是目前架構必要條件。

## 12. 建議的新對話分工

可以依下列範圍建立新對話：

```text
Editor Shell / UI
  頂部功能 Bar、節點抽屜、共用元件、色彩與響應式布局。

Node / Event Editor
  節點表單、Event Pool、Conditions、Effects、Content 與 Next Node。

Options Editor
  Elements、Inspector、畫布、拖曳、縮放、格線與吸附。

Runtime / Schema
  State、Event 決策、stack、Effects、Memory Banks 與資料格式。

Installer / QA
  安裝更新、資料保護、驗證、測試與使用文件。
```

前三項都可能修改 `app.js` 或 `styles.css`，不可在同一工作目錄平行寫入。需要同時進行時，為每個對話建立獨立 worktree，完成後再逐一合併。

## 13. 新對話開場模板

```text
請先閱讀 EDITOR/HANDOFF.md，以及其中列出的主要規格文件。

這個對話的工作範圍是：[填寫功能範圍]。
請保留既有遊戲架構、資料格式與其他尚未提交的修改。
開始修改前先檢查目前程式與 Git 狀態；完成後進行對應的語法、測試與瀏覽器互動驗證。

若目前程式與交接文件不一致，先說明差異，再依最新程式與使用者要求處理。
```
