# AI development workflow

[繁體中文](DEVELOPMENT_WORKFLOW.md)

This workflow reduces primary-thread token use and latency while preserving a single requirements owner and complete integration review. Product architecture remains governed by `AGENTS.md`, `EDITOR/HANDOFF.md`, and the bilingual Reference.

## Model and role routing

The primary thread owns requirements, architecture decisions, decomposition, integration, and delivery. Start with Sol Medium; raise effort to Sol High only for cross-Schema/Runtime work, ambiguous architecture, or reviews that fail to converge.

| Work | Suggested role | Model | Rule |
|---|---|---|---|
| Locate files, dependencies, and tests | `explorer` | Luna Medium | Read-only; answer one bounded question |
| Implement a bounded change | `implementer` | Terra Medium | One writer in an isolated branch/worktree |
| Review a diff for regressions | `reviewer` | Terra High | Read-only and findings-first |
| Architecture contracts and integration | Primary | Sol Medium/High | The user's single point of contact |

At most two subagents run concurrently by default. The primary handles small fixes, tightly coupled UI iteration, and work that needs rapid feedback. Parallelism is reserved for genuinely independent workstreams. Implementations use focused tests while iterating; the complete suite runs once after integration.

Project configuration lives in `.codex/config.toml`; role definitions live in `.codex/agents/`. A new Codex session normally loads new project settings. The primary model is intentionally not pinned so its effort can follow task risk.

## Antigravity implementation lane

Antigravity is appropriate when the specification, write boundary, and automated acceptance checks are explicit. It does not own architecture decisions and must not write in the primary agent's current worktree.

1. The primary fills in `.codex/templates/implementation-brief.md`.
2. Create a dedicated branch and worktree for the task.
3. Run the official `agy` CLI in that worktree with its sandbox enabled.
4. Antigravity returns a diff, test evidence, and risks; it does not push or merge.
5. The primary reviews the change and performs integration verification before delivery.

Safe interactive starting point:

```sh
agy --project "/absolute/path/to/task-worktree" --mode accept-edits --sandbox
```

For planning without writes:

```sh
agy --project "/absolute/path/to/task-worktree" --mode plan --sandbox
```

Paste the completed implementation brief after startup. Never use `--dangerously-skip-permissions`. Tasks that change Schema, public Runtime APIs, save formats, or release state must stop at planning and return to the primary for explicit user approval.

## Standard request cadence

1. The primary classifies risk and reads the necessary specifications.
2. Targeted exploration establishes the smallest change surface; agents do not duplicate repository discovery.
3. Choose exactly one writer: the primary, the Codex implementer, or an Antigravity worktree.
4. The writer runs focused tests and returns a structured report.
5. The primary reviews contracts and the diff; a second read-only review is reserved for higher-risk changes.
6. The primary runs `python3 tools/verify.py`, plus browser or Ren'Py verification when required.
7. Nothing is pushed, merged, tagged, or released without explicit authorization.

The goal is not to delegate every task. It is to keep the expensive primary context focused on requirements, decisions, risks, and integration evidence.
