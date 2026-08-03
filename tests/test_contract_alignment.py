import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "INTEGRATION" / "TestGame" / "FRAMEWORK" / "runtime.rpy"
EVENT_CONTRACT = "./EDITOR/static/js/core/event_contract.js"
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402


def frontend_contract(expression):
    command = (
        f"const contract = require('{EVENT_CONTRACT}');"
        f"process.stdout.write(JSON.stringify({expression}));"
    )
    completed = subprocess.run(
        ["node", "-e", command],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def event_document(trigger="Auto:Node"):
    event = {
        "ID": "alignment_event",
        "Name": "契約對齊",
        "Trigger": trigger,
        "Priority": 3,
        "Once": False,
        "Conditions": [],
        "Effects": [],
        "Content": None,
    }
    if trigger not in ("Auto:Enter", "Auto:Exit"):
        event.update({"Weight": 1, "End up": "REDO", "Next Node": None})
    return event


class CrossLayerContractAlignmentTest(unittest.TestCase):
    def test_every_frontend_end_up_is_accepted_by_schema_and_present_in_runtime(self):
        end_ups = frontend_contract("contract.END_UP_CHOICES")
        runtime_source = RUNTIME.read_text(encoding="utf-8")

        for end_up in end_ups:
            with self.subTest(end_up=end_up):
                event = event_document()
                event["End up"] = end_up
                event["Next Node"] = "target" if end_up in ("GOTO", "REPLACE") else None
                self.assertEqual(app.validate_event(event)["End up"], end_up)
                self.assertIn(f'end_up == "{end_up}"', runtime_source)

    def test_frontend_auto_and_mouse_choices_are_accepted_by_schema(self):
        triggers = frontend_contract(
            "[...contract.AUTO_TRIGGER_CHOICES, ...contract.MOUSE_TRIGGER_CHOICES].map(item => item.id)"
        )
        for trigger in triggers:
            with self.subTest(trigger=trigger):
                self.assertEqual(app.validate_event(event_document(trigger))["Trigger"], trigger)

    def test_each_frontend_trigger_mode_has_a_schema_valid_representative(self):
        modes = frontend_contract("contract.EVENT_TRIGGER_MODES.map(item => item.id)")
        examples = {
            "Auto": "Auto:Node",
            "Action": "Action:continue",
            "Keyboard": "Keyboard:shift_K_k",
            "Mouse": "Mouse:Left",
        }
        self.assertEqual(set(modes), set(examples))
        for mode in modes:
            with self.subTest(mode=mode):
                trigger = examples[mode]
                self.assertEqual(app.validate_event(event_document(trigger))["Trigger"], trigger)


if __name__ == "__main__":
    unittest.main()
