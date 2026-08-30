# 使用 AI 協助開發 Scene Node 遊戲

[繁體中文](AI_WORKFLOW.md) · [English](../en/AI_WORKFLOW.md) · [回到首頁](../../EDITOR/README.md)

Installer 會把精簡契約與中英文創作者文件放在：

```text
<RenPy Project>/.scene-node-editor/AI_CONTEXT.md
<RenPy Project>/.scene-node-editor/docs/zh-TW/
<RenPy Project>/.scene-node-editor/docs/en/
```

開始任何 AI 工作前，先要求它閱讀 `AI_CONTEXT.md`；需要細節時，再閱讀專案內同語言的 Reference 或 User Guide。這比把文件貼進提示更穩定，也能避免 AI 誤改 Framework 或把 Options 當成自訂 Screen。這些文件由 Installer 管理，更新 Editor 時會一起刷新。

## 通用提示模板

```text
請先閱讀 .scene-node-editor/AI_CONTEXT.md，再檢查與需求相關的現有文件。

我的目標：<描述玩家看到與操作的結果>
允許修改：<指定 .rpy、Content 或資料範圍>
不要修改：game/FRAMEWORK、既有技術 ID、未提到的遊戲資料

請先判斷這是：
1. Editor 資料設定
2. Content／Ren'Py 演出
3. gui.rpy／screens.rpy 介面
4. 專案專屬系統
5. Schema／Runtime 契約變更

若屬於第 5 類，先說明設計與影響，不要直接實作。
完成後列出修改檔案、驗證方式，以及我需要在 Editor 內設定的引用。
```

## 建立 HUD

```text
請先閱讀 .scene-node-editor/AI_CONTEXT.md。

在 game/screens.rpy 建立一個無參數的 room_hud Screen，顯示 money Stat。
使用 scene_get_stat("money", 0) 讀取，不要直接修改 State。
不要修改 FRAMEWORK 或 Options.json。
在指定的 On Enter Content 使用 show screen room_hud，並在對應 On Exit Content 使用 hide screen room_hud。
```

## 撰寫 Content 演出

```text
請閱讀 AI_CONTEXT，然後只修改我指定的 CONTENT .rpy。
保留既有 label ID，在 label 內加入對話、轉場與 ATL，最後 return。
不要重複 Event 已經負責的 Stat／Memory Effects，也不要自行 GOTO Scene Node。
只有 Editor 無法表達的專屬系統才使用 scene_change_stat；提醒我它會先於該 Event 的 Effects 執行。
```

## 實作專屬系統

```text
我需要一個 Editor 尚未資料化的背包系統。
先提出 creator-owned .rpy 的模組邊界，以及如何透過 Content 或公開 API 與 Scene Node 流程連接。
不要把背包程式寫進 option_renderer.rpy，不要新增 Schema 欄位，除非我先確認設計。
優先以 Event Effects 管理一般 Stat／Memory 改變；Screen 顯示 expression 只能呼叫查詢 API。
```

## 建立全局規則

```text
請先閱讀 AI_CONTEXT，並把換日條件設計成 Global Node 的 On Node Event。
它要與目前節點 Events 共用 Priority／Weight 候選流程，不得建立假的 Parent，也不得讓 __global__ 進入 Stack。
若規則必須在本地 Event End up 之前同步執行，先指出 Global On Node 的時機限制，不要假設它是 post-event hook。
```

## AI 可以直接處理的工作

- 撰寫或調整 `gui.rpy`、`screens.rpy` 與 HUD。
- 編輯指定 Content label 內的 Ren'Py。
- 建立 ATL、Transform、角色與創作者自訂系統。
- 分析 Event Conditions／Effects 與節點流程。
- 依 Reference 建議 Editor 中應建立的資料。

## AI 應先停下說明的工作

- 修改 `FRAMEWORK/runtime.rpy` 或 `option_renderer.rpy`。
- 新增／刪除 Schema 欄位。
- 改變 Trigger、REDO、GOTO、REPLACE、EXIT 或 Scene Stack 語意。
- 重新命名穩定 ID 或搬移被引用的 labels。
- 改變 Installer 覆寫範圍或存檔相容性。

## 完成後的人工檢查

1. 檢視 AI 實際修改的 diff。
2. 在 Editor 執行「檢查專案」。
3. 確認自動儲存完成。
4. 從 Ren'Py Launcher 實際操作受影響流程。
5. 確認更新 Installer 後，創作者文件仍會保留。

AI 可以加速實作，但劇情、規則、視覺方向與最終驗收仍由創作者決定。
