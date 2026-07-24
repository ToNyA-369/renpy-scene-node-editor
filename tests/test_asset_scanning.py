#!/usr/bin/env python3

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "EDITOR"))

import app  # noqa: E402


class AssetScanningTest(unittest.TestCase):
    def test_assets_only_come_from_their_fixed_project_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            files = (
                "images/room.png",
                "images/backgrounds/day/garden.webp",
                "images/readme.txt",
                "audio/music/theme.ogg",
                "audio/sfx/ui/confirm.wav",
                "audio/notes.txt",
                "other/outside.png",
                "other/outside.mp3",
            )
            for relative in files:
                path = project / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture")

            with mock.patch.object(app, "PROJECT_ROOT", project):
                self.assertEqual(
                    app.scan_image_assets(),
                    ["images/backgrounds/day/garden.webp", "images/room.png"],
                )
                self.assertEqual(
                    app.scan_audio_assets(),
                    ["audio/music/theme.ogg", "audio/sfx/ui/confirm.wav"],
                )

    def test_missing_asset_directories_return_empty_lists(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(app, "PROJECT_ROOT", Path(directory)):
                self.assertEqual(app.scan_image_assets(), [])
                self.assertEqual(app.scan_audio_assets(), [])


if __name__ == "__main__":
    unittest.main()
