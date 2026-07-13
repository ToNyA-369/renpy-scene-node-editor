testcase scene_runtime_flow:
    run Jump("start")
    advance until screen "scene_option_renderer"

    assert eval (scene_current_node_id() == "node_demo_room")
    assert eval (scene_get_stat("stat_energy_demo") == 60)
    assert eval (scene_get_stat("stat_money_demo") == 20)

    click id "option_demo_room_drink"
    advance until screen "scene_option_renderer"

    assert eval (scene_get_stat("stat_energy_demo") == 70)
    assert eval scene_has_tag("已經喝過房間的水")

    click id "option_demo_room_street"
    advance until screen "scene_option_renderer"

    assert eval (scene_stack == ["node_demo_room", "node_demo_street"])

    click id "option_demo_street_walk"
    advance until screen "scene_option_renderer"

    assert eval (scene_get_stat("stat_energy_demo") == 60)
    assert eval (scene_get_stat("stat_money_demo") == 25)
    assert eval scene_has_tag("今日已散步")

    click id "option_demo_street_return"
    advance until screen "scene_option_renderer"

    assert eval (scene_stack == ["node_demo_room"])

    click id "option_demo_room_finish"
    advance until "Scene Node 示範已結束。"

    assert eval (scene_stack == [])
    exit
