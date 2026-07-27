# Scene Node Editor user guide

[繁體中文](../zh-TW/USER_GUIDE.md) · [English](USER_GUIDE.md) · [Home](../../README.en.md)

This guide defines the editor's scope and its seven workspaces. If you do not yet have a playable flow, start with [Build your first project](FIRST_PROJECT.md).

## Working model

```text
Input source → Trigger → Event → Effects → Content → End up
```

Input sources are Option, Keyboard, Mouse, and three Auto phases. A Trigger only describes what happened; the current Scene Node and Global Node Event Pools decide the reaction together.

## Responsibility boundary

| Editor / Runtime | Creator |
| --- | --- |
| Stores nodes, options, events, and state | Designs rules, narrative, and player experience |
| Selects Events by Trigger and Conditions | Writes Ren'Py inside Content labels |
| Applies Effects and manages the Scene Stack | Creates images, audio, fonts, and animation |
| Renders data-driven Options | Writes `gui.rpy`, `screens.rpy`, and HUDs |
| Validates references and schemas | Implements inventory, time, quests, and other custom systems |

Normal game content should not edit `game/FRAMEWORK/runtime.rpy` or `option_renderer.rpy`. The installer owns those files during updates.

## Nodes

A Scene Node is one unit of player interaction. Each node owns:

- A display Name and stable ID.
- Its own Options, Event Pool, and Content files.

ROOT is the Runtime entry node. Select another root before deleting it. A node cannot be deleted while an Event still references it as Next Node.

Nodes do not store a Screen. Define HUDs, scene shells, and other Screens in creator-owned `.rpy`, then control them from Content with native Ren'Py `show screen`, `hide screen`, or `call screen`.

### Global Node

The top of the node list contains a fixed, undeletable Global Node. It is an authoring scope for global Events and Content, not a real Scene Node:

- It never enters the Scene Stack and cannot be ROOT or a GOTO / REPLACE destination.
- It has no Options workspace, and Global Events cannot use Option Triggers.
- On Node, Keyboard, and Mouse Events merge with the current real node's same-Trigger Events before Conditions, Priority, and Weight selection.
- On Enter / On Exit join every real node's matching lifecycle queue.
- A Global Event's REDO, GOTO, REPLACE, or EXIT operates on the real Stack-top node at trigger time.
- Global Once state uses `once:global:<event_id>` and does not collide with ordinary node Once state.

Global On Node is checked on the next node-interaction iteration. If a local Event advances time and then uses GOTO, the rollover Event runs after the destination's On Enter and before its On Node; it is not a synchronous hook between the original Event's Content and End up.

## Events

An Event is the current node's reaction to a Trigger:

- `Trigger`: On Enter, On Node, On Exit, Option, Keyboard, or Mouse.
- `Priority`: lower numbers win; only the lowest matching layer is considered.
- `Weight`: relative chance among matching On Node or player-input Events at the same Priority.
- `Once`: allows one successful selection for the entire game.
- `Conditions`: decide whether the Event is a candidate.
- `Effects`: Stat or Memory changes applied when the Event runs.
- `Content`: a Ren'Py label called after Effects, optionally weighted.
- `End up`: REDO, GOTO, REPLACE, or EXIT after Content returns. GOTO and REPLACE accept one or weighted Next Node.

The UI calls the source `Option`; the technical format remains `Action:<id>`. The Event picker lists Triggers registered by the current node's Options.

Picture and Preview Background images are listed only from `game/images/`; Options Hover Sound and Click Sound are listed only from `game/audio/`. You may organize assets in subdirectories: the Editor preserves that hierarchy in the picker but shows only the filename after selection. Write game scenes, BGM, SE, transitions, and fades in Content with native Ren'Py syntax.

### Fallback Events

If all conditional Events for a Trigger can fail, add a lower-priority unconditional fallback. Otherwise the Runtime reports a missing Event after player input.

### Input sources

| UI | Stored format | Purpose |
| --- | --- | --- |
| On Enter | `Auto:Enter` | Runs every matching Event when ROOT starts or GOTO / REPLACE enters the node |
| On Node | `Auto:Node` | Preserves the old Auto single-selection behavior before each interaction |
| On Exit | `Auto:Exit` | Runs every matching Event before EXIT / REPLACE removes the current node |
| Option | `Action:<id>` | Returned by a data-driven Option |
| Keyboard | `Keyboard:<keysym>` | Listened for during the Options interaction |
| Mouse | `Mouse:<button>` | Left, middle, right, or wheel input |

Focus the Keyboard field and press a key or combination to record it.

On Enter and On Exit first test Conditions against one state snapshot, then run every match ordered by Priority and Event ID. They have no Weight, End up, or Next Node. Pushing a child through GOTO is not a parent exit, and returning from a child through EXIT is not a new parent entry. REPLACE runs the current node's On Exit and then the destination's On Enter; the parent runs no lifecycle, On Node, or Options between them.

## Options

Options are the fixed data-driven player interface. Every displayed Option is actionable. Use Events or separate Scene Nodes for conditions, availability, and alternate option sets.

The three Element types are:

- `TEXTBOX`: a vertical Item list with a visible-row limit and scrolling.
- `PICTURE`: an image button with Idle / Hover images and optional alpha hit testing.
- `HITBOX`: a transparent interaction region over the scene.

Form mode edits Name, Text, Trigger, images, and sounds. Canvas mode edits position, size, layer, Hover, colors, and visual details.

Canvas Preview Background affects only that Options document in the editor. Leaving it empty means no preview image and never changes the game scene.

Options have one Interaction lifecycle. Returning a Trigger closes the screen; REDO starts a new Runner iteration and calls it again.

## Content

Content is native `.rpy` managed for location and references by the editor. Creators still write dialogue, characters, backgrounds, audio, transitions, ATL, and custom Python inside labels.

```renpy
label content_example:
    scene room with dissolve
    play music "audio/room.ogg" fadein 1.0
    "This is a presentation label."
    return
```

Point an `Auto:Enter` Event at this label to establish the scene or music when entering a node. Use `Auto:Exit` Content for exit fades or cleanup.

A Content label should return to the Runner. Do not duplicate Event Effects or directly rewrite the Scene Stack in ordinary Content.

## State

### Stats

Stats are numbers with `Init`, `Min`, and `Max`. Conditions compare them; Effects support `set`, `+`, `-`, `*`, and `/`.

### Memory Banks

Memory Banks store tags. Conditions use `has` / `not_has`; Effects use `add` / `remove` / `clear`.

The default `Memory` bank cannot be deleted and also tracks Once Events. Custom banks do not reset daily or weekly automatically; call clear explicitly from your own time flow.

## Graph

The graph is a read-only directed view generated from GOTO / REPLACE Next Node values. GOTO is solid and REPLACE is dashed in the same color. When `Parent → A` is GOTO and `A → B` is REPLACE, a more transparent solid `Parent → B` edge shows the derived management relation. Global Event edges are marked as Contextual Transitions: their real source is the Stack top at trigger time, not a Runtime visit to the Global Node. The graph adds no Schema Parent and does not modify Events.

- Wheel or two-finger vertical movement: zoom around the pointer.
- Drag empty space: pan.
- Search: dim non-matching nodes.
- Round button: reset the view.
- Click a node: select it in the editor.

## Check Project

Before running or submitting the game, use Check Project to verify:

- JSON and Schema validity.
- Stat, Memory, Content, and Next Node references.
- ROOT and Runtime entry configuration.

A clean check does not prove game-design correctness. Playtest Conditions, weights, and narrative outcomes.

## Custom Ren'Py interfaces

Use `gui.rpy` for global dimensions, fonts, and style variables. Use `screens.rpy` or another creator-owned `.rpy` for Screen structure. The editor neither scans nor stores Screen references; native Ren'Py in Content decides when to show or hide them.

Implement systems that are not data-driven by the editor—such as inventory, calendars, or maps—in creator-owned `.rpy`, then connect them through Content, Stats, Memories, or public Runtime APIs. Do not hide them inside the Options renderer.

## Saving, updating, and recovery

- Autosave is enabled by default. Older save responses cannot overwrite newer edits, and the current pending write finishes before node or tab switches.
- Nested menus support Up/Down navigation, Right to enter a submenu, Left to return, Enter to select, and Escape to close.
- Shortcuts and editor settings live in `.scene-node-editor/settings.json` at the project root.
- Re-running the installer updates only managed Editor / Runtime files.
- Deleted nodes move to `.scene-node-trash/`, outside Ren'Py's game scan.

For data formats and public Runtime APIs, continue with the [Reference](REFERENCE.md).
