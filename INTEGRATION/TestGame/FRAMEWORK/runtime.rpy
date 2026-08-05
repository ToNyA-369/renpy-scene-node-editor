init -100 python:
    import json

    SCENE_PROJECT_FILE = "DATA/SceneProject.json"
    SCENE_STATS_FILE = "DATA/Stats.json"
    SCENE_MEMORIES_FILE = "DATA/Memories.json"
    SCENE_DEFAULT_MEMORY = "memory"
    SCENE_GLOBAL_NODE_ID = "__global__"
    SCENE_GLOBAL_NODE_FILE = "GLOBALNODE/Node.json"
    SCENE_GLOBAL_EVENT_ROOT = "GLOBALNODE/EVENTPOOL/"
    SCENE_NODE_ROOT = "SCENENODE/"
    SCENE_NODE_FILE = "/Node.json"
    SCENE_OPTIONS_FILE = "/Options.json"
    SCENE_EVENT_MARKER = "/EVENTPOOL/"
    SCENE_MOUSE_KEYSYMS = {
        "Left": "mouseup_1",
        "Middle": "mouseup_2",
        "Right": "mouseup_3",
        "WheelUp": "mousedown_4",
        "WheelDown": "mousedown_5",
    }

    def scene_read_json(path):
        handle = renpy.file(path, encoding="utf-8-sig")
        try:
            return json.load(handle)
        finally:
            handle.close()


    def scene_load_catalog():
        files = set(renpy.list_files())
        project = scene_read_json(SCENE_PROJECT_FILE) if SCENE_PROJECT_FILE in files else {}
        stats = scene_read_json(SCENE_STATS_FILE) if SCENE_STATS_FILE in files else {}
        memories = scene_read_json(SCENE_MEMORIES_FILE) if SCENE_MEMORIES_FILE in files else {
            SCENE_DEFAULT_MEMORY: {"Name": "Memory"},
        }
        nodes = {}
        node_directories = {}
        global_node = (
            scene_read_json(SCENE_GLOBAL_NODE_FILE)
            if SCENE_GLOBAL_NODE_FILE in files
            else {"ID": SCENE_GLOBAL_NODE_ID, "Name": "GLOBAL"}
        )
        if str(global_node.get("ID") or "").strip() != SCENE_GLOBAL_NODE_ID:
            raise Exception("Global Node ID must be {}.".format(SCENE_GLOBAL_NODE_ID))

        for path in sorted(files):
            if not path.startswith(SCENE_NODE_ROOT) or not path.endswith(SCENE_NODE_FILE):
                continue
            node = scene_read_json(path)
            node_id = str(node.get("ID") or "").strip()
            if not node_id:
                raise Exception("Scene Node is missing an ID: {}".format(path))
            if node_id in nodes:
                raise Exception("Duplicate Scene Node ID: {}".format(node_id))
            nodes[node_id] = node
            node_directories[path[:-len(SCENE_NODE_FILE)]] = node_id

        events = dict((node_id, []) for node_id in nodes)
        global_events = []
        for path in sorted(files):
            if path.startswith(SCENE_GLOBAL_EVENT_ROOT) and path.endswith(".json"):
                global_events.append(scene_read_json(path))
                continue
            if not path.startswith(SCENE_NODE_ROOT) or SCENE_EVENT_MARKER not in path or not path.endswith(".json"):
                continue
            directory = path.split(SCENE_EVENT_MARKER, 1)[0]
            node_id = node_directories.get(directory)
            if node_id is not None:
                events[node_id].append(scene_read_json(path))

        options = {}
        for directory, node_id in node_directories.items():
            options_path = directory + SCENE_OPTIONS_FILE
            if options_path in files:
                options[node_id] = scene_read_json(options_path)
            else:
                options[node_id] = {"Version": 2, "Canvas": {}, "Elements": []}

        return {
            "project": project,
            "stats": stats,
            "memories": memories,
            "nodes": nodes,
            "events": events,
            "global_node": global_node,
            "global_events": global_events,
            "options": options,
        }


    scene_catalog = scene_load_catalog()


    def scene_reload_catalog():
        global scene_catalog
        scene_catalog = scene_load_catalog()
        return scene_catalog


    def scene_reset_state():
        global scene_stats
        global scene_memories
        global scene_memory_legacy_migrated
        global scene_stack
        global scene_option_adjustments
        global scene_enabled_options

        scene_stats = dict(
            (stat_id, settings.get("Init", 0))
            for stat_id, settings in scene_catalog["stats"].items()
        )
        scene_memories = dict((bank_id, []) for bank_id in scene_catalog["memories"])
        scene_memory_legacy_migrated = True
        scene_stack = []
        scene_option_adjustments = {}
        scene_enabled_options = []


    def scene_get_stat(stat_id, default=0):
        return scene_stats.get(stat_id, default)


    def scene_ensure_memory_state():
        global scene_memories
        global scene_memory_legacy_migrated

        current = scene_memories if isinstance(scene_memories, dict) else {}
        updated = dict((bank_id, list(tags)) for bank_id, tags in current.items())
        for bank_id in scene_catalog["memories"]:
            updated.setdefault(bank_id, [])

        if not scene_memory_legacy_migrated:
            legacy_tags = []
            for variable in ("scene_tags_permanent", "scene_tags_daily", "scene_tags_weekly"):
                for tag_id in getattr(renpy.store, variable, []) or []:
                    if tag_id not in legacy_tags:
                        legacy_tags.append(tag_id)
            default_tags = updated.setdefault(SCENE_DEFAULT_MEMORY, [])
            for tag_id in legacy_tags:
                if tag_id not in default_tags:
                    default_tags.append(tag_id)
            scene_memory_legacy_migrated = True

        scene_memories = updated


    def scene_memory_bank(bank_id):
        bank_id = str(bank_id or SCENE_DEFAULT_MEMORY).strip()
        if bank_id not in scene_catalog["memories"]:
            raise Exception("Unknown Memory bank: {}".format(bank_id))
        return bank_id


    def scene_memory_tag(tag_id):
        tag_id = str(tag_id or "").strip()
        if not tag_id:
            raise Exception("Memory tag cannot be empty.")
        return tag_id


    def scene_memory_has(bank_id, tag_id):
        scene_ensure_memory_state()
        bank_id = scene_memory_bank(bank_id)
        tag_id = scene_memory_tag(tag_id)
        return tag_id in scene_memories.get(bank_id, [])


    def scene_memory_add(bank_id, tag_id):
        global scene_memories

        scene_ensure_memory_state()
        bank_id = scene_memory_bank(bank_id)
        tag_id = scene_memory_tag(tag_id)
        updated = dict((key, list(tags)) for key, tags in scene_memories.items())
        tags = updated.setdefault(bank_id, [])
        if tag_id not in tags:
            tags.append(tag_id)
        scene_memories = updated


    def scene_memory_remove(bank_id, tag_id):
        global scene_memories

        scene_ensure_memory_state()
        bank_id = scene_memory_bank(bank_id)
        tag_id = scene_memory_tag(tag_id)
        updated = dict((key, list(tags)) for key, tags in scene_memories.items())
        updated[bank_id] = [item for item in updated.get(bank_id, []) if item != tag_id]
        scene_memories = updated


    def scene_memory_clear(bank_id):
        global scene_memories

        scene_ensure_memory_state()
        bank_id = scene_memory_bank(bank_id)
        updated = dict((key, list(tags)) for key, tags in scene_memories.items())
        updated[bank_id] = []
        scene_memories = updated


    def scene_condition_matches(condition):
        condition_type = str(condition.get("type") or "").lower()
        operation = str(condition.get("op") or "")

        if condition_type in ("memory", "tag"):
            bank_id = condition.get("bank", SCENE_DEFAULT_MEMORY)
            if operation == "has":
                return scene_memory_has(bank_id, condition.get("id"))
            if operation == "not_has":
                return not scene_memory_has(bank_id, condition.get("id"))
            return False

        if condition_type != "stat":
            return False

        stat_id = condition.get("id")
        if stat_id not in scene_stats:
            return False
        left = scene_stats[stat_id]
        right = condition.get("value")

        try:
            if operation == ">":
                return left > right
            if operation == ">=":
                return left >= right
            if operation == "<":
                return left < right
            if operation == "<=":
                return left <= right
            if operation == "==":
                return left == right
            if operation == "!=":
                return left != right
        except TypeError:
            return False
        return False


    def scene_conditions_match(conditions):
        return all(scene_condition_matches(item) for item in (conditions or []))


    def scene_event_once_memory(event, owner_node_id=None):
        event_id = event.get("ID")
        if owner_node_id == SCENE_GLOBAL_NODE_ID:
            return "once:global:{}".format(event_id)
        return "once:{}".format(event_id)


    def scene_event_matches(event, trigger, owner_node_id=None):
        if event.get("Trigger") != trigger:
            return False
        if owner_node_id == SCENE_GLOBAL_NODE_ID and str(event.get("Trigger") or "").startswith("Action:"):
            return False
        if event.get("Once") and scene_memory_has(
            SCENE_DEFAULT_MEMORY,
            scene_event_once_memory(event, owner_node_id),
        ):
            return False
        return all(scene_condition_matches(item) for item in event.get("Conditions", []))


    def scene_weighted_pair(pairs):
        available = []
        total = 0.0
        for value, raw_weight in pairs:
            try:
                weight = float(raw_weight)
            except (TypeError, ValueError):
                continue
            if weight <= 0:
                continue
            available.append((value, weight))
            total += weight

        if not available:
            return None

        threshold = renpy.random.random() * total
        cursor = 0.0
        for value, weight in available:
            cursor += weight
            if threshold < cursor:
                return value
        return available[-1][0]


    def scene_weighted_value(value):
        if value is None or isinstance(value, str):
            return value
        if hasattr(value, "items"):
            return scene_weighted_pair(value.items())
        raise Exception("Weighted value must be null, a string, or an object.")


    def scene_select_event(node_id, trigger):
        matches = []
        for event in scene_catalog["events"].get(node_id, []):
            if scene_event_matches(event, trigger, node_id):
                matches.append(event)
        for event in scene_catalog.get("global_events", []):
            if scene_event_matches(event, trigger, SCENE_GLOBAL_NODE_ID):
                matches.append(event)
        if not matches:
            return None

        priority = min(int(event.get("Priority", 5)) for event in matches)
        candidates = [event for event in matches if int(event.get("Priority", 5)) == priority]
        return scene_weighted_pair(
            (event, event.get("Weight", 1))
            for event in candidates
        )


    def scene_lifecycle_events(node_id, trigger):
        matches = []
        for owner_node_id, events in (
            (node_id, scene_catalog["events"].get(node_id, [])),
            (SCENE_GLOBAL_NODE_ID, scene_catalog.get("global_events", [])),
        ):
            for event in events:
                if scene_event_matches(event, trigger, owner_node_id):
                    matches.append((owner_node_id, event))
        matches.sort(key=lambda item: (
            int(item[1].get("Priority", 5)),
            str(item[1].get("ID") or ""),
            str(item[0]),
        ))
        return [
            scene_prepare_event(node_id, event, owner_node_id=owner_node_id)
            for owner_node_id, event in matches
        ]


    def scene_input_bindings(node_id):
        bindings = []
        seen = set()
        available = (
            list(scene_catalog["events"].get(node_id, []))
            + list(scene_catalog.get("global_events", []))
        )
        for event in available:
            trigger = str(event.get("Trigger") or "").strip()
            keysym = None
            if trigger.startswith("Keyboard:"):
                keysym = trigger.split(":", 1)[1].strip()
            elif trigger.startswith("Mouse:"):
                keysym = SCENE_MOUSE_KEYSYMS.get(trigger.split(":", 1)[1].strip())
            if not keysym or (keysym, trigger) in seen:
                continue
            seen.add((keysym, trigger))
            bindings.append((keysym, trigger))
        return bindings


    def scene_prepare_event(node_id, event, owner_node_id=None):
        if owner_node_id is None:
            owner_node_id = (
                SCENE_GLOBAL_NODE_ID
                if any(event is item for item in scene_catalog.get("global_events", []))
                else node_id
            )
        return {
            "node_id": node_id,
            "owner_node_id": owner_node_id,
            "event": event,
            "content": scene_weighted_value(event.get("Content")),
            "end_up": event.get("End up", "REDO"),
            "next_node": scene_weighted_value(event.get("Next Node")),
        }


    def scene_validate_prepared_transition(prepared):
        end_up = prepared["end_up"]
        if end_up not in ("GOTO", "REPLACE"):
            return

        next_node = prepared["next_node"]
        if not next_node:
            raise Exception("{} Event did not select a Next Node.".format(end_up))
        scene_get_node(next_node)

        if end_up == "REPLACE" and len(scene_stack) <= 1:
            raise Exception(
                "REPLACE requires a parent Scene Node; current stack depth is {}.".format(len(scene_stack))
            )


    def scene_apply_stat_effect(effect):
        global scene_stats

        stat_id = effect.get("id")
        if stat_id not in scene_catalog["stats"]:
            raise Exception("Unknown Stat ID: {}".format(stat_id))

        operation = effect.get("op")
        value = effect.get("value", 0)
        current = scene_stats.get(stat_id, scene_catalog["stats"][stat_id].get("Init", 0))

        if operation == "set":
            result = value
        elif operation == "+":
            result = current + value
        elif operation == "-":
            result = current - value
        elif operation == "*":
            result = current * value
        elif operation == "/":
            if value == 0:
                raise Exception("Stat effect cannot divide by zero: {}".format(stat_id))
            result = current / value
        else:
            raise Exception("Unknown Stat operation: {}".format(operation))

        settings = scene_catalog["stats"][stat_id]
        result = max(settings.get("Min", result), min(settings.get("Max", result), result))
        updated = dict(scene_stats)
        updated[stat_id] = result
        scene_stats = updated


    def scene_option_key(node_id, element_id, item_id=None):
        return json.dumps(
            [str(node_id or ""), str(element_id or ""), str(item_id or "")],
            separators=(",", ":"),
        )


    def scene_option_target(effect):
        node_id = str(effect.get("node") or "").strip()
        element_id = str(effect.get("element") or "").strip()
        target = str(effect.get("target") or "element").lower()
        item_id = str(effect.get("item") or "").strip() if target == "item" else None

        if node_id not in scene_catalog["nodes"]:
            raise Exception("Unknown Option Effect Scene Node: {}".format(node_id))
        if target not in ("element", "item"):
            raise Exception("Unknown Option Effect target: {}".format(target))

        element = next(
            (
                item
                for item in scene_option_data(node_id).get("Elements", [])
                if item.get("ID") == element_id
            ),
            None,
        )
        if element is None:
            raise Exception(
                "Unknown Option Element: {}/{}".format(node_id, element_id)
            )

        option = element
        if target == "item":
            if element.get("Type") != "TEXTBOX":
                raise Exception(
                    "Option Item target requires a TEXTBOX Element: {}/{}".format(
                        node_id,
                        element_id,
                    )
                )
            option = next(
                (item for item in element.get("Items", []) if item.get("ID") == item_id),
                None,
            )
            if option is None:
                raise Exception(
                    "Unknown Option Item: {}/{}/{}".format(node_id, element_id, item_id)
                )

        if str(option.get("Availability") or "ALWAYS").upper() != "CONTROLLED":
            raise Exception(
                "Option Effect target is not CONTROLLED: {}".format(
                    "/".join(value for value in (node_id, element_id, item_id) if value)
                )
            )
        return scene_option_key(node_id, element_id, item_id)


    def scene_apply_option_effect(effect):
        global scene_enabled_options

        key = scene_option_target(effect)
        operation = str(effect.get("op") or "").lower()
        enabled = list(scene_enabled_options or [])
        if operation == "enable":
            if key not in enabled:
                enabled.append(key)
        elif operation == "disable":
            enabled = [item for item in enabled if item != key]
        else:
            raise Exception("Unknown Option operation: {}".format(operation))
        scene_enabled_options = enabled


    def scene_apply_effect(node_id, effect):
        effect_type = str(effect.get("type") or "").lower()
        if effect_type == "stat":
            scene_apply_stat_effect(effect)
        elif effect_type in ("memory", "tag"):
            operation = effect.get("op")
            bank_id = effect.get("bank", SCENE_DEFAULT_MEMORY)
            if operation == "add":
                scene_memory_add(bank_id, effect.get("id"))
            elif operation == "remove":
                scene_memory_remove(bank_id, effect.get("id"))
            elif operation == "clear":
                scene_memory_clear(bank_id)
            else:
                raise Exception("Unknown Memory operation: {}".format(operation))
        elif effect_type == "option":
            scene_apply_option_effect(effect)
        else:
            raise Exception("Unknown Effect type: {}".format(effect_type))


    def scene_apply_prepared(prepared):
        event = prepared["event"]
        if event.get("Once"):
            scene_memory_add(
                SCENE_DEFAULT_MEMORY,
                scene_event_once_memory(event, prepared.get("owner_node_id")),
            )
        for effect in event.get("Effects", []):
            scene_apply_effect(prepared["node_id"], effect)


    def scene_get_node(node_id):
        try:
            return scene_catalog["nodes"][node_id]
        except KeyError:
            raise Exception("Unknown Scene Node ID: {}".format(node_id))


    def scene_current_node_id():
        return scene_stack[-1] if scene_stack else None


    def scene_current_node():
        node_id = scene_current_node_id()
        return scene_get_node(node_id) if node_id else {}


    def scene_default_root_node():
        root_node = str(scene_catalog.get("project", {}).get("Root Node") or "").strip()
        if not root_node:
            raise Exception(
                "No Root Node is configured. Set DATA/SceneProject.json or pass a Node ID to scene_runtime_start()."
            )
        return root_node


    def scene_begin(root_node=None):
        global scene_stack

        scene_reset_state()
        if root_node is None:
            root_node = scene_default_root_node()
        scene_get_node(root_node)
        scene_stack = [root_node]


    def scene_resolve_prepared(prepared):
        global scene_stack

        end_up = prepared["end_up"]
        if end_up == "REDO":
            return

        if end_up == "GOTO":
            scene_stack = scene_stack + [prepared["next_node"]]
        elif end_up == "REPLACE":
            scene_stack = scene_stack[:-1] + [prepared["next_node"]]
        elif end_up == "EXIT":
            scene_stack = scene_stack[:-1]
        else:
            raise Exception("Unknown End up value: {}".format(end_up))


    def scene_option_data(node_id):
        return scene_catalog["options"].get(
            node_id,
            {"Version": 2, "Canvas": {}, "Elements": []},
        )


    def scene_option_is_available(node_id, element, item=None):
        option = item if item is not None else element
        if str(option.get("Availability") or "ALWAYS").upper() != "CONTROLLED":
            return True
        key = scene_option_key(
            node_id,
            element.get("ID"),
            item.get("ID") if item is not None else None,
        )
        return key in (scene_enabled_options or [])


    def scene_option_visible_items(node_id, element):
        if not scene_option_is_available(node_id, element):
            return []
        return [
            item
            for item in element.get("Items", [])
            if scene_option_is_available(node_id, element, item)
        ]


    def scene_option_scale(node_id):
        canvas = scene_option_data(node_id).get("Canvas", {})
        width = max(1.0, float(canvas.get("Width", 1920)))
        height = max(1.0, float(canvas.get("Height", 1080)))
        return (
            float(config.screen_width) / width,
            float(config.screen_height) / height,
        )


    def scene_option_rect(node_id, element):
        layout = element.get("Layout", {})
        scale_x, scale_y = scene_option_scale(node_id)
        return (
            int(round(float(layout.get("X", 0)) * scale_x)),
            int(round(float(layout.get("Y", 0)) * scale_y)),
            max(1, int(round(float(layout.get("Width", 1)) * scale_x))),
            max(1, int(round(float(layout.get("Height", 1)) * scale_y))),
        )


    def scene_option_pixel(node_id, value, axis="uniform"):
        scale_x, scale_y = scene_option_scale(node_id)
        scale = scale_x if axis == "x" else scale_y if axis == "y" else min(scale_x, scale_y)
        return max(1, int(round(float(value) * scale)))


    def scene_option_item_style(element, item, key, default):
        override = item.get("Style Override", {}) if item else {}
        return override.get(key, element.get("Style", {}).get(key, default))


    def scene_option_composite_color(base, overlay):
        def rgba(value, fallback):
            text = str(value or fallback).lstrip("#")
            if len(text) == 6:
                text += "ff"
            if len(text) != 8:
                text = fallback.lstrip("#")
                if len(text) == 6:
                    text += "ff"
            try:
                return tuple(int(text[index:index + 2], 16) / 255.0 for index in range(0, 8, 2))
            except ValueError:
                return (0.0, 0.0, 0.0, 0.0)

        base_rgba = rgba(base, "#00000000")
        overlay_rgba = rgba(overlay, "#ffffff18")
        output_alpha = overlay_rgba[3] + base_rgba[3] * (1.0 - overlay_rgba[3])
        if output_alpha <= 0:
            return "#00000000"
        channels = [
            (overlay_rgba[index] * overlay_rgba[3] + base_rgba[index] * base_rgba[3] * (1.0 - overlay_rgba[3])) / output_alpha
            for index in range(3)
        ]
        values = [int(round(max(0.0, min(1.0, channel)) * 255.0)) for channel in channels]
        values.append(int(round(max(0.0, min(1.0, output_alpha)) * 255.0)))
        return "#{:02x}{:02x}{:02x}{:02x}".format(*values)


    def scene_option_hover_displayable(base, color, width, height):
        return Composite(
            (width, height),
            (0, 0), base,
            (0, 0), Solid(color, xsize=width, ysize=height),
        )


    def scene_option_image(path, width, height, fit="CONTAIN", opacity=1.0, tint="#ffffff"):
        if not path:
            return Solid("#00000000", xsize=width, ysize=height)
        fit_name = str(fit or "CONTAIN").lower()
        properties = {
            "xysize": (width, height),
            "alpha": float(opacity),
            "matrixcolor": TintMatrix(tint),
        }
        if fit_name != "stretch":
            properties["fit"] = fit_name
        return Transform(path, **properties)


    def scene_option_prepare_adjustments(node_id):
        global scene_option_adjustments

        updated = dict(scene_option_adjustments)
        for element in scene_option_data(node_id).get("Elements", []):
            if element.get("Type") != "TEXTBOX":
                continue
            key = "{}:{}".format(node_id, element.get("ID"))
            updated[key] = ui.adjustment()
        scene_option_adjustments = updated


    def scene_option_adjustment(node_id, element):
        key = "{}:{}".format(node_id, element.get("ID"))
        return scene_option_adjustments.get(key)


    def scene_call_option_screen(node_id):
        scene_option_prepare_adjustments(node_id)
        return renpy.call_screen(
            "scene_option_renderer",
            node_id=node_id,
            input_bindings=scene_input_bindings(node_id),
        )


    def scene_missing_event(node_id, trigger):
        raise Exception(
            "No Event matched Trigger {!r} in Scene Node {!r}. Add an unconditional fallback Event.".format(
                trigger,
                node_id,
            )
        )


default scene_stats = {}
default scene_memories = {}
default scene_memory_legacy_migrated = False
default scene_stack = []
default scene_option_adjustments = {}
default scene_enabled_options = []


label scene_run_lifecycle(node_id, trigger):
    $ _scene_lifecycle_queue = scene_lifecycle_events(node_id, trigger)

    while _scene_lifecycle_queue:
        $ _scene_lifecycle_prepared = _scene_lifecycle_queue[0]
        $ _scene_lifecycle_queue = _scene_lifecycle_queue[1:]
        $ scene_apply_prepared(_scene_lifecycle_prepared)

        if _scene_lifecycle_prepared["content"]:
            call expression _scene_lifecycle_prepared["content"]

    return


label scene_runtime_start(root_node=None):
    $ scene_begin(root_node)
    $ _scene_enter_pending = True

    while scene_stack:
        $ _scene_node_id = scene_current_node_id()
        $ _scene_node = scene_current_node()

        if _scene_enter_pending:
            call scene_run_lifecycle(_scene_node_id, "Auto:Enter")
            $ _scene_enter_pending = False

        $ _scene_event = scene_select_event(_scene_node_id, "Auto:Node")

        if _scene_event is None:
            $ _scene_trigger = scene_call_option_screen(_scene_node_id)
            $ _scene_event = scene_select_event(_scene_node_id, _scene_trigger)
            if _scene_event is None:
                $ scene_missing_event(_scene_node_id, _scene_trigger)

        $ _scene_prepared = scene_prepare_event(_scene_node_id, _scene_event)
        $ scene_apply_prepared(_scene_prepared)

        if _scene_prepared["content"]:
            call expression _scene_prepared["content"]

        $ scene_validate_prepared_transition(_scene_prepared)

        if _scene_prepared["end_up"] in ("EXIT", "REPLACE"):
            call scene_run_lifecycle(_scene_node_id, "Auto:Exit")

        $ _scene_transition = _scene_prepared["end_up"]
        $ scene_resolve_prepared(_scene_prepared)
        $ _scene_enter_pending = _scene_transition in ("GOTO", "REPLACE")

    return
