# Scene Node Editor Local Help

[繁體中文](README.md) · [Full English guide](https://github.com/ToNyA-369/renpy-scene-node-editor/blob/main/docs/en/USER_GUIDE.md)

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
4. Connect Content, Effects, and End Up in Events with an Option, Keyboard, Mouse, or Auto Trigger.
5. Resolve reference problems in Validation, then run the game from Ren'Py.

For a complete walkthrough, read [Your First Playable Flow](https://github.com/ToNyA-369/renpy-scene-node-editor/blob/main/docs/en/FIRST_PROJECT.md).

## Essential concepts

- An Option emits a Trigger. Its Event decides conditions, state changes, and routing.
- Content stores a Ren'Py `label` name, not an `.rpy` filename.
- `REDO` reruns the current node, `GOTO` enters a child node, and `EXIT` returns to the parent.
- Every visible Option is interactive and ends with the current interaction. The Runtime creates it again for a later round.
- A Scene Screen is a scene shell or HUD. Define it in `screens.rpy` or another `.rpy`, then select it on the node.

See the [Technical Reference](https://github.com/ToNyA-369/renpy-scene-node-editor/blob/main/docs/en/REFERENCE.md) for the data and Runtime contracts.

## Saving and settings

The Editor saves automatically. It also flushes pending changes before switching nodes, files, or workspaces.

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
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
```

Do not place custom logic in those files. You can safely maintain your own `gui.rpy`, `screens.rpy`, other `.rpy` files, assets, and the Editor-created `DATA/` and `SCENENODE/` content. Updates do not overwrite that creator-owned data.

When using AI assistance, ask it to read `.scene-node-editor/AI_CONTEXT.md` first. Prompt examples are available in the [AI-Assisted Workflow](https://github.com/ToNyA-369/renpy-scene-node-editor/blob/main/docs/en/AI_WORKFLOW.md).

## Troubleshooting

- The game does not enter a Scene Node: confirm that `label start` calls `scene_runtime_start()`.
- Content is absent from the menu: confirm the `.rpy` is under `game/` and contains a valid `label`.
- A Scene Screen is missing: confirm it is declared in an `.rpy` under `game/`, then refresh the Editor.
- A Trigger does nothing: confirm the current node has an Event with the same Trigger and keep an unconditional fallback Event when practical.
- A node was deleted accidentally: look for recoverable data in `.scene-node-trash/` at the project root.

Report issues or find the latest release: <https://github.com/ToNyA-369/renpy-scene-node-editor>
