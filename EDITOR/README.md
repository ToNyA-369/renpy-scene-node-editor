# Scene Node Editor 本機說明

[English](README.en.md) · [完整中文文件](https://github.com/ToNyA-369/renpy-scene-node-editor/blob/main/docs/zh-TW/USER_GUIDE.md)

這份 Editor 已安裝在你的 Ren'Py 專案中。它用來管理 Scene Node、Event、Options、Content 與遊戲狀態；`gui.rpy`、`screens.rpy`、角色、素材與實際演出仍由你在 Ren'Py 專案中撰寫。

## 啟動

在專案根目錄雙擊：

```text
啟動 Scene Node 編輯器.command
```

也可以從終端啟動：

```sh
python3 .scene-node-editor/EDITOR/app.py --project game
```

Editor 只在本機運作，關閉啟動器的終端視窗就會停止服務。

## 最短工作流程

1. 在「節點」建立或選擇 Scene Node。
2. 在「選項」建立玩家可操作的 Text Box、Picture 或 Hitbox。
3. 在「演出」建立 Content label，並撰寫 Ren'Py 演出。
4. 在「事件」以 Option、Keyboard、Mouse 或 Auto Trigger 串接 Content、Effects 與 End Up。
5. 在「檢查」修正引用問題，再從 Ren'Py 啟動遊戲測試。

需要完整教學時，請閱讀[第一個可玩流程](https://github.com/ToNyA-369/renpy-scene-node-editor/blob/main/docs/zh-TW/FIRST_PROJECT.md)。

## 重要概念

- Option 只送出 Trigger；真正的條件、狀態變更與流程分支由 Event 決定。
- Content 儲存的是 Ren'Py `label` 名稱，不是 `.rpy` 文件名。
- `REDO` 重跑目前節點、`GOTO` 進入子節點、`EXIT` 回到父節點。
- 所有顯示中的 Option 都可操作，並在一次互動結束後消失；下一輪顯示是 Runtime 再次建立它。
- Scene Screen 適合場景外殼或 HUD。請自行在 `screens.rpy` 或其他 `.rpy` 中定義，再於節點選取它。

完整資料與 Runtime 契約請見[技術參考](https://github.com/ToNyA-369/renpy-scene-node-editor/blob/main/docs/zh-TW/REFERENCE.md)。

## 儲存與設定

Editor 會自動儲存。切換節點、文件或工作區前，也會先完成尚未寫入的修改。

快捷鍵、自動儲存延遲與格線尺寸保存在：

```text
.scene-node-editor/settings.json
```

這是本機 Editor 設定，不是遊戲內容。

## 哪些文件可以自己修改

安裝器更新時會管理：

```text
.scene-node-editor/EDITOR/
.scene-node-editor/AI_CONTEXT.md
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
```

請不要把自訂邏輯寫進這些文件。你可以安全維護自己的 `gui.rpy`、`screens.rpy`、其他 `.rpy`、素材，以及 Editor 建立的 `DATA/`、`SCENENODE/` 內容；更新不會覆寫這些創作者資料。

若使用 AI 協助開發，先請它閱讀 `.scene-node-editor/AI_CONTEXT.md`。範例提示詞見 [AI 協作指南](https://github.com/ToNyA-369/renpy-scene-node-editor/blob/main/docs/zh-TW/AI_WORKFLOW.md)。

## 常見問題

- 遊戲沒有進入 Scene Node：確認 `label start` 有 `call scene_runtime_start()`。
- Content 沒有出現在清單：確認 `.rpy` 位於 `game/` 下，且有有效的 `label`。
- Scene Screen 找不到：確認 Screen 位於 `game/` 下的 `.rpy`，並重新整理 Editor。
- Trigger 沒有反應：確認目前節點存在相同 Trigger 的 Event，並建議保留一個無條件 fallback Event。
- 刪錯節點：可到專案根目錄的 `.scene-node-trash/` 尋找可復原資料。

回報問題或查看最新版本：<https://github.com/ToNyA-369/renpy-scene-node-editor>
