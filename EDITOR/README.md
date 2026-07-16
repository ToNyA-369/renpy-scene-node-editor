# Scene Node Editor

Scene Node Editor 是這套 Ren'Py 架構的本機內容編輯器。GUI 直接讀寫專案中的 JSON 與 `.rpy`，不使用額外資料庫。

## 啟動

在 macOS 雙擊專案根目錄的 `啟動編輯器.command`。

也可以從終端啟動：

```sh
python3 EDITOR/app.py
```

要編輯另一個 Ren'Py 專案的 `game/` 資料夾，可以指定：

```sh
python3 EDITOR/app.py --project "/path/to/project/game"
```

預設網址：

```text
http://127.0.0.1:8765
```

只需要 Python 3，不需要安裝其他套件。

## 功能範圍

- 建立與編輯 Scene Node
- 為空白專案建立 ROOT 節點，並保護目前的起始節點不被直接刪除
- 將其他 Scene Node 設為新的起始節點
- 使用中文顯示名稱，並自動映射至穩定技術 ID
- 刪除 Scene Node 前檢查 `Next Node` 引用
- 用表單建立、編輯與刪除 Event
- 編輯 Conditions、Effects、Content 與 Next Node 權重
- 在「狀態」工作區建立與編輯 Stats、Memory Banks
- 以表單設定記憶標籤的 has、not_has、add、remove 與 clear
- 用表單建立 Text Box、Picture 與 Hitbox 選項
- 在 1920 × 1080 視覺畫布拖曳、縮放與設定 Text Box 顯示列數
- 切換格線與座標吸附，並在設定中調整格線尺寸
- 將樣式、條件、音效等低頻欄位收納在「進階選項」
- 編輯後自動儲存，切換分頁、文件或節點前會先完成待處理的寫入
- 使用快捷鍵循環功能區、切換左右工作欄、開啟節點抽屜與設定，並可自訂按鍵
- 保留 `SCENEOPTION.rpy` 作為自訂模式
- 建立與編輯 Content label
- 建立與編輯 Scene Screen
- 檢查 Stat、Memory Bank、Content、Screen 與 Next Node 引用

## 選項工作區

每個 Scene Node 預設使用 `Options.json`。Text Box 可設定最多顯示項目、滑鼠滾輪、拖曳滾動，以及 `AUTO`、`HIDDEN`、`ALWAYS` 三種滑桿模式。超過顯示數量的 Item 會留在清單中，玩家可捲動查看。

位置、尺寸、文字與 Trigger 等常用欄位會直接顯示；條件、完整樣式、音效、Scrollbar 細節與自訂 RPY 收在「進階選項」。需要 Ren'Py 原生 Screen 能力時，將選項模式切換成 `CUSTOM`，即可改用節點內的 `SCENEOPTION.rpy`。

畫布工具列可分別開關格線與吸附。拖曳與縮放期間只更新目前操作的元件，放開後再自動儲存，因此不會因重新建立整個畫布而中斷操作。

## 自動儲存與快捷鍵

右上角的設定按鈕可調整自動儲存延遲、格線尺寸與快捷鍵。點選快捷鍵欄位後直接按下新的組合；按 `Backspace` 可清除，重複的組合會被阻止。

預設快捷鍵：

| 動作 | macOS | Windows / Linux |
| --- | --- | --- |
| 立即儲存 | `Command+S` | `Ctrl+S` |
| 切換上一個／下一個功能區 | `Command+Shift+← / →` | `Ctrl+Shift+← / →` |
| 切換左側／右側欄位 | `Command+[ / ]` | `Ctrl+[ / ]` |
| 切換節點列表 | `Command+\` | `Ctrl+\` |
| 前往節點／事件／選項 | `Command+1…3` | `Ctrl+1…3` |
| 前往演出／畫面／狀態／檢查 | `Command+4…7` | `Ctrl+4…7` |
| 切換選項元件列表 | `Option+1` | `Alt+1` |
| 切換選項屬性 | `Option+2` | `Alt+2` |
| 顯示或隱藏格線 | `G` | `G` |
| 開啟或關閉吸附 | `S` | `S` |
| 展開或收合目前區塊 | `Command+.` | `Ctrl+.` |
| 開啟編輯器設定 | `Command+,` | `Ctrl+,` |

## 名稱與 ID

創作者在編輯器中可以直接使用中文命名。建立資料時，編輯器會同時產生一個技術 ID：

```text
顯示名稱  我的房間
技術 ID  node_4ed03143
```

顯示名稱可以修改，技術 ID 則保持不變。Ren'Py label、screen、JSON 引用與存檔因此不會因中文改名而斷裂。Trigger、記憶標籤與玩家看到的選項文字仍可以使用中文。

## 記憶庫

`DATA/Memories.json` 定義可用的 Memory Banks。`memory`／`Memory` 是系統預設庫，供 Once Event 與一般永久記憶使用，因此不能移除；其他記憶庫可在「狀態」工作區建立或移除。

記憶庫不會自行每日或每週刷新。創作者可在 Event Effect 選擇 `clear`，或在自訂 Ren'Py 流程呼叫 `scene_memory_clear("記憶庫_ID")`。這讓換日、換週或章節重置都由遊戲自己的時間流程明確控制。

## 起始節點

空白專案第一次初始化時會建立 `ROOT` 節點，並在 `DATA/SceneProject.json` 記錄其技術 ID。Runtime 可透過 `scene_runtime_start()` 讀取這個設定。ROOT 節點不能直接刪除；若要移除，先在另一個節點按下「設為起始節點」。

若專案沒有自訂 `label start`，或仍保留各語系的 Ren'Py 新專案預設範本，初始化會先備份原檔，再自動於 `script.rpy` 接上 Runtime。已有自訂開場時不會覆寫，專案檢查會提醒創作者自行加入 `call scene_runtime_start()`。若舊版初始化曾跳過預設範本，重新安裝或重新開啟更新後的 Editor 會再次安全嘗試接線。

## 刪除節點

刪除前，編輯器會搜尋所有 Event 的 `Next Node`。若還有 Event 指向該節點，刪除會被阻止並列出引用來源。

可刪除的節點不會立即永久消失，而是移至 Ren'Py 專案根目錄下的 `.scene-node-trash/`。這個目錄位於 `game/` 外，不會被 Ren'Py 當成遊戲內容載入。

編輯器會在專案根目錄使用：

```text
DATA/
SCENENODE/
SCENESCREEN/
```
