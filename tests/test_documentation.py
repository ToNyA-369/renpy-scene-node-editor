#!/usr/bin/env python3

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MARKDOWN_LINK = re.compile(r"(?<!!)\[[^]]*\]\(([^)]+)\)")


class DocumentationTest(unittest.TestCase):
    def test_public_documentation_has_bilingual_entry_points(self):
        expected = (
            "README.md",
            "README.en.md",
            "docs/README.md",
            "docs/zh-TW/FIRST_PROJECT.md",
            "docs/en/FIRST_PROJECT.md",
            "docs/zh-TW/USER_GUIDE.md",
            "docs/en/USER_GUIDE.md",
            "docs/zh-TW/REFERENCE.md",
            "docs/en/REFERENCE.md",
            "docs/zh-TW/AI_WORKFLOW.md",
            "docs/en/AI_WORKFLOW.md",
            "docs/AI_CONTEXT.md",
            "EDITOR/README.md",
            "EDITOR/README.en.md",
        )
        for relative_path in expected:
            with self.subTest(path=relative_path):
                self.assertTrue((ROOT / relative_path).is_file())

    def test_local_markdown_links_resolve(self):
        markdown_files = [
            ROOT / "README.md",
            ROOT / "README.en.md",
            ROOT / "CONTRIBUTING.md",
            *(ROOT / "docs").rglob("*.md"),
            *(ROOT / ".github" / "maintainers").rglob("*.md"),
            ROOT / "EDITOR" / "README.md",
            ROOT / "EDITOR" / "README.en.md",
        ]
        failures = []
        for source in markdown_files:
            for raw_target in MARKDOWN_LINK.findall(source.read_text(encoding="utf-8")):
                target = raw_target.strip().split("#", 1)[0]
                if not target or "://" in target or target.startswith("mailto:"):
                    continue
                resolved = (source.parent / target).resolve()
                if not resolved.exists():
                    failures.append("{} -> {}".format(source.relative_to(ROOT), raw_target))
        self.assertEqual(failures, [])


if __name__ == "__main__":
    unittest.main()
