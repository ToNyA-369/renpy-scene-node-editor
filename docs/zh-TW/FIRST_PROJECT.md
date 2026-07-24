# 建立第一個 Scene Node 專案

[繁體中文](FIRST_PROJECT.md) · [English](../en/FIRST_PROJECT.md) · [回到首頁](../../README.md)

這份教學會建立一個最小但完整的互動：玩家看到「打開門」，選擇後增加行動次數、播放一段 Content，最後前往第二個節點。

## 1. 安裝

1. 在 Ren'Py Launcher 建立空白專案。
2. 雙擊 Repository 根目錄的 `安裝到RenPy專案.command`。
3. 選擇專案資料夾或 `game/`。
4. 安裝完成後，Editor 會開啟並建立 ROOT 節點。

如果 macOS 阻擋第一次執行，請在 Finder 對安裝器按右鍵後選擇「打開」。

## 2. 確認 Runtime 入口

空白 Ren'Py 範本通常會自動接上 Runtime。若你的 `script.rpy` 已有自訂 `label start`，請保留原內容並在適當位置加入：

```renpy
call scene_runtime_start()
```

不要建立第二個 `label start`。

## 3. 設定 ROOT 節點

進入「節點」：

1. 將 Name 改成「門前」。

節點頁的其餘資訊是由 Events、Options、Content 與流程引用即時計算的摘要，不會寫入額外 Schema。背景、音樂與 Screen 稍後可由 On Enter Event 的 Content 使用原生 Ren'Py 語法建立。

## 4. 建立玩家 Option

進入「選項」並新增 Text Box：

1. 將 Element Name 設為「行動」。
2. 新增一個 Item。
3. Name 與 Text 都設為「打開門」。
4. Trigger 輸入 `open_door`。

Editor 會保存為 `Action:open_door`。Option 本身只回傳 Trigger，不執行 Content、Effects 或 GOTO。

表單模式編輯內容與互動；使用中間把手或 `Command+.`／`Ctrl+.` 切到畫布模式後，可調整位置、尺寸與外觀。

## 5. 建立 Stat

進入「狀態」，新增 Stat：

```text
ID      action_count
Name    行動次數
Init    0
Min     0
Max     999
```

ID 是穩定技術名稱。顯示名稱可以改，但不要直接重新命名已被 Event 引用的 ID。

## 6. 建立 Content

進入「演出」並新增「打開門演出」。Editor 會建立一個 `.rpy` 文件與 label。將內容改成：

```renpy
label content_open_door:
    "門被打開了。"
    return
```

實際 label ID 可能由 Editor 產生；請保留該 ID，只修改 label 內的 Ren'Py 內容。

Event 的 Content 選擇器先顯示 `.rpy` 文件，再顯示文件內的 labels。Event 最終保存的是 label 名稱，不是文件名。

## 7. 建立目標節點

打開節點抽屜並新增節點「門後」。保持它的 Options 為空也沒關係，稍後可以再加入返回或結束操作。

記下它的 Name 即可；Event 選擇 Next Node 時會顯示名稱，底層保存穩定 ID。

## 8. 建立 Event

回到 ROOT 的「事件」，新增 Event：

```text
Name       打開門
Trigger    Option → 打開門
Priority   3
Weight     1
Once       False
```

加入 Effect：

```text
stat → 行動次數 → + → 1
```

選擇剛建立的 Content label，並設定：

```text
End up      GOTO
Next Node   門後
```

這條流程現在是：

```text
Option → Action:open_door → Event → Effect → Content → GOTO
```

## 9. 理解四種流程結果

- `REDO`：留在目前節點，Content 結束後重新顯示 Options。
- `GOTO`：進入另一個節點，並將它放入 Scene Stack。
- `REPLACE`：需要目前 Stack 有父層，將目前節點原子替換為目標節點；目標 EXIT 後會回到原本父節點。
- `EXIT`：離開目前節點，回到父節點；ROOT 執行 EXIT 會結束 Runner。

## 10. 檢查與執行

1. 按頂部「檢查」。
2. 修正所有錯誤與必要提醒。
3. 等待右上角顯示已儲存。
4. 從 Ren'Py Launcher 啟動遊戲。
5. 選擇「打開門」，確認 Content 播放並進入「門後」。

## 下一步

- 在同一 Trigger 建立有 Conditions 的高優先 Event，以及無條件 fallback。
- 使用 Keyboard 或 Mouse Trigger。
- 建立 On Enter Content，使用 `scene room with dissolve` 或 `play music ... fadein 1.0` 設定進場演出。
- 建立 On Exit Content，處理離場淡出或音訊清理。
- 在畫布加入 Picture 或 Hitbox。
- 使用 Memory 記錄鑰匙、章節或已觸發事件。
- 在自己的 `screens.rpy` 建立 HUD，並由 On Enter／On Exit Content 使用 `show screen`／`hide screen` 控制。

繼續閱讀 [Editor 使用指南](USER_GUIDE.md) 與 [Schema／Runtime 參考](REFERENCE.md)。
