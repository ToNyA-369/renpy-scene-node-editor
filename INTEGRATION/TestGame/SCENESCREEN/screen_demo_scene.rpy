# @display_name: 示範場景畫面

screen screen_demo_scene():
    zorder -100

    $ node = scene_current_node()
    $ node_id = node.get("ID", "")
    $ node_name = node.get("Name", node_id)
    $ money = scene_get_stat("stat_money_demo")
    $ energy = scene_get_stat("stat_energy_demo")

    add "gui/main_menu.png"

    if node_id == "node_demo_room":
        add Solid("#102733c9")
    else:
        add Solid("#283329c9")

    frame:
        xfill True
        ysize 112
        background Solid("#0b1118e8")
        padding (42, 20)

        fixed:
            text node_name:
                xalign 0.0
                yalign 0.5
                size 42
                color "#ffffff"

            hbox:
                xalign 1.0
                yalign 0.5
                spacing 18

                frame:
                    xsize 210
                    ysize 62
                    background Solid("#d7b35b")
                    text "金錢  [money]":
                        align (0.5, 0.5)
                        size 28
                        color "#17130b"

                frame:
                    xsize 210
                    ysize 62
                    background Solid("#72b69b")
                    text "體力  [energy]":
                        align (0.5, 0.5)
                        size 28
                        color "#08150f"

    text "Scene Node Runtime Demo":
        xalign 0.5
        yalign 0.96
        size 22
        color "#ffffff99"
