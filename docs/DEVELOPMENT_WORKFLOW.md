# AI 開發流程

[English](DEVELOPMENT_WORKFLOW.en.md)

這份流程用來降低主對話的 token 消耗與等待時間，同時保留單一需求窗口及完整整合審查。產品架構仍以 `AGENTS.md`、`EDITOR/HANDOFF.md` 與雙語 Reference 為準。

## 模型與角色路由

主控對話負責釐清需求、架構決策、拆分、整合與交付。一般情況使用 Sol Medium；只有跨 Schema／Runtime、模糊架構決策或多次審查仍未收斂時才提高至 Sol High。

| 工作 | 建議角色 | 模型 | 原則 |
|---|---|---|---|
| 定位檔案、依賴與測試 | `explorer` | Luna Medium | 唯讀、一次回答一個明確問題 |
| 邊界清楚的實作 | `implementer` | Terra Medium | 單一 writer、獨立 branch/worktree |
| 差異與回歸審查 | `reviewer` | Terra High | 唯讀，只回報可行動問題 |
| 架構契約與最終整合 | 主控 | Sol Medium／High | 使用者只需面對這個窗口 |

預設最多兩個子代理並行。小修、緊密耦合的 UI 迭代或需要快速來回的工作由主控直接處理；只有真正獨立的工作流才平行化。完整測試留到整合完成後執行一次，實作途中先跑針對性測試。

專案設定位於 `.codex/config.toml`，角色定義位於 `.codex/agents/`。新設定通常在新的 Codex session 載入；主控模型不寫死在專案設定中，方便依任務切換 Medium／High。

## Antigravity 實作通道

Antigravity 適合規格完整、寫入邊界明確且可由測試驗收的工作。它不負責架構決策，也不能直接在主控目前的工作目錄寫入。

1. 主控先複製 `.codex/templates/implementation-brief.md`，填妥驗收標準、允許路徑與測試。
2. 為任務建立專屬 branch 及 worktree。
3. 在該 worktree 使用官方 `agy` CLI；保留 sandbox，不使用跳過權限的參數。
4. Antigravity 回傳 diff、測試結果與風險，不自行 push 或合併。
5. 主控審查差異、補做整合驗證，再統一向使用者交付。

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
5. 主控審查 contract 與 diff；高風險工作才啟用第二次唯讀審查。
6. 主控執行 `python3 tools/verify.py`；UI／Runtime 依規範增加瀏覽器或 Ren'Py 驗證。
7. 未經明確授權不 push、合併、Tag 或 Release。

這套流程的重點不是把每件事都派出去，而是讓昂貴的主控上下文只保留需求、決策、風險與整合證據。
