screen scene_option_renderer(node_id):
    modal True
    zorder 100

    fixed:
        xfill True
        yfill True

        for element in scene_option_visible_elements(node_id):
            if element.get("Type") == "TEXTBOX":
                use scene_option_textbox(node_id, element)
            elif element.get("Type") == "PICTURE":
                use scene_option_picture(node_id, element)
            elif element.get("Type") == "HITBOX":
                use scene_option_hitbox(node_id, element)


screen scene_option_textbox(node_id, element):
    $ element_id = element.get("ID", "option_textbox")
    $ rect = scene_option_rect(node_id, element)
    $ settings = element.get("List", {})
    $ items = scene_option_visible_items(element)
    $ maximum = max(1, int(settings.get("Max Visible Items", 4)))
    $ visible_rows = max(1, min(len(items), maximum))
    $ item_height = scene_option_pixel(node_id, settings.get("Item Height", 72), "y")
    $ spacing = scene_option_pixel(node_id, settings.get("Item Spacing", 12), "y") if settings.get("Item Spacing", 12) else 0
    $ padding = scene_option_pixel(node_id, settings.get("Padding", 16), "uniform") if settings.get("Padding", 16) else 0
    $ content_height = visible_rows * item_height + max(0, visible_rows - 1) * spacing
    $ frame_height = content_height + padding * 2
    $ scrollbar_mode = str(settings.get("Scrollbar") or "AUTO").upper()
    $ show_scrollbar = scrollbar_mode == "ALWAYS" or (scrollbar_mode == "AUTO" and len(items) > maximum)
    $ scrollbar_width = scene_option_pixel(node_id, settings.get("Scrollbar Width", 18), "x")
    $ scrollbar_left = str(settings.get("Scrollbar Side") or "RIGHT").upper() == "LEFT"
    $ adjustment = scene_option_adjustment(node_id, element)
    $ style = element.get("Style", {})

    frame:
        id element_id
        pos (rect[0], rect[1])
        xsize rect[2]
        ysize frame_height
        padding (padding, padding)
        background Solid(style.get("Background", "#0b1118"))

        hbox:
            xfill True
            yfill True
            spacing spacing

            if show_scrollbar and scrollbar_left:
                vbar:
                    xsize scrollbar_width
                    yfill True
                    value YScrollValue("{}_viewport".format(element_id))

            viewport:
                id "{}_viewport".format(element_id)
                xfill True
                yfill True
                mousewheel bool(settings.get("Mousewheel", True))
                draggable bool(settings.get("Draggable", True))
                yadjustment adjustment

                vbox:
                    xfill True
                    spacing spacing

                    for item in items:
                        $ icon = item.get("Icon")
                        $ enabled = scene_option_enabled(element, item)
                        button:
                            id item.get("ID", "option_item")
                            xfill True
                            ysize item_height
                            sensitive enabled
                            action Return(item.get("Trigger"))
                            tooltip item.get("Tooltip") or None
                            background Solid(scene_option_item_style(element, item, "Item Background", "#20302a"))
                            hover_background Solid(scene_option_item_style(element, item, "Item Hover Background", "#2d8068"))
                            insensitive_background Solid(scene_option_item_style(element, item, "Item Disabled Background", "#29312e"))

                            fixed:
                                if icon:
                                    add scene_option_image(icon, item_height - 16, item_height - 16):
                                        xpos 8
                                        yalign 0.5

                                text item.get("Text") or item.get("Name") or item.get("ID"):
                                    xfill True
                                    yalign 0.5
                                    xalign float(scene_option_item_style(element, item, "Text Align", 0.5))
                                    text_align float(scene_option_item_style(element, item, "Text Align", 0.5))
                                    size scene_option_pixel(node_id, scene_option_item_style(element, item, "Text Size", 30))
                                    color scene_option_item_style(element, item, "Text Color", "#ffffff")
                                    hover_color scene_option_item_style(element, item, "Text Hover Color", "#ffffff")
                                    insensitive_color scene_option_item_style(element, item, "Text Disabled Color", "#8b948f")

            if show_scrollbar and not scrollbar_left:
                vbar:
                    xsize scrollbar_width
                    yfill True
                    value YScrollValue("{}_viewport".format(element_id))


screen scene_option_picture(node_id, element):
    $ element_id = element.get("ID", "option_picture")
    $ rect = scene_option_rect(node_id, element)
    $ picture = element.get("Picture", {})
    $ picture_fit = picture.get("Fit") if picture.get("Keep Aspect", True) else "STRETCH"
    $ idle = scene_option_image(picture.get("Idle"), rect[2], rect[3], picture_fit, picture.get("Opacity", 1.0), picture.get("Tint", "#ffffff"))
    $ hover = scene_option_image(picture.get("Hover") or picture.get("Idle"), rect[2], rect[3], picture_fit, picture.get("Opacity", 1.0), picture.get("Tint", "#ffffff"), picture.get("Hover Scale", 1.0))
    $ insensitive = scene_option_image(picture.get("Disabled") or picture.get("Idle"), rect[2], rect[3], picture_fit, picture.get("Opacity", 1.0), picture.get("Tint", "#ffffff"))

    imagebutton:
        id element_id
        pos (rect[0], rect[1])
        xysize (rect[2], rect[3])
        idle idle
        hover hover
        insensitive insensitive
        focus_mask bool(picture.get("Alpha Hit Test", False))
        sensitive scene_option_enabled(element)
        action Return(element.get("Trigger"))
        tooltip element.get("Tooltip") or None
        hover_sound element.get("Hover Sound") or None
        activate_sound element.get("Click Sound") or None


screen scene_option_hitbox(node_id, element):
    $ element_id = element.get("ID", "option_hitbox")
    $ rect = scene_option_rect(node_id, element)
    $ hitbox = element.get("Hitbox", {})
    $ hover_path = hitbox.get("Hover Image")

    button:
        id element_id
        pos (rect[0], rect[1])
        xysize (rect[2], rect[3])
        background Solid("#00000000")
        hover_background (scene_option_image(hover_path, rect[2], rect[3]) if hover_path else Solid("#ffffff18"))
        sensitive scene_option_enabled(element)
        action Return(element.get("Trigger"))
        tooltip element.get("Tooltip") or None
        hover_sound element.get("Hover Sound") or None
        activate_sound element.get("Click Sound") or None
