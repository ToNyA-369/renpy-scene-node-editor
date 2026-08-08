# Scene Node Editor 綜合測試單元

這是一個只能建立在全新空白 Ren'Py 專案中的可拋棄測試場景。它不只測試外部 Screen，也涵蓋 Editor 與 Runtime 的主要契約：

- 9 個 Scene Nodes 與多分支關聯圖
- 1 個不可刪除、提供全域常駐 Options 的 Global Node
- Content 文件／label 階層選擇與權重 Content
- Content 原生顯示的 Screen／HUD 與資料化 Options Renderer
- TEXTBOX、PICTURE、HITBOX 三種 Option Element
- Option Element／TEXTBOX Item 的 Always／Controlled Availability 與 Event enable／disable
- Stat、Memory，以及完全由 Events 負責的條件與 fallback
- 同 Trigger 的 Condition、Priority 與 fallback Event
- Keyboard 與 Mouse Event Trigger
- Once Event
- On Enter／On Node／On Exit 與生命週期批次順序
- 固定 images／audio 資源目錄、階層式長選單與葉節點名稱
- 由 Content 使用原生 Ren'Py 背景、音樂、淡入與淡出
- Options Preview Background、Picture、Hover Sound 與 Click Sound
- REDO、GOTO、REPLACE、EXIT 與多層 Node stack
- Global Options、Global On Node、Global Keyboard 與 Context End up
- 權重 Next Node
- 自訂快捷鍵持久化與 Content 刪除後儲存流程

產生器若發現 `.scene-node-editor/`、`DATA/`、`GLOBALNODE/`、`SCENENODE/` 或其他測試資料，就會停止，不會覆寫正式專案。

## 建立方式

1. 在 Ren'Py Launcher 建立一個全新的專案，例如 `SceneEditorTest`，不要先安裝 Editor 或加入自己的資料。
2. 在本 Repository 根目錄開啟 Terminal。
3. 執行：

```sh
python3 tools/create_editor_test_unit.py "/完整路徑/SceneEditorTest" --launch-editor
```

`--launch-editor` 可省略。它只會在 macOS 自動開啟產生的 `啟動 Scene Node 編輯器.command`。

若之前已建立舊測試專案，請整個刪除後由 Ren'Py Launcher 重建空白專案。產生器刻意不提供覆寫模式。

## Editor 測試清單

1. 按「檢查專案」，預期為 `0 個錯誤、0 個提醒`。
2. 「狀態」應固定顯示 `Normal`，並將初始值 20 的「測試點數」放在「測試資源」群組、初始值 0 的「操作次數」放在「流程追蹤」群組，同時顯示 `Memory`、`測試階段記憶` 兩個 Memory Banks。State 外框應與 Event／Options 使用相同的完整工作區寬度；桌面版 Stat 欄位應完整顯示而不需橫向捲動。Stats 外層加號應新增群組及第一個 Stat，群組內應使用較寬的長方形加號加入同組 Stat；修改 Group 後應在重載後保留。新增 Stat 只可增高 Stats 卡片，不得同步拉高 Memory 卡片。
3. 節點抽屜頂端應固定顯示「全局系統」Global Node，下面有 `root`、`options_lab`、`branch_lab`、`outcome_success`、`outcome_fallback`、`replace_parent`、`replace_child_a`、`replace_child_b`、`replace_child_c` 共 9 個實際節點。Global Node 不可刪除、不可設為 ROOT；選取後「選項」功能區可編輯「全域常駐操作」，Event Trigger 可選該作用域的 Option，Effect 也只能列出 `__global__` 的 Controlled 目標。
4. 在 `root` 的 Event 編輯 Content。下拉選單第一層應顯示「00 節點生命週期演出」「01 獎勵與權重內容」與「02 條件與流程內容」等創作者名稱，而不是生成文件 ID；停留或展開後才看到各自的 label。父選單與 label 子選單之間應有清楚間隔；游標橫越間隔時子選單不可消失。選定 label 後，欄位只顯示 label 的顯示名稱。
5. Node 表單應只有 Name 與 ID，不應出現 Background 或 Screen；下方顯示 Events、Options、Content Labels、Flow Links 數量，以及 Incoming／Outgoing 與三個生命週期階段摘要。相同目標與流程類型的多個 Events 應合併為一個連接標籤並顯示倍數。開啟 `root_enter_background`、`root_on_node_once`、`root_exit_cleanup` 三個 Events，Auto 時機應分別顯示 On Enter、On Node、On Exit。On Enter／On Exit 只顯示 Priority 與 Once，不應出現 Weight、End up、Next Node 或額外提示文字；Conditions、Effects 與 Content 仍存在。
6. 巡覽節點、Event、Options 與狀態中的下拉選單；它們應使用一致且固定寬度的自訂選單。圖片或音訊至少展開四層目錄，所有層級都必須可見且保持同一展開方向，不可因欄位寬度反覆左右跳動。聚焦選單後，`↑`／`↓` 應巡覽同層項目、`→` 應進入子選單、`←` 應回到父層、Enter 應選取、Esc 應關閉。
7. 開啟「關聯圖」。圖面應由 ROOT 開始依深度長出連線並分批彈出節點，完成後節點只在固定結構錨點附近做極小且線段同步的呼吸微動；互動命中區不得跟著漂移，開始操作要立即完成進場。圖面應只顯示 9 個實際 Scene Nodes，不顯示 GLOBAL 節點或 Global Event 邊。節點應是不透明、帶邊框的白底圓點，圖面只顯示 Node Name，不顯示技術 ID 或任何連線行內文字；左上角不顯示操作圖例，背景也不顯示深度色帶、虛線或欄名。所有直接及管理連線路徑都必須從來源圓心射向目標圓心，但箭頭尖端停在接收端圓周。ROOT 應位於最左側起點，主要 GOTO 向右增加 Stack 深度，分支使用穩定的垂直泳道。`branch_lab`、`outcome_success`、`outcome_fallback` 雖由 Options 直接進入相同正式深度，但因分支另有 GOTO 結果，`branch_lab` 應排在前側、兩個結果排在後側，群內總跨度為 140 graph units；分支與結果間應使用短局部曲線，`branch_lab ↔ outcome_success` 兩條 Cycle 線分居節點連線兩側，不可繞成畫面頂端的大圈。`replace_child_a`、`replace_child_b`、`replace_child_c` 保持相同語意深度，但應依 REPLACE rank parity 排成後—前—後，讓 A → B 向前、B → C 向後，總跨度不超過 160 graph units。相同資料重新開啟後結構錨點必須一致，不應等待力場收斂；無法從 ROOT 到達的節點應進入下方明確的未連結區。按「顯示全圖」後所有節點應落在 viewport 內。`replace_parent` 因具有直接及鏈式間接後代，其圓點應略大於葉節點 `replace_child_c`，但差距不可過度。拖曳任一節點時它應緊貼游標，其他節點保持不動；放開後只讓該節點回到原本的結構位置，且不會因此切換節點。`replace_child_a` 與 `replace_child_b` 的雙向 REPLACE 應合成一條兩端都有箭頭的虛線；tooltip 必須分別列出 Action 與 Keyboard 兩個方向。另應從 `replace_parent` 到 `replace_child_b`、`replace_child_c` 顯示兩條較透明的管理邊，表示 A → B → C 的完整 REPLACE 鏈，並與 `replace_parent → replace_child_a` GOTO 共用 Parent 圓心。將滑鼠或鍵盤焦點移到節點時，非相鄰關係應暫時淡化。
   局部物理還必須確認：真實 GOTO／REPLACE 鄰居會以弱拉力互相牽動，錨點相近的節點有輕微斥力，但任何未拖曳節點的總偏移不得超過 7 graph units；MANAGEMENT 與 Global 關係不得加入物理配對。上段「其他節點保持不動」的舊預期不再適用：拖曳節點仍須 1:1 緊貼游標，但其位移應牽動相連節點，靠近原本不相鄰的節點時也應即時斥開，放開後再回復錨點附近的閒置狀態。
8. 游標放在圖面空白處，用 MacBook 觸控板兩指上下滑動：圖應以游標位置連續縮放；反方向滑動應反向縮放。縮小圖面時，箭頭應連同圖面一起縮小，Node Name 則維持近似固定的螢幕字級，不可反過來讓箭頭壓過名稱。拖曳空白處應可持續往任意方向平移，不可碰到固定畫布邊界，也不可反白圖面。平移後按右下角圓形按鈕，應重新顯示完整圖面範圍；搜尋仍位於左下角。
9. 在設定中修改一組快捷鍵，關閉 Editor 的 Terminal 視窗，重新雙擊啟動器；設定應仍保留。
10. 要驗證 Content 刪除流程，請在任一節點新增一個「未被 Event 引用」的臨時 Content，輸入後不必等待自動儲存便直接刪除。預期舊寫入會被安全取消，不會跳出「儲存失敗」，刪除後也能立即切換工作區並繼續編輯。不要刪除產生器建立且已被 Event 引用的 labels。
11. 把任一 Name、數字或選單欄位快速連續修改兩次，第二次完成後等待自動儲存，再切換工作區並返回。畫面與磁碟都必須保留最後一次輸入，不可被較早的儲存回應回滾。
12. 在 `options_lab` 的 Options 工作區，確認側欄寬度與 Event 一致；中間把手只顯示三條豎線。慢速拖曳把手時，分隔線應逐像素跟隨游標，左右欄框與淡入淡出比例應連續同步；新舊內容都只能顯示在各自欄框內，兩框中央也不可透出底層工作區。單擊把手應呈現明顯的加速後減速，而非等速平移；切換結束的最後一幀不應閃白、重新淡入或跳動。`Command+.`／`Ctrl+.` 應切換表單與畫布。切至畫布後，Preview Background 應顯示測試圖片，也可從 `images/editor_test/gallery` 的階層選單改選或設為 None；選單超過可視高度時應可捲動。
13. 在畫布直接點選 TEXTBOX、綠色 PICTURE 與 HITBOX，右側 Inspector 應跟著切換，不應再出現元件下拉選單。
14. 三種 Element 的表單都應以無標題的獨立卡片顯示 Hover／Click Sound，音訊選單只來自 `audio/` 並依 `editor_test/sfx/ui` 等子目錄分層；選定後只顯示檔名。TEXTBOX 的 Items 清單與下方 Item 欄位分隔線之間應留有清楚間距。Picture 的 Name 與 Trigger 應左右齊平；Picture 的 Idle 圖片仍在表單選擇。Options 表單使用 `Name`、`Text` 與 `Items` 英文標籤。
15. 三種 Element 的 Hover 效果與 Hover 顏色應位於畫布的「外觀」；Picture 啟用 Hover 後可在同處選擇 Hover 圖片。關閉 Hover 效果後相關顏色與圖片欄位應收起。畫布的「版面細節」「外觀」標題旁不應有摘要文字。
16. 在 `replace_child_a` 開啟「REPLACE 前往 Child B」Event。End up 應顯示 `REPLACE`，Next Node 應顯示 `REPLACE Child B` 而非技術 ID。End up 下拉選單應同時提供 REDO、GOTO、REPLACE、EXIT；改為 REPLACE 時 Next Node 編輯區必須保留單一節點與權重表兩種模式。
17. 在 `options_lab` 的 `DATA Options 綜合測試` TEXTBOX，Element 應為 `Always`，「受控子選項：取得 2 點」Item 應為 `Controlled`；另一個 `受控選項列` TEXTBOX Element 應為 `Controlled`。開啟該節點 Event 的 Effects，把類型切到 `option`，目標選單應只依目前節點的 Element → 整列／Item 顯示創作者名稱，操作可選 `enable`／`disable`；其他節點的目標不得出現。再開啟含 Stat Condition／Effect 的 Event，選單應依「測試資源／流程追蹤 → Stat」分層。已被 Effect 引用的 Element／Item 不得刪除。

## Ren'Py Runtime 測試清單

由 Ren'Py Launcher 啟動遊戲，右上角應顯示外部 HUD、目前節點、點數、操作次數與 Memory 狀態。

遊戲一開始應依序看到兩段 On Enter 回饋：Priority 1 的 Content 先用 `scene ... with dissolve` 顯示測試背景，Priority 2 的 Content 再用 `play music ... fadein 1.0` 播放音樂。接著只出現一次 On Node 說明，之後才顯示 Options。這證明 On Enter 會執行全部符合 Events，而 On Node 仍一次選出一個 Event。

### Global Node

1. 在 `root`、`options_lab` 或其他任意實際節點，都應在左上角看到 Global Node 的「顯示全域獎勵」選項，並同時看到該節點自己的 Options。
2. 按「顯示全域獎勵」後，同一個全域清單應新增「領取全域 5 點獎勵」；按下後點數增加 5、該受控 Item 再次隱藏，而且仍停留在觸發當下的實際節點。
3. 在任意實際節點按 `G`，應觸發 Global Keyboard Event、增加 7 點，且仍停留在原本節點。
4. 每累積三次一般操作，下一輪 On Node 應顯示「Global Node」檢查訊息、將操作次數減 3，並在 `test_session` 註冊 `global_checkpoint`。
5. Global Event 執行後使用 REDO，應回到觸發當下的實際節點，不得把 `__global__` 放入 Stack。

### DATA Options 入口與 Event 選擇

1. 按「取得 10 點」數次；每次點數增加 10，台詞會由同一 Event 的兩個 Content labels 以 1:1 權重抽選。
2. 新一輪遊戲的初始點數為 20。連按兩次「花費 15 點」：第一次扣至 5，第二次由 fallback Event 接手且不扣點。
3. 按兩次「領取一次性 25 點獎勵」：第一次增加 25，第二次不再增加，並由檢查 `once:one_time_bonus` Memory 的 fallback Event 顯示說明。
4. 選項顯示期間按 K，應觸發 Keyboard Event 並增加 2 點；按滑鼠右鍵，應觸發 Mouse Event、增加 4 點，而不是開啟遊戲選單。
5. 游標移入或點擊 root Text Box，應聽到 Options Renderer 的 Hover／Click Sound；這些聲音屬於 Option，不是 Event Effect。

### Event 條件與三種 Option Element

1. 進入 `options_lab`。中央清單超過 4 個項目，應可用滾輪或拖曳捲動。
2. 按「取得 1 點」；台詞結束後同一組選項重新出現，這就是所有 Option 共用的 INTERACTION 行為。
3. 未取得鑰匙前先按「使用測試鑰匙」，應由 fallback Event 說明無法使用；再按「取得測試鑰匙」，接著使用成功並由條件 Event 移除 Memory。兩個選項全程都會顯示且可操作。
4. 點左下綠色 PICTURE，點數應增加 3。把游標移到右下透明 HITBOX，區域應發亮；點擊後 HUD 的 `Hitbox` 應變成 `True`。
5. 按「返回測試入口」，應透過 EXIT 回到 `root`。

### Option Availability

1. 新遊戲進入 `options_lab` 時，不應看見「受控子選項：取得 2 點」或右側「受控選項列」。
2. 按「顯示受控子選項」後，該 Item 應加入既有 `DATA Options 綜合測試` 清單；按它會增加 2 點。按「隱藏受控子選項」後它應再次消失。重複 enable／disable 不應報錯。
3. 按「顯示受控選項列」後，右側應出現獨立 TEXTBOX；按其中項目會增加 5 點。按主清單的「隱藏受控選項列」後整列消失。
4. Option Effect 只能控制所屬 Event 同一個 Options 作用域；Scene Node Event 不能控制其他節點或 Global Options，Global Event 也只能控制 `__global__` 目標。跨作用域目標不會出現在選單，手動寫入也應被驗證拒絕。
5. 啟用狀態在 REDO、GOTO、REPLACE、EXIT 與 Ren'Py 存檔／讀檔後保留；開始全新遊戲時重設為隱藏。父 TEXTBOX 暫時停用後再啟用時，其先前已啟用的 Item 狀態仍應保留；沒有可見 Item 的 TEXTBOX 不應留下空框。

### 分支、權重 Next Node 與 Node stack

1. 從 `options_lab` 前往 `branch_lab`。點數至少 30 時按「依條件前往結果」，應到成功節點；不足 30 時應到 fallback 節點。
2. 在結果節點按「EXIT 回到上一個節點」，應回到發起 GOTO 的節點，而不是固定回 root。
3. 按「權重隨機結果」可反覆測試兩個 1:1 結果節點。隨機測試不保證短時間內兩邊都出現。
4. 從 `branch_lab` EXIT 應回到 `options_lab`，再 EXIT 才回 `root`。
5. 在 root 按「結束這次 Runtime 測試」，應先看到 On Exit 說明，音樂以原生 `stop music fadeout 1.0` 淡出且背景轉黑，接著 Scene Runtime 正常結束。

### REPLACE 原子 Stack 流程

1. 在 root 按「前往 REPLACE Stack 實驗室」，進入 `replace_parent`；應依序看到 Parent 的 On Enter 與只執行一次的 On Node 說明。
2. 在 Parent 按「GOTO Child A」，確認進入 `replace_child_a`。
3. 在 Child A 按「REPLACE 前往 Child B」。應先看到主 Event Content，再看到 Child A 的 On Exit，然後直接看到 Child B 的 On Enter。
4. REPLACE 過程中不得執行 Parent 的 Screen／HUD Content、Parent On Enter、Parent On Node 或 Parent Options，也不得短暫恢復到 Parent。
5. 在 Child B 按「EXIT 回 Parent」。最後應回到 `replace_parent` 的 Options；不得回到已被替換的 Child A，也不得再次執行 Parent On Enter。

## 測試自己的 `gui.rpy`／`screens.rpy`

外部 Screen 位於：

```text
<測試專案>/game/scene_editor_test_ui.rpy
```

你可以修改其排版、字體、樣式，或把 Screen 搬進 `screens.rpy`。若更改 `scene_editor_test_hud` 名稱，請同步修改 root 的 On Enter／On Exit Content。

`gui.rpy` 適合調整全域 GUI 變數與樣式，`screens.rpy` 或其他 `.rpy` 負責 Screen／HUD 結構。Scene Node Editor 不會覆寫或引用它們；測試 Content 以 `show screen`／`hide screen` 管理顯示。玩家選項固定由 `Options.json` Renderer 提供。
