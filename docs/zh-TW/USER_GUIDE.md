# Scene Node Editor 使用指南

[繁體中文](USER_GUIDE.md) · [English](../en/USER_GUIDE.md) · [回到首頁](../../EDITOR/README.md)

這份指南說明 Editor 的工作範圍與七個功能區。若尚未完成可玩流程，先閱讀 [建立第一個專案](FIRST_PROJECT.md)。

## 工作模型

```text
輸入來源 → Trigger → Event → Content → Effects → End up
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

Scene Node 列表中的實際節點可整列拖移排序；在另一個節點上停留約半秒，目標卡片下方會展開群組預留空間，放開即可像 Event Pool 一樣建立單層群組。節點可直接跨群組框移入或移出，群組名稱旁的空白可拖移整組，只剩一個節點時會自動解散。群組預設收起並在 hover、鍵盤 focus、拖移進入，或其節點目前正被選取時展開；改選群組外的節點後，舊群組會沿展開的反向路徑縮合，而不是在重繪時瞬間消失，收合途中也不會被仍停留的 hover 撐開。在群組內排序後會保持展開，直到游標真正離開。抓取整組時，浮動預覽會從目前展開高度連續縮合為標題；放到新位置並保存後，只有目前選取節點位於該群組時才從標題高度重新展開，其他群組保持收合。Global Node 固定在頂端，不參與排序或群組。`Group` 與 `Order` 只影響 Editor 中的創作管理，不改變 ROOT、GOTO／REPLACE、關聯圖深度或 Runtime 執行。

Node 功能區與其他工作區使用相同的左右寬度與頂部間距。功能摘要中的 `Registered Tags` 卡片會列出此節點透過 Memory `add` Effect 註冊的 Tags，並依記憶庫的創作者名稱分組；技術 Bank ID 不在此摘要重複顯示。

Node 不保存 Screen。HUD、場景外殼與其他 Screen 由創作者在 `.rpy` 中定義，再由 Content 使用 Ren'Py 原生 `show screen`、`hide screen` 或 `call screen` 控制。

### Global Node

節點列表頂端固定有一個不可刪除的 Global Node。它是全局 Event、Options 與 Content 的編輯作用域，不是真實 Scene Node：

- 不進入 Scene Stack，不能成為 ROOT、GOTO 或 REPLACE 的目標。
- 擁有自己的 Options 工作區；Global Options 會與任何當前實際節點的 Options 同時顯示。
- Global Event 可使用 Global Options 的 Option Trigger，也可啟用／停用同一 `__global__` 作用域內的 Controlled Options。
- On Node、Keyboard、Mouse Event 會與目前實際節點的同 Trigger Events 合併，再一起比較 Conditions、Priority 與 Weight。
- On Enter／On Exit 會在每個實際節點的對應生命週期中與本地 Events 一起依序執行。
- Global Event 的 REDO、GOTO、REPLACE、EXIT 都作用於當時的實際 Stack 頂端節點。
- Global Once 以 `once:global:<event_id>` 記錄，不會與一般節點的 Once 混用。

Global On Node 會在下一次節點互動循環檢查。若本地 Event 先增加時間再 GOTO，換日 Event 會在目標節點的 On Enter 之後、On Node 之前執行；它不是原 Event Content 與 End up 之間的同步 hook。

## 事件

Event 是目前節點對 Trigger 的反應。主要欄位：

- `Group`：只供 Editor 整理 Event Pool；缺值時屬於固定的 `Normal`，不影響遊戲執行。
- `Trigger`：On Enter、On Node、On Exit、Option、Keyboard 或 Mouse。
- `Priority`：可設為 0–9，數字越小越優先；新 Event 預設為 5，只在最低 Priority 層中選擇。
- `Weight`：On Node／玩家輸入中，同 Trigger、同 Priority且 Conditions 都通過時的相對機率。
- `Once`：全遊戲只成功觸發一次。
- `Conditions`：Event 是否能成為候選。
- `Effects`：Content 返回後依序套用的 Stat、Memory 或 Option Availability 改變。
- `Content`：Effects 之前呼叫的 Ren'Py label，可使用權重。
- `End up`：Content 返回後執行 REDO、GOTO、REPLACE 或 EXIT。GOTO／REPLACE 都可使用單一或權重 Next Node；選單會以「群組 → 節點」呈現已群組節點，未群組節點維持第一層，保存值仍是穩定 Node ID。

UI 中的 `Option` 技術格式仍是 `Action:<id>`。Event 選擇器會列出目前作用域 Options 已註冊的 Triggers；在 Global Node 編輯的 Option Trigger 會在所有實際節點的互動畫面可用。

Event 的 Memory Tag 欄位仍可自由輸入新 Tag。聚焦或輸入前綴時，下拉建議會依目前選擇的 Memory Bank，列出整個專案由 Memory `add` Effects 已註冊的相符 Tags；可用滑鼠，或上下鍵、Home／End 與 Enter 選取，Esc 只關閉建議，Tab 繼續原本欄位順序。

Event Pool 使用單層群組整理大量 Events，但只保留一個展滿側欄的新增 Event 按鈕；新 Event 預設不顯示群組。拖移時目前插入位置會直接騰空，周圍 Event 與群組區塊隨游標向上或向下讓位；預覽會持續跟住游標，實際排序每畫面幀最多更新一次。游標在元素中線附近的小幅晃動不會讓插入位置反覆翻轉，靠近清單上下邊緣時會漸進自動捲動。排序流末端也保留自然留白，因此 Event 可放在最末群組之後。移出原群組邊界即回到未群組排序流，進入另一個群組邊界則可直接插入，不需要專用的移出位置。在另一個未群組 Event 的目前邊界上持續停留約半秒，目標下方會展開帶框的群組預留空間；若對方已被讓位動畫推離游標，停留意圖立即取消，不會在放開時誤成組。群組預設收起，只顯示較短的名稱欄與數量；游標移入、鍵盤焦點進入，或目前正在編輯群組內的 Event 時展開。改選其他群組或未群組 Event 後，舊群組會沿展開的反向路徑縮合，動畫完成且游標離開前不重新接受 hover 展開；在群組內完成排序後仍保持展開，直到游標離開。名稱旁沒有圖示的空白可拖移整個群組，起拖時浮動預覽會從展開內容連續縮合成標題；落位保存後只有包含目前選取 Event 的群組才以同一路徑展開，其餘維持收合。群組只剩一個 Event 時自動解散。群組名稱可直接點擊修改，順序保存於只供 Editor 使用的 `Order`；成功拖移不顯示額外通知，保存失敗時才顯示錯誤並回復原狀。

Event 編輯表單內的 Conditions、Effects、Content 權重項目與 Next Node 權重項目都以卡片呈現，可由卡片外框或欄位間留白直接拖移；輸入欄位與刪除按鈕維持原操作。Conditions 的群組框代表 AND，群組與獨立條件之間代表 OR。舊 Conditions 會先顯示在同一個 AND 群組，且只有這個群組時按新增會繼續加入其中；拖出任一條件建立 OR 分支後，後續新增條件會成為獨立 OR。將條件拖入群組會加入 AND，兩個獨立條件互相停留則建立新的 AND 群組。只允許這一層 OR-of-AND，單成員 AND 群組會保留。Effects 仍依保存後的陣列順序，在 Content 返回後依序執行；權重項目的排序只管理 Editor 顯示，不改變機率。

Picture 與 Preview Background 只列出 `game/images/`；Options 的 Hover Sound／Click Sound 只列出 `game/audio/`。資源可用子資料夾整理，Editor 會保留其階層供選擇，但選定欄位只顯示檔名。遊戲場景、BGM、SE 與轉場請在 Content 使用 Ren'Py 原生語法。

### 在條件與效果中使用運算

事件表單的數值欄位可直接選擇**固定值／Stat／簡單運算**。Stat、Memory 與 Option 規則保持在同一水平列，但類型、資源、運算子與數值會像 Content 項目一樣，各自呈現為有間距的圓角區塊。最前方的小標籤可切換整條規則的類型，`123`、`Stat` 或 `ƒx` 標籤則貼合在它所切換的數值區塊內。點擊標籤時，底色向右覆蓋它控制的完整範圍（包含區塊間距）並開啟共用選單；選定或取消後收回，再露出分開的欄位。選擇運算才會在同一行展開左右運算元與一個運算子，窄視窗可橫向捲動，不改成上下堆疊。運算元各自可填數字或依名稱選擇 Stat，選單沿用滑鼠、方向鍵、Tab 與 Esc 操作；系統開啟減少動態效果時不播放延展動畫。例如條件可設定 `金錢 >= 單價 × 數量`，效果則可從金錢扣除 `單價 × 數量`。比較的兩側都可使用運算，但 Effect 的目標仍固定是 Stat。

每個欄位最多一個 `+`、`-`、`×`、`÷`、`%`，AND/OR 及 Effect 自己的操作不計入。切回較簡單的來源時，左運算元若符合類型便保留，否則從 0 或第一個 Stat 開始。動態除數為零會報錯，可先在同一 AND 群組的前方加入非零條件。Effects 仍在 Content 後由上到下執行，每次都讀取更新後的值。更複雜的公式仍交給原生 Ren'Py Content，並使用 `scene_change_stat()` 寫入。

舊事件的意義不變。使用新數值格式時，Editor 會自動將該 Event 升為 Version 2；使用前請一併更新專案的 Editor 與 FRAMEWORK，不需手動編輯 JSON。

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

Options 是固定資料化的玩家互動介面。所有顯示的選項都可操作；條件判斷與分流仍由 Scene Nodes 或 Events 表達。

支援三種 Element：

- `TEXTBOX`：垂直 Item 清單，可限制可見列數並捲動。
- `PICTURE`：圖片按鈕，可指定 Idle／Hover 圖片與 alpha hit test。
- `HITBOX`：場景上的透明互動區域。

表單模式負責 Name、Text、Trigger、圖片與聲音。畫布模式負責位置、尺寸、圖層、Hover、顏色與視覺細節。

表單模式的 Element 側欄與 TEXTBOX Items 都可直接拖移排序，不提供額外把手，也不建立群組。TEXTBOX Item 的整個卡片都是拖移面，只有叉叉刪除鍵維持獨立操作；未超過拖移門檻的普通點擊會直接切換目前 Item，即使剛在另一個 Item 的欄位中輸入亦同。明確的 Z Order 是畫布與遊戲中的主要圖層控制：數值較大的 Element 位於上層，重疊時也優先收到點擊。Element 陣列順序會保存，並作為相同 Z Order 時的穩定先後順序；陣列中較後方者位於較上層。TEXTBOX Item 順序同時決定遊戲中的顯示與逐項進場順序。

畫布模式以約 4:3 的寬度同時顯示左側預覽與右側 Inspector。Inspector 頂端固定顯示目前 Element、類型、外觀摘要與「佈局／樣式／效果／Item」分類；下方一次只呈現目前任務相關的控制，不再使用多層摺疊或跳到獨立頁面。點擊畫布上的 Text Box Item 會直接切到該 Item 分頁，修改顏色、文字或效果時仍可立即查看畫布回饋。設定檔可在 `game/DATA/TEXTBOX_PROFILES/` 建立與編輯獨立 JSON 檔，包含基礎色彩、文字樣式，以及懸停強調條、懸停文字色、Item 邊框、文字陰影、文字描邊、逐項進場六種可選特性。同一個設定檔可套用到任意 Scene Node 或 Global Options 的多個 Text Box；更新設定檔後，所有未個別覆寫的引用會一起更新。

套用後仍可在目前 Text Box 勾選或關閉設定檔公開的特性，並調整顏色、字級等欄位作為個別覆寫；Item 的獨立樣式再疊於最上層。「清除個別覆寫」會重新跟隨設定檔，而取消設定檔時會把目前解析後的樣式寫回 Text Box，避免外觀突然改變。仍被使用的設定檔不可刪除；缺失或手動寫壞的檔案不會阻止 Options 載入，Runtime 會回退 Text Box 原本的 `Style`，專案檢查則指出問題。

若 Text Box 已有個別覆寫，外觀區會明確顯示覆寫數量；按「改用設定檔外觀」即可清除它們並重新跟隨共用設定檔。每次重新開始 Scene Runtime 時也會重讀專案資料與設定檔，因此從主選單再次開始遊戲即可看到 Editor 儲存後的最新結果。

每個 Element 都有 `Availability`：

- `Always`：常駐顯示。
- `Controlled`：新遊戲初始隱藏，必須由 Event 的 Option Effect `enable` 才會顯示；`disable` 會再次隱藏。

TEXTBOX 的整個 Element 與各 Item 可各自設定 Availability，因此可以用 Element 控制一整列，也可以只在既有清單中加入或移除一個 Item。Item 必須同時通過父 Element 與自身 Availability；暫時隱藏父 Element 不會清除已啟用的 Item。PICTURE 與 HITBOX 只提供 Element 層級。

在 Event 的 Effects 新增 `option`，再由階層選單選擇目前作用域的「Element → 整列或 Item」與 `enable`／`disable`。Scene Node Event 只能控制同一節點，Global Event 只能控制 Global Options；兩者都不能跨作用域。Editor 保存穩定 Node／Element／Item ID，並保護仍被引用的 Element 與 Item。這些啟用狀態會進入 Ren'Py 存檔，不會因節點切換自行重設，但開始新遊戲時會清空。

Runtime 每輪會先放入目前 Scene Node 的 Options，再疊加 Global Options。若兩個作用域使用相同 Trigger，兩邊同 Trigger 的 Events 仍會依 Conditions、Priority 與 Weight 一起競爭；因此全域操作建議使用清楚且不易碰撞的 Trigger ID。

畫布 Preview Background 只改變該 Options 文件的 Editor 預覽；留空代表沒有預覽底圖，不影響遊戲畫面。

Options 使用單一 Interaction 生命週期：玩家輸入 Trigger 後 Screen 結束；若 Event 使用 REDO，Runner 會重新呼叫它。

## 演出 Content

Content 是 Editor 管理位置與引用的原生 `.rpy` 文件。創作者仍在 label 中撰寫對話、角色、背景、音訊、轉場、ATL 或自訂 Python。

「演出」工作區內建離線 Ren'Py 程式碼編輯器，使用 Ren'Py 官方 VS Code 擴充套件的語法規則與片段，並提供語法上色、行號、括號配對、摺疊、搜尋、四格縮排、目前節點的 label 提示及專案圖片／音訊提示。這是撰寫輔助，不取代 Ren'Py 的 lint 或實際執行檢查；若進階編輯器無法載入，會自動保留基本文字編輯模式。

同一 authoring scope 的 Content 文件可在左側清單整列拖移排序；它只改變 Editor 的文件排列，不改寫 `.rpy` label 或 Runtime 呼叫順序。Textbox 外觀設定檔管理清單也使用相同排序手勢。

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

Stats 是有 `Init`、`Min`、`Max` 的數值，並以只供管理使用的 `Group` 整理；未指定群組會歸入預設的 `Normal`。Stats 只保留一個新增 Stat 按鈕，新 Stat 預設不顯示群組。Name／Min／Init／Max 欄名只在整個 Stats 區最上方顯示一次，所有未群組列與群組內列共用相同欄寬；群組框會在列的左右保留一致內距。Stat 整列的外框與欄位間留白都是拖移面，輸入框與刪除按鈕則保持原本操作；不再顯示或保留額外把手，拖移期間也不會選取掃過的文字。群組名稱旁沒有圖示的空白可拖移整個 Stat 群組。拖移時插入位置會即時騰空並推開周圍 Stat 或群組，並共用 Event 的逐幀重排、插入遲滯與邊緣自動捲動，因此長清單不需中途放開。排序流末端永遠保留自然留白，所以即使畫面中只有群組，也能把 Stat 直接拖到群組之外。進入另一群組即可插入；在另一個 Stat 上停留到群組框展開後放開，才會建立群組。群組只剩一個 Stat 時自動解散。群組名稱可直接編輯，順序保存於只供 Editor 使用的 `Order`；成功拖移不顯示額外通知。Event 的 Stat Conditions／Effects 使用「Group → Stat」兩層選單，選定後仍只顯示 Stat 名稱。`Group` 與 `Order` 不改變 Stat ID、Runtime 存取或存檔鍵。Conditions 可比較數值，Effects 可 `set`、`+`、`-`、`*`、`/`。

原生 `.rpy` 可用 `scene_get_stat()` 讀取，必要時以 `scene_change_stat(stat_id, operation, value)` 進行受 Min／Max 限制的修改；也可用 `scene_current_node_id()`／`scene_current_node_name()` 取得目前位置。這些修改 API 只作 Editor 尚未資料化的專屬系統橋接。一般遊戲規則仍優先使用 Event Effect，而且 Content 中的修改會先發生，該 Event 的 Effects 會在 Content 返回後繼續從上到下套用。Screen 顯示 expression 只讀取，不要在可能重複求值的顯示內容中修改 State。

### Memory Banks

Memory Banks 保存標籤。Conditions 使用 `has`／`not_has`，Effects 使用 `add`／`remove`／`clear`。

原生程式除既有的 `scene_memory_has/add/remove/clear()` 外，也可用 `scene_memory_tags(bank_id)` 取得保留插入順序的唯讀 tuple 快照。能由 Event Effect 表達的 add／remove／clear 仍優先使用 Effect。

Memory Bank 列可從欄位間留白拖移排序。拖移時整列會抑制意外的文字選取，放手後立即恢復欄位原生選取。Editor 會以 `Memories.json` 的物件鍵插入順序保存與還原顯示位置；這不改變 Bank ID、Runtime API 或存檔內容，也不會建立群組。

預設 `Memory` 不可刪除，也用來記錄 Once Events。自訂 Bank 不會自動每日或每週重設；請由遊戲自己的換日流程明確執行 clear。

## 關聯圖

關聯圖依 GOTO／REPLACE 的 Next Node 產生唯讀有向圖，使用可重現的 Stack 深度布局。每個實際 Scene Node 以不透明、帶邊框的白底圓點呈現，圖面只顯示 Node Name；技術 ID 與不屬於遊戲空間的 GLOBAL 作用域都不佔用圖面。ROOT 位於最左側起點欄；每次 GOTO 都把主要流程放進右側下一個 Stack 深度欄，讓作者能直接讀出節點相對於遊戲入口的位置。

正式 Stack 深度只由主要 GOTO 骨架決定；若幾個同深度節點之間仍有 GOTO，算法會把它們建立成局部關係群，優先選擇群內輸出最多的節點作為前側 anchor，再依 BFS 關係距離配置最多 140 圖面單位的前後微欄。例如 Options 同時直達「分支」與「結果」、而「分支」也會 GOTO「結果」時，分支會在前、結果在後，兩者使用短局部曲線，不再繞成大型外圈。GOTO Cycle 的兩個方向仍分開顯示，但會沿節點間的兩側局部彎曲。

REPLACE 不增加 Stack 深度，因此算法會先把彼此以 REPLACE 相連的節點折疊成一個布局家族。家族成員依最短 REPLACE 鏈距離的奇偶性分到深度基準的後側與前側，總橫向跨度最多 160 圖面單位。`Parent GOTO A`、`A REPLACE B`、`B REPLACE C` 因而形成後—前—後的 A → B → C：A → B 向前，B → C 向後，避免所有虛線與管理線朝同一方向堆疊。奇數循環無法完全二分時會依穩定順序共用其中一側並以曲線分開。若 B 另有 GOTO 子節點，該子節點仍進入正式的下一個 Stack 深度。這只影響顯示，不建立靜態 Parent Schema。

從 ROOT 可到達的 GOTO 結構會依固定名稱與 ID 排序建立主要樹，每個分支取得穩定的垂直泳道，父節點對齊其子樹範圍。多個 GOTO 父來源共同指向同一目標時，第一條由 ROOT 展開的關係決定主要位置，其餘仍以跨分支線完整顯示。同深度 GOTO Cycle 使用局部雙弧線，只有跨正式深度回到較淺層的關係才使用外側弧線；兩者都不會讓欄位深度反覆推高。無法從 ROOT 到達的節點會放進下方標示清楚的「未連結至 ROOT」區域，而不會混入主流程。

節點半徑仍會以 cycle-safe 的唯一後代遍歷計算空間需求：直接子節點影響最大，更深後代逐層衰減後再以對數壓縮，讓分支中心可辨識但不過度放大。這項資訊只改變圓點大小，不參與位置計算；相同資料與 ROOT 永遠得到相同座標，不會因等待或拖曳而重排整張圖。

每次開啟關聯圖時，圖面會由 ROOT 開始，依正式深度與局部關係順序讓連線延展、節點分批彈出。進場完成後，節點會在各自結構錨點附近緩慢呼吸；真實 GOTO／REPLACE 鄰居會以微弱彈簧傳遞視覺動量，錨點相近的節點則有小幅對稱斥力，因此相連枝條會彼此牽動而不會完全同步。這層局部物理不採用管理線或 Global 關係，每個節點的總偏移硬性限制在 7 graph units 內，也不會累積位移、改變深度或泳道。連線會同步跟隨可見節點，但互動命中區仍固定在結構錨點；開始拖曳、平移、縮放或鍵盤操作會立即結束進場。系統偏好「減少動態效果」時，進場與閒置微動都會停用。

大型專案的布局與線段交叉診斷會在背景執行，已完成的 topology 會於資料未改變時重用。切離關聯圖或把瀏覽器放到背景時，節點微動會完全暫停；返回後才恢復。這些最佳化只降低切換停頓與資源使用，不改變布局結果或保存任何節點位置。

圖面可持續往任意方向平移，縮放範圍足以巡覽大型專案。背景不繪製深度色帶、欄名或操作圖例；深度只由節點的整體左右位置表達。初始畫面與「顯示全圖」按鈕會配合目前圖面範圍顯示整體結構；Node Name 會反向補償縮放，維持近似固定的螢幕字級，但縮小到不足以清楚分辨節點時會隨縮放淡出，讓總覽只保留節點與連線，重新放大後則恢復。需要查看局部時可在游標位置放大，再沿流程方向巡覽。

GOTO 使用實線，REPLACE 使用同色虛線；所有連線路徑仍由節點圓心連到圓心，箭頭尖端則精確停在接收端圓周，雙向關係的兩端亦相同。箭頭屬於圖面幾何，會隨圖面縮放；Node Name 在可讀範圍內會反向補償縮放，維持近似固定的螢幕字級，進入遠距總覽時則淡出。連線不放置行內文字，Event 名稱、Trigger、End up 與方向細節仍保留在 tooltip。`A REPLACE B` 與 `B REPLACE A` 會合併成一條兩端都有箭頭的線，但 tooltip 仍分別列出兩個方向的 Events，JSON 也保持原樣。雙向 GOTO 不合併，而以高對比的兩條反向弧線呈現 GOTO Cycle，提醒可能持續推高 Stack 的結構。管理關係會追蹤完整 REPLACE 鏈：若 `Parent GOTO A`、`A REPLACE B`、`B REPLACE C`，圖上會以較透明實線顯示 `Parent → B` 與 `Parent → C`，並與直接 GOTO 共用 Parent 圓心。Global Event 與 GLOBAL 節點不顯示在關聯圖中；這只影響視覺化，不改變它們在 Editor、資料或 Runtime 的行為。關聯圖不建立 Schema Parent，不修改 Event 或 Runtime 契約。

- 滾輪或觸控板雙指上下移動：以游標位置縮放。
- 拖曳空白處：平移。
- 拖曳節點：被抓住的節點維持 1:1 跟隨游標；它的位移會透過真實 GOTO／REPLACE 弱拉力牽動相連節點，靠近任意節點時也會產生斥力。其他節點仍受 7 graph units 上限與自身錨點約束；放開後所有節點柔和回復閒置狀態，位置不寫入專案資料。
- 搜尋：淡化不符合的節點及無關連線。
- 將焦點移到節點：暫時淡化無關節點與連線，只保留直接相鄰關係。
- 圓形按鈕：顯示目前完整圖面範圍。
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
- 按 `Cmd + Z`（macOS）或 `Ctrl + Z`（Windows／Linux）可返回上一筆成功的 Editor 專案修改，不提供額外工具列按鈕。歷史最多保留 100 步且只存在於目前這次 Editor 執行期間，重新啟動後會清空。文字輸入框與演出程式碼編輯器保留各自的原生文字復原；游標離開文字欄位後，快捷鍵才會復原新增、刪除、拖移、群組或其他已寫入的結構化修改。復原前若有等待中的修改，Editor 會先把該快照納入交易再立即恢復前值；若寫入或恢復失敗，畫面不會假裝已復原。
- 按 `Cmd + Backspace`（macOS）或 `Ctrl + Backspace`（Windows／Linux）可刪除目前功能項目，並可在設定中改鍵。Event 內會優先刪除聚焦的條件、效果或權重列；Options 會優先刪除聚焦的 Item，其他工作區則沿用目前項目的既有刪除與確認流程。文字輸入框與演出程式碼編輯器仍保留原生文字刪除，不會誤刪資料。
- Event 的 Conditions、Effects、Content、End up 固定展開，不再保留收合控制。新增 Event 後可直接輸入 Name；接著按 Tab 會依序前往 Trigger 模式、Trigger 值、Priority、Weight、Once，再以同一層級巡覽四個區塊。Once 聚焦時按 Enter 可切換值；區塊聚焦時按 Enter 進入現有欄位，按 `Cmd／Ctrl + Enter` 會新增對應子項並進入新項目。子項內的 Tab／Shift + Tab 只依欄位順序移動，通過最後欄位後才前往下一區塊；Esc 回到所屬區塊。生命週期 Event 會略過不存在的 Weight 與 End up。自動儲存更新畫面時會保留目前焦點。
- 所有下拉選單（包含 Event Content label）都由同一個共用元件呈現，使用一致高度的選項列，選單本身會依目前層的項目數量長高；超過可視上限後才在該層捲動。點開任一下拉選單後即可用 `↑`／`↓` 巡覽目前層，Home／End 前往首末項。焦點抵達父層項目時會展開子選單，但要再按 `→` 才會把焦點移入；`←` 返回父層，Enter 選取，Esc 先關閉選單。
- 頂部工作區 Bar 可直接橫向拖移改變分頁順序；上一個／下一個功能區快捷鍵會依畫面順序巡覽，但 Cmd／Ctrl + 1…7 仍固定前往原本功能。
- 快捷鍵、工作區順序與 Editor 設定存於專案根目錄 `.scene-node-editor/settings.json`；支援繁體中文（`zh-Hant`）與英文（`en`）介面語言切換。切換語言時若有未儲存的變更或儲存失敗，系統會予以擋下、保持原語言並提示錯誤，確保創作者內容不會遺失。
- 重新執行 Installer 只更新受管理 Editor／Runtime。
- 刪除的節點移至 `.scene-node-trash/`，不會由 Ren'Py 載入。

技術格式與 Runtime API 請閱讀 [Reference](REFERENCE.md)。
