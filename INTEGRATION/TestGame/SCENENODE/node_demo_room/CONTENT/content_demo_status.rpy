# @display_name: 查看狀態演出

label content_demo_status:
    $ demo_money = scene_get_stat("stat_money_demo")
    $ demo_energy = scene_get_stat("stat_energy_demo")
    $ demo_drink_memory = scene_has_tag("已經喝過房間的水")

    "金錢：[demo_money]，體力：[demo_energy]。"
    if demo_drink_memory:
        "State 記得你已經喝過房間的水。"
    else:
        "State 裡還沒有喝水的記憶。"
    return
