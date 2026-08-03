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
js/ui/choice_picker.js           shared hierarchical select interaction
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

Schema validation, Editor form, Runtime behavior, diagnostics, Reference, and tests must land together. If a behavior cannot be expressed as stable data, first consider native Content rather than expanding Schema.

### Workspace UI

Put shared interaction under `js/ui/`, pure workspace data transformations under `js/workspaces/`, and leave only state wiring plus render/bind calls in `app.js`. File extraction and visual redesign should be separate changes so regressions remain attributable.

## CSS

- `css/tokens.css`: foundational colors, dimensions, and shared tokens.
- `css/base.css`: reset, typography, and focus defaults.
- `styles.css`: existing components and workspaces still awaiting gradual extraction.

Move CSS without changing selectors, declarations, or load order first. Then verify desktop, narrow layout, and reduced motion in a browser. Do not combine file movement with a redesign.

## Definition of done

```sh
python3 tools/verify.py
```

The verifier discovers all production JavaScript and `tests/js/*.test.js` automatically. Browser interaction and Runtime behavior still require the scoped manual or Ren'Py verification described in `CONTRIBUTING.md`.
