# Scene Node Editor technical reference

[繁體中文](../zh-TW/REFERENCE.md) · [English](REFERENCE.md) · [Home](../../EDITOR/README.en.md)

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
      TEXTBOX_PROFILES/<profile_id>.json
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
  "Name": "My room",
  "Group": "Chapter One",
  "Order": 2,
  "Content Order": ["room_enter", "room_options"]
}
```

- `ID`: stable technical ID.
- `Name`: editable display name.
- `Group`: optional single-level Editor group name; missing or blank values normalize to `Normal`.
- `Order`: optional non-negative integer storing Scene Node list drag order only.
- `Content Order`: optional string array storing the Content-file list order for this authoring scope only.

`Group`, Scene Node `Order`, and Content `Content Order` are Editor-only metadata. Legacy data without them uses the existing stable scan order and writes metadata only after the first drag. Scene Node groups reuse the Event Pool's dwell-to-group, boundary-crossing membership, whole-group reorder, and singleton-dissolution behavior. A selected member keeps its group open; selecting an outside Node contracts that group along the reverse opening path and suppresses hover reopening until the contraction finishes and the pointer leaves. After a group is dropped and saved, it expands from its dragged heading height only when it contains the selected Node. The Global Node remains outside this flow. None participates in ROOT, the Stack, Event selection, graph layout, or Runtime.

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
  "Version": 3,
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
  "Appearance": {
    "Profile": "glass",
    "Features": {
      "hover_accent": true,
      "text_shadow": false,
      "staggered_entrance": true
    },
    "Style Overrides": { "Text Size": 34 }
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

`Appearance` is optional in Version 3. `Profile` references the stable ID of `DATA/TEXTBOX_PROFILES/<profile_id>.json`; `Features` overrides only whether a profile feature is enabled; and `Style Overrides` stores only values that differ for this Text Box. Resolution order is fixed: defaults → profile → Text Box overrides → Item `Style Override`. Without a Profile, the existing inline `Style` remains authoritative. A missing or invalid Profile also falls back to `Style` and produces a project-validation warning.

Appearance profiles are creator-owned, project-wide data. Each file has this format:

```json
{
  "Version": 1,
  "ID": "glass",
  "Name": "Glass",
  "Order": 0,
  "Style": {
    "Background": "#102030cc",
    "Item Background": "#203040dd",
    "Text Color": "#ffffff",
    "Text Size": 30,
    "Text Align": 0.5
  },
  "Features": {
    "hover_accent": { "Enabled": true, "Color": "#5c7265", "Width": 6 },
    "hover_text_color": { "Enabled": false, "Color": "#ffffff" },
    "item_border": { "Enabled": false, "Color": "#ffffff33", "Width": 1 },
    "text_shadow": { "Enabled": false, "Color": "#00000088", "Size": 2, "X": 0, "Y": 2 },
    "text_outline": { "Enabled": false, "Color": "#000000cc", "Size": 1 },
    "staggered_entrance": { "Enabled": true, "Distance": 18, "Delay": 0.04, "Duration": 0.22 }
  }
}
```

The optional non-negative `Order` on an appearance profile controls only the profile manager's list order. Runtime ignores it while resolving appearance.

The six features provide a hover-side accent, hover text color, Item border, text shadow, text outline, and staggered item entrance whenever an Options interaction opens. Newly introduced features default to disabled when absent from an older profile. Editor and Runtime consume the same parameters. Profile ID and filename must match, and referenced profiles cannot be deleted. The Installer creates only the empty directory and never overwrites its files.

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

Options have no lifecycle, condition expressions, or custom Screen source. Every displayed Option is actionable. Version 1 data and omitted `Availability` values are read as `ALWAYS`; Version 1 and 2 documents normalize to Version 3 on their next save without changing unprofiled presentation.

`Elements` and TEXTBOX `Items` are ordered arrays. Pointer dragging from row whitespace reorders the existing arrays directly and adds no Group or Order field. The Runtime merges the current node and Global Options, then renders them from smaller to larger `Z Order`; a larger value is visually topmost and receives overlapping pointer interaction first. Equal `Z Order` values preserve stable scope and Element-array order, with the later array entry on top. When PICTURE Alpha Hit Test is enabled, transparent image pixels do not block interaction with a lower layer. Item array order determines display and staggered entrance order.

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

`Priority` must be an integer from 0 through 9; a missing value defaults to 5 for a new Event. The Runtime still selects only the lowest matching layer, or runs lifecycle Events in ascending numeric order.

`Group` is single-level authoring metadata used only to organize the Event Pool in the Editor. Missing or blank values normalize to the fixed `Normal` group, presented as visually ungrouped without a heading. Optional non-negative integer `Order` is also Editor-only and persists drag order; legacy Events without it retain their stable read order. Neither field participates in Trigger matching, Priority, Weight, lifecycle ordering, the graph, or Runtime execution. The drag preview updates on every pointer event while geometry checks and DOM reflow are coalesced by animation frame. Midpoint hysteresis prevents insertion jitter, the nearest scrollable ancestor supports progressive edge auto-scroll, and window-level lifecycle listeners preserve the gesture while the source moves between containers. Pointer dragging moves a live insertion gap and uses short FLIP offsets to push Event and group blocks aside. A permanent trailing gap allows placement after the bottommost group, while crossing a group boundary changes membership without a dedicated ungroup button. Grouping dwell remains armed for 500ms only while the pointer is inside the candidate's current geometry; an ungrouped candidate opens a 48px group reservation below itself, while live reflow moving it away cancels that intent. Groups collapse to a compact name and count by default, then expand on hover, keyboard focus, drag entry, or while an internal Event is selected. Selecting an outside Event restores the pre-redraw expanded geometry and contracts it over the same 220ms curve used for opening; hover remains disarmed until the contraction finishes and the pointer leaves. An internal reorder keeps the group open until pointerleave. The unmarked blank space beside the name drags the whole group as one stable block: its floating preview contracts over 220ms, and after saving only a group containing the selected Event expands from that heading height at its new position. Releasing after the reservation expands creates a group, and a one-Event group dissolves automatically. Successful drags do not produce toasts; failures remain visible.

`Content` and `Next Node` may be `null`, one string, or a positive weight map:

```json
{ "content_day": 3, "content_night": 1 }
```

`Conditions` and `Effects` are ordered arrays. Each Condition may carry `clause: <string|null>`: Conditions sharing one non-empty clause must all pass (AND), while different clauses and independent `null` Conditions are alternative branches (OR). Legacy data with no `clause` field keeps its original all-AND meaning and normalizes into one `and_1` group when saved by the Editor. The Editor presents AND as a frame and OR between groups or independent Conditions; Conditions can be dragged in, out, and reordered, and a one-member AND group does not dissolve automatically. Effects remain directly reorderable and execute in array order after Content returns. Weight objects remain probability maps and are not drag-sortable.

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

Operators: `has`, `not_has`. For example, `(money >= 10 AND member) OR hour >= 18` is stored as:

```json
[
  { "type": "stat", "id": "money", "op": ">=", "value": 10, "clause": "and_1" },
  { "type": "memory", "bank": "memory", "id": "member", "op": "has", "clause": "and_1" },
  { "type": "stat", "id": "hour", "op": ">=", "value": 18, "clause": null }
]
```

An empty Conditions array remains unconditional. Condition logic is a single OR-of-AND layer and does not support nested groups.

### Numeric values (Event Version 2)

Stat Conditions and Effects accept these numeric values:

```json
12
{ "type": "stat", "id": "money" }
{ "type": "calc", "op": "*", "left": { "type": "stat", "id": "price" }, "right": 3 }
```

Each numeric field permits **at most one** arithmetic operator: `+`, `-`, `*`, `/`, `%`. Both operands must be finite JSON numbers (not strings or booleans) or flat Stat references. Nested calculations, code, functions, and parentheses are not supported. Division preserves fractions; modulo follows Python semantics (the remainder has the divisor's sign). No intermediate value is clamped.

A Condition's left value is normally its existing `id` Stat. Use `left` instead of `id` to compare a constant or calculation. `value` is the right value; each side has its own one-operation limit. Comparison operators and AND/OR clauses do not count as arithmetic:

```json
{ "type": "stat", "left": { "type": "calc", "op": "+", "left": { "type": "stat", "id": "attack" }, "right": 5 }, "op": ">=", "value": { "type": "stat", "id": "defense" }, "clause": "and_1" }
```

An Effect always writes its `id` Stat. Its existing operation remains separate from the value calculation; for example, `money -= price * quantity` is:

```json
{ "type": "stat", "id": "money", "op": "-", "value": { "type": "calc", "op": "*", "left": { "type": "stat", "id": "price" }, "right": { "type": "stat", "id": "quantity" } } }
```

Conditions only read state, including lifecycle candidate snapshots. Effects evaluate their values immediately before each ordered write after Content returns, so later Effects observe earlier writes. Only the target's final result is clamped to Min/Max. Literal zero divisors are rejected on save; dynamic zero divisors, missing Stat references, and non-finite results raise Runtime errors identifying the Event. A failing Effect does not write its target; earlier Effects and the Once marker are not rolled back automatically. Validation checks Stat references on both sides and in Effects, including Global Events.

The Editor promotes an Event to `Version: 2` when it saves structured numeric values or a custom left value. Untouched files and numeric-only legacy shapes remain compatible; absent Version means 1, existing Version 2 stays 2. No saved-state layout changes are needed. **Update the project's Editor and FRAMEWORK together before using this feature; older Runtimes do not understand these objects.** New Runtime rejects unknown Event versions. The public `scene_change_stat()` API still accepts an already computed number; expression evaluation is internal, not a new scripting API.

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

Memory Banks remain a JSON object. The Editor uses object-key insertion order to preserve the dragged presentation order and adds no schema field. This order does not affect Runtime lookup, Once keys, public APIs, or Ren'Py save semantics.

## Event selection

`Auto:Node`, Option, Keyboard, and Mouse use the single-selection flow:

1. Merge same-Trigger Events from the current Node and Global Node; the Trigger may come from current-node or Global Options.
2. Exclude failed Conditions and completed Once Events.
3. Find the minimum Priority.
4. Choose one Event by Weight only within that Priority.
5. Choose and call Content.
6. After Content returns, record Once and apply Effects.
7. Select a single or weighted GOTO / REPLACE Next Node during prepare, then validate it after Content returns and before any On Exit.
8. Resolve End up.

`Auto:Enter` and `Auto:Exit` use the lifecycle batch flow and merge Events from the current Node and Global Node:

1. Evaluate all Conditions and Once markers against one state snapshot before any Effects run.
2. Sort every matching Event by ascending Priority, then Event ID.
3. Call each Event's Content in order, then record Once and apply that Event's Effects after its Content returns.

Lifecycle Events do not use Weight and do not change the Scene Stack.

Global On Node participates on the Runner's next interaction iteration. If a local Event changes state and then uses GOTO, the destination On Enter runs before Global On Node is checked. A Global Event is not a synchronous hook inserted between the main Event's Content and End up.

## Scene Stack

- `REDO`: stay in the current Node and begin another iteration.
- `GOTO`: push the destination Node onto the stack.
- `REPLACE`: require an actual Stack depth greater than one and atomically replace the top: `[parent, current] -> [parent, target]`.
- `EXIT`: pop the current Node; return to its parent, or end the Runner at ROOT.

Content runs before Effects. A Content label must `return`; only then does the Runtime record Once, apply Effects, and resolve End up.

REPLACE runs in this order: Event Content, Once / Effects, destination validation, current On Exit, atomic top replacement, destination On Enter, then destination On Node / Options. The current On Exit Conditions can therefore observe state changed by the main Event's Effects and Content. The parent runs no On Enter, On Exit, On Node, or Options during the transition. A later EXIT from the destination returns to the original parent, never the replaced node.

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
$ final_value = scene_change_stat("money", "+", 10)
$ node_id = scene_current_node_id()
$ node_name = scene_current_node_name("Unknown")
$ scene_memory_has("memory", "has_key")
$ tags = scene_memory_tags("quests")
$ scene_memory_add("memory", "has_key")
$ scene_memory_remove("memory", "has_key")
$ scene_memory_clear("daily")
```

Public APIs are bridges for native Content, Screen Actions, HUDs, and creator-owned `.rpy` systems, not a second Event system. Prefer Event Effects whenever they can express a Stat or Memory change, so mutations stay visible, ordered, and inspectable in the Editor. Display-time Screen expressions should call query APIs only; do not mutate state from text, ATL, or rendering expressions that Ren'Py may evaluate repeatedly.

`scene_change_stat()` shares the Stat Effect operations `set`, `+`, `-`, `*`, and `/`. It rejects unknown IDs, booleans, non-finite numbers, unsupported operations, and division by zero; clamps the result to the Stat Min / Max; and returns the final value. Every failure is atomic. When Content and its Event Effects change the same Stat, the Content API call happens first, then Effects run from top to bottom after Content returns.

`scene_current_node_id()` returns `None` before the Runner starts or after its first-level EXIT. `scene_current_node_name(default)` returns the default in those states, otherwise the creator-facing Name or the stable ID when Name is missing. Neither helper can mutate the Stack. `scene_memory_tags()` validates the bank and returns an insertion-ordered tuple snapshot that cannot mutate Runtime state.

Do not call other internal `scene_*` helpers or directly mutate `scene_stats`, `scene_memories`, `scene_stack`, or `scene_catalog` from game content.

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
.scene-node-editor/docs/zh-TW/*.md
.scene-node-editor/docs/en/*.md
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
啟動 Scene Node 編輯器.command
```

It must not overwrite `DATA/`, `SCENENODE/`, creator-owned `.rpy`, or assets.
