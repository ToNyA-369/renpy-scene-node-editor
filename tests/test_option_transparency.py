import unittest
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402


class OptionTransparencyTests(unittest.TestCase):
    def test_textbox_transparent_backgrounds_are_preserved(self):
        element = app.validate_option_element(
            {
                "ID": "transparent_textbox",
                "Type": "TEXTBOX",
                "Style": {
                    "Background": "#00000000",
                    "Item Background": "#ffffff00",
                    "Item Hover Background": "#12345600",
                    "Item Disabled Background": "#65432100",
                },
                "Items": [
                    {
                        "ID": "transparent_item",
                        "Trigger": "Action:透明",
                        "Style Override": {
                            "Item Background": "#00000000",
                            "Item Hover Background": "#ffffff00",
                        },
                    }
                ],
            }
        )

        self.assertEqual(element["Style"]["Background"], "#00000000")
        self.assertEqual(element["Style"]["Item Background"], "#ffffff00")
        self.assertEqual(element["Style"]["Item Hover Background"], "#12345600")
        self.assertEqual(element["Style"]["Item Disabled Background"], "#65432100")
        override = element["Items"][0]["Style Override"]
        self.assertEqual(override["Item Background"], "#00000000")
        self.assertEqual(override["Item Hover Background"], "#ffffff00")


if __name__ == "__main__":
    unittest.main()
