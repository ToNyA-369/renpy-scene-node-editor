# Scene Node Editor development contract

Read `EDITOR/HANDOFF.md` and the relevant bilingual Reference/User Guide before changing behavior. This repository separates architecture contracts, Editor behavior, presentation, Ren'Py Runtime, and release work.

## Non-negotiable boundaries

- UI/UX may change presentation and interaction, but must not silently change JSON Schema, API meaning, stable IDs, stack behavior, saved-game behavior, or public Runtime APIs.
- Backgrounds, audio, transitions, and custom Screens remain native Ren'Py Content responsibilities. Options Renderer assets are the documented exception.
- `INTEGRATION/TestGame/FRAMEWORK/` is the canonical installable Runtime. Ignored sibling files are creator-owned local test data.
- Do not publish, push, tag, release, or run destructive Git operations without explicit authorization.
- Preserve unrelated worktree changes. Parallel writers must use separate worktrees.

## Agent coordination

The primary agent is the single requirements and integration owner. It may decide autonomously whether a task benefits from sub-agents; the user does not need to authorize delegation for each request. Use sub-agents only when independent workstreams are likely to improve delivery speed, coverage, or review quality. Small fixes, tightly coupled edits, and exploratory UI iteration should normally stay with the primary agent.

The primary agent remains responsible for architecture decisions, user communication, conflict resolution, integration review, complete verification, and final delivery. Sub-agents must not require the user to repeat project context. Any agents writing in parallel must use separate branches and worktrees; multiple agents must never write concurrently in the same working directory.

## Frontend module boundaries

`EDITOR/static/app.js` is the composition root. New reusable behavior belongs in a focused module and receives dependencies explicitly; do not add another large unrelated block to `app.js`.

```text
EDITOR/static/js/core/api_client.js          HTTP serialization and error classes
EDITOR/static/js/core/autosave_coordinator.js autosave ordering, retry, flush, cancellation
EDITOR/static/js/core/editor_settings.js     settings version, tabs, shortcuts, migrations
EDITOR/static/js/core/event_contract.js      Trigger and End up UI contract
EDITOR/static/js/core/state_rule_contract.js Condition and Effect UI contract
EDITOR/static/js/ui/choice_picker.js          shared hierarchical select interaction
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

Run the complete suite before handoff:

```sh
python3 tools/verify.py
```

UI or browser behavior changes also require a disposable-project browser test, including console errors and reload persistence. Runtime contract changes require the executable Runtime tests and, when available, Ren'Py lint or an actual Ren'Py run.

Update `EDITOR/HANDOFF.md` when module ownership, contracts, verification entry points, or known maintenance risks change.
