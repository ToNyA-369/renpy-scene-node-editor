# Scene Node Editor — AI Context

This file is a compact contract for AI assistants working inside a Ren'Py game that uses Scene Node Editor. Read it before changing project files.

## Purpose

Scene Node Editor manages structured interaction flow. It does not replace Ren'Py's screen language, narrative scripting, assets, or game-specific systems.

```text
Input source -> Trigger -> Event -> Effects -> Content label -> REDO/GOTO/EXIT
```

## Ownership

Framework-managed; do not edit for ordinary game work:

```text
game/FRAMEWORK/runtime.rpy
game/FRAMEWORK/option_renderer.rpy
.scene-node-editor/EDITOR/
```

Editor-managed project data; prefer changing it through the Editor:

```text
game/DATA/SceneProject.json
game/DATA/Stats.json
game/DATA/Memories.json
game/SCENENODE/**/Node.json
game/SCENENODE/**/Options.json
game/SCENENODE/**/EVENTPOOL/*.json
```

Creator-owned; safe to edit when requested:

```text
game/gui.rpy
game/screens.rpy
game/**/*.rpy except FRAMEWORK and generated Content files outside the requested scope
game/images/**
game/audio/**
other creator assets and custom systems
```

Content files under `game/SCENENODE/**/CONTENT/` are native Ren'Py, but their label IDs are referenced by Events. Preserve those IDs unless all references are intentionally updated.

## Invariants

1. A displayed Option is always actionable. Put conditions and fallback behavior in Events or separate Nodes, not per-Option visibility rules.
2. The UI calls the source “Option”; stored Triggers remain `Action:<id>`.
3. Other Trigger formats are `Auto`, `Keyboard:<Ren'Py keysym>`, and `Mouse:<Left|Middle|Right|WheelUp|WheelDown>`.
4. An Option returns a Trigger. It does not directly choose an Event, run Effects, call Content, or perform GOTO.
5. Events own Conditions, Priority, Weight, Once, Effects, Content, and End up.
6. Event Content stores a Ren'Py label name, not an `.rpy` filename.
7. Content Effects run before the Content label. Content should normally `return` to the Runner.
8. `REDO` repeats the current Node, `GOTO` pushes a child Node, and `EXIT` pops back to the parent. EXIT at ROOT ends the Runner.
9. Scene Screen is a parameterless visual shell or HUD. It does not replace the Options renderer and should not select Events.
10. Do not rename stable Node, Event, Stat, Memory Bank, Element, Item, or Content IDs casually.
11. Do not introduce new Schema fields or change public Runtime semantics without explicit creator approval.
12. Do not overwrite creator-owned `gui.rpy`, `screens.rpy`, or game data during framework updates.

## State

Stats are numeric values with Init / Min / Max. Event Conditions compare them and Effects change them.

Memory Banks contain string tags. The required `memory` bank also records Once Events as `once:<event_id>`. Custom banks do not reset automatically.

Public creator-facing helpers:

```renpy
scene_get_stat(stat_id, default=0)
scene_memory_has(bank_id, tag_id)
scene_memory_add(bank_id, tag_id)
scene_memory_remove(bank_id, tag_id)
scene_memory_clear(bank_id)
```

Do not rely on other internal `scene_*` functions from creator code.

## Screens and GUI

- Use `gui.rpy` for global GUI variables, fonts, sizes, and styles.
- Use `screens.rpy` or another creator-owned `.rpy` for Screen structure.
- A Node references the Screen by name in `Node.json`.
- Keep the Screen parameterless unless the framework contract is explicitly redesigned.
- Read state using public helpers; avoid changing Event flow directly from the Screen.

## Custom systems

Inventory, calendars, maps, quests, and other systems not represented by the Editor belong in creator-owned `.rpy`. Connect them through Content, Stats, Memories, or an explicitly designed public API. Do not hide them inside `option_renderer.rpy`.

## Safe workflow

1. Inspect the relevant Node, Event, Content, and creator files.
2. State whether the request changes presentation, game content, Schema, or Runtime behavior.
3. Preserve stable IDs and unrelated user changes.
4. Make the smallest scoped change.
5. Run syntax checks and relevant tests.
6. Ask the creator to run Check Project in the Editor and playtest the interaction.

When a request would alter Schema, saved-data compatibility, or public Runtime APIs, explain the design and impact before implementation.
