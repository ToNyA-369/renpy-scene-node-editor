# Contributing

[繁體中文說明](README.md) · [English README](README.en.md)

Scene Node Editor is a local Python and browser application with a Ren'Py runtime. Keep editor presentation, project schema, and runtime behavior as separate responsibilities.

## Repository map

```text
EDITOR/                              Local HTTP API and browser editor
INTEGRATION/TestGame/FRAMEWORK/      Runtime sources installed into games
tools/install.py                     Installer and updater
tools/create_editor_test_unit.py     Disposable integration-test project generator
tests/                               Python unit and installer tests
docs/                                User, reference, and AI documentation
```

See the maintenance and extension guide in [English](docs/MAINTENANCE.en.md) or [Traditional Chinese](docs/MAINTENANCE.md) for the frontend module map and the required surfaces for new Triggers, End up modes, Conditions, Effects, and workspaces. Repository-wide agent rules live in `AGENTS.md`.

`INTEGRATION/TestGame/FRAMEWORK/` is the canonical runtime source. Do not treat ignored local files under `INTEGRATION/TestGame/` as disposable repository data.

## Before changing behavior

- UI/UX changes may alter presentation and interaction, but not Schema, API, or Runtime semantics on their own.
- Changes to public Runtime APIs, saved data, IDs, or project structure require an explicit design and impact review.
- Preserve creator-owned game data and existing worktree changes.
- Do not publish releases, tags, or migrations without explicit authorization.

## Checks

Run the complete local verification suite before submitting:

```sh
python3 tools/verify.py
```

This single command checks Python and JavaScript syntax, runs the isolated autosave race tests and the complete Python unit suite, and checks both working-tree and staged whitespace. Pull requests run the same suite on Linux and macOS through GitHub Actions.

Critical Editor interactions have an automated Chromium smoke suite:

```sh
npm ci
npx playwright install chromium
python3 tools/verify.py --browser
```

UI changes also require focused browser interaction testing beyond the existing smoke coverage. Verify the affected workspace, autosave, reload behavior, keyboard interaction, and browser console.

For a broad Editor and Runtime exercise, create a new disposable Ren'Py project and follow [the integration test unit](INTEGRATION/EDITOR_TEST_UNIT.md):

```sh
python3 tools/create_editor_test_unit.py "/path/to/BlankRenPyProject" --launch-editor
```

The generator intentionally refuses projects that already contain Scene Node Editor data.

## Documentation

User-facing changes should update the Traditional Chinese and English documents together:

```text
README.md                         README.en.md
docs/zh-TW/FIRST_PROJECT.md      docs/en/FIRST_PROJECT.md
docs/zh-TW/USER_GUIDE.md         docs/en/USER_GUIDE.md
docs/zh-TW/REFERENCE.md          docs/en/REFERENCE.md
docs/zh-TW/AI_WORKFLOW.md        docs/en/AI_WORKFLOW.md
```

Keep `docs/AI_CONTEXT.md` concise, technical, and synchronized with public contracts. It is copied into installed projects for AI-assisted game development.
