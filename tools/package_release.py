#!/usr/bin/env python3
"""Build the clean, reproducible Scene Node Editor product archive."""

import argparse
import hashlib
import re
import stat
import zipfile
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = PACKAGE_ROOT / "VERSION"
ARCHIVE_PREFIX = "Scene-Node-Editor"
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
VERSION_PATTERN = re.compile(
    r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)

ROOT_FILES = (
    "LICENSE",
    "README.md",
    "README.en.md",
    "VERSION",
    "安裝到RenPy專案.command",
)
INSTALLER_FILES = ("tools/install.py",)
RUNTIME_FILES = (
    "INTEGRATION/TestGame/FRAMEWORK/option_renderer.rpy",
    "INTEGRATION/TestGame/FRAMEWORK/runtime.rpy",
)
DOCUMENTATION_FILES = (
    "docs/AI_CONTEXT.md",
    "docs/README.md",
    "docs/en/AI_WORKFLOW.md",
    "docs/en/FIRST_PROJECT.md",
    "docs/en/REFERENCE.md",
    "docs/en/USER_GUIDE.md",
    "docs/zh-TW/AI_WORKFLOW.md",
    "docs/zh-TW/FIRST_PROJECT.md",
    "docs/zh-TW/REFERENCE.md",
    "docs/zh-TW/USER_GUIDE.md",
)
EDITOR_EXCLUDES = {"EDITOR/HANDOFF.md"}
IGNORED_NAMES = {".DS_Store", "__pycache__"}
IGNORED_SUFFIXES = {".pyc", ".pyo", ".tmp"}


class PackageError(Exception):
    """Raised when release inputs are unsafe or incomplete."""


def read_version(root=PACKAGE_ROOT):
    version_file = Path(root) / VERSION_FILE.name
    if not version_file.is_file():
        raise PackageError("Missing VERSION file.")
    version = version_file.read_text(encoding="utf-8").strip()
    if not VERSION_PATTERN.fullmatch(version):
        raise PackageError("VERSION must contain a valid semantic version.")
    return version


def _validate_file(path, root):
    if not path.is_file():
        raise PackageError("Missing release file: {}".format(path.relative_to(root)))
    if path.is_symlink():
        raise PackageError("Release files may not be symlinks: {}".format(path.relative_to(root)))


def collect_release_files(root=PACKAGE_ROOT):
    """Return a stable allowlist of source paths relative to *root*."""
    root = Path(root).resolve()
    relative_paths = [
        Path(item)
        for item in ROOT_FILES + INSTALLER_FILES + RUNTIME_FILES + DOCUMENTATION_FILES
    ]

    editor_root = root / "EDITOR"
    if not editor_root.is_dir() or editor_root.is_symlink():
        raise PackageError("Missing or unsafe EDITOR directory.")
    for path in editor_root.rglob("*"):
        relative = path.relative_to(root)
        if path.is_symlink():
            raise PackageError("Release files may not be symlinks: {}".format(relative))
        if path.is_dir():
            continue
        if any(part in IGNORED_NAMES for part in relative.parts):
            continue
        if path.suffix in IGNORED_SUFFIXES or relative.as_posix() in EDITOR_EXCLUDES:
            continue
        relative_paths.append(relative)

    unique_paths = sorted(set(relative_paths), key=lambda item: item.as_posix())
    for relative in unique_paths:
        _validate_file(root / relative, root)
    return unique_paths


def _zip_info(archive_name, executable):
    info = zipfile.ZipInfo(archive_name, FIXED_TIMESTAMP)
    info.create_system = 3
    mode = 0o755 if executable else 0o644
    info.external_attr = (stat.S_IFREG | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def build_release(output_dir=None, root=PACKAGE_ROOT):
    root = Path(root).resolve()
    version = read_version(root)
    package_name = "{}-v{}".format(ARCHIVE_PREFIX, version)
    output_dir = Path(output_dir) if output_dir is not None else root / "dist"
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / "{}.zip".format(package_name)

    files = collect_release_files(root)
    with zipfile.ZipFile(
        archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for relative in files:
            source = root / relative
            executable = relative.as_posix() in {
                "tools/install.py",
                "安裝到RenPy專案.command",
            }
            archive_name = "{}/{}".format(package_name, relative.as_posix())
            archive.writestr(_zip_info(archive_name, executable), source.read_bytes())

    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum_path = output_dir / "{}.zip.sha256".format(package_name)
    checksum_path.write_text(
        "{}  {}\n".format(digest, archive_path.name), encoding="utf-8"
    )
    return archive_path, checksum_path


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Output directory (default: repository dist/)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        archive_path, checksum_path = build_release(args.output_dir)
    except PackageError as exc:
        print("Release packaging failed: {}".format(exc))
        return 1
    print(archive_path)
    print(checksum_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
