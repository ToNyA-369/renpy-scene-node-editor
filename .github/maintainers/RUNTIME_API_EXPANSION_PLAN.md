# Runtime 公開 API 擴充計劃（審核草案）

狀態：專案擁有者已於 2026-08-24 批准第一階段範圍；實作、完整自動驗證、Ren'Py 8.5.3 lint 與暫存專案實際 Runner 驗證均已完成，等待交付審查。

## 1. 目的與定位

這次擴充的目的，是讓創作者在原生 Ren'Py Content、Screen、HUD 或專案專屬 `.rpy` 系統中，能以受驗證且支援存檔／rollback 的方式讀取或少量調整 Scene Node Runtime 狀態。

這些 API 是 Editor 功能的補充橋接層，不是第二套事件系統。一般可由 Editor 表達的遊戲流程仍應優先使用 Event Conditions／Effects，原因如下：

- Event 仍是可視化、可檢查、可排序的狀態改變來源。
- Event Effects 固定在 Content 返回後依陣列順序執行，便於理解最終結果。
- 任意在 Screen render expression、ATL 更新或重複呼叫的顯示函式中改變狀態，可能因 Ren'Py 多次求值而產生非預期結果。
- 公開修改 API 只適合明確的 Content 程式敘述、Screen Action，或 Editor 尚未資料化的專案專屬系統。

文件必須以醒目但不阻礙使用的方式提醒創作者：**能用 Event Effect 表達時，仍優先使用 Event Effect；Runtime 修改 API 只作必要的原生程式橋接。**

## 2. 不得改變的契約

- 不新增或修改 JSON Schema。
- 不改變 Node、Event、Stat、Memory Bank、Element、Item 或 Content 的穩定 ID。
- 不改變 Conditions、Priority、Weight、Once、Effects、End up 或生命週期順序。
- 不改變 `REDO`／`GOTO`／`REPLACE`／`EXIT` 與 Scene Stack 語意。
- 不新增存檔變數；沿用 `scene_stats`、`scene_memories`、`scene_stack` 與既有 reassignment 模式。
- 不讓公開 API 直接寫入專案 JSON、重載 Catalog、重設新遊戲狀態或修改 Editor-only Group／Order。
- 現有公開 API 的參數、回傳值與錯誤行為保持相容。
- `INTEGRATION/TestGame/FRAMEWORK/` 仍是唯一 canonical installable Runtime。

## 3. 現有公開介面盤點

| 介面 | 目前定位 | 結論 |
|---|---|---|
| `call scene_runtime_start()` / `call scene_runtime_start("node_id")` | 啟動 Runner | 保持不變 |
| `scene_get_stat(stat_id, default=0)` | 讀取 Stat | 保持不變 |
| `scene_memory_has(bank_id, tag_id)` | 查詢 Memory Tag | 保持不變 |
| `scene_memory_add(bank_id, tag_id)` | 新增 Memory Tag | 保持不變；仍提醒優先使用 Effect |
| `scene_memory_remove(bank_id, tag_id)` | 移除 Memory Tag | 保持不變；仍提醒優先使用 Effect |
| `scene_memory_clear(bank_id)` | 清空 Memory Bank | 保持不變；適合換日等專屬系統 |

目前 Runtime 另有許多 `scene_*` 函式，但命名前綴不代表它們是公開 API。事件匹配、權重選擇、prepared Event、Effect 套用、Catalog 載入、Options Renderer、Stack 解算與 `scene_reset_state()` 都是內部管線；創作者文件目前也明確要求不要直接呼叫。

`scene_current_node_id()` 已存在，綜合測試也有使用，但尚未列入公開文件與 Editor 程式碼補全，因此目前仍不能視為穩定公開契約。

## 4. 第一階段建議公開的 API

### 4.1 `scene_change_stat(stat_id, operation, value)`

用途：從原生 Ren'Py 程式以與 Event Stat Effect 完全相同的規則修改 Stat。

```renpy
$ final_money = scene_change_stat("money", "+", 10)
$ final_hour = scene_change_stat("hour", "set", 18)
```

契約：

- `operation` 只接受 `set`、`+`、`-`、`*`、`/`。
- Stat ID 必須存在。
- 運算元必須是有限數字，布林值不視為數字。
- 除數為零時先報錯，不得留下部分修改。
- 結果套用 Stat `Min`／`Max`，並回傳限制後的最終值。
- 寫入必須複製並重新賦值 `scene_stats`，不得原地修改，以維持 Ren'Py save／rollback 語意。
- `scene_apply_stat_effect()` 改為呼叫同一個核心實作，避免公開 API 與 Event Effect 產生兩套運算規則。
- 若 Content 與同一 Event 的 Effects 都修改同一 Stat，順序固定為「Content 中的 API 修改 → Content return → Effects 由上到下修改」。文件必須直接說明這一點。

不建議同時增加 `scene_set_stat()`、`scene_add_stat()`、`scene_subtract_stat()` 等包裝函式。單一入口與 Editor 現有五種操作一致，公開面較小，也不會讓自動完成清單膨脹。

### 4.2 正式公開既有的 `scene_current_node_id()`

用途：讓 HUD、地圖、日誌或專案專屬系統得知 Runner 目前所在節點。

```renpy
$ node_id = scene_current_node_id()
```

契約：

- Runner 尚未啟動或已從第一層 EXIT 時回傳 `None`。
- 只回傳穩定 Node ID，不回傳或暴露可修改的 `scene_stack`。
- 不提供由 API 修改目前節點的能力。

此項主要是文件、測試與補全上的正式化，不改變現有 Runtime 行為。

### 4.3 `scene_current_node_name(default="")`

用途：讓 HUD 或除錯介面顯示目前節點的創作者名稱，而不必讀取 `scene_catalog`。

```renpy
$ location_name = scene_current_node_name("Unknown")
```

契約：

- 有目前節點時回傳該節點 `Name`；Name 缺失時回退穩定 ID。
- Runner 未啟動或已結束時回傳 `default`。
- 只回傳字串，不公開可被修改的 Node dict。

### 4.4 `scene_memory_tags(bank_id)`

用途：讓日誌、任務頁或專屬系統安全列出某個 Memory Bank 的目前標籤。

```renpy
$ completed_flags = scene_memory_tags("quests")
```

契約：

- Bank ID 必須存在，沿用現有 Memory 驗證與舊存檔遷移。
- 回傳不可影響 Runtime 狀態的快照；建議使用 tuple。
- 保留目前穩定插入順序，不承諾排序或 Tag Schema。
- 修改回傳值不得能繞過 `scene_memory_add/remove/clear()`。

## 5. 建議延後或明確不公開的介面

### 第二階段候選，先不納入此次實作

- `scene_get_stat_limits(stat_id)`：對自訂 meter／progress bar 有用，但會擴大 Stat definition 的公開契約；先觀察實際需求。
- 以穩定 ID 查詢 Option Availability：屬唯讀能力，風險較低，但目前缺乏明確的創作者使用案例。
- 查詢 Stack depth 或父節點：可能適合導航提示，但容易讓內容依賴 Runtime 結構，應先設計用途導向的 API。

### 此次不應公開

- `scene_apply_stat_effect()`、`scene_apply_effect()`、`scene_apply_prepared()`：接受內部資料形狀，公開後會把 Event JSON 內部契約變成腳本 API。
- `scene_select_event()`、`scene_lifecycle_events()` 或任意 `scene_trigger()`：會繞過或重入 Runner 的事件挑選與 Content call 流程。
- `scene_begin()`、`scene_reset_state()`、`scene_reload_catalog()`：可能清除存檔狀態或讓執行中 Catalog 與 prepared Event 不一致。
- `scene_get_node()`、`scene_current_node()`：目前回傳 Runtime 持有的可變 dict，創作者可意外修改 Catalog。
- `scene_resolve_prepared()` 或直接 GOTO／REPLACE／EXIT API：會繞過生命週期、目標驗證與 End up 流程。
- 公開 `scene_stats`、`scene_memories`、`scene_stack`、`scene_enabled_options`：會繞過驗證、reassignment 與作用域契約。
- 任意 Option enable／disable API：目前 Option Effect 有嚴格的 Event owner scope；若沒有具體需求，不應先建立另一條跨作用域修改路徑。

## 6. 失敗路徑與錯誤原則

- 未知 Stat、未知 Memory Bank、空 Tag、非法操作、非數值運算元與除以零都應立即報出包含穩定 ID 的明確錯誤。
- 任何失敗都必須是原子的：錯誤前後 Runtime 狀態相同。
- 唯讀查詢不得回傳能修改 Runtime 內部集合或 Catalog 的參照。
- 不吞掉錯誤或以 `0` 靜默代替修改失敗；只有既有 `scene_get_stat(..., default)` 保留其讀取 fallback 契約。
- 公開 API 不負責自動觸發 Events、重新整理 Options 或改變 Runner 控制流。

## 7. 影響面與實作位置

若草案獲批准，需一次更新以下表面：

1. `INTEGRATION/TestGame/FRAMEWORK/runtime.rpy`
   - 新增公開函式。
   - 抽出 Stat 共用運算核心，讓 Event Effect 與公開 API 共用。
2. Runtime 回歸測試
   - 建議新增 `tests/test_runtime_public_api.py`，避免把公開契約分散在內部 lifecycle 測試。
   - 既有 Stat／Memory／lifecycle 測試保持通過。
3. `EDITOR/static/js/workspaces/content_editor_support.js`
   - 在 Ren'Py 編輯器補全中加入批准的公開 API。
   - 補全說明應標示「原生橋接；一般狀態改變優先使用 Event Effect」。
4. `tests/js/content_editor_support.test.js`
   - 鎖定公開補全清單與插入格式。
5. 雙語創作者文件
   - `docs/zh-TW/REFERENCE.md`、`docs/en/REFERENCE.md`
   - `docs/zh-TW/USER_GUIDE.md`、`docs/en/USER_GUIDE.md`
   - 加入呼叫時機、回傳值、錯誤與 Content-before-Effects 順序。
6. AI 協作契約
   - `docs/AI_CONTEXT.md`
   - `docs/zh-TW/AI_WORKFLOW.md`、`docs/en/AI_WORKFLOW.md`
   - 要求 AI 優先建議 Event Effect，只有專屬 `.rpy` 系統才使用修改 API。
7. 維護契約
   - `EDITOR/HANDOFF.md` 記錄正式公開面、所有權與測試入口。
8. Installer／Release
   - Installer 已管理 Runtime 與創作者文件；不新增新的安裝來源。
   - 包裝測試需確認新 Runtime 與文件會進入產品 ZIP。
   - 實作完成只代表可提交；是否建立 Release 仍由專案擁有者另行授權。

不需修改 Editor JSON Schema、Editor HTTP API、Options Schema 或現有專案資料，也不需要資料遷移。

## 8. 驗收條件

### 自動測試

- `scene_change_stat()` 的五種操作都與 Event Stat Effect 得到完全相同結果。
- 每種操作正確套用 Min／Max，並回傳限制後數值。
- 未知 ID、非法 operation、非有限數字、布林值與除以零均不修改原狀態。
- `scene_current_node_id()` 在未啟動、執行中與結束後符合契約。
- `scene_current_node_name()` 正確處理 Name、ID fallback 與 default。
- `scene_memory_tags()` 觸發必要遷移、保留順序，且回傳值無法修改內部狀態。
- Content editor 只補全正式公開 API，不把內部 `scene_*` 函式列出。
- `python3 tools/verify.py` 完整通過。

### Ren'Py 實機驗證

- 在可拋棄專案中由 Content `$ scene_change_stat(...)` 修改，確認 Event Effect 隨後依序套用。
- 由 Screen Action 修改 Stat，確認顯示更新、存檔／讀檔與 rollback 正常。
- 在 Screen 顯示目前 Node ID／Name 與 Memory Tag 快照。
- 執行一次非法操作，確認錯誤清楚且重新載入前後狀態未部分改變。
- 執行 Ren'Py lint；不得修改創作者本機測試資料。

## 9. 建議實作順序

1. 專案擁有者批准 API 名稱、第一階段範圍及延後項目。
2. 先建立公開契約測試，再實作 Runtime 共用核心。
3. 跑 Runtime／contract focused tests。
4. 更新雙語文件、AI 契約與 Editor 補全。
5. 跑完整 `python3 tools/verify.py`。
6. 以可拋棄 Ren'Py 專案做實機 save／load／rollback 驗證。
7. 交付 diff 與測試證據；未取得另外授權前不提交、推送、合併、tag 或建立 Release。

## 10. 請專案擁有者審核的決策

建議一次確認下列三點後才進入實作：

1. 是否批准第一階段四項公開面：`scene_change_stat()`、正式公開 `scene_current_node_id()`、`scene_current_node_name()`、`scene_memory_tags()`。
2. 是否接受 `scene_change_stat()` 採單一 operation 參數，而不增加多個 convenience wrappers。
3. 是否同意 Option 控制、Event 觸發、Stack 操作與可變 Catalog 繼續維持內部介面。

本計劃的推薦答案皆為「是」。這能補足最常見的原生 Ren'Py 整合需求，同時保持 Editor／Event 是主要遊戲流程來源。
