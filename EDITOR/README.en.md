# Scene Node Editor Local Help

[繁體中文](README.md) · [Full English guide](../docs/en/USER_GUIDE.md)

This Editor is installed inside your Ren'Py project. It manages Scene Nodes, Events, Options, Content, and game state. You still author `gui.rpy`, `screens.rpy`, characters, assets, and the actual presentation in your Ren'Py project.

## Launch

Double-click this file in the project root:

```text
啟動 Scene Node 編輯器.command
```

Or launch it from a terminal:

```sh
python3 .scene-node-editor/EDITOR/app.py --project game
```

The Editor runs only on your computer. Closing the launcher's terminal window stops it.

## Shortest workflow

1. Create or select a Scene Node in Nodes.
2. Add a player-facing Text Box, Picture, or Hitbox in Options.
3. Create a Content label and write its Ren'Py presentation.
4. Connect Content and Effects with Option, Keyboard, Mouse, On Enter, On Node, or On Exit Triggers; interactive Events also define End Up.
5. Resolve reference problems in Validation, then run the game from Ren'Py.

Content includes offline Ren'Py syntax colors, line numbers, search, folding, bracket matching, official snippets, and project-aware label/asset suggestions. It is an authoring aid; Ren'Py lint and an actual game run remain the final validation.

For a complete walkthrough, read [Your First Playable Flow](../docs/en/FIRST_PROJECT.md).

## Essential concepts

- An Option emits a Trigger. Its Event decides conditions, state changes, and routing.
- Content stores a Ren'Py `label` name, not an `.rpy` filename.
- `REDO` reruns the current node, `GOTO` pushes a destination, `REPLACE` atomically swaps the stack top, and `EXIT` returns to the parent.
- The node list has a fixed, undeletable Global Node. Its Events participate from every real node; its Options render beside the current real node's Options and may use Option Triggers plus same-scope Option Effects.
- A Global Event's End up acts on the current real node. The Global Node never enters the Stack and is not available as ROOT or Next Node.
- Every visible Option is interactive and ends with the current interaction. The Runtime creates it again for a later round.
- Define screens and HUDs in `screens.rpy` or another `.rpy`, then control them from Content with native Ren'Py `show screen`, `hide screen`, or `call screen`.
- On Enter and On Exit run every matching Event ordered by Priority and Event ID. On Node preserves the former Auto single-selection behavior.
- Picture and Preview Background assets come only from `game/images/`; Options Hover Sound and Click Sound come only from `game/audio/`. Subdirectories appear as nested menus, while a selected field shows only the filename.
- Write game backgrounds, BGM, SE, transitions, and fades with native Ren'Py inside Content labels.

See the [Technical Reference](../docs/en/REFERENCE.md) for the data and Runtime contracts.

## Saving and settings

The Editor saves automatically. It also flushes pending changes before switching nodes, files, or workspaces.

Older save responses cannot overwrite newer input. Nested menus support arrow-key navigation, Enter to select, and Escape to close.

Shortcuts, autosave delay, and grid size are stored in:

```text
.scene-node-editor/settings.json
```

This is local Editor configuration, not game content.

## Files you may customize

Updates manage these paths:

```text
.scene-node-editor/EDITOR/
.scene-node-editor/AI_CONTEXT.md
.scene-node-editor/docs/
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
```

Do not place custom logic in those files. You can safely maintain your own `gui.rpy`, `screens.rpy`, other `.rpy` files, assets, and the Editor-created `DATA/`, `GLOBALNODE/`, and `SCENENODE/` content. Updates do not overwrite that creator-owned data.

When using AI assistance, ask it to read `.scene-node-editor/AI_CONTEXT.md` first. Prompt examples are available in the local [AI-Assisted Workflow](../docs/en/AI_WORKFLOW.md).

## Troubleshooting

- The game does not enter a Scene Node: confirm that `label start` calls `scene_runtime_start()`.
- Content is absent from the menu: confirm the `.rpy` is under `game/` and contains a valid `label`.
- A Screen is missing: confirm that Content uses native Ren'Py `show screen` or `call screen`, then check the Screen name.
- A Trigger does nothing: confirm the current node or Global Node has an Event with the same Trigger and keep an unconditional fallback Event when practical.
- A node was deleted accidentally: look for recoverable data in `.scene-node-trash/` at the project root.

Report issues or find the latest release: <https://github.com/ToNyA-369/renpy-scene-node-editor>
