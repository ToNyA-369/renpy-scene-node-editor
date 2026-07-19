# Scene Node Editor technical reference

[繁體中文](../zh-TW/REFERENCE.md) · [English](REFERENCE.md) · [Home](../../README.en.md)

This document defines the current public-alpha data and Runtime contracts. For normal operation, see the [User guide](USER_GUIDE.md).

## Project structure

```text
<RenPy Project>/
  .scene-node-editor/             Editor, settings, and install metadata
  啟動 Scene Node 編輯器.command
  game/
    FRAMEWORK/                    Installer-managed Runtime
    DATA/
      SceneProject.json
      Stats.json
      Memories.json
    SCENENODE/
      <node_path>/
        Node.json
        Options.json
        EVENTPOOL/<event_id>.json
        CONTENT/<file>.rpy
```

`gui.rpy`, `screens.rpy`, other creator-owned `.rpy`, and assets are not framework-managed files.

## SceneProject.json

```json
{ "Version": 1, "Root Node": "root" }
```

`Root Node` is the default Runtime entry. `scene_runtime_start("node_id")` may override it explicitly.

## Node.json

```json
{
  "ID": "room",
  "Name": "My room",
  "Background": "images/room.webp",
  "Screen": "room_hud"
}
```

- `ID`: stable technical ID.
- `Name`: editable display name.
- `Background`: a `game/images/` path, registered Ren'Py image name, or empty string.
- `Screen`: a parameterless Screen name or empty string.

## Options.json

```json
{
  "Version": 1,
  "Canvas": { "Width": 1920, "Height": 1080, "Preview Background": "" },
  "Elements": []
}
```

An empty Preview Background inherits the Node Background and affects only the editor preview.

### Text Box

```json
{
  "ID": "actions",
  "Name": "Actions",
  "Type": "TEXTBOX",
  "Layout": { "X": 600, "Y": 300, "Width": 720, "Height": 400, "Z Order": 10 },
  "List": {
    "Max Visible Items": 4,
    "Item Height": 72,
    "Item Spacing": 12,
    "Padding": 16,
    "Show Scrollbar": true
  },
  "Style": {
    "Background": "#0b1118e8",
    "Item Background": "#20302a",
    "Text Color": "#ffffff",
    "Text Size": 30,
    "Text Align": 0.5
  },
  "Hover": { "Enabled": true, "Color": "#ffffff18" },
  "Hover Sound": "",
  "Click Sound": "",
  "Items": [
    {
      "ID": "continue",
      "Name": "Continue",
      "Text": "Continue",
      "Trigger": "Action:continue",
      "Style Override": {}
    }
  ]
}
```

### Picture

Picture shares `ID`, `Name`, `Layout`, `Hover`, and sound fields, and adds:

```json
{
  "Type": "PICTURE",
  "Trigger": "Action:picture",
  "Picture": {
    "Idle": "images/button.png",
    "Hover": "images/button_hover.png",
    "Fit": "CONTAIN",
    "Keep Aspect": true,
    "Opacity": 1,
    "Tint": "#ffffff",
    "Alpha Hit Test": false
  }
}
```

### Hitbox

```json
{
  "Type": "HITBOX",
  "Trigger": "Action:door",
  "Hitbox": { "Editor Color": "#28a47d", "Editor Opacity": 0.24 }
}
```

Options have no lifecycle, per-item visibility rules, or custom Screen source. Every displayed Option is actionable.

## Event

```json
{
  "ID": "open_door",
  "Name": "Open the door",
  "Trigger": "Action:open_door",
  "Priority": 3,
  "Weight": 1,
  "Once": false,
  "Conditions": [],
  "Effects": [],
  "Content": "content_open_door",
  "End up": "GOTO",
  "Next Node": "hall"
}
```

`Content` and `Next Node` may be `null`, one string, or a positive weight map:

```json
{ "content_day": 3, "content_night": 1 }
```

## Triggers

```text
Auto
Action:<option_id>
Keyboard:<Ren'Py keysym>
Mouse:<Left|Middle|Right|WheelUp|WheelDown>
```

Mouse maps to Ren'Py keysyms: left / middle / right use `mouseup_1/2/3`; wheel up / down use `mousedown_4/5`.

## Conditions

Stat:

```json
{ "type": "stat", "id": "money", "op": ">=", "value": 10 }
```

Operators: `>`, `>=`, `<`, `<=`, `==`, `!=`.

Memory:

```json
{ "type": "memory", "bank": "memory", "id": "has_key", "op": "has" }
```

Operators: `has`, `not_has`. Every Condition on an Event must pass.

## Effects

Stat:

```json
{ "type": "stat", "id": "money", "op": "-", "value": 10 }
```

Operators: `set`, `+`, `-`, `*`, `/`. Results are clamped to Stat Min / Max.

Memory:

```json
{ "type": "memory", "bank": "memory", "id": "has_key", "op": "add" }
```

Operators: `add`, `remove`, `clear`; clear does not use `id`.

Audio:

```json
{ "type": "bgm", "id": "audio/theme.ogg", "op": "play", "persistent": false }
```

Types are `bgm` and `se`; operations are `play` and `stop`. Non-persistent audio is released when its node exits.

## Stats and Memories

`Stats.json`:

```json
{ "money": { "Name": "Money", "Init": 0, "Min": 0, "Max": 999 } }
```

`Memories.json`:

```json
{
  "memory": { "Name": "Memory" },
  "daily": { "Name": "Daily memory" }
}
```

`memory` is required. The Runtime records Once Events as `once:<event_id>`.

## Event selection

1. Collect Events in the current Node with the same Trigger.
2. Exclude failed Conditions and completed Once Events.
3. Find the minimum Priority.
4. Choose one Event by Weight only within that Priority.
5. Apply Effects.
6. Choose and call Content.
7. Resolve End up.

## Scene Stack

- `REDO`: stay in the current Node and begin another iteration.
- `GOTO`: push the destination Node onto the stack.
- `EXIT`: pop the current Node; return to its parent, or end the Runner at ROOT.

Effects run before Content. A Content label must `return` so the Runner can resolve End up.

## Public Runtime entry points

```renpy
call scene_runtime_start()
call scene_runtime_start("node_id")
```

Creator-owned Ren'Py may use:

```renpy
$ value = scene_get_stat("money", 0)
$ scene_memory_has("memory", "has_key")
$ scene_memory_add("memory", "has_key")
$ scene_memory_remove("memory", "has_key")
$ scene_memory_clear("daily")
```

Do not call other internal `scene_*` helpers from game content.

## Ren'Py Screen

The Node `Screen` displays a scene shell or HUD and does not wait for a return value. It must be parameterless:

```renpy
screen room_hud():
    text "Money: [scene_get_stat('money', 0)]"
```

Player input still comes from data-driven Options, Keyboard, or Mouse Triggers.

## Save and update contract

The installer may update:

```text
.scene-node-editor/EDITOR/
.scene-node-editor/AI_CONTEXT.md
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
啟動 Scene Node 編輯器.command
```

It must not overwrite `DATA/`, `SCENENODE/`, creator-owned `.rpy`, or assets.
