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
- 使用中文顯示名稱，並自動映射至穩定技術 ID
- 刪除 Scene Node 前檢查 `Next Node` 引用
- 用表單建立、編輯與刪除 Event
- 編輯 Conditions、Effects、Content 與 Next Node 權重
- 建立與編輯 Stats
- 用表單建立 Text Box、Picture 與 Hitbox 選項
- 在 1920 × 1080 視覺畫布拖曳、縮放與設定 Text Box 顯示列數
- 將樣式、條件、音效等低頻欄位收納在「進階選項」
- 保留 `SCENEOPTION.rpy` 作為自訂模式
- 建立與編輯 Content label
- 建立與編輯 Scene Screen
- 檢查 Stat、Content、Screen 與 Next Node 引用

## 選項工作區

每個 Scene Node 預設使用 `Options.json`。Text Box 可設定最多顯示項目、滑鼠滾輪、拖曳滾動，以及 `AUTO`、`HIDDEN`、`ALWAYS` 三種滑桿模式。超過顯示數量的 Item 會留在清單中，玩家可捲動查看。

位置、尺寸、文字與 Trigger 等常用欄位會直接顯示；條件、完整樣式、音效、Scrollbar 細節與自訂 RPY 收在「進階選項」。需要 Ren'Py 原生 Screen 能力時，將選項模式切換成 `CUSTOM`，即可改用節點內的 `SCENEOPTION.rpy`。

## 名稱與 ID

創作者在編輯器中可以直接使用中文命名。建立資料時，編輯器會同時產生一個技術 ID：

```text
顯示名稱  我的房間
技術 ID  node_4ed03143
```

顯示名稱可以修改，技術 ID 則保持不變。Ren'Py label、screen、JSON 引用與存檔因此不會因中文改名而斷裂。Trigger、Tag 與玩家看到的選項文字仍可以使用中文。

## 刪除節點

刪除前，編輯器會搜尋所有 Event 的 `Next Node`。若還有 Event 指向該節點，刪除會被阻止並列出引用來源。

可刪除的節點不會立即永久消失，而是移至 Ren'Py 專案根目錄下的 `.scene-node-trash/`。這個目錄位於 `game/` 外，不會被 Ren'Py 當成遊戲內容載入。

編輯器會在專案根目錄使用：

```text
DATA/
SCENENODE/
SCENESCREEN/
```
