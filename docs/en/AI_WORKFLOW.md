# AI-assisted Scene Node development

[繁體中文](../zh-TW/AI_WORKFLOW.md) · [English](AI_WORKFLOW.md) · [Home](../../README.en.md)

The installer places a compact project contract at:

```text
<RenPy Project>/.scene-node-editor/AI_CONTEXT.md
```

Ask an AI assistant to read that file before doing project work. It is more reliable than pasting the entire Reference and helps prevent accidental Framework edits or attempts to replace Options with a custom Screen.

## General prompt template

```text
Read .scene-node-editor/AI_CONTEXT.md first, then inspect the existing files related to this request.

My goal: <describe the player-visible result>
Allowed scope: <specific .rpy, Content, or data scope>
Do not change: game/FRAMEWORK, stable IDs, or unrelated game data

Classify the work as:
1. Editor data configuration
2. Content / Ren'Py presentation
3. gui.rpy / screens.rpy interface
4. Game-specific system
5. Schema / Runtime contract change

For category 5, explain the design and impact before implementation.
After the change, list modified files, validation steps, and any reference I must set in the Editor.
```

## Create a HUD

```text
Read .scene-node-editor/AI_CONTEXT.md first.

Create a parameterless room_hud Screen in game/screens.rpy that displays the money Stat.
Read it with scene_get_stat("money", 0); do not mutate State directly.
Do not modify FRAMEWORK or Options.json.
Use show screen room_hud in the specified On Enter Content and hide screen room_hud in its matching On Exit Content.
```

## Write Content presentation

```text
Read AI_CONTEXT, then edit only the specified CONTENT .rpy.
Preserve the existing label ID. Add dialogue, transitions, and ATL inside the label, then return.
Do not duplicate Stat / Memory Effects already owned by the Event and do not GOTO a Scene Node directly.
```

## Implement a custom system

```text
I need an inventory system that is not represented by the Editor.
First propose a creator-owned .rpy module boundary and how it connects through Content or public APIs.
Do not put inventory code in option_renderer.rpy or add Schema fields without my approval.
```

## Work AI may perform directly

- Write or adjust `gui.rpy`, `screens.rpy`, and HUDs.
- Edit Ren'Py inside explicitly selected Content labels.
- Create ATL, transforms, characters, and creator-owned systems.
- Analyze Event Conditions / Effects and node flow.
- Recommend data to create through the Editor based on the Reference.

## Work AI should pause and explain

- Editing `FRAMEWORK/runtime.rpy` or `option_renderer.rpy`.
- Adding or removing Schema fields.
- Changing Trigger, REDO, GOTO, REPLACE, EXIT, or Scene Stack semantics.
- Renaming stable IDs or moving referenced labels.
- Changing installer overwrite boundaries or save compatibility.

## Human verification

1. Review the actual diff.
2. Run Check Project in the Editor.
3. Confirm autosave has completed.
4. Play the affected flow from the Ren'Py Launcher.
5. Confirm a framework update still preserves creator-owned files.

AI can accelerate implementation, but narrative, rules, visual direction, and final acceptance remain creator decisions.
