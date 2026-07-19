# Scene Node Editor 綜合測試單元

這是一個只能建立在全新空白 Ren'Py 專案中的可拋棄測試場景。它不只測試外部 Screen，也涵蓋 Editor 與 Runtime 的主要契約：

- 5 個 Scene Nodes 與多分支關聯圖
- Content 文件／label 階層選擇與權重 Content
- 外部 Scene Screen／HUD 與資料化 Options Renderer
- TEXTBOX、PICTURE、HITBOX 三種 Option Element
- Stat、Memory，以及完全由 Events 負責的條件與 fallback
- 同 Trigger 的 Condition、Priority 與 fallback Event
- Keyboard 與 Mouse Event Trigger
- Once Event
- REDO、GOTO、EXIT 與多層 Node stack
- 權重 Next Node
- 自訂快捷鍵持久化與 Content 刪除後儲存流程

產生器若發現 `.scene-node-editor/`、`DATA/`、`SCENENODE/` 或其他測試資料，就會停止，不會覆寫正式專案。

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
2. 「狀態」應有初始值 20 的「測試點數」、初始值 0 的「操作次數」，以及 `Memory`、`測試階段記憶` 兩個 Memory Banks。
3. 節點抽屜應有 `root`、`options_lab`、`branch_lab`、`outcome_success`、`outcome_fallback` 共 5 個節點。
4. 在 `root` 的 Event 編輯 Content。下拉選單第一層應分成 `01_rewards.rpy` 與 `02_flow.rpy`，停留或展開後才看到各自的 label，父子選單之間應有間隔。
5. 在節點工作區把 Background 選成 `images/scene_editor_test_picture.png`；清單第一個選項應為 `None`，Scene Screen 下方不應有說明小字。進入 Options 畫布後，Preview Background 預設應繼承節點圖片，也可單獨改選其他圖片或 `None`。
6. 巡覽節點、Event、Options 與狀態中的下拉選單；它們應使用一致的自訂選單外觀。Event 的 Trigger 模式應把 Options 來源顯示為 `Option`，但既有 JSON 仍保存 `Action:<id>`。開啟 `keyboard_input` Event 時，Trigger 應顯示 Keyboard 與 K；`mouse_input` 應顯示 Mouse 與右鍵。Keyboard 欄位聚焦後直接按其他按鍵組合，應能錄製、儲存並在重新載入後保留。
7. 開啟「關聯圖」。應看到 `root → options_lab → branch_lab → 結果節點`，權重 Next Node 會各自形成兩條邊。
8. 游標放在圖面空白處，用 MacBook 觸控板兩指上下滑動：圖應以游標位置連續縮放；反方向滑動應反向縮放。拖曳空白處應平移且不可反白圖面。搜尋位於左下角，右下角只有圓形重新置中圖示按鈕，不應顯示操作提示文字。
9. 在設定中修改一組快捷鍵，關閉 Editor 的 Terminal 視窗，重新雙擊啟動器；設定應仍保留。
10. 要驗證 Content 刪除流程，請在任一節點新增一個「未被 Event 引用」的臨時 Content，輸入並等待儲存後再刪除。預期不會跳出「儲存失敗」。不要刪除產生器建立且已被 Event 引用的 labels。
11. 在 `options_lab` 的 Options 工作區，確認側欄寬度與 Event 一致；中間把手只顯示三條豎線。慢速拖曳把手時，分隔線應逐像素跟隨游標，左右欄框與淡入淡出比例應連續同步；新舊內容都只能顯示在各自欄框內，兩框中央也不可透出底層工作區。單擊把手應呈現明顯的加速後減速，而非等速平移；切換結束的最後一幀不應閃白、重新淡入或跳動。`Command+.`／`Ctrl+.` 應切換表單與畫布。切至畫布後，底圖選單應延展並填滿格線／吸附按鈕與尺寸資訊之間的剩餘寬度。
12. 在畫布直接點選 TEXTBOX、綠色 PICTURE 與 HITBOX，右側 Inspector 應跟著切換，不應再出現元件下拉選單。
13. 三種 Element 的表單都應以獨立「聲音」卡片顯示 Hover／Click Sound。Picture 的 Name 與 Trigger 應左右齊平；Picture 的 Idle 圖片仍在表單選擇。Options 表單使用 `Name`、`Text` 與 `Items` 英文標籤。
14. 三種 Element 的 Hover 效果與 Hover 顏色應位於畫布的「外觀」；Picture 啟用 Hover 後可在同處選擇 Hover 圖片。關閉 Hover 效果後相關顏色與圖片欄位應收起。畫布的「版面細節」「外觀」標題旁不應有摘要文字。

## Ren'Py Runtime 測試清單

由 Ren'Py Launcher 啟動遊戲，右上角應顯示外部 HUD、目前節點、點數、操作次數與 Memory 狀態。

### DATA Options 入口與 Event 選擇

1. 按「取得 10 點」數次；每次點數增加 10，台詞會由同一 Event 的兩個 Content labels 以 1:1 權重抽選。
2. 新一輪遊戲的初始點數為 20。連按兩次「花費 15 點」：第一次扣至 5，第二次由 fallback Event 接手且不扣點。
3. 按兩次「領取一次性 25 點獎勵」：第一次增加 25，第二次不再增加，並由檢查 `once:one_time_bonus` Memory 的 fallback Event 顯示說明。
4. 選項顯示期間按 K，應觸發 Keyboard Event 並增加 2 點；按滑鼠右鍵，應觸發 Mouse Event、增加 4 點，而不是開啟遊戲選單。

### Event 條件與三種 Option Element

1. 進入 `options_lab`。中央清單超過 4 個項目，應可用滾輪或拖曳捲動。
2. 按「取得 1 點」；台詞結束後同一組選項重新出現，這就是所有 Option 共用的 INTERACTION 行為。
3. 未取得鑰匙前先按「使用測試鑰匙」，應由 fallback Event 說明無法使用；再按「取得測試鑰匙」，接著使用成功並由條件 Event 移除 Memory。兩個選項全程都會顯示且可操作。
4. 點左下綠色 PICTURE，點數應增加 3。把游標移到右下透明 HITBOX，區域應發亮；點擊後 HUD 的 `Hitbox` 應變成 `True`。
5. 按「返回測試入口」，應透過 EXIT 回到 `root`。

### 分支、權重 Next Node 與 Node stack

1. 從 `options_lab` 前往 `branch_lab`。點數至少 30 時按「依條件前往結果」，應到成功節點；不足 30 時應到 fallback 節點。
2. 在結果節點按「EXIT 回到上一個節點」，應回到發起 GOTO 的節點，而不是固定回 root。
3. 按「權重隨機結果」可反覆測試兩個 1:1 結果節點。隨機測試不保證短時間內兩邊都出現。
4. 從 `branch_lab` EXIT 應回到 `options_lab`，再 EXIT 才回 `root`。
5. 在 root 按「結束這次 Runtime 測試」，Scene Runtime 應正常結束。

## 測試自己的 `gui.rpy`／`screens.rpy`

外部 Screen 位於：

```text
<測試專案>/game/scene_editor_test_ui.rpy
```

你可以修改其排版、字體、樣式，或把 Screen 搬進 `screens.rpy`。只要保留 `scene_editor_test_hud` 這個 Screen 名稱，Node 不需修改。

`gui.rpy` 適合調整全域 GUI 變數與樣式，`screens.rpy` 或其他 `.rpy` 負責實際 Scene Screen／HUD 結構。Scene Node Editor 不會覆寫它們；它只保存 Scene Screen 名稱供 Runtime 顯示。玩家選項固定由 `Options.json` Renderer 提供，外部 Screen 不會取代它。
