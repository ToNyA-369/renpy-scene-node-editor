#!/usr/bin/env python3
"""Run the repository's complete local verification suite."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_check(name: str, command: list[str], *, env: dict[str, str]) -> bool:
    print(f"\n== {name} ==", flush=True)
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, check=False)
    except OSError as error:
        print(f"Unable to run {command[0]}: {error}", file=sys.stderr)
        return False
    if result.returncode:
        print(f"FAILED: {name} (exit {result.returncode})", file=sys.stderr)
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Scene Node Editor verification")
    parser.add_argument(
        "--browser",
        action="store_true",
        help="also run the installed Playwright browser smoke suite",
    )
    args = parser.parse_args()
    node = shutil.which("node")
    git = shutil.which("git")
    npm = shutil.which("npm") if args.browser else None
    commands = [("node", node), ("git", git)]
    if args.browser:
        commands.append(("npm", npm))
    missing = [name for name, path in commands if path is None]
    if missing:
        print(f"Missing required command(s): {', '.join(missing)}", file=sys.stderr)
        return 2

    js_tests = sorted((ROOT / "tests" / "js").glob("*.test.js"))
    if not js_tests:
        print("No JavaScript tests were found under tests/js.", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="scene-node-verify-") as cache_dir:
        env = os.environ.copy()
        env["PYTHONPYCACHEPREFIX"] = cache_dir
        production_js = sorted((ROOT / "EDITOR" / "static").rglob("*.js"))
        checks = [
            (
                "Python syntax",
                [sys.executable, "-m", "compileall", "-q", "EDITOR", "tools", "tests"],
            ),
            *[
                (
                    f"JavaScript syntax: {path.relative_to(ROOT)}",
                    [node, "--check", str(path.relative_to(ROOT))],
                )
                for path in production_js
            ],
            ("JavaScript unit tests", [node, "--test", *[str(path.relative_to(ROOT)) for path in js_tests]]),
            ("Python unit tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"]),
            ("Working tree whitespace", [git, "diff", "--check"]),
            ("Staged whitespace", [git, "diff", "--cached", "--check"]),
        ]
        if args.browser:
            checks.append(("Browser smoke tests", [npm, "run", "test:browser"]))
        results = [run_check(name, command, env=env) for name, command in checks]

    failed = results.count(False)
    if failed:
        print(f"\nVerification failed: {failed} check(s) did not pass.", file=sys.stderr)
        return 1
    print("\nAll verification checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
