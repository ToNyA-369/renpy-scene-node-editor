screen option_node_demo_street():
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

            text "街上的行動":
                xalign 0.5
                size 32
                color "#ffffff"

            null height 8

            textbutton "散步賺錢":
                id "demo_street_walk"
                xfill True
                ysize 66
                text_xalign 0.5
                action Return("Action:散步")

            textbutton "回到房間":
                id "demo_street_return"
                xfill True
                ysize 66
                text_xalign 0.5
                action Return("Action:返回")
