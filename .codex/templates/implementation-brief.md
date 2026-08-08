# Implementation brief

## Identity

- Task:
- Owner:
- Branch/worktree:
- Classification: architecture contract / Editor feature / Editor UI/UX / Ren'Py Runtime / release-maintenance
- Risk: low / medium / high

## Objective

State the observable outcome in one paragraph.

## Acceptance criteria

1.
2.

## Contract and context

- Authoritative documents:
- Relevant modules and symbols:
- Stable Schema/API/Runtime behavior that must remain unchanged:
- Approved behavior changes:

## Scope

- Allowed write paths:
- Explicit non-goals:
- Creator-owned or unrelated paths to preserve:

## Verification

- Focused checks during implementation:
- Required regression tests:
- Browser or Ren'Py verification, when applicable:
- Final integration check owned by primary agent: `python3 tools/verify.py`

## Execution constraints

- Work only in the named dedicated branch/worktree; never share a writable worktree with another agent.
- Read `AGENTS.md`, `EDITOR/HANDOFF.md`, and relevant bilingual specifications before editing.
- Do not change architecture or broaden scope without returning the issue to the primary agent.
- Do not push, publish, tag, release, or use destructive Git operations.
- When using Antigravity, use the official `agy` CLI with `--sandbox`; never use `--dangerously-skip-permissions`.

## Return contract

- Outcome summary.
- Changed files and why.
- Commands run and exact results.
- Remaining risks, assumptions, or blocked items.
- Branch, commit, and working-tree status; provide the diff for primary-agent review.
