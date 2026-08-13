# Scene Node Editor — AI Context

This file is a compact contract for AI assistants working inside a Ren'Py game that uses Scene Node Editor. Read it before changing project files.

## Purpose

Scene Node Editor manages structured interaction flow. It does not replace Ren'Py's screen language, narrative scripting, assets, or game-specific systems.

```text
Input or lifecycle source -> Trigger -> Event -> Content label -> Effects -> optional REDO/GOTO/REPLACE/EXIT
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
game/GLOBALNODE/Node.json
game/GLOBALNODE/EVENTPOOL/*.json
game/GLOBALNODE/CONTENT/*.rpy
game/SCENENODE/**/Node.json
game/SCENENODE/**/Options.json
game/DATA/TEXTBOX_PROFILES/*.json
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

Content files under `game/GLOBALNODE/CONTENT/` and `game/SCENENODE/**/CONTENT/` are native Ren'Py, but their label IDs are referenced by Events. Preserve those IDs unless all references are intentionally updated.

## Invariants

1. A displayed Option is always actionable. Put conditions and fallback behavior in Events or separate Nodes. Options use only `ALWAYS` or Event-controlled `CONTROLLED` Availability, never embedded condition expressions.
2. The UI calls the source “Option”; stored Triggers remain `Action:<id>`.
3. Other Trigger formats are `Auto:Enter`, `Auto:Node`, `Auto:Exit`, `Keyboard:<Ren'Py keysym>`, and `Mouse:<Left|Middle|Right|WheelUp|WheelDown>`.
4. An Option returns a Trigger. It does not directly choose an Event, run Effects, call Content, or change the Scene Stack.
5. On Node and player-input Events own Conditions, Priority, Weight, Once, Effects, Content, and End up. On Enter / On Exit lifecycle Events omit Weight, End up, and Next Node.
6. The fixed `__global__` Global Node is an authoring scope, not a Stack Node. Its Options render together with every current real Node and may use `Action:` Triggers; it still cannot be Root or Next Node. Its Events merge with the current real Node, and End up operates on that real Stack-top context.
7. Event Content stores a Ren'Py label name, not an `.rpy` filename.
8. Event Effects cover Stats, Memories, and idempotent Option `enable` / `disable` operations. Content runs first; after its label returns, the Runtime records Once and applies Effects before resolving End up. Backgrounds, audio, transitions, and other presentation use native Ren'Py in Content, which must normally `return` to the Runner.
9. On Enter / On Exit evaluate Conditions as a snapshot and run every local and Global match ordered by Priority then Event ID. On Node merges local and Global Events before minimum-Priority / Weight selection.
10. `REDO` repeats the current Node, `GOTO` pushes a destination Node, `REPLACE` atomically swaps the Stack top, and `EXIT` pops back to the parent. REPLACE requires an actual parent in the current Stack: `[parent, current] -> [parent, target]`. It runs current On Exit and target On Enter without resuming any parent lifecycle, On Node, or Options. EXIT at the first Stack level ends the Runner. GOTO does not exit the parent, and returning from a child does not re-enter the parent.
11. Node has no Background or Screen field. Backgrounds, audio, transitions, Screens, and HUDs are creator-owned presentation controlled from Content with native Ren'Py.
12. `Options.json` Version 2 added Element and TEXTBOX Item `Availability`; Version 3 adds optional TEXTBOX appearance-profile references. Missing Availability and Version 1 data migrate as `ALWAYS`; Version 1/2 documents normalize to Version 3. PICTURE / HITBOX are Element-only. A controlled Item requires its parent Element to be available; parent disable retains child state. A local Event may target only its Scene Node Options, while a Global Event may target only `__global__` Options; cross-scope Effects are invalid. Enabled state is saved but reset for a new game.
13. Textbox appearance profiles are creator-owned JSON files under `DATA/TEXTBOX_PROFILES/`. Resolution is defaults → profile → Textbox Style Overrides → Item Style Override. Supported profile features are `hover_accent`, `hover_text_color`, `item_border`, `text_shadow`, `text_outline`, and `staggered_entrance`. Missing or invalid profiles fall back to the Textbox inline Style and must not stop Options loading. Referenced profiles cannot be deleted. Profiles are presentation-only and cannot contain rules or arbitrary Ren'Py code.
14. Do not rename stable Node, Event, Stat, Memory Bank, Element, Item, or Content IDs casually. Element and Item deletion must account for same-Node Option Effect references.
15. Do not introduce new Schema fields or change public Runtime semantics without explicit creator approval.
16. Do not overwrite creator-owned `gui.rpy`, `screens.rpy`, or game data during framework updates.

## State

Stats are numeric values with Init / Min / Max and an authoring-only Group. Missing Groups normalize to the default `Normal` group. The State workspace adds groups at the outer level and Stats inside each group; Event selectors display Group → Stat, while Runtime state and public APIs continue to use the flat stable Stat ID.

Scene Node `Group` and `Order` values are also authoring-only organization metadata. They control the Editor sidebar presentation but never ROOT, Stack transitions, graph structure, Event resolution, or Runtime behavior. The fixed Global Node is not groupable.

Memory Banks contain string tags. The required `memory` bank records ordinary Once Events as `once:<event_id>` and Global Once Events as `once:global:<event_id>`. Custom banks do not reset automatically.

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
- Show, hide, or call the Screen from Content with native Ren'Py statements.
- Keep Screen flow separate from data-driven Options unless the framework contract is explicitly redesigned.
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

For deeper project-local guidance, read the matching files under `.scene-node-editor/docs/zh-TW/` or `.scene-node-editor/docs/en/`. The installer manages and refreshes those documents together with this contract.

When a request would alter Schema, saved-data compatibility, or public Runtime APIs, explain the design and impact before implementation.
