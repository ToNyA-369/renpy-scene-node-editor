# 維護與擴充指南

[English](MAINTENANCE.en.md)

這份文件回答「新增功能時，應從哪裡開始、必須同步哪些地方」。遊戲架構與資料語意仍以 [Reference](zh-TW/REFERENCE.md) 為準。

## 前端分層

`EDITOR/static/app.js` 現在是組裝入口，不再是所有邏輯的唯一存放處。可獨立判斷或重複使用的行為應放入小型模組：

```text
js/core/api_client.js           API 請求與錯誤分類
js/core/autosave_coordinator.js 自動儲存時序
js/core/editor_settings.js      分頁、快捷鍵、設定版本與遷移
js/core/event_contract.js       Trigger／End up 的 Editor 契約
js/core/state_rule_contract.js  Condition／Effect 的 Editor 契約
js/ui/choice_picker.js           共用階層下拉選單
js/workspaces/event_editor.js    Event 規則、權重選擇與 DOM 序列化
js/workspaces/state_editor.js    Stats 群組與階層選單資料
js/workspaces/graph_model.js     關聯圖關係、布局與路徑
app.js                           狀態組裝、畫面渲染與跨模組協調
```

新增模組需符合三個條件：

1. 只負責一個可描述的範圍。
2. 不依賴 `app.js` 的隱含全域變數；需要的 callback 或資料由建立時傳入。
3. 純邏輯可直接由 `node:test` 執行。

目前採瀏覽器原生腳本與明確 namespace，不加入 bundler 或第三方前端框架。`index.html` 是模組載入順序的唯一入口。

## 常見擴充路徑

### 新增 Trigger

1. 在 `event_contract.js` 登錄 Editor 顯示模式與名稱。
2. 在 `EDITOR/app.py` 驗證保存格式。
3. 在 Runtime 加入候選事件或輸入轉換。
4. 若屬於實際輸入，確認 `option_renderer.rpy` 的 binding。
5. 加入 JS 契約測試、Python Schema 測試與 Runtime 測試。
6. 更新雙語 Reference／User Guide。

### 新增 End up

1. 在 `END_UP_CHOICES` 登錄；需要目標時同步 `endUpUsesNextNode()`。
2. 更新 Editor API Schema、引用驗證與刪除保護。
3. 定義 Runtime Stack 的原子操作與生命週期順序。
4. 更新關聯圖資料模型與 tooltip。
5. 加入單一目標、權重目標、錯誤時機及既有 End up 回歸測試。

### 新增 Condition／Effect

1. 在 `state_rule_contract.js` 登錄類型、操作與 Editor 預設資料形狀。
2. 同步 `EDITOR/app.py` 的 `CONDITION_OPERATORS`／`EFFECT_OPERATORS` 與驗證分支。
3. 在 Runtime 實作判斷或執行分支。
4. 更新表單、錯誤訊息、雙語 Reference 與綜合測試資料。
5. 擴充 `test_contract_alignment.py`，確認前端 registry、Editor Schema 與 Runtime 都接受同一組操作。

若無法穩定資料化，應先評估是否交還原生 Content，而不是先擴張 Schema。

### 新增或重做工作區

工作區只讀寫既有契約時，可以獨立改善 UI。共用互動放在 `js/ui/`；純資料轉換放在 `js/workspaces/`；`app.js` 只保留狀態連接與 render/bind 呼叫。拆分和視覺重設應分成不同提交，方便定位回歸。

## 瀏覽器 smoke tests

安裝測試依賴與 Chromium 後執行：

```sh
npm ci
npx playwright install chromium
python3 tools/verify.py --browser
```

測試只使用 `tools/create_editor_test_unit.py` 建立的系統暫存專案，不得指向正式遊戲或 `INTEGRATION/TestGame` 的創作者資料。目前固定覆蓋 Editor 載入、Content 父子選單、Event Condition／Effect 新增刪除、Stat／Memory 類型切換、Memory clear、GOTO／REPLACE 切換、自動儲存與重新載入、關聯圖 GOTO／REPLACE／管理邊，以及瀏覽器 Console 錯誤。CI 在獨立的 Chromium job 執行這套測試。

Event 表單的純資料轉換由 `tests/js/event_editor.test.js` 驗證；Editor API 寫入後再讀回的穩定 JSON 形狀由 `tests/test_event_api_round_trip.py` 保存為 golden cases。調整表單時應先擴充這兩層，再視互動風險更新瀏覽器 smoke test。

## CSS 規則

- `css/tokens.css`：唯一的基礎色彩、尺寸與共用 token。
- `css/base.css`：reset、字體、focus 等全頁預設。
- `styles.css`：尚待漸進拆分的既有元件與工作區規則。

移動 CSS 時先維持 selector、屬性、載入順序完全相同，再以瀏覽器確認桌面、窄畫面與 reduced-motion。不可在「搬檔案」時順便調整視覺。

## 完成標準

```sh
python3 tools/verify.py
```

統一驗證會自動發現所有 production JavaScript 與 `tests/js/*.test.js`，因此新增模組後不需再手動修改 CI 指令。涉及主要 Editor 操作時使用 `--browser`；超出 smoke suite 的新互動仍要依變更範圍做實際驗證。
