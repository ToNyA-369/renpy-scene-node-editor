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
    GLOBALNODE/
      Node.json
      Options.json
      EVENTPOOL/<event_id>.json
      CONTENT/<file>.rpy
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
  "Name": "My room"
}
```

- `ID`: stable technical ID.
- `Name`: editable display name.

## Global Node

`GLOBALNODE/Node.json` has the fixed identity:

```json
{ "ID": "__global__", "Name": "GLOBAL" }
```

Name is editable; ID is not. The Global Node is absent from `scene_catalog["nodes"]`, never enters `scene_stack`, and cannot be Root or Next Node. It owns an `Options.json` with the same format as a Scene Node. Those Options render beside the current real node's Options everywhere. Global Events may use their `Action:<option_id>` Triggers and may control `CONTROLLED` targets within the `__global__` Options scope.

Global Event prepare retains both `owner_node_id = "__global__"` and `node_id = <current Stack top>`. Once uses `once:global:<event_id>`. Effects and Content belong to the Global Event, while a non-lifecycle End up resolves against the current real Stack.

## Options.json

```json
{
  "Version": 2,
  "Canvas": { "Width": 1920, "Height": 1080, "Preview Background": "" },
  "Elements": []
}
```

`Preview Background` affects only the Options canvas in the editor. An empty string means no preview image and never changes the game scene.

### Text Box

```json
{
  "ID": "actions",
  "Name": "Actions",
  "Type": "TEXTBOX",
  "Availability": "ALWAYS",
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
      "Availability": "CONTROLLED",
      "Style Override": {}
    }
  ]
}
```

### Picture

Picture shares `ID`, `Name`, `Availability`, `Layout`, `Hover`, and sound fields, and adds:

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

`Availability` is either `ALWAYS` or `CONTROLLED`. `ALWAYS` is always visible. `CONTROLLED` starts hidden, appears after an Option Effect enables it, and disappears when disabled. PICTURE and HITBOX support Element-level control. TEXTBOX supports both whole-Element and individual-Item control. An Item is visible only when both it and its parent Element are available; disabling the parent retains Item state, and an empty TEXTBOX hides automatically.

Options have no lifecycle, condition expressions, or custom Screen source. Every displayed Option is actionable. Version 1 data and omitted `Availability` values are read as `ALWAYS`; the next save normalizes the document to Version 2.

## Event

```json
{
  "ID": "open_door",
  "Name": "Open the door",
  "Group": "Normal",
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

`Group` is single-level authoring metadata used only to organize the Event Pool in the Editor. Missing or blank values normalize to the fixed `Normal` group, presented as visually ungrouped without a heading. Optional non-negative integer `Order` is also Editor-only and persists drag order; legacy Events without it retain their stable read order. Neither field participates in Trigger matching, Priority, Weight, lifecycle ordering, the graph, or Runtime execution. The drag preview updates on every pointer event while geometry checks and DOM reflow are coalesced by animation frame. Midpoint hysteresis prevents insertion jitter, the nearest scrollable ancestor supports progressive edge auto-scroll, and window-level lifecycle listeners preserve the gesture while the source moves between containers. Pointer dragging moves a live insertion gap and uses short FLIP offsets to push Event and group blocks aside. A permanent trailing gap allows placement after the bottommost group, while crossing a group boundary changes membership without a dedicated ungroup button. Grouping dwell remains armed only while the pointer is inside the candidate's current geometry, so live reflow moving it away cancels that intent. Groups collapse to a compact name and count by default, then expand on hover, keyboard focus, or drag entry. The unmarked blank space beside the name drags the whole group as one stable block and collapses it at drag start. Releasing after the group frame expands creates a group, and a one-Event group dissolves automatically. Successful drags do not produce toasts; failures remain visible.

`Content` and `Next Node` may be `null`, one string, or a positive weight map:

```json
{ "content_day": 3, "content_night": 1 }
```

An ordinary Event's `End up` may be `REDO`, `GOTO`, `REPLACE`, or `EXIT`. GOTO and REPLACE require `Next Node`; the Editor shows Node Name while JSON stores the stable Node ID. REPLACE example:

```json
{
  "End up": "REPLACE",
  "Next Node": "adjacent_scene"
}
```

`Auto:Enter` and `Auto:Exit` are lifecycle Events and omit `Weight`, `End up`, and `Next Node`:

```json
{
  "ID": "room_enter",
  "Name": "Enter room",
  "Trigger": "Auto:Enter",
  "Priority": 1,
  "Once": false,
  "Conditions": [],
  "Effects": [],
  "Content": "room_enter_presentation"
}
```

## Triggers

```text
Auto:Enter
Auto:Node
Auto:Exit
Action:<option_id>
Keyboard:<Ren'Py keysym>
Mouse:<Left|Middle|Right|WheelUp|WheelDown>
```

Mouse maps to Ren'Py keysyms: left / middle / right use `mouseup_1/2/3`; wheel up / down use `mousedown_4/5`.

- `Auto:Enter`: runs when ROOT starts or GOTO / REPLACE enters the node.
- `Auto:Node`: checked before each interaction and preserves the former Auto semantics.
- `Auto:Exit`: runs before EXIT / REPLACE removes the current node from the Stack.

Returning from a child through EXIT does not re-run the parent's `Auto:Enter`. Pushing a child through GOTO does not run the parent's `Auto:Exit`.

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

Option Element:

```json
{ "type": "option", "op": "enable", "target": "element", "node": "shop", "element": "special_actions" }
```

TEXTBOX Item:

```json
{ "type": "option", "op": "disable", "target": "item", "node": "shop", "element": "shop_actions", "item": "buy_weapon" }
```

Option Effects support `enable` and `disable` and may target only a `CONTROLLED` Option owned by the Event's Options scope: a Scene Node Event targets that same node, while a Global Event targets `__global__`. Both reject cross-scope references. Operations are idempotent. State participates in Ren'Py saves and rollback and does not reset on REDO, GOTO, REPLACE, or EXIT; a new game clears it through `scene_reset_state()`. The Editor lists only the current scope's creator-facing Element and Item Names while JSON stores stable Node, Element, and Item IDs. Referenced Elements and Items cannot be deleted.

Event Effects handle Stats, Memories, and Option Availability. Backgrounds, music, sound effects, transitions, and fades belong in Content labels using native Ren'Py syntax. Options may still select Hover Sound and Click Sound from `game/audio/`.

## Stats and Memories

`Stats.json`:

```json
{ "money": { "Name": "Money", "Group": "Resources", "Init": 0, "Min": 0, "Max": 999 } }
```

`Group` is authoring metadata; an omitted or blank value normalizes to `Normal`, presented as visually ungrouped without a heading. Optional non-negative integer `Order` is Editor-only and persists drag order. The State workspace has one Add Stat button. All Stats share one top Name / Min / Init / Max header and matching CSS Grid columns; grouped rows keep those columns aligned while adding inset space inside the group frame. Pointer dragging starts from a row's perimeter or inter-field whitespace, while inputs and the remove button remain interactive; there is no separate handle, and text selection is disabled only during the drag. The unmarked blank space beside a group name moves that whole group while preserving member order. It uses the same live insertion gap as Events. A permanent trailing gap remains available even when every Stat is grouped, so crossing a group boundary always supports moving out or in; dwelling until the frame expands creates a group. A one-Stat group dissolves automatically. Successful drags do not produce toasts. Event Stat Condition / Effect pickers still show “Group → Stat”. JSON keys, Runtime state, saves, and `scene_get_stat("money")` use the flat stable Stat ID; groups do not create nested state.

`Memories.json`:

```json
{
  "memory": { "Name": "Memory" },
  "daily": { "Name": "Daily memory" }
}
```

`memory` is required. Ordinary Once Events use `once:<event_id>`; Global Once Events use `once:global:<event_id>`.

## Event selection

`Auto:Node`, Option, Keyboard, and Mouse use the single-selection flow:

1. Merge same-Trigger Events from the current Node and Global Node; the Trigger may come from current-node or Global Options.
2. Exclude failed Conditions and completed Once Events.
3. Find the minimum Priority.
4. Choose one Event by Weight only within that Priority.
5. Apply Effects.
6. Choose and call Content.
7. Select a single or weighted GOTO / REPLACE Next Node during prepare, then validate it after Content returns and before any On Exit.
8. Resolve End up.

`Auto:Enter` and `Auto:Exit` use the lifecycle batch flow and merge Events from the current Node and Global Node:

1. Evaluate all Conditions and Once markers against one state snapshot before any Effects run.
2. Sort every matching Event by ascending Priority, then Event ID.
3. Apply each Event's Effects and call its Content in order.

Lifecycle Events do not use Weight and do not change the Scene Stack.

Global On Node participates on the Runner's next interaction iteration. If a local Event changes state and then uses GOTO, the destination On Enter runs before Global On Node is checked. A Global Event is not a synchronous hook inserted between the main Event's Content and End up.

## Scene Stack

- `REDO`: stay in the current Node and begin another iteration.
- `GOTO`: push the destination Node onto the stack.
- `REPLACE`: require an actual Stack depth greater than one and atomically replace the top: `[parent, current] -> [parent, target]`.
- `EXIT`: pop the current Node; return to its parent, or end the Runner at ROOT.

Effects run before Content. A Content label must `return` so the Runner can resolve End up.

REPLACE runs in this order: Event Effects, Event Content, destination validation, current On Exit, atomic top replacement, destination On Enter, then destination On Node / Options. The current On Exit Conditions can therefore observe state changed by the main Event's Effects and Content. The parent runs no On Enter, On Exit, On Node, or Options during the transition. A later EXIT from the destination returns to the original parent, never the replaced node.

The parent restriction uses the live Stack depth, not the configured Root Node ID. A node started as the first level with `scene_runtime_start("node_id")` therefore cannot REPLACE either, and the Runtime reports a clear error. REPLACE does not use a static Parent field and does not restrict destinations by folder.

Use native Ren'Py in lifecycle Content for presentation and audio:

```renpy
label room_enter_presentation:
    scene room with dissolve
    play music "audio/room.ogg" fadein 1.0
    return
```

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

Screens and HUDs are native Ren'Py presentation and are not stored in the Node Schema. Content explicitly shows, hides, or calls them:

```renpy
screen room_hud():
    text "Money: [scene_get_stat('money', 0)]"

label room_enter_presentation:
    show screen room_hud
    return

label room_exit_presentation:
    hide screen room_hud
    return
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
