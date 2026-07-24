# Scene Node Editor 專案交接

最後整理日期：2026-07-22

這份文件提供給新開啟的 Codex 對話。開始修改前，先閱讀本文件及「規格來源」列出的文件，不要重新設計已經定案的遊戲架構。

## 1. 專案目標

這是一套供 Ren'Py 8 使用的 Scene Node 遊戲架構與本機瀏覽器內容編輯器，主要面向 SLG / stat-based VN 類型。

目標是讓內容創作者透過表單與少量原生 `.rpy` 文件完成內容，不需要直接處理事件挑選、狀態管理、節點堆疊與資料驗證等底層邏輯。

編輯器直接讀寫 Ren'Py 專案中的 JSON 與 `.rpy`，不使用資料庫，也不需要第三方 Python 套件。

## 2. 規格來源

文件的優先順序如下：

1. `docs/zh-TW/REFERENCE.md`：目前遊戲架構、資料格式與 Runtime API 的主要規格。
2. `docs/zh-TW/USER_GUIDE.md`：各工作區的使用方式與責任邊界。
3. `README.md`：安裝、更新與從空白 Ren'Py 專案開始使用的流程。
4. `EDITOR/app.py`：目前編輯器真正接受的資料格式與驗證規則。
5. `INTEGRATION/TestGame/FRAMEWORK/`：目前 Ren'Py Runtime 與選項 Renderer 的實際行為。

以下文件是早期思考紀錄，適合了解設計動機，但其中舊格式不一定仍有效：

- `遊戲架構發想過程.md`
- `Event 格式構想.md`
- `其餘配置文件格式構想.md`

若早期文件與 Reference 或目前程式衝突，以後者為準。若規格與程式互相衝突，修改前先指出差異，不要默默選擇其中一方。

## 3. 已定案的遊戲架構

### 3.1 核心流程

```text
Action / Keyboard / Mouse / Auto:Node Trigger + Global State
-> 收集目前 Scene Node 的候選 Events
-> 檢查 Conditions
-> 選擇最低 Priority 的候選層
-> 依 Weight 選出唯一 Event
-> 套用 Effects
-> 播放 Content（可為 None）
-> 依 REDO / GOTO / REPLACE / EXIT 決定節點流程
```

- Option、Keyboard 與 Mouse 都可作為玩家輸入來源，只產生 Trigger，不直接選 Event；`Auto:Node` 由 Runner 每輪主動檢查。
- `Auto:Enter` 在 ROOT 啟動或 GOTO／REPLACE 進入節點時執行；`Auto:Exit` 在 EXIT／REPLACE 移除目前節點前執行。
- State 系統全遊戲只有一份，包含 Stats 與可自訂的 Memory Banks。
- 每個 Scene Node 都有自己的 Event Pool。
- 凡是包含選項的互動單位都是 Scene Node。
- Content 由創作者自行撰寫 Ren'Py label，也可以是 `null`。
- State 的改變原則上寫在 Event Effects，而不是藏在 Content label。
- 每個可互動 Trigger 建議保留一個無條件 Event 作為 fallback。

### 3.2 節點流程

```text
REDO  重新執行目前節點的互動流程，包含 Auto:Node 檢查
GOTO  將子節點推入 stack
REPLACE 需要實際父層，原子替換 stack 頂端
EXIT  離開目前節點並回到父節點
```

內容設計上可以視為樹狀，但 Runtime 實際使用 stack。

GOTO 子節點不視為父節點 `Auto:Exit`；子節點 EXIT 回到父節點也不重新執行父節點 `Auto:Enter`。

REPLACE 是 `[父, 目前] → [父, 目標]` 的單一 Stack 操作。它先跑主 Event Effects／Content並確認 prepare 階段選出的目標存在，再執行目前節點 `Auto:Exit`、替換頂端、執行目標 `Auto:Enter`，最後進入目標 `Auto:Node`／Options。父節點在過程中不得執行任何生命週期、`Auto:Node` 或 Options；目標 EXIT 後回到原本父節點。父層限制依實際 Stack 深度判斷，不依 Root Node ID、資料夾或靜態 Parent 欄位。

### 3.3 Event 決策

- `Auto:Node` 與每次玩家輸入 Trigger 只會對應到一個 Event。
- Priority 數字越小越優先，目前範圍為 0 到 5，0 和 1 保留給系統或特殊事件。
- 同 Trigger、Conditions 通過且 Priority 相同時，才使用 Weight 抽選。
- Event 的 Content 與 GOTO／REPLACE Next Node 都可另外使用權重物件。
- `Once: true` 等同由系統在預設 `memory` 記憶庫註冊 `once:<event_id>` 標籤。
- `Auto:Enter`／`Auto:Exit` 先以同一份狀態快照篩選 Conditions 與 Once，再依 Priority、Event ID 執行所有符合 Events。
- `Auto:Enter`／`Auto:Exit` 不含 Weight、End up 或 Next Node；保留 Conditions、Priority、Once、Effects 與 Content。

### 3.4 Memories

`DATA/Memories.json` 定義記憶庫。新專案固定包含：

```json
{
  "memory": { "Name": "Memory" }
}
```

創作者可在編輯器「狀態」工作區新增其他記憶庫。每個庫支援檢查、新增、移除指定標籤與清空全部。記憶庫不帶硬編碼的每日／每週生命週期；換日等流程應明確呼叫 `scene_memory_clear(bank_id)`。舊 `type: "tag"` 資料在讀取時映射至預設庫，下次儲存時轉成新格式。

### 3.5 演出責任

Event Effects 僅包含 Stat 與 Memory。Node 不保存 Background；BGM、SE、背景、轉場與淡入淡出由 Content label 使用 Ren'Py 原生語法完成。Options 的 Picture、Preview Background、Hover Sound 與 Click Sound 仍由資料化 Options Renderer 管理。

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
    EVENTPOOL/
      <event_id>.json
    CONTENT/
      <label_name>.rpy

```

- Options、Events、Stats、Memory Banks 主要透過表單與 JSON 管理。
- Content 使用 Editor 管理的原生 `.rpy`；Ren'Py Screen 則由創作者在 `game/` 內自行撰寫。
- Options 固定使用資料化 Renderer；創作者的 `.rpy` Screen／HUD 由 Content 使用原生 Ren'Py 控制，不取代 Options。
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
- 可選擇內容溢出時是否顯示滑桿。
- Mousewheel 與拖曳捲動固定可用，每次互動重新開始時重設位置。
- Item 高度、間距、Padding 與樣式。

三種 Element 共用 `Hover.Enabled`、可調透明度的 `Hover.Color`、`Hover Sound` 與 `Click Sound`。Picture 可額外指定 Hover 圖片。Options 不保存 Tooltip、Icon、Cursor 或個別捲動模式。

Options 工作區分成兩種共用同一份草稿的模式。表單採左小右大布局，左側管理 Element，右側以獨立卡片分開內容與音效；畫布採左大右小布局，左側預覽、點選與拖曳，右側負責版面、共同 Hover 視覺及外觀。切換由單一連續進度同時驅動兩側欄框寬度與新舊內容透明度；兩個欄框本身是 `overflow: hidden` 遮罩，過場底層也有不透明遮罩覆蓋兩框中央，內容保持各自座標且不會溢出欄框。拖曳進度逐幀取最新游標位置並依完整行程計算；點擊沿用同一控制器，但使用加速後減速的 ease-in-out 補間。完成時先在遮罩後方停用 transition 並顯示正式工作區，再移除遮罩，下一幀才恢復一般 transition，避免結尾閃爍。Options 側欄寬度與 Event 側欄一致。

Options 沒有個別顯示／可用條件，也沒有 CUSTOM Screen 來源。所有顯示的選項都可操作；條件、fallback 與節點分流統一由 Events 和 Scene Nodes 負責。

## 6. 編輯器目前狀態

目前已實作：

- 空白專案初始化 ROOT 節點、安全辨識各語系 Ren'Py 預設範本並接線 `script.rpy`、切換起始節點與 Root 刪除保護。
- 單一 Memory 架構：預設 `Memory`、自訂記憶庫、標籤 add/remove/clear、Runtime API 與舊 Tag 延遲遷移。
- Scene Node、Event、Stats、Memory Banks 與 Content 的建立與編輯。
- Options Picture 與 Preview Background 只掃描 `game/images/`，並以子目錄階層選單呈現；選定欄位只顯示葉節點檔名。Preview Background 留空時不顯示預覽圖，也不影響遊戲場景。
- Node Schema 不保存 Background 或 Screen；兩者與音訊、轉場一樣由 Content 使用 Ren'Py 原生語法管理。
- Editor 不提供 Screen 文件工作區或 CRUD API；Installer 也不管理創作者的 `gui.rpy`、`screens.rpy` 與其他介面文件。
- 中文顯示名稱與穩定技術 ID 映射。
- Event Conditions、Effects、Content、Next Node 與權重表單。
- Event Trigger 的 Options 來源在 UI 顯示為 `Option`，JSON／Runtime 契約仍是 `Action:<id>`；Auto 顯示為 On Enter／On Node／On Exit，保存為 `Auto:Enter`／`Auto:Node`／`Auto:Exit`。
- Event Content 使用創作者命名的文件第一層與 label 第二層的階層選單；只有一個 label 的文件在 UI 直接映射為創作者名稱，實際保存值仍是技術 label。
- 所有固定選項 `<select>` 由前端提升為共用自訂選單；長清單可在選單內捲動。圖片與音訊依路徑資料建立任意深度的父子選單，父子框之間固定保留間隔與透明滑鼠通道，並支援方向鍵、Enter、Esc；欄位只顯示檔名。原始欄位仍保留在表單內，確保既有表單讀取與 API payload 不變。
- Options 的 Hover Sound 與 Click Sound 只掃描 `game/audio/`。Event 不提供 BGM／SE Effect 或 Persistent；音訊演出由 Content 使用 Ren'Py 原生語法。
- TEXTBOX、PICTURE、HITBOX 選項表單。
- Options 拖曳把手式表單／畫布切換，以及畫布拖曳、縮放、格線與吸附。
- 自動儲存採遞增 revision；過期請求不得覆蓋較新的草稿、狀態或儲存提示。切換節點、分頁或文件前先完成目前 revision，刪除則先取消並等待舊寫入，避免刪除後的競態與假失敗。
- 節點刪除引用檢查與 `.scene-node-trash/` 可復原區。
- 專案引用檢查。
- 依 `GOTO / REPLACE / Next Node` 產生唯讀有向關聯圖；GOTO 為實線、REPLACE 為同色虛線。若 `Parent → A` 是 GOTO 且 `A → B` 是 REPLACE，前端另推導半透明實線 `Parent → B` 管理邊，但不寫入 Parent Schema。圖可搜尋、以滾輪／觸控板雙指縮放、平移並切換節點。
- 編輯器快捷鍵與自訂設定。
- 編輯器設定透過 `/api/editor-settings` 寫入專案根目錄 `.scene-node-editor/settings.json`，不可退回只依賴隨機連接埠來源的 `localStorage`。
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
- 上方中央是同一水平的精簡功能 Bar：節點、事件、選項、演出、狀態、關聯圖、檢查。
- 點擊節點名稱會由左側滑入節點抽屜。
- 節點抽屜包含新增、搜尋、節點切換、遊戲名稱與設定入口。
- Event 使用左側 Event Pool 加主要編輯區。
- Options 表單模式使用左側 Element 列表與右側邏輯表單；畫布模式使用左側大畫布與右側視覺 Inspector。
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
G            顯示或隱藏格線
S            開啟或關閉吸附
Cmd + .      展開或收合目前區塊；Options 中切換表單／畫布
```

快捷鍵可在設定中修改。新增資料的對話框按 Enter 應確認，不應取消。

## 8. 程式地圖

```text
EDITOR/app.py
  Python 標準函式庫 HTTP Server、檔案讀寫、資料驗證與 API。

EDITOR/static/index.html
  應用程式外殼、節點抽屜、七個功能區、對話框與設定結構。

EDITOR/static/app.js
  前端狀態、各工作區渲染、Content 階層選單、有向關聯圖、表單、自動儲存、快捷鍵及 Options 畫布互動。

EDITOR/static/styles.css
  全部版面、色彩、響應式規則與互動狀態。

INTEGRATION/TestGame/FRAMEWORK/runtime.rpy
  State、Event 選擇、Effects 與 Scene Node stack Runtime。

INTEGRATION/TestGame/FRAMEWORK/option_renderer.rpy
  Options.json 的 Ren'Py Screen Renderer。

tools/install.py
  將 Editor 與 Framework 安裝或更新到 Ren'Py 專案。

tools/create_editor_test_unit.py
  只對全新空白專案建立可拋棄的 Editor／Runtime 綜合測試內容；安全閘門會拒絕既有 Editor 資料。

INTEGRATION/EDITOR_TEST_UNIT.md
  8 節點關聯圖、Content、Options、Event、State、原生 Screen 演出與 Runtime 流程的手動驗證步驟，包含 parent → child A → REPLACE child B → EXIT parent。

tests/test_install.py
  乾淨安裝、更新保護與 Editor 啟動測試。

tests/test_editor_test_unit.py
  綜合測試單元產生、完整 Editor 專案驗證與防覆寫測試。

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

需要手動驗證 Editor 與 Runtime 完整工作流時，另建一個可拋棄的空白 Ren'Py 專案，再依 `INTEGRATION/EDITOR_TEST_UNIT.md` 執行產生器。不可對 `INTEGRATION/TestGame` 或正式遊戲執行這個產生器。

UI 變更必須用瀏覽器實際操作，不只檢查靜態畫面。至少確認：

- 節點與功能區切換。
- 修改後自動儲存。
- Event 新增、Conditions / Effects 對齊與折疊。
- Options 畫布拖曳、縮放、格線與吸附。
- 指定快捷鍵。
- 桌面與窄畫面無重疊、截斷或失去操作入口。

不要為了測試而隨意覆寫 `INTEGRATION/TestGame` 的創作資料。

## 10. Git 與資料安全

開始任何工作前都要重新執行 `git status --short`。`INTEGRATION/TestGame/FRAMEWORK/` 是安裝器使用的 Runtime 來源；同層的 `DATA/`、`SCENENODE/`、`script.rpy` 與 `runtime_test.rpy` 是本機創作／測試資料，已由 `.gitignore` 排除，不屬於公開發布包。

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
  表單／畫布模式、Elements、Inspector、拖曳、縮放、格線與吸附。

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
