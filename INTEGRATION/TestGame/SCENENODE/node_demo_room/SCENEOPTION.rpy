screen option_node_demo_room():
    modal True
    zorder 100

    frame:
        align (0.5, 0.58)
        xsize 620
        background Solid("#0b1118ed")
        padding (38, 34)

        vbox:
            xfill True
            spacing 14

            text "你想做什麼？":
                xalign 0.5
                size 32
                color "#ffffff"

            null height 8

            textbutton "喝一杯水":
                id "demo_room_drink"
                xfill True
                ysize 66
                text_xalign 0.5
                action Return("Action:喝水")

            textbutton "前往街道":
                id "demo_room_street"
                xfill True
                ysize 66
                text_xalign 0.5
                action Return("Action:前往街道")

            textbutton "查看狀態":
                id "demo_room_status"
                xfill True
                ysize 66
                text_xalign 0.5
                action Return("Action:查看狀態")

            textbutton "結束示範":
                id "demo_room_finish"
                xfill True
                ysize 66
                text_xalign 0.5
                action Return("Action:結束示範")
