# Scene Node Editor user guide

[繁體中文](../zh-TW/USER_GUIDE.md) · [English](USER_GUIDE.md) · [Home](../../EDITOR/README.en.md)

This guide defines the editor's scope and its seven workspaces. If you do not yet have a playable flow, start with [Build your first project](FIRST_PROJECT.md).

## Working model

```text
Input source → Trigger → Event → Content → Effects → End up
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

Real Scene Nodes can be reordered by dragging the whole row. Dwell over another Node for about half a second; a framed group reservation opens below that card, and releasing creates a single-level group just like the Event Pool. Nodes cross group frames directly to move in or out; blank space beside a group name moves the whole group, and a one-Node group dissolves automatically. Groups are collapsed by default and expand on hover, keyboard focus, or drag entry. Reordering inside a group keeps it open until the pointer actually leaves, while grabbing the whole group continuously contracts its floating preview from the current expanded height to the heading. The Global Node remains fixed at the top and does not participate. `Group` and `Order` affect authoring presentation only; they do not change ROOT, GOTO / REPLACE, graph depth, or Runtime execution.

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

- `Group`: Editor-only Event Pool organization. Missing values belong to the fixed `Normal` group and do not affect game execution.
- `Trigger`: On Enter, On Node, On Exit, Option, Keyboard, or Mouse.
- `Priority`: lower numbers win; only the lowest matching layer is considered.
- `Weight`: relative chance among matching On Node or player-input Events at the same Priority.
- `Once`: allows one successful selection for the entire game.
- `Conditions`: decide whether the Event is a candidate.
- `Effects`: Stat, Memory, or Option Availability changes applied when the Event runs.
- `Content`: a Ren'Py label called after Effects, optionally weighted.
- `End up`: REDO, GOTO, REPLACE, or EXIT after Content returns. GOTO and REPLACE accept one or weighted Next Node.

The UI calls the source `Option`; the technical format remains `Action:<id>`. The Event picker lists Triggers registered by the current authoring scope's Options. A Trigger authored on the Global Node is available during every real-node interaction.

The Event Pool uses one level of groups but keeps one full-width Add Event button; new Events appear visually ungrouped. While dragging, the current insertion gap follows the pointer and nearby Events or group blocks move up or down to make room. The preview stays attached to every pointer update while layout work is coalesced to one update per animation frame. A small midpoint hysteresis prevents insertion flip-flop, and approaching the list edges scrolls progressively without releasing the item. The flow keeps natural trailing space, so an Event can be placed after a bottommost group. Crossing out of a group returns the Event to the loose ordering flow, while crossing into another group inserts it there; no dedicated ungroup target is required. Dwell over another ungrouped Event's current bounds for about half a second; a framed group reservation opens below it before release. If live reflow moves that Event away from the pointer, the grouping intent is cancelled immediately. Groups are collapsed by default to a compact name field and item count, and expand on pointer hover or keyboard focus. Reordering inside a group keeps it open until the pointer leaves. The unmarked blank space beside the name drags the entire group as one ordering block, with its floating preview continuously contracting from the expanded contents to the heading. A group dissolves automatically when one Event remains. Group names are edited directly and order is stored in Editor-only `Order` metadata. Successful drags do not show a toast; failures restore the previous layout and remain visible.

Conditions, Effects, weighted Content entries, and weighted Next Node entries are presented as cards. Drag a card's perimeter or inter-field whitespace while inputs and remove buttons remain interactive. A Condition frame means AND; groups and independent Conditions are OR alternatives. Legacy Conditions first appear in one AND group, and Add Condition continues appending there while it is the only branch. After a Condition is pulled out to create an OR branch, later additions start as independent OR Conditions. Dragging into a group joins its AND clause, while dwelling one independent Condition over another creates a new AND group. Logic is limited to this single OR-of-AND layer, and one-member AND groups remain intact. Effects still execute in saved array order after Content returns. Weight-entry order affects Editor presentation only, not probability.

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

The Element sidebar and TEXTBOX Items in form mode can be reordered directly without a separate handle or grouping behavior. A TEXTBOX Item's whole card is the drag surface; only its remove button remains an independent control. Element array order is persisted and acts as the stable tie-breaker for equal Z Order; explicit Z Order remains the primary canvas-layer control. TEXTBOX Item order also determines game display and staggered entrance order.

Canvas mode keeps the preview and Inspector visible together at an approximate 4:3 width ratio. The Inspector header keeps the current Element, type, appearance summary, and Layout / Style / Effects / Item categories visible while one focused control set appears below; there are no nested disclosure cards or separate appearance page. Selecting a Text Box Item on the canvas opens that Item category directly, and color, typography, or effect changes remain visible on the canvas while editing. Profiles are individual JSON files under `game/DATA/TEXTBOX_PROFILES/` and provide base colors and text styling plus six optional features: hover accent, hover text color, Item border, text shadow, text outline, and staggered item entrance. The same profile can be reused by multiple Text Boxes in any Scene Node or Global Options scope; updating it updates every reference that has not overridden that value.

After applying a profile, the current Text Box may still enable or disable each exposed feature and change colors or typography as local overrides. Item Style Override remains the final layer. Clear Local Overrides returns the Text Box to the shared profile, while detaching the profile materializes the currently resolved style so its appearance does not jump. Referenced profiles cannot be deleted. A missing or manually damaged file does not block Options loading: Runtime falls back to the Text Box's inline `Style`, and project validation reports the problem.

When a Text Box has local overrides, the Appearance section shows their count explicitly; choose Use Profile Appearance to clear them and follow the shared profile again. Every new Scene Runtime session also reloads project data and profiles, so starting the game again from the main menu picks up the latest Editor save.

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

The Content workspace includes an offline Ren'Py code editor built from the syntax rules and snippets in Ren'Py's official VS Code extension. It provides syntax colors, line numbers, bracket matching, folding, search, four-space indentation, current-node label suggestions, and project image/audio suggestions. This is an authoring aid, not a replacement for Ren'Py lint or a real game run. If the enhanced editor cannot initialize, the basic text editor remains available automatically.

Content files in the same authoring scope can be reordered by dragging their whole row in the left list. This changes Editor presentation only and does not rewrite `.rpy` labels or Runtime call order. The Textbox appearance-profile manager uses the same ordering gesture.

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

Stats are numbers with `Init`, `Min`, and `Max`, organized by an authoring-only `Group`. A missing Group belongs to the visually ungrouped `Normal` flow. Stats keep one Add Stat button, and new Stats start visually ungrouped. Name / Min / Init / Max headers appear once at the top, and every loose or grouped row shares the same column widths. Drag from the blank space beside a Stat name: the insertion gap follows the pointer and pushes nearby Stats or group blocks aside. Dragging shares the Event flow's frame-coalesced layout, midpoint hysteresis, and progressive edge auto-scroll for long lists. Crossing a group boundary moves out or inserts into that group without a dedicated target. Dwell over another Stat until the group frame expands, then release to create a group. A group dissolves automatically when one Stat remains. Group names are edited directly and order is stored in Editor-only `Order` metadata. Event Stat Conditions / Effects use a two-level “Group → Stat” picker and show only the Stat name after selection. `Group` and `Order` do not change Stat IDs, Runtime access, or save keys. Conditions compare values; Effects support `set`, `+`, `-`, `*`, and `/`.

### Memory Banks

Memory Banks store tags. Conditions use `has` / `not_has`; Effects use `add` / `remove` / `clear`.

Memory Bank rows can be reordered from inter-field whitespace. The editor saves and restores their presentation order through object-key insertion order in `Memories.json`; this does not change Bank IDs, Runtime APIs, or saved-game contents, and it never creates groups.

The default `Memory` bank cannot be deleted and also tracks Once Events. Custom banks do not reset daily or weekly automatically; call clear explicitly from your own time flow.

## Graph

The graph is a read-only directed view generated from GOTO / REPLACE Next Node values and uses a reproducible Stack-depth layout. Each real Scene Node is an opaque white bordered dot and the canvas shows only its Node Name; technical IDs and the GLOBAL authoring scope do not occupy graph space. ROOT occupies the leftmost entry column. Every GOTO places the primary flow in the next Stack-depth column to the right, so creators can read a node's position relative to the game entry directly.

Formal Stack depth comes only from the primary GOTO skeleton. When nodes at one formal depth still have GOTO relationships between them, the algorithm creates a local relationship group, chooses the member with the most group-local outgoing links as its front anchor, then uses BFS distance to assign at most 140 graph units of local progression. If Options reaches both Branch and Result directly while Branch also uses GOTO Result, Branch sits in front and Result behind it, connected by a short local curve instead of a large outside return arc. Both directions of a GOTO Cycle remain visible but bend locally around opposite sides of the pair.

REPLACE does not increase Stack depth, so the algorithm first collapses REPLACE-connected nodes into one layout family. Members use the parity of their shortest REPLACE-chain distance to alternate across the depth baseline, with total horizontal span capped at 160 graph units. `Parent GOTO A`, `A REPLACE B`, and `B REPLACE C` therefore form a back–front–back A → B → C arrangement: A → B points forward and B → C points backward instead of stacking every dashed and management route in one direction. When an odd cycle cannot be fully split across two sides, stable ordering shares one side and curves separate the links. A GOTO child owned by B still enters the next formal Stack depth. This is visualization only and adds no static Parent Schema.

The GOTO structure reachable from ROOT forms a primary tree ordered by stable Name and ID. Each branch receives a stable vertical swimlane, and a parent aligns with the span of its subtree. When several GOTO sources point to one destination, the first relationship reached from ROOT determines its primary position and every other relationship remains visible as a cross-reference. Same-depth GOTO Cycles use paired local arcs; only relationships returning across formal depths toward a shallower column use outside arcs. Neither case increases depth forever. Nodes unreachable from ROOT occupy a clearly marked detached region below the main flow.

Node radius still derives from the cycle-safe spatial demand of unique descendants. Direct children contribute most, deeper descendants decay by level, and the result is logarithmically compressed so hubs remain recognizable without becoming oversized. This metric changes only dot size, not position. The same data and ROOT always produce the same coordinates, and waiting or dragging cannot rearrange the whole graph.

Each time the graph opens, edges extend and nodes appear in stages from ROOT according to formal depth and local relationship order. After the entrance completes, nodes breathe slowly around their structural anchors. Real GOTO / REPLACE neighbors pass a small amount of visual momentum through weak springs, while nodes with nearby anchors apply slight symmetric repulsion, so connected branches influence one another without moving in lockstep. Management and Global relationships do not participate in this local physics, total displacement is hard-capped at 7 graph units per node, and motion cannot accumulate or alter depth and swimlanes. Routes follow the visible nodes, but interaction hit targets remain fixed at structural anchors. Beginning a drag, pan, zoom, or keyboard action finishes the entrance immediately. Both entrance and idle motion are disabled when the system prefers reduced motion.

For large projects, layout and edge-crossing diagnostics run in the background, and an unchanged topology reuses its completed layout. Idle node motion stops completely after leaving Graph or placing the browser in the background, then resumes only when Graph is visible again. These optimizations reduce switching stalls and resource use without changing layout results or saving node positions.

The canvas can still be panned in any direction and the zoom range accommodates large projects. The background draws no depth color bands, column labels, or interaction legend; depth is expressed only by the nodes' overall left-to-right position. The initial view and Show Entire Graph button fit the current graph bounds. Node Names compensate for zoom to retain an approximately constant readable screen size, then fade with the zoom once nodes become too small to distinguish clearly, leaving only nodes and connections in the distant overview. They return when the canvas is enlarged again. Zoom around the pointer for local inspection, then follow the flow across the project.

GOTO is solid and REPLACE is dashed in the same color. Every edge path still runs from node center to node center, while each arrow tip stops exactly on the receiving circle; both ends of a bidirectional relationship follow the same rule. Arrowheads are graph geometry and scale with the canvas, while Node Names compensate for zoom throughout the readable range and fade out in the distant overview. Lines carry no inline text; Event name, Trigger, End up, and direction details remain available in tooltips. Reciprocal `A REPLACE B` and `B REPLACE A` references become one line with arrowheads at both ends, while its tooltip still lists each directional Event and the JSON remains unchanged. Reciprocal GOTO references are not merged: two high-contrast reverse arcs expose the GOTO Cycle structure that may keep growing the Stack. Management references follow the complete REPLACE chain: `Parent GOTO A`, `A REPLACE B`, and `B REPLACE C` produce the translucent `Parent → B` and `Parent → C` edges, all sharing the parent center with the direct GOTO. Global Events and the GLOBAL node are omitted from the graph; this affects only visualization, not their Editor, data, or Runtime behavior. The graph adds no Schema Parent and changes neither Events nor Runtime contracts.

- Wheel or two-finger vertical movement: zoom around the pointer.
- Drag empty space: pan.
- Drag a node: the grabbed node tracks the pointer 1:1. Its displacement passes through weak real GOTO / REPLACE springs to connected nodes and repels any node it approaches. Every other node remains constrained by its own anchor and the 7-graph-unit cap; releasing restores the idle state smoothly, and no position is saved.
- Search: dim non-matching nodes and unrelated edges.
- Focus a node: temporarily dim unrelated nodes and edges while preserving direct neighbors.
- Round button: show the complete current graph bounds.
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
- Press `Cmd + Z` on macOS or `Ctrl + Z` on Windows/Linux to undo the latest successful Editor project change; there is no toolbar button. The in-memory history keeps up to 100 steps for the current Editor process and clears when the Editor restarts. Text fields and the Content code editor retain their native text undo stacks. Once focus leaves a text editor, the shortcut undoes persisted structural operations such as creating, deleting, dragging, or grouping. If a snapshot is still pending, the Editor first includes it in the transaction and immediately restores the prior value; a failed write or restore leaves the current screen unchanged.
- Press `Cmd + Backspace` on macOS or `Ctrl + Backspace` on Windows/Linux to delete the current functional item; the binding is configurable. Within an Event, a focused Condition, Effect, or weighted row takes priority. Options similarly prioritizes a focused Item, while other workspaces reuse their current-item deletion and confirmation flow. Text fields and the Content code editor retain native text deletion and never trigger structural deletion.
- Press Escape in an Event child field to leave it at the containing Condition, Effect, or weighted row; Escape in the Content code editor returns focus to the Content workspace. If Monaco is showing suggestions, Find, or another transient surface, the first Escape closes that surface. Once the field is exited, the delete shortcut can remove the structural item without a pointer detour.
- Every dropdown supports Up/Down navigation, Home/End for the first or last item, Right to enter a submenu, Left to return, Enter to select, and Escape to close.
- After creating an Event, type its Name directly, then press Tab to move through Trigger mode, Trigger value, Priority, Weight, Once, Conditions, Effects, Content, and End Up. Autosave-driven rerenders preserve the current focus.
- Drag workspace tabs horizontally in the top bar to change their visual order. Previous/next workspace shortcuts follow this order, while Cmd/Ctrl + 1…7 keep their fixed workspace destinations.
- Shortcuts, workspace order, and editor settings live in `.scene-node-editor/settings.json` at the project root. The UI supports switching between Traditional Chinese (`zh-Hant`) and English (`en`). Changing language flushes pending project changes; if unsaved changes exist while autosave is disabled or if flushing/settings save fails, the language change is blocked and reverted without reloading to preserve project data.
- Re-running the installer updates only managed Editor / Runtime files.
- Deleted nodes move to `.scene-node-trash/`, outside Ren'Py's game scan.

For data formats and public Runtime APIs, continue with the [Reference](REFERENCE.md).
