screen scene_option_renderer(node_id, input_bindings=None):
    modal True
    zorder 100

    for keysym, trigger in (input_bindings or []):
        key keysym action Return(trigger)

    fixed:
        xfill True
        yfill True

        for element in scene_option_data(node_id).get("Elements", []):
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
    $ items = element.get("Items", [])
    $ maximum = max(1, int(settings.get("Max Visible Items", 4)))
    $ visible_rows = max(1, min(len(items), maximum))
    $ item_height = scene_option_pixel(node_id, settings.get("Item Height", 72), "y")
    $ spacing = scene_option_pixel(node_id, settings.get("Item Spacing", 12), "y") if settings.get("Item Spacing", 12) else 0
    $ padding = scene_option_pixel(node_id, settings.get("Padding", 16), "uniform") if settings.get("Padding", 16) else 0
    $ content_height = visible_rows * item_height + max(0, visible_rows - 1) * spacing
    $ frame_height = content_height + padding * 2
    $ show_scrollbar = bool(settings.get("Show Scrollbar", True)) and len(items) > maximum
    $ scrollbar_width = scene_option_pixel(node_id, 18, "x")
    $ adjustment = scene_option_adjustment(node_id, element)
    $ style = element.get("Style", {})
    $ hover_settings = element.get("Hover", {})
    $ hover_enabled = bool(hover_settings.get("Enabled", True))
    $ hover_color = hover_settings.get("Color", "#ffffff18")

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

            viewport:
                id "{}_viewport".format(element_id)
                xfill True
                yfill True
                mousewheel True
                draggable True
                yadjustment adjustment

                vbox:
                    xfill True
                    spacing spacing

                    for item in items:
                        $ item_background = scene_option_item_style(element, item, "Item Background", "#20302a")
                        $ item_hover_background = scene_option_composite_color(item_background, hover_color) if hover_enabled else item_background
                        button:
                            id item.get("ID", "option_item")
                            xfill True
                            ysize item_height
                            action Return(item.get("Trigger"))
                            background Solid(item_background)
                            hover_background Solid(item_hover_background)
                            hover_sound element.get("Hover Sound") or None
                            activate_sound element.get("Click Sound") or None

                            fixed:
                                text item.get("Text") or item.get("Name") or item.get("ID"):
                                    xfill True
                                    yalign 0.5
                                    xalign float(scene_option_item_style(element, item, "Text Align", 0.5))
                                    text_align float(scene_option_item_style(element, item, "Text Align", 0.5))
                                    size scene_option_pixel(node_id, scene_option_item_style(element, item, "Text Size", 30))
                                    color scene_option_item_style(element, item, "Text Color", "#ffffff")
                                    hover_color scene_option_item_style(element, item, "Text Color", "#ffffff")

            if show_scrollbar:
                vbar:
                    xsize scrollbar_width
                    yfill True
                    value YScrollValue("{}_viewport".format(element_id))


screen scene_option_picture(node_id, element):
    $ element_id = element.get("ID", "option_picture")
    $ rect = scene_option_rect(node_id, element)
    $ picture = element.get("Picture", {})
    $ picture_fit = picture.get("Fit") if picture.get("Keep Aspect", True) else "STRETCH"
    $ hover_settings = element.get("Hover", {})
    $ hover_enabled = bool(hover_settings.get("Enabled", True))
    $ idle = scene_option_image(picture.get("Idle"), rect[2], rect[3], picture_fit, picture.get("Opacity", 1.0), picture.get("Tint", "#ffffff"))
    $ hover_base = scene_option_image(picture.get("Hover") or picture.get("Idle"), rect[2], rect[3], picture_fit, picture.get("Opacity", 1.0), picture.get("Tint", "#ffffff"))
    $ hover = scene_option_hover_displayable(hover_base, hover_settings.get("Color", "#ffffff18"), rect[2], rect[3]) if hover_enabled else idle

    imagebutton:
        id element_id
        pos (rect[0], rect[1])
        xysize (rect[2], rect[3])
        idle idle
        hover hover
        focus_mask (True if picture.get("Alpha Hit Test", False) else None)
        action Return(element.get("Trigger"))
        hover_sound element.get("Hover Sound") or None
        activate_sound element.get("Click Sound") or None


screen scene_option_hitbox(node_id, element):
    $ element_id = element.get("ID", "option_hitbox")
    $ rect = scene_option_rect(node_id, element)
    $ hover_settings = element.get("Hover", {})
    $ hitbox_hover_background = Solid(hover_settings.get("Color", "#ffffff18")) if hover_settings.get("Enabled", True) else Solid("#00000000")

    button:
        id element_id
        pos (rect[0], rect[1])
        xysize (rect[2], rect[3])
        background Solid("#00000000")
        hover_background hitbox_hover_background
        action Return(element.get("Trigger"))
        hover_sound element.get("Hover Sound") or None
        activate_sound element.get("Click Sound") or None
