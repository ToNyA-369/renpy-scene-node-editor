init -100 python:
    import json
    import math
    from collections.abc import Mapping, MutableSequence

    SCENE_PROJECT_FILE = "DATA/SceneProject.json"
    SCENE_STATS_FILE = "DATA/Stats.json"
    SCENE_MEMORIES_FILE = "DATA/Memories.json"
    SCENE_TEXTBOX_PROFILE_ROOT = "DATA/TEXTBOX_PROFILES/"
    SCENE_DEFAULT_MEMORY = "memory"
    SCENE_GLOBAL_NODE_ID = "__global__"
    SCENE_GLOBAL_NODE_FILE = "GLOBALNODE/Node.json"
    SCENE_GLOBAL_OPTIONS_FILE = "GLOBALNODE/Options.json"
    SCENE_GLOBAL_EVENT_ROOT = "GLOBALNODE/EVENTPOOL/"
    SCENE_NODE_ROOT = "SCENENODE/"
    SCENE_NODE_FILE = "/Node.json"
    SCENE_OPTIONS_FILE = "/Options.json"
    SCENE_EVENT_MARKER = "/EVENTPOOL/"
    SCENE_TEXTBOX_STYLE_DEFAULTS = {
        "Background": "#0b1118",
        "Item Background": "#20302a",
        "Text Color": "#ffffff",
        "Text Size": 30,
        "Text Align": 0.5,
    }
    SCENE_TEXTBOX_FEATURE_DEFAULTS = {
        "hover_accent": {"Enabled": False, "Color": "#5c7265", "Width": 6},
        "hover_text_color": {"Enabled": False, "Color": "#ffffff"},
        "item_border": {"Enabled": False, "Color": "#ffffff33", "Width": 1},
        "item_corners": {"Enabled": False, "Radius": 12},
        "text_padding": {"Enabled": False, "X": 24},
        "text_bold": {"Enabled": False},
        "text_italic": {"Enabled": False},
        "text_spacing": {"Enabled": False, "Spacing": 0},
        "text_shadow": {"Enabled": False, "Color": "#00000088", "Size": 2, "X": 0, "Y": 2},
        "text_outline": {"Enabled": False, "Color": "#000000cc", "Size": 1},
        "staggered_entrance": {"Enabled": False, "Distance": 18, "Delay": 0.04, "Duration": 0.22},
    }
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


    def scene_textbox_profile_number(value, minimum, maximum, integer=False):
        if isinstance(value, bool):
            raise ValueError("boolean is not a profile number")
        result = float(value)
        if not math.isfinite(result) or result < minimum or result > maximum:
            raise ValueError("profile number is out of range")
        return int(result) if integer else result


    def scene_normalize_textbox_profile(profile, filename_id):
        # Ren'Py replaces the name ``dict`` with RevertableDict inside store
        # Python, while json.load() returns a native Python dict. Checking
        # against ``dict`` therefore rejects valid JSON at runtime. Mapping
        # accepts both native JSON objects and Ren'Py's revertable mappings.
        if not isinstance(profile, Mapping):
            return None
        profile_id = str(profile.get("ID") or "").strip()
        if not profile_id or profile_id != filename_id or not str(profile.get("Name") or "").strip():
            return None
        try:
            raw_style = profile.get("Style", {})
            raw_features = profile.get("Features", {})
            if not isinstance(raw_style, Mapping) or not isinstance(raw_features, Mapping):
                return None
            style = dict(SCENE_TEXTBOX_STYLE_DEFAULTS)
            for key in ("Background", "Item Background", "Text Color"):
                if key in raw_style:
                    style[key] = str(raw_style[key])
            style["Text Size"] = scene_textbox_profile_number(raw_style.get("Text Size", 30), 8, 160, True)
            style["Text Align"] = scene_textbox_profile_number(raw_style.get("Text Align", 0.5), 0, 1)

            features = {}
            for feature_id, defaults in SCENE_TEXTBOX_FEATURE_DEFAULTS.items():
                raw = raw_features.get(feature_id, {})
                if not isinstance(raw, Mapping):
                    return None
                feature = dict(defaults)
                feature["Enabled"] = bool(raw.get("Enabled", feature["Enabled"]))
                if feature_id in ("hover_accent", "item_border"):
                    feature["Color"] = str(raw.get("Color") or feature["Color"])
                    feature["Width"] = scene_textbox_profile_number(raw.get("Width", feature["Width"]), 1, 40, True)
                elif feature_id == "hover_text_color":
                    feature["Color"] = str(raw.get("Color") or feature["Color"])
                elif feature_id == "text_shadow":
                    feature["Color"] = str(raw.get("Color") or feature["Color"])
                    feature["Size"] = scene_textbox_profile_number(raw.get("Size", feature["Size"]), 0, 20, True)
                    feature["X"] = scene_textbox_profile_number(raw.get("X", feature["X"]), -40, 40, True)
                    feature["Y"] = scene_textbox_profile_number(raw.get("Y", feature["Y"]), -40, 40, True)
                elif feature_id == "text_outline":
                    feature["Color"] = str(raw.get("Color") or feature["Color"])
                    feature["Size"] = scene_textbox_profile_number(raw.get("Size", feature["Size"]), 0, 20, True)
                elif feature_id == "item_corners":
                    feature["Radius"] = scene_textbox_profile_number(raw.get("Radius", feature["Radius"]), 0, 200, True)
                elif feature_id == "text_padding":
                    feature["X"] = scene_textbox_profile_number(raw.get("X", feature["X"]), 0, 200, True)
                elif feature_id == "text_spacing":
                    feature["Spacing"] = scene_textbox_profile_number(raw.get("Spacing", feature["Spacing"]), -5, 30)
                elif feature_id == "staggered_entrance":
                    feature["Distance"] = scene_textbox_profile_number(raw.get("Distance", feature["Distance"]), -200, 200, True)
                    feature["Delay"] = scene_textbox_profile_number(raw.get("Delay", feature["Delay"]), 0, 1)
                    feature["Duration"] = scene_textbox_profile_number(raw.get("Duration", feature["Duration"]), 0, 3)
                features[feature_id] = feature
            return {"Version": 1, "ID": profile_id, "Name": str(profile["Name"]), "Style": style, "Features": features}
        except (TypeError, ValueError):
            return None


    def scene_load_catalog():
        files = set(renpy.list_files())
        project = scene_read_json(SCENE_PROJECT_FILE) if SCENE_PROJECT_FILE in files else {}
        stats = scene_read_json(SCENE_STATS_FILE) if SCENE_STATS_FILE in files else {}
        memories = scene_read_json(SCENE_MEMORIES_FILE) if SCENE_MEMORIES_FILE in files else {
            SCENE_DEFAULT_MEMORY: {"Name": "Memory"},
        }
        textbox_profiles = {}
        for path in sorted(files):
            if not path.startswith(SCENE_TEXTBOX_PROFILE_ROOT) or not path.endswith(".json"):
                continue
            try:
                profile = scene_read_json(path)
            except Exception:
                continue
            filename_id = path[len(SCENE_TEXTBOX_PROFILE_ROOT):-5]
            normalized = scene_normalize_textbox_profile(profile, filename_id)
            if normalized is not None:
                textbox_profiles[normalized["ID"]] = normalized
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

        options = {
            SCENE_GLOBAL_NODE_ID: (
                scene_read_json(SCENE_GLOBAL_OPTIONS_FILE)
                if SCENE_GLOBAL_OPTIONS_FILE in files
                else {"Version": 3, "Canvas": {}, "Elements": []}
            )
        }
        for directory, node_id in node_directories.items():
            options_path = directory + SCENE_OPTIONS_FILE
            if options_path in files:
                options[node_id] = scene_read_json(options_path)
            else:
                options[node_id] = {"Version": 3, "Canvas": {}, "Elements": []}

        for event in global_events + [item for pool in events.values() for item in pool]:
            if type(event.get("Version", 1)) is not int or event.get("Version", 1) not in (1, 2, 3):
                raise Exception("Unsupported Event Version: {} ({})".format(event.get("Version"), event.get("ID")))

        return {
            "project": project,
            "stats": stats,
            "memories": memories,
            "textbox_profiles": textbox_profiles,
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


    def scene_stat_number(stat_id, value, role):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise Exception(
                "Stat {} {} must be a finite number: {!r}".format(stat_id, role, value)
            )
        if isinstance(value, float) and not math.isfinite(value):
            raise Exception(
                "Stat {} {} must be a finite number: {!r}".format(stat_id, role, value)
            )
        return value


    def scene_change_stat(stat_id, operation, value):
        global scene_stats

        stat_id = str(stat_id or "").strip()
        if stat_id not in scene_catalog["stats"]:
            raise Exception("Unknown Stat ID: {}".format(stat_id))

        operation = str(operation or "")
        value = scene_stat_number(stat_id, value, "operand")
        settings = scene_catalog["stats"][stat_id]
        current = scene_stat_number(
            stat_id,
            scene_stats.get(stat_id, settings.get("Init", 0)),
            "current value",
        )

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
                raise Exception("Stat cannot divide by zero: {}".format(stat_id))
            result = current / value
        else:
            raise Exception("Unknown Stat operation: {}".format(operation))

        result = scene_stat_number(stat_id, result, "result")
        minimum = scene_stat_number(stat_id, settings.get("Min", result), "minimum")
        maximum = scene_stat_number(stat_id, settings.get("Max", result), "maximum")
        result = max(minimum, min(maximum, result))
        updated = dict(scene_stats)
        updated[stat_id] = result
        scene_stats = updated
        return result


    def scene_numeric_value(value, allow_calculation=True):
        """Internal, bounded expression evaluation. Never executes creator code."""
        if isinstance(value, Mapping):
            if value.get("type") == "stat" and set(value) == {"type", "id"}:
                stat_id = value["id"]
                if not isinstance(stat_id, str) or stat_id not in scene_catalog["stats"]:
                    raise Exception("Unknown expression Stat ID: {!r}".format(stat_id))
                if stat_id not in scene_stats:
                    raise Exception("Missing expression Stat value: {}".format(stat_id))
                return scene_stat_number(stat_id, scene_stats[stat_id], "expression value")
            if (allow_calculation and value.get("type") == "calc"
                    and set(value) == {"type", "op", "left", "right"}):
                left = scene_numeric_value(value["left"], False)
                right = scene_numeric_value(value["right"], False)
                operation = value["op"]
                if operation in ("/", "%") and right == 0:
                    raise Exception("Numeric expression divisor cannot be zero: {!r}".format(value))
                if operation == "+":
                    result = left + right
                elif operation == "-":
                    result = left - right
                elif operation == "*":
                    result = left * right
                elif operation == "/":
                    result = left / right
                elif operation == "%":
                    result = left % right
                else:
                    raise Exception("Unknown numeric expression operation: {!r}".format(operation))
                return scene_stat_number("expression", result, "result")
            raise Exception("Only one numeric operation is allowed: {!r}".format(value))
        return scene_stat_number("expression", value, "operand")


    def scene_ensure_memory_state():
        global scene_memories
        global scene_memory_legacy_migrated

        current = scene_memories if isinstance(scene_memories, Mapping) else {}
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


    def scene_memory_tags(bank_id):
        scene_ensure_memory_state()
        bank_id = scene_memory_bank(bank_id)
        return tuple(scene_memories.get(bank_id, []))


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
            if operation == "empty":
                return not scene_memory_tags(bank_id)
            if operation == "not_empty":
                return bool(scene_memory_tags(bank_id))
            return False

        if condition_type != "stat":
            return False

        # Keep the missing-ID behavior of legacy numeric-only Conditions.
        if "left" not in condition and not isinstance(condition.get("value"), Mapping):
            stat_id = condition.get("id")
            if stat_id not in scene_stats:
                return False
            left = scene_stats[stat_id]
        else:
            left = scene_numeric_value(condition.get("left", {"type": "stat", "id": condition.get("id")}))
        right = scene_numeric_value(condition.get("value"))

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
        items = list(conditions or [])
        if not items:
            return True
        if all("clause" not in item for item in items):
            return all(scene_condition_matches(item) for item in items)

        clauses = []
        grouped = {}
        for index, condition in enumerate(items):
            clause_id = str(condition.get("clause") or "").strip()
            key = ("group", clause_id) if clause_id else ("single", index)
            if key not in grouped:
                grouped[key] = []
                clauses.append(grouped[key])
            grouped[key].append(condition)
        return any(
            all(scene_condition_matches(condition) for condition in clause)
            for clause in clauses
        )


    def scene_event_once_memory(event, owner_node_id=None):
        event_id = event.get("ID")
        if owner_node_id == SCENE_GLOBAL_NODE_ID:
            return "once:global:{}".format(event_id)
        return "once:{}".format(event_id)


    def scene_event_matches(event, trigger, owner_node_id=None):
        if event.get("Trigger") != trigger:
            return False
        if event.get("Once") and scene_memory_has(
            SCENE_DEFAULT_MEMORY,
            scene_event_once_memory(event, owner_node_id),
        ):
            return False
        try:
            return scene_conditions_match(event.get("Conditions", []))
        except Exception as error:
            raise Exception("Event {} Conditions: {}".format(event.get("ID"), error))


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
        return scene_change_stat(
            effect.get("id"),
            effect.get("op"),
            scene_numeric_value(effect.get("value", 0)),
        )


    def scene_option_key(node_id, element_id, item_id=None):
        return json.dumps(
            [str(node_id or ""), str(element_id or ""), str(item_id or "")],
            separators=(",", ":"),
        )


    def scene_option_widget_id(node_id, element_id):
        return "{}__{}".format(str(node_id or ""), str(element_id or ""))


    def scene_option_target(effect):
        node_id = str(effect.get("node") or "").strip()
        element_id = str(effect.get("element") or "").strip()
        target = str(effect.get("target") or "element").lower()
        item_id = str(effect.get("item") or "").strip() if target == "item" else None

        if node_id not in scene_catalog["options"]:
            raise Exception("Unknown Option Effect scope: {}".format(node_id))
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


    def scene_random_weight(value):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise Exception("Random Effect weight must be a finite number greater than 0.")
        try:
            weight = float(value)
        except (OverflowError, TypeError, ValueError):
            raise Exception("Random Effect weight must be a finite number greater than 0.")
        if not math.isfinite(weight) or weight <= 0:
            raise Exception("Random Effect weight must be a finite number greater than 0.")
        return weight


    def scene_validate_numeric_shape(value, allow_calculation=True):
        if isinstance(value, bool) or not isinstance(value, (int, float, Mapping)):
            raise Exception("Numeric expression operand must be a finite number or Stat reference: {!r}".format(value))
        if isinstance(value, (int, float)):
            try:
                if not math.isfinite(value):
                    raise Exception("Numeric expression operand must be finite: {!r}".format(value))
            except OverflowError:
                raise Exception("Numeric expression operand must be finite: {!r}".format(value))
            return
        if value.get("type") == "stat" and set(value) == {"type", "id"}:
            stat_id = value["id"]
            if not isinstance(stat_id, str) or stat_id not in scene_catalog["stats"]:
                raise Exception("Unknown expression Stat ID: {!r}".format(stat_id))
            return
        if (allow_calculation and value.get("type") == "calc"
                and set(value) == {"type", "op", "left", "right"}
                and value.get("op") in ("+", "-", "*", "/", "%")):
            scene_validate_numeric_shape(value["left"], False)
            scene_validate_numeric_shape(value["right"], False)
            if value["op"] in ("/", "%") and isinstance(value["right"], (int, float)) and not isinstance(value["right"], bool) and value["right"] == 0:
                raise Exception("Numeric expression divisor cannot be zero: {!r}".format(value))
            return
        raise Exception("Only one numeric operation is allowed: {!r}".format(value))


    def scene_validate_effect(node_id, effect, allow_random=True):
        if not isinstance(effect, Mapping):
            raise Exception("Effect must be an object.")
        effect_type = str(effect.get("type") or "").lower()
        if effect_type == "random":
            if not allow_random:
                raise Exception("Random Effect cannot contain a nested Random Effect.")
            choices = effect.get("choices")
            # Ren'Py shadows list with RevertableList; json.load returns built-in lists.
            if not isinstance(choices, MutableSequence) or not choices:
                raise Exception("Random Effect choices must be a non-empty array.")
            for index, choice in enumerate(choices):
                if not isinstance(choice, Mapping) or not isinstance(choice.get("effect"), Mapping):
                    raise Exception("Random Effect choice #{} must include an Effect object.".format(index + 1))
                try:
                    scene_random_weight(choice.get("weight", 1))
                    scene_validate_effect(node_id, choice["effect"], False)
                except Exception as error:
                    raise Exception("Random Effect choice #{}: {}".format(index + 1, error))
            return
        if effect_type == "stat":
            stat_id = str(effect.get("id") or "").strip()
            if stat_id not in scene_catalog["stats"]:
                raise Exception("Unknown Stat ID: {}".format(stat_id))
            operation = str(effect.get("op") or "")
            if operation not in ("set", "+", "-", "*", "/"):
                raise Exception("Unknown Stat operation: {}".format(operation))
            scene_validate_numeric_shape(effect.get("value", 0))
            return
        if effect_type in ("memory", "tag"):
            operation = effect.get("op")
            bank_id = effect.get("bank", SCENE_DEFAULT_MEMORY)
            if operation == "add":
                scene_memory_bank(bank_id)
                scene_memory_tag(effect.get("id"))
            elif operation == "remove":
                scene_memory_bank(bank_id)
                scene_memory_tag(effect.get("id"))
            elif operation == "clear":
                scene_memory_bank(bank_id)
            else:
                raise Exception("Unknown Memory operation: {}".format(operation))
            return
        if effect_type == "option":
            target_node_id = str(effect.get("node") or "").strip()
            if target_node_id != str(node_id or "").strip():
                raise Exception(
                    "Option Effect must target its owning Options scope: {} cannot target {}".format(
                        node_id, target_node_id
                    )
                )
            scene_option_target(effect)
            if str(effect.get("op") or "").lower() not in ("enable", "disable"):
                raise Exception("Unknown Option operation: {}".format(effect.get("op")))
            return
        raise Exception("Unknown Effect type: {}".format(effect_type))


    def scene_random_effect_choice(choices):
        weighted = [(choice["effect"], scene_random_weight(choice.get("weight", 1))) for choice in choices]
        scale = max(weight for _effect, weight in weighted)
        total = sum(weight / scale for _effect, weight in weighted)
        threshold = renpy.random.random() * total
        cursor = 0.0
        for index, (effect, weight) in enumerate(weighted):
            cursor += weight / scale
            if threshold < cursor:
                return index + 1, effect
        return len(weighted), weighted[-1][0]


    def scene_apply_effect(node_id, effect):
        effect_type = str(effect.get("type") or "").lower()
        if effect_type == "random":
            scene_validate_effect(node_id, effect)
            choice_index, selected = scene_random_effect_choice(effect["choices"])
            try:
                scene_apply_effect(node_id, selected)
            except Exception as error:
                raise Exception("Random Effect choice #{}: {}".format(choice_index, error))
        elif effect_type == "stat":
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
            target_node_id = str(effect.get("node") or "").strip()
            if target_node_id != str(node_id or "").strip():
                raise Exception(
                    "Option Effect must target its owning Options scope: {} cannot target {}".format(
                        node_id,
                        target_node_id,
                    )
                )
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
        owner_node_id = prepared.get("owner_node_id") or prepared["node_id"]
        for index, effect in enumerate(event.get("Effects", [])):
            try:
                scene_apply_effect(owner_node_id, effect)
            except Exception as error:
                raise Exception("Event {} Effect #{}: {}".format(event.get("ID"), index + 1, error))


    def scene_get_node(node_id):
        try:
            return scene_catalog["nodes"][node_id]
        except KeyError:
            raise Exception("Unknown Scene Node ID: {}".format(node_id))


    def scene_current_node_id():
        return scene_stack[-1] if scene_stack else None


    def scene_current_node_name(default=""):
        node_id = scene_current_node_id()
        if not node_id:
            return str(default or "")
        node = scene_get_node(node_id)
        return str(node.get("Name") or "").strip() or node_id


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

        # Editor data and reusable Textbox profiles can change while the Ren'Py
        # process is still open (for example, after returning to the main menu).
        # A new Scene Runtime session must begin from the latest project files,
        # rather than the catalog captured during Ren'Py init.
        scene_reload_catalog()
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
            {"Version": 3, "Canvas": {}, "Elements": []},
        )


    def scene_option_scope_ids(node_id):
        scopes = [node_id]
        if node_id != SCENE_GLOBAL_NODE_ID:
            scopes.append(SCENE_GLOBAL_NODE_ID)
        return scopes


    def scene_option_z_order(element):
        try:
            return int(element.get("Layout", {}).get("Z Order", 10))
        except (AttributeError, TypeError, ValueError):
            return 10


    def scene_option_render_elements(node_id):
        elements = []
        for option_node_id in scene_option_scope_ids(node_id):
            elements.extend(
                (option_node_id, element)
                for element in scene_option_data(option_node_id).get("Elements", [])
            )
        return sorted(elements, key=lambda entry: scene_option_z_order(entry[1]))


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


    def scene_option_textbox_profile(element):
        appearance = element.get("Appearance", {})
        profile_id = str(appearance.get("Profile") or "").strip()
        return scene_catalog.get("textbox_profiles", {}).get(profile_id)


    def scene_option_textbox_style(element):
        result = dict(SCENE_TEXTBOX_STYLE_DEFAULTS)
        profile = scene_option_textbox_profile(element)
        if profile is None:
            result.update(element.get("Style", {}))
            return result
        result.update(profile.get("Style", {}))
        result.update(element.get("Appearance", {}).get("Style Overrides", {}))
        return result


    def scene_option_textbox_feature(element, feature_id):
        profile = scene_option_textbox_profile(element)
        if profile is None:
            return {"Enabled": False}
        result = dict(profile.get("Features", {}).get(feature_id, {}))
        override = element.get("Appearance", {}).get("Features", {}).get(feature_id)
        if isinstance(override, bool):
            result["Enabled"] = override
        else:
            result["Enabled"] = bool(result.get("Enabled", False))
        return result


    def scene_option_item_style(element, item, key, default):
        override = item.get("Style Override", {}) if item else {}
        return override.get(key, scene_option_textbox_style(element).get(key, default))


    def scene_option_text_outlines(element):
        result = []
        outline = scene_option_textbox_feature(element, "text_outline")
        if outline.get("Enabled", False) and int(outline.get("Size", 1)) > 0:
            result.append((int(outline.get("Size", 1)), outline.get("Color", "#000000cc"), 0, 0))
        shadow = scene_option_textbox_feature(element, "text_shadow")
        if shadow.get("Enabled", False) and int(shadow.get("Size", 2)) > 0:
            result.append((
                int(shadow.get("Size", 2)),
                shadow.get("Color", "#00000088"),
                int(shadow.get("X", 0)),
                int(shadow.get("Y", 2)),
            ))
        return result


    def scene_option_text_properties(node_id, element):
        # Disabled features leave creator/theme typography untouched.
        properties = {}
        for feature_id, property_name in (("text_bold", "bold"), ("text_italic", "italic")):
            if scene_option_textbox_feature(element, feature_id).get("Enabled", False):
                properties[property_name] = True
        spacing = scene_option_textbox_feature(element, "text_spacing")
        if spacing.get("Enabled", False):
            properties["kerning"] = float(spacing.get("Spacing", 0)) * min(scene_option_scale(node_id))
        return properties


    def scene_option_text_padding(node_id, element, width):
        padding = scene_option_textbox_feature(element, "text_padding")
        if not padding.get("Enabled", False):
            return {}
        value = int(round(float(padding.get("X", 24)) * scene_option_scale(node_id)[0]))
        return {"xpadding": max(0, min(value, (width - 1) // 2))}


    def scene_option_item_background(color, border, width, height, radius=0):
        radius = max(0, min(float(radius), width / 2.0, height / 2.0))
        if radius:
            # SVG keeps rounded edges antialiased, and im.Data shares Ren'Py's
            # image cache. Only the stroke paints the border, never the center.
            def svg_color(value):
                rgba = Color(value).rgba
                return "rgb({},{},{})".format(*(int(round(c * 255)) for c in rgba[:3])), rgba[3]

            fill, alpha = svg_color(color)
            shapes = '<rect width="{}" height="{}" rx="{}" fill="{}" fill-opacity="{}"/>'.format(width, height, radius, fill, alpha)
            if border.get("Enabled", False):
                thickness = max(1, min(int(border.get("Width", 1)), width / 2.0, height / 2.0))
                stroke, stroke_alpha = svg_color(border.get("Color", "#ffffff33"))
                def outline(x, y, w, h, r):
                    return "M {0},{1} H {2} A {8},{8} 0 0 1 {3},{4} V {5} A {8},{8} 0 0 1 {2},{6} H {0} A {8},{8} 0 0 1 {7},{5} V {4} A {8},{8} 0 0 1 {0},{1} Z".format(x + r, y, x + w - r, x + w, y + r, y + h - r, y + h, x, r)

                ring = outline(0, 0, width, height, radius)
                if width > thickness * 2 and height > thickness * 2:
                    ring += " " + outline(thickness, thickness, width - thickness * 2, height - thickness * 2, max(0, radius - thickness))
                # An even-odd ring stays inside the outer corners, including
                # borders thicker than the radius and very small Items.
                shapes += '<path d="{}" fill="{}" fill-opacity="{}" fill-rule="evenodd"/>'.format(ring, stroke, stroke_alpha)
            svg = '<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}">{}</svg>'.format(width, height, shapes)
            return im.Data(svg.encode("utf-8"), "scene-item.svg")
        if not border.get("Enabled", False):
            return Solid(color)
        border_width = max(1, min(int(border.get("Width", 1)), width // 2, height // 2))
        # Match CSS borders: keep the Item fill underneath, and paint only the
        # perimeter. A full border-colored backing leaks through translucent fills.
        border_color = border.get("Color", "#ffffff33")
        horizontal = min(border_width, height)
        vertical = min(border_width, width)
        bottom = max(horizontal, height - horizontal)
        right = max(vertical, width - vertical)
        layers = [(0, 0), Solid(color, xsize=width, ysize=height)]
        strips = [
            (0, 0, width, horizontal),
            (0, bottom, width, height - bottom),
            (0, horizontal, vertical, bottom - horizontal),
            (right, horizontal, width - right, bottom - horizontal),
        ]
        for x, y, strip_width, strip_height in strips:
            if strip_width > 0 and strip_height > 0:
                layers.extend([(x, y), Solid(border_color, xsize=strip_width, ysize=strip_height)])
        return Composite((width, height), *layers)


    def scene_option_item_accent(color, accent_width, width, height, radius):
        accent = Transform(Solid(color), xsize=min(accent_width, width), xalign=0.0)
        if not radius:
            return accent
        return AlphaMask(Composite((width, height), (0, 0), accent),
                         scene_option_item_background("#ffffff", {}, width, height, radius))


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
        for option_node_id in scene_option_scope_ids(node_id):
            for element in scene_option_data(option_node_id).get("Elements", []):
                if element.get("Type") != "TEXTBOX":
                    continue
                key = "{}:{}".format(option_node_id, element.get("ID"))
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

        if _scene_lifecycle_prepared["content"]:
            call expression _scene_lifecycle_prepared["content"]

        $ scene_apply_prepared(_scene_lifecycle_prepared)

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

        if _scene_prepared["content"]:
            call expression _scene_prepared["content"]

        $ scene_apply_prepared(_scene_prepared)
        $ scene_validate_prepared_transition(_scene_prepared)

        if _scene_prepared["end_up"] in ("EXIT", "REPLACE"):
            call scene_run_lifecycle(_scene_node_id, "Auto:Exit")

        $ _scene_transition = _scene_prepared["end_up"]
        $ scene_resolve_prepared(_scene_prepared)
        $ _scene_enter_pending = _scene_transition in ("GOTO", "REPLACE")

    return
