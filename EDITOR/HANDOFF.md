# Scene Node Editor 專案交接

最後整理日期：2026-08-03

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
-> 合併目前 Scene Node 與 Global Node 的候選 Events
-> 檢查 Conditions
-> 選擇最低 Priority 的候選層
-> 依 Weight 選出唯一 Event
-> 套用 Effects
-> 播放 Content（可為 None）
-> 依 REDO / GOTO / REPLACE / EXIT 決定節點流程
```

- Option、Keyboard 與 Mouse 都可作為玩家輸入來源，只產生 Trigger，不直接選 Event；`Auto:Node` 由 Runner 每輪主動檢查。
- `Auto:Enter` 在 ROOT 啟動或 GOTO／REPLACE 進入節點時執行；`Auto:Exit` 在 EXIT／REPLACE 移除目前節點前執行。
- State 系統全遊戲只有一份，包含依 Group 整理的平面 Stats 與可自訂的 Memory Banks；缺少 Group 的 Stat 正規化至 `Normal`，Group 不改變 Runtime ID 或存檔鍵。
- 每個 Scene Node 都有自己的 Event Pool；固定 `__global__` Global Node 另提供跨節點 Event Pool。
- Global Node 只是一個 Editor／資料作用域，不進入 stack，也不能成為 Root 或 Next Node；它擁有會疊加顯示於每個實際節點的 Options，可使用 Option Trigger，並可由同一 Global 作用域的 Event 執行 Option Effect。Global Event End up 作用於觸發當下的實際 stack 頂端。
- 實際 Scene Node 提供當前互動 Options，Global Node 則提供跨所有實際節點的常駐 Options；兩者同時交給 Renderer。
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
- Global Once 使用 `once:global:<event_id>`，避免與一般節點 Event 混用。
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

Event Effects 包含 Stat、Memory 與 Option Availability。Option Effect 只對既有 `CONTROLLED` Element／Item 執行冪等 `enable`／`disable`，不在 Runtime 建立或刪除 Schema 資料。Node 不保存 Background；BGM、SE、背景、轉場與淡入淡出由 Content label 使用 Ren'Py 原生語法完成。Options 的 Picture、Preview Background、Hover Sound 與 Click Sound 仍由資料化 Options Renderer 管理。

## 4. 創作者會編輯的內容

```text
DATA/
  SceneProject.json
  Stats.json
  Memories.json

GLOBALNODE/
  Node.json
  Options.json
  EVENTPOOL/
    <event_id>.json
  CONTENT/
    <label_name>.rpy

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

Options 沒有條件運算式、不可操作狀態或 CUSTOM Screen 來源。所有顯示的選項都可操作；條件、fallback 與節點分流統一由 Events 和 Scene Nodes 負責。`Options.json` Version 2 在 Element 與 TEXTBOX Item 增加 `Availability: ALWAYS | CONTROLLED`；Version 1／缺值讀作 ALWAYS 並在下次儲存正規化。PICTURE／HITBOX 只控制 Element；TEXTBOX 可控制整列及個別 Item。Item 顯示需要父 Element 與自身都可用，父層停用保留子狀態，空 TEXTBOX 自動隱藏。

Runtime 以獨立 `scene_enabled_options` 保存受控目標，不污染 Stats／Memories。狀態採 reassignment 以支援 Ren'Py save／rollback，不因 REDO、GOTO、REPLACE、EXIT 自動重設，`scene_reset_state()` 開新遊戲時清空。Option Effect 只能控制 Event 所屬 Options 作用域：實際 Scene Node Event 只能控制同一節點，Global Event 只能控制 `__global__`；所有跨作用域引用都由 Editor、API 與 Runtime 拒絕。Editor 的 Effect 階層選單只顯示目前作用域的 Element／Item Name，JSON 仍保存穩定 Node／Element／Item ID。API 專案檢查及 Element／Item 刪除保護都必須包含 Option Effect。

## 6. 編輯器目前狀態

目前已實作：

- 空白專案初始化 ROOT 節點、安全辨識各語系 Ren'Py 預設範本並接線 `script.rpy`、切換起始節點與 Root 刪除保護。
- 單一 Memory 架構：預設 `Memory`、自訂記憶庫、標籤 add/remove/clear、Runtime API 與舊 Tag 延遲遷移。
- Scene Node、Event、Stats、Memory Banks 與 Content 的建立與編輯。
- Global Node 擁有與 Scene Node 相同的 Options 工作區；Runtime 在任何實際節點互動時疊加目前節點與 Global Options。Global Event 可使用 Option Trigger，Option Effect 只能控制 `__global__` 作用域目標。
- Stats 工作區固定提供 `Normal` 預設群組；外層加號建立新群組及其第一個 Stat，群組內使用寬版加號加入該組 Stat。State 外框與 Event／Options 一樣使用完整工作區寬度，Stats 左框與 Memory 右框直接對齊分頁邊界，不在外層再套圓角遮罩；桌面版 Stat 欄位依群組容器分配寬度且不依賴橫向捲動。Event 的 Stat Condition／Effect 共用 Group → Stat 階層選單。Group 僅為 authoring metadata，Runtime 與存檔維持平面 Stat ID；Stats 與 Memory 卡片高度各自由自身內容決定。
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
- 自動儲存排程與競態控制已抽成可獨立測試的 `autosave_coordinator.js`；Node 測試覆蓋連續編輯、切換前 flush、刪除前 cancel-and-wait、網路重試與失敗阻擋。
- 前端已開始漸進式模組化：API Client、Editor Settings、Event Trigger／End up 契約、Event 規則與權重表單、Stats 群組模型、共用階層下拉選單及關聯圖純資料模型都有獨立模組與 Node 測試；`app.js` 保留組裝、渲染與跨模組協調。
- Condition／Effect 類型、操作與預設資料形狀集中於 `state_rule_contract.js`；跨層測試會直接比較前端 registry、Editor API registry 與 Runtime 分支，新增操作不得只修改表單。
- CSS 的設計 token 與瀏覽器基礎規則已分離至 `css/tokens.css`、`css/base.css`；其餘工作區樣式仍在 `styles.css` 漸進整理，不在搬移時改變視覺。
- 節點刪除引用檢查與 `.scene-node-trash/` 可復原區。
- 專案引用檢查。
- 依 `GOTO / REPLACE / Next Node` 產生唯讀有向關聯圖，採可互動的階層感知即時力導向布局。只顯示實際 Scene Nodes；GLOBAL 作用域與 Global Event 邊不進入圖面或力場。節點是只顯示 Node Name 的不透明白底圓點，不顯示技術 ID。連線路徑統一為圓心到圓心，手工計算的 SVG polygon 箭頭尖端停在接收端圓周；箭頭隨圖面縮放，Node Name 依 viewBox／viewport 比例反向補償並維持近似固定的螢幕字級。完整 Event／Trigger／End up 保留在 SVG tooltip。
- 設定的 ROOT 是預設力場中心；GOTO／管理關係提供父節點局部圓環，REPLACE 提供同層柔性關係，多父節點共同拉動共享目標。節點半徑與斥力以 cycle-safe 唯一後代遍歷繼承空間需求，深層後代逐層衰減並以 `log2` 壓縮；半徑增幅係數為 3.25、上限為 32 graph units，使 hub 可辨識但不過度放大。
- 逐幀兩兩斥力維持 O(n²) 且採距離平方反比。直接父子保留較低祖先係數並由彈簧維持距離；第二層以上改以較慢的平方根衰減且保留 0.24 下限，避免 ROOT 與孫節點幾乎失去斥力，同時不讓 ROOT 把局部群集全推往外側。從 ROOT 做 cycle-safe BFS 建立單一 `orbitChildren` 主樹；GOTO／管理關係只有主要父來源以 `orbitAngles` 施加有上限的弱切向校正，多父來源的其他邊只保留徑向 spring。
- 模擬座標不 clamp 於初始 `width × height`；空白平移不限邊界，縮放寬度安全範圍為 120–250000 graph units，重新置中保留 zoom。節點可用 Pointer Events 直接拖曳並在放開後重新平衡；`prefers-reduced-motion` 使用有限次數靜態收斂。雙向 REPLACE 合成一條雙箭頭虛線，雙向 GOTO 保留兩條高對比反向弧線；管理邊遞迴追蹤完整 REPLACE 鏈且不寫入 Parent Schema。節點 hover／鍵盤 focus、搜尋降噪、縮放、無邊平移與節點切換行為維持不變。
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
  前端 composition root：狀態、各工作區渲染、Content 專用選單、跨模組協調、表單接線及 Options 畫布互動。

EDITOR/static/js/core/api_client.js
  HTTP payload 序列化、NETWORK_ERROR／HTTP_ERROR 分類。

EDITOR/static/js/core/autosave_coordinator.js
  自動儲存 revision、序列化、flush、取消等待與斷線重試；同時支援瀏覽器與 Node 單元測試。

EDITOR/static/js/core/editor_settings.js
  設定版本、遷移、分頁順序、快捷鍵預設值與名稱。

EDITOR/static/js/core/event_contract.js
  Event Trigger 模式、生命週期、鍵盤顯示與 End up 的 Editor 端單一登錄點。

EDITOR/static/js/core/state_rule_contract.js
  Condition／Effect 類型、合法操作、預設資料形狀與 Memory clear 欄位需求。

EDITOR/static/js/ui/choice_picker.js
  所有原生 select 的共用階層選單、任意目錄深度、鍵盤操作與定位。

EDITOR/static/js/workspaces/event_editor.js
  Event Condition／Effect 列、Content／Next Node 權重表單、DOM 回讀與規則型別切換；依賴由 app.js 建立時明確注入。

EDITOR/static/js/workspaces/state_editor.js
  Stats 群組正規化、工作區分組與 Group → Stat 階層選單資料；不改變平面 Stat ID。

EDITOR/static/js/workspaces/graph_model.js
  關聯圖 GOTO／REPLACE／遞迴管理關係、雙向關係正規化、可逐幀驅動的力導向模擬、Cycle route 與 SVG edge path 的可測試資料邏輯。

EDITOR/static/styles.css
  尚待逐步拆分的既有元件、工作區版面、響應式規則與互動狀態。

EDITOR/static/css/tokens.css
EDITOR/static/css/base.css
  共用設計 token，以及全頁 reset、字體與 focus 基礎規則。

INTEGRATION/TestGame/FRAMEWORK/runtime.rpy
  State、Event 選擇、Effects 與 Scene Node stack Runtime。

INTEGRATION/TestGame/FRAMEWORK/option_renderer.rpy
  Options.json 的 Ren'Py Screen Renderer。

tools/install.py
  將 Editor 與 Framework 安裝或更新到 Ren'Py 專案。

tools/create_editor_test_unit.py
  只對全新空白專案建立可拋棄的 Editor／Runtime 綜合測試內容；安全閘門會拒絕既有 Editor 資料。

INTEGRATION/EDITOR_TEST_UNIT.md
  9 節點關聯圖、Content、Options Availability、Event、State、原生 Screen 演出與 Runtime 流程的手動驗證步驟，包含 parent → child A → REPLACE child B → EXIT parent 及鏈式 REPLACE 管理邊。

tests/test_install.py
  乾淨安裝、更新保護與 Editor 啟動測試。

tests/test_editor_test_unit.py
  綜合測試單元產生、完整 Editor 專案驗證與防覆寫測試。

tests/test_memory_schema.py
  Memory Bank schema、舊 Tag JSON 遷移與 clear Effect 測試。

tests/test_runtime_memory.py
  Runtime Memory API、舊存檔 Tag 合併與舊 Event 相容測試。

tests/test_option_availability.py
  Options Version 2 遷移、Option Effect schema／引用／刪除保護，以及 Runtime Element／Item 組合、冪等操作與錯誤訊息測試。

tests/js/autosave_coordinator.test.js
  自動儲存、切換與刪除競態的獨立 JavaScript 回歸測試。

tests/js/*.test.js
  API、設定遷移、Event 表單序列化、Event／State Rule 契約、Stats 群組模型、任意深度下拉選單、關聯圖資料模型與自動儲存測試。

tests/test_event_api_round_trip.py
  Editor API 保存與重新讀取 Event 的 golden JSON，涵蓋單一／權重選擇、生命週期欄位省略及 Global Event。

tests/browser/editor_smoke.spec.js
  以系統暫存綜合測試專案及 Chromium 驗證 Content 父子選單、Event 規則新增刪除與型別切換、Option Effect、Availability 自動儲存重新載入、GOTO／REPLACE、關聯圖與 Console；不讀寫本機創作者測試資料。

tests/test_contract_alignment.py
  以前端 Event registry 為輸入，確認 Editor API Schema 與 Runtime 同步接受 Trigger／End up。

tools/verify.py
  統一執行 Python／JavaScript 語法、JavaScript／Python 測試與 Git whitespace 檢查。

.github/workflows/ci.yml
  在 GitHub Pull Request 與 main push 上，以 Linux、macOS 執行統一驗證。
```

前端工作區的主要頁面渲染與 Options 互動仍集中在 `app.js`，既有工作區 CSS 也仍集中於 `styles.css`；但共用核心、Event 表單資料轉換、下拉選單及關聯圖模型已有可測試邊界。新功能先依 `AGENTS.md` 與 `docs/MAINTENANCE.md` 判斷擴充入口，不要把可獨立邏輯重新塞回 composition root。不同對話若同時修改 `app.js`／`styles.css` 仍容易衝突；平行工作應使用獨立 Git worktree，或明確切分不同模組。

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

提交前以單一指令執行完整本機驗證：

```sh
python3 tools/verify.py
```

這會自動發現並檢查所有 production JavaScript，執行全部 JavaScript／Python 單元測試，並檢查 Python 語法、工作區及 staged diff 的空白錯誤。GitHub Actions 會在 Linux 與 macOS 執行相同命令；Pull Request 另檢查相對於 base branch 的完整 diff。

需要手動驗證 Editor 與 Runtime 完整工作流時，另建一個可拋棄的空白 Ren'Py 專案，再依 `INTEGRATION/EDITOR_TEST_UNIT.md` 執行產生器。不可對 `INTEGRATION/TestGame` 或正式遊戲執行這個產生器。

主要 Editor smoke test 可重複執行：

```sh
npm ci
npx playwright install chromium
python3 tools/verify.py --browser
```

GitHub Actions 另有獨立 Chromium job。Smoke suite 不取代新 UI 的針對性手動驗證或 Ren'Py Runtime 實機測試。

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
- 繼續依工作區拆分 `app.js` 與 `styles.css`；每次只移動一個可測試邊界，保持行為、視覺與資料格式不變。
- 強化 Stat／Memory Effects 的驗證、錯誤訊息與定位能力；背景、音訊及轉場維持由原生 Content 管理。
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
