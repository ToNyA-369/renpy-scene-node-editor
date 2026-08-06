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

The top of the node list contains a fixed, undeletable Global Node. It is an authoring scope for global Events, Options, and Content, not a real Scene Node:

- It never enters the Scene Stack and cannot be ROOT or a GOTO / REPLACE destination.
- It owns an Options workspace; Global Options render together with the current real node's Options everywhere.
- Global Events may use Global Option Triggers and may enable or disable Controlled Options in the same `__global__` scope.
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
- `Effects`: Stat, Memory, or Option Availability changes applied when the Event runs.
- `Content`: a Ren'Py label called after Effects, optionally weighted.
- `End up`: REDO, GOTO, REPLACE, or EXIT after Content returns. GOTO and REPLACE accept one or weighted Next Node.

The UI calls the source `Option`; the technical format remains `Action:<id>`. The Event picker lists Triggers registered by the current authoring scope's Options. A Trigger authored on the Global Node is available during every real-node interaction.

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

Options are the fixed data-driven player interface. Every displayed Option is actionable. Keep condition evaluation and branching in Events or separate Scene Nodes.

The three Element types are:

- `TEXTBOX`: a vertical Item list with a visible-row limit and scrolling.
- `PICTURE`: an image button with Idle / Hover images and optional alpha hit testing.
- `HITBOX`: a transparent interaction region over the scene.

Form mode edits Name, Text, Trigger, images, and sounds. Canvas mode edits position, size, layer, Hover, colors, and visual details.

Every Element has an `Availability` mode:

- `Always`: persistently visible.
- `Controlled`: hidden at the start of a new game, shown by an Event Option Effect with `enable`, and hidden again with `disable`.

TEXTBOX supports Availability on both the whole Element and each Item, so an Effect can reveal a separate list or add one Item to an existing list. An Item requires both its own and its parent Element's availability; temporarily disabling the parent does not erase enabled Item state. PICTURE and HITBOX provide Element-level control only.

Add an `option` Effect to an Event, then choose “Element → whole list or Item” from the current Options scope and select `enable` / `disable`. A Scene Node Event can control only that same node, while a Global Event can control only Global Options; neither may cross scopes. The Editor saves stable Node, Element, and Item IDs and protects referenced Elements and Items from deletion. Enabled state participates in Ren'Py saves, does not reset on stack transitions, and is cleared when a new game starts.

On every interaction, the Runtime places the current Scene Node Options first and overlays Global Options. If both scopes reuse the same Trigger, all same-Trigger Events still compete together by Conditions, Priority, and Weight, so Global Options should use clear, collision-resistant Trigger IDs.

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

Stats are numbers with `Init`, `Min`, and `Max`, organized by an authoring-only `Group`. A missing Group is assigned to the default `Normal` group. The plus button on the outer Stats card creates a group with its first Stat; the plus button inside each group adds another Stat to that group. Group names are directly editable, while `Normal` remains the fixed default group. Event Stat Conditions / Effects use a two-level “Group → Stat” picker and show only the Stat name after selection. Groups do not change Stat IDs, Runtime access, or save data. Conditions compare values; Effects support `set`, `+`, `-`, `*`, and `/`.

### Memory Banks

Memory Banks store tags. Conditions use `has` / `not_has`; Effects use `add` / `remove` / `clear`.

The default `Memory` bank cannot be deleted and also tracks Once Events. Custom banks do not reset daily or weekly automatically; call clear explicitly from your own time flow.

## Graph

The graph is a read-only directed view generated from GOTO / REPLACE Next Node values and uses a hierarchy-aware live force layout similar to Obsidian. Each real Scene Node is an opaque white bordered dot and the canvas shows only its Node Name; technical IDs and the GLOBAL authoring scope do not occupy graph space. The configured ROOT is the default force center: first-level GOTO nodes spread around it, while deeper children form their own circular clusters around their respective parents. Management nodes derived through a REPLACE chain remain in the same parent cluster, and multiple GOTO parents jointly pull a shared destination. These are soft forces rather than fixed coordinates or a static Parent Schema.

The initial graph uses progressive topology seeding. It places ROOT first, grows the reachable GOTO skeleton one level at a time, and only then introduces same-level REPLACE families into their reserved parent orbits. If a REPLACE node owns GOTO children, those branches continue growing in the next pass; nodes that cannot be derived from ROOT join last. These stages complete quickly before presentation, so the creator sees one nearly settled graph rather than a playback animation. The same data and ROOT produce a reproducible initial result.

A node's radius and repulsive charge inherit the spatial demand of all unique descendants. Direct children contribute most and deeper descendants decay by level before logarithmic compression; radius growth and its cap are deliberately restrained so hubs remain recognizable without becoming oversized. Cycles and repeated paths are deduplicated instead of recursing forever. Base node repulsion follows an inverse-square law. Direct parent-child spacing remains spring-led, while ancestry beyond the first level uses a slower square-root attenuation so ROOT and its grandchildren retain meaningful separation without allowing ROOT to dominate the entire branch. Each group of direct and REPLACE-management children also receives a soft tangential correction that distributes it around the parent without locking positions. When a node has multiple parent sources, only the first primary parent reached from ROOT supplies its orbit angle; the remaining relationships retain their springs and edges without imposing contradictory angular targets.

To reduce visual knots, the force field applies a weak crossing penalty only to edges that share no endpoint and actually intersect; nearby or parallel lines do not repel one another. Primary GOTO structure is preserved first, followed by REPLACE and ordinary cross-branch edges, while translucent management edges yield first. ROOT, branching hubs, and the node under direct drag receive additional protection from auxiliary-line movement. Crossing correction gradually adjusts a child's local orbit angle, and non-tree routes bend toward the outside of the overall graph. These forces resume after a drag but remain view-only: they save no positions and change no flow data.

The simulation plane is effectively unbounded: nodes are no longer clamped to the initial canvas rectangle, the empty plane can be panned continuously in any direction, and the zoom range accommodates large projects. The initial view centers ROOT at a readable node scale instead of shrinking every dot to force distant branches into one frame; zoom out manually when an overview is useful. Reset View preserves the current zoom level and returns ROOT to the viewport center; it neither rearranges nor saves node positions.

GOTO is solid and REPLACE is dashed in the same color. Every edge path still runs from node center to node center, while each arrow tip stops exactly on the receiving circle; both ends of a bidirectional relationship follow the same rule. Arrowheads are graph geometry and scale with the canvas, while Node Names compensate for zoom to retain an approximately constant readable screen size. Lines carry no inline text; Event name, Trigger, End up, and direction details remain available in tooltips. Reciprocal `A REPLACE B` and `B REPLACE A` references become one line with arrowheads at both ends, while its tooltip still lists each directional Event and the JSON remains unchanged. Reciprocal GOTO references are not merged: two high-contrast reverse arcs expose the GOTO Cycle structure that may keep growing the Stack. Management references follow the complete REPLACE chain: `Parent GOTO A`, `A REPLACE B`, and `B REPLACE C` produce the translucent `Parent → B` and `Parent → C` edges, all sharing the parent center with the direct GOTO. Global Events and the GLOBAL node are omitted from the graph; this affects only visualization, not their Editor, data, or Runtime behavior. The graph adds no Schema Parent and changes neither Events nor Runtime contracts.

- Wheel or two-finger vertical movement: zoom around the pointer.
- Drag empty space: pan.
- Drag a node: it follows the pointer directly while the rest of the graph responds; releasing it hands velocity back to the simulation so the graph settles again. Positions belong only to the current graph view and are not saved into project data.
- Search: dim non-matching nodes and unrelated edges.
- Focus a node: temporarily dim unrelated nodes and edges while preserving direct neighbors.
- Round button: preserve the current zoom level and return ROOT to the viewport center.
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
