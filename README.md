# Scene Node Editor for Ren'Py

Scene Node Editor 是一套以瀏覽器 GUI 編輯 Ren'Py Scene Node、Options、Events、Stats、Memory Banks、Content 與 Scene Screens 的本機工具。目前版本為公開 alpha。

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
      SceneProject.json
      Stats.json
      Memories.json
    SCENENODE/
      root/
    SCENESCREEN/
```

第一次安裝且專案尚無任何 Scene Node 時，安裝器會建立技術 ID 為 `root` 的 ROOT 節點與 `SceneProject.json`。若 `script.rpy` 是空白內容或各語系的 Ren'Py 新專案預設範本，安裝器會先備份原檔再安全接上 Root；已有自訂 `label start` 時則不會覆寫。舊版若未能辨識預設範本，重新執行安裝器即可補做接線。

`.scene-node-editor/` 與專案啟動器使用相對路徑，因此整個 Ren'Py 專案搬到其他位置後仍可啟動。

## 建立第一個可玩節點

1. 開啟安裝器建立的 ROOT Scene Node。
2. 在「選項」加入 Text Box 與至少一個 Item。
3. 記下 Item 的 Trigger。
4. 在「事件」建立 Trigger 相同的 Event，並保留一個無條件 Event 作為 fallback。
5. Content 可以保持 `None`，或建立 Ren'Py label。
6. 需要改用其他起始節點時，在節點頁選擇「設為起始節點」。

接著修改遊戲原有的 `game/script.rpy`：

```renpy
label start:
    call scene_runtime_start()
    return
```

既有專案仍可使用 `scene_runtime_start("節點技術_ID")`。顯式 ID 會優先於 `SceneProject.json`。

回到編輯器執行「檢查專案」，通過後即可由 Ren'Py Launcher 啟動遊戲。

## 狀態與記憶庫

「狀態」工作區同時管理 `Stats.json` 與 `Memories.json`。新專案固定包含不可移除的預設 `Memory` 記憶庫，創作者可再建立章節、每日或其他用途的記憶庫；名稱只是用途說明，不會自動決定刷新時間。

Event Conditions 可用 `has / not_has` 檢查指定記憶庫中的標籤；Effects 可用 `add / remove / clear` 修改記憶。自訂 Ren'Py 程式可使用：

```renpy
$ scene_memory_has("memory", "已看過開場")
$ scene_memory_add("memory", "已看過開場")
$ scene_memory_remove("memory", "已看過開場")
$ scene_memory_clear("daily")
```

例如換日系統應在確定換日的流程中明確呼叫 `scene_memory_clear("daily")`；Runtime 不再假設遊戲如何計算日或週。

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

`SceneProject.json`、`Stats.json`、`Memories.json`、Scene Nodes、Options、Events、Contents 與 Scene Screens 不會被覆寫。

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

目前仍是 `0.x alpha`：格式與 Runtime API 可能調整。建議將遊戲專案與 Editor Repository 分開管理，並定期備份創作資料。

目前資料格式與 Runner 行為整理於 [`階段性架構規格.md`](階段性架構規格.md)。開啟新的開發對話前，請先閱讀 [`EDITOR/HANDOFF.md`](EDITOR/HANDOFF.md)。安裝器所需的 Runtime 來源位於 `INTEGRATION/TestGame/FRAMEWORK/`；本機創作與測試遊戲資料不屬於發布包。

## License

本專案以 [MIT License](LICENSE) 授權。
