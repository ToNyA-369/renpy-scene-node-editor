transform scene_option_item_entrance(index, enabled=False, distance=18, delay=0.04, duration=0.22):
    alpha (0.0 if enabled else 1.0)
    yoffset (distance if enabled else 0)
    pause (delay * index if enabled else 0.0)
    ease (duration if enabled else 0.0) alpha 1.0 yoffset 0


screen scene_option_renderer(node_id, input_bindings=None):
    modal True
    zorder 100

    for keysym, trigger in (input_bindings or []):
        key keysym action Return(trigger)

    fixed:
        xfill True
        yfill True

        # Ren'Py Fixed children are rendered back-to-front. Sorting every
        # visible scope together makes the largest Z Order both visually topmost
        # and the first overlapping control to receive pointer interaction.
        for option_node_id, element in scene_option_render_elements(node_id):
            if scene_option_is_available(option_node_id, element):
                if element.get("Type") == "TEXTBOX":
                    use scene_option_textbox(option_node_id, element) id scene_option_widget_id(option_node_id, element.get("ID"))
                elif element.get("Type") == "PICTURE":
                    use scene_option_picture(option_node_id, element) id scene_option_widget_id(option_node_id, element.get("ID"))
                elif element.get("Type") == "HITBOX":
                    use scene_option_hitbox(option_node_id, element) id scene_option_widget_id(option_node_id, element.get("ID"))


screen scene_option_textbox(node_id, element):
    $ element_id = scene_option_widget_id(node_id, element.get("ID", "option_textbox"))
    $ rect = scene_option_rect(node_id, element)
    $ settings = element.get("List", {})
    $ items = scene_option_visible_items(node_id, element)
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
    $ style = scene_option_textbox_style(element)
    $ hover_settings = element.get("Hover", {})
    $ hover_enabled = bool(hover_settings.get("Enabled", True))
    $ hover_color = hover_settings.get("Color", "#ffffff18")
    $ hover_accent = scene_option_textbox_feature(element, "hover_accent")
    $ hover_text_color = scene_option_textbox_feature(element, "hover_text_color")
    $ item_border = scene_option_textbox_feature(element, "item_border")
    $ entrance = scene_option_textbox_feature(element, "staggered_entrance")
    $ accent_width = scene_option_pixel(node_id, hover_accent.get("Width", 6), "x")
    $ entrance_distance = scene_option_pixel(node_id, abs(entrance.get("Distance", 18)), "y") * (-1 if entrance.get("Distance", 18) < 0 else 1)
    $ item_width = max(1, rect[2] - padding * 2 - (scrollbar_width + spacing if show_scrollbar else 0))
    $ text_outlines = scene_option_text_outlines(element)

    if items:
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

                        for item_index, item in enumerate(items):
                            $ item_background = scene_option_item_style(element, item, "Item Background", "#20302a")
                            $ item_hover_background = scene_option_composite_color(item_background, hover_color) if hover_enabled else item_background
                            $ item_idle_displayable = scene_option_item_background(item_background, item_border, item_width, item_height)
                            $ item_hover_displayable = scene_option_item_background(item_hover_background, item_border, item_width, item_height)
                            button:
                                at scene_option_item_entrance(item_index, bool(entrance.get("Enabled", False)), entrance_distance, float(entrance.get("Delay", 0.04)), float(entrance.get("Duration", 0.22)))
                                id scene_option_widget_id(node_id, "{}__{}".format(element.get("ID", "option_textbox"), item.get("ID", "option_item")))
                                xfill True
                                ysize item_height
                                action Return(item.get("Trigger"))
                                background item_idle_displayable
                                hover_background item_hover_displayable
                                hover_foreground (Transform(Solid(hover_accent.get("Color", "#5c7265")), xsize=accent_width, xalign=0.0) if hover_accent.get("Enabled", False) else None)
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
                                        hover_color (hover_text_color.get("Color", "#ffffff") if hover_text_color.get("Enabled", False) else scene_option_item_style(element, item, "Text Color", "#ffffff"))
                                        outlines text_outlines

                if show_scrollbar:
                    vbar:
                        xsize scrollbar_width
                        yfill True
                        value YScrollValue("{}_viewport".format(element_id))


screen scene_option_picture(node_id, element):
    $ element_id = scene_option_widget_id(node_id, element.get("ID", "option_picture"))
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
    $ element_id = scene_option_widget_id(node_id, element.get("ID", "option_hitbox"))
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
