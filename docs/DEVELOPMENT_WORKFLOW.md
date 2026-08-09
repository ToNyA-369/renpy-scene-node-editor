# AI 開發流程

[English](DEVELOPMENT_WORKFLOW.en.md)

這份流程用來降低主對話的 token 消耗與等待時間，同時保留單一需求窗口及完整整合審查。產品架構仍以 `AGENTS.md`、`EDITOR/HANDOFF.md` 與雙語 Reference 為準。

流程採「依風險調整重量」而不是每個需求都啟動完整代理鏈。分支、worktree、實作者與 reviewer 都是風險工具，不是固定儀式。

## 任務分級

| 等級 | 常見需求 | 預設流程 |
|---|---|---|
| 唯讀 | 問答、診斷、狀態、審查 | 檢查證據後回報，不寫入 |
| 小型 | 文案、CSS、局部 bug、單一行為 | 主控直接修改、局部測試、交付前必要驗證 |
| 中型 | 邊界清楚的功能或單一工作區／模組 | 先寫可驗收結果、維持單一 writer、補回歸測試，風險足夠時做一次唯讀審查 |
| 高風險 | Schema、Runtime、存檔、遷移或跨層行為 | 先核准設計，列出全部層級與失敗流程，再拆分真正獨立的工作流 |
| 探索型 | 視覺與互動方向仍在變動 | 先用短瀏覽器迴圈原型，方向穩定後再固化測試與文件 |

開始實作前，至少確認可觀察結果、不可改變的契約、受影響介面，以及資料／儲存失敗時的行為。優先建立可執行的驗收條件，不用以冗長 brief 取代測試。

## 模型與角色路由

主控對話負責釐清需求、架構決策、拆分、整合與交付。一般情況使用 Sol Medium；只有跨 Schema／Runtime、模糊架構決策或多次審查仍未收斂時才提高至 Sol High。

| 工作 | 建議角色 | 模型 | 原則 |
|---|---|---|---|
| 定位檔案、依賴與測試 | `explorer` | Luna Medium | 唯讀、一次回答一個明確問題 |
| 邊界清楚的實作 | `implementer` | Terra Medium | 單一 writer、獨立 branch/worktree |
| 差異與回歸審查 | `reviewer` | Terra High | 唯讀，只回報可行動問題 |
| 架構契約與最終整合 | 主控 | Sol Medium／High | 使用者只需面對這個窗口 |

預設最多兩個子代理並行。小修、緊密耦合的 UI 迭代或需要快速來回的工作由主控直接處理；只有真正獨立的工作流才平行化。完整測試留到整合完成後執行一次，實作途中先跑針對性測試。

委派依據是獨立性，不是檔案數量。工作必須有固定輸入、明確寫入範圍、單一負責人及不需頻繁架構決策的驗收方式。狀態管理、autosave／導航、探索型 UI 等緊密耦合工作預設由主控處理。

專案設定位於 `.codex/config.toml`，角色定義位於 `.codex/agents/`。新設定通常在新的 Codex session 載入；主控模型不寫死在專案設定中，方便依任務切換 Medium／High。

## Antigravity 實作通道

Antigravity 適合規格完整、寫入邊界明確且可由測試驗收的工作。它不負責架構決策，也不能直接在主控目前的工作目錄寫入。

1. 主控先複製 `.codex/templates/implementation-brief.md`，填妥驗收標準、允許路徑與測試。
2. 為任務建立專屬 branch 及 worktree。
3. 在該 worktree 使用官方 `agy` CLI；保留 sandbox，不使用跳過權限的參數。
4. Antigravity 回傳 diff、測試結果與風險，不自行 push 或合併。
5. 主控審查差異、補做整合驗證，再統一向使用者交付。

Antigravity 只執行一次主要實作與最多一次範圍明確的修正。第二輪後仍有架構缺口時，由主控接手或重寫規格，不進入無上限的補洞循環。實作端只跑局部測試；完整套件由主控在整合完成後負責。

安全的互動式起點：

```sh
agy --project "/absolute/path/to/task-worktree" --mode accept-edits --sandbox
```

先做規劃而不寫檔時：

```sh
agy --project "/absolute/path/to/task-worktree" --mode plan --sandbox
```

啟動後貼入已填妥的 implementation brief。不要使用 `--dangerously-skip-permissions`。若任務會改 Schema、公開 Runtime API、存檔格式或發布狀態，Antigravity 必須停在計畫／分析階段，交回主控取得使用者確認。

## 每個需求的標準節奏

1. 主控分類需求與風險，讀取必要規格。
2. 先用針對性探索建立最小修改面；不讓多個代理重複閱讀全專案。
3. 選擇主控直做、Codex implementer 或 Antigravity worktree 三者之一。
4. 實作端執行局部測試並提交結構化回報。
5. diff 可整合時，主控審查 contract；中高風險工作才啟用一次額外唯讀審查，避免反覆審查半成品。
6. 驗證採漏斗式：最小單元測試 → 受影響模組 → 單一路徑瀏覽器／Runtime → 整合完成後一次完整 `python3 tools/verify.py`。
7. 未經明確授權不 push、合併、Tag 或 Release。

這套流程的重點不是把每件事都派出去，而是讓昂貴的主控上下文只保留需求、決策、風險與整合證據。

交付時必須明確說明目前是「已實作、已驗證、已提交、已合併本機 main、已推送、已建立 PR、已發布」中的哪一個狀態；不能把 task branch 上的完成誤說成使用中的 main 已具備功能。
