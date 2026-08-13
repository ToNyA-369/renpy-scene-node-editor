import hashlib
import json
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import package_release  # noqa: E402


class ReleasePackageTests(unittest.TestCase):
    def build(self, directory):
        return package_release.build_release(Path(directory), root=ROOT)

    def test_archive_is_reproducible_and_allowlisted(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            first_archive, first_checksum = self.build(first)
            second_archive, _ = self.build(second)

            self.assertEqual(first_archive.read_bytes(), second_archive.read_bytes())
            digest = hashlib.sha256(first_archive.read_bytes()).hexdigest()
            self.assertEqual(
                first_checksum.read_text(encoding="utf-8"),
                "{}  {}\n".format(digest, first_archive.name),
            )

            package_root = first_archive.stem
            expected = {
                "{}/{}".format(package_root, path.as_posix())
                for path in package_release.collect_release_files(ROOT)
            }
            with zipfile.ZipFile(first_archive) as archive:
                self.assertEqual(set(archive.namelist()), expected)
                for asset in (
                    "EDITOR/static/vendor/content_editor.js",
                    "EDITOR/static/vendor/content_editor.css",
                    "EDITOR/static/vendor/content_editor.worker.js",
                    "EDITOR/THIRD_PARTY_NOTICES.md",
                ):
                    self.assertIn("{}/{}".format(package_root, asset), archive.namelist())
                for member in archive.infolist():
                    relative = member.filename[len(package_root) + 1 :]
                    mode = stat.S_IMODE(member.external_attr >> 16)
                    expected_mode = 0o755 if relative in {
                        "tools/install.py",
                        "安裝到RenPy專案.command",
                    } else 0o644
                    self.assertEqual(mode, expected_mode, relative)

            forbidden = ("/.codex/", "/.github/", "/tests/", "EDITOR/HANDOFF.md")
            self.assertFalse(any(token in name for token in forbidden for name in expected))
            self.assertFalse(any(name.endswith("package.json") for name in expected))

    def test_extracted_archive_installs_into_blank_project(self):
        with tempfile.TemporaryDirectory() as output, tempfile.TemporaryDirectory() as extracted:
            archive_path, _ = self.build(output)
            with zipfile.ZipFile(archive_path) as archive:
                archive.extractall(extracted)

            packaged_root = Path(extracted) / archive_path.stem
            project_root = Path(extracted) / "SampleGame"
            game_root = project_root / "game"
            game_root.mkdir(parents=True)
            for marker in ("options.rpy", "gui.rpy", "script.rpy"):
                (game_root / marker).write_text("# test\n", encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(packaged_root / "tools" / "install.py"), str(project_root)],
                cwd=packaged_root,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((project_root / ".scene-node-editor" / "EDITOR" / "app.py").is_file())
            self.assertTrue((game_root / "FRAMEWORK" / "runtime.rpy").is_file())
            manifest = json.loads(
                (project_root / ".scene-node-editor" / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["version"], package_release.read_version(ROOT))


if __name__ == "__main__":
    unittest.main()
