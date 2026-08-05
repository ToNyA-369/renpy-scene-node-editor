import unittest
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402


class OptionSchemaTests(unittest.TestCase):
    def test_option_schema_has_no_lifecycle_field(self):
        options = app.default_options()
        options["Lifecycle"] = "NODE"
        options["Elements"] = [
            {
                "ID": "interaction_only",
                "Type": "TEXTBOX",
                "Lifecycle": "NODE",
                "Items": [
                    {
                        "ID": "continue",
                        "Trigger": "Action:continue",
                        "Lifecycle": "NODE",
                    }
                ],
            }
        ]

        validated = app.validate_options(options)

        self.assertNotIn("Lifecycle", validated)
        self.assertNotIn("Lifecycle", validated["Elements"][0])
        self.assertNotIn("Lifecycle", validated["Elements"][0]["Items"][0])

    def test_option_schema_is_data_only_and_has_no_rules(self):
        element = app.validate_option_element(
            {
                "ID": "simple_textbox",
                "Type": "TEXTBOX",
                "Visible Conditions": [{"type": "stat", "id": "points", "op": ">=", "value": 1}],
                "Enabled Conditions": [{"type": "memory", "bank": "memory", "id": "key", "op": "has"}],
                "List": {
                    "Show Scrollbar": False,
                    "Scrollbar": "ALWAYS",
                    "Scrollbar Width": 42,
                    "Scrollbar Side": "LEFT",
                },
                "Items": [
                    {
                        "ID": "continue",
                        "Trigger": "Action:continue",
                        "Visible Conditions": [{"type": "stat", "id": "points", "op": ">=", "value": 1}],
                        "Enabled Conditions": [{"type": "memory", "bank": "memory", "id": "key", "op": "has"}],
                    }
                ],
            }
        )

        self.assertNotIn("Visible Conditions", element)
        self.assertNotIn("Enabled Conditions", element)
        self.assertNotIn("Visible Conditions", element["Items"][0])
        self.assertNotIn("Enabled Conditions", element["Items"][0])
        self.assertEqual(element["List"]["Show Scrollbar"], False)
        self.assertNotIn("Scrollbar", element["List"])
        self.assertNotIn("Scrollbar Width", element["List"])
        self.assertNotIn("Scrollbar Side", element["List"])

    def test_textbox_transparent_backgrounds_and_shared_hover_are_preserved(self):
        element = app.validate_option_element(
            {
                "ID": "transparent_textbox",
                "Type": "TEXTBOX",
                "Hover": {"Enabled": True, "Color": "#12345600"},
                "Style": {
                    "Background": "#00000000",
                    "Item Background": "#ffffff00",
                },
                "Items": [
                    {
                        "ID": "transparent_item",
                        "Trigger": "Action:透明",
                        "Style Override": {
                            "Item Background": "#00000000",
                        },
                    }
                ],
            }
        )

        self.assertEqual(element["Style"]["Background"], "#00000000")
        self.assertEqual(element["Style"]["Item Background"], "#ffffff00")
        self.assertEqual(element["Hover"], {"Enabled": True, "Color": "#12345600"})
        override = element["Items"][0]["Style Override"]
        self.assertEqual(override["Item Background"], "#00000000")

    def test_shared_interaction_schema_removes_legacy_supplemental_fields(self):
        elements = [
            app.validate_option_element({
                "ID": "textbox",
                "Type": "TEXTBOX",
                "Hover": {"Enabled": False, "Color": "#abcdef44"},
                "Hover Sound": "audio/hover.ogg",
                "Click Sound": "audio/click.ogg",
                "List": {"Mousewheel": False, "Draggable": False, "Remember Scroll": "NODE"},
                "Items": [{"ID": "item", "Trigger": "Action:item", "Tooltip": "old", "Icon": "old.png"}],
            }),
            app.validate_option_element({
                "ID": "picture",
                "Type": "PICTURE",
                "Trigger": "Action:picture",
                "Tooltip": "old",
                "Hover": {"Enabled": True, "Color": "#11223355"},
                "Picture": {"Idle": "idle.png", "Hover": "hover.png", "Hover Scale": 2},
            }),
            app.validate_option_element({
                "ID": "hitbox",
                "Type": "HITBOX",
                "Trigger": "Action:hitbox",
                "Tooltip": "old",
                "Hitbox": {"Cursor": "crosshair", "Hover Image": "old.png"},
            }),
        ]

        for element in elements:
            self.assertIn("Hover", element)
            self.assertIn("Hover Sound", element)
            self.assertIn("Click Sound", element)
            self.assertNotIn("Tooltip", element)
        self.assertEqual(elements[0]["Hover"], {"Enabled": False, "Color": "#abcdef44"})
        self.assertNotIn("Mousewheel", elements[0]["List"])
        self.assertNotIn("Draggable", elements[0]["List"])
        self.assertNotIn("Remember Scroll", elements[0]["List"])
        self.assertNotIn("Tooltip", elements[0]["Items"][0])
        self.assertNotIn("Icon", elements[0]["Items"][0])
        self.assertNotIn("Hover Scale", elements[1]["Picture"])
        self.assertNotIn("Cursor", elements[2]["Hitbox"])
        self.assertNotIn("Hover Image", elements[2]["Hitbox"])

    def test_picture_focus_mask_uses_none_when_alpha_hit_test_is_disabled(self):
        renderer = (
            ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK" / "option_renderer.rpy"
        ).read_text(encoding="utf-8")

        self.assertIn(
            'focus_mask (True if picture.get("Alpha Hit Test", False) else None)',
            renderer,
        )
        self.assertNotIn(
            'focus_mask bool(picture.get("Alpha Hit Test", False))',
            renderer,
        )
        self.assertIn('element.get("Hover", {})', renderer)
        self.assertIn('hover_sound element.get("Hover Sound") or None', renderer)
        self.assertNotIn('tooltip element.get("Tooltip")', renderer)

    def test_renderer_filters_controlled_elements_and_textbox_items(self):
        renderer = (
            ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK" / "option_renderer.rpy"
        ).read_text(encoding="utf-8")

        self.assertIn("if scene_option_is_available(node_id, element):", renderer)
        self.assertIn("$ items = scene_option_visible_items(node_id, element)", renderer)
        self.assertIn("if items:", renderer)


if __name__ == "__main__":
    unittest.main()
