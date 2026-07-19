# Scene Node Editor user guide

[繁體中文](../zh-TW/USER_GUIDE.md) · [English](USER_GUIDE.md) · [Home](../../README.en.md)

This guide defines the editor's scope and its seven workspaces. If you do not yet have a playable flow, start with [Build your first project](FIRST_PROJECT.md).

## Working model

```text
Input source → Trigger → Event → Effects → Content → End up
```

Input sources are Option, Keyboard, Mouse, and Auto. A Trigger only describes what happened; the current Scene Node's Event Pool decides the reaction.

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
- A Background from `game/images/`, or `None`.
- An optional parameterless Scene Screen.
- Its own Options, Event Pool, and Content files.

ROOT is the Runtime entry node. Select another root before deleting it. A node cannot be deleted while an Event still references it as Next Node.

Scene Screen is appropriate for a HUD or scene shell. It does not select Events, execute GOTO, or replace the Options renderer.

## Events

An Event is the current node's reaction to a Trigger:

- `Trigger`: Auto, Option, Keyboard, or Mouse.
- `Priority`: lower numbers win; only the lowest matching layer is considered.
- `Weight`: relative chance among matching Events at the same Priority.
- `Once`: allows one successful selection for the entire game.
- `Conditions`: decide whether the Event is a candidate.
- `Effects`: state or audio changes applied after selection.
- `Content`: a Ren'Py label called after Effects, optionally weighted.
- `End up`: REDO, GOTO, or EXIT after Content returns.

The UI calls the source `Option`; the technical format remains `Action:<id>`. The Event picker lists Triggers registered by the current node's Options.

### Fallback Events

If all conditional Events for a Trigger can fail, add a lower-priority unconditional fallback. Otherwise the Runtime reports a missing Event after player input.

### Input sources

| UI | Stored format | Purpose |
| --- | --- | --- |
| Auto | `Auto` | Checked by the Runner before interactive input |
| Option | `Action:<id>` | Returned by a data-driven Option |
| Keyboard | `Keyboard:<keysym>` | Listened for during the Options interaction |
| Mouse | `Mouse:<button>` | Left, middle, right, or wheel input |

Focus the Keyboard field and press a key or combination to record it.

## Options

Options are the fixed data-driven player interface. Every displayed Option is actionable. Use Events or separate Scene Nodes for conditions, availability, and alternate option sets.

The three Element types are:

- `TEXTBOX`: a vertical Item list with a visible-row limit and scrolling.
- `PICTURE`: an image button with Idle / Hover images and optional alpha hit testing.
- `HITBOX`: a transparent interaction region over the scene.

Form mode edits Name, Text, Trigger, images, and sounds. Canvas mode edits position, size, layer, Hover, colors, and visual details.

The Canvas Preview Background inherits the Node Background by default. Selecting another image changes only that Options preview.

Options have one Interaction lifecycle. Returning a Trigger closes the screen; REDO starts a new Runner iteration and calls it again.

## Content

Content is native `.rpy` managed for location and references by the editor. Creators still write dialogue, characters, transitions, ATL, and custom Python inside labels.

```renpy
label content_example:
    "This is a presentation label."
    return
```

A Content label should return to the Runner. Do not duplicate Event Effects or directly rewrite the Scene Stack in ordinary Content.

## State

### Stats

Stats are numbers with `Init`, `Min`, and `Max`. Conditions compare them; Effects support `set`, `+`, `-`, `*`, and `/`.

### Memory Banks

Memory Banks store tags. Conditions use `has` / `not_has`; Effects use `add` / `remove` / `clear`.

The default `Memory` bank cannot be deleted and also tracks Once Events. Custom banks do not reset daily or weekly automatically; call clear explicitly from your own time flow.

## Graph

The graph is a read-only directed view generated from GOTO / Next Node. It does not create or modify Events.

- Wheel or two-finger vertical movement: zoom around the pointer.
- Drag empty space: pan.
- Search: dim non-matching nodes.
- Round button: reset the view.
- Click a node: select it in the editor.

## Check Project

Before running or submitting the game, use Check Project to verify:

- JSON and Schema validity.
- Stat, Memory, Content, Screen, and Next Node references.
- ROOT and Runtime entry configuration.

A clean check does not prove game-design correctness. Playtest Conditions, weights, and narrative outcomes.

## Custom Ren'Py interfaces

Use `gui.rpy` for global dimensions, fonts, and style variables. Use `screens.rpy` or another creator-owned `.rpy` for Screen structure. The editor scans Screen names for node references but does not edit those files.

Implement systems that are not data-driven by the editor—such as inventory, calendars, or maps—in creator-owned `.rpy`, then connect them through Content, Stats, Memories, or public Runtime APIs. Do not hide them inside the Options renderer.

## Saving, updating, and recovery

- Autosave is enabled by default; pending writes finish before node or tab switches.
- Shortcuts and editor settings live in `.scene-node-editor/settings.json` at the project root.
- Re-running the installer updates only managed Editor / Runtime files.
- Deleted nodes move to `.scene-node-trash/`, outside Ren'Py's game scan.

For data formats and public Runtime APIs, continue with the [Reference](REFERENCE.md).
