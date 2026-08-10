# Maintenance and extension guide

[繁體中文](MAINTENANCE.md)

This document answers where a feature starts and which surfaces must change together. The bilingual Reference remains authoritative for game architecture and data semantics.

## Frontend layers

`EDITOR/static/app.js` is the composition root rather than the only home for logic:

```text
js/core/api_client.js           API requests and error classification
js/core/autosave_coordinator.js autosave ordering
js/core/editor_settings.js      tabs, shortcuts, settings versions and migrations
js/core/event_contract.js       Editor Trigger and End up contract
js/core/state_rule_contract.js  Editor Condition and Effect contract
js/ui/choice_picker.js           shared hierarchical select interaction
js/workspaces/event_editor.js    Event rules, weighted choices, and DOM serialization
js/workspaces/state_editor.js    Stat grouping and hierarchical picker data
js/workspaces/graph_model.js     graph relationships, layout and paths
app.js                           state composition, rendering and module coordination
```

A new module must have one describable responsibility, receive dependencies explicitly instead of reading hidden `app.js` globals, and expose pure logic to `node:test` where practical. The project intentionally uses native browser scripts with named namespaces and no bundler or third-party frontend framework. `index.html` is the only script-order entry point.

## Common extension paths

### Trigger source

1. Register the Editor mode and display name in `event_contract.js`.
2. Validate the saved value in `EDITOR/app.py`.
3. Implement Runtime candidate/input conversion.
4. Check `option_renderer.rpy` when physical input binding is involved.
5. Add JavaScript contract, Python Schema, and Runtime tests.
6. Update both Reference/User Guide languages.

### End up mode

1. Register it in `END_UP_CHOICES`; update `endUpUsesNextNode()` when it requires a target.
2. Update Editor API validation, references, and deletion protection.
3. Define atomic Runtime stack and lifecycle order.
4. Update the graph model and tooltip.
5. Test single/weighted targets, error timing, and all existing End up modes.

### Condition or Effect

1. Register the type, operations, and default Editor data shape in `state_rule_contract.js`.
2. Keep the `CONDITION_OPERATORS` / `EFFECT_OPERATORS` registries and validation branches in `EDITOR/app.py` aligned.
3. Implement the Runtime predicate or execution branch.
4. Update the form, diagnostics, bilingual Reference, and comprehensive fixtures.
5. Extend `test_contract_alignment.py` so the frontend registry, Editor Schema, and Runtime accept the same operations.

If a behavior cannot be expressed as stable data, first consider native Content rather than expanding Schema.

### Workspace UI

Put shared interaction under `js/ui/`, pure workspace data transformations under `js/workspaces/`, and leave only state wiring plus render/bind calls in `app.js`. File extraction and visual redesign should be separate changes so regressions remain attributable.

## Browser smoke tests

After installing the test dependency and Chromium, run:

```sh
npm ci
npx playwright install chromium
python3 tools/verify.py --browser
```

The suite creates only system-temporary projects through `tools/create_editor_test_unit.py`; it must never target a real game or creator data under `INTEGRATION/TestGame`. Fixed coverage includes Editor startup, the nested Content picker, Event Condition / Effect add and remove operations, Global Options and same-scope Effects, Stat / Memory type switches, Memory clear, GOTO / REPLACE switches, autosave plus reload persistence, omission of GLOBAL from the graph, opaque nodes, deterministic Stack depth, staged ROOT-first entrance, deterministic near-anchor idle motion with stable hit targets, no background bands or legend, same-depth GOTO local progression, REPLACE parity lanes, stable branch swimlanes, the detached region, primary-tree selection for multiple parents plus cross routes, center-to-center paths with surface-touching arrowheads, inverse arrow/name zoom behavior, complete-graph fitting and unbounded panning, the absence of inline edge text, temporary node dragging and structural-slot return, reciprocal REPLACE, GOTO cycles, focus dimming, chained management edges, and browser Console errors. CI runs this suite in a separate Chromium job.

Graph-model tests must also protect the local-physics boundary: only real GOTO / REPLACE links may form weak springs, only nearby anchor pairs may repel, MANAGEMENT must not participate, and unpinned visual displacement must remain within 7 graph units. Drag tests must separately verify that the pinned node remains 1:1, its actual displacement enters connected springs, and it dynamically repels any node approached during the gesture.

`tests/js/event_editor.test.js` covers pure Event form transformations. `tests/test_event_api_round_trip.py` preserves stable JSON shapes as golden cases after an Editor API write and read. Extend these two layers before changing the browser smoke suite when form behavior evolves.

## CSS

- `css/tokens.css`: foundational colors, dimensions, and shared tokens.
- `css/base.css`: reset, typography, and focus defaults.
- `styles.css`: existing components and workspaces still awaiting gradual extraction.

Move CSS without changing selectors, declarations, or load order first. Then verify desktop, narrow layout, and reduced motion in a browser. Do not combine file movement with a redesign.

## Definition of done

```sh
python3 tools/verify.py
```

The verifier discovers all production JavaScript and `tests/js/*.test.js` automatically. Use `--browser` for critical Editor interactions; new interaction surfaces beyond the smoke suite still require focused practical verification.
