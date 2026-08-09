# Scene Node Editor development contract

Read `EDITOR/HANDOFF.md` and the relevant bilingual Reference/User Guide before changing behavior. This repository separates architecture contracts, Editor behavior, presentation, Ren'Py Runtime, and release work.

## Non-negotiable boundaries

- UI/UX may change presentation and interaction, but must not silently change JSON Schema, API meaning, stable IDs, stack behavior, saved-game behavior, or public Runtime APIs.
- Backgrounds, audio, transitions, and custom Screens remain native Ren'Py Content responsibilities. Options Renderer assets are the documented exception.
- `INTEGRATION/TestGame/FRAMEWORK/` is the canonical installable Runtime. Ignored sibling files are creator-owned local test data.
- Do not publish, push, tag, release, or run destructive Git operations without explicit authorization.
- Preserve unrelated worktree changes. Parallel writers must use separate worktrees.

## Workflow calibration

Use the smallest process that is sufficient for the task. Classify the request before choosing branches, agents, reviews, or verification:

| Tier | Typical work | Default process |
|---|---|---|
| Read-only | questions, diagnosis, status, review | inspect and report evidence; do not mutate |
| Small | copy, CSS, focused bug, one local behavior | primary edits directly, runs focused checks, then the required handoff verification |
| Medium | bounded feature or one workspace/module | define acceptance criteria, use one writer, add regression coverage, request one read-only review when risk justifies it |
| High | Schema, Runtime, saved data, migration, or cross-layer behavior | approve the design first, enumerate every affected surface, use isolated workstreams only where independent, and perform contract review |
| Exploratory | visual or interaction direction is still changing | prototype and verify in short browser loops; formalize tests and documentation after the direction stabilizes |

Before implementation, state the observable outcome, invariants that must not change, affected surfaces, and important failure paths. Prefer an executable acceptance check over a long prose brief. A branch or extra worktree is required for parallel/external writers, not for every primary-agent edit.

## Agent coordination

The primary agent is the single requirements and integration owner. It may decide autonomously whether a task benefits from sub-agents; the user does not need to authorize delegation for each request. Use sub-agents only when independent workstreams are likely to improve delivery speed, coverage, or review quality. Small fixes, tightly coupled edits, and exploratory UI iteration should normally stay with the primary agent.

The primary agent remains responsible for architecture decisions, user communication, conflict resolution, integration review, complete verification, and final delivery. Sub-agents must not require the user to repeat project context. Any agents writing in parallel must use separate branches and worktrees; multiple agents must never write concurrently in the same working directory.

Delegate by independence, not by file count. A delegated task must have one clear owner, a fixed write boundary, stable inputs, and acceptance checks that can run without frequent architecture decisions. Keep tightly coupled state, autosave/navigation, exploratory UI, and other rapidly changing work with the primary agent.

Project-local agent roles live in `.codex/agents/`. Route work by uncertainty rather than by file count:

- `explorer`: fast, read-only repository mapping for a bounded question.
- `implementer`: one well-specified implementation in one branch/worktree.
- `reviewer`: read-only contract, regression, and test-gap review.

The primary agent should start with targeted inspection and tests, then run the complete suite once the integrated change is ready. Do not dispatch multiple agents to rediscover the same context. Reviewers should inspect a diff that is ready for integration rather than repeatedly reviewing partial implementations.

External implementation agents, including Antigravity, must receive `.codex/templates/implementation-brief.md`, work in a dedicated branch/worktree, run focused checks only unless the brief says otherwise, and return a diff plus test evidence for primary-agent review. Allow at most one main implementation pass and one bounded correction pass. If architectural gaps remain after that, the primary agent takes over or respecifies the task instead of continuing an open-ended repair loop.

## Frontend module boundaries

`EDITOR/static/app.js` is the composition root. New reusable behavior belongs in a focused module and receives dependencies explicitly; do not add another large unrelated block to `app.js`.

```text
EDITOR/static/js/core/api_client.js          HTTP serialization and error classes
EDITOR/static/js/core/autosave_coordinator.js autosave ordering, retry, flush, cancellation
EDITOR/static/js/core/editor_settings.js     settings version, tabs, shortcuts, migrations
EDITOR/static/js/core/event_contract.js      Trigger and End up UI contract
EDITOR/static/js/core/state_rule_contract.js Condition and Effect UI contract
EDITOR/static/js/ui/choice_picker.js          shared hierarchical select interaction
EDITOR/static/js/workspaces/event_editor.js   Event rules, choices, DOM serialization
EDITOR/static/js/workspaces/graph_model.js    graph relationships, layout, edge paths
EDITOR/static/app.js                          state composition, rendering, API orchestration
```

Scripts are loaded in dependency order by `EDITOR/static/index.html`. Modules expose a single named namespace and must remain directly testable with Node without adding a bundler.

CSS tokens and browser-wide defaults live in `EDITOR/static/css/tokens.css` and `EDITOR/static/css/base.css`. Workspace/component extraction is gradual: move rules without redesigning them, preserve stylesheet order, and verify computed behavior in a browser.

## Where to extend a feature

| Change | Required surfaces |
|---|---|
| Trigger source | `event_contract.js`, Editor API validation, Runtime input/candidate handling, Options Renderer when input binding is involved, contract tests, Reference |
| Event End up | `event_contract.js`, Editor form/API validation, Runtime stack execution, graph/reference validation, comprehensive test unit, Reference |
| Condition or Effect | Editor API schema, Event form, Runtime evaluator/executor, validation messages, fixtures/tests, Reference |
| Workspace UI | focused UI/workspace module, `app.js` composition only, matching CSS boundary, browser interaction test |
| Project data format | approved design first, schema version/migration plan, Editor, Runtime, Installer, golden fixtures, bilingual docs |
| Native Ren'Py presentation | Content examples/docs; do not create a new Editor schema without approved architecture work |

If a feature crosses rows, treat it as a cross-layer change and update every required surface in one task. Stable JSON values and user-facing names are separate: UI displays creator-facing names while saved data keeps stable IDs.

## Verification

Use a verification funnel while iterating:

1. Run the smallest unit or contract test that covers the edit.
2. Run the affected module/workspace tests.
3. For UI changes, run the single relevant browser path during iteration.
4. Once the integrated diff is ready, run the complete required suite once.
5. After a failure, rerun the failed scope first; repeat the complete suite only for final handoff when needed.

Run the complete suite before handoff:

```sh
python3 tools/verify.py
```

UI or browser behavior changes also require a disposable-project browser test, including console errors and reload persistence. Runtime contract changes require the executable Runtime tests and, when available, Ren'Py lint or an actual Ren'Py run.

Update `EDITOR/HANDOFF.md` when module ownership, contracts, verification entry points, or known maintenance risks change.

At handoff, name the exact delivery state: implemented, verified, committed, locally merged, pushed, PR opened, or released. Never imply that a change is present on `main` or GitHub when it exists only in a task branch/worktree.
