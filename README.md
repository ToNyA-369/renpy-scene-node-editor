# Scene Node Editor for Ren'Py

Scene Node Editor 是一套以瀏覽器 GUI 編輯 Ren'Py Scene Node、Options、Events、Stats、Content 與 Scene Screens 的本機工具。目前版本為私人測試階段。

## 系統需求

- Ren'Py 8
- Python 3
- macOS：可使用雙擊安裝器

目前以 Ren'Py 8.5.3 驗證。編輯器本身只使用 Python 標準函式庫，不需要額外安裝套件。

## 安裝到空白 Ren'Py 專案

1. 使用 Ren'Py Launcher 建立一個空白專案。
2. 雙擊 `安裝到RenPy專案.command`。
3. 選擇 Ren'Py 專案資料夾，或其中的 `game/` 資料夾。
4. 安裝完成後，專案專屬的編輯器會自動開啟。

從 GitHub 下載後第一次執行時，macOS 可能要求確認來源。此時可在 Finder 對安裝器按右鍵並選擇「打開」。若檔案失去執行權限，可在 Terminal 執行：

```sh
chmod +x 安裝到RenPy專案.command
```

安裝器會建立：

```text
<RenPy Project>/
  .scene-node-editor/
    EDITOR/
    manifest.json
  啟動 Scene Node 編輯器.command
  game/
    FRAMEWORK/
      runtime.rpy
      option_renderer.rpy
    DATA/
      Stats.json
    SCENENODE/
    SCENESCREEN/
```

`.scene-node-editor/` 與專案啟動器使用相對路徑，因此整個 Ren'Py 專案搬到其他位置後仍可啟動。

## 建立第一個可玩節點

1. 在編輯器建立一個 Scene Node。
2. 在「選項」加入 Text Box 與至少一個 Item。
3. 記下 Item 的 Trigger。
4. 在「事件」建立 Trigger 相同的 Event，並保留一個無條件 Event 作為 fallback。
5. Content 可以保持 `None`，或建立 Ren'Py label。
6. 在節點頁記下穩定技術 ID。

接著修改遊戲原有的 `game/script.rpy`：

```renpy
label start:
    call scene_runtime_start("你的第一個節點技術_ID")
    return
```

回到編輯器執行「檢查專案」，通過後即可由 Ren'Py Launcher 啟動遊戲。

## 再次開啟

之後只需雙擊 Ren'Py 專案根目錄內的：

```text
啟動 Scene Node 編輯器.command
```

啟動器會自動選擇可用連接埠並開啟瀏覽器。關閉啟動器的 Terminal 視窗後，本機 Editor Server 也會停止。

## 更新

下載新版後，再次執行 `安裝到RenPy專案.command` 並選擇同一個專案。安裝器只會更新下列受管理檔案：

```text
.scene-node-editor/EDITOR/
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
啟動 Scene Node 編輯器.command
```

`Stats.json`、Scene Nodes、Options、Events、Contents 與 Scene Screens 不會被覆寫。

## 命令列安裝

macOS 以外的平台可以使用：

```sh
python3 tools/install.py "/path/to/RenPyProject"
```

接著執行安裝器產生的專案啟動器，或直接執行：

```sh
python3 "/path/to/RenPyProject/.scene-node-editor/EDITOR/app.py" \
  --project "/path/to/RenPyProject/game"
```

## 開發狀態

目前仍是 `0.x alpha`：格式與 Runtime API 可能調整。私人測試期間建議將遊戲專案與 Editor Repository 分開管理，並定期備份創作資料。

目前資料格式與 Runner 行為整理於 [`階段性架構規格.md`](階段性架構規格.md)。`INTEGRATION/TestGame/` 則是可供開發與回歸測試的示範內容。
